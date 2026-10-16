/**
 * Exportação para o Obsidian na API: nota por documento, índice e ZIP, contra um Postgres de teste
 * (`margem_test_*`, criado e destruído aqui). Só leitura: nenhuma rota exige `X-Margem`.
 */
import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { expect, test } from 'vitest';
import {
  validarIndiceObsidian, validarIndiceObsidianV2, type AncoraV1, type Bloco, type IndiceObsidianV1, type IndiceObsidianV2, type MarcaV2,
} from '@margem/contratos';
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

test('formato 2: índice por nota, notas de um documento e ZIP com pastas e manifesto', async () => comBanco('obsidian_v2', async (banco) => {
  const canonico = canonicoDeTeste({ titulo: 'Ensaio: sobre a dúvida', blocos: [
    { tipo: 'capitulo', texto: 'Primeiro' },
    { tipo: 'paragrafo', texto: 'A razão comum basta para ver que a ordem do mundo pede explicação.' },
    { tipo: 'capitulo', texto: 'Segundo' },
    { tipo: 'paragrafo', texto: 'Toda *explicação* termina em algo que não se explica.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 1 }, { nivel: 1, inicio: 2, fim: 3 }] });
  const { documentoId, versaoId } = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, autor: 'Fulano', origem_caminho: 'ensaio.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    return { documentoId: documento.id, versaoId: versao.id };
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const [, primeiro, , segundo] = canonico.blocos;
  const { marca } = await (await escrever(api, '/api/grifos', { ancora: ancora(versaoId, primeiro!, 'A razão comum basta'), funcao: 'tese' })).json() as { marca: MarcaV2 };
  const outro = await (await escrever(api, '/api/grifos', { ancora: ancora(versaoId, segundo!, 'algo que não se explica'), funcao: 'conceito' })).json() as { marca: MarcaV2 };
  expect((await escrever(api, '/api/anotacoes', { ancora: marca.ancora, tipo: 'duvida', texto: 'Basta *mesmo*?', marca_id: marca.id })).status).toBe(201);
  expect((await escrever(api, '/api/conexoes', { origem: marca.ancora, destino: { tipo: 'trecho', ancora: outro.marca.ancora },
    relacao: 'tensao', justificativa: 'Uma pede explicação, a outra **nega** que tudo se explique.' })).status).toBe(201);
  expect((await escrever(api, '/api/dificuldades', { ancora: outro.marca.ancora, tipo: 'salto_argumentativo', marca_id: outro.marca.id })).status).toBe(201);

  const indice = await (await api.request(`/api/obsidian/v2/indice?base=${encodeURIComponent(BASE)}`)).json() as IndiceObsidianV2;
  expect(validarIndiceObsidianV2(indice), JSON.stringify(validarIndiceObsidianV2.errors)).toBe(true);
  expect(indice.notas.map((nota) => [nota.tipo, nota.caminho.split('/').slice(0, -1).join('/')])).toEqual([
    ['documento', 'Ensaio - sobre a dúvida'],
    ['grifo', 'Ensaio - sobre a dúvida/Grifos'], ['grifo', 'Ensaio - sobre a dúvida/Grifos'],
    ['relacao', 'Ensaio - sobre a dúvida/Relações'],
  ]);
  expect((await api.request(`/api/obsidian/v2/indice?incluir=grifo,pinguim`)).status).toBe(400);
  const soGrifos = await (await api.request(`/api/obsidian/v2/indice?base=${encodeURIComponent(BASE)}&incluir=grifo`)).json() as IndiceObsidianV2;
  expect(soGrifos.notas.map((nota) => nota.tipo)).toEqual(['documento', 'grifo', 'grifo']);

  const doDocumento = await (await api.request(`/api/obsidian/v2/documentos/${documentoId}?base=${encodeURIComponent(BASE)}`)).json() as {
    nome: string; notas: { id: string; caminho: string; conteudo: string; sha256: string }[];
  };
  expect(doDocumento.nome).toBe('Ensaio - sobre a dúvida');
  expect(doDocumento.notas.map((nota) => [nota.caminho, nota.sha256])).toEqual(indice.notas.map((nota) => [nota.caminho, nota.sha256]));
  const relacao = doDocumento.notas.find((nota) => nota.caminho.includes('/Relações/'))!.conteudo;
  expect(relacao).toContain('> A razão comum basta\n^origem');
  expect(relacao).toContain('> algo que não se explica\n^destino');
  expect(relacao).toContain('Uma pede explicação, a outra **nega** que tudo se explique.');
  // Modelo D: a nota do leitor mora na nota do grifo (sem tipo) e a dificuldade vem do sinal.
  const tese = doDocumento.notas.find((nota) => nota.id === marca.id)!.conteudo;
  expect(tese).toContain('## Sua nota\n\nBasta *mesmo*?');
  expect(tese).not.toContain('anotacao_tipo');
  const conceito = doDocumento.notas.find((nota) => nota.id === outro.marca.id)!.conteudo;
  expect(conceito).toContain('  - "margem/dificuldade/salto_argumentativo"');
  expect(conceito).toContain('- **Salto no argumento** · marcada por você');
  expect(doDocumento.notas[0]!.conteudo).toContain('## Dificuldades');
  expect((await api.request(`/api/obsidian/v2/documentos/${'0'.repeat(26)}`)).status).toBe(404);

  // ZIP: Margem/<documento>/…, o manifesto e os mesmos bytes a cada pedido.
  const zip = new Uint8Array(await (await api.request(`/api/obsidian/v2/exportacao.zip?base=${encodeURIComponent(BASE)}`)).arrayBuffer());
  const lidos = lerZip(zip);
  expect(lidos.map((arquivo) => arquivo.nome)).toEqual([...indice.notas.map((nota) => `Margem/${nota.caminho}`), 'Margem/.margem/manifesto.json']);
  expect(JSON.parse(lidos.at(-1)!.conteudo)).toEqual(indice);
  for (const nota of doDocumento.notas) expect(lidos.find((arquivo) => arquivo.nome === `Margem/${nota.caminho}`)?.conteudo).toBe(nota.conteudo);
  expect(new Uint8Array(await (await api.request(`/api/obsidian/v2/exportacao.zip?base=${encodeURIComponent(BASE)}`)).arrayBuffer())).toEqual(zip);
  const soEste = await api.request(`/api/obsidian/v2/exportacao.zip?base=${encodeURIComponent(BASE)}&documento=${documentoId}`);
  expect(soEste.headers.get('content-disposition')).toContain(encodeURIComponent('Ensaio - sobre a dúvida.zip'));
  expect((await api.request(`/api/obsidian/v2/exportacao.zip?documento=${'0'.repeat(26)}`)).status).toBe(404);

  // As rotas da V1 continuam respondendo.
  expect((await api.request(`/api/documentos/${documentoId}/obsidian.md`)).status).toBe(200);
  expect((await api.request('/api/obsidian/indice')).status).toBe(200);
}));

test('R2-6: no app de computador os links de volta usam margem://abrir (o navegador não tem a chave)', async () => comBanco('obsidian_app', async (banco) => {
  const canonico = canonicoDeTeste({ titulo: 'Livro do app', blocos: [
    { tipo: 'capitulo', texto: 'Primeiro' },
    { tipo: 'paragrafo', texto: 'Um trecho que vale um grifo no app de computador.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
  const { documentoId, versaoId } = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'app.md' });
    return { documentoId: documento.id, versaoId: (await documentos.criarVersao(cliente, documento.id, canonico)).id };
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const bloco = canonico.blocos[1]!;
  expect((await escrever(api, '/api/grifos', { ancora: ancora(versaoId, bloco, 'vale um grifo'), funcao: 'tese' })).status).toBe(201);
  const anterior = process.env.MARGEM_APP_DESKTOP;
  try {
    process.env.MARGEM_APP_DESKTOP = '1';
    const base = encodeURIComponent('http://127.0.0.1:8731');
    const indice = await (await api.request(`/api/obsidian/v2/indice?base=${base}`)).json() as IndiceObsidianV2;
    expect(indice.url_base).toBe('margem://abrir');
    expect(validarIndiceObsidianV2(indice), JSON.stringify(validarIndiceObsidianV2.errors)).toBe(true);
    const v1 = await (await api.request(`/api/obsidian/indice?base=${base}`)).json() as IndiceObsidianV1;
    expect(validarIndiceObsidian(v1), JSON.stringify(validarIndiceObsidian.errors)).toBe(true);
    const doDocumento = await (await api.request(`/api/obsidian/v2/documentos/${documentoId}?base=${base}`)).json() as { notas: { conteudo: string }[] };
    const tudo = doDocumento.notas.map((nota) => nota.conteudo).join('\n');
    expect(tudo).toContain(`(margem://abrir/ler/${documentoId}/${canonico.secoes[0]!.id}?bloco=${bloco.id})`);
    expect(tudo).not.toContain('127.0.0.1');
    const nota = await (await api.request(`/api/documentos/${documentoId}/obsidian.md?base=${base}`)).text();
    expect(nota).toContain(`[abrir no Margem](margem://abrir/documentos/${documentoId})`);
    // A base pedida continua sendo conferida.
    expect((await api.request(`/api/obsidian/v2/indice?base=javascript:x`)).status).toBe(400);
  } finally {
    if (anterior === undefined) delete process.env.MARGEM_APP_DESKTOP; else process.env.MARGEM_APP_DESKTOP = anterior;
  }
}));

test('R3-8: com o sumário sugerido em uso, as notas usam os títulos que o sumário mostra (V1 e V2)', async () => comBanco('obsidian_sumario', async (banco) => {
  const canonico = canonicoDeTeste({ titulo: 'Zero a um', blocos: [
    { tipo: 'capitulo', texto: 'THE CHALLENGE' },
    { tipo: 'paragrafo', texto: 'O desafio do futuro é criar o novo.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
  const { documentoId, versaoId } = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'zero.epub' });
    return { documentoId: documento.id, versaoId: (await documentos.criarVersao(cliente, documento.id, canonico)).id };
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  expect((await escrever(api, '/api/grifos', { ancora: ancora(versaoId, canonico.blocos[1]!, 'criar o novo'), funcao: 'tese' })).status).toBe(201);
  const proposta = [{ bloco_inicio: canonico.secoes[0]!.bloco_inicio, titulo: '1. The Challenge of the Future', nivel: 1 }];
  await banco.query(`INSERT INTO conferencia_sumario (versao_id, documento_id, estado, resposta) VALUES ($1, $2, 'aplicada', $3)`,
    [versaoId, documentoId, JSON.stringify({ ok: false, problemas: ['caixa alta'], proposta })]);
  const v1 = await (await api.request(`/api/documentos/${documentoId}/obsidian.md?base=${encodeURIComponent(BASE)}`)).text();
  expect(v1).toContain('## 1\\. The Challenge of the Future');
  expect(v1).not.toContain('THE CHALLENGE');
  const v2 = await (await api.request(`/api/obsidian/v2/documentos/${documentoId}?base=${encodeURIComponent(BASE)}`)).json() as { notas: { conteudo: string }[] };
  const tudo = v2.notas.map((nota) => nota.conteudo).join('\n');
  expect(tudo).toMatch(/1\\?\. The Challenge of the Future/u);
  expect(tudo).not.toContain('THE CHALLENGE');
  // "Manter" volta ao título do canônico.
  await banco.query(`UPDATE conferencia_sumario SET estado='mantida'`);
  expect(await (await api.request(`/api/documentos/${documentoId}/obsidian.md?base=${encodeURIComponent(BASE)}`)).text()).toContain('## THE CHALLENGE');
}));
