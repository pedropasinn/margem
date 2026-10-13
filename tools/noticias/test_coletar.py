import datetime as dt
import unittest
from coletar import FEEDS, coletar, data_publicacao, entradas, url_segura


class ColetaTest(unittest.TestCase):
    def test_datas_e_urls(self):
        self.assertEqual(data_publicacao('Mon, 05 Oct 2026 08:00:00 +0000'), '2026-10-05T08:00:00+00:00')
        self.assertIsNone(data_publicacao('2026-10-05'))
        self.assertEqual(url_segura('https://simonwillison.net/a?utm_source=x&fbclid=1#b'), 'https://simonwillison.net/a')
        for url in ['https://127.0.0.1/a', 'https://simonwillison.net.evil.test/a', 'file:///etc/passwd', 'https://x@simonwillison.net/a']:
            with self.assertRaises(ValueError): url_segura(url)

    def test_publicacao_tem_prioridade_sobre_updated(self):
        xml = b'<feed><entry><title>A</title><link href="https://simonwillison.net/a"/><updated>2026-10-05T10:00:00Z</updated><published>2025-01-01T10:00:00Z</published></entry></feed>'
        self.assertTrue(entradas(xml, FEEDS[0][1])[0]['publicada_em'].startswith('2025-01-01'))

    def test_lote_deduplicado_antigos_e_cobertura_com_falhas(self):
        item = '<item><title>A</title><link>https://simonwillison.net/a</link><pubDate>Mon, 05 Oct 2026 08:00:00 +0000</pubDate></item>'
        velho = item.replace('/a<', '/velho<').replace('05 Oct 2026', '05 Oct 2025')
        def rede(url, prazo):
            if url == FEEDS[0][1]: return ('<rss>' + item * 2 + velho + '</rss>').encode()
            if url == 'https://simonwillison.net/a': return ('<article>' + 'Texto verificável. ' * 20 + '</article>').encode()
            raise TimeoutError()
        r = coletar('2026-10-05T10:00:00+00:00', [], rede)
        self.assertEqual(len(r['fontes']), 1)
        self.assertEqual(len(r['cobertura']), 4)
        self.assertEqual(sum(c['estado'] == 'falhou' for c in r['cobertura']), 3)
        self.assertEqual(coletar('2026-10-05T10:00:00+00:00', ['https://simonwillison.net/a'], rede)['fontes'], [])


if __name__ == '__main__': unittest.main()
