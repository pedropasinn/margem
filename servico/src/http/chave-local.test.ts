/**
 * S-01 · Chave local por instalação. Com `MARGEM_CHAVE_LOCAL`, toda rota `/api/*` (GETs inclusive) exige a
 * chave por `Authorization: Bearer` ou pelo cookie que `POST /api/sessao` devolve à janela; sem ela, 401.
 * A saúde continua pública. Sem a variável, o comportamento de antes. Host e Origin continuam valendo.
 *
 * Roda contra um Postgres de teste (`margem_test_*`, criado e destruído aqui).
 */
import type { Hono } from 'hono';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import { chaveLocal } from './ambiente.js';
import { criarApi } from './app.js';

const CHAVE = 'k'.repeat(20) + 'Q7_-x'.repeat(5);
const HOST = { Host: '127.0.0.1:8730' };
const salva = process.env.MARGEM_CHAVE_LOCAL;
beforeEach(() => { process.env.MARGEM_CHAVE_LOCAL = CHAVE; });
afterEach(() => { if (salva === undefined) delete process.env.MARGEM_CHAVE_LOCAL; else process.env.MARGEM_CHAVE_LOCAL = salva; });

const url = (caminho: string) => `http://127.0.0.1:8730${caminho}`;
const ler = (api: Hono, caminho: string, cabecalhos: Record<string, string> = {}) => api.request(url(caminho), { headers: { ...HOST, ...cabecalhos } });

test('chave curta ou com caracteres estranhos derruba em vez de valer fraca; vazia é sem chave', () => {
  expect(chaveLocal({ MARGEM_CHAVE_LOCAL: CHAVE })).toBe(CHAVE);
  expect(chaveLocal({ MARGEM_CHAVE_LOCAL: '  ' })).toBeUndefined();
  expect(chaveLocal({})).toBeUndefined();
  expect(() => chaveLocal({ MARGEM_CHAVE_LOCAL: 'curta' })).toThrow(/MARGEM_CHAVE_LOCAL/u);
  expect(() => chaveLocal({ MARGEM_CHAVE_LOCAL: `${CHAVE};x=1` })).toThrow(/MARGEM_CHAVE_LOCAL/u);
});

test('com chave: leitura, escrita, SSE e PDF original pedem a chave; o cookie da sessão cobre a janela', async () => comBanco('chave_local', async (banco) => {
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); } });
  const canonico = canonicoDeTeste({ titulo: 'Particular', blocos: [{ tipo: 'paragrafo', texto: 'Texto que só a dona lê.' }], secoes: [] });
  const doc = await comTransacao(banco, async (cliente) => documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'p.md' }));

  // Sem chave ou com a errada: 401, inclusive nos GETs e no que a janela carrega sem fetch.
  for (const caminho of ['/api/documentos', `/api/documentos/${doc.id}`, '/api/eventos', `/api/documentos/${doc.id}/original`, '/api/recursos']) {
    const sem = await ler(api, caminho);
    expect(sem.status, caminho).toBe(401);
    expect(await sem.json()).toMatchObject({ erro: 'chave_local' });
    expect((await ler(api, caminho, { Authorization: 'Bearer outra-chave-qualquer-com-tamanho-suficiente' })).status, caminho).toBe(401);
    expect((await ler(api, caminho, { Cookie: 'margem_chave=errada' })).status, caminho).toBe(401);
  }
  // Apagar com a confirmação pública também não passa.
  const apagar = await api.request(url(`/api/documentos/${doc.id}/apagar`), {
    method: 'POST', headers: { ...HOST, 'X-Margem': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmacao: 'apagar tudo' }),
  });
  expect(apagar.status).toBe(401);
  expect((await ler(api, '/api/documentos', { Authorization: `Bearer ${CHAVE}` })).status).toBe(200);
  const lista = await (await ler(api, '/api/documentos', { Authorization: `Bearer ${CHAVE}` })).json() as { documentos: { id: string }[] };
  expect(lista.documentos.map((d) => d.id)).toContain(doc.id);

  // A saúde fica pública: a extensão e o app procuram o Margem por ela.
  expect((await ler(api, '/api/saude')).status).toBe(200);

  // A janela troca a chave pelo cookie HttpOnly, SameSite=Strict, e daí o resto vai sozinho.
  const sessaoErrada = await api.request(url('/api/sessao'), { method: 'POST', headers: { ...HOST, 'X-Margem': '1', Authorization: 'Bearer errada' } });
  expect(sessaoErrada.status).toBe(401);
  expect(sessaoErrada.headers.get('set-cookie')).toBeNull();
  const sessao = await api.request(url('/api/sessao'), {
    method: 'POST', headers: { ...HOST, Origin: 'http://127.0.0.1:8730', 'X-Margem': '1', Authorization: `Bearer ${CHAVE}` },
  });
  expect(sessao.status).toBe(204);
  const cookie = sessao.headers.get('set-cookie') ?? '';
  expect(cookie).toMatch(/^margem_chave=/u);
  expect(cookie).toMatch(/HttpOnly/iu);
  expect(cookie).toMatch(/SameSite=Strict/iu);
  expect(cookie).toMatch(/Path=\/api/iu);
  const comCookie = { Cookie: cookie.split(';')[0] ?? '' };
  expect((await ler(api, '/api/documentos', comCookie)).status).toBe(200);
  const eventos = await ler(api, '/api/eventos', comCookie);
  expect(eventos.status).toBe(200);
  expect(eventos.headers.get('content-type')).toMatch(/text\/event-stream/u);
  await eventos.body?.cancel();
  // O original desse documento não existe no disco: passa da chave e chega à rota (não é mais 401).
  expect((await ler(api, `/api/documentos/${doc.id}/original`, comCookie)).status).not.toBe(401);

  // Host e Origin continuam conferidos antes da chave.
  expect((await api.request('http://evil.example/api/documentos', { headers: { Host: 'evil.example', Authorization: `Bearer ${CHAVE}` } })).status).toBe(403);
  expect((await ler(api, '/api/documentos', { Origin: 'https://evil.example', Authorization: `Bearer ${CHAVE}` })).status).toBe(403);
}));

test('sem a variável (desenvolvimento, Docker, servidor pessoal): nada muda, e não há sessão a abrir', async () => comBanco('chave_local_sem', async (banco) => {
  delete process.env.MARGEM_CHAVE_LOCAL;
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); } });
  expect((await ler(api, '/api/documentos')).status).toBe(200);
  const sessao = await api.request(url('/api/sessao'), { method: 'POST', headers: { ...HOST, 'X-Margem': '1', Authorization: `Bearer ${CHAVE}` } });
  expect(sessao.status).toBe(404);
}));
