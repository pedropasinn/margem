"""Blocos de Markdown, TXT e texto colado; cercas preservam os bytes UTF-8.

Estrofe (V1.1): um grupo de versos separado por linha em branco vira um bloco `estrofe`, com os
versos unidos por LF. O poema é reconhecido por quebra dura (dois espaços, `\\` ou `<br>` no fim
de cada linha, menos a última), por `poesia: true` no frontmatter do documento ou da seção, ou
pela opção `--poesia`. Em prosa nada muda.
"""

import re
from .blocos import Bloco, Fragmento
from .contratos import versos_validos
from .markdown import extrair_inline

TITULO = re.compile(r"^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$")
LISTA = re.compile(r"^\s*(?:[-+*]|\d+[.)])\s+")
CERCA = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
DELIMITADOR = re.compile(r"^---\s*$")
CHAVE = re.compile(r"^([A-Za-z_][\w-]*)\s*:(?:\s+(.*?))?\s*$")
BR = re.compile(r"<br\s*/?>", re.I)
# Quebra dura no fim da linha: dois espaços (ou mais), barra invertida ou <br>.
QUEBRA_DURA = re.compile(r"(?: {2,}|\\|<br\s*/?>)$", re.I)
VERDADEIRO = {"true", "sim", "yes", "verdadeiro"}
FALSO = {"false", "nao", "não", "no", "falso"}


def ler_frontmatter(linhas: list[str], posicao: int) -> tuple[dict[str, str], int] | None:
    """Frontmatter YAML simples (`chave: valor` por linha) entre duas linhas `---`.

    Devolve as chaves e a posição depois do fechamento, ou None se não for frontmatter: sem
    fechamento, linha que não é `chave: valor`, ou bloco vazio. Não há dependência de YAML.
    """
    if posicao >= len(linhas) or not DELIMITADOR.match(linhas[posicao].rstrip("\r\n")):
        return None
    chaves: dict[str, str] = {}
    atual = posicao + 1
    while atual < len(linhas):
        linha = linhas[atual].rstrip("\r\n")
        if DELIMITADOR.match(linha):
            return (chaves, atual + 1) if chaves else None
        if linha.strip() and not linha.lstrip().startswith("#"):
            chave = CHAVE.match(linha)
            if not chave:
                return None
            chaves[chave[1]] = (chave[2] or "").strip().strip("\"'")
        atual += 1
    return None


def valor_de_poesia(chaves: dict[str, str]) -> bool | None:
    valor = chaves.get("poesia")
    if valor is None:
        return None
    if valor.lower() in VERDADEIRO:
        return True
    if valor.lower() in FALSO:
        return False
    return None


def termina_em_quebra_dura(linha: str) -> bool:
    return QUEBRA_DURA.search(linha.rstrip("\r\n")) is not None


def eh_poema_por_quebra_dura(brutas: list[str]) -> bool:
    """Todas as linhas, menos a última, terminam em quebra dura; linha única só com `<br>` no meio."""
    if len(brutas) == 1:
        return BR.search(brutas[0].rstrip("\r\n")) is not None and bool(BR.sub("", brutas[0]).strip())
    return all(termina_em_quebra_dura(linha) for linha in brutas[:-1])


def versos_da_estrofe(brutas: list[str]) -> tuple[list[str], int]:
    """Versos sem marca de quebra e sem espaços de alinhamento no fim; o recuo inicial vira espaços."""
    versos = []
    recuados = 0
    for bruta in brutas:
        for parte in BR.split(bruta.rstrip("\r\n")):
            parte = parte.rstrip()
            if parte.endswith("\\") and not parte.endswith("\\\\"):
                parte = parte[:-1].rstrip()
            if not parte.strip():
                continue
            corpo = parte.lstrip(" \t")
            recuo = parte[:len(parte) - len(corpo)].expandtabs(4)
            if recuo:
                recuados += 1
            versos.append(recuo + corpo)
    return versos, recuados


