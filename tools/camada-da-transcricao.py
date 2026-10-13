"""Camada de texto invisível sobre um PDF escaneado, com o texto de uma transcrição por visão.

Para cada página: acha as linhas de tinta na imagem, alinha (programação dinâmica) com as
linhas transcritas, acha as palavras pelos vãos e grava cada palavra transcrita, invisível
(Tr 3), sobre a caixa dela. O tamanho informado da fonte fica fixo por tipo de bloco.

Uso: python tools/camada-da-transcricao.py ORIGINAL.pdf PASTA_DA_TRANSCRICAO SAIDA.pdf
A transcrição é a do job `transcrever_escaneado` do worker (paginas/NNN.json com blocos por tipo
e quebras de linha; prompts/transcrever-pagina@1), ou outra no mesmo formato. Página sem NNN.json fica como está. Precisa de
numpy e pymupdf (o motor/.venv não tem numpy: o worker usa MARGEM_PYTHON_CAMADA).
"""
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import pymupdf

ORIGEM, TRANSCRICAO, SAIDA = sys.argv[1], Path(sys.argv[2]), sys.argv[3]

# tipo → (fonte, tamanho informado em pt)
ESTILO = {
    "capitulo": ("serifb", 22), "secao": ("serifb", 15), "subsecao": ("serifb", 12.5),
    "paragrafo": ("serif", 10), "lista": ("serif", 10), "epigrafe": ("serifi", 9),
    "legenda": ("serifi", 9), "codigo": ("mono", 8.5), "nota_rodape": ("serif", 8.5),
    "cabecalho": ("serif", 8.5), "rodape": ("serif", 8.5),
}
ARQUIVOS = {
    "serif": "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    "serifb": "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "serifi": "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
    "mono": "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
}
FONTES = {n: pymupdf.Font(fontfile=f) for n, f in ARQUIVOS.items()}


