from io import BytesIO
from zipfile import ZipFile

import pytest

from margem_motor.ingest import canonizar
from test_ingest import validar


def epub(versao='3.0', drm=False, href='cap%20um.xhtml', fontes=False):
    memoria = BytesIO()
    capa_item = '<item id="capa" href="capa.svg" media-type="image/svg+xml"/>' if fontes else ''
    capa_ref = '<itemref idref="capa"/>' if fontes else ''
    with ZipFile(memoria, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip')
        z.writestr('META-INF/container.xml', '''<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>
        <rootfile full-path="OPS/livro.opf"/></rootfiles></container>''')
        z.writestr('OPS/livro.opf', f'''<package xmlns="http://www.idpf.org/2007/opf" version="{versao}">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Livro 🧭</dc:title><dc:creator>Autora</dc:creator>
        <dc:language>pt-BR</dc:language></metadata><manifest>
        <item id="segundo" href="fim.xhtml" media-type="application/xhtml+xml"/>{capa_item}
        <item id="primeiro" href="{href}" media-type="application/xhtml+xml"/></manifest>
        <spine>{capa_ref}<itemref idref="primeiro"/><itemref idref="segundo"/></spine></package>''')
        z.writestr('OPS/cap um.xhtml', '''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
        <head><title>Não duplicar</title></head><body><h1>Primeiro</h1><p>🧭&nbsp;café &amp; ﬁ <em>literal</em>.</p>
        <h2>Seção</h2><h3>Detalhe</h3><ul><li>Um</li><li><p>Dois</p></li></ul>
        <blockquote><p>Citação.</p></blockquote><aside epub:type="footnote"><p>1 Nota.</p></aside>
        <img src="capa.png"/><script>Não executar</script></body></html>''')
        z.writestr('OPS/fim.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Segundo</h1><p>Fim.</p></body></html>')
        if fontes:
            z.writestr('OPS/capa.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
            z.writestr('META-INF/encryption.xml', '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OPS/fonte.otf"/></CipherData></EncryptedData></encryption>')
        if drm:
            z.writestr('META-INF/encryption.xml', '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><CipherData><CipherReference URI="OPS/cap um.xhtml"/></CipherData></EncryptedData></encryption>')
    return memoria.getvalue()


@pytest.mark.parametrize('versao', ['2.0', '3.0'])
def test_epub_spine_metadados_estrutura_e_determinismo(tmp_path, versao):
    entrada = tmp_path / 'entrada.epub'
    original = epub(versao)
    entrada.write_bytes(original)
    c, relatorio = canonizar(entrada, 'epub', tmp_path / 'saida')
    repetido, _ = canonizar(entrada, 'epub', tmp_path / 'repetido')
    assert c == repetido
    assert entrada.read_bytes() == original
    assert c['documento'] | {'sha256_original': ''} == {
        'titulo': 'Livro 🧭', 'autor': 'Autora', 'idioma': 'pt', 'formato': 'epub', 'sha256_original': ''}
    assert [b['texto'] for b in c['blocos']] == [
        'Primeiro', '🧭 café & ﬁ literal.', 'Seção', 'Detalhe', 'Um', 'Dois', 'Citação.', '1 Nota.', 'Segundo', 'Fim.']
    assert [s['nivel'] for s in c['secoes']] == [1, 2, 3, 1]
    assert [b['tipo'] for b in c['blocos']][4:8] == ['lista', 'lista', 'citacao', 'nota_rodape']
    assert c['blocos'][1]['origens'] == [{'tipo': 'epub', 'arquivo': 'OPS/cap um.xhtml', 'xpath': '/html/body/p[1]'}]
    assert any(l['tipo'] == 'imagens_epub' for l in relatorio['limites'])
    validar(tmp_path / 'saida/canonico.json')
    alterado, _ = canonizar(entrada, 'epub', tmp_path / 'alterado', titulo='Manual', autor='Outro', idioma='en')
    assert alterado['documento']['titulo'] == 'Manual'
    assert alterado['documento']['autor'] == 'Outro'
    assert alterado['documento']['idioma'] == 'en'


def test_epub_drm_sem_publicacao(tmp_path):
    entrada = tmp_path / 'drm.epub'
    entrada.write_bytes(epub(drm=True))
    with pytest.raises(ValueError, match='DRM'):
        canonizar(entrada, 'epub', tmp_path / 'saida')
    assert not (tmp_path / 'saida').exists()


@pytest.mark.parametrize('conteudo', [b'invalido', epub(href='../../fora.xhtml')])
def test_epub_invalido_ou_referencia_externa(tmp_path, conteudo):
    entrada = tmp_path / 'invalido.epub'
    entrada.write_bytes(conteudo)
    with pytest.raises(ValueError, match='EPUB'):
        canonizar(entrada, 'epub', tmp_path / 'saida')


def test_epub_fontes_ofuscadas_e_capa_svg_no_spine(tmp_path):
    entrada = tmp_path / 'fontes.epub'
    entrada.write_bytes(epub(fontes=True))
    c, relatorio = canonizar(entrada, 'epub', tmp_path / 'saida')
    assert c['blocos'][0]['texto'] == 'Primeiro'
    assert any('capa.svg' in l['descricao'] for l in relatorio['limites'])


def test_epub_com_entradas_demais(tmp_path):
    memoria = BytesIO()
    with ZipFile(memoria, 'w') as z:
        for i in range(10_001):
            z.writestr(f'x/{i}', '')
    entrada = tmp_path / 'muitas.epub'
    entrada.write_bytes(memoria.getvalue())
    with pytest.raises(ValueError, match='mais de 10000'):
        canonizar(entrada, 'epub', tmp_path / 'saida')