BOMS = ((b"\xef\xbb\xbf", "utf-8", "UTF-8"), (b"\xff\xfe", "utf-16-le", "UTF-16 LE"),
        (b"\xfe\xff", "utf-16-be", "UTF-16 BE"))


def decodificar(conteudo: bytes, limites: list[dict]) -> str:
    """Texto do arquivo, sem trocar caractere em silêncio (I-01).

    BOM de UTF-8/UTF-16 decide a codificação e sai do texto (não estraga o primeiro título).
    Sem BOM: UTF-8 estrito; se não for, uma tentativa com Windows-1252 (TXT antigo do Windows,
    que cobre o Latin-1 legível), avisada em `limites`. Se nem assim, erro: nada de `�`.
    """
    for bom, codificacao, nome in BOMS:
        if conteudo.startswith(bom):
            try:
                return conteudo[len(bom):].decode(codificacao)
            except UnicodeDecodeError as erro:
                raise ValueError(f"O arquivo começa como {nome}, mas o texto não é {nome} válido. "
                                 "Salve-o de novo como UTF-8 e importe outra vez.") from erro
    try:
        return conteudo.decode("utf-8")
    except UnicodeDecodeError:
        pass
    try:
        texto = conteudo.decode("cp1252")
    except UnicodeDecodeError as erro:
        raise ValueError("Não deu para ler o texto: o arquivo não está em UTF-8 nem em Windows-1252. "
                         "Salve-o como UTF-8 e importe outra vez.") from erro
    limites.append({"tipo": "codificacao_legada", "descricao": "O arquivo não estava em UTF-8; foi lido como "
                    "Windows-1252 (Latin-1). Confira acentos e aspas; se algo estiver trocado, salve o original "
                    "como UTF-8 e importe outra vez."})
    return texto


