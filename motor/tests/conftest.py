"""PDFs de teste gerados localmente, sem binários externos ou rede."""

from pathlib import Path
import pymupdf
import pytest


@pytest.fixture
def sintetico(tmp_path):
    caminho = tmp_path / "fixtures" / "sintetico.pdf"
    caminho.parent.mkdir()
    with pymupdf.open() as documento:
        pagina = documento.new_page()
        pagina.insert_text((40, 30), "Cabecalho corrente 1", fontsize=10)
        pagina.insert_text((40, 78), "Capitulo sintetico", fontname="hebo", fontsize=24)
        pagina.insert_text((58, 115), "O primeiro paragrafo apresenta o tema.", fontsize=12)
        pagina.insert_text((40, 132), "A linha seguinte permanece no mesmo paragrafo.", fontsize=12)
        pagina.insert_text((58, 170), "Esta passagem chama a nota", fontsize=12)
        pagina.insert_text((218, 164), "1", fontsize=7)
        pagina.insert_text((58, 215), "Temos compostos well-being e palavras upfront.", fontsize=12)
        pagina.insert_text((58, 650), "Um paragrafo continua e termina em up-", fontsize=12)
        pagina.insert_text((58, 745), "1 Esta nota fica separada do corpo.", fontsize=9)
        pagina.insert_text((40, 758), "E continua na linha de baixo.", fontsize=9)
        pagina = documento.new_page()
        pagina.insert_text((40, 30), "Cabecalho corrente 2", fontsize=10)
        pagina.insert_text((40, 80), "front sem perder sua origem.", fontsize=12)
        pagina.insert_text((58, 120), "Um segundo paragrafo inicia aqui.", fontsize=12)
        pagina.insert_text((40, 137), "Ele tem texto suficiente para determinar a fonte do corpo.", fontsize=12)
        pagina.insert_text((58, 168), "Um composto aparece como well-", fontsize=12)
        pagina.insert_text((40, 185), "being nesta outra linha.", fontsize=12)
        pagina.draw_rect(pymupdf.Rect(80, 235, 260, 315))
        pagina.insert_text((80, 333), "Figura 1. Retangulo vetorial.", fontsize=10)
        pagina.insert_text((90, 390), "x = y + 2", fontsize=12)
        for x in (60, 160, 260):
            pagina.draw_line((x, 450), (x, 510))
        for y in (450, 480, 510):
            pagina.draw_line((60, y), (260, y))
        pagina.insert_text((70, 470), "Coluna A", fontsize=10)
        pagina.insert_text((170, 470), "Coluna B", fontsize=10)
        pagina.insert_text((70, 500), "Valor 1", fontsize=10)
        pagina.insert_text((170, 500), "Valor 2", fontsize=10)
        documento.fullcopy_page(1)
        documento.save(caminho)
    return caminho
