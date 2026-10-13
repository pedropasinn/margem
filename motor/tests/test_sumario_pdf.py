from margem_motor.blocos import Bloco, Fragmento, finalizar
from margem_motor.sumario_pdf import aplicar_sumario


def capitulos_do_sumario(fonte, sumario, semente):
    if not aplicar_sumario(fonte, sumario):
        return []
    return finalizar(fonte, "Livro", semente)[1]


def blocos(paginas):
    return [Bloco('paragrafo', f'Texto da página {p}',
                            fragmentos=[Fragmento({'tipo': 'pdf', 'pagina': p}, 0, 10)])
                      for p in paginas]


def test_sumario_divide_ocr_sem_alterar_texto_e_cobre_todos_os_blocos():
    fonte = blocos([1, 2, 3, 4, 5])
    antes = [b.texto for b in fonte]
    secoes = capitulos_do_sumario(fonte, [[1, 'Introdução', 2], [1, 'Capítulo 1', 4]], 'a' * 64)
    assert [s['titulo'] for s in secoes] == ['Elementos iniciais', 'Introdução', 'Capítulo 1']
    ids = [b.id for b in fonte]
    cobertura = [b for s in secoes for b in ids[ids.index(s['bloco_inicio']):ids.index(s['bloco_fim'])+1]]
    assert cobertura == ids
    assert antes == [b.texto for b in fonte if b.tipo == 'paragrafo']


def test_marcadores_de_imagem_nao_sao_capitulos():
    assert capitulos_do_sumario(blocos([1, 2]), [[1, '125244_2R', 1], [1, '125343_1L', 2]], 'a' * 64) == []


def test_sumario_ignora_destinos_fora_do_recorte_e_duplicados():
    secoes = capitulos_do_sumario(blocos([5, 6, 7]), [[1, 'Fora', 2], [1, 'Dentro', 5],
                                    [1, 'Duplicado', 5], [2, 'Subseção', 6], [1, 'Fora', 9]], 'a' * 64)
    assert [s['titulo'] for s in secoes] == ['Dentro']


def test_ingestao_pdf_usa_sumario_mesmo_com_fonte_uniforme(tmp_path):
    import pymupdf
    from margem_motor.ingest import canonizar
    from test_ingest import validar

    entrada = tmp_path / 'sumario.pdf'
    with pymupdf.open() as pdf:
        for texto in ['Introducao sem tipografia especial.', 'Primeiro argumento.', 'Segundo argumento.']:
            pagina = pdf.new_page()
            pagina.insert_text((70, 100), texto)
        pdf.set_toc([[1, 'Introdução', 1], [1, 'Primeiro capítulo', 2], [1, 'Segundo capítulo', 3]])
        pdf.save(entrada)
    canonico, _ = canonizar(entrada, 'pdf', tmp_path / 'saida', titulo='Livro')
    assert [s['titulo'] for s in canonico['secoes']] == ['Introdução', 'Primeiro capítulo', 'Segundo capítulo']
    validar(tmp_path / 'saida' / 'canonico.json')


def pdf_sem_pontos(tmp_path, sumario, paginas=None):
    import pymupdf
    from margem_motor.ingest import canonizar
    entrada = tmp_path / 'livro.pdf'
    with pymupdf.open() as pdf:
        for texto in ['Primeiro texto sem ponto', 'Segundo texto sem ponto', 'Terceiro texto sem ponto']:
            pdf.new_page().insert_text((70, 120), texto, fontsize=12)
        if sumario:
            pdf.set_toc(sumario)
        pdf.save(entrada)
    return canonizar(entrada, 'pdf', tmp_path / 'saida', titulo='Livro', paginas=paginas)


def test_fronteiras_de_toc_bloqueiam_continuidade_sem_pontuacao(tmp_path):
    from test_ingest import validar
    c, _ = pdf_sem_pontos(tmp_path, [[1, 'Um', 1], [1, 'Dois', 2], [1, 'Tres', 3]])
    assert [s['titulo'] for s in c['secoes']] == ['Um', 'Dois', 'Tres']
    assert [b['texto'] for b in c['blocos'] if b['tipo'] == 'paragrafo'] == [
        'Primeiro texto sem ponto', 'Segundo texto sem ponto', 'Terceiro texto sem ponto']
    validar(tmp_path / 'saida' / 'canonico.json')


def test_sem_toc_continuidade_legitima_permanece(tmp_path):
    c, _ = pdf_sem_pontos(tmp_path, [])
    corpo = [b for b in c['blocos'] if b['tipo'] == 'paragrafo']
    assert len(corpo) == 1
    assert {o['pagina'] for o in corpo[0]['origens']} == {1, 2, 3}


def test_scan_nao_bloqueia_continuidade(tmp_path):
    c, _ = pdf_sem_pontos(tmp_path, [[1, '125244_2R', 1], [1, '125343_1L', 2]])
    assert len([b for b in c['blocos'] if b['tipo'] == 'paragrafo']) == 1


def test_recorte_nao_cria_capitulos_de_destinos_externos(tmp_path):
    c, _ = pdf_sem_pontos(tmp_path, [[1, 'Fora', 1], [1, 'Dentro', 2]], paginas=(2, 3))
    assert [s['titulo'] for s in c['secoes']] == ['Dentro']
    assert len([b for b in c['blocos'] if b['tipo'] == 'paragrafo']) == 1


def test_destinos_na_mesma_pagina_sao_diagnosticados(tmp_path):
    c, r = pdf_sem_pontos(tmp_path, [[1, 'Um', 1], [1, 'Dois', 2], [1, 'Conflito', 2]])
    assert [s['titulo'] for s in c['secoes']] == ['Um', 'Dois']
    assert any(l['tipo'] == 'sumario_destino_nao_resolvido' and l['pagina'] == 2 for l in r['limites'])
    assert any('Conflito' in l for l in c['limites'])


def test_pagina_repetida_com_inicio_de_capitulo_e_preservada(tmp_path):
    import pymupdf
    from margem_motor.ingest import canonizar
    from test_ingest import validar
    entrada = tmp_path / 'duplicado.pdf'
    with pymupdf.open() as pdf:
        for _ in range(2):
            pdf.new_page().insert_text((60, 120), 'Texto sem ponto final', fontsize=12)
        pdf.set_toc([[1, 'Capitulo A', 1], [1, 'Capitulo B', 2]])
        pdf.save(entrada)
    c, r = canonizar(entrada, 'pdf', tmp_path / 'saida', titulo='Livro')
    assert [s['titulo'] for s in c['secoes']] == ['Capitulo A', 'Capitulo B']
    assert [o['pagina'] for b in c['blocos'] if b['tipo'] == 'paragrafo' for o in b['origens']] == [1, 2]
    assert not any(l['tipo'] == 'pagina_repetida' for l in r['limites'])
    validar(tmp_path / 'saida' / 'canonico.json')


def test_destino_sem_bloco_no_recorte_nao_e_deslocado_para_outra_pagina():
    fonte = blocos([1, 3])
    limites = []
    aplicar_sumario(fonte, [[1, 'Um', 1], [1, 'Sem texto', 2], [1, 'Tres', 3], [1, 'Fora', 4]], limites, (1, 3))
    assert [b.texto for b in fonte if b.tipo == 'capitulo'] == ['Um', 'Tres']
    assert len(limites) == 1 and limites[0]['pagina'] == 2
    assert limites[0]['tipo'] == 'sumario_destino_nao_resolvido'
