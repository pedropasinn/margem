"""EPUB 2/3 sem rede nem extração de arquivos para o disco."""

import hashlib
from html.entities import html5
from io import BytesIO
from pathlib import Path
import posixpath
import re
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

from .blocos import TITULOS, Bloco, Estilo, Fragmento, comparavel, juntar
from .ids import identificar

LIMITE_BYTES = 200 * 1024 * 1024
LIMITE_ENTRADAS = 10_000
# Ofuscação de fontes (IDPF e Adobe) usa encryption.xml sem ser DRM: o texto continua legível.
OFUSCACAO_DE_FONTES = {'http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'}
BLOCOS_HTML = {'p', 'div', 'section', 'article', 'aside', 'ul', 'ol', 'li', 'blockquote', 'pre',
               'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'footer', 'nav', 'main', 'figure',
               'figcaption', 'table', 'tr', 'dl', 'dt', 'dd'}
TIPO_OPS = '{http://www.idpf.org/2007/ops}type'
IGNORADOS = {'script', 'style', 'img', 'image', 'svg'}


def nome(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def caminho(base: str, referencia: str) -> str:
    url = urlsplit(referencia)
    destino = posixpath.normpath(posixpath.join(base, unquote(url.path)))
    if url.scheme or url.netloc or destino.startswith(('/', '../')) or destino == '..':
        raise ValueError('EPUB contém referência fora do arquivo.')
    return destino


def ler_xml(arquivo: ZipFile, fonte: str) -> ET.Element:
    # XHTML do EPUB 2 pode usar entidades HTML declaradas em DTD externa.
    # Resolve só nomes conhecidos localmente, sem buscar a DTD na rede.
    return ET.fromstring(re.sub(rb'&([A-Za-z][A-Za-z0-9]+);', lambda m:
        ''.join(f'&#{ord(c)};' for c in html5[m[1].decode() + ';']).encode()
        if m[1].decode() + ';' in html5 else m[0], arquivo.read(fonte)))


def rotulo(elemento) -> str:
    return re.sub(r'\s+', ' ', ''.join(elemento.itertext())).strip()


def entradas_do_ncx(raiz: ET.Element, base: str) -> list[tuple[int, str, str, str | None]]:
    """navPoints aninhados do NCX (EPUB 2): (nível, título, pasta do NCX, href)."""
    entradas = []

    def visitar(no, nivel):
        for ponto in (f for f in no if nome(f.tag) == 'navPoint'):
            etiqueta = next((f for f in ponto if nome(f.tag) == 'navLabel'), None)
            texto = next((e for e in etiqueta.iter() if nome(e.tag) == 'text'), etiqueta) if etiqueta is not None else None
            src = next((f.get('src') for f in ponto if nome(f.tag) == 'content'), None)
            entradas.append((nivel, rotulo(texto) if texto is not None else '', base, src))
            visitar(ponto, nivel + 1)
    mapa = next((e for e in raiz.iter() if nome(e.tag) == 'navMap'), None)
    if mapa is not None:
        visitar(mapa, 1)
    return entradas


def entradas_do_nav(raiz: ET.Element, base: str) -> list[tuple[int, str, str, str | None]]:
    """`nav epub:type="toc"` do EPUB 3, com listas aninhadas: (nível, título, pasta do nav, href)."""
    navs = [e for e in raiz.iter() if nome(e.tag) == 'nav']
    nav = next((n for n in navs if 'toc' in n.get(TIPO_OPS, '').split()), None)
    if nav is None:
        nav = next((n for n in navs if not n.get(TIPO_OPS, '').strip()), None)
    if nav is None:
        return []
    entradas = []

    def lista(no, nivel):
        for item in (f for f in no if nome(f.tag) == 'li'):
            etiqueta = next((f for f in item if nome(f.tag) in {'a', 'span'}), None)
            if etiqueta is not None:
                entradas.append((nivel, rotulo(etiqueta), base, etiqueta.get('href')))
            for sub in (f for f in item if nome(f.tag) in {'ol', 'ul'}):
                lista(sub, nivel + 1)
    raiz_lista = next((f for f in nav if nome(f.tag) in {'ol', 'ul'}), None)
    if raiz_lista is None:
        raiz_lista = next((e for e in nav.iter() if nome(e.tag) in {'ol', 'ul'}), None)
    if raiz_lista is not None:
        lista(raiz_lista, 1)
    return entradas


def ler_sumario(arquivo: ZipFile, opf: ET.Element, opf_caminho: str, manifesto: dict) -> list:
    """Sumário do próprio EPUB: nav do EPUB 3 ou, na falta, o NCX do EPUB 2. Ilegível vira []."""
    pasta = posixpath.dirname(opf_caminho)
    spine = next((e for e in opf.iter() if nome(e.tag) == 'spine'), None)
    nav = next((i for i in manifesto.values() if 'nav' in (i.get('properties') or '').split()), None)
    ncx = manifesto.get(spine.get('toc')) if spine is not None and spine.get('toc') else None
    if ncx is None:
        ncx = next((i for i in manifesto.values() if i.get('media-type') == 'application/x-dtbncx+xml'), None)
    for item, leitor in ((nav, entradas_do_nav), (ncx, entradas_do_ncx)):
        if item is None or not item.get('href'):
            continue
        try:
            fonte = caminho(pasta, item.get('href'))
            entradas = leitor(ler_xml(arquivo, fonte), posixpath.dirname(fonte))
        except (ValueError, KeyError, RuntimeError, ET.ParseError):
            continue
        if entradas:
            return entradas
    return []


def aplicar_sumario_epub(blocos: list[Bloco], entradas: list, arquivos: dict[str, tuple[int, int]],
                         ancoras: dict[tuple[str, str], int], limites: list[dict]) -> bool:
    """O sumário do livro manda nos capítulos, como o TOC do PDF (`sumario_pdf.aplicar_sumario`).

    Cada entrada de nível 1 abre um capítulo com o título do sumário. Os títulos seguidos do começo do
    destino (`<h1>1</h1><h1>THE CHALLENGE…</h1>`) viram um só bloco de título: com as mesmas palavras do
    sumário, passa a ter a grafia dele; senão, o sumário ganha um cabeçalho próprio e esse texto fica
    como parágrafo logo abaixo, sem sumir da leitura. Os demais h1–h3 continuam como subseções.
    Sem ao menos dois capítulos resolvidos, nada muda.
    """
    avisos: list[dict] = []
    marcos: list[tuple[int, int, str]] = []  # (índice do bloco, nível, título)
    for nivel, titulo, base, href in entradas:
        indice = None
        if href:
            try:
                destino = caminho(base, href)
            except ValueError:
                destino = None
            ancora = unquote(urlsplit(href).fragment)
            if destino in arquivos:
                inicio, fim = arquivos[destino]
                indice = ancoras.get((destino, ancora), inicio) if ancora else inicio
                if indice >= fim:
                    # Capa, página de rosto em imagem: não há texto para abrir um capítulo.
                    avisos.append({'tipo': 'sumario_sem_texto', 'descricao':
                                   f"Sumário '{titulo or href}' ({destino}): destino sem texto; não vira seção."})
                    continue
        if indice is None or not titulo:
            avisos.append({'tipo': 'sumario_destino_nao_resolvido', 'descricao':
                           f"Sumário '{titulo or href or '?'}': destino ausente no texto lido; "
                           "estrutura do sumário requer revisão."})
            continue
        if indice > (marcos[-1][0] if marcos else -1):
            marcos.append((indice, nivel, titulo))
        elif nivel == 1:
            avisos.append({'tipo': 'sumario_destino_nao_resolvido', 'descricao':
                           f"Sumário '{titulo}': destino coincidente ou fora da ordem de leitura; "
                           "estrutura do sumário requer revisão."})
    capitulos = sum(nivel == 1 for _, nivel, _ in marcos)
    if capitulos < 2:
        return False
    limites.append({'tipo': 'sumario_epub', 'descricao':
                    f'{capitulos} capítulos tirados do sumário do próprio EPUB; os títulos seguem a grafia dele.'})
    limites.extend(avisos)
    inicios = {indice for indice, _, _ in marcos}
    originais = [b.nivel or 1 for b in blocos]
    # Títulos de abertura de cada capítulo: blocos de título seguidos, do mesmo nível do primeiro.
    aberturas = {}
    for indice, nivel, _ in marcos:
        fim = indice
        while (nivel == 1 and fim < len(blocos) and blocos[fim].tipo in TITULOS
               and originais[fim] == originais[indice] and (fim == indice or fim not in inicios)):
            fim += 1
        aberturas[indice] = fim
    for bloco, original in zip(blocos, originais):
        if bloco.tipo in TITULOS:
            bloco.tipo, bloco.nivel = 'secao', max(original, 2)

    def regrafar(bloco: Bloco, titulo: str, nivel: int) -> bool:
        if comparavel(bloco.texto) != comparavel(titulo):
            return False
        # Mesmas palavras, só caixa e pontuação mudam; as origens continuam nos títulos do original.
        bloco.texto, bloco.nivel = titulo, nivel
        bloco.tipo = 'capitulo' if nivel == 1 else 'secao'
        bloco.fragmentos = [Fragmento(f.origem, 0, len(titulo)) for f in bloco.fragmentos]
        return True

    for indice, nivel, titulo in reversed(marcos):
        if nivel == 1 and aberturas[indice] > indice:
            for _ in range(aberturas[indice] - indice - 1):
                juntar(blocos[indice], blocos.pop(indice + 1), set())
            if regrafar(blocos[indice], titulo, 1):
                continue
            blocos[indice].tipo, blocos[indice].nivel = 'paragrafo', 0
        elif nivel > 1 and blocos[indice].tipo in TITULOS:
            # Subnível que cai num h2/h3: o título do próprio texto continua valendo.
            if not regrafar(blocos[indice], titulo, nivel):
                blocos[indice].nivel = nivel
            continue
        # Cabeçalho com o título do sumário, sem trecho do corpo (como o TOC do PDF).
        origem = dict(blocos[indice].fragmentos[0].origem)
        blocos.insert(indice, Bloco('capitulo' if nivel == 1 else 'secao', titulo, nivel=nivel,
                                    fragmentos=[Fragmento(origem, 0, 0)]))
    if marcos[0][0] > 0:
        origem = dict(blocos[0].fragmentos[0].origem)
        blocos.insert(0, Bloco('capitulo', 'Elementos iniciais', nivel=1, fragmentos=[Fragmento(origem, 0, 0)]))
    return True


# Marcas provisórias no texto de um bloco em montagem (área de uso privado do Unicode):
# imagem no ponto original, começo e fim de uma chamada de nota. Nunca chegam ao canônico.
MARCA_IMAGEM, ABRE_CHAMADA, FECHA_CHAMADA = '', '', ''
IMAGENS = {'img', 'image', 'svg'}
XLINK_HREF = '{http://www.w3.org/1999/xlink}href'
# Chamada de nota sem semântica explícita: número curto ou símbolo, dentro de <sup> ou com classe de nota.
MARCA_DE_NOTA = re.compile(r'[\[(]?(?:\d{1,4}|[*†‡§¶]{1,3})[\])]?')
ASSINATURAS = ((b'\x89PNG\r\n\x1a\n', 'png'), (b'\xff\xd8\xff', 'jpg'), (b'GIF87a', 'gif'), (b'GIF89a', 'gif'))


def formato_de_imagem(dados: bytes) -> str | None:
    """Extensão pela assinatura dos bytes (não pelo nome nem pelo manifesto): só imagens que o leitor exibe."""
    if dados[:4] == b'RIFF' and dados[8:12] == b'WEBP':
        return 'webp'
    return next((extensao for assinatura, extensao in ASSINATURAS if dados.startswith(assinatura)), None)


def descrever_imagem(elemento) -> tuple[str, str | None]:
    """(texto alternativo, referência do arquivo) de <img>, <image> do SVG ou <svg> com <image> dentro."""
    tag = nome(elemento.tag)
    if tag == 'svg':
        titulo = next((e for e in elemento.iter() if nome(e.tag) == 'title'), None)
        alt = elemento.get('aria-label') or (rotulo(titulo) if titulo is not None else '')
        imagem = next((e for e in elemento.iter() if nome(e.tag) == 'image'), None)
        href = (imagem.get(XLINK_HREF) or imagem.get('href')) if imagem is not None else None
    else:
        alt = elemento.get('alt') or elemento.get('aria-label') or ''
        href = elemento.get('src') or elemento.get(XLINK_HREF) or elemento.get('href')
    return re.sub(r'\s+', ' ', alt).strip(), href


def marcador_de_imagem(alt: str) -> str:
    return f'[Imagem: {alt}]' if alt else '[Imagem]'


def tipo_de_chamada(elemento, em_sup: bool) -> str | None:
    """`explicita` (epub:type="noteref" ou role="doc-noteref"), `provavel` (número em <sup> ligado a uma
    âncora) ou None. Só links para `#id`: a nota precisa ter um destino no próprio livro."""
    if '#' not in (elemento.get('href') or ''):
        return None
    if 'noteref' in elemento.get(TIPO_OPS, '').split() or elemento.get('role') == 'doc-noteref':
        return 'explicita'
    if not MARCA_DE_NOTA.fullmatch(rotulo(elemento)):
        return None
    em_sup = em_sup or any(nome(e.tag) == 'sup' for e in elemento.iter())
    return 'provavel' if em_sup or re.search(r'note|nota|fn', elemento.get('class') or '', re.I) else None


def comeca_pela_marca(texto: str, marca: str) -> bool:
    numero = re.sub(r'[\[\]()]', '', marca)
    return re.match(rf'\W*{re.escape(numero)}(?!\w)', texto) is not None


def layout_fixo(opf: ET.Element, spine: list) -> bool:
    """`rendition:layout` pre-paginated no pacote ou em todos os itens do spine (EPUB 3)."""
    global_ = next((rotulo(e) for e in opf.iter() if nome(e.tag) == 'meta'
                    and e.get('property') == 'rendition:layout'), '')
    if global_ == 'pre-paginated':
        return True
    return bool(spine) and all('rendition:layout-pre-paginated' in (r.get('properties') or '').split() for r in spine)


def extrair_epub(conteudo: bytes, pasta: Path | None = None,
                 semente: str = '') -> tuple[list[Bloco], dict, list[dict], list[dict]]:
    """Blocos, metadados, limites e assets (imagens do livro gravadas em `pasta/assets`, se houver pasta)."""
    blocos: list[Bloco] = []
    assets: list[dict] = []
    limites = [{"tipo": "apresentacao_epub", "descricao":
                "Estilos, disposição visual e formatação inline do EPUB não são reproduzidos; a leitura usa texto corrido."}]
    try:
        with ZipFile(BytesIO(conteudo)) as arquivo:
            # Limita entradas e tamanho descomprimido antes de ler qualquer membro; o zipfile
            # corta cada membro no file_size declarado, então a soma declarada é um teto real.
            if len(arquivo.infolist()) > LIMITE_ENTRADAS:
                raise ValueError(f'EPUB com mais de {LIMITE_ENTRADAS} arquivos não é suportado.')
            if sum(i.file_size for i in arquivo.infolist()) > LIMITE_BYTES:
                raise ValueError('EPUB descomprimido excede o limite de 200 MB.')
            if 'META-INF/encryption.xml' in arquivo.namelist():
                cifragem = ET.fromstring(arquivo.read('META-INF/encryption.xml'))
                for dado in (e for e in cifragem.iter() if nome(e.tag) == 'EncryptedData'):
                    metodo = next((e.get('Algorithm') for e in dado.iter() if nome(e.tag) == 'EncryptionMethod'), None)
                    if metodo not in OFUSCACAO_DE_FONTES:
                        raise ValueError('EPUB com DRM ou recursos cifrados não é suportado.')
            container = ET.fromstring(arquivo.read('META-INF/container.xml'))
            raiz = next((e.get('full-path') for e in container.iter() if nome(e.tag) == 'rootfile'), None)
            if not raiz:
                raise ValueError('EPUB sem pacote OPF no container.xml.')
            opf_caminho = caminho('', raiz)
            opf = ET.fromstring(arquivo.read(opf_caminho))
            ns = {'opf': 'http://www.idpf.org/2007/opf', 'dc': 'http://purl.org/dc/elements/1.1/'}
            metadados = {}
            for campo, tag in [('titulo', 'title'), ('autor', 'creator'), ('idioma', 'language')]:
                elemento = opf.find(f'opf:metadata/dc:{tag}', ns)
                if elemento is not None:
                    valor = ''.join(elemento.itertext()).strip()
                    if campo == 'idioma':
                        # "pt-BR" vira "pt", como a detecção; a busca textual só conhece en/pt.
                        valor = valor.split('-')[0].lower()
                        valor = valor if re.fullmatch(r'[a-z]{2,3}', valor) else ''
                    if valor:
                        metadados[campo] = valor
            manifesto = {e.get('id'): e for e in opf.findall('opf:manifest/opf:item', ns)}
            spine = opf.findall('opf:spine/opf:itemref', ns)
            if not spine:
                raise ValueError('EPUB sem spine.')
            lidos = 0
            paginas = 0
            no_livro = {'imagens': 0}  # elementos de imagem lidos no texto
            arquivos: dict[str, tuple[int, int]] = {}
            ancoras: dict[tuple[str, str], int] = {}
            # Chamadas de nota à espera do destino: (estilo, bloco da chamada, arquivo, id, tipo, marca).
            chamadas: list[tuple[Estilo, Bloco, str, str, str, str]] = []
            gravadas: dict[str, int | None] = {}  # arquivo de imagem do pacote → índice do asset

            def asset_da_imagem(destino: str | None) -> int | None:
                """Imagem do pacote gravada uma vez em assets/; None se ausente ou num formato que o leitor não exibe."""
                if destino is None or destino not in arquivo.namelist():
                    return None
                if destino not in gravadas:
                    dados = arquivo.read(destino)
                    extensao = formato_de_imagem(dados)
                    gravadas[destino] = None
                    if extensao and pasta is not None:
                        indice = len(assets)
                        relativo = f'assets/imagem-{indice + 1:03d}.{extensao}'
                        (pasta / 'assets').mkdir(parents=True, exist_ok=True)
                        # Escrita exclusiva: não segue symlink nem sobrescreve.
                        with (pasta / relativo).open('xb') as saida:
                            saida.write(dados)
                        assets.append({'id': identificar(semente, 'imagem', indice), 'tipo': 'imagem',
                                       'caminho': relativo, 'sha256': hashlib.sha256(dados).hexdigest()})
                        gravadas[destino] = indice
                return gravadas[destino]

            for referencia in spine:
                item = manifesto.get(referencia.get('idref'))
                if item is None or not item.get('href'):
                    raise ValueError('EPUB com recurso ausente no manifesto.')
                fonte = caminho(posixpath.dirname(opf_caminho), item.get('href'))
                if item.get('media-type') not in {'application/xhtml+xml', 'text/html'}:
                    # Capa em SVG ou imagem no spine (EPUB 3): sem texto a extrair.
                    limites.append({'tipo': 'imagens_epub', 'descricao':
                                    f'{fonte}: recurso não textual do spine ignorado.'})
                    continue
                if 'nav' in (item.get('properties') or '').split():
                    # Sumário de navegação do EPUB 3: o Margem monta o próprio a partir dos títulos.
                    limites.append({'tipo': 'navegacao_epub', 'descricao': f'{fonte}: sumário do EPUB omitido.'})
                    continue
                lidos += arquivo.getinfo(fonte).file_size
                if lidos > LIMITE_BYTES:
                    raise ValueError('EPUB descomprimido excede o limite de 200 MB.')
                pagina = ler_xml(arquivo, fonte)
                corpo = next((e for e in pagina.iter() if nome(e.tag) == 'body'), None)
                if corpo is None:
                    raise ValueError('EPUB com capítulo sem body.')
                paginas += 1
                contagem = {'ignoradas': 0, 'marcadas': 0, 'com_arquivo': 0, 'tabelas': 0}

                def destino_de(referencia: str | None) -> str | None:
                    if not referencia:
                        return None
                    try:
                        return caminho(posixpath.dirname(fonte), referencia) if urlsplit(referencia).path else fonte
                    except ValueError:  # http:, data: ou fora do pacote: não há arquivo a mostrar
                        return None

                def texto_corrido(no) -> str:
                    """Texto de uma célula ou legenda de tabela, sem estrutura interna; imagens com alt viram marcador."""
                    partes = []

                    def andar(n):
                        if n.get('id'):
                            ancoras.setdefault((fonte, n.get('id')), len(blocos))
                        partes.append(n.text or '')
                        for filho in n:
                            filho_tag = nome(filho.tag)
                            if filho_tag in IMAGENS:
                                alt, _ = descrever_imagem(filho)
                                partes.append(f' {marcador_de_imagem(alt)} ' if alt else '')
                                contagem['marcadas' if alt else 'ignoradas'] += 1
                            elif filho_tag in {'br'} | BLOCOS_HTML | {'td', 'th'}:
                                partes.append(' ')
                                if filho_tag != 'br':
                                    andar(filho)
                                partes.append(' ')
                            elif filho_tag not in IGNORADOS:
                                andar(filho)
                            partes.append(filho.tail or '')
                    andar(no)
                    return re.sub(r'\s+', ' ', ''.join(partes)).strip()

                def publicar_tabela(tabela, xpath):
                    """I-02: uma linha do texto por linha da tabela, células separadas por " | " (nunca coladas)."""
                    indice = len(blocos)
                    if tabela.get('id'):
                        ancoras.setdefault((fonte, tabela.get('id')), indice)
                    linhas = []

                    def andar(no):
                        for filho in no:
                            filho_tag = nome(filho.tag)
                            if filho_tag == 'caption':
                                legenda = texto_corrido(filho)
                                if legenda:
                                    linhas.insert(0, legenda)
                            elif filho_tag == 'tr':
                                if filho.get('id'):
                                    ancoras.setdefault((fonte, filho.get('id')), indice)
                                celulas = [texto_corrido(c) for c in filho if nome(c.tag) in {'td', 'th'}]
                                if any(celulas):
                                    linhas.append(' | '.join(celulas))
                            elif filho_tag in {'thead', 'tbody', 'tfoot'}:
                                andar(filho)
                    andar(tabela)
                    texto = '\n'.join(linhas) if linhas else texto_corrido(tabela)
                    if texto:
                        contagem['tabelas'] += 1
                        origem = {'tipo': 'epub', 'arquivo': fonte, 'xpath': xpath}
                        blocos.append(Bloco('tabela', texto, [], [Fragmento(origem, 0, len(texto))]))

                def visitar(elemento, xpath, herdado='paragrafo'):
                    tag = nome(elemento.tag)
                    if tag in {'script', 'style', 'img', 'image', 'svg'}:
                        return
                    if tag == 'table':
                        publicar_tabela(elemento, xpath)
                        return
                    nivel = int(tag[1]) if tag in {'h1', 'h2', 'h3'} else 0
                    semantica = elemento.get('{http://www.idpf.org/2007/ops}type', '').split()
                    tipo = ('nota_rodape' if {'footnote', 'endnote', 'rearnote'} & set(semantica)
                            or elemento.get('role') in {'doc-footnote', 'doc-endnote'}
                            else 'capitulo' if nivel == 1 else 'secao' if nivel else
                            {'li': 'lista', 'blockquote': 'citacao', 'pre': 'codigo'}.get(tag, herdado))
                    partes = []
                    imagens: list[tuple[str, str | None, str]] = []  # (alt, arquivo, xpath), na ordem das marcas
                    pendentes: list[tuple[str, str, str, str]] = []  # (arquivo, id, tipo, marca) das chamadas

                    def publicar():
                        bruto = ''.join(partes)
                        partes.clear()
                        figuras, imagens[:] = list(imagens), []
                        notas, pendentes[:] = list(pendentes), []
                        if figuras and not bruto.replace(MARCA_IMAGEM, '').strip():
                            # I-03: imagem sozinha no bloco vira figura no ponto original, com o alt preservado
                            # e, se o arquivo estiver no pacote num formato exibível, a própria imagem.
                            anterior = None
                            for alt, destino, local in figuras:
                                if destino is not None and (alt, destino) == anterior:
                                    continue  # a mesma imagem repetida para outro leitor (ex.: versão Kindle oculta por CSS)
                                anterior = (alt, destino)
                                asset = asset_da_imagem(destino)
                                if asset is None and not alt and (destino is None or destino not in arquivo.namelist()):
                                    contagem['ignoradas'] += 1  # sem arquivo nem descrição: nada a mostrar
                                    continue
                                texto = marcador_de_imagem(alt)
                                contagem['marcadas'] += 1
                                contagem['com_arquivo'] += asset is not None
                                origem = {'tipo': 'epub', 'arquivo': fonte, 'xpath': local}
                                blocos.append(Bloco('figura', texto, [], [Fragmento(origem, 0, len(texto))],
                                                    pagina_asset=asset))
                            return
                        for alt, _, _ in figuras:
                            # Imagem no meio do texto: o marcador fica no lugar dela, sem quebrar o parágrafo.
                            bruto = bruto.replace(MARCA_IMAGEM, f' {marcador_de_imagem(alt)} ' if alt else '', 1)
                            contagem['marcadas' if alt else 'ignoradas'] += 1
                        texto = bruto.strip('\n') if tipo == 'codigo' else re.sub(r'\s+', ' ', bruto).strip()
                        estilos = []
                        if notas:
                            limpo, faixas, abertura = '', [], 0
                            for caractere in texto:
                                if caractere == ABRE_CHAMADA:
                                    abertura = len(limpo)
                                elif caractere == FECHA_CHAMADA:
                                    faixas.append((abertura, len(limpo)))
                                else:
                                    limpo += caractere
                            texto = limpo
                            for (inicio, fim), nota in zip(faixas, notas):
                                trecho = texto[inicio:fim]
                                inicio += len(trecho) - len(trecho.lstrip())
                                fim -= len(trecho) - len(trecho.rstrip())
                                if fim > inicio:
                                    estilos.append((Estilo(inicio, fim, 'nota_ref'), nota))
                        if texto.strip():
                            origem = {'tipo': 'epub', 'arquivo': fonte, 'xpath': xpath}
                            bloco = Bloco(tipo, texto, [e for e, _ in estilos], [Fragmento(origem, 0, len(texto))], nivel)
                            blocos.append(bloco)
                            chamadas.extend((estilo, bloco, *nota) for estilo, nota in estilos)

                    def percorrer(no, trilha, em_sup=False):
                        if no.get('id'):
                            # Destino de âncora do sumário: o bloco que contém o elemento.
                            ancoras.setdefault((fonte, no.get('id')), len(blocos))
                        partes.append(no.text or '')
                        contagens = {}
                        for filho in no:
                            filho_tag = nome(filho.tag)
                            contagens[filho_tag] = contagens.get(filho_tag, 0) + 1
                            local = f'{trilha}/{filho_tag}[{contagens[filho_tag]}]'
                            chamada = (tipo_de_chamada(filho, em_sup)
                                       if filho_tag == 'a' and tipo != 'nota_rodape' else None)
                            if filho_tag in BLOCOS_HTML:
                                publicar()
                                visitar(filho, local, tipo)
                            elif filho_tag == 'br':
                                partes.append('\n')
                            elif chamada:
                                # I-05: a chamada continua no texto, marcada como nota_ref (como no PDF).
                                href = urlsplit(filho.get('href'))
                                destino = destino_de(filho.get('href'))
                                if destino is None:
                                    percorrer(filho, local, em_sup)
                                else:
                                    pendentes.append((destino, unquote(href.fragment), chamada, rotulo(filho)))
                                    partes.append(ABRE_CHAMADA)
                                    percorrer(filho, local, em_sup)
                                    partes.append(FECHA_CHAMADA)
                            elif filho_tag in IMAGENS:
                                no_livro['imagens'] += 1
                                if filho.get('id'):
                                    ancoras.setdefault((fonte, filho.get('id')), len(blocos))
                                alt, href = descrever_imagem(filho)
                                imagens.append((alt, destino_de(href), local))
                                partes.append(MARCA_IMAGEM)
                            elif filho_tag not in IGNORADOS:
                                percorrer(filho, local, em_sup or filho_tag == 'sup')
                            elif filho.get('id'):
                                ancoras.setdefault((fonte, filho.get('id')), len(blocos))
                            partes.append(filho.tail or '')
                    percorrer(elemento, xpath)
                    publicar()

                inicio = len(blocos)
                visitar(corpo, '/html/body')
                arquivos.setdefault(fonte, (inicio, len(blocos)))
                if contagem['ignoradas']:
                    limites.append({'tipo': 'imagens_epub', 'descricao':
                                    f"{fonte}: {contagem['ignoradas']} elemento(s) de imagem ignorado(s)."})
                if contagem['marcadas']:
                    limites.append({'tipo': 'imagens_epub', 'descricao':
                                    f"{fonte}: {contagem['marcadas']} imagem(ns) marcada(s) no ponto original como "
                                    f"[Imagem: descrição], {contagem['com_arquivo']} com a imagem do livro."})
                if contagem['tabelas']:
                    limites.append({'tipo': 'tabela_epub', 'descricao':
                                    f"{fonte}: {contagem['tabelas']} tabela(s) linearizada(s): uma linha do texto por "
                                    "linha da tabela, células separadas por \" | \"; mesclagens e alinhamento não são reproduzidos."})
            ligadas = perdidas = 0
            retornos: list[Bloco] = []
            for estilo, chamador, destino, alvo_id, modo, marca in chamadas:
                indice = ancoras.get((destino, alvo_id))
                alvo = blocos[indice] if indice is not None and indice < len(blocos) else None
                if alvo is not None and alvo is not chamador and (alvo.tipo == 'nota_rodape' or (
                        alvo.tipo in {'paragrafo', 'lista'} and (modo == 'explicita' or comeca_pela_marca(alvo.texto, marca)))):
                    # O destino da chamada é a nota, ainda que o livro a escreva como parágrafo comum.
                    alvo.tipo = 'nota_rodape'
                    estilo.ref = alvo  # vira o id do bloco em `finalizar`
                    ligadas += 1
                else:
                    # Por identidade: `remove` compararia estilos (e os blocos das notas) por valor.
                    chamador.estilos[:] = [e for e in chamador.estilos if e is not estilo]
                    perdidas += 1
                    # Número dentro da própria nota apontando de volta ao texto: é o link de retorno, não chamada.
                    retornos.append(chamador)
            perdidas -= sum(chamador.tipo == 'nota_rodape' for chamador in retornos)
            if ligadas or perdidas:
                limites.append({'tipo': 'notas_epub', 'descricao':
                                f'{ligadas} chamada(s) de nota ligada(s) à nota'
                                + (f'; {perdidas} sem destino reconhecido ficaram como texto.' if perdidas else '.')})
            if layout_fixo(opf, spine) and no_livro['imagens'] and no_livro['imagens'] * 2 >= paginas:
                # Livro de páginas desenhadas (quadrinhos, infantil, digitalizado): o essencial está nas imagens.
                if not any(b.tipo != 'figura' for b in blocos):
                    raise ValueError('EPUB de layout fixo sem texto para ler: as páginas são imagens (quadrinhos, '
                                     'livro ilustrado ou digitalizado). O Margem ainda não lê esse tipo de EPUB; '
                                     'se existir uma edição de texto corrido, importe essa.')
                limites.append({'tipo': 'layout_fixo_epub', 'descricao':
                                'EPUB de layout fixo cujas páginas são sobretudo imagens: o Margem lê só o texto que '
                                'existe nelas, sem a disposição das páginas; parte do conteúdo pode estar só nas imagens.'})
            entradas = ler_sumario(arquivo, opf, opf_caminho, manifesto)
            if entradas:
                aplicar_sumario_epub(blocos, entradas, arquivos, ancoras, limites)
            return blocos, metadados, limites, assets
    except (BadZipFile, ET.ParseError, KeyError, RuntimeError) as erro:
        raise ValueError('EPUB inválido: ZIP, XML ou recurso do pacote ilegível.') from erro
