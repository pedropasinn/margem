import json
import subprocess
from pathlib import Path

import pymupdf
from margem_motor.ingest import canonizar
from margem_motor.blocos import Bloco, juntar, normalizar_ligaturas_do_bloco


def test_observacao_antes_das_heuristicas_e_determinismo(tmp_path):
    entrada = tmp_path / 'fonte.pdf'
    pdf = pymupdf.open()
    for numero in (1, 2):
        pagina = pdf.new_page()
        pagina.insert_text((50, 35), 'Cabecalho repetido', fontsize=10)
        pagina.insert_text((400, 35), str(numero), fontsize=10)
        pagina.insert_text((50, 160), 'Uma linha observada.', fontsize=12)
        pagina.insert_text((50, 180), 'Outra linha observada.', fontsize=12)
    pdf.save(entrada)
    pdf.close()
    antes = entrada.read_bytes()
    for nome in ('a', 'b'):
        c, _ = canonizar(entrada, 'pdf', tmp_path / nome)
        p = json.loads((tmp_path / nome / 'proveniencia.json').read_text())
        assert p['hash_estrutural'] == c['hash_estrutural']
        assert any(o['texto'] == 'Cabecalho repetido' for o in p['observacoes'])
        assert any(t['regra'] == 'cabecalho_heuristica_legada' for t in p['transformacoes'])
        assert all(o['texto'] == ''.join(s['texto'] for s in o['spans']) for o in p['observacoes'])
    assert entrada.read_bytes() == antes
    assert (tmp_path / 'a/proveniencia.json').read_bytes() == (tmp_path / 'b/proveniencia.json').read_bytes()
    raiz = Path(__file__).resolve().parents[2]
    js = "import {readFileSync} from 'node:fs'; import {validarProveniencia} from './contratos/src/index.ts'; if(!validarProveniencia(JSON.parse(readFileSync(process.argv[1],'utf8')))) process.exit(1);"
    teste = subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e', js, str(tmp_path / 'a/proveniencia.json')], cwd=raiz, capture_output=True)
    assert teste.returncode == 0, teste.stderr.decode()


def test_registra_hifen_e_ligatura_sem_perder_eventos_na_juncao():
    a = Bloco('paragrafo', 'up-')
    b = Bloco('paragrafo', 'front ﬁm')
    normalizar_ligaturas_do_bloco(b)
    juntar(a, b, {'upfront'})
    assert a.texto == 'upfront fim'
    assert {t['regra'] for t in a.transformacoes} == {'hifen_remover', 'ligaturas_tipograficas'}
