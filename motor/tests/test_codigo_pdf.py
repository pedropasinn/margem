"""Regressões de fidelidade: expectativas vêm da fonte, não da saída anterior."""
import json

import pymupdf

from margem_motor.ingest import canonizar
from margem_motor.versao import identificar_motor
from test_ingest import validar, fatiar


def criar_pdf(entrada, linhas):
    with pymupdf.open() as pdf:
        pagina = pdf.new_page()
        pagina.insert_text((60, 100), 'Texto normal para determinar a fonte predominante do corpo e explicar o exemplo.', fontsize=12)
        for x, y, texto in linhas:
            pagina.insert_text((x, y), texto, fontsize=10, fontname='cour')
        pdf.save(entrada)


def test_codigo_preserva_linhas_operador_e_reconstroi_recuo_com_aviso(tmp_path):
    entrada = tmp_path / 'codigo.pdf'
    criar_pdf(entrada, [(60, 150, 'if ativo:'), (84, 164, 'executar()'),
                       (60, 178, 'total = primeiro-'), (60, 192, 'segundo')])
    original = entrada.read_bytes()
    c, r = canonizar(entrada, 'pdf', tmp_path / 'saida', titulo='Livro')
    bloco = next(b for b in c['blocos'] if b['tipo'] == 'codigo')
    assert bloco['texto'] == 'if ativo:\n    executar()\ntotal = primeiro-\nsegundo'
    assert any(l['tipo'] == 'recuo_codigo_inferido' for l in r['limites'])
    assert [fatiar(bloco['texto'], o['inicio'], o['fim']) for o in bloco['origens']] == [
        'if ativo:', 'executar()', 'total = primeiro-', 'segundo']
    assert entrada.read_bytes() == original
    validar(tmp_path / 'saida' / 'canonico.json')
    g = json.loads((tmp_path / 'saida' / 'geometria.json').read_text())
    assert any(p['bloco_id'] == bloco['id'] for p in g['palavras'])


def test_espacos_observados_nao_sao_aparados_e_saida_e_determinista(tmp_path):
    entrada = tmp_path / 'codigo.pdf'
    criar_pdf(entrada, [(60, 150, 'if ativo:'), (60, 164, '    executar()  '),
                       (60, 178, 'total = primeiro-'), (60, 192, 'segundo')])
    for nome in ('um', 'dois'):
        c, r = canonizar(entrada, 'pdf', tmp_path / nome, titulo='Livro')
        assert next(b['texto'] for b in c['blocos'] if b['tipo'] == 'codigo') == (
            'if ativo:\n    executar()  \ntotal = primeiro-\nsegundo')
        assert not any(l['tipo'] == 'recuo_codigo_inferido' for l in r['limites'])
        assert c['canonizacao']['motor'] == identificar_motor()
    for nome in ('canonico.json', 'geometria.json', 'relatorio.json'):
        assert (tmp_path / 'um' / nome).read_bytes() == (tmp_path / 'dois' / nome).read_bytes()


def test_codigo_literal_unicode_e_estilos_usam_offsets_utf16():
    from margem_motor.blocos import Bloco, Estilo, Fragmento
    from margem_motor.codigo_pdf import compor_codigo
    from margem_motor.pdf import Linha
    linhas = []
    for y, texto in [(100, '🧭 = "ﬁ"'), (114, '  café = 2-'), (128, '3')]:
        origem = {'tipo': 'pdf', 'pagina': 1, 'bbox': [60, y, 160, y + 10]}
        literal = Bloco('codigo', texto, [Estilo(0, len(texto), 'codigo')],
                        [Fragmento(origem, 0, len(texto))])
        linhas.append(Linha(literal, tuple(origem['bbox']), 10, False, False, True, 'Courier', literal))
    bloco = compor_codigo(linhas, []).json(0, {})
    assert bloco['texto'] == '🧭 = "ﬁ"\n  café = 2-\n3'
    assert [fatiar(bloco['texto'], o['inicio'], o['fim']) for o in bloco['origens']] == [l.bloco.texto for l in linhas]
    assert [fatiar(bloco['texto'], e['inicio'], e['fim']) for e in bloco['inline']] == [l.bloco.texto for l in linhas]


def test_identidade_do_motor_muda_com_o_codigo_sem_depender_de_git(tmp_path, monkeypatch):
    from margem_motor import versao
    (tmp_path / 'versao.py').write_text('implementacao A')
    monkeypatch.setattr(versao, '__file__', str(tmp_path / 'versao.py'))
    antes = versao.identificar_motor()
    assert antes == versao.identificar_motor()
    (tmp_path / 'versao.py').write_text('implementacao B')
    assert antes != versao.identificar_motor()
    assert 'fonte-sha256/' in antes


