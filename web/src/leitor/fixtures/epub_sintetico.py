"""EPUB sintético do J163: notas de rodapé (no mesmo arquivo e noutro), tabela e figuras.

Monta o livro e, com `--canonico`, passa pelo motor e grava o canônico que os testes do leitor usam
(`epub-sintetico.json`). As capturas do J163 importam o mesmo EPUB pelo serviço.

  PYTHONPATH=motor motor/.venv/bin/python web/src/leitor/fixtures/epub_sintetico.py /tmp/livro.epub \\
      --canonico web/src/leitor/fixtures/epub-sintetico.json
"""

import argparse
import json
import shutil
import tempfile
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pymupdf

XHTML = ('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="pt-BR">'
         '<head><title>{titulo}</title></head><body>{corpo}</body></html>')

CAPITULO = (
    '<h1>O ofício da leitura</h1>'
    '<p id="r1">Ler devagar é um hábito que se aprende. Quem anota à margem conversa com o texto e volta a ele '
    'com outra pergunta<a epub:type="noteref" href="#n1">1</a>; quem só sublinha costuma reencontrar, meses depois, '
    'trechos que já não sabe por que marcou.</p>'
    '<p id="r2">Os leitores de outros séculos tinham cadernos de lugares-comuns, onde copiavam frases e as '
    'organizavam por tema<a epub:type="noteref" href="notas.xhtml#n2">2</a>. A tabela abaixo resume um pequeno '
    'registro de horas de leitura.</p>'
    '<table id="t1"><caption>Tabela 1. Horas de leitura por semana</caption>'
    '<thead><tr><th>Leitor</th><th>Manhã</th><th>Noite</th></tr></thead>'
    '<tbody><tr><td>Ana</td><td>3 h</td><td>5 h</td></tr><tr><td>Bruno</td><td>1 h</td><td>6 h</td></tr>'
    '<tr><td>Carla</td><td>4 h</td><td>2 h</td></tr></tbody></table>'
    '<p>A figura a seguir mostra como as anotações se distribuem ao longo de um capítulo.</p>'
    '<div class="figura"><img src="img/anotacoes.png" alt="Gráfico de barras com anotações por página"/></div>'
    '<p>Uma ilustração sem descrição, como as que muitos livros trazem:</p>'
    '<div class="figura"><img src="img/ornamento.png" alt=""/></div>'
    '<p>E uma figura cujo arquivo o leitor não consegue exibir:</p>'
    '<div class="figura"><img src="img/vetor.svg" alt="Esquema vetorial do caderno"/></div>'
    '<aside epub:type="footnote" id="n1"><p><a href="#r1">1</a> A pergunta muda porque o leitor mudou: '
    'a nota registra o primeiro encontro.</p></aside>'
)

NOTAS = (
    '<h1>Notas</h1>'
    '<p id="n2"><sup><a href="capitulo.xhtml#r2">2</a></sup> Os cadernos de lugares-comuns foram comuns entre '
    'estudantes e escritores do Renascimento ao século XIX; cada página reunia citações sob um título.</p>'
)


def png(largura: int, altura: int, barras: list[tuple[int, int, tuple[int, int, int]]], fundo=(246, 246, 246)) -> bytes:
    """PNG de verdade gerado aqui: retângulos sobre um fundo claro (um gráfico de barras simples)."""
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, largura, altura), False)
    pixmap.set_rect(pixmap.irect, fundo)
    for x, h, cor in barras:
        pixmap.set_rect(pymupdf.IRect(x, altura - 16 - h, x + 28, altura - 16), cor)
    pixmap.set_rect(pymupdf.IRect(12, altura - 16, largura - 12, altura - 14), (120, 120, 120))
    return pixmap.tobytes('png')


def montar(destino: Path) -> Path:
    paginas = {'capitulo.xhtml': ('O ofício da leitura', CAPITULO), 'notas.xhtml': ('Notas', NOTAS)}
    grafico = png(360, 200, [(24 + i * 44, h, (90, 90, 90) if i != 3 else (178, 107, 0)) for i, h in enumerate([60, 110, 80, 150, 95, 40, 70])])
    ornamento = png(160, 60, [(66, 24, (150, 150, 150))])
    memoria = BytesIO()
    with ZipFile(memoria, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip')
        z.writestr('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OPS/livro.opf"/></rootfiles></container>')
        itens = ''.join(f'<item id="i{n}" href="{a}" media-type="application/xhtml+xml"/>' for n, a in enumerate(paginas))
        refs = ''.join(f'<itemref idref="i{n}"/>' for n in range(len(paginas)))
        z.writestr('OPS/livro.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
                   '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Caderno de leitura</dc:title>'
                   '<dc:creator>Margem (sintético)</dc:creator><dc:language>pt-BR</dc:language></metadata>'
                   f'<manifest>{itens}</manifest><spine>{refs}</spine></package>')
        for arquivo, (titulo, corpo) in paginas.items():
            z.writestr(f'OPS/{arquivo}', XHTML.format(titulo=titulo, corpo=corpo))
        z.writestr('OPS/img/anotacoes.png', grafico)
        z.writestr('OPS/img/ornamento.png', ornamento)
        z.writestr('OPS/img/vetor.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    destino.write_bytes(memoria.getvalue())
    return destino


def main() -> None:
    argumentos = argparse.ArgumentParser()
    argumentos.add_argument('epub')
    argumentos.add_argument('--canonico')
    opcoes = argumentos.parse_args()
    epub = montar(Path(opcoes.epub))
    if opcoes.canonico:
        from margem_motor.ingest import canonizar
        saida = Path(tempfile.mkdtemp(prefix='margem-j163-'))
        try:
            canonico, _ = canonizar(epub, 'epub', saida / 'saida')
        finally:
            shutil.rmtree(saida, ignore_errors=True)
        Path(opcoes.canonico).write_text(json.dumps(canonico, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
