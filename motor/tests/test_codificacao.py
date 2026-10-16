"""Codificação de TXT/Markdown: BOM de UTF-8/UTF-16 e Windows-1252 avisado, sem substituição silenciosa (I-01)."""

import pytest

from margem_motor.ingest import canonizar
from test_ingest import validar

TEXTO = '# Título “curto”\n\nAção, café e maçã — ok.\n\n## Seção\n\nFim.\n'
ESPERADO = [('capitulo', 'Título “curto”'), ('paragrafo', 'Ação, café e maçã — ok.'), ('secao', 'Seção'), ('paragrafo', 'Fim.')]


@pytest.mark.parametrize('codificacao,prefixo', [
    ('utf-8', b''), ('utf-8', b'\xef\xbb\xbf'), ('utf-16-le', b'\xff\xfe'), ('utf-16-be', b'\xfe\xff'), ('cp1252', b'')])
@pytest.mark.parametrize('formato', ['md', 'txt'])
def test_bom_e_windows_1252_dao_o_mesmo_texto(tmp_path, codificacao, prefixo, formato):
    entrada = tmp_path / f'entrada.{formato}'
    entrada.write_bytes(prefixo + TEXTO.encode(codificacao))
    c, relatorio = canonizar(entrada, formato, tmp_path / 'saida')
    blocos = [(b['tipo'], b['texto']) for b in c['blocos']]
    if formato == 'md':
        # O BOM não estraga o primeiro título.
        assert blocos == ESPERADO
    else:
        assert blocos[1:] == [('paragrafo', '# Título “curto”'), ('paragrafo', 'Ação, café e maçã — ok.'),
                              ('paragrafo', '## Seção'), ('paragrafo', 'Fim.')]
    assert all('﻿' not in b['texto'] and '�' not in b['texto'] for b in c['blocos'])
    legada = [l for l in relatorio['limites'] if l['tipo'] == 'codificacao_legada']
    assert bool(legada) == (codificacao == 'cp1252')
    validar(tmp_path / 'saida/canonico.json')


def test_utf8_sem_bom_continua_igual(tmp_path):
    entrada = tmp_path / 'a.md'
    entrada.write_bytes(TEXTO.encode('utf-8'))
    c, _ = canonizar(entrada, 'md', tmp_path / 'saida')
    assert not any(l.startswith('codificacao_legada') for l in c['limites'])
    assert c['blocos'][0]['origens'] == [{'tipo': 'texto', 'linha_inicio': 1, 'linha_fim': 1}]


@pytest.mark.parametrize('conteudo,mensagem', [
    # 0x81 e 0x8D não existem em Windows-1252: nada de trocar por "�" em silêncio.
    (b'Texto \x81\x8d quebrado \xff', 'nem em Windows-1252'),
    (b'\xff\xfe' + 'ok'.encode('utf-16-le') + b'\x00', 'UTF-16 LE'),
    (b'\xef\xbb\xbfcaf\xe9', 'UTF-8'),
])
def test_codificacao_ilegivel_falha_sem_substituir(tmp_path, conteudo, mensagem):
    entrada = tmp_path / 'ruim.txt'
    entrada.write_bytes(conteudo)
    with pytest.raises(ValueError, match=mensagem):
        canonizar(entrada, 'txt', tmp_path / 'saida')
    assert not (tmp_path / 'saida').exists()
