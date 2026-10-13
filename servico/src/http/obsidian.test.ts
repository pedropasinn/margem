/**
 * Exportação para o Obsidian na API: nota por documento, índice e ZIP, contra um Postgres de teste
 * (`margem_test_*`, criado e destruído aqui). Só leitura: nenhuma rota exige `X-Margem`.
 */
import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { expect, test } from 'vitest';
import { validarIndiceObsidian, type AncoraV1, type Bloco, type IndiceObsidianV1, type MarcaV2 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { lerZip } from '../../testes/zip.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import { criarApi } from './app.js';
import { normalizarUrlBase } from './rotas-obsidian.js';

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
function escrever(api: Hono, caminho: string, dado: unknown): Promise<Response> {
  return Promise.resolve(api.request(caminho, { method: 'POST', headers: ESCRITA, body: JSON.stringify(dado) }));
}
function ancora(versaoId: string, bloco: Bloco, citacao: string): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length,
    citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length) };
}
const BASE = 'https://margem.exemplo.ts.net';
const sha = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

test('a URL base aceita só http(s) que possa ir crua num link Markdown', () => {
  expect(normalizarUrlBase('https://maquina.tail.ts.net/')).toBe('https://maquina.tail.ts.net');
  expect(normalizarUrlBase('http://127.0.0.1:8730/margem')).toBe('http://127.0.0.1:8730/margem');
  for (const ruim of ['javascript:alert(1)', 'https://x.net/a)b', 'https://x y', 'ftp://x', 'https://x.net/?q=1', '']) {
    expect(normalizarUrlBase(ruim)).toBeNull();
  }
});

