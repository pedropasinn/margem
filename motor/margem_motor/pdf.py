"""Extração geométrica de PDF com texto, sem OCR.

Heurísticas reescritas a partir de estudos/leitura-marcada/extrair.py e
limpar.py: fonte predominante, recuo, salto, vocabulário e duplicatas.
Não depende desses scripts em execução.
"""

from bisect import bisect_right
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
import hashlib
from pathlib import Path
import re

import pymupdf

from .blocos import (Bloco, Estilo, Fragmento, anexar_atribuicao, juntar, normalizar_ligaturas,
                     normalizar_ligaturas_do_bloco, unir_bbox)
from .codigo_pdf import compor_codigo
from .ids import identificar
from .sumario_pdf import entradas_elegiveis

FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_PRESERVE_LIGATURES


@dataclass
class Linha:
    bloco: Bloco
    bbox: tuple[float, float, float, float]
    tamanho: float
    negrito: bool
    italico: bool
    mono: bool
    fonte: str
    literal: Bloco | None = None
    # Coluna na página de duas colunas (0 esquerda, 1 direita); -1 sem colunas ou atravessando o vão.
    coluna: int = -1


@dataclass
class Colunas:
    """Duas colunas numa página: o x do vão e as faixas (y0, y1) de linhas que o atravessam
    (título, cabeçalho, figura larga). Entre duas faixas, lê-se a coluna esquerda inteira e depois a
    direita; as faixas ficam no lugar delas."""
    corte: float
    faixas: list[tuple[float, float]]

    def coluna(self, bbox) -> int:
        if bbox[2] <= self.corte:
            return 0
        if bbox[0] >= self.corte:
            return 1
        return -1

    def chave(self, bbox, coluna: int | None = None) -> tuple:
        coluna = self.coluna(bbox) if coluna is None else coluna
        if coluna < 0:
            # A faixa que contém o topo (ou a seguinte, se cair entre faixas).
            indice = next((i for i, (y0, y1) in enumerate(self.faixas) if bbox[1] < y1), len(self.faixas))
            return (2 * indice + 1, 0, round(bbox[1]), bbox[0])
        # Segmento: quantas faixas terminam acima do topo da linha.
        segmento = bisect_right([y1 for _, y1 in self.faixas], bbox[1] + 1)
        return (2 * segmento, coluna, round(bbox[1]), bbox[0])


