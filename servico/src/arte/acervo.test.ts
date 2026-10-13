import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnaliseCurtaDaObraV1 } from '@margem/contratos';
import { conferirManifesto, lerAcervo, tituloDaAnalise } from './acervo';
import { registrarRotasDeArte } from '../http/rotas-arte';

const doRepo = (relativo: string): string => fileURLToPath(new URL(`../../../${relativo}`, import.meta.url));
let raiz = '';
let curta: AnaliseCurtaDaObraV1;
const avisos: string[] = [];
const aviso = (m: string) => { avisos.push(m); };

/** Um manifesto falso, coerente com a curta: tempos "reais" um pouco diferentes dos estimados. */
function manifestoFalso(c: AnaliseCurtaDaObraV1, sha: string) {
  let cursor = 0;
  return {
    versao: 1, analise: 'geracoes/codex-v2', curta_sha256: sha,
    voz: { perfil: 'omnivoice-seed123', modelo: 'k2-fsa/OmniVoice', seed: 123 }, arquivo: 'narracao.mp3',
    duracao_s: 0,
    batidas: c.batidas.map((b, indice) => {
      const palavras = b.narracao.split(/\s+/).map((texto) => { const p = { texto, inicio_s: cursor, fim_s: cursor + 0.3 }; cursor += 0.4; return p; });
      const inicio_s = palavras[0]!.inicio_s; const fim_s = cursor; cursor += 0.5;
      return { indice, inicio_s, fim_s, texto: b.narracao, palavras };
    }),
  };
}

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'acervo-teste-'));
  const obra = join(raiz, 'quadro-a');
  await mkdir(join(obra, 'geracoes', 'codex-v2'), { recursive: true });
  await mkdir(join(obra, 'audio', 'codex-v2'), { recursive: true });
  await copyFile(doRepo('web/public/arte/educacao.jpg'), join(obra, 'imagem.jpg'));
  await writeFile(join(obra, 'imagem.json'), JSON.stringify({ origem_url: 'https://commons.wikimedia.org/wiki/File:x.jpg', licenca: 'Domínio público', credito: 'Wikimedia Commons', baixado_em: '2026-09-30T12:00:00Z' }));
  for (const [origem, destino] of [['educacao.modelo.json', 'esperado.modelo.json'], ['educacao.curta.json', 'esperado.curta.json'], ['educacao.modelo.json', 'geracoes/codex-v2/modelo.json'], ['educacao.curta.json', 'geracoes/codex-v2/curta.json']] as const) {
    await copyFile(doRepo(`fixtures/arte/${origem}`), join(obra, destino));
  }
  const bytes = await readFile(join(obra, 'geracoes/codex-v2/curta.json'));
  curta = JSON.parse(bytes.toString('utf8')) as AnaliseCurtaDaObraV1;
  const manifesto = manifestoFalso(curta, createHash('sha256').update(bytes).digest('hex'));
  manifesto.duracao_s = manifesto.batidas.at(-1)!.fim_s;
  await writeFile(join(obra, 'audio/codex-v2/manifesto.json'), JSON.stringify(manifesto));
  await writeFile(join(obra, 'audio/codex-v2/narracao.mp3'), Buffer.alloc(1000, 7));
  await writeFile(join(obra, 'publicado.json'), JSON.stringify({ analise: 'esperado' }));
  // Uma obra inválida (modelo de outra imagem) e uma sem imagem: ficam de fora, com aviso.
  await mkdir(join(raiz, 'quebrada'), { recursive: true });
  await copyFile(doRepo('web/public/arte/tolo.jpg'), join(raiz, 'quebrada', 'imagem.jpg'));
  await copyFile(doRepo('fixtures/arte/educacao.modelo.json'), join(raiz, 'quebrada', 'esperado.modelo.json'));
  await copyFile(doRepo('fixtures/arte/educacao.curta.json'), join(raiz, 'quebrada', 'esperado.curta.json'));
  await mkdir(join(raiz, 'em-curso'), { recursive: true });
});
afterAll(async () => { await rm(raiz, { recursive: true, force: true }); });