def extrair_texto(conteudo: bytes, formato: str, poesia: bool = False,
                  limites: list[dict] | None = None) -> list[Bloco]:
    if limites is None:
        limites = []
    fonte = decodificar(conteudo, limites)
    linhas = re.findall(r"[^\r\n]*(?:\r\n|\r|\n|$)", fonte)
    if linhas and linhas[-1] == "":
        linhas.pop()
    blocos = []
    posicao = 0
    # Poesia declarada: a do documento vale até uma seção declarar a sua (e só dentro dela).
    poesia_documento = poesia
    frontmatter = ler_frontmatter(linhas, 0)
    if frontmatter:
        chaves, posicao = frontmatter
        declarado = valor_de_poesia(chaves)
        if declarado is not None:
            poesia_documento = poesia_documento or declarado
        limites.append({"tipo": "frontmatter", "descricao": f"Frontmatter nas linhas 1–{posicao} "
                        f"({', '.join(sorted(chaves))}) não vira bloco."})
    secoes_com_poesia: list[tuple[int, bool]] = []

    def poesia_atual() -> bool:
        return secoes_com_poesia[-1][1] if secoes_com_poesia else poesia_documento

    def adicionar(tipo, texto, inicio, fim, nivel=0):
        texto, estilos = extrair_inline(texto) if formato == "md" and tipo != "codigo" else (texto, [])
        if tipo == "estrofe" and not versos_validos(texto):
            # O inline não pode esvaziar um verso; se esvaziar, o grupo volta a ser parágrafo.
            texto = " ".join(v.strip() for v in texto.split("\n") if v.strip())
            tipo = "paragrafo"
            limites.append({"tipo": "estrofe_recusada", "descricao": f"Linhas {inicio + 1}–{fim}: "
                            "algum verso ficou vazio depois do inline; o grupo saiu como parágrafo."})
        origem = {"tipo": "texto", "linha_inicio": inicio + 1, "linha_fim": fim}
        blocos.append(Bloco(tipo, texto, estilos, [Fragmento(origem, 0, len(texto))], nivel))

    def especial(linha):
        return CERCA.match(linha) or (LISTA.match(linha) and not poesia_atual()) or (
            linha.lstrip().startswith(">")) or (formato == "md" and TITULO.match(linha))

    while posicao < len(linhas):
        linha = linhas[posicao].rstrip("\r\n")
        inicio = posicao
        if not linha.strip():
            posicao += 1
            continue
        cerca = CERCA.match(linha)
        if cerca:
            posicao += 1
            conteudo_codigo = []
            fechamento = re.compile(r"^ {0,3}" + re.escape(cerca[1][0]) + "{" + str(len(cerca[1])) + r",}\s*$")
            while posicao < len(linhas) and not fechamento.fullmatch(linhas[posicao].rstrip("\r\n")):
                conteudo_codigo.append(linhas[posicao])
                posicao += 1
            if posicao < len(linhas):
                posicao += 1
            adicionar("codigo", "".join(conteudo_codigo), inicio, posicao)
            continue
        titulo = TITULO.match(linha) if formato == "md" else None
        if titulo:
            posicao += 1
            nivel = len(titulo[1])
            adicionar("capitulo" if nivel == 1 else "secao", titulo[2], inicio, posicao, nivel)
            while secoes_com_poesia and secoes_com_poesia[-1][0] >= nivel:
                secoes_com_poesia.pop()
            # Frontmatter da seção: logo depois do título, separado só por linhas em branco.
            seguinte = posicao
            while seguinte < len(linhas) and not linhas[seguinte].strip():
                seguinte += 1
            frontmatter = ler_frontmatter(linhas, seguinte)
            if frontmatter:
                chaves, posicao = frontmatter
                declarado = valor_de_poesia(chaves)
                if declarado is not None:
                    secoes_com_poesia.append((nivel, declarado))
                limites.append({"tipo": "frontmatter", "descricao": f"Frontmatter da seção “{titulo[2]}” "
                                f"nas linhas {seguinte + 1}–{posicao} ({', '.join(sorted(chaves))}) não vira bloco."})
            continue
        tipo = ("paragrafo" if poesia_atual() else "lista") if LISTA.match(linha) else (
            "citacao" if linha.lstrip().startswith(">") else "paragrafo")
        partes = []
        brutas = []
        while posicao < len(linhas):
            atual = linhas[posicao].rstrip("\r\n")
            if not atual.strip():
                break
            if tipo == "lista":
                item = LISTA.match(atual)
                if not item:
                    if atual.startswith(("  ", "\t")) and not especial(atual):
                        partes[-1] += " " + atual.strip()
                        posicao += 1
                        continue
                    break
                partes.append(atual[item.end():].strip())
            elif tipo == "citacao":
                if not atual.lstrip().startswith(">"):
                    break
                partes.append(re.sub(r"^\s*> ?", "", atual).strip())
            else:
                if posicao > inicio and especial(atual):
                    break
                partes.append(atual.strip())
                brutas.append(atual)
            posicao += 1
        if tipo == "paragrafo" and (poesia_atual() or eh_poema_por_quebra_dura(brutas)):
            versos, recuados = versos_da_estrofe(brutas)
            if versos:
                if recuados:
                    limites.append({"tipo": "recuo_de_verso", "descricao": f"Estrofe nas linhas {inicio + 1}–"
                                    f"{posicao}: {recuados} verso(s) com recuo inicial preservado como espaços."})
                adicionar("estrofe", "\n".join(versos), inicio, posicao)
                continue
        adicionar(tipo, ("\n" if tipo == "lista" else " ").join(partes), inicio, posicao)
    return blocos


def detectar_idioma(texto: str) -> str:
    palavras = re.findall(r"[^\W\d_]+", texto.lower())
    portugues = {"o", "a", "os", "as", "de", "do", "da", "e", "em", "um", "uma", "que", "não", "para", "com"}
    ingles = {"the", "a", "an", "of", "and", "in", "that", "is", "are", "to", "with", "for", "not"}
    return "en" if sum(p in ingles for p in palavras) > sum(p in portugues for p in palavras) else "pt"
