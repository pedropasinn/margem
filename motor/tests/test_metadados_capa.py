from pathlib import Path

import pymupdf
import pytest

from margem_motor.ingest import canonizar


def pdf_com_metadados(caminho: Path, titulo: str, autor: str):
    with pymupdf.open() as pdf:
        pdf.set_metadata({"title": titulo, "author": autor})
        for cor in ((1, 0, 0), (0, 0, 1)):
            pagina = pdf.new_page(width=600, height=900)
            pagina.draw_rect(pagina.rect, color=cor, fill=cor)
            pagina.insert_text((50, 100), "Um texto de teste para o documento.")
        pdf.save(caminho)


def test_metadados_capa_primeira_pagina_mesmo_com_recorte_e_original_intacto(tmp_path):
    entrada = tmp_path / "original.pdf"
    pdf_com_metadados(entrada, "  Livro  de teste  ", "  Autora Teste ")
    original = entrada.read_bytes()
    saida = tmp_path / "saida"
    canonico, _ = canonizar(entrada, "pdf", saida, paginas=(2, 2))
    assert canonico["documento"]["titulo"] == "Livro de teste"
    assert canonico["documento"]["autor"] == "Autora Teste"
    capa = pymupdf.Pixmap(str(saida / "capa.jpg"))
    assert (capa.width, capa.height) == (400, 600)
    assert capa.pixel(0, 0)[0] > 240  # página 1 vermelha, não a página 2 azul
    assert (saida / "capa.jpg").stat().st_size < 100_000
    assert entrada.read_bytes() == original


def test_campos_informados_prevalecem_independentemente(tmp_path):
    entrada = tmp_path / "original.pdf"
    pdf_com_metadados(entrada, "Título embutido", "Autor embutido")
    for indice, opcoes in enumerate(({"titulo": "Meu título"}, {"autor": "Minha autora"},
                                     {"titulo": "Meu título", "autor": "Minha autora"})):
        canonico, _ = canonizar(entrada, "pdf", tmp_path / str(indice), **opcoes)
        assert canonico["documento"]["titulo"] == opcoes.get("titulo", "Título embutido")
        assert canonico["documento"]["autor"] == opcoes.get("autor", "Autor embutido")


@pytest.mark.parametrize("lixo", ["", "  ", "Untitled", "Untitled document", "Microsoft Word - x.doc", "document1", "Unknown",
                                  "Administrator", "C:\\Temp\\relatorio", "main.tex", "Layout 1", "x" * 301])
def test_lixo_usa_reserva_e_nao_cria_autor(tmp_path, lixo):
    entrada = tmp_path / "original.pdf"
    pdf_com_metadados(entrada, lixo, lixo)
    canonico, _ = canonizar(entrada, "pdf", tmp_path / "saida", titulo_reserva="Nome do arquivo")
    assert canonico["documento"]["titulo"] == "Nome do arquivo"
    assert "autor" not in canonico["documento"]
