"""EPUB: tabelas, imagens, notas de rodapé e layout fixo (J160: I-02, I-03, I-05, layout fixo)."""

import hashlib
from io import BytesIO
from zipfile import ZipFile

import pymupdf
import pytest

from margem_motor.ingest import canonizar
from test_ingest import validar

XHTML = ('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
         '<body>{}</body></html>')


def png(cor=(1, 0, 0)) -> bytes:
    """PNG pequeno de verdade (assinatura e conteúdo), gerado no teste."""
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 3), False)
    pixmap.set_rect(pixmap.irect, tuple(int(c * 255) for c in cor))
    return pixmap.tobytes('png')


def montar(tmp_path, paginas: dict[str, str], extras: dict[str, bytes] | None = None,
           metadados: str = '', propriedades: str = '', nome: str = 'livro'):
    """EPUB 3 mínimo: OPF em OPS/, um XHTML por página, na ordem do dicionário."""
    memoria = BytesIO()
    with ZipFile(memoria, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip')
        z.writestr('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OPS/livro.opf"/></rootfiles></container>')
        itens = ''.join(f'<item id="i{n}" href="{a}" media-type="application/xhtml+xml"/>' for n, a in enumerate(paginas))
        refs = ''.join(f'<itemref idref="i{n}"{propriedades}/>' for n in range(len(paginas)))
        z.writestr('OPS/livro.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
                   '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Livro</dc:title>'
                   f'<dc:language>pt</dc:language>{metadados}</metadata>'
                   f'<manifest>{itens}</manifest><spine>{refs}</spine></package>')
        for arquivo, corpo in paginas.items():
            z.writestr(f'OPS/{arquivo}', XHTML.format(corpo))
        for arquivo, dados in (extras or {}).items():
            z.writestr(f'OPS/{arquivo}', dados)
    entrada = tmp_path / f'{nome}.epub'
    entrada.write_bytes(memoria.getvalue())
    return entrada


def canonizar_epub(tmp_path, *args, **kwargs):
    entrada = montar(tmp_path, *args, **kwargs)
    saida = tmp_path / f'saida-{entrada.stem}'
    c, relatorio = canonizar(entrada, 'epub', saida)
    validar(saida / 'canonico.json')
    return c, relatorio, saida


def test_tabela_nao_cola_celulas_e_preserva_linhas(tmp_path):
    tabela = ('<p>Antes.</p><table id="t1"><caption>Preços</caption><thead><tr><th>Nome</th><th>Valor</th></tr></thead>'
              '<tbody><tr><td>A</td><td>10</td></tr><tr><td></td><td>2<b>0</b></td></tr>'
              '<tr><td><p>Linha</p><p>dupla</p></td><td>3</td></tr><tr><td></td><td></td></tr></tbody></table><p>Depois.</p>')
    c, relatorio, _ = canonizar_epub(tmp_path, {'c.xhtml': '<h1>Capítulo</h1>' + tabela})
    blocos = [(b['tipo'], b['texto']) for b in c['blocos']]
    assert blocos == [('capitulo', 'Capítulo'), ('paragrafo', 'Antes.'),
                      ('tabela', 'Preços\nNome | Valor\nA | 10\n | 20\nLinha dupla | 3'), ('paragrafo', 'Depois.')]
    # Nenhuma palavra fabricada pela junção de células.
    assert 'NomeValor' not in c['blocos'][2]['texto'] and 'A10' not in c['blocos'][2]['texto']
    assert c['blocos'][2]['origens'] == [{'tipo': 'epub', 'arquivo': 'OPS/c.xhtml', 'xpath': '/html/body/table[1]'}]
    assert any(l['tipo'] == 'tabela_epub' and 'linearizada' in l['descricao'] for l in relatorio['limites'])


def test_imagem_vira_figura_com_alt_e_arquivo_do_livro(tmp_path):
    imagem = png()
    paginas = {'c.xhtml': '<h1>Capítulo</h1><p>Antes.</p>'
               '<div class="fig"><img src="img/diagrama.png" alt="Diagrama importante"/>'
               '<img src="img/diagrama.png" alt="Diagrama importante"/></div>'
               '<p>Texto com <img src="img/icone.png" alt="ícone"/> no meio e <img src="img/icone.png" alt=""/> enfeite.</p>'
               '<p><img src="http://exemplo.com/fora.png" alt="Gráfico externo"/></p>'
               '<p><img src="data:image/png;base64,AAAA" alt=""/></p>'
               '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
               '<title>Capa vetorial</title><image xlink:href="img/diagrama.png"/></svg>'
               '<p><img src="img/falso.png" alt=""/></p><p>Depois.</p>'}
    c, relatorio, saida = canonizar_epub(tmp_path, paginas, {'img/diagrama.png': imagem, 'img/icone.png': png((0, 0, 1)),
                                                             'img/falso.png': b'<svg/>'})
    blocos = [(b['tipo'], b['texto'], b.get('asset_id')) for b in c['blocos']]
    (asset,) = c['assets']
    assert blocos == [
        ('capitulo', 'Capítulo', None), ('paragrafo', 'Antes.', None),
        # A repetida (outra versão da mesma imagem para outro leitor) não duplica a figura.
        ('figura', '[Imagem: Diagrama importante]', asset['id']),
        ('paragrafo', 'Texto com [Imagem: ícone] no meio e enfeite.', None),
        ('figura', '[Imagem: Gráfico externo]', None),
        ('figura', '[Imagem: Capa vetorial]', asset['id']),
        ('figura', '[Imagem]', None),  # arquivo no pacote, mas não é imagem que o leitor exiba
        ('paragrafo', 'Depois.', None)]
    assert asset == {'id': asset['id'], 'tipo': 'imagem', 'caminho': 'assets/imagem-001.png',
                     'sha256': hashlib.sha256(imagem).hexdigest()}
    assert (saida / asset['caminho']).read_bytes() == imagem
    assert c['blocos'][2]['origens'] == [{'tipo': 'epub', 'arquivo': 'OPS/c.xhtml', 'xpath': '/html/body/div[1]/img[1]'}]
    descricoes = [l['descricao'] for l in relatorio['limites'] if l['tipo'] == 'imagens_epub']
    assert any('marcada(s) no ponto original' in d for d in descricoes)


def test_imagem_sem_arquivo_nem_descricao_fica_so_no_limite(tmp_path):
    c, relatorio, _ = canonizar_epub(tmp_path, {'c.xhtml': '<h1>Um</h1><p>Texto.</p><img src="capa.png"/>'})
    assert [b['texto'] for b in c['blocos']] == ['Um', 'Texto.']
    assert c['assets'] == []
    assert 'imagens_epub: OPS/c.xhtml: 1 elemento(s) de imagem ignorado(s).' in c['limites']


def test_notas_de_rodape_ligam_a_chamada_a_nota(tmp_path):
    paginas = {
        'c.xhtml': '<h1>Capítulo</h1>'
                   '<p id="r1">Texto<a epub:type="noteref" href="#n1">1</a> segue e outro<sup><a href="notas.xhtml#n2">2</a></sup>.'
                   ' Perdida<a epub:type="noteref" href="#nada">3</a> e link<a href="#n1">comum</a>.</p>'
                   '<aside epub:type="footnote" id="n1"><p><a href="#r1">1</a> Primeira nota.</p></aside>',
        'notas.xhtml': '<h1>Notas</h1><p id="n2"><sup><a href="c.xhtml#r1">2</a></sup> Segunda nota.</p><p>Fim.</p>',
    }
    c, relatorio, _ = canonizar_epub(tmp_path, paginas)
    por_texto = {b['texto']: b for b in c['blocos']}
    corpo = por_texto['Texto1 segue e outro2. Perdida3 e linkcomum.']
    primeira, segunda = por_texto['1 Primeira nota.'], por_texto['2 Segunda nota.']
    assert corpo['inline'] == [
        {'inicio': 5, 'fim': 6, 'estilo': 'nota_ref', 'ref': primeira['id']},
        {'inicio': 20, 'fim': 21, 'estilo': 'nota_ref', 'ref': segunda['id']}]
    # A nota em outro arquivo, escrita como parágrafo, passa a ser nota; o resto não muda.
    assert (primeira['tipo'], segunda['tipo'], por_texto['Fim.']['tipo']) == ('nota_rodape', 'nota_rodape', 'paragrafo')
    # O link de volta, dentro da nota, não vira chamada.
    assert primeira['inline'] == [] and segunda['inline'] == []
    assert 'notas_epub: 2 chamada(s) de nota ligada(s) à nota; 1 sem destino reconhecido ficaram como texto.' in c['limites']


def test_epub_sem_tabela_imagem_ou_nota_nao_muda(tmp_path):
    """Sem os casos novos, o texto, os tipos e os limites são os de antes (nenhuma marca provisória escapa)."""
    c, _, _ = canonizar_epub(tmp_path, {'c.xhtml': '<h1>Um</h1><p>Texto <a href="#x">link</a> e <sup>2</sup>.</p>'
                                                   '<p id="x">Alvo.</p>'})
    assert [(b['tipo'], b['texto'], b['inline']) for b in c['blocos']] == [
        ('capitulo', 'Um', []), ('paragrafo', 'Texto link e 2.', []), ('paragrafo', 'Alvo.', [])]
    assert c['limites'] == ['apresentacao_epub: Estilos, disposição visual e formatação inline do EPUB não são '
                            'reproduzidos; a leitura usa texto corrido.']
    assert all('' not in b['texto'] and '' not in b['texto'] for b in c['blocos'])


FIXO = '<meta property="rendition:layout">pre-paginated</meta>'


def test_layout_fixo_so_de_imagens_da_erro_amigavel(tmp_path):
    paginas = {f'p{n}.xhtml': f'<div><img src="p{n}.png" alt=""/></div>' for n in range(3)}
    extras = {f'p{n}.png': png() for n in range(3)}
    with pytest.raises(ValueError, match='layout fixo sem texto'):
        canonizar(montar(tmp_path, paginas, extras, metadados=FIXO), 'epub', tmp_path / 'saida')
    assert not (tmp_path / 'saida').exists()
    # Fixo por item do spine, com algum texto: entra, com aviso claro.
    paginas['p1.xhtml'] += '<p>Era uma vez.</p>'
    entrada = montar(tmp_path, paginas, extras, propriedades=' properties="rendition:layout-pre-paginated"', nome='fixo')
    c, relatorio = canonizar(entrada, 'epub', tmp_path / 'saida-fixo')
    assert any(l['tipo'] == 'layout_fixo_epub' for l in relatorio['limites'])
    assert 'Era uma vez.' in [b['texto'] for b in c['blocos']]
    validar(tmp_path / 'saida-fixo/canonico.json')


def test_layout_fluido_com_imagens_nao_avisa_layout_fixo(tmp_path):
    paginas = {'p.xhtml': '<h1>Um</h1><div><img src="p.png" alt="Foto"/></div>'}
    c, relatorio, _ = canonizar_epub(tmp_path, paginas, {'p.png': png()})
    assert not any(l['tipo'] == 'layout_fixo_epub' for l in relatorio['limites'])
    assert [b['tipo'] for b in c['blocos']] == ['capitulo', 'figura']
