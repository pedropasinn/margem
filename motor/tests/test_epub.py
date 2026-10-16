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


XHTML = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>{}</body></html>'
CAPITULOS = {
    'capa.xhtml': '<div class="cover"><img src="capa.jpg"/></div>',
    'c01.xhtml': '<div><h1 class="chapter_num" id="c01">1</h1></div><h1 class="chapter_title">O DESAFIO DO FUTURO</h1>'
                 '<p>Abertura do capítulo.</p><h2>PENSAMENTO</h2><p>Corpo.</p><h3>Detalhe</h3><p>Mais.</p>',
    'c02.xhtml': '<h1>2</h1><h1>FESTA DE 1999</h1><p>Texto dois.</p><p id="meio">Começo do terceiro.</p><p>Fim.</p>',
}


def epub_com_sumario(tmp_path, sumario='ncx', ncx_pontos=None, nav_itens=None, capitulos=CAPITULOS):
    """OPF e NCX na raiz, XHTML em OEBPS/ (como os EPUB 2 da Crown); ou EPUB 3 com nav em OEBPS/."""
    memoria = BytesIO()
    with ZipFile(memoria, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip')
        z.writestr('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="livro.opf"/></rootfiles></container>')
        itens = ''.join(f'<item id="i{n}" href="OEBPS/{a}" media-type="application/xhtml+xml"/>' for n, a in enumerate(capitulos))
        refs = ''.join(f'<itemref idref="i{n}"/>' for n in range(len(capitulos)))
        toc = ''
        if sumario == 'ncx':
            itens += '<item id="ncx" href="livro.ncx" media-type="application/x-dtbncx+xml"/>'
            toc = ' toc="ncx"'
            pontos = ncx_pontos if ncx_pontos is not None else [
                ('Capa', 'OEBPS/capa.xhtml', []), ('1. O Desafio do Futuro', 'OEBPS/c01.xhtml', []),
                ('2. Festa de 1999', 'OEBPS/c02.xhtml', []), ('3. O Meio', 'OEBPS/c02.xhtml#meio', []),
                ('Sumiu', 'OEBPS/nao-existe.xhtml', [])]

            def ponto(titulo, src, filhos):
                return (f'<navPoint><navLabel><text>{titulo}</text></navLabel><content src="{src}"/>'
                        + ''.join(ponto(*f) for f in filhos) + '</navPoint>')
            z.writestr('livro.ncx', '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>'
                       + ''.join(ponto(*p) for p in pontos) + '</navMap></ncx>')
        elif sumario == 'nav':
            itens += '<item id="nav" href="OEBPS/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
            refs = '<itemref idref="nav"/>' + refs

            def item(titulo, href, filhos):
                return (f'<li><a href="{href}">{titulo}</a>'
                        + (f'<ol>{"".join(item(*f) for f in filhos)}</ol>' if filhos else '') + '</li>')
            z.writestr('OEBPS/nav.xhtml', XHTML.format('<nav epub:type="landmarks"><ol><li><a href="capa.xhtml">Capa</a></li></ol></nav>'
                       '<nav epub:type="toc"><h1>Sumário</h1><ol>' + ''.join(item(*i) for i in nav_itens) + '</ol></nav>'))
        z.writestr('livro.opf', f'''<package xmlns="http://www.idpf.org/2007/opf" version="{'3.0' if sumario == 'nav' else '2.0'}">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Livro</dc:title><dc:language>pt</dc:language></metadata>
        <manifest>{itens}</manifest><spine{toc}>{refs}</spine></package>''')
        for arquivo, corpo in capitulos.items():
            z.writestr(f'OEBPS/{arquivo}', XHTML.format(corpo))
    tmp_path.mkdir(parents=True, exist_ok=True)
    entrada = tmp_path / f'{sumario}.epub'
    entrada.write_bytes(memoria.getvalue())
    return canonizar(entrada, 'epub', tmp_path / f'saida-{sumario}')


def estrutura(c):
    blocos = {b['id']: b for b in c['blocos']}
    return [(s['nivel'], s['titulo'], blocos[s['bloco_inicio']]['texto']) for s in c['secoes']]


def test_epub_ncx_na_raiz_manda_nos_capitulos(tmp_path):
    c, relatorio = epub_com_sumario(tmp_path)
    assert estrutura(c) == [
        (1, '1. O Desafio do Futuro', '1. O Desafio do Futuro'),
        (2, 'PENSAMENTO', 'PENSAMENTO'),
        (3, 'Detalhe', 'Detalhe'),
        (1, '2. Festa de 1999', '2. Festa de 1999'),
        (1, '3. O Meio', '3. O Meio'),
    ]
    # Número e nome do capítulo viram um só título, com o texto e as duas origens do original.
    titulo = c['blocos'][0]
    assert titulo['tipo'] == 'capitulo'
    assert [o['xpath'] for o in titulo['origens']] == ['/html/body/div[1]/h1[1]', '/html/body/h1[1]']
    # Âncora no meio do arquivo: cabeçalho do sumário antes do parágrafo, sem tocar no corpo.
    meio = [b['texto'] for b in c['blocos']]
    assert meio[meio.index('3. O Meio') + 1] == 'Começo do terceiro.'
    assert [b['texto'] for b in c['blocos'] if b['tipo'] not in {'capitulo', 'secao'}] == [
        'Abertura do capítulo.', 'Corpo.', 'Mais.', 'Texto dois.', 'Começo do terceiro.', 'Fim.']
    tipos = [l['tipo'] for l in relatorio['limites']]
    assert 'sumario_sem_texto' in tipos and 'sumario_destino_nao_resolvido' in tipos
    validar(tmp_path / 'saida-ncx/canonico.json')


def test_epub3_nav_com_subnivel_e_elementos_iniciais(tmp_path):
    capitulos = {'pre.xhtml': '<p>Dedicatória.</p>', **CAPITULOS,
                 'c01.xhtml': CAPITULOS['c01.xhtml'].replace('<h2>', '<h2 id="pens">')}
    c, _ = epub_com_sumario(tmp_path, 'nav', capitulos=capitulos, nav_itens=[
        ('1. O Desafio', 'c01.xhtml', [('Pensamento', 'c01.xhtml#pens', [])]), ('2. Festa de 1999', 'c02.xhtml', [])])
    assert estrutura(c) == [
        (1, 'Elementos iniciais', 'Elementos iniciais'),
        (1, '1. O Desafio', '1. O Desafio'),
        (2, 'Pensamento', 'Pensamento'),
        (3, 'Detalhe', 'Detalhe'),
        (1, '2. Festa de 1999', '2. Festa de 1999'),
    ]
    textos = [b['texto'] for b in c['blocos']]
    # "1. O Desafio" não tem as palavras do h1: o sumário ganha cabeçalho e o original fica logo abaixo.
    assert textos[2:4] == ['1. O Desafio', '1 O DESAFIO DO FUTURO']
    assert c['blocos'][3]['tipo'] == 'paragrafo'
    assert c['blocos'][2]['origens'] == c['blocos'][3]['origens'][:1]
    assert 'Sumário' not in textos and 'Capa' not in textos
    validar(tmp_path / 'saida-nav/canonico.json')


def test_epub_sem_sumario_util_fica_como_antes(tmp_path):
    sem, rel_sem = epub_com_sumario(tmp_path / 'a', sumario=None)
    um, rel_um = epub_com_sumario(tmp_path / 'b', ncx_pontos=[('1. Só um', 'OEBPS/c01.xhtml', [])])
    mesmo_arquivo, _ = epub_com_sumario(tmp_path / 'c', ncx_pontos=[
        ('A', 'OEBPS/c02.xhtml', []), ('B', 'OEBPS/c02.xhtml#nada', [])])
    sem_ids = lambda c: [{**b, 'id': ''} for b in c['blocos']]  # noqa: E731 (a semente é o sha do arquivo)
    for c in (um, mesmo_arquivo):
        assert estrutura(c) == estrutura(sem)
        assert sem_ids(c) == sem_ids(sem)
        assert c['limites'] == sem['limites']
    assert [s[1] for s in estrutura(sem)][:3] == ['1', 'O DESAFIO DO FUTURO', 'PENSAMENTO']