describe('acervo de quadros', () => {
  it('lê obras válidas, recusa as inválidas com aviso e completa com as fixtures', async () => {
    const obras = await lerAcervo({ raiz, aviso });
    expect(obras.map((o) => o.slug).sort()).toEqual(['educacao', 'quadro-a', 'tolo']);
    expect(avisos.some((a) => a.startsWith('quebrada') && a.includes('sha256'))).toBe(true);
    expect(avisos.some((a) => a.startsWith('em-curso') && a.includes('imagem.jpg'))).toBe(true);
    const a = obras.find((o) => o.slug === 'quadro-a')!;
    expect(a.analises.map((x) => x.rotulo)).toEqual(['esperado', 'codex-v2']);
    expect(a.publicada).toBe('esperado');
    expect(a.analises.find((x) => x.rotulo === 'codex-v2')!.audio).not.toBeNull();
    expect(a.adicionado_em).toBe('2026-09-30T12:00:00Z');
    expect((await lerAcervo({ raiz, aviso, fixtures: false })).map((o) => o.slug)).toEqual(['quadro-a']);
  });

  it('data ilegível vira a data do arquivo e uma obra com erro de disco não derruba a lista (auditoria 02/10)', async () => {
    const outra = await mkdtemp(join(tmpdir(), 'acervo-teste-erro-'));
    try {
      const boa = join(outra, 'boa');
      await mkdir(boa, { recursive: true });
      await copyFile(doRepo('web/public/arte/educacao.jpg'), join(boa, 'imagem.jpg'));
      await writeFile(join(boa, 'imagem.json'), JSON.stringify({ baixado_em: 'desconhecido' }));
      await copyFile(doRepo('fixtures/arte/educacao.modelo.json'), join(boa, 'esperado.modelo.json'));
      await copyFile(doRepo('fixtures/arte/educacao.curta.json'), join(boa, 'esperado.curta.json'));
      const ruim = join(outra, 'ruim');
      await mkdir(ruim, { recursive: true });
      await copyFile(doRepo('web/public/arte/educacao.jpg'), join(ruim, 'imagem.jpg'));
      await writeFile(join(ruim, 'geracoes'), 'não é pasta');
      const obras = await lerAcervo({ raiz: outra, aviso, fixtures: false });
      expect(obras.map((o) => o.slug)).toEqual(['boa']);
      expect(Number.isNaN(Date.parse(obras[0]!.adicionado_em))).toBe(false);
      expect(avisos.some((a) => a.startsWith('ruim'))).toBe(true);
    } finally { await rm(outra, { recursive: true, force: true }); }
  });

  it('sem publicado.json, a geração mais recente é a publicada', async () => {
    await rm(join(raiz, 'quadro-a', 'publicado.json'));
    const obra = (await lerAcervo({ raiz, aviso, fixtures: false }))[0]!;
    expect(obra.publicada).toBe('codex-v2');
    await writeFile(join(raiz, 'quadro-a', 'publicado.json'), JSON.stringify({ analise: 'esperado' }));
  });

  it('o manifesto confere batidas, palavras e campos', () => {
    const bom = manifestoFalso(curta, 'x');
    bom.duracao_s = 30;
    expect(conferirManifesto(bom, curta).erros).toEqual([]);
    expect(conferirManifesto({ ...bom, batidas: bom.batidas.slice(1) }, curta).erros).toContain('batidas_diferentes_da_curta');
    expect(conferirManifesto({ ...bom, arquivo: '../x.mp3' }, curta).erros).toContain('arquivo');
    expect(conferirManifesto({ ...bom, extra: 1 }, curta).erros).toContain('campo_desconhecido:extra');
  });

  it('títulos legíveis das análises', () => {
    expect(tituloDaAnalise('esperado')).toBe('Referência');
    expect(tituloDaAnalise('codex-v2')).toBe('Codex v2');
    expect(tituloDaAnalise('v2-20260930-a')).toBe('Codex v2 · 30/09 · a');
    expect(tituloDaAnalise('v1-j94')).toBe('Codex v1 · J94');
  });
});

describe('rotas de quadros sobre o acervo', () => {
  const app = new Hono();
  beforeAll(() => { registrarRotasDeArte(app, { raiz, aviso }); });

  it('lista com miniatura e análises; detalhe com a publicada e a imagem do serviço', async () => {
    const lista = await (await app.request('/api/arte')).json() as { obras: { slug: string; ano: string | null; miniatura: string; analises: { rotulo: string; publicada: boolean; audio: boolean }[] }[] };
    const a = lista.obras.find((o) => o.slug === 'quadro-a')!;
    expect(a.ano).toBe('1887');
    expect(a.miniatura).toBe('/api/arte/quadro-a/miniatura');
    expect(a.analises).toEqual([expect.objectContaining({ rotulo: 'esperado', publicada: true, audio: false }), expect.objectContaining({ rotulo: 'codex-v2', publicada: false, audio: true })]);
    const detalhe = await (await app.request('/api/arte/quadro-a')).json() as { analise: { rotulo: string; imagem: string; modelo: { imagem: { url: string } } }; imagem: { url: string; info: { licenca: string } } };
    expect(detalhe.analise.rotulo).toBe('esperado');
    expect(detalhe.imagem.url).toBe('/api/arte/quadro-a/imagem');
    expect(detalhe.analise.imagem).toBe('/api/arte/quadro-a/imagem');
    // O modelo segue o contrato (`/arte/<slug>.jpg`); o app usa a rota do serviço.
    expect(detalhe.analise.modelo.imagem.url).toMatch(/^\/arte\/[a-z0-9-]+\.jpg$/);
    expect(detalhe.imagem.info.licenca).toBe('Domínio público');
    const outra = await (await app.request('/api/arte/quadro-a/analises/codex-v2')).json() as { rotulo: string; audio: boolean };
    expect(outra).toMatchObject({ rotulo: 'codex-v2', audio: true });
    expect((await app.request('/api/arte/quadro-a/analises/nenhuma')).status).toBe(404);
    expect((await app.request('/api/arte/quebrada')).status).toBe(404);
  });

  it('serve a imagem e a narração com faixa de bytes; o manifesto em JSON', async () => {
    const imagem = await app.request('/api/arte/quadro-a/imagem', { headers: { range: 'bytes=0-9' } });
    expect(imagem.status).toBe(206);
    expect(imagem.headers.get('content-range')).toMatch(/^bytes 0-9\//);
    const audio = await app.request('/api/arte/quadro-a/audio/codex-v2/narracao.mp3', { headers: { range: 'bytes=100-' } });
    expect(audio.status).toBe(206);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
    expect((await audio.arrayBuffer()).byteLength).toBe(900);
    const manifesto = await (await app.request('/api/arte/quadro-a/audio/codex-v2/manifesto.json')).json() as { batidas: unknown[] };
    expect(manifesto.batidas).toHaveLength(curta.batidas.length);
    expect((await app.request('/api/arte/quadro-a/audio/esperado/manifesto.json')).status).toBe(404);
  });

  it('não registra escrita', async () => {
    expect((await app.request('/api/arte/quadro-a', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/arte/quadro-a', { method: 'DELETE' })).status).toBe(404);
  });
});
