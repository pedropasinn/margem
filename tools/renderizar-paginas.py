"""Renderiza páginas de um PDF em PNG cinza, uma por arquivo (NNN.png), para a transcrição por visão.

Uso: python tools/renderizar-paginas.py ORIGINAL.pdf PASTA 3,4,7
150 dpi em cinza, como o `paginas.mjs` do Horarium (pdftoppm -r 150 -gray). Página já
renderizada não é refeita. Só depende de pymupdf (roda no motor/.venv).
"""
import sys
from pathlib import Path

import pymupdf

ORIGEM, PASTA, PAGINAS = sys.argv[1], Path(sys.argv[2]), [int(p) for p in sys.argv[3].split(",") if p]
PASTA.mkdir(parents=True, exist_ok=True)
with pymupdf.open(ORIGEM) as documento:
    for numero in PAGINAS:
        if not 1 <= numero <= documento.page_count:
            sys.exit(f"página {numero} fora do PDF ({documento.page_count} páginas)")
        destino = PASTA / f"{numero:03d}.png"
        if destino.exists():
            continue
        provisorio = PASTA / f".{numero:03d}.png"
        documento[numero - 1].get_pixmap(dpi=150, colorspace=pymupdf.csGRAY).save(provisorio)
        provisorio.rename(destino)
