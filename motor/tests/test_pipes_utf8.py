"""Protocolos por pipe em UTF-8, qualquer que seja a codepage do sistema (W-03)."""

import json
import os
from pathlib import Path
import subprocess
import sys

import pymupdf
import pytest

RAIZ = Path(__file__).resolve().parents[2]


def pedido_com_acentos(tmp_path) -> tuple[dict, Path]:
    pasta = tmp_path / 'João Silva'
    pasta.mkdir()
    original = pasta / 'ação.pdf'
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((58, 115), 'A tese central aparece aqui.', fontsize=12)
        pdf.save(original)
    with pymupdf.open(original) as pdf:
        r = pdf[0].search_for('tese central')[0]
    quad = [r.x0, r.y0, r.x1, r.y0, r.x1, r.y1, r.x0, r.y1]
    saida = pasta / 'saída anotada.pdf'
    return {'entrada': str(original), 'saida': str(saida), 'anotacoes': [
        {'tipo': 'nota', 'pagina': 1, 'quads': [quad], 'cor': '#52ABFF', 'autor': 'Margem', 'assunto': 'Dúvida',
         'texto': 'Por que “isso”? ação 🧭 Ω'}]}, saida


@pytest.mark.parametrize('forma', ['modulo', 'cli'])
def test_pdf_anotado_le_o_pipe_em_utf8_em_qualquer_codepage(tmp_path, forma):
    """W-03: como no Windows sem modo UTF-8, o Python do motor começa com stdin/stdout em cp1252."""
    pedido, saida = pedido_com_acentos(tmp_path)
    comando = ([sys.executable, '-m', 'margem_motor.pdf_anotado'] if forma == 'modulo'
               else [sys.executable, str(RAIZ / 'motor' / 'empacotar' / 'cli.py'), 'pdf-anotado'])
    ambiente = {**os.environ, 'PYTHONIOENCODING': 'cp1252', 'PYTHONUTF8': '0'}
    resultado = subprocess.run(comando, cwd=RAIZ / 'motor', input=json.dumps(pedido, ensure_ascii=False).encode('utf-8'),
                               capture_output=True, env=ambiente, check=False)
    assert resultado.returncode == 0, resultado.stderr.decode('utf-8', 'replace')
    assert json.loads(resultado.stdout.decode('utf-8')) == {'grifos': 0, 'notas': 1}
    with pymupdf.open(saida) as pdf:
        (nota,) = list(pdf[0].annots())
        assert nota.info['content'] == 'Por que “isso”? ação 🧭 Ω'
        assert nota.info['subject'] == 'Dúvida'


def test_cli_escreve_erros_em_utf8(tmp_path):
    ambiente = {**os.environ, 'PYTHONIOENCODING': 'cp1252', 'PYTHONUTF8': '0'}
    resultado = subprocess.run([sys.executable, str(RAIZ / 'motor' / 'empacotar' / 'cli.py'), 'ingest',
                                '--entrada', str(tmp_path / 'não-existe.md'), '--formato', 'md',
                                '--saida', str(tmp_path / 'saída')], capture_output=True, env=ambiente, check=False)
    assert resultado.returncode == 1
    assert 'Falha na canonização' in resultado.stderr.decode('utf-8')
    assert 'não-existe.md' in resultado.stderr.decode('utf-8')
