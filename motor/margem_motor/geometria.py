"""Geometria derivada do texto FINAL; nunca reescreve o canônico existente."""

import argparse
from difflib import SequenceMatcher
import hashlib
import json
from pathlib import Path
import re
import sys

import pymupdf

from .blocos import normalizar_ligaturas, unir_bbox
from .contratos import comprimento_utf16, conferir_geometria
from .pdf import FLAGS
from .relatorio import serializar

VERSAO_PENDENTE = "00000000000000000000000000"


def _caracteres(pagina):
    linhas = []
    for grupo in pagina.get_text("rawdict", flags=FLAGS)["blocks"]:
        if grupo["type"] != 0:
            continue
        for linha in grupo["lines"]:
            linhas.append(linha)
    linhas.sort(key=lambda linha: (round(linha["bbox"][1]), linha["bbox"][0]))
    saida = []
    for numero, linha in enumerate(linhas):
        palavra = 0
        for span in linha["spans"]:
            for caractere in span["chars"]:
                texto = normalizar_ligaturas(caractere["c"])
                if texto.isspace():
                    palavra += 1
                    continue
                for letra in texto:
                    saida.append((letra, caractere["bbox"], (numero, palavra)))
    return saida


def gerar_geometria(canonico: dict, entrada: Path, versao_id: str = VERSAO_PENDENTE) -> tuple[dict, list[dict]]:
    """Alinha por origem (linha nova ou bbox histórico da página), sem procurar em outras páginas.

    Só correspondências literais após desfazer ligaturas produzem quads. Hífens removidos
    e espaços normalizados são lacunas do alinhamento, nunca deslocamentos heurísticos.
    """
    if not re.fullmatch(r"[0-7][0-9A-HJKMNP-TV-Z]{25}", versao_id):
        raise ValueError("versao_id deve ser ULID.")
    if hashlib.sha256(entrada.read_bytes()).hexdigest() != canonico["documento"]["sha256_original"]:
        raise ValueError("O PDF não corresponde ao sha256_original do canônico.")
    limites = []
    palavras = []
    with pymupdf.open(entrada) as pdf:
        paginas = [{"numero": i + 1, "largura": p.cropbox.width, "altura": p.cropbox.height,
                    "rotacao": p.rotation} for i, p in enumerate(pdf)]
        cache = {}
        for bloco in canonico["blocos"]:
            texto = bloco["texto"]
            offsets = [0]
            for ch in texto:
                offsets.append(offsets[-1] + comprimento_utf16(ch))
            indice = {offset: i for i, offset in enumerate(offsets)}
            cobertos = set()
            for origem in bloco["origens"]:
                if origem["tipo"] != "pdf":
                    continue
                # Títulos sintéticos e assets têm apenas uma referência de página,
                # sem faixa textual: não inventar posição para texto acrescentado.
                if "inicio" not in origem or "fim" not in origem:
                    continue
                numero = origem["pagina"]
                if not 1 <= numero <= len(pdf):
                    raise ValueError("Página da origem não existe no PDF.")
                if numero not in cache:
                    cache[numero] = _caracteres(pdf[numero - 1])
                x0, y0, x1, y1 = origem["bbox"]
                fonte = [ch for ch in cache[numero] if x0 - 1 <= (ch[1][0] + ch[1][2]) / 2 <= x1 + 1
                         and y0 - 1 <= (ch[1][1] + ch[1][3]) / 2 <= y1 + 1]
                inicio = indice.get(origem.get("inicio", 0))
                fim = indice.get(origem.get("fim", offsets[-1]))
                if inicio is None or fim is None:
                    raise ValueError("Origem corta uma fronteira UTF-16.")
                # Comparar projeções normalizadas, mantendo o índice do caractere
                # original. Funciona tanto com canônicos legados (fi) quanto literais (ﬁ).
                alvo = [(letra, pos) for pos, ch in enumerate(texto[inicio:fim], inicio) if not ch.isspace()
                        for letra in normalizar_ligaturas(ch)]
                comparador = SequenceMatcher(None, "".join(ch[0] for ch in fonte), "".join(ch[0] for ch in alvo), autojunk=False)
                por_posicao = {}
                for igual in comparador.get_matching_blocks():
                    for k in range(igual.size):
                        caracter = fonte[igual.a + k]
                        pos = alvo[igual.b + k][1]
                        por_posicao.setdefault(pos, []).append((igual.a + k, caracter))
                pares = []
                for pos, caracteres in sorted(por_posicao.items()):
                    # Uma correspondência só de 'f' não pode certificar o glifo 'ﬁ'.
                    if pos in cobertos or len(caracteres) != len(normalizar_ligaturas(texto[pos])):
                        continue
                    if any(indice_fonte != caracteres[0][0] + k for k, (indice_fonte, _) in enumerate(caracteres)):
                        continue
                    if len({caracter[2] for _, caracter in caracteres}) != 1:
                        continue
                    bbox = caracteres[0][1][1]
                    for _, caracter in caracteres[1:]:
                        bbox = unir_bbox(bbox, caracter[1])
                    pares.append((pos, (texto[pos], bbox, caracteres[0][1][2])))
                    cobertos.add(pos)
                trecho = None
                ultimo_grupo = None
                for pos, (_, bbox, grupo) in pares:
                    if trecho is not None and trecho["fim_utf16"] == offsets[pos] and grupo == ultimo_grupo:
                        trecho["fim_utf16"] = offsets[pos + 1]
                        trecho["bbox"] = unir_bbox(trecho["bbox"], bbox)
                    else:
                        trecho = {"bloco_id": bloco["id"], "inicio_utf16": offsets[pos], "fim_utf16": offsets[pos + 1],
                                  "pagina": numero, "bbox": list(bbox)}
                        palavras.append(trecho)
                    ultimo_grupo = grupo
            if any(o["tipo"] == "pdf" for o in bloco["origens"]):
                faltantes = sum(not ch.isspace() and i not in cobertos for i, ch in enumerate(texto))
                if faltantes:
                    limites.append({"tipo": "geometria_nao_alinhada", "bloco_id": bloco["id"],
                                    "descricao": f"Bloco {bloco['id']}: {faltantes} caracteres não brancos sem posição confiável."})
        ordem = {b["id"]: i for i, b in enumerate(canonico["blocos"])}
        palavras.sort(key=lambda p: (ordem[p["bloco_id"]], p["inicio_utf16"]))
        for palavra in palavras:
            x0, y0, x1, y1 = palavra.pop("bbox")
            pagina = paginas[palavra["pagina"] - 1]
            x0, x1 = max(0, x0), min(pagina["largura"], x1)
            y0, y1 = max(0, y0), min(pagina["altura"], y1)
            palavra["quad"] = [round(v, 4) for v in (x0, y0, x1, y0, x1, y1, x0, y1)]
    geometria = {"versao": 1, "versao_id": versao_id, "fonte": "pdf_texto",
                 "motor": f"margem-geometria/1; PyMuPDF/{pymupdf.VersionBind}", "paginas": paginas, "palavras": palavras}
    if not conferir_geometria(geometria, canonico):
        raise ValueError("Geometria derivada não passou nas invariantes.")
    return geometria, limites


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--canonico", type=Path, required=True)
    argumentos.add_argument("--entrada", type=Path, required=True)
    argumentos.add_argument("--saida", type=Path, required=True)
    argumentos.add_argument("--versao-id")
    argumentos.add_argument("--forcar", action="store_true")
    opcoes = argumentos.parse_args()
    try:
        versao = opcoes.versao_id
        if versao is None:
            pasta = opcoes.canonico.parent.name
            versao = pasta.removeprefix("versao-") if pasta.startswith("versao-") else VERSAO_PENDENTE
        canonico = json.loads(opcoes.canonico.read_text())
        geometria, limites = gerar_geometria(canonico, opcoes.entrada, versao)
        if opcoes.saida.resolve() in {opcoes.canonico.resolve(), opcoes.entrada.resolve()}:
            raise ValueError("A saída não pode sobrescrever o canônico nem o original.")
        with opcoes.saida.open("wb" if opcoes.forcar else "xb") as arquivo:
            arquivo.write(serializar(geometria))
        for limite in limites:
            print(limite["descricao"], file=sys.stderr)
        return 0
    except (OSError, ValueError, RuntimeError) as erro:
        print(f"Falha na geometria: {erro}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
