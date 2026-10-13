"""Exercícios de um PDF (tools/exercicios-do-pdf.py): um livro de mentira com camada de texto, sem OCR."""
import importlib.util
import json
import sys
from pathlib import Path

import pymupdf

spec = importlib.util.spec_from_file_location("exercicios_do_pdf", Path(__file__).parents[1] / "exercicios-do-pdf.py")
ex = importlib.util.module_from_spec(spec)
sys.modules["exercicios_do_pdf"] = ex
spec.loader.exec_module(ex)


def livro(caminho: Path) -> None:
    """Capítulo 1 (abertura com número e título grandes), texto, e a seção de exercícios em duas páginas,
    com o número dos itens saindo à esquerda do texto, como no Elon."""
    doc = pymupdf.open()
    abertura = doc.new_page(width=440, height=660)
    abertura.insert_text((60, 70), "1", fontsize=26)
    abertura.insert_text((60, 130), "Conjuntos Finitos", fontsize=26)
    abertura.insert_text((60, 200), "Neste capítulo, será estabelecida a diferença entre conjuntos.", fontsize=10)
    texto = doc.new_page(width=440, height=660)
    texto.insert_text((60, 70), "2 Conjuntos Finitos Cap. 1", fontsize=9)
    linhas = [
        (60, 120, "Teorema 1. Todo conjunto finito tem elemento máximo.", 10),
        (60, 200, "4. Exercícios", 12),
        (60, 240, "Seção 1: Números naturais", 10),
        (72, 270, "1.", 10), (86, 270, "Usando indução, prove que a soma dos n primeiros", 10),
        (86, 284, "números naturais é n(n+1)/2.", 10),
        (72, 310, "2.", 10), (86, 310, "Prove o princípio da boa ordenação.", 10),
        (60, 350, "Seção 2: Conjuntos finitos", 10),
        (72, 380, "1.", 10), (86, 380, "Prove que todo subconjunto de um conjunto finito", 10),
        (100, 394, "(a) é finito;", 10),
        (100, 408, "(b) tem no máximo tantos elementos quanto o todo.", 10),
        (72, 620, "2.", 10), (86, 620, "Seja X finito. Prove que card P(X) é igual a", 10),
    ]
    for x, y, frase, tamanho in linhas:
        texto.insert_text((x, y), frase, fontsize=tamanho)
    continua = doc.new_page(width=440, height=660)
    continua.insert_text((86, 60), "dois elevado a card X.", fontsize=10)
    continua.insert_text((72, 90), "3.", fontsize=10)
    continua.insert_text((86, 90), "Prove que a reunião de dois finitos é finita.", fontsize=10)
    proximo = doc.new_page(width=440, height=660)
    proximo.insert_text((60, 70), "2", fontsize=26)
    proximo.insert_text((60, 130), "Números Reais", fontsize=26)
    proximo.insert_text((72, 200), "1.", fontsize=10)
    proximo.insert_text((86, 200), "Isto não é exercício.", fontsize=10)
    doc.save(caminho)


def test_descobre_capitulo_secoes_e_itens(tmp_path):
    pdf = tmp_path / "livro.pdf"
    livro(pdf)
    saida = ex.descobrir(str(pdf), tmp_path / "cache")
    assert saida["fonte"] == "texto"
    assert [c["numero"] for c in saida["capitulos"]] == [1]
    itens = [(e["capitulo"], e["secao"], e["numero"]) for e in saida["exercicios"]]
    assert itens == [
        ("Capítulo 1 · Conjuntos Finitos", "Seção 1: Números naturais", "1"),
        ("Capítulo 1 · Conjuntos Finitos", "Seção 1: Números naturais", "2"),
        ("Capítulo 1 · Conjuntos Finitos", "Seção 2: Conjuntos finitos", "1"),
        ("Capítulo 1 · Conjuntos Finitos", "Seção 2: Conjuntos finitos", "2"),
        ("Capítulo 1 · Conjuntos Finitos", "Seção 2: Conjuntos finitos", "3"),
    ]
    primeiro = saida["exercicios"][0]
    assert primeiro["partes"][0]["pagina"] == 2 and "n(n+1)/2" in primeiro["texto"]
    # Os itens (a), (b) ficam dentro do exercício 1 da seção 2.
    assert "(b) tem no máximo" in saida["exercicios"][2]["texto"]
    # O exercício que vira a página tem duas partes.
    assert [p["pagina"] for p in saida["exercicios"][3]["partes"]] == [2, 3]
    for e in saida["exercicios"]:
        for parte in e["partes"]:
            assert 0 <= parte["x"] < parte["x"] + parte["largura"] <= 1
            assert 0 <= parte["y"] < parte["y"] + parte["altura"] <= 1


def test_recorta_e_empilha_as_partes(tmp_path):
    pdf = tmp_path / "livro.pdf"
    livro(pdf)
    saida = ex.descobrir(str(pdf), tmp_path / "cache")
    pedido = [{"chave": f"e{e['ordem']}", "partes": e["partes"]} for e in saida["exercicios"]]
    ex.recortar(str(pdf), tmp_path / "recortes", pedido)
    um = pymupdf.Pixmap(str(tmp_path / "recortes" / "e0.png"))
    dois = pymupdf.Pixmap(str(tmp_path / "recortes" / "e3.png"))
    assert um.n == 1 and um.width > 300
    altura_das_partes = sum(round(p["altura"] * 660 * 200 / 72) for p in saida["exercicios"][3]["partes"])
    assert abs(dois.height - altura_das_partes) <= 4


def test_corrige_o_trema_do_ocr():
    assert ex.corrigir_ocr("Seqiiências  de números") == "Seqüências de números"
    assert ex.corrigir_ocr("conseqiiente") == "conseqüente"
    json.dumps(ex.corrigir_ocr("ok"))
