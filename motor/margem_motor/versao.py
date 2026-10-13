"""Identidade reproduzível da implementação, independente do checkout Git."""

import hashlib
from pathlib import Path

import pymupdf


def identificar_motor() -> str:
    # Os módulos são importados da cópia estável capturada pelo pacote.
    # Inclui alterações sem commit presentes no início do processo.
    # Nomes e conteúdos têm prefixo de tamanho, evitando concatenações ambíguas.
    resumo = hashlib.sha256()
    raiz = Path(__file__).parent
    for arquivo in sorted(raiz.glob("*.py"), key=lambda p: p.name):
        for parte in (arquivo.name.encode("utf-8"), arquivo.read_bytes()):
            resumo.update(len(parte).to_bytes(8, "big"))
            resumo.update(parte)
    return f"margem-ingest/2; fonte-sha256/{resumo.hexdigest()}; PyMuPDF/{pymupdf.VersionBind}"
