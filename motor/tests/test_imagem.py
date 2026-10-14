"""J119: imagem de questão → PDF de uma página com a imagem em tamanho natural."""

import json
import struct

import pymupdf
import pytest

from margem_motor import imagem


def _pixmap(largura: int, altura: int) -> pymupdf.Pixmap:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, largura, altura), 0)
    pix.clear_with(255)
    pix.set_rect(pymupdf.IRect(10, 10, 40, 30), (200, 0, 0))
    return pix


def _png(largura=300, altura=120) -> bytes:
    return _pixmap(largura, altura).tobytes(output="png")


def _jpeg(largura=300, altura=120) -> bytes:
    return _pixmap(largura, altura).tobytes(output="jpg", jpg_quality=90)


def _com_orientacao(jpeg: bytes, orientacao: int) -> bytes:
    """Põe um segmento EXIF mínimo (só a orientação) logo depois do SOI."""
    tiff = b"MM\x00\x2a\x00\x00\x00\x08" + b"\x00\x01" + b"\x01\x12\x00\x03\x00\x00\x00\x01" + struct.pack(">HH", orientacao, 0) + b"\x00\x00\x00\x00"
    corpo = b"Exif\x00\x00" + tiff
    return jpeg[:2] + b"\xff\xe1" + struct.pack(">H", len(corpo) + 2) + corpo + jpeg[2:]


def test_png_vira_pdf_de_uma_pagina_em_tamanho_natural_e_o_png_original_segue():
    original = _png()
    pdf, png, dados = imagem.converter(original)
    assert dados == {"largura": 300, "altura": 120, "formato": "png"}
    assert png == original
    with pymupdf.open("pdf", pdf) as documento:
        assert documento.page_count == 1
        pagina = documento[0]
        # 96 pontos por polegada: 300 px = 225 pt.
        assert (round(pagina.rect.width), round(pagina.rect.height)) == (225, 90)
        assert pagina.get_text("text").strip() == ""
        assert len(pagina.get_images()) == 1
        assert pagina.get_pixmap().pixel(30, 25)[0] > 150  # o retângulo vermelho continua lá


def test_jpeg_gera_png_para_a_resolucao_e_o_pdf_e_deterministico():
    original = _jpeg()
    pdf, png, dados = imagem.converter(original)
    assert dados["formato"] == "jpeg"
    assert png.startswith(b"\x89PNG")
    assert imagem.converter(original)[0] == pdf
    with pymupdf.open("png", png) as resolucao:
        assert (round(resolucao[0].rect.width * 4 / 3), round(resolucao[0].rect.height * 4 / 3)) == (300, 120)


def test_foto_girada_pelo_exif_fica_de_pe():
    _, png, dados = imagem.converter(_com_orientacao(_jpeg(300, 120), 6))
    assert (dados["largura"], dados["altura"]) == (120, 300)
    pix = pymupdf.Pixmap(png)
    assert (pix.width, pix.height) == (120, 300)


def test_foto_grande_e_reduzida_so_no_png_da_resolucao():
    _, png, dados = imagem.converter(_jpeg(4000, 1000))
    assert (dados["largura"], dados["altura"]) == (4000, 1000)
    pix = pymupdf.Pixmap(png)
    assert max(pix.width, pix.height) == imagem.LADO_DO_PNG


@pytest.mark.parametrize("conteudo", [b"GIF89a....", b"RIFF\x00\x00\x00\x00WEBPVP8 ", b"%PDF-1.7", b""])
def test_recusa_o_que_nao_e_png_nem_jpeg(conteudo):
    with pytest.raises(ValueError, match="PNG ou JPEG"):
        imagem.converter(conteudo)


def test_recusa_png_corrompido():
    with pytest.raises(ValueError):
        imagem.converter(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40)


def test_linha_de_comando_grava_pdf_e_png(tmp_path, capsys):
    entrada = tmp_path / "print.png"
    entrada.write_bytes(_png())
    assert imagem.main(["--entrada", str(entrada), "--saida", str(tmp_path / "saida")]) == 0
    assert json.loads(capsys.readouterr().out) == {"largura": 300, "altura": 120, "formato": "png"}
    assert (tmp_path / "saida" / "questao.pdf").read_bytes().startswith(b"%PDF-")
    assert (tmp_path / "saida" / "questao.png").read_bytes() == entrada.read_bytes()
    entrada.write_bytes(b"nada")
    assert imagem.main(["--entrada", str(entrada), "--saida", str(tmp_path / "outra")]) == 2
