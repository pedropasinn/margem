"""Gera os ícones da extensão (16/32/48/128) a partir do ícone do app (web/public/icone-512.png).

Rodar só quando o ícone do app mudar: python3 scripts/icones.py (precisa do Pillow).
"""
from pathlib import Path
from PIL import Image

raiz = Path(__file__).resolve().parent.parent
origem = Image.open(raiz.parent / "web/public/icone-512.png").convert("RGBA")
for tamanho in (16, 32, 48, 128):
    origem.resize((tamanho, tamanho), Image.LANCZOS).save(raiz / "icones" / f"icone-{tamanho}.png", optimize=True)
    print(f"icones/icone-{tamanho}.png")
