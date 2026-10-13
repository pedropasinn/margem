import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buscarDossieAutomatico, idDeFonte } from './dossie-auto';

const respostas: Record<string, unknown> = {
  'action=query&prop=imageinfo': { query: { pages: [{ pageid: 42, imageinfo: [{ extmetadata: { ObjectName: { value: 'The Kiss' }, Artist: { value: '<a href="x">Gustav Klimt</a>' } } }] }] } },
  'wbgetentities&ids=M42': { entities: { M42: { statements: { P6243: [{ mainsnak: { datavalue: { value: { id: 'Q698487' } } } }] } } } },
  'EntityData/Q698487': { entities: { Q698487: {
    labels: { pt: { value: 'O beijo' }, de: { value: 'Der Kuss' } },
    claims: { P170: [{ mainsnak: { datavalue: { value: { id: 'Q34661' } } } }], P571: [{ mainsnak: { datavalue: { value: { time: '+1907-00-00T00:00:00Z' } } } }], P195: [{ mainsnak: { datavalue: { value: { id: 'Q303139' } } } }] },
    sitelinks: { ptwiki: { title: 'O beijo (Gustav Klimt)' } },
  } } },
  'props=labels': { entities: { Q34661: { labels: { pt: { value: 'Gustav Klimt' } } }, Q303139: { labels: { pt: { value: 'Belvedere' } } } } },
  'pt.wikipedia.org': { query: { pages: [{ extract: 'O beijo é uma pintura a óleo de Gustav Klimt.' }] } },
};

describe('dossiê automático', () => {
  it('Commons → Wikidata → Wikipédia, com instantâneo em fontes/ e ids estáveis', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'dossie-auto-'));
    try {
      await writeFile(join(pasta, 'imagem.json'), JSON.stringify({ origem_url: 'https://commons.wikimedia.org/wiki/File:The_Kiss.jpg' }));
      const urls: string[] = [];
      const buscar = (url: string) => { urls.push(url); const chave = Object.keys(respostas).find((k) => url.includes(k)); return chave ? Promise.resolve(respostas[chave]) : Promise.reject(new Error(url)); };
      const d = await buscarDossieAutomatico(pasta, buscar, '2026-09-30');
      expect(d.qid).toBe('Q698487');
      expect(d.identidade).toMatchObject({ titulo: 'O beijo', titulo_original: 'Der Kuss', artista: 'Gustav Klimt', data: '1907' });
      expect(d.localizacao.instituicao_proprietaria).toBe('Belvedere');
      expect(d.fontes.map((f) => f.arquivo)).toEqual(['auto-commons.txt', 'auto-wikidata.txt', 'auto-wp-pt.txt']);
      expect(d.fontes[1]!.id).toBe(idDeFonte('https://www.wikidata.org/wiki/Q698487'));
      expect(await readFile(join(pasta, 'fontes/auto-wp-pt.txt'), 'utf8')).toContain('pintura a óleo de Gustav Klimt');
      expect(urls.every((u) => u.startsWith('https://'))).toBe(true);
    } finally { await rm(pasta, { recursive: true, force: true }); }
  });

  it('sem P6243 no Commons, usa o Q-id anotado no imagem.json; título original do P1476', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'dossie-auto-'));
    try {
      await writeFile(join(pasta, 'imagem.json'), JSON.stringify({ origem_url: 'https://commons.wikimedia.org/wiki/File:The_Kiss.jpg', wikidata: 'Q698487' }));
      const semP6243: Record<string, unknown> = { ...respostas, 'wbgetentities&ids=M42': { entities: { M42: { statements: {} } } } };
      const entidade = (respostas['EntityData/Q698487'] as { entities: { Q698487: { claims: Record<string, unknown> } } }).entities.Q698487;
      semP6243['EntityData/Q698487'] = { entities: { Q698487: { ...entidade, claims: { ...entidade.claims, P1476: [{ mainsnak: { datavalue: { value: { text: 'Liebespaar', language: 'de' } } } }] } } } };
      const buscar = (url: string) => { const chave = Object.keys(semP6243).find((k) => url.includes(k)); return chave ? Promise.resolve(semP6243[chave]) : Promise.reject(new Error(url)); };
      const d = await buscarDossieAutomatico(pasta, buscar, '2026-10-02');
      expect(d.qid).toBe('Q698487');
      expect(d.identidade.titulo_original).toBe('Liebespaar');
    } finally { await rm(pasta, { recursive: true, force: true }); }
  });
});
