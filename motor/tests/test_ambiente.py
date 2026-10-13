import json
from pathlib import Path

import pymupdf
import pytest


def test_abre_corpus_principal():
    raiz = Path(__file__).resolve().parents[2]
    manifesto = json.loads((raiz / "fixtures/manifest.json").read_text())
    material = next(
        item for item in manifesto["materiais"] if item["papel"] == "corpus_principal"
    )
    caminho = Path(material["caminho"])
    if not material["presente"] or not caminho.is_file():
        pytest.skip("PDF Mixtape ausente; consulte fixtures/manifest.json")
    with pymupdf.open(caminho) as documento:
        assert documento.page_count == 584
