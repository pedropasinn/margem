"""RSS/Atom e páginas públicas de hosts fixos; stdout contém apenas o corpus JSON."""
import datetime as dt
from email.utils import parsedate_to_datetime
import hashlib
from html.parser import HTMLParser
import json
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

FEEDS = [
    ('Simon Willison', 'https://simonwillison.net/atom/everything/'),
    ('Chip Huyen', 'https://huyenchip.com/feed.xml'),
    ('Eugene Yan', 'https://eugeneyan.com/rss/'),
    ('Hamel Husain', 'https://hamel.dev/index.xml'),
]
HOSTS = {urllib.parse.urlsplit(u).hostname for _, u in FEEDS}
MAX_BYTES = 2_000_000


def url_segura(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme != 'https' or p.hostname not in HOSTS or p.username or p.password or p.port not in (None, 443):
        raise ValueError('Endereço fora das fontes cadastradas')
    q = urllib.parse.urlencode([(k, v) for k, v in urllib.parse.parse_qsl(p.query)
                               if not k.lower().startswith('utm_') and k.lower() not in ('fbclid', 'gclid')])
    return urllib.parse.urlunsplit(('https', p.netloc.lower(), p.path or '/', q, ''))


class Redirecionamento(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, url_segura(newurl))


def baixar(url, prazo):
    restante = prazo - time.monotonic()
    if restante <= 0:
        raise TimeoutError('Orçamento de coleta encerrado')
    req = urllib.request.Request(url_segura(url), headers={'User-Agent': 'MargemNoticias/1.0 (personal RSS reader)'})
    with urllib.request.build_opener(Redirecionamento()).open(req, timeout=min(10, restante)) as r:
        dados = r.read(MAX_BYTES + 1)
    if len(dados) > MAX_BYTES:
        raise ValueError('Resposta excede 2 MB')
    return dados


class Texto(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.oculto = 0
        self.textos = []
        self.artigo = []
        self.nivel_artigo = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'nav', 'footer', 'header', 'noscript'):
            self.oculto += 1
        if tag in ('article', 'main'):
            self.nivel_artigo += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'nav', 'footer', 'header', 'noscript'):
            self.oculto = max(0, self.oculto - 1)
        if tag in ('article', 'main'):
            self.nivel_artigo = max(0, self.nivel_artigo - 1)

    def handle_data(self, data):
        if not self.oculto:
            self.textos.append(data)
            if self.nivel_artigo:
                self.artigo.append(data)


def texto_html(html):
    p = Texto()
    p.feed(html)
    return ' '.join(' '.join(p.artigo or p.textos).split())


def data_publicacao(valor):
    if not valor:
        return None
    try:
        try:
            data = dt.datetime.fromisoformat(valor.replace('Z', '+00:00'))
        except ValueError:
            data = parsedate_to_datetime(valor)
        if data.tzinfo is None:
            return None
        return data.astimezone(dt.timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def entradas(blob, feed):
    saida = []
    for e in ET.fromstring(blob).iter():
        if e.tag.split('}')[-1] not in ('entry', 'item'):
            continue
        campos, link = {}, ''
        for c in e:
            tag = c.tag.split('}')[-1]
            campos[tag] = ''.join(c.itertext())
            if tag == 'link' and c.get('rel', 'alternate') == 'alternate':
                link = c.get('href') or c.text or ''
        try:
            url = url_segura(urllib.parse.urljoin(feed, link.strip()))
        except ValueError:
            continue
        if not link or not campos.get('title'):
            continue
        saida.append({'url': url, 'titulo': texto_html(campos['title'])[:500],
                      'publicada_em': data_publicacao(campos.get('published') or campos.get('pubDate') or campos.get('updated')),
                      'texto': texto_html(campos.get('content') or campos.get('encoded') or campos.get('description') or campos.get('summary') or '')[:18000]})
    return saida


def coletar(corte, vistas, baixar_fonte=baixar):
    corte_dt = dt.datetime.fromisoformat(corte.replace('Z', '+00:00'))
    prazo = time.monotonic() + 100
    fontes, cobertura, vistos = [], [], set(vistas)
    # Todos os feeds têm um registro, mesmo quando não há orçamento para consultá-los.
    for nome, url in FEEDS:
        registro = {'nome': nome, 'url': url, 'estado': 'ok', 'candidatos': 0, 'lidos': 0, 'limite': ''}
        cobertura.append(registro)
        try:
            candidatos = entradas(baixar_fonte(url, prazo), url)
            registro['candidatos'] = len(candidatos)
            elegiveis = []
            for item in candidatos:
                publicada = dt.datetime.fromisoformat(item['publicada_em']) if item['publicada_em'] else None
                # Reconciliação de 72 h. Sem data e arquivo antigo não entram como novidade.
                if item['url'] in vistos or publicada is None or not 0 <= (corte_dt - publicada).total_seconds() <= 72 * 3600:
                    continue
                vistos.add(item['url'])
                elegiveis.append(item)
            elegiveis.sort(key=lambda i: i['publicada_em'], reverse=True)
            if len(elegiveis) > 5:
                registro.update(estado='parcial', limite='Limite de cinco páginas por fonte; há candidatos não lidos.')
            for item in elegiveis[:5]:
                try:
                    corpo = texto_html(baixar_fonte(item['url'], prazo).decode('utf-8', errors='replace'))
                    if len(corpo) < 120:
                        raise ValueError('Página sem texto suficiente')
                    if len(corpo) > 18000:
                        registro.update(estado='parcial', limite='Texto limitado a 18 mil caracteres por página.')
                    item['texto'], item['acesso'] = corpo[:18000], 'pagina'
                    registro['lidos'] += 1
                except Exception:
                    registro.update(estado='parcial', limite='Uma ou mais páginas indisponíveis; metadados não foram usados como leitura integral.')
                    item['acesso'] = 'feed'
                if item['texto']:
                    item['sha256'] = hashlib.sha256(item['texto'].encode()).hexdigest()
                    fontes.append(item)
        except Exception as erro:
            registro.update(estado='falhou', limite=f'Fonte não consultada: {type(erro).__name__}.')
    return {'fontes': fontes, 'cobertura': cobertura}


if __name__ == '__main__':
    pedido = json.load(sys.stdin)
    print(json.dumps(coletar(pedido['corte_em'], pedido['vistas']), ensure_ascii=False))