def linhas_transcritas(blocos):
    saida = []
    for b in blocos:
        texto, tipo = b["texto"], b["tipo"]
        linhas = [l.strip() for l in texto.split("\n") if l.strip()]
        # Rótulos internos de diagrama e tabelas linearizadas não seguem as linhas da imagem:
        # viram um marcador que absorve as linhas de tinta da figura, sem gravar texto.
        if (tipo == "legenda" and not re.match(r"^(Figura|Tabela|Exemplo)\s*\d", texto)) or \
                (tipo not in ("cabecalho", "rodape") and len(linhas) > 1
                 and sum(" | " in l for l in linhas) >= max(1, len(linhas) // 3)):
            saida.append(("figura", ""))
            continue
        saida += [(tipo, l) for l in linhas]
    return saida


def linhas_de_tinta(cinza):
    h, w = cinza.shape
    tinta = cinza < 140
    mx, my = int(w * .03), int(h * .02)
    tinta[:my] = tinta[h - my:] = False
    tinta[:, :mx] = tinta[:, w - mx:] = False
    por_linha = tinta.sum(1)
    ativos = por_linha[por_linha > 0]
    limiar = max(2, .05 * np.percentile(ativos, 90)) if len(ativos) else 2
    faixas, y = [], 0
    while y < h:
        if por_linha[y] > limiar:
            y0 = y
            while y < h and por_linha[y] > limiar:
                y += 1
            faixas.append([y0, y])
        y += 1
    if not faixas:
        return []
    alturas = sorted(f[1] - f[0] for f in faixas)
    tipica = alturas[len(alturas) // 2]
    # Acentos e pingos soltos colam na linha de baixo; fragmentos baixos colam na de cima.
    unidas = []
    for f in faixas:
        if unidas and f[0] - unidas[-1][1] <= 3 and (
                f[1] - f[0] < tipica * .45 or unidas[-1][1] - unidas[-1][0] < tipica * .45):
            unidas[-1][1] = f[1]
        else:
            unidas.append(f)
    saida = []
    for y0, y1 in unidas:
        colunas = tinta[y0:y1].sum(0) > 0
        xs = np.flatnonzero(colunas)
        if len(xs) == 0 or y1 - y0 < 4:
            continue
        # Manchas na margem (sujeira, verso transparecendo): grupo estreito e isolado na ponta sai.
        altura = y1 - y0
        bruto = {"x0": int(xs[0]), "x1": int(xs[-1]) + 1, "colunas": colunas.copy()}
        grupos = np.split(xs, np.flatnonzero(np.diff(xs) > altura * 1.5) + 1)
        while len(grupos) > 1 and grupos[0][-1] - grupos[0][0] < altura * 2:
            colunas[grupos[0][0]:grupos[0][-1] + 1] = False
            grupos.pop(0)
        while len(grupos) > 1 and grupos[-1][-1] - grupos[-1][0] < altura * 2:
            colunas[grupos[-1][0]:grupos[-1][-1] + 1] = False
            grupos.pop()
        xs = np.concatenate(grupos)
        saida.append({"y0": y0, "y1": y1, "x0": int(xs[0]), "x1": int(xs[-1]) + 1, "colunas": colunas,
                      "bruto": bruto})
    return saida


MARCADORES = {"•", "·", "▪", "◦", "–", "-", "❶", "❷", "❸", "❹"}
CORRIDO = 110  # linha transcrita mais longa que isso é parágrafo sem quebras
FATOR = {"capitulo": 1.5, "secao": 1.5, "subsecao": 1.15}


def alinhar(tinta, texto):
    """Pares (ink0, ink1, j): a linha transcrita j cobre as linhas de tinta ink0..ink1-1."""
    n, m = len(tinta), len(texto)
    if not n or not m:
        return [], 1
    larguras = [t["x1"] - t["x0"] for t in tinta]
    razoes = sorted(larguras)
    cheia = razoes[int(len(razoes) * .9)]
    altura = sorted(t["y1"] - t["y0"] for t in tinta)[len(tinta) // 2]
    # contigua[i]: a linha i vem logo depois da i-1, sem salto de parágrafo/cabeçalho.
    contigua = [False] + [tinta[i]["y0"] - tinta[i - 1]["y1"] <= altura * .9 for i in range(1, n)]
    comprimentos = sorted(min(len(l), 95) for t, l in texto if t != "figura") or [60]
    k = razoes[len(razoes) * 3 // 4] / max(1, comprimentos[len(comprimentos) * 3 // 4])
    for _ in range(3):
        custo = np.full((n + 1, m + 1), np.inf)
        passo = {}
        custo[0, :] = np.arange(m + 1) * .9
        custo[:, 0] = np.arange(n + 1) * .6
        for i in range(1, n + 1):
            for j in range(1, m + 1):
                tipo, l = texto[j - 1]
                esperado = len(l) * k * FATOR.get(tipo, 1)
                melhor, escolha = custo[i - 1, j] + .6, ("pula_tinta",)
                if custo[i, j - 1] + .9 < melhor:
                    melhor, escolha = custo[i, j - 1] + .9, ("pula_texto",)
                if tipo == "figura":
                    for r in range(0, min(i, 40) + 1):
                        c = custo[i - r, j - 1] + .1 * r + (.5 if r == 0 else 0)
                        if c < melhor:
                            melhor, escolha = c, ("figura", r)
                    custo[i, j] = melhor
                    passo[i, j] = escolha
                    continue
                maximo = min(i, 25) if len(l) > CORRIDO else 1
                soma = 0
                for r in range(1, maximo + 1):
                    soma += larguras[i - r]
                    # A linha i-r entra na corrida: se não for a última, vai até a margem e cola na seguinte.
                    if r > 1 and (larguras[i - r] < cheia * .85 or not contigua[i - r + 1]):
                        break
                    # Numa corrida, todas as linhas menos a última vão até a margem.
                    c = min(abs(math.log(soma / max(esperado, 1))), 2.5) + .05 * (r - 1)
                    if custo[i - r, j - 1] + c < melhor:
                        melhor, escolha = custo[i - r, j - 1] + c, ("casa", r)
                custo[i, j] = melhor
                passo[i, j] = escolha
        pares, i, j = [], n, m
        while i and j:
            escolha = passo[i, j]
            if escolha[0] == "figura":
                i, j = i - escolha[1], j - 1
            elif escolha[0] == "casa":
                pares.append((i - escolha[1], i, j - 1))
                i, j = i - escolha[1], j - 1
            elif escolha[0] == "pula_tinta":
                i -= 1
            else:
                j -= 1
        pares.reverse()
        corpo = [sum(larguras[a:b]) / max(1, len(texto[j][1])) for a, b, j in pares
                 if texto[j][0] == "paragrafo" and len(texto[j][1]) > 40]
        if corpo:
            k = float(np.median(corpo))
    return pares, k


def caixas_naturais(linha):
    colunas = linha["colunas"]
    x0, x1 = linha["x0"], linha["x1"]
    limiar = max(3, (linha["y1"] - linha["y0"]) * .16)
    caixas, inicio, vazio = [], x0, 0
    for x in range(x0, x1 + 1):
        if x < x1 and colunas[x]:
            if vazio >= limiar and x - vazio > inicio:
                caixas.append([inicio, x - vazio])
                inicio = x
            vazio = 0
        else:
            vazio += 1
    caixas.append([inicio, x1])
    return caixas


def distribuir(linhas, palavras, k):
    """Palavras de um parágrafo corrido → [(linha, palavra_escrita, x0, x1)], com hifenização."""
    caixas = [(li, c0, c1) for li, linha in enumerate(linhas) for c0, c1 in caixas_naturais(linha)]
    B, W = len(caixas), len(palavras)
    esp = [max(1, len(p)) * k for p in palavras]
    INF = float("inf")
    custo = [[INF] * (W + 1) for _ in range(B + 1)]
    volta = [[None] * (W + 1) for _ in range(B + 1)]
    custo[0][0] = 0
    lg = lambda a, b: min(abs(math.log(max(a, .5) / max(b, .5))), 3)
    for i in range(B + 1):
        for j in range(W + 1):
            base = custo[i][j]
            if base == INF:
                continue
            def tenta(ni, nj, c, op):
                if ni <= B and nj <= W and base + c < custo[ni][nj]:
                    custo[ni][nj] = base + c
                    volta[ni][nj] = (i, j, op)
            if i < B and j < W:
                li, c0, c1 = caixas[i]
                tenta(i + 1, j + 1, lg(c1 - c0, esp[j]), "1:1")
                if j + 1 < W:
                    tenta(i + 1, j + 2, lg(c1 - c0, esp[j] + esp[j + 1] + k) + .6, "1:2")
                if i + 1 < B:
                    lj, d0, d1 = caixas[i + 1]
                    if lj == li:
                        tenta(i + 2, j + 1, lg(d1 - c0, esp[j]) + .5, "2:1")
                    else:  # hifenização: fim de uma linha + começo da outra
                        tenta(i + 2, j + 1, lg((c1 - c0) + (d1 - d0), esp[j] + k) + .15, "hifen")
            if i < B:
                tenta(i + 1, j, 1.2, "pula_caixa")
            if j < W:
                tenta(i, j + 1, 1.2, "pula_palavra")
    saida, i, j = [], B, W
    while (i, j) != (0, 0):
        pi, pj, op = volta[i][j]
        if op == "1:1":
            li, c0, c1 = caixas[pi]
            saida.append((li, palavras[pj], c0, c1))
        elif op == "1:2":
            li, c0, c1 = caixas[pi]
            a, b = palavras[pj], palavras[pj + 1]
            meio = c0 + (c1 - c0) * len(a) / (len(a) + len(b) + 1)
            saida += [(li, b, meio + (c1 - c0) / (len(a) + len(b) + 1), c1), (li, a, c0, meio)]
        elif op == "2:1":
            li, c0, _ = caixas[pi]
            saida.append((li, palavras[pj], c0, caixas[pi + 1][2]))
        elif op == "hifen":
            (la, a0, a1), (lb, b0, b1) = caixas[pi], caixas[pi + 1]
            p = palavras[pj]
            corte = max(1, min(len(p) - 1, round(len(p) * (a1 - a0) / ((a1 - a0) + (b1 - b0)))))
            saida += [(lb, p[corte:], b0, b1), (la, p[:corte] + "-", a0, a1)]
        i, j = pi, pj
    saida.reverse()
    return saida


def caixas_de_palavras(linha, n):
    colunas = linha["colunas"]
    x0, x1 = linha["x0"], linha["x1"]
    h = linha["y1"] - linha["y0"]
    vaos, dentro, inicio = [], False, x0
    for x in range(x0, x1):
        if not colunas[x] and not dentro:
            dentro, inicio = True, x
        elif colunas[x] and dentro:
            dentro = False
            vaos.append((inicio, x))
    # Vãos maiores que o espaço entre letras, do maior para o menor.
    candidatos = sorted((v for v in vaos if v[1] - v[0] >= max(2, h * .12)), key=lambda v: v[0] - v[1])
    if len(candidatos) >= n - 1:
        escolhidos = sorted(candidatos[:n - 1])
        cortes = [x0] + [c for v in escolhidos for c in v] + [x1]
        return [(cortes[2 * i], cortes[2 * i + 1]) for i in range(n)], True
    return None, False


def proporcionais(linha, palavras):
    x0, x1 = linha["x0"], linha["x1"]
    total = sum(len(p) for p in palavras) + (len(palavras) - 1)
    passo = (x1 - x0) / max(total, 1)
    caixas, x = [], x0
    for p in palavras:
        caixas.append((x, x + len(p) * passo))
        x += (len(p) + 1) * passo
    return caixas


FONTES_NA_PAGINA = {}


def gravar_linha(pagina, itens, base, tipo):
    """itens: [(palavra, x0_pt, x1_pt)] de uma linha de tinta.

    Uma escala horizontal por linha (sx) com o corpo compensado (f = alvo/sqrt(sx)): o tamanho
    informado fica igual ao do tipo e todas as palavras da linha têm a mesma altura. Cada
    palavra leva o espaço seguinte, e só a palavra que ficaria longe demais da próxima (ou por
    cima dela) ganha escala própria: assim a linha é contínua para quem extrai o texto."""
    fonte_nome, alvo = ESTILO.get(tipo, ESTILO["paragrafo"])
    fonte = FONTES[fonte_nome]
    itens = sorted((i for i in itens if i[2] > i[1]), key=lambda t: t[1])
    if not itens:
        return
    naturais = [fonte.text_length(p, fontsize=1) for p, _, _ in itens]
    espaco = fonte.text_length(" ", fontsize=1)
    soma = sum(n for n in naturais)
    raiz_linha = min(max(sum(x1 - x0 for _, x0, x1 in itens) / (alvo * max(soma, 1e-6)), .6), 1.6)
    if fonte_nome not in FONTES_NA_PAGINA.setdefault(pagina.number, set()):
        pagina.insert_font(fontname=fonte_nome, fontfile=ARQUIVOS[fonte_nome])
        FONTES_NA_PAGINA[pagina.number].add(fonte_nome)
    for indice, ((palavra, x0, _), natural) in enumerate(zip(itens, naturais)):
        raiz = raiz_linha
        texto = palavra
        if indice + 1 < len(itens):
            texto += " "
            proxima = itens[indice + 1][1]
            fim = x0 + (natural + espaco) * alvo * raiz
            if proxima - fim > 4 or fim - proxima > 2:
                raiz = min(max((proxima - x0) / ((natural + espaco) * alvo), .5), 4)
        ponto = pymupdf.Point(x0, base)
        pagina.insert_text(ponto, texto, fontsize=alvo / raiz, fontname=fonte_nome, render_mode=3,
                           morph=(ponto, pymupdf.Matrix(raiz * raiz, 1)))


documento = pymupdf.open(ORIGEM)
relatorio = []
for indice, pagina in enumerate(documento):
    numero = indice + 1
    arquivo = TRANSCRICAO / "paginas" / f"{numero:03d}.json"
    # Num PDF misto, só as páginas sem texto foram transcritas: as outras ficam como estão.
    if not arquivo.exists():
        continue
    dados = json.loads(arquivo.read_text())
    texto = linhas_transcritas(dados["pagina"]["blocos"])
    xref = pagina.get_images()[0][0]
    pix = pymupdf.Pixmap(documento, xref)
    if pix.n != 1:
        pix = pymupdf.Pixmap(pymupdf.csGRAY, pix)
    cinza = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, :pix.width]
    rect = pagina.get_image_rects(xref)[0]
    ex, ey = rect.width / pix.width, rect.height / pix.height
    tinta = linhas_de_tinta(cinza)
    pares, k = alinhar(tinta, texto)
    exatas = 0

    def base_de(linha):
        return rect.y0 + (linha["y1"] - (linha["y1"] - linha["y0"]) * .2) * ey

    for a, b, j in pares:
        tipo, conteudo = texto[j]
        palavras = conteudo.split()
        if b - a > 1 or len(conteudo) > CORRIDO:
            por_linha = {}
            for li, palavra, c0, c1 in distribuir(tinta[a:b], palavras, k):
                por_linha.setdefault(li, []).append((palavra, rect.x0 + c0 * ex, rect.x0 + c1 * ex))
            for li, itens in por_linha.items():
                gravar_linha(pagina, itens, base_de(tinta[a + li]), tipo)
            continue
        linha = tinta[a]
        if palavras and palavras[0] in MARCADORES:
            # O marcador é um borrão pequeno e isolado à esquerda: a limpeza de margem o tira.
            linha = {**linha, **linha["bruto"]}
        caixas, exata = caixas_de_palavras(linha, len(palavras))
        exatas += exata
        if not exata:
            caixas = proporcionais(linha, palavras)
        gravar_linha(pagina, [(p, rect.x0 + c0 * ex, rect.x0 + c1 * ex) for p, (c0, c1) in zip(palavras, caixas)],
                     base_de(linha), tipo)
    relatorio.append({"pagina": numero, "linhas_tinta": len(tinta), "linhas_texto": sum(t != "figura" for t, _ in texto),
                      "casadas": sum(texto[j][0] != "figura" for _, _, j in pares), "tinta_usada": sum(b - a for a, b, _ in pares), "palavras_exatas": exatas})
documento.subset_fonts()
documento.save(SAIDA, garbage=3, deflate=True)
json.dump(relatorio, open(SAIDA + ".relatorio.json", "w"), indent=1)
casadas = sum(r["casadas"] for r in relatorio)
total = sum(r["linhas_texto"] for r in relatorio)
exatas = sum(r["palavras_exatas"] for r in relatorio)
total = sum(r["linhas_texto"] for r in relatorio)
print(f"linhas transcritas casadas: {casadas}/{total}; com vãos exatos: {exatas}")
for r in relatorio:
    if r["casadas"] < r["linhas_texto"] * .9:
        print(r)