def test_composicao_de_prosa_recusa_codigo_por_construcao():
    import pytest
    from margem_motor.blocos import Bloco, juntar
    for destino, proximo in [('codigo', 'codigo'), ('paragrafo', 'codigo'), ('codigo', 'paragrafo')]:
        with pytest.raises(ValueError, match='composição literal'):
            juntar(Bloco(destino, 'a-'), Bloco(proximo, 'b'), set())


def test_listagem_proporcional_nao_classifica_prosa_da_mesma_fonte_como_codigo(tmp_path):
    entrada = tmp_path / 'listagem.pdf'
    with pymupdf.open() as pdf:
        p = pdf.new_page()
        p.insert_text((60, 100), 'Corpo predominante maior explicando o assunto com muitas palavras.', fontsize=12)
        p.insert_text((60, 114), 'Mais contexto do corpo antes do programa, distinguindo tipografia e papel.', fontsize=12)
        p.insert_text((60, 128), 'A listagem seguinte tem numeros alinhados com seus comandos.', fontsize=12)
        for i, texto in enumerate(['set seed 1', 'generate y = 2', 'generate x = 3', 'reg y x']):
            p.insert_text((60, 150+i*14), str(i+1), fontsize=10)
            p.insert_text((80, 150+i*14), texto, fontsize=10)
        p.insert_text((80, 206), 'continuacao_do_comando(' , fontsize=10)
        p.insert_text((80, 220), 'valor)' , fontsize=10)
        p.insert_text((60, 260), 'Texto explicativo da mesma fonte', fontsize=10)
        p.insert_text((60, 274), 'continua como prosa e nao como programa.', fontsize=10)
        pdf.save(entrada)
    c, _ = canonizar(entrada, 'pdf', tmp_path / 'saida', titulo='Livro')
    codigo = [b['texto'] for b in c['blocos'] if b['tipo'] == 'codigo']
    assert len(codigo) == 1
    assert codigo[0].splitlines() == ['1 set seed 1', '2 generate y = 2', '3 generate x = 3', '4 reg y x', 'continuacao_do_comando(', 'valor)']
    assert not any('Texto explicativo' in t for t in codigo)
    assert any('Texto explicativo da mesma fonte continua como prosa' in b['texto'] for b in c['blocos'])


def test_sobrescrito_conserva_caractere_e_fragmento_geometrico(tmp_path):
    entrada = tmp_path / 'sobrescrito.pdf'
    with pymupdf.open() as pdf:
        p = pdf.new_page()
        p.insert_text((60, 100), 'Texto do corpo para determinar a fonte predominante, fora da listagem.', fontsize=12)
        p.insert_text((60, 150), 'valor', fontname='cour', fontsize=12)
        p.insert_text((96, 144), '2', fontname='cour', fontsize=6)
        pdf.save(entrada)
    c, _ = canonizar(entrada, 'pdf', tmp_path / 'saida', titulo='Livro')
    b = next(b for b in c['blocos'] if b['tipo'] == 'codigo')
    assert b['texto'] == 'valor2'
    assert [fatiar(b['texto'], o['inicio'], o['fim']) for o in b['origens']] == ['valor', '2']
    g = json.loads((tmp_path / 'saida' / 'geometria.json').read_text())
    quads = [p for p in g['palavras'] if p['bloco_id'] == b['id']]
    assert any(p['inicio_utf16'] == 5 and p['fim_utf16'] == 6 for p in quads)
    assert not any(b['id'] in limite for limite in c['limites'])
    validar(tmp_path / 'saida' / 'canonico.json')


def test_intervalo_vertical_nao_apaga_referencia_do_recuo(tmp_path):
    entrada = tmp_path / 'intervalo.pdf'
    criar_pdf(entrada, [(60, 150, 'if ativo:'), (84, 185, 'executar()')])
    c, r = canonizar(entrada, 'pdf', tmp_path / 'saida', titulo='Livro')
    assert [b['texto'] for b in c['blocos'] if b['tipo'] == 'codigo'] == ['if ativo:', '    executar()']
    assert {'codigo_separado_por_intervalo', 'recuo_codigo_inferido'} <= {l['tipo'] for l in r['limites']}
    validar(tmp_path / 'saida' / 'canonico.json')
