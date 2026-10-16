"""Acha os exercícios de um livro em PDF e recorta cada um da página, para a resolução em lote.

Uso:
  python tools/exercicios-do-pdf.py descobrir ORIGINAL.pdf PASTA_DO_CACHE   → JSON no stdout
  python tools/exercicios-do-pdf.py recortar ORIGINAL.pdf PASTA_DE_SAIDA < pedido.json

`descobrir` lê as palavras de cada página (a camada de texto do PDF, ou o OCR do `tesseract` quando a
página não tem texto; o OCR fica guardado em PASTA_DO_CACHE/NNN.tsv) e as linhas de tinta da página
renderizada. Uma seção de exercícios começa no título "N. Exercícios" e vai até o começo do capítulo
seguinte; dentro dela, "Seção k: …" abre uma seção e cada item numerado ("1.", "2." …, com o número
saindo para a esquerda do texto, como nos livros de matemática) é um exercício, até o próximo item.
Um exercício que atravessa a página tem uma parte por página.

Saída: {"paginas", "fonte": "texto"|"ocr", "capitulos": [{numero, titulo, pagina}], "exercicios":
[{capitulo, secao, numero, ordem, partes: [{pagina, x, y, largura, altura}], texto}]}, com as caixas em
frações da página (como o recorte do leitor).

`recortar` recebe [{"chave", "partes"}] e grava PASTA_DE_SAIDA/<chave>.png: as partes empilhadas,
em cinza, a 200 dpi.

Só depende de pymupdf (motor/.venv) e, para páginas escaneadas, do binário `tesseract` com o
idioma `por` (MARGEM_TESSERACT escolhe outro caminho).
"""
from __future__ import annotations

import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pymupdf

DPI = 200
TINTA = bytes(1 if i < 140 else 0 for i in range(256))

RE_EXERCICIOS = re.compile(r"^\W{0,2}(\d{1,2})?\s*[.,]?\s*Exerc[ií1l]c[ií1l]os\s*$", re.I)
# "Seção 1: …", também como o OCR a lê ("Soção", "Hação", "Heção").
RE_SECAO = re.compile(r"^\W{0,2}[SHN][a-zçõ]{0,2}[cç][aã]o\s*(\d{1,2})\s*[:.;]\s*(.+)$", re.I)
# "3. Prove…"; não "(1,2,…)" nem "1,5": nada de parêntese antes nem dígito logo depois.
RE_NUMERO = re.compile(r"^[^\w(\[{]{0,2}(\d{1,2})\s*[.,]\s*(?=[^\s\d])")
RE_UM_MAL_LIDO = re.compile(r"^([|Il!\]\[iíL])\s*[.,]\s*(?=\S)")
RE_SO_NUMERO = re.compile(r"^\d{1,2}$")
# "A. Integrando por partes…": etapas com letra dentro de um exercício, não um exercício novo.
RE_PARTE_COM_LETRA = re.compile(r"^\W{0,2}[A-Z]\s*[.)]\s")


def corrigir_ocr(texto: str) -> str:
    """O trema da ortografia antiga sai como "ii" no OCR (seqiiência, conseqiiente)."""
    texto = re.sub(r"([qg])i{1,2}([eéê])", r"\1ü\2", texto)
    return re.sub(r"\s+", " ", texto).strip()


# ------------------------------------------------------------------ palavras e tinta

def palavras_do_tesseract(png: Path, tsv: Path) -> list[tuple[float, float, float, float, str, float]]:
    if not tsv.exists():
        binario = os.environ.get("MARGEM_TESSERACT", "tesseract")
        ambiente = {**os.environ, "OMP_THREAD_LIMIT": "1"}
        provisorio = tsv.with_name(f".{tsv.stem}")
        subprocess.run([binario, str(png), str(provisorio), "-l", "por", "--psm", "4", "tsv"],
                       check=True, capture_output=True, env=ambiente)
        Path(f"{provisorio}.tsv").rename(tsv)
    palavras = []
    for linha in tsv.read_text(encoding="utf-8").splitlines()[1:]:
        c = linha.split("\t")
        if len(c) < 12 or c[0] != "5" or not c[11].strip():
            continue
        x, y, w, h = (int(v) for v in c[6:10])
        palavras.append((x, y, x + w, y + h, c[11].strip(), float(c[10])))
    return palavras


