"""Papers: duas colunas, cabeçalho de revista repetido e fragmentos de equação em fonte grande."""

import re

import pymupdf

from margem_motor.ingest import canonizar
from margem_motor.pdf import parece_titulo

PALAVRAS = "the market price signal conveys dispersed knowledge about local conditions".split()


def linha_de_coluna(lado: str, pagina: int, indice: int) -> str:
    # Marcador único no começo da linha, para conferir a ordem de leitura.
    corpo = " ".join(PALAVRAS[(indice + j) % len(PALAVRAS)] for j in range(4))
    return f"{lado}{pagina}x{indice:02d} {corpo}"


def paper_duas_colunas(caminho):
    pdf = pymupdf.open()
    for numero in range(1, 4):
        pagina = pdf.new_page(width=516, height=720)
        # Cabeçalho da revista em fonte de título (o OCR das revistas antigas faz isso), repetido.
        pagina.insert_text((150, 40), "JOURNAL OF TESTING", fontsize=19)
        topo = 90
        if numero == 1:
            # Nome da revista em fonte grande só na primeira página, acima do título do artigo.
            pagina.insert_text((110, 75), "Review of Tests", fontsize=28)
            pagina.insert_text((110, 90), "VOLUME XXXV SEPTEMBER, 1945 NUMBER FOUR", fontsize=10)
            pagina.insert_text((110, 110), "A Theory of Two Columns", fontsize=22)
            topo = 150
        # Fragmento de equação lido pelo OCR em fonte grande: não é título.
        pagina.insert_text((300, topo + 300), "Di=O =/p<l.", fontsize=22)
        for indice in range(24):
            y = topo + indice * 12
            if y < topo + 290 or y > topo + 320:
                pagina.insert_text((54, y), linha_de_coluna("E", numero, indice), fontsize=10)
            if y < topo + 280 or y > topo + 330:
                pagina.insert_text((276, y), linha_de_coluna("D", numero, indice), fontsize=10)
        pagina.insert_text((250, 680), str(100 + numero), fontsize=10)
    pdf.save(caminho)


def test_duas_colunas_lidas_coluna_por_coluna(tmp_path):
    entrada = tmp_path / "paper.pdf"
    paper_duas_colunas(entrada)
    c, _ = canonizar(entrada, "pdf", tmp_path / "saida", titulo="Paper")
    texto = " ".join(b["texto"] for b in c["blocos"])
    marcadores = re.findall(r"\b([ED])(\d)x(\d\d)\b", texto)
    assert len(marcadores) >= 3 * 40
    # Ordem: página, depois coluna (E antes de D), depois linha. Nenhuma linha da direita no meio da esquerda.
    chaves = [(int(p), 0 if lado == "E" else 1, int(i)) for lado, p, i in marcadores]
    assert chaves == sorted(chaves)
    # Nenhum bloco de prosa alterna as colunas linha a linha.
    for bloco in c["blocos"]:
        lados = re.findall(r"\b([ED])\dx\d\d\b", bloco["texto"])
        trocas = sum(1 for a, b in zip(lados, lados[1:]) if a != b)
        assert trocas <= 1, bloco["texto"][:200]


def test_titulos_de_paper_sem_cabecalho_nem_equacao(tmp_path):
    entrada = tmp_path / "paper.pdf"
    paper_duas_colunas(entrada)
    c, _ = canonizar(entrada, "pdf", tmp_path / "saida", titulo="A Theory of Two Columns")
    titulos = [b["texto"] for b in c["blocos"] if b["tipo"] in {"capitulo", "secao"}]
    assert "A Theory of Two Columns" in titulos
    assert not any("JOURNAL" in t or "Review of Tests" in t for t in titulos)
    assert not any("=" in t for t in titulos)
    # O cabeçalho corrente sai do texto, como os cabeçalhos pequenos de sempre.
    assert not any("JOURNAL OF TESTING" in b["texto"] for b in c["blocos"])
    assert len(c["secoes"]) <= 2


def test_parece_titulo():
    for falso in ["Di=O =/p<l.", "efb(a)c(a) + k", "_av", "El U'[I -", "ef", "dr 1", "Jews 5 9 3",
                  "Bihar 184 50", "•", "in A(O) — a + ,"]:
        assert not parece_titulo(falso), falso
    for verdadeiro in ["1 Introduction", "IV.", "3", "Directed Acyclic Graphs", "2.3 Results", "Chapter 10",
                       "Appendix A: Proofs", "C++ Primer"]:
        assert parece_titulo(verdadeiro), verdadeiro
