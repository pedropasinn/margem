"""Inline Markdown básico, sem HTML e sem normalização Unicode."""

import re
from .blocos import Estilo


def extrair_inline(fonte: str) -> tuple[str, list[Estilo]]:
    saida = ""
    estilos = []
    posicao = 0
    while posicao < len(fonte):
        if fonte[posicao] == "\\" and posicao + 1 < len(fonte) and fonte[posicao + 1] in r"\`*_{}[]()#+-.!>":
            saida += fonte[posicao + 1]
            posicao += 2
            continue
        marcador = next((m for m in ("`", "***", "___", "**", "__", "*", "_")
                         if fonte.startswith(m, posicao)), None)
        if marcador and not (marcador.startswith("_") and posicao > 0 and fonte[posicao - 1].isalnum()):
            if marcador == "`":
                marcador = re.match(r"`+", fonte[posicao:])[0]
            fim = fonte.find(marcador, posicao + len(marcador))
            if fim > posicao + len(marcador) and not fonte[posicao + len(marcador)].isspace():
                conteudo = fonte[posicao + len(marcador):fim]
                inicio = len(saida)
                if marcador.startswith("`"):
                    texto, internos = conteudo, []
                    nomes = ["codigo"]
                else:
                    texto, internos = extrair_inline(conteudo)
                    nomes = ["italico", "negrito"] if len(marcador) == 3 else [
                        "negrito" if len(marcador) == 2 else "italico"]
                saida += texto
                estilos.extend(Estilo(inicio + e.inicio, inicio + e.fim, e.estilo) for e in internos)
                estilos.extend(Estilo(inicio, len(saida), nome) for nome in nomes)
                posicao = fim + len(marcador)
                continue
        saida += fonte[posicao]
        posicao += 1
    return saida, estilos
