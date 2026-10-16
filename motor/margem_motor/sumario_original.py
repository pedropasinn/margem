"""O sumário que o próprio arquivo declara (J164), para a conferência do sumário.

Uso: python -m margem_motor.sumario_original --entrada ARQUIVO --formato epub|pdf

Imprime em stdout `{"entradas": [{"nivel": 1, "titulo": "..."}]}`: o nav/NCX do EPUB
(`epub.ler_sumario`) ou o TOC do PDF (`get_toc`). Só títulos e níveis, até `LIMITE` entradas.
Arquivo sem sumário, ilegível ou de outro formato dá lista vazia, nunca erro: a conferência
segue sem ele.
"""
from __future__ import annotations

import argparse
import json
import sys
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

LIMITE = 1000
LIMITE_TITULO = 200


def _limpar(titulo: object) -> str:
    return ' '.join(str(titulo or '').split())[:LIMITE_TITULO]


def sumario_do_epub(conteudo: bytes) -> list[dict]:
    from .epub import caminho, ler_sumario, nome

    with ZipFile(BytesIO(conteudo)) as arquivo:
        container = ET.fromstring(arquivo.read('META-INF/container.xml'))
        raiz = next((e.get('full-path') for e in container.iter() if nome(e.tag) == 'rootfile'), None)
        if not raiz:
            return []
        opf_caminho = caminho('', raiz)
        opf = ET.fromstring(arquivo.read(opf_caminho))
        ns = {'opf': 'http://www.idpf.org/2007/opf'}
        manifesto = {e.get('id'): e for e in opf.findall('opf:manifest/opf:item', ns)}
        entradas = ler_sumario(arquivo, opf, opf_caminho, manifesto)
    return [{'nivel': int(nivel), 'titulo': _limpar(titulo)} for nivel, titulo, *_ in entradas if _limpar(titulo)]


def sumario_do_pdf(caminho_pdf: str) -> list[dict]:
    import pymupdf

    with pymupdf.open(caminho_pdf) as documento:
        toc = documento.get_toc()
    return [{'nivel': int(nivel), 'titulo': _limpar(titulo)} for nivel, titulo, *_ in toc if _limpar(titulo)]


def sumario_original(entrada: str, formato: str) -> list[dict]:
    try:
        if formato == 'epub':
            entradas = sumario_do_epub(Path(entrada).read_bytes())
        elif formato == 'pdf':
            entradas = sumario_do_pdf(entrada)
        else:
            return []
    except (OSError, ValueError, KeyError, RuntimeError, ET.ParseError, BadZipFile):
        return []
    return [{'nivel': max(1, min(6, e['nivel'])), 'titulo': e['titulo']} for e in entradas[:LIMITE]]


def principal(argumentos: list[str] | None = None) -> int:
    leitor = argparse.ArgumentParser(prog='margem_motor.sumario_original')
    leitor.add_argument('--entrada', required=True)
    leitor.add_argument('--formato', required=True)
    opcoes = leitor.parse_args(argumentos)
    sys.stdout.write(json.dumps({'entradas': sumario_original(opcoes.entrada, opcoes.formato)}, ensure_ascii=False))
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(principal())