def faixas_de_tinta(pix: pymupdf.Pixmap) -> list[dict]:
    """Linhas de tinta (faixas horizontais), com a primeira e a última coluna com tinta."""
    w, h, amostras = pix.width, pix.height, pix.samples
    mx, my = int(w * 0.03), int(h * 0.015)
    # A sombra da lombada no escâner: colunas escuras em boa parte da altura, nas bordas. O texto começa depois dela.
    escura = lambda x: amostras[x::pix.stride][my:h - my].translate(TINTA).count(1) > (h - 2 * my) * 0.3
    esquerda, direita = mx, w - mx
    while esquerda < w // 4 and escura(esquerda):
        esquerda += 1
    while direita > w * 3 // 4 and escura(direita - 1):
        direita -= 1
    if esquerda > mx:
        esquerda += 4
    if direita < w - mx:
        direita -= 4
    linhas = []
    for y in range(my, h - my):
        linha = amostras[y * pix.stride + esquerda: y * pix.stride + direita].translate(TINTA)
        if linha.count(1) >= 2:
            linhas.append((y, esquerda + linha.find(1), esquerda + linha.rfind(1)))
    faixas: list[dict] = []
    for y, esq, dir_ in linhas:
        if faixas and y - faixas[-1]["y1"] <= 2:
            f = faixas[-1]
            f["y1"], f["esq"], f["dir"] = y, min(f["esq"], esq), max(f["dir"], dir_)
        else:
            faixas.append({"y0": y, "y1": y, "esq": esq, "dir": dir_})
    # Pontos de i, acentos e índices soltos viram faixas baixinhas: juntam-se à vizinha mais perto.
    juntas: list[dict] = []
    for f in faixas:
        if juntas and (f["y1"] - f["y0"] < 9 or juntas[-1]["y1"] - juntas[-1]["y0"] < 9) and f["y0"] - juntas[-1]["y1"] <= 8:
            g = juntas[-1]
            g["y1"], g["esq"], g["dir"] = f["y1"], min(g["esq"], f["esq"]), max(g["dir"], f["dir"])
        else:
            juntas.append(dict(f))
    return [f for f in juntas if f["y1"] - f["y0"] >= 6]


def ler_pagina(documento: pymupdf.Document, numero: int, cache: Path) -> dict:
    pagina = documento[numero - 1]
    pix = pagina.get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY)
    escala = DPI / 72
    palavras = [(x0 * escala, y0 * escala, x1 * escala, y1 * escala, t, 100.0)
                for x0, y0, x1, y1, t, *_ in pagina.get_text("words") if t.strip()]
    fonte = "texto"
    if len(palavras) < 5:
        fonte = "ocr"
        tsv = cache / f"{numero:03d}.tsv"
        with tempfile.TemporaryDirectory() as pasta:
            png = Path(pasta) / "p.png"
            if not tsv.exists():
                pix.save(png)
            palavras = palavras_do_tesseract(png, tsv)
    faixas = faixas_de_tinta(pix)
    for f in faixas:
        f["palavras"] = sorted((p for p in palavras if f["y0"] - 4 <= (p[1] + p[3]) / 2 <= f["y1"] + 4 and p[5] > 10), key=lambda p: p[0])
        f["texto"] = " ".join(p[4] for p in f["palavras"])
    return {"pagina": numero, "largura": pix.width, "altura": pix.height, "palavras": palavras, "faixas": faixas, "fonte": fonte}


# ------------------------------------------------------------------ estrutura do livro