def detectar_colunas(linhas: list[Linha], largura: float) -> Colunas | None:
    """Detecta duas colunas pelo vão vertical: o x, perto do meio da página, que menos linhas
    atravessam. Só aceita quando quase nada o atravessa e cada lado tem texto de verdade (várias
    linhas, largura de coluna, os dois lados lado a lado na altura). Página de uma coluna, listagem de
    código ou tabela solta não passam."""
    if len(linhas) < 12 or largura <= 0:
        return None
    inicio, fim = int(largura * .3), int(largura * .7)
    cruzam = [sum(1 for l in linhas if l.bbox[0] < x - .5 and l.bbox[2] > x + .5) for x in range(inicio, fim + 1)]
    minimo = min(cruzam)
    if minimo > len(linhas) * .2:
        return None
    # O trecho mais largo com (quase) o mínimo de travessias é o vão; o corte fica no meio dele. A
    # folga deixa um número de página ou uma palavra de título centrados não estreitarem o vão.
    teto = minimo + max(1, len(linhas) // 50)
    melhor, atual = (0, 0), None
    for indice, valor in enumerate(cruzam + [teto + 1]):
        if valor <= teto:
            atual = indice if atual is None else atual
        elif atual is not None:
            if indice - atual > melhor[1] - melhor[0]:
                melhor = (atual, indice)
            atual = None
    if melhor[1] - melhor[0] < 4:
        return None
    corte = inicio + (melhor[0] + melhor[1] - 1) / 2
    lados = ([l for l in linhas if l.bbox[2] <= corte], [l for l in linhas if l.bbox[0] >= corte])
    total = sum(len(l.bloco.texto) for l in linhas)
    for lado in lados:
        larguras = sorted(l.bbox[2] - l.bbox[0] for l in lado)
        if (len(lado) < 5 or sum(len(l.bloco.texto) for l in lado) < total * .2
                or larguras[len(larguras) // 2] < largura * .25):
            return None
    alturas = [(min(l.bbox[1] for l in lado), max(l.bbox[3] for l in lado)) for lado in lados]
    sobreposicao = min(alturas[0][1], alturas[1][1]) - max(alturas[0][0], alturas[1][0])
    if sobreposicao < .5 * min(a[1] - a[0] for a in alturas):
        return None
    # Faixas: as linhas que atravessam o corte e as que dividem a altura com elas (palavras de um
    # título partido pelo vão), unidas quando se tocam.
    faixas: list[list[float]] = []
    for l in sorted((l for l in linhas if l.bbox[0] < corte < l.bbox[2]), key=lambda l: l.bbox[1]):
        if faixas and l.bbox[1] <= faixas[-1][1]:
            faixas[-1][1] = max(faixas[-1][1], l.bbox[3])
        else:
            faixas.append([l.bbox[1], l.bbox[3]])
    return Colunas(corte, [(a, b) for a, b in faixas])


def _emendar(destino: Bloco, proximo: Bloco) -> None:
    """Põe `proximo` no fim de `destino`, separado por espaço, cada pedaço com a sua geometria."""
    deslocamento = len(destino.texto) + 1
    destino.texto += " " + proximo.texto
    destino.estilos.extend(Estilo(e.inicio + deslocamento, e.fim + deslocamento, e.estilo, e.ref) for e in proximo.estilos)
    destino.fragmentos.extend(Fragmento(deepcopy(f.origem), f.inicio + deslocamento, f.fim + deslocamento)
                              for f in proximo.fragmentos)
    destino.chamadas.extend((i + deslocamento, f + deslocamento, n, p) for i, f, n, p in proximo.chamadas)


def unir_pedacos_da_linha(linhas: list[Linha]) -> list[Linha]:
    """Regra `linha_partida_no_ocr`: a camada de OCR de revistas escaneadas parte uma linha em grupos de
    palavras ("rangements," "as between" "employer and"), cada um com a sua altura. Na mesma coluna,
    pedaços na mesma altura, do mesmo tamanho e colados na horizontal voltam a ser uma linha."""
    restantes = sorted(linhas, key=lambda l: ((l.bbox[1] + l.bbox[3]) / 2, l.bbox[0]))
    fileiras: list[list[Linha]] = []
    for linha in restantes:
        meio = (linha.bbox[1] + linha.bbox[3]) / 2
        alvo = next((f for f in reversed(fileiras[-4:]) if f[0].coluna == linha.coluna
                     and abs((f[0].bbox[1] + f[0].bbox[3]) / 2 - meio) <= (linha.bbox[3] - linha.bbox[1]) * .4), None)
        if alvo is None:
            fileiras.append([linha])
        else:
            alvo.append(linha)
    unidas = []
    for fileira in fileiras:
        fileira.sort(key=lambda l: l.bbox[0])
        atual = fileira[0]
        for proxima in fileira[1:]:
            vao = proxima.bbox[0] - atual.bbox[2]
            if (not atual.mono and not proxima.mono and atual.literal is not None and proxima.literal is not None
                    and -atual.tamanho * 1.5 <= vao <= max(atual.tamanho, proxima.tamanho) * 1.5
                    and proxima.bbox[0] > (atual.bbox[0] + atual.bbox[2]) / 2
                    and abs(proxima.tamanho - atual.tamanho) <= max(atual.tamanho, proxima.tamanho) * .2
                    and not re.fullmatch(r"\d+", atual.bloco.texto) and not re.fullmatch(r"\d+", proxima.bloco.texto)):
                _emendar(atual.bloco, proxima.bloco)
                _emendar(atual.literal, proxima.literal)
                atual.bbox = tuple(unir_bbox(atual.bbox, proxima.bbox))
                atual.tamanho = max(atual.tamanho, proxima.tamanho)
            else:
                unidas.append(atual)
                atual = proxima
        unidas.append(atual)
    return unidas


def ordenar_por_colunas(linhas: list[Linha], largura: float, escaneada: bool = False) -> tuple[list[Linha], Colunas | None]:
    """Ordem de leitura das linhas da página: (y, x) numa coluna; coluna por coluna em duas. Em página
    escaneada, os pedaços de uma mesma linha do OCR são unidos antes (dentro da coluna)."""
    colunas = detectar_colunas(linhas, largura)
    if colunas is not None:
        for l in linhas:
            meio = (l.bbox[1] + l.bbox[3]) / 2
            na_faixa = any(y0 <= meio <= y1 for y0, y1 in colunas.faixas)
            l.coluna = -1 if na_faixa else colunas.coluna(l.bbox)
    if escaneada:
        linhas = unir_pedacos_da_linha(linhas)
    if colunas is None:
        return sorted(linhas, key=lambda l: (round(l.bbox[1]), l.bbox[0])), None
    return sorted(linhas, key=lambda l: colunas.chave(l.bbox, l.coluna)), colunas


def linhas_pagina(pagina, numero: int, observacoes: list[dict] | None = None) -> tuple[list[Linha], Colunas | None]:
    linhas = []
    for grupo in pagina.get_text("dict", flags=FLAGS)["blocks"]:
        if grupo["type"] != 0:
            continue
        for linha in grupo["lines"]:
            spans = linha["spans"]
            bruto = "".join(s["text"] for s in spans)
            if observacoes is not None:
                observacoes.append({"pagina": numero, "ordem": len(observacoes), "texto": bruto,
                    "bbox": list(linha["bbox"]), "spans": [
                        {"texto": p["text"], "bbox": list(p["bbox"]), "fonte": p["font"],
                         "tamanho": p["size"], "flags": p["flags"]} for p in spans]})
            texto = bruto.strip()
            if not texto:
                continue
            corte = len(bruto) - len(bruto.lstrip())
            estilos = []
            estilos_literais = []
            chamadas = []
            posicao = 0
            pesos = Counter()
            for span in spans:
                inicio = max(0, posicao - corte)
                posicao += len(span["text"])
                fim = min(len(texto), posicao - corte)
                if fim <= inicio:
                    continue
                fonte = span["font"].lower()
                for nome, detectado in (
                    ("italico", span["flags"] & 2 or "italic" in fonte or "oblique" in fonte),
                    ("negrito", span["flags"] & 16 or "bold" in fonte),
                    ("codigo", span["flags"] & 8 or "mono" in fonte or "courier" in fonte),
                ):
                    if detectado:
                        estilos.append(Estilo(inicio, fim, nome))
                        estilos_literais.append(Estilo(posicao - len(span["text"]), posicao, nome))
                        pesos[nome] += fim - inicio
                if span["flags"] & 1:
                    for chamada in re.finditer(r"\d+", texto[inicio:fim]):
                        chamadas.append((inicio + chamada.start(), inicio + chamada.end(), chamada[0], numero))
            tamanho = max(s["size"] for s in spans if s["text"].strip())
            bbox = tuple(max(0, float(v)) for v in linha["bbox"])
            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                continue
            origem = {"tipo": "pdf", "pagina": numero, "bbox": list(bbox)}
            bloco = Bloco("paragrafo", texto, estilos, [Fragmento(origem, 0, len(texto))],
                          tamanho=tamanho, chamadas=chamadas)
            literal = Bloco("codigo", bruto, estilos_literais,
                            [Fragmento(dict(origem), 0, len(bruto))], tamanho=tamanho)
            linhas.append(Linha(bloco, bbox, tamanho, pesos["negrito"] > len(texto) / 2,
                                pesos["italico"] > len(texto) / 2, pesos["codigo"] > len(texto) / 2,
                                max(spans, key=lambda s: len(s["text"]))["font"], literal))
    # Alguns PDFs emitem o sobrescrito como linha separada: reunir por geometria.
    removidas = set()
    for indice, chamada in enumerate(linhas):
        if not re.fullmatch(r"\d+", chamada.bloco.texto):
            continue
        candidatas = [l for l in linhas if chamada.tamanho < l.tamanho * .75
                      and -2 <= chamada.bbox[0] - l.bbox[2] <= l.tamanho
                      and l.bbox[1] - l.tamanho < chamada.bbox[1] < l.bbox[3] - l.tamanho * .4]
        if len(candidatas) == 1:
            alvo = candidatas[0]
            inicio = len(alvo.bloco.texto)
            alvo.bloco.texto += chamada.bloco.texto
            alvo.bloco.chamadas.append((inicio, len(alvo.bloco.texto), chamada.bloco.texto, numero))
            # A observação usada pelo compositor literal deve conservar também
            # a linha retirada. Cada fragmento mantém sua própria geometria.
            if alvo.literal is not None and chamada.literal is not None:
                deslocamento = len(alvo.literal.texto)
                alvo.literal.texto += chamada.literal.texto
                alvo.literal.estilos.extend(Estilo(e.inicio + deslocamento, e.fim + deslocamento, e.estilo, e.ref)
                                             for e in chamada.literal.estilos)
                alvo.literal.fragmentos.extend(Fragmento(deepcopy(f.origem), f.inicio + deslocamento, f.fim + deslocamento)
                                                for f in chamada.literal.fragmentos)
            alvo.bbox = tuple(unir_bbox(alvo.bbox, chamada.bbox))
            alvo.bloco.fragmentos[0].origem["bbox"] = list(alvo.bbox)
            alvo.bloco.fragmentos[0].fim = len(alvo.bloco.texto)
            removidas.add(indice)
    # Página escaneada: uma imagem cobre a página e o texto é a camada do OCR.
    area = pagina.rect.width * pagina.rect.height
    escaneada = any(pymupdf.Rect(i["bbox"]).get_area() >= area * .9 for i in pagina.get_image_info())
    return ordenar_por_colunas([l for i, l in enumerate(linhas) if i not in removidas], pagina.rect.width, escaneada)


def eh_atribuicao(linha: Linha, anterior: Linha | None, corpo: float) -> bool:
    """Regra `atribuicao_de_epigrafe`: linha curta logo abaixo da epígrafe, sem numeração,
    alinhada com ela ou à direita, em estilo diferente (negrito, itálico, versalete)."""
    if anterior is None:
        return False
    texto = linha.bloco.texto
    curta = len(texto) <= 60 and len(texto.split()) <= 8
    numerada = re.match(r"^(?:\d+|[IVXLC]+)[.)]?\s", texto) is not None
    logo_abaixo = 0 <= linha.bbox[1] - anterior.bbox[3] <= corpo * 1.6
    alinhada = linha.bbox[0] >= anterior.bbox[0] - 2
    a_direita = linha.bbox[2] >= anterior.bbox[2] - 2 and linha.bbox[0] > anterior.bbox[0] + corpo
    versalete = texto.isupper() and linha.tamanho < corpo * 1.1
    # O autor se distingue da epígrafe pelo estilo; outra linha no mesmo estilo continua a epígrafe.
    destaque = (linha.negrito != anterior.negrito or linha.italico != anterior.italico
                or versalete or a_direita)
    return curta and not numerada and logo_abaixo and alinhada and destaque and linha.tamanho < corpo * 1.8


def eh_epigrafe_no_corpo(linha: Linha, locais: list[Bloco], esquerda: float, corpo: float) -> bool:
    """Epígrafe no tamanho do corpo (Panel Data, Difference-in-Differences): itálico, bem recuado,
    logo depois do título do capítulo ou de outra linha de epígrafe."""
    return (linha.italico and bool(locais) and locais[-1].tipo in {"capitulo", "epigrafe"}
            and linha.bbox[0] >= esquerda + corpo * 8 and linha.tamanho < corpo * 1.8)


# Regra `pagina_em_branco_declarada`: o aviso editorial de página vazia não é texto do livro.
_EM_BRANCO = re.compile(
    r"^\W*(?:"
    r"(?:this\s+page\s+(?:is\s+|has\s+been\s+|was\s+)?)?(?:intentionally\s+left|left\s+intentionally)\s+blank"
    r"|(?:esta\s+)?p[áa]gina\s+(?:foi\s+)?(?:(?:intencionalmente|propositalmente|propositadamente)\s+)?"
    r"deixada\s+em\s+branco(?:\s+(?:intencionalmente|propositalmente|propositadamente|de\s+prop[óo]sito))?"
    r"|(?:esta\s+)?p[áa]gina\s+(?:est[áa]\s+|fica\s+)?(?:intencionalmente|propositalmente|propositadamente)\s+em\s+branco"
    r")\W*$", re.I)


def eh_pagina_em_branco_declarada(texto: str) -> bool:
    """`This page intentionally left blank`, `Esta página foi deixada em branco intencionalmente` e variações."""
    return _EM_BRANCO.match(" ".join(texto.split())) is not None


def parece_titulo(texto: str) -> bool:
    """Regra `titulo_plausivel`: um título tem palavras. Linha só de símbolos, números ou
    fórmula (fragmento de equação no OCR: "Di=O =/p<l.", "efb(a)c(a) + k", "_av") e linha de
    tabela ("Bihar 184 50") não são títulos, ainda que em fonte grande. Número de capítulo ou de
    seção isolado ("3", "IV.") continua valendo."""
    t = texto.strip()
    if re.fullmatch(r"(?:\d+|[IVXLCDM]+)\.?", t):
        return True
    # Aspas angulares digitadas (<<Das Categorias>>) não são fórmula.
    if re.search(r"[=<>_|~{}\[\]^\\∑∫√±×÷≤≥•·]|\s[+\-−*/]\s|\s[+\-−*/]$", t.replace("<<", "«").replace(">>", "»")):
        return False
    if not re.search(r"[^\W\d_]{3,}", t):
        return False
    # Título começa em maiúscula (ou número) e não é um parágrafo inteiro: "production function, so
    # production…" em negrito do OCR é corpo de texto.
    primeira = re.search(r"[^\W\d_]", t)
    if primeira and primeira[0].islower() or len(t.split()) > 25:
        return False
    visiveis = [c for c in t if not c.isspace()]
    if sum(c.isalpha() for c in visiveis) < len(visiveis) * .6:
        return False
    # Linha de tabela: um rótulo curto e vários números.
    return not (len(re.findall(r"(?<![\w.])\d[\d.,]*(?![\w])", t)) >= 2 and len(re.findall(r"[^\W\d_]{2,}", t)) <= 2)


def _letras(texto: str) -> str:
    return "".join(c for c in texto.lower() if c.isalpha())


def rebaixar_cabecalho_da_revista(blocos: list[Bloco], titulo: str) -> None:
    """Regra `cabecalho_da_revista`: na primeira página de um artigo, o nome da revista em fonte grande
    ("The American Economic Review") vem acima do título do artigo. O que tem cara de título antes da
    linha com o título do documento, nessa página, volta a ser parágrafo."""
    alvo = _letras(titulo)
    if len(alvo) < 12 or not blocos or not blocos[0].fragmentos:
        return
    pagina = blocos[0].fragmentos[0].origem.get("pagina")
    da_pagina = [b for b in blocos if b.fragmentos and b.fragmentos[0].origem.get("pagina") == pagina]
    for indice, bloco in enumerate(da_pagina):
        letras = _letras(bloco.texto)
        if len(letras) >= 12 and (letras in alvo or alvo[:30] in letras):
            for anterior in da_pagina[:indice]:
                if anterior.tipo in {"capitulo", "secao"}:
                    # Sem tamanho, `titulo_de_abertura` não o promove de volta a título.
                    anterior.tipo, anterior.nivel, anterior.tamanho = "paragrafo", 0, 0
            return


def chave_cabecalho(texto: str) -> str:
    return re.sub(r"\d+", "#", texto).strip()


def regiao_contem(bbox, linha: Linha) -> bool:
    x = (linha.bbox[0] + linha.bbox[2]) / 2
    y = (linha.bbox[1] + linha.bbox[3]) / 2
    return bbox[0] - 2 <= x <= bbox[2] + 2 and bbox[1] - 2 <= y <= bbox[3] + 2


def assinatura_pagina(pagina) -> tuple[bytes, int, int, bytes]:
    pixels = pagina.get_pixmap(dpi=60)
    return (hashlib.sha256(pagina.get_text().encode()).digest(), pixels.width, pixels.height,
            hashlib.sha256(pixels.samples).digest())


def regioes_visuais(pagina) -> list[dict]:
    regioes = []
    tabelas = pagina.find_tables().tables
    for tabela in tabelas:
        regioes.append({"tipo": "tabela", "bbox": list(tabela.bbox)})
    area_pagina = pagina.rect.width * pagina.rect.height
    for imagem in pagina.get_image_info():
        bbox = list(imagem["bbox"])
        # A imagem que cobre a página é o escaneamento, não uma figura: o texto dela vem da
        # camada invisível (OCR ou transcrição) e é corpo do livro.
        if pymupdf.Rect(bbox).get_area() >= area_pagina * .9:
            continue
        if bbox[2] > bbox[0] and bbox[3] > bbox[1]:
            regioes.append({"tipo": "figura", "bbox": bbox})
    for bbox in pagina.cluster_drawings():
        # Traços de rodapé e sublinhados isolados não são figuras.
        if bbox.width <= 3 or bbox.height <= 3:
            continue
        if any(pymupdf.Rect(r["bbox"]).intersects(bbox) for r in regioes):
            continue
        regioes.append({"tipo": "figura", "bbox": list(bbox)})
    return regioes


def extrair_pdf(conteudo: bytes, saida: Path, semente: str,
                paginas: tuple[int, int] | None, proveniencia: dict | None = None) -> tuple[list[Bloco], list[dict], list[dict]]:
    blocos: list[Bloco] = []
    assets = []
    limites = []
    with pymupdf.open(stream=conteudo, filetype="pdf") as documento:
        if documento.needs_pass:
            raise ValueError("PDF protegido por senha não é suportado.")
        inicio, fim = paginas or (1, len(documento))
        if not 1 <= inicio <= fim <= len(documento):
            raise ValueError("Intervalo de páginas fora do PDF.")
        barreiras = {p for _, p in entradas_elegiveis(documento.get_toc()) if inicio <= p <= fim}
        # Vocabulário completo: compostos podem ser testemunhados fora do recorte.
        vocabulario = set()
        for pagina in documento:
            for palavra in pagina.get_text("words", flags=FLAGS):
                termo = palavra[4].strip('.,;:()[]"“”’\'').lower()
                if termo and not termo.endswith("-"):
                    # As duas grafias: o vocabulário casa a palavra com e sem ligatura.
                    vocabulario.update({termo, normalizar_ligaturas(termo)})
        por_pagina: dict[int, list[Linha]] = {}
        colunas_da_pagina: dict[int, Colunas] = {}
        for n in range(inicio, fim + 1):
            por_pagina[n], colunas = linhas_pagina(documento[n - 1], n, proveniencia["observacoes"] if proveniencia is not None else None)
            if colunas is not None:
                colunas_da_pagina[n] = colunas
        assinaturas = {n: assinatura_pagina(documento[n - 1]) for n in por_pagina}
        tamanhos = Counter()
        cabecalhos = Counter()
        # Texto curto nas margens de cima e de baixo, por página e tamanho: o cabeçalho de revista que o
        # OCR lê em fonte grande ("AMERICAN ECONOMIC REVIEW") se repete; o título de capítulo, não.
        nas_faixas: dict[str, list[tuple[int, float]]] = {}
        for numero, linhas in por_pagina.items():
            if numero > inicio and numero not in barreiras and assinaturas[numero] == assinaturas[numero - 1]:
                continue
            altura = documento[numero - 1].rect.height
            vistos = set()
            for linha in linhas:
                if (linha.bbox[1] < altura * .09 or linha.bbox[1] > altura * .92) and len(linha.bloco.texto) <= 80:
                    nas_faixas.setdefault(" ".join(linha.bloco.texto.split()), []).append((numero, linha.tamanho))
                if linha.bbox[1] < altura * .09 or linha.bbox[1] > altura * .92:
                    vistos.add(chave_cabecalho(linha.bloco.texto))
                if altura * .09 <= linha.bbox[1] <= altura * .9:
                    tamanhos[round(linha.tamanho, 1)] += len(linha.bloco.texto)
            cabecalhos.update(vistos)
        corpo = tamanhos.most_common(1)[0][0] if tamanhos else 10

        def corrente_em_fonte_grande(linha: Linha, altura: float) -> bool:
            """Regra `cabecalho_corrente_repetido`: linha curta em tamanho de título, na margem de cima
            ou de baixo (as mesmas do cabeçalho pequeno), com o mesmo texto e tamanho parecido em três páginas ou mais."""
            if not (linha.tamanho >= corpo * 1.14 and (linha.bbox[1] < altura * .09 or linha.bbox[1] > altura * .92)):
                return False
            # Texto exato, sem trocar dígitos: "CHAPTER 1", "CHAPTER 2"… no alto da página são títulos.
            ocorrencias = nas_faixas.get(" ".join(linha.bloco.texto.split()), [])
            return len({n for n, t in ocorrencias if abs(t - linha.tamanho) <= linha.tamanho * .15}) >= 3

        # Níveis por tamanho de título. Um tamanho que só aparece em poucas páginas (capa, folha de
        # rosto) não define um nível próprio: é dobrado no nível do maior tamanho frequente, senão a
        # capa em 36 pt vira o único nível 1 e os capítulos em 28 pt descem para nível 2.
        paginas_por_tamanho: dict[float, set[int]] = {}
        for numero_pagina, ls in por_pagina.items():
            for l in ls:
                if (l.tamanho >= corpo * 1.8 or (l.negrito and l.tamanho >= corpo * 1.14)) and parece_titulo(l.bloco.texto):
                    paginas_por_tamanho.setdefault(round(l.tamanho, 1), set()).add(numero_pagina)
        # Tamanhos quase iguais (27,9 e 28,0 pt) são o mesmo nível: agrupar antes de ranquear.
        grupos: list[list[float]] = []
        for t in sorted(paginas_por_tamanho, reverse=True):
            if grupos and grupos[-1][-1] - t <= max(0.6, t * 0.025):
                grupos[-1].append(t)
            else:
                grupos.append([t])
        def paginas_do_grupo(g: list[float]) -> int:
            return len(set().union(*(paginas_por_tamanho[t] for t in g)))
        frequentes = [g for g in grupos if paginas_do_grupo(g) >= 3] or grupos
        # Se o maior grupo frequente é tamanho de seção (não de capítulo), os tamanhos raros
        # maiores que ele formam um nível próprio acima: um capítulo isolado tem o título uma vez só.
        raros_maiores = [t for g in grupos if g not in frequentes for t in g if t > frequentes[0][0]]
        if raros_maiores and frequentes[0][0] < corpo * 1.8:
            frequentes = [sorted(raros_maiores, reverse=True)] + frequentes
        tamanhos_titulo = [g[0] for g in frequentes]
        pisos = [g[-1] for g in frequentes]

        def nivel_do_tamanho(tamanho: float) -> int:
            for indice, piso in enumerate(pisos):
                if tamanho >= piso - 0.05:
                    return indice + 1
            return max(len(pisos), 1)
        anterior = None
        primeira_ocorrencia = inicio
        ultimo_corpo: Bloco | None = None
        for numero, linhas in por_pagina.items():
            pagina = documento[numero - 1]
            # Reiniciar inclusive se esta página for omitida como duplicata/vazia.
            if numero in barreiras:
                ultimo_corpo = None
            assinatura = assinaturas[numero]
            if assinatura == anterior and numero not in barreiras:
                limites.append({"tipo": "pagina_repetida", "pagina": numero, "primeira": primeira_ocorrencia,
                                "descricao": f"Página PDF {numero} idêntica à {primeira_ocorrencia}; omitida (texto e pixels)."})
                continue
            anterior = assinatura
            primeira_ocorrencia = numero
            altura = pagina.rect.height
            impressa = None
            uteis = []
            for linha in linhas:
                texto = linha.bloco.texto
                margem = linha.bbox[1] < altura * .09 or linha.bbox[1] > altura * .92
                numero_margem = margem and re.fullmatch(r"\d+|[ivxlcdm]+", texto, re.I)
                numero_alinhado = any(re.fullmatch(r"\d+", outra.bloco.texto)
                                      and abs(outra.bbox[1] - linha.bbox[1]) < 2 for outra in linhas)
                corrente = (margem and linha.tamanho < corpo * 1.14 and (
                    cabecalhos[chave_cabecalho(texto)] >= 2 or numero_alinhado)) or corrente_em_fonte_grande(linha, altura)
                if numero_margem:
                    impressa = texto
                elif corrente:
                    rotulo = re.search(r"\b\d+\b", texto)
                    if rotulo:
                        impressa = rotulo[0]
                if not (numero_margem or corrente):
                    uteis.append(linha)
                elif proveniencia is not None:
                    proveniencia["transformacoes"].append({
                        "regra": "numero_pagina" if numero_margem else "cabecalho_heuristica_legada",
                        "pagina": numero, "bbox": list(linha.bbox), "antes": texto, "depois": ""})
            if impressa is None:
                impressa = pagina.get_label() or None
            for linha in uteis:
                if impressa:
                    for fragmento in linha.bloco.fragmentos:
                        fragmento.origem["impressa"] = impressa
            regioes = regioes_visuais(pagina)
            # Tabelas sem grade: legenda explícita seguida de linhas menores que o corpo.
            for indice, linha in enumerate(uteis):
                if re.match(r"^(Table|Tabela)\s*\d", linha.bloco.texto, re.I):
                    bbox = list(linha.bbox)
                    for seguinte in uteis[indice + 1:]:
                        if seguinte.tamanho >= corpo * .96 or seguinte.bbox[1] - bbox[3] > corpo * 4:
                            break
                        bbox = unir_bbox(bbox, seguinte.bbox)
                    if not any(regiao_contem(r["bbox"], linha) for r in regioes):
                        regioes.append({"tipo": "tabela", "bbox": bbox})
            # Listagens numeradas podem usar fontes proporcionais (como no Mixtape).
            numeradas = [l for l in uteis if re.fullmatch(r"\d+", l.bloco.texto) and l.tamanho < corpo]
            linhas_codigo = set()
            if len(numeradas) >= 4 and any(re.search(r"(?:<-|library\(|generate |set seed|clear all)", l.bloco.texto) for l in uteis):
                fontes_codigo = {re.sub(r"[-,](Bold|Regular|Italic).*$", "", l.fonte) for l in numeradas}
                # A fonte pode ser a mesma da prosa. A classificação só vale nas
                # linhas da listagem alinhadas à numeração, nunca na página inteira.
                linhas_codigo = {id(l) for l in uteis
                                 if re.sub(r"[-,](Bold|Regular|Italic).*$", "", l.fonte) in fontes_codigo
                                 and any(abs(l.bbox[1] - n.bbox[1]) < n.tamanho * .3
                                         and l.bbox[0] >= n.bbox[0] for n in numeradas)}
                anterior_codigo = None
                for l in uteis:
                    fonte = re.sub(r"[-,](Bold|Regular|Italic).*$", "", l.fonte)
                    if fonte in fontes_codigo:
                        titulo_listagem = re.fullmatch(r"[\w.-]+\.(?:do|R|r|py|sql|json|js|ts)", l.bloco.texto)
                        if titulo_listagem and any(0 < n.bbox[1] - l.bbox[1] <= n.tamanho * 2
                                                   for n in numeradas):
                            linhas_codigo.add(id(l))
                        # Quebra visual de um comando numerado: continua na mesma
                        # fonte/tamanho e perto da linha anterior, mesmo sem novo número.
                        if (anterior_codigo is not None
                            and abs(l.tamanho - anterior_codigo.tamanho) < l.tamanho * .05
                            and 0 <= l.bbox[1] - anterior_codigo.bbox[1] <= l.tamanho * 1.7
                            and l.bbox[0] >= min(n.bbox[0] for n in numeradas)):
                            linhas_codigo.add(id(l))
                    if id(l) in linhas_codigo:
                        anterior_codigo = l
            # Legendas próximas passam a integrar a figura/tabela, sem texto duplicado.
            for linha in uteis:
                legenda = re.match(r"^(Figure|Fig\.|Figura|Table|Tabela)\s*\d", linha.bloco.texto, re.I)
                if legenda:
                    proximas = [r for r in regioes if -3 <= linha.bbox[1] - r["bbox"][3] <= corpo * 3]
                    if proximas:
                        regiao = min(proximas, key=lambda r: abs(linha.bbox[1] - r["bbox"][3]))
                        regiao["bbox"] = unir_bbox(regiao["bbox"], linha.bbox)
                        for seguinte in uteis[uteis.index(linha) + 1:]:
                            if seguinte.tamanho > corpo * .86 or seguinte.bbox[1] - regiao["bbox"][3] > corpo * 1.5:
                                break
                            regiao["bbox"] = unir_bbox(regiao["bbox"], seguinte.bbox)
                        if legenda[1].lower() in {"table", "tabela"}:
                            regiao["tipo"] = "tabela"
            consumidas = set()
            visuais = []
            for regiao in regioes:
                selecionadas = [(i, l) for i, l in enumerate(uteis) if i not in consumidas and regiao_contem(regiao["bbox"], l)]
                visual = Bloco(regiao["tipo"], "", pagina_asset=numero)
                for i, linha in selecionadas:
                    juntar(visual, linha.bloco, vocabulario)
                    consumidas.add(i)
                bbox = [max(0, v) for v in regiao["bbox"]]
                origem = {"tipo": "pdf", "pagina": numero, "bbox": bbox}
                if impressa:
                    origem["impressa"] = impressa
                visual.fragmentos = [Fragmento(origem, 0, len(visual.texto))]
                visuais.append(visual)
            candidatas = [l for i, l in enumerate(uteis) if i not in consumidas]
            colunas = colunas_da_pagina.get(numero)

            def margens(grupo: list[Linha]) -> tuple[float, float]:
                esquerda = min((l.bbox[0] for l in grupo if abs(l.tamanho - corpo) < corpo * .08), default=36)
                finais = sorted(l.bbox[2] for l in grupo if abs(l.tamanho - corpo) < corpo * .08)
                return esquerda, finais[int(len(finais) * .9)] if finais else 0
            # Em duas colunas, recuo e margem direita contam dentro da coluna de cada linha.
            margens_da_coluna = {-1: margens(candidatas)}
            if colunas is not None:
                for indice in (0, 1):
                    grupo = [l for l in candidatas if l.coluna == indice]
                    if grupo:
                        margens_da_coluna[indice] = margens(grupo)
            locais: list[Bloco] = []
            grupos_codigo: dict[int, list[Linha]] = {}
            regioes_codigo: list[list[int]] = []
            ultima_linha: Linha | None = None
            for linha in candidatas:
                bloco = linha.bloco
                texto = bloco.texto
                esquerda, direita = margens_da_coluna.get(linha.coluna, margens_da_coluna[-1])
                if eh_pagina_em_branco_declarada(texto):
                    limites.append({"tipo": "pagina_em_branco_declarada", "pagina": numero,
                                    "descricao": f"Página PDF {numero}: aviso “{texto.strip()}” omitido (não é texto do livro)."})
                    continue
                recuo = linha.bbox[0] > esquerda + corpo
                salto = ultima_linha is not None and linha.bbox[1] - ultima_linha.bbox[3] > corpo * .9
                atribuicao = False
                if locais and locais[-1].tipo == "epigrafe" and eh_atribuicao(linha, ultima_linha, corpo):
                    bloco.tipo = "epigrafe"
                    atribuicao = True
                elif eh_epigrafe_no_corpo(linha, locais, esquerda, corpo):
                    bloco.tipo = "epigrafe"
                elif linha.tamanho >= corpo * 1.8 or (linha.negrito and linha.tamanho >= corpo * 1.14):
                    bloco.tipo = "capitulo" if linha.tamanho >= corpo * 1.8 else "secao"
                    bloco.nivel = nivel_do_tamanho(round(linha.tamanho, 1))
                elif linha.mono or id(linha) in linhas_codigo:
                    bloco.tipo = "codigo"
                elif linha.tamanho <= corpo * .86 and linha.bbox[1] > altura * .7 and (
                    re.match(r"^\d+\s", texto) or locais and locais[-1].tipo == "nota_rodape"
                ):
                    bloco.tipo = "nota_rodape"
                elif re.search(r"[=∑∫√]", texto) and len(texto) < 80 and recuo and not re.match(r"^\d+[.)]\s", texto):
                    bloco.tipo = "equacao"
                    bloco.pagina_asset = numero
                elif linha.italico and linha.tamanho > corpo * 1.1:
                    bloco.tipo = "epigrafe"
                elif linha.tamanho <= corpo * .86:
                    bloco.tipo = "legenda"
                elif re.match(r"^(?:Figure|Figura|Table|Tabela)\s*\d", texto, re.I):
                    bloco.tipo = "tabela" if texto.lower().startswith(("table", "tabela")) else "figura"
                    bloco.pagina_asset = numero
                bloco.recuo = recuo
                atual = locais[-1] if locais else None
                juntar_linhas = atual is not None and atual.tipo == bloco.tipo
                if bloco.tipo in {"capitulo", "secao"}:
                    # Título em várias linhas: a entrelinha acompanha o corpo do título, não o do texto.
                    salto_titulo = ultima_linha is not None and linha.bbox[1] - ultima_linha.bbox[3] > linha.tamanho * 1.5
                    juntar_linhas = juntar_linhas and atual.nivel == bloco.nivel and not salto_titulo
                elif bloco.tipo == "nota_rodape":
                    juntar_linhas = juntar_linhas and re.match(r"^\d+\s", texto) is None
                elif bloco.tipo == "paragrafo":
                    # Recuo pendente (item de lista, citação recuada): a linha recuada continua o
                    # bloco quando a anterior também era recuada e ia até a margem direita.
                    continua_recuo = (recuo and ultima_linha is not None
                                      and ultima_linha.bbox[0] > esquerda + corpo
                                      and ultima_linha.bbox[2] >= direita - corpo
                                      and not re.match(r"^[•·▪◦‣–-]\s", texto))
                    juntar_linhas = juntar_linhas and (not recuo or continua_recuo) and not salto
                else:
                    juntar_linhas = juntar_linhas and not salto
                # Um desenho entre duas linhas também encerra o parágrafo.
                desenho_entre = ultima_linha is not None and any(ultima_linha.bbox[3] <= v.fragmentos[0].origem["bbox"][1] < linha.bbox[1] for v in visuais)
                if desenho_entre:
                    juntar_linhas = False
                if bloco.tipo == "codigo":
                    if juntar_linhas:
                        grupos_codigo[id(atual)].append(linha)
                    else:
                        locais.append(bloco)
                        grupos_codigo[id(bloco)] = [linha]
                        if atual is not None and atual.tipo == "codigo" and not desenho_entre:
                            regioes_codigo[-1].append(id(bloco))
                            limites.append({"tipo": "codigo_separado_por_intervalo", "pagina": numero,
                                            "descricao": f"Código na página PDF {numero}: intervalo vertical separou "
                                                         "blocos; referência horizontal compartilhada, continuidade semântica não garantida."})
                        else:
                            regioes_codigo.append([id(bloco)])
                elif atribuicao:
                    anexar_atribuicao(atual, bloco)
                elif juntar_linhas:
                    juntar(atual, bloco, vocabulario)
                else:
                    locais.append(bloco)
                ultima_linha = linha
            # O título se julga inteiro (o OCR parte "Modelo de dados RDF" em palavras soltas): o que
            # não tem cara de título volta a ser parágrafo.
            for local in locais:
                if local.tipo in {"capitulo", "secao"} and not parece_titulo(local.texto):
                    local.tipo, local.nivel = "paragrafo", 0
            margens_codigo = {identificador: min(l.bbox[0] for i in regiao for l in grupos_codigo[i])
                              for regiao in regioes_codigo for identificador in regiao}
            for indice, local in enumerate(locais):
                if id(local) in grupos_codigo:
                    locais[indice] = compor_codigo(grupos_codigo[id(local)], limites, esquerda=margens_codigo[id(local)])
            locais.extend(visuais)
            # Regra `ligaturas_tipograficas` (J15): títulos e texto corrido perdem os glifos de ligatura.
            for local in locais:
                if local.tipo != "codigo":
                    normalizar_ligaturas_do_bloco(local)
            if colunas is None:
                locais.sort(key=lambda b: (b.tipo == "nota_rodape", b.fragmentos[0].origem["bbox"][1], b.fragmentos[0].origem["bbox"][0]))
            else:
                locais.sort(key=lambda b: (b.tipo == "nota_rodape", colunas.chave(b.fragmentos[0].origem["bbox"])))
            primeiro = next((b for b in locais if b.tipo != "nota_rodape"), None)
            if (ultimo_corpo and primeiro and ultimo_corpo.tipo == primeiro.tipo == "paragrafo"
                and not primeiro.recuo and not re.search(r'[.!?:”’"](?:\d+)?\s*$', ultimo_corpo.texto)):
                juntar(ultimo_corpo, primeiro, vocabulario)
                locais.remove(primeiro)
            ultimo_local = next((b for b in reversed(locais) if b.tipo != "nota_rodape"), None)
            ultimo_corpo = ultimo_local or (ultimo_corpo if primeiro else None)
            blocos.extend(locais)
            especiais = [b for b in locais if b.pagina_asset is not None]
            if especiais:
                caminho = f"assets/pagina-{numero:03d}.png"
                (saida / "assets").mkdir(parents=True, exist_ok=True)
                dados = pagina.get_pixmap(dpi=110).tobytes("png")
                destino = saida / caminho
                # Escritas exclusivas evitam seguir symlinks para o original.
                with destino.open("xb") as arquivo:
                    arquivo.write(dados)
                assets.append({"id": identificar(semente, "pagina", numero), "tipo": "pagina", "caminho": caminho,
                               "sha256": hashlib.sha256(dados).hexdigest()})
                for bloco in especiais:
                    limites.append({"tipo": "conteudo_nao_textual", "pagina": numero, "conteudo": bloco.tipo,
                                    "asset_id": assets[-1]["id"],
                                    "descricao": f"{bloco.tipo.capitalize()} na página PDF {numero}: texto linearizado parcial; consultar a página inteira (110 dpi)."})
            if not linhas:
                limites.append({"tipo": "sem_texto", "pagina": numero,
                                "descricao": f"Página PDF {numero} sem texto extraível; OCR e visão fora de F1."})
        if not blocos:
            pagina = documento[inicio - 1]
            origem = {"tipo": "pdf", "pagina": inicio, "bbox": list(pagina.rect)}
            blocos.append(Bloco("paragrafo", "", fragmentos=[Fragmento(origem, 0, 0)]))
        return blocos, assets, limites
