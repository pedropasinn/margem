import io
import json

import pymupdf
import pytest

from margem_motor import pdf_anotado


def _quad_de(pagina, texto):
    r = pagina.search_for(texto)[0]
    return [r.x0, r.y0, r.x1, r.y0, r.x1, r.y1, r.x0, r.y1]


@pytest.fixture
def original(tmp_path):
    caminho = tmp_path / "original.pdf"
    with pymupdf.open() as pdf:
        pagina = pdf.new_page()
        pagina.insert_text((58, 115), "A tese central aparece aqui.", fontsize=12)
        pagina.insert_text((58, 140), "Um conceito vem depois.", fontsize=12)
        girada = pdf.new_page()
        girada.insert_text((58, 115), "Pagina girada com grifo.", fontsize=12)
        girada.set_rotation(90)
        pdf.save(caminho)
    return caminho


def test_grava_highlight_e_nota_padrao_abriveis(original, tmp_path):
    with pymupdf.open(original) as pdf:
        tese = _quad_de(pdf[0], "tese central")
        conceito = _quad_de(pdf[0], "conceito")
        girada = _quad_de(pdf[1], "grifo")
    saida = tmp_path / "anotado.pdf"
    contagem = pdf_anotado.anotar({"entrada": str(original), "saida": str(saida), "anotacoes": [
        {"tipo": "grifo", "pagina": 1, "quads": [tese], "cor": "#FFD926", "autor": "Margem", "assunto": "Tese",
         "texto": "Tese\n\nMinha nota."},
        {"tipo": "nota", "pagina": 1, "quads": [conceito], "cor": "#52ABFF", "autor": "Margem", "assunto": "Dúvida",
         "texto": "Por que isso?"},
        {"tipo": "grifo", "pagina": 2, "quads": [girada], "cor": "#59D675", "autor": "Margem", "assunto": "Conceito", "texto": ""},
    ]})
    assert contagem == {"grifos": 2, "notas": 1}
    with pymupdf.open(saida) as pdf:
        assert pdf.page_count == 2
        primeira, segunda = pdf[0], pdf[1]
        anotacoes = list(primeira.annots())
        assert [a.type[1] for a in anotacoes] == ["Highlight", "Text"]
        grifo, nota = anotacoes
        # Os vértices são os da geometria, e o texto sob eles é o trecho grifado.
        assert [round(v, 2) for ponto in grifo.vertices for v in ponto] == [round(v, 2) for v in tese[:4] + tese[6:] + tese[4:6]]
        assert primeira.get_textbox(pymupdf.Rect(tese[0], tese[1], tese[4], tese[5])).strip() == "tese central"
        assert grifo.info["content"] == "Tese\n\nMinha nota."
        assert grifo.info["subject"] == "Tese"
        assert [round(c, 2) for c in grifo.colors["stroke"]] == [1.0, 0.85, 0.15]
        assert nota.info["content"] == "Por que isso?"
        (girado,) = list(segunda.annots())
        assert segunda.rotation == 90
        assert segunda.get_textbox(pymupdf.Rect(girada[0], girada[1], girada[4], girada[5])).strip() == "grifo"
        assert girado.rect.contains(pymupdf.Rect(girada[0], girada[1], girada[4], girada[5]))
    # O original não muda.
    with pymupdf.open(original) as pdf:
        assert not any(True for p in pdf for _ in p.annots())


def test_recusa_quad_fora_da_pagina_e_pagina_inexistente(original, tmp_path):
    base = {"entrada": str(original), "saida": str(tmp_path / "x.pdf")}
    with pytest.raises(ValueError, match="fora da página"):
        pdf_anotado.anotar({**base, "anotacoes": [{"tipo": "grifo", "pagina": 1, "quads": [[0, 0, 900, 0, 900, 10, 0, 10]], "cor": "#FFD926"}]})
    with pytest.raises(ValueError, match="Página inexistente"):
        pdf_anotado.anotar({**base, "anotacoes": [{"tipo": "grifo", "pagina": 3, "quads": [[0, 0, 9, 0, 9, 9, 0, 9]], "cor": "#FFD926"}]})
    with pytest.raises(ValueError, match="Cor inválida"):
        pdf_anotado.anotar({**base, "anotacoes": [{"tipo": "grifo", "pagina": 1, "quads": [[0, 0, 9, 0, 9, 9, 0, 9]], "cor": "amarelo"}]})


def test_cli_le_stdin_e_escreve_contagem(original, tmp_path, monkeypatch, capsys):
    pedido = {"entrada": str(original), "saida": str(tmp_path / "cli.pdf"), "anotacoes": []}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(pedido)))
    assert pdf_anotado.main() == 0
    assert json.loads(capsys.readouterr().out) == {"grifos": 0, "notas": 0}
    assert (tmp_path / "cli.pdf").exists()