def abertura_de_capitulo(pagina: dict, altura_mediana: float) -> dict | None:
    """Página que abre capítulo: a primeira linha é o título em letra grande, ou o número sozinho em
    letra grande com o título grande logo abaixo."""
    boas = [p for p in pagina["palavras"] if p[5] > 40]
    if not boas:
        return None
    linhas: list[list] = []
    for p in sorted(boas, key=lambda p: (p[1], p[0])):
        if linhas and abs(p[1] - linhas[-1][0][1]) < 25:
            linhas[-1].append(p)
        else:
            linhas.append([p])
    letras = lambda p: sum(ch.isalpha() for ch in p[4])
    grande = lambda p, fator=1.8: p[3] - p[1] >= fator * altura_mediana
    def de_titulo(linha: list) -> bool:
        return any(grande(p) and letras(p) >= 4 for p in linha) and sum(grande(p, 1.5) for p in linha) * 2 >= len(linha)
    primeira = linhas[0]
    numero = None
    if len(primeira) == 1 and RE_SO_NUMERO.match(primeira[0][4]) and grande(primeira[0], 1.6):
        numero = int(primeira[0][4])
        titulo = linhas[1:]
    elif de_titulo(primeira):
        titulo = linhas
    else:
        return None
    limite = primeira[0][1] + pagina["altura"] * 0.25
    titulo = [linha for linha in titulo if linha[0][1] <= limite]
    titulo = titulo[:next((k for k, linha in enumerate(titulo) if not de_titulo(linha)), len(titulo))]
    if not titulo:
        return None
    texto = " ".join(" ".join(q[4] for q in sorted(linha, key=lambda q: q[0])) for linha in titulo)
    return {"numero": numero, "titulo": corrigir_ocr(texto), "pagina": pagina["pagina"]}


def cabecalho_ou_rodape(faixa: dict, pagina: dict) -> bool:
    """O cabeçalho corrido ("12 Números Reais Cap. 2", "Seção 2 R é um corpo ordenado 13") e o número da página no pé."""
    h, texto = pagina["altura"], faixa["texto"].strip()
    faixas = pagina["faixas"]
    if faixa is faixas[0] and faixa["y1"] < h * 0.075:
        return bool(re.match(r"^\d{1,3}\s", texto) or re.search(r"\s\d{1,3}$", texto) or re.search(r"Cap\.\s*\d", texto))
    return faixa is faixas[-1] and faixa["y0"] > h * 0.93 and len(texto.split()) <= 3


RE_TOKEN_DO_NUMERO = re.compile(r"^\W{0,2}(\d{1,2}|[|Il!\]\[iíL])\s*[.,]?$")


def inicio_do_texto(faixa: dict) -> tuple | None:
    """A primeira palavra do texto da faixa, depois do número do item quando o OCR o leu como palavra."""
    palavras = [p for p in faixa["palavras"] if any(ch.isalnum() for ch in p[4])]
    if palavras and RE_TOKEN_DO_NUMERO.match(palavras[0][4]):
        palavras = palavras[1:]
    return palavras[0] if palavras else None


def coluna_do_texto(faixas: list[dict], largura: int) -> float | None:
    """Onde começa o texto dos itens numa página: a primeira palavra depois do número lido, desde que
    outras linhas comecem ali também (o OCR pode perder a primeira palavra); senão, a primeira coluna
    de linhas à direita dos números."""
    if not faixas:
        return None
    # Um número no começo de uma fórmula centralizada não é número de item: só valem os da margem esquerda.
    minimo = min(f["esq"] for f in faixas)
    lidos = [f for f in faixas if (RE_NUMERO.match(f["texto"]) or RE_UM_MAL_LIDO.match(f["texto"])) and f["esq"] <= minimo + largura * 0.06]
    if not lidos:
        return None
    esquerdas = [f["esq"] for f in faixas]
    apoiada = lambda x: any(abs(e - x) <= 8 for e in esquerdas)
    xs = [p[0] for f in lidos if (p := inicio_do_texto(f)) and p[0] > f["esq"] and apoiada(p[0])]
    if xs:
        return statistics.median(xs)
    base = min(f["esq"] for f in lidos) + largura * 0.012
    return next((e for e in sorted(esquerdas) if e > base and apoiada(e)), None)


def saliente(faixa: dict, coluna: float | None, largura: int) -> bool:
    """A tinta da faixa começa à esquerda da coluna do texto, onde fica o número do item."""
    return coluna is not None and coluna - largura * 0.07 < faixa["esq"] < coluna - largura * 0.012


