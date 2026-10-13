"""Atualização concorrente não altera os módulos nem a identidade do processo iniciado."""
import json
from pathlib import Path
import shutil
import subprocess
import sys


def test_import_tardio_usa_snapshot_mesmo_depois_de_alterar_checkout(tmp_path):
    pacote = tmp_path / 'margem_motor'
    raiz = Path(__file__).resolve().parents[1] / 'margem_motor'
    shutil.copytree(raiz, pacote, ignore=shutil.ignore_patterns('__pycache__'))
    roteiro = '''
import json
from pathlib import Path
import margem_motor
from margem_motor.versao import identificar_motor
antes = identificar_motor()
# ids ainda não foi importado. Simula atualização do checkout, nunca dos fontes reais.
Path('margem_motor/ids.py').write_text('raise RuntimeError("arquivo alterado")')
from margem_motor.ids import identificar
print(json.dumps({'antes': antes, 'depois': identificar_motor(), 'id': identificar('a'*64, 'bloco', 0)}))
'''
    resultado = subprocess.run([sys.executable, '-c', roteiro], cwd=tmp_path, capture_output=True, text=True, check=True)
    dados = json.loads(resultado.stdout)
    assert dados['antes'] == dados['depois']
    assert len(dados['id']) == 26
    # Um processo novo enxerga a alteração e não executa silenciosamente o código antigo.
    novo = subprocess.run([sys.executable, '-c', 'import margem_motor.ids'], cwd=tmp_path, capture_output=True, text=True)
    assert novo.returncode != 0 and 'arquivo alterado' in novo.stderr
