"""O sumário que o próprio arquivo declara (J164), lido para a conferência do sumário."""
import json
import subprocess
import sys
from pathlib import Path

import pymupdf

from margem_motor.sumario_original import principal, sumario_original
from test_epub import epub_com_sumario


def test_epub_ncx_e_nav_dao_titulos_e_niveis(tmp_path):
    epub_com_sumario(tmp_path)
    assert sumario_original(str(tmp_path / 'ncx.epub'), 'epub') == [
        {'nivel': 1, 'titulo': 'Capa'}, {'nivel': 1, 'titulo': '1. O Desafio do Futuro'},
        {'nivel': 1, 'titulo': '2. Festa de 1999'}, {'nivel': 1, 'titulo': '3. O Meio'}, {'nivel': 1, 'titulo': 'Sumiu'}]
    epub_com_sumario(tmp_path, 'nav', nav_itens=[('1. O Desafio', 'c01.xhtml', [('Pensamento', 'c01.xhtml#pens', [])])])
    assert sumario_original(str(tmp_path / 'nav.epub'), 'epub') == [
        {'nivel': 1, 'titulo': '1. O Desafio'}, {'nivel': 2, 'titulo': 'Pensamento'}]


def test_pdf_toc_e_arquivos_sem_sumario(tmp_path):
    documento = pymupdf.open()
    for _ in range(2):
        documento.new_page()
    documento.set_toc([[1, 'Introdução', 1], [2, '  Um   detalhe ', 1], [1, 'Fim', 2]])
    documento.save(tmp_path / 'com-toc.pdf')
    assert sumario_original(str(tmp_path / 'com-toc.pdf'), 'pdf') == [
        {'nivel': 1, 'titulo': 'Introdução'}, {'nivel': 2, 'titulo': 'Um detalhe'}, {'nivel': 1, 'titulo': 'Fim'}]
    epub_com_sumario(tmp_path, 'nenhum')
    assert sumario_original(str(tmp_path / 'nenhum.epub'), 'epub') == []
    (tmp_path / 'quebrado.epub').write_bytes(b'nao e zip')
    assert sumario_original(str(tmp_path / 'quebrado.epub'), 'epub') == []
    assert sumario_original(str(tmp_path / 'ausente.pdf'), 'pdf') == []
    assert sumario_original(str(tmp_path / 'com-toc.pdf'), 'md') == []


def test_linha_de_comando_imprime_json(tmp_path, capsys):
    epub_com_sumario(tmp_path)
    assert principal(['--entrada', str(tmp_path / 'ncx.epub'), '--formato', 'epub']) == 0
    saida = json.loads(capsys.readouterr().out)
    assert [e['titulo'] for e in saida['entradas']][:2] == ['Capa', '1. O Desafio do Futuro']
    processo = subprocess.run([sys.executable, '-m', 'margem_motor.sumario_original', '--entrada', str(tmp_path / 'ncx.epub'),
                               '--formato', 'epub'], capture_output=True, text=True, check=True,
                               cwd=Path(__file__).resolve().parents[1])
    assert json.loads(processo.stdout) == saida