def numero_do_item(faixa: dict, esperado: int, largura: int, coluna: float | None, margem: dict | None = None) -> tuple[int, str] | None:
    """O número do item, se a faixa começa um. O número sai à esquerda da coluna do texto; lido ("3."),
    mal lido ("|." no lugar de "1.") ou só visto (tinta ali; o número vem do OCR da margem, `ler_margem`)."""
    if not saliente(faixa, coluna, largura):
        return None
    texto = faixa["texto"]
    achado = RE_NUMERO.match(texto)
    if achado:
        lido = int(achado.group(1))
        return (lido if lido in (esperado, esperado + 1) or lido == 1 else esperado), "lido"
    if RE_UM_MAL_LIDO.match(texto) and esperado == 1:
        return 1, "lido"
    if RE_PARTE_COM_LETRA.match(texto) or margem is not None and margem.get("parte") or inicio_do_texto(faixa) is None:
        return None
    lido = margem.get("numero") if margem else None
    return (lido if lido in (esperado, esperado + 1) else esperado), "visto"


def ler_margem(documento: pymupdf.Document, pagina: dict, faixa: dict, coluna: float, cache: Path) -> str:
    """O que está escrito na tinta à esquerda da primeira palavra (o número que o OCR da página perdeu):
    o recorte da faixa, a 300 dpi, lido pelo tesseract como uma linha só de dígitos, letras A–J e ponto."""
    guardado = cache / f"{pagina['pagina']:03d}-margem-{faixa['y0']}.txt"
    if guardado.exists():
        return guardado.read_text(encoding="utf-8")
    escala = 72 / DPI
    clip = pymupdf.Rect((faixa["esq"] - 6) * escala, (faixa["y0"] - 4) * escala, (coluna - pagina["largura"] * 0.006) * escala, (faixa["y1"] + 4) * escala)
    with tempfile.TemporaryDirectory() as pasta:
        png = Path(pasta) / "m.png"
        documento[pagina["pagina"] - 1].get_pixmap(dpi=300, colorspace=pymupdf.csGRAY, clip=clip).save(png)
        try:
            saida = subprocess.run([os.environ.get("MARGEM_TESSERACT", "tesseract"), str(png), "-", "--psm", "7", "-c", "tessedit_char_whitelist=0123456789ABCDEFGHIJ."],
                                   capture_output=True, text=True, env={**os.environ, "OMP_THREAD_LIMIT": "1"}).stdout.strip()
        except FileNotFoundError:
            return ""
    guardado.write_text(saida, encoding="utf-8")
    return saida


def margens_da_regiao(documento: pymupdf.Document, linhas: list[tuple[dict, dict]], colunas: dict, cache: Path) -> dict[int, dict]:
    """Para cada faixa com número não lido: o número da margem, ou `parte` quando é uma etapa com letra
    ("A.", "B.", … em sequência de pelo menos duas, que é como um exercício se divide em etapas)."""
    candidatas = []
    for pagina, faixa in linhas:
        coluna = colunas.get(pagina["pagina"])
        if coluna is None or not saliente(faixa, coluna, pagina["largura"]) or inicio_do_texto(faixa) is None:
            continue
        if RE_NUMERO.match(faixa["texto"]) or RE_UM_MAL_LIDO.match(faixa["texto"]):
            continue
        candidatas.append((faixa, ler_margem(documento, pagina, faixa, coluna, cache)))
    margens: dict[int, dict] = {}
    for indice, (faixa, lido) in enumerate(candidatas):
        digitos = re.match(r"^(\d{1,2})\.?$", lido)
        # A borda da primeira letra do texto às vezes entra no recorte ("A.I"): vale o começo.
        margens[id(faixa)] = {"numero": int(digitos.group(1)) if digitos else None, "letra": lido[0] if re.match(r"^[A-J](\.|$)", lido) else None}
    letras = [margens[id(f)]["letra"] for f, _ in candidatas]
    for indice, (faixa, _) in enumerate(candidatas):
        letra = letras[indice]
        if letra is None:
            continue
        anterior = letras[indice - 1] if indice > 0 else None
        seguinte = letras[indice + 1] if indice + 1 < len(letras) else None
        if anterior is not None and ord(letra) == ord(anterior) + 1 or seguinte is not None and ord(seguinte) == ord(letra) + 1:
            margens[id(faixa)]["parte"] = True
    return margens


_DOCUMENTO: pymupdf.Document | None = None


def _abrir(caminho: str) -> None:
    global _DOCUMENTO
    _DOCUMENTO = pymupdf.open(caminho)


def _ler(pedido: tuple[int, str]) -> dict:
    assert _DOCUMENTO is not None
    return ler_pagina(_DOCUMENTO, pedido[0], Path(pedido[1]))


