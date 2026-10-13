"""EPUB 2/3 sem rede nem extração de arquivos para o disco."""

from html.entities import html5
from io import BytesIO
import posixpath
import re
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

from .blocos import Bloco, Fragmento

LIMITE_BYTES = 200 * 1024 * 1024
LIMITE_ENTRADAS = 10_000
# Ofuscação de fontes (IDPF e Adobe) usa encryption.xml sem ser DRM: o texto continua legível.
OFUSCACAO_DE_FONTES = {'http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'}
BLOCOS_HTML = {'p', 'div', 'section', 'article', 'aside', 'ul', 'ol', 'li', 'blockquote', 'pre',
               'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'footer', 'nav', 'main', 'figure',
               'figcaption', 'table', 'tr', 'dl', 'dt', 'dd'}


def nome(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def caminho(base: str, referencia: str) -> str:
    url = urlsplit(referencia)
    destino = posixpath.normpath(posixpath.join(base, unquote(url.path)))
    if url.scheme or url.netloc or destino.startswith(('/', '../')) or destino == '..':
        raise ValueError('EPUB contém referência fora do arquivo.')
    return destino


def extrair_epub(conteudo: bytes) -> tuple[list[Bloco], dict, list[dict]]:
    blocos: list[Bloco] = []
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
                # XHTML do EPUB 2 pode usar entidades HTML declaradas em DTD externa.
                # Resolve só nomes conhecidos localmente, sem buscar a DTD na rede.
                xhtml = re.sub(rb'&([A-Za-z][A-Za-z0-9]+);', lambda m:
                    ''.join(f'&#{ord(c)};' for c in html5[m[1].decode() + ';']).encode()
                    if m[1].decode() + ';' in html5 else m[0], arquivo.read(fonte))
                pagina = ET.fromstring(xhtml)
                corpo = next((e for e in pagina.iter() if nome(e.tag) == 'body'), None)
                if corpo is None:
                    raise ValueError('EPUB com capítulo sem body.')
                imagens = sum(nome(e.tag) in {'img', 'image', 'svg'} for e in corpo.iter())
                if imagens:
                    limites.append({'tipo': 'imagens_epub', 'descricao':
                                    f'{fonte}: {imagens} elemento(s) de imagem ignorado(s).'})

                def visitar(elemento, xpath, herdado='paragrafo'):
                    tag = nome(elemento.tag)
                    if tag in {'script', 'style', 'img', 'image', 'svg'}:
                        return
                    nivel = int(tag[1]) if tag in {'h1', 'h2', 'h3'} else 0
                    semantica = elemento.get('{http://www.idpf.org/2007/ops}type', '').split()
                    tipo = ('nota_rodape' if {'footnote', 'endnote', 'rearnote'} & set(semantica)
                            or elemento.get('role') in {'doc-footnote', 'doc-endnote'}
                            else 'capitulo' if nivel == 1 else 'secao' if nivel else
                            {'li': 'lista', 'blockquote': 'citacao', 'pre': 'codigo'}.get(tag, herdado))
                    partes = []

                    def publicar():
                        bruto = ''.join(partes)
                        texto = bruto.strip('\n') if tipo == 'codigo' else re.sub(r'\s+', ' ', bruto).strip()
                        partes.clear()
                        if texto.strip():
                            origem = {'tipo': 'epub', 'arquivo': fonte, 'xpath': xpath}
                            blocos.append(Bloco(tipo, texto, [], [Fragmento(origem, 0, len(texto))], nivel))

                    def percorrer(no, trilha):
                        partes.append(no.text or '')
                        contagens = {}
                        for filho in no:
                            filho_tag = nome(filho.tag)
                            contagens[filho_tag] = contagens.get(filho_tag, 0) + 1
                            local = f'{trilha}/{filho_tag}[{contagens[filho_tag]}]'
                            if filho_tag in BLOCOS_HTML:
                                publicar()
                                visitar(filho, local, tipo)
                            elif filho_tag == 'br':
                                partes.append('\n')
                            elif filho_tag not in {'script', 'style', 'img', 'image', 'svg'}:
                                percorrer(filho, local)
                            partes.append(filho.tail or '')
                    percorrer(elemento, xpath)
                    publicar()

                visitar(corpo, '/html/body')
            return blocos, metadados, limites
    except (BadZipFile, ET.ParseError, KeyError, RuntimeError) as erro:
        raise ValueError('EPUB inválido: ZIP, XML ou recurso do pacote ilegível.') from erro