test('exporta a nota do documento, o índice e o ZIP, determinísticos e só com o que é do leitor', async () => comBanco('obsidian_api', async (banco) => {
  const canonico = canonicoDeTeste({ titulo: 'Ensaio: sobre a dúvida', blocos: [
    { tipo: 'capitulo', texto: 'Primeiro' },
    { tipo: 'paragrafo', texto: 'A razão comum basta para ver que a ordem do mundo pede explicação.' },
    { tipo: 'capitulo', texto: 'Segundo' },
    { tipo: 'paragrafo', texto: 'Toda *explicação* termina em algo que não se explica.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 1 }, { nivel: 1, inicio: 2, fim: 3 }] });
  const outro = canonicoDeTeste({ titulo: 'Sem notas', blocos: [{ tipo: 'paragrafo', texto: 'Nada aqui.' }] });
  const { documentoId, versaoId } = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, autor: 'Fulano', origem_caminho: 'ensaio.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const vazio = await documentos.criar(cliente, { ...outro.documento, sha256_original: 'b'.repeat(64), origem_caminho: 'vazio.md' });
    await documentos.criarVersao(cliente, vazio.id, { ...outro, documento: { ...outro.documento, sha256_original: 'b'.repeat(64) } });
    return { documentoId: documento.id, versaoId: versao.id };
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const [, primeiro, , segundo] = canonico.blocos;

  // O leitor grifa, anota, pergunta e conecta.
  const grifo = await escrever(api, '/api/grifos', { ancora: ancora(versaoId, primeiro!, 'A razão comum basta'), funcao: 'tese' });
  expect(grifo.status).toBe(201);
  const { marca } = await grifo.json() as { marca: MarcaV2 };
  expect((await escrever(api, '/api/anotacoes', { ancora: marca.ancora, tipo: 'duvida', texto: 'Basta *mesmo*?', marca_id: marca.id })).status).toBe(201);
  expect((await escrever(api, '/api/anotacoes', { ancora: ancora(versaoId, segundo!, 'algo que não se explica'), tipo: 'nota', texto: 'Wittgenstein: a pá entorta.' })).status).toBe(201);
  expect((await escrever(api, '/api/conversas', { ancora: marca.ancora, pergunta: 'Que ordem?', marca_id: marca.id })).status).toBe(201);
  expect((await escrever(api, '/api/conexoes', { origem: marca.ancora, destino: { tipo: 'nota_externa', caminho: 'Zettel/Razão.md', titulo: 'Razão' },
    relacao: 'desenvolve', justificativa: 'Minha nota.' })).status).toBe(201);

  // GET sem X-Margem: leitura não precisa do cabeçalho.
  const resposta = await api.request(`/api/documentos/${documentoId}/obsidian.md?base=${encodeURIComponent(`${BASE}/`)}`);
  expect(resposta.status).toBe(200);
  expect(resposta.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  expect(resposta.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('Ensaio - sobre a dúvida.md')}`);
  const nota = await resposta.text();
  expect(resposta.headers.get('etag')).toBe(`"${sha(nota)}"`);
  expect(resposta.headers.get('x-margem-itens')).toBe('2');
  expect(nota).toContain(`margem_id: "${documentoId}"`);
  expect(nota).toContain('autor: "Fulano"');
  expect(nota).toContain(`> [!important] Tese · [abrir no Margem](${BASE}/ler/${documentoId}/${canonico.secoes[0]!.id}?bloco=${primeiro!.id})\n> A razão comum basta`);
  expect(nota).toContain('**Dúvida.** Basta \\*mesmo\\*?');
  expect(nota).toContain('> [!question]- Que ordem?');
  expect(nota).toContain('- *Desenvolve:* [[Zettel/Razão|Razão]] — Minha nota.');
  expect(nota).toContain('## Segundo');
  expect(nota).toContain('Wittgenstein: a pá entorta.');

  // Idempotente; com If-None-Match, 304.
  const deNovo = await api.request(`/api/documentos/${documentoId}/obsidian.md?base=${encodeURIComponent(BASE)}`);
  expect(await deNovo.text()).toBe(nota);
  const naoMudou = await api.request(`/api/documentos/${documentoId}/obsidian.md?base=${encodeURIComponent(BASE)}`, { headers: { 'If-None-Match': `"${sha(nota)}"` } });
  expect(naoMudou.status).toBe(304);

  // Sem base: MARGEM_URL_PUBLICA; sem ela, a origem do pedido.
  const anterior = process.env.MARGEM_URL_PUBLICA;
  try {
    process.env.MARGEM_URL_PUBLICA = 'https://outra.ts.net/';
    expect(await (await api.request(`/api/documentos/${documentoId}/obsidian.md`)).text()).toContain('margem_url: "https://outra.ts.net/documentos/');
    delete process.env.MARGEM_URL_PUBLICA;
    expect(await (await api.request(`http://127.0.0.1:8730/api/documentos/${documentoId}/obsidian.md`)).text()).toContain('margem_url: "http://127.0.0.1:8730/documentos/');
  } finally {
    if (anterior === undefined) delete process.env.MARGEM_URL_PUBLICA; else process.env.MARGEM_URL_PUBLICA = anterior;
  }

  // Erros.
  expect((await api.request(`/api/documentos/${documentoId}/obsidian.md?base=javascript:x`)).status).toBe(400);
  expect((await api.request(`/api/documentos/${documentoId}/obsidian.md?marcas=algumas`)).status).toBe(400);
  expect((await api.request(`/api/documentos/${'0'.repeat(26)}/obsidian.md`)).status).toBe(404);
  expect((await api.request('/api/documentos/nao-e-ulid/obsidian.md')).status).toBe(400);

  // Índice: só o documento com algo do leitor; com todos=1, também o outro.
  const indice = await (await api.request(`/api/obsidian/indice?base=${encodeURIComponent(BASE)}`)).json() as IndiceObsidianV1;
  expect(validarIndiceObsidian(indice)).toBe(true);
  expect(indice).toMatchObject({ versao: 1, url_base: BASE, marcas: 'minhas' });
  expect(indice.documentos).toEqual([{ documento_id: documentoId, versao_id: versaoId, titulo: 'Ensaio: sobre a dúvida',
    arquivo: 'Ensaio - sobre a dúvida.md', sha256: sha(nota), itens: 2, atualizado_em: expect.any(String) as string }]);
  const todos = await (await api.request(`/api/obsidian/indice?base=${encodeURIComponent(BASE)}&todos=1&marcas=todas`)).json() as IndiceObsidianV1;
  expect(validarIndiceObsidian(todos)).toBe(true);
  expect(todos.documentos.map((documento) => [documento.arquivo, documento.itens])).toEqual([['Ensaio - sobre a dúvida.md', 2], ['Sem notas.md', 0]]);

  // ZIP: as mesmas notas, byte a byte, e o mesmo ZIP a cada pedido.
  const zip = new Uint8Array(await (await api.request(`/api/obsidian/exportacao.zip?base=${encodeURIComponent(BASE)}`)).arrayBuffer());
  expect(lerZip(zip).map(({ nome, conteudo }) => ({ nome, conteudo }))).toEqual([{ nome: 'Ensaio - sobre a dúvida.md', conteudo: nota }]);
  const zipDeNovo = new Uint8Array(await (await api.request(`/api/obsidian/exportacao.zip?base=${encodeURIComponent(BASE)}`)).arrayBuffer());
  expect(zipDeNovo).toEqual(zip);
}));