def descobrir(caminho: str, cache: Path) -> dict:
    cache.mkdir(parents=True, exist_ok=True)
    with pymupdf.open(caminho) as documento:
        total = documento.page_count
    # Um processo por núcleo (o pymupdf não divide o documento entre threads), cada um com o PDF aberto uma vez.
    with ProcessPoolExecutor(max_workers=int(os.environ.get("MARGEM_OCR_PARALELO", "6")), initializer=_abrir, initargs=(caminho,)) as poucos:
        paginas = list(poucos.map(_ler, [(numero, str(cache)) for numero in range(1, total + 1)], chunksize=4))
    alturas = [p[3] - p[1] for pg in paginas for p in pg["palavras"] if p[5] > 60 and sum(ch.isalpha() for ch in p[4]) >= 3]
    mediana = statistics.median(alturas) if alturas else 20.0
    aberturas = {pg["pagina"]: a for pg in paginas if (a := abertura_de_capitulo(pg, mediana))}
    # Capítulo sem número legível: o do seguinte menos um.
    ordem = sorted(aberturas)
    for i in range(len(ordem) - 2, -1, -1):
        atual, seguinte = aberturas[ordem[i]], aberturas[ordem[i + 1]]
        if atual["numero"] is None and seguinte["numero"] is not None and seguinte["numero"] > 1:
            atual["numero"] = seguinte["numero"] - 1

    documento = pymupdf.open(caminho)
    exercicios: list[dict] = []
    capitulos_usados: list[dict] = []
    i = 0
    while i < len(paginas):
        pg = paginas[i]
        titulo = next((j for j, f in enumerate(pg["faixas"]) if RE_EXERCICIOS.match(f["texto"])), None)
        if titulo is None or pagina_de_sumario(pg):
            i += 1
            continue
        capitulo = next((aberturas[p] for p in sorted(aberturas, reverse=True) if p <= pg["pagina"]), None)
        nome_do_capitulo = None
        if capitulo:
            nome_do_capitulo = f"Capítulo {capitulo['numero']} · {capitulo['titulo']}" if capitulo["numero"] else capitulo["titulo"]
            capitulos_usados.append(capitulo)
        # A região: do título até a página antes da próxima abertura de capítulo.
        fim = next((p for p in sorted(aberturas) if p > pg["pagina"]), total + 1)
        linhas = [(pg, f) for f in pg["faixas"][titulo + 1:]]
        for outra in paginas[i + 1: fim - 1]:
            linhas += [(outra, f) for f in outra["faixas"]]
        # A coluna do texto muda entre páginas pares e ímpares (o escâner): uma por página, e a da página
        # de mesma paridade mais perto quando a página não tem número lido.
        colunas = {}
        for pagina in {id(p): p for p, _ in linhas}.values():
            colunas[pagina["pagina"]] = coluna_do_texto([f for p, f in linhas if p is pagina], pagina["largura"])
        for numero in list(colunas):
            if colunas[numero] is None:
                vizinhas = sorted((abs(n - numero), c) for n, c in colunas.items() if c is not None and (n - numero) % 2 == 0)
                colunas[numero] = vizinhas[0][1] if vizinhas else None
        margens = margens_da_regiao(documento, linhas, colunas, cache)
        secao, esperado, atual = None, 1, None
        for pagina, faixa in linhas:
            achado = RE_SECAO.match(faixa["texto"])
            if cabecalho_ou_rodape(faixa, pagina) and not achado:
                continue
            if achado:
                # O ℝ de quadro-negro sai "R", "IR" ou "RR" no OCR.
                titulo_da_secao = re.sub(r"^(?:IR|RR|R)(?=\s)", "ℝ", achado.group(2))
                secao, esperado, atual = corrigir_ocr(f"Seção {achado.group(1)}: {titulo_da_secao}"), 1, None
                continue
            item = numero_do_item(faixa, esperado, pagina["largura"], colunas[pagina["pagina"]], margens.get(id(faixa)))
            if item:
                atual = {"capitulo": nome_do_capitulo, "secao": secao, "numero": str(item[0]), "ordem": len(exercicios),
                         "leitura": item[1], "faixas": []}
                exercicios.append(atual)
                esperado = item[0] + 1
            if atual is not None:
                atual["faixas"].append((pagina, faixa))
        i = max(i + 1, fim - 1)

    documento.close()

    saida = []
    for ex in exercicios:
        partes, textos = [], []
        for pagina, faixa in ex.pop("faixas"):
            textos.append(faixa["texto"])
            w, h = pagina["largura"], pagina["altura"]
            if partes and partes[-1]["pagina"] == pagina["pagina"]:
                caixa = partes[-1]["px"]
                caixa[1], caixa[2], caixa[3] = min(caixa[1], faixa["esq"]), faixa["y1"], max(caixa[3], faixa["dir"])
            else:
                partes.append({"pagina": pagina["pagina"], "px": [faixa["y0"], faixa["esq"], faixa["y1"], faixa["dir"]], "w": w, "h": h})
        for parte in partes:
            y0, x0, y1, x1 = parte.pop("px")
            w, h = parte.pop("w"), parte.pop("h")
            x0, y0 = max(0, x0 - w * 0.012), max(0, y0 - h * 0.008)
            x1, y1 = min(w, x1 + w * 0.012), min(h, y1 + h * 0.008)
            parte.update({"x": round(x0 / w, 5), "y": round(y0 / h, 5), "largura": round((x1 - x0) / w, 5), "altura": round((y1 - y0) / h, 5)})
        saida.append({**ex, "partes": partes, "texto": corrigir_ocr_linhas(textos)})
    vistos = {c["pagina"]: c for c in capitulos_usados}
    return {"paginas": total, "fonte": "ocr" if any(p["fonte"] == "ocr" for p in paginas) else "texto",
            "capitulos": [vistos[p] for p in sorted(vistos)], "exercicios": saida}


def corrigir_ocr_linhas(textos: list[str]) -> str:
    return "\n".join(corrigir_ocr(t) for t in textos if t.strip())


def pagina_de_sumario(pagina: dict) -> bool:
    capitulos = sum(1 for f in pagina["faixas"] if re.match(r"^\W{0,2}\w{0,2}ap[ií]\w{0,2}ulo\s+\d", f["texto"]))
    return capitulos >= 2


# ------------------------------------------------------------------ recortes

def recortar(caminho: str, saida: Path, pedido: list[dict]) -> None:
    saida.mkdir(parents=True, exist_ok=True)
    with pymupdf.open(caminho) as documento:
        for item in pedido:
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", item["chave"]):
                sys.exit(f"chave inválida: {item['chave']!r}")
            pedacos = []
            for parte in item["partes"]:
                pagina = documento[parte["pagina"] - 1]
                r = pagina.rect
                clip = pymupdf.Rect(r.x0 + parte["x"] * r.width, r.y0 + parte["y"] * r.height,
                                    r.x0 + (parte["x"] + parte["largura"]) * r.width, r.y0 + (parte["y"] + parte["altura"]) * r.height)
                pedacos.append(pagina.get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY, clip=clip))
            largura = max(p.width for p in pedacos)
            altura = sum(p.height for p in pedacos)
            folha = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, largura, altura), False)
            folha.clear_with(255)
            y = 0
            for p in pedacos:
                p.set_origin(0, y)
                folha.copy(p, p.irect)
                y += p.height
            folha.save(saida / f"{item['chave']}.png")


def principal(argumentos: list[str]) -> None:
    """A linha de comando, também chamada pelo motor congelado (`margem-motor exercicios …`, J114): importado
    como módulo, o pool de processos acha `_abrir` e `_ler` pelo nome do módulo, inclusive no `spawn` do
    macOS e do Windows."""
    if len(argumentos) != 3 or argumentos[0] not in ("descobrir", "recortar"):
        sys.exit(__doc__)
    if argumentos[0] == "descobrir":
        # Protocolo por pipe em UTF-8, independente da codepage do sistema (W-03).
        sys.stdout.buffer.write(json.dumps(descobrir(argumentos[1], Path(argumentos[2])), ensure_ascii=False).encode("utf-8"))
        sys.stdout.flush()
    else:
        recortar(argumentos[1], Path(argumentos[2]), json.loads(sys.stdin.buffer.read().decode("utf-8")))


if __name__ == "__main__":
    principal(sys.argv[1:])
