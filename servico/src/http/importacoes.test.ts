import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comBanco } from '../../testes/apoio.js';
import { manipuladorCanonizar, TIPO_CANONIZAR } from '../worker/canonizar.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { raizDoRepositorio } from '../dados.js';
import { comTransacao } from '../db/transacao.js';
import type { ConfiguracaoDaLeitura } from '../leitura/manipuladores.js';
import { criarApi } from './app.js';
import { origensDeExtensao } from './ambiente.js';
import { originalDaPaginaWeb } from './rotas-importacoes.js';

const temporarios: string[] = [];
const ambienteOriginal = { dados: process.env.MARGEM_DADOS, extensoes: process.env.MARGEM_EXTENSOES };
const CHROME = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const FIREFOX = 'moz-extension://0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';

afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
  for (const [chave, valor] of [['MARGEM_DADOS', ambienteOriginal.dados], ['MARGEM_EXTENSOES', ambienteOriginal.extensoes]] as const) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
});

async function comDadosTemporarios(): Promise<string> {
  const diretorio = await mkdtemp(join(tmpdir(), 'margem-importacao-'));
  temporarios.push(diretorio);
  process.env.MARGEM_DADOS = diretorio;
  return diretorio;
}

/** A importação não lê nada da leitura; a configuração só precisa existir. */
const semLeitura = (): ConfiguracaoDaLeitura => { throw new Error('a importação não inicia leitura'); };

async function canonizar(banco: pg.Pool): Promise<void> {
  const vagas = await mkdtemp(join(tmpdir(), 'margem-importacao-vagas-'));
  temporarios.push(vagas);
  await new Worker({
    fila: new FilaPostgres(banco),
    manipuladores: { [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }) },
    diretorioSlots: vagas, slots: 1, intervaloMs: 5, maximoCiclos: 2,
  }).rodar();
}

const PAGINA = {
  markdown: '## Primeira parte\n\nUm parágrafo com *ênfase* e **negrito**.\n\n> Uma citação da página.\n\n- item um\n- item dois\n',
  titulo: 'Notícia: um teste da extensão',
  autor: 'Fulana de Tal',
  site: 'Agência Exemplo',
  url_origem: 'https://exemplo.com.br/2026/10/01/noticia',
  publicado_em: '2026-09-30T14:05:00-03:00',
  capturado_em: '2026-10-01T12:00:00.000Z',
};

function enviar(api: ReturnType<typeof criarApi>, corpo: unknown, cabecalhos: Record<string, string> = { 'X-Margem': '1' }): Promise<Response> {
  return Promise.resolve(api.request('/api/importacoes/web', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...cabecalhos }, body: JSON.stringify(corpo),
  }));
}

describe('originalDaPaginaWeb', () => {
  test('monta o frontmatter na ordem fixa e omite o que não veio', () => {
    expect(originalDaPaginaWeb({ markdown: '\n\nTexto.', titulo: ' Título ', url_origem: 'https://a.b/c' }, new Date('2026-10-01T00:00:00Z')))
      .toBe('---\ntitulo: Título\nurl_origem: https://a.b/c\ncapturado_em: 2026-10-01T00:00:00.000Z\nimportado_por: extensao\n---\n\nTexto.\n');
    expect(originalDaPaginaWeb({ ...PAGINA, trecho: true }, new Date())).toContain('\ntrecho: sim\n');
  });
});

describe('origensDeExtensao', () => {
  test('aceita origem inteira ou id puro, e recusa curinga', () => {
    process.env.MARGEM_EXTENSOES = ` abcdefghijklmnopabcdefghijklmnop, ${FIREFOX.toUpperCase()} ,chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/`;
    expect(origensDeExtensao()).toEqual([CHROME, FIREFOX, 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba']);
    process.env.MARGEM_EXTENSOES = 'chrome-extension://*';
    expect(() => origensDeExtensao()).toThrow(/MARGEM_EXTENSOES/);
    process.env.MARGEM_EXTENSOES = 'moz-extension://abcdefghijklmnopabcdefghijklmnop';
    expect(() => origensDeExtensao()).toThrow(/MARGEM_EXTENSOES/);
    delete process.env.MARGEM_EXTENSOES;
    expect(origensDeExtensao()).toEqual([]);
  });
});

test('página web vira original Markdown com frontmatter, documento e versão canonizada', async () =>
  comBanco('importacao_web', async (banco) => {
    const dados = await comDadosTemporarios();
    const api = criarApi({ banco, leitura: semLeitura });

    const resposta = await enviar(api, PAGINA);
    expect(resposta.status).toBe(202);
    const { documento_id, job_id, caminho } = await resposta.json() as { documento_id: Id; job_id: Id; caminho: string };
    expect(caminho).toBe(`/documentos/${documento_id}`);

    const original = await readFile(join(dados, documento_id, 'original.md'), 'utf8');
    expect(original.startsWith('---\ntitulo: Notícia: um teste da extensão\nautor: Fulana de Tal\nsite: Agência Exemplo\n'
      + 'url_origem: https://exemplo.com.br/2026/10/01/noticia\npublicado_em: 2026-09-30T14:05:00-03:00\n'
      + 'capturado_em: 2026-10-01T12:00:00.000Z\nimportado_por: extensao\n---\n\n## Primeira parte\n')).toBe(true);

    const registro = await comTransacao(banco, async (cliente) => (await cliente.query<{ titulo: string; autor: string; formato: string }>(
      'SELECT titulo, autor, formato FROM documento WHERE id=$1', [documento_id])).rows[0]);
    expect(registro).toEqual({ titulo: PAGINA.titulo, autor: PAGINA.autor, formato: 'md' });

    await canonizar(banco);
    const detalhe = await (await api.request(`/api/documentos/${documento_id}`)).json() as {
      texto_disponivel: boolean; versao_id: Id; jobs: { id: Id; estado: string }[];
    };
    expect(detalhe.jobs.find((job) => job.id === job_id)?.estado).toBe('ok');
    expect(detalhe.texto_disponivel).toBe(true);
    const blocos = await comTransacao(banco, async (cliente) => (await cliente.query<{ tipo: string; texto: string }>(
      'SELECT tipo, texto FROM bloco WHERE versao_id=$1 ORDER BY ordem', [detalhe.versao_id])).rows);
    // O frontmatter não vira bloco; título (o mais alto vira capítulo), ênfase, citação e lista chegam como no upload de Markdown.
    expect(blocos).toEqual([
      { tipo: 'capitulo', texto: 'Primeira parte' },
      { tipo: 'paragrafo', texto: 'Um parágrafo com ênfase e negrito.' },
      { tipo: 'citacao', texto: 'Uma citação da página.' },
      { tipo: 'lista', texto: 'item um\nitem dois' },
    ]);
  }), 120_000);

test('pedido fora do contrato é 422 e escrita sem X-Margem é 403', async () =>
  comBanco('importacao_recusa', async (banco) => {
    await comDadosTemporarios();
    const api = criarApi({ banco, leitura: semLeitura });
    const semUrl = await enviar(api, { markdown: 'x', titulo: 'y' });
    expect(semUrl.status).toBe(422);
    expect(await semUrl.json()).toMatchObject({ erro: 'importacao_invalida' });
    expect((await enviar(api, { ...PAGINA, markdown: '---\nfalso: sim\n---\ntexto' })).status).toBe(422);
    expect((await enviar(api, { ...PAGINA, html: '<p>' })).status).toBe(422);
    const semCabecalho = await enviar(api, PAGINA, {});
    expect(semCabecalho.status).toBe(403);
    expect(await semCabecalho.json()).toMatchObject({ erro: 'cabecalho_ausente' });
    const total = await comTransacao(banco, async (cliente) => (await cliente.query<{ n: number }>('SELECT count(*)::int AS n FROM documento')).rows[0]?.n);
    expect(total).toBe(0);
  }), 60_000);

test('origem de extensão: só as declaradas, só nas rotas dela, com CORS', async () =>
  comBanco('importacao_cors', async (banco) => {
    await comDadosTemporarios();
    const api = criarApi({ banco, leitura: semLeitura });

    // Sem MARGEM_EXTENSOES, a extensão é uma origem qualquer.
    delete process.env.MARGEM_EXTENSOES;
    const recusada = await enviar(api, PAGINA, { 'X-Margem': '1', Origin: CHROME });
    expect(recusada.status).toBe(403);
    expect(await recusada.json()).toMatchObject({ erro: 'origem_recusada' });

    process.env.MARGEM_EXTENSOES = `${CHROME},${FIREFOX}`;
    const preflight = await api.request('/api/importacoes/web', {
      method: 'OPTIONS',
      headers: { Origin: FIREFOX, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-margem' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(FIREFOX);
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, POST');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('x-margem');

    const aceita = await enviar(api, PAGINA, { 'X-Margem': 'token-qualquer', Origin: CHROME });
    expect(aceita.status).toBe(202);
    expect(aceita.headers.get('access-control-allow-origin')).toBe(CHROME);

    // Erro de escrita também leva o cabeçalho de CORS: a extensão consegue ler a mensagem.
    const semCabecalho = await enviar(api, PAGINA, { Origin: CHROME });
    expect(semCabecalho.status).toBe(403);
    expect(semCabecalho.headers.get('access-control-allow-origin')).toBe(CHROME);

    const teste = await api.request('/api/importacoes/web', { headers: { Origin: CHROME } });
    expect(teste.status).toBe(200);
    expect(await teste.json()).toEqual({ servico: 'margem', importacao_web: 1, formatos: ['md', 'pdf'] });

    // A extensão não lê a biblioteca nem escreve fora das rotas dela.
    const biblioteca = await api.request('/api/documentos', { headers: { Origin: CHROME } });
    expect(biblioteca.status).toBe(403);
    expect(await biblioteca.json()).toMatchObject({ erro: 'rota_fora_da_extensao' });
    const preflightAlheio = await api.request('/api/perfil', {
      method: 'OPTIONS', headers: { Origin: CHROME, 'Access-Control-Request-Method': 'PUT' },
    });
    expect(preflightAlheio.status).toBe(403);
    expect(preflightAlheio.headers.get('access-control-allow-origin')).toBeNull();

    // O PDF vai pelo upload comum, que a extensão pode usar.
    const formulario = new FormData();
    formulario.set('titulo', 'Um PDF da web');
    formulario.set('formato', 'pdf');
    formulario.set('arquivo', new File([new TextEncoder().encode('%PDF-1.4\n')], 'x.pdf', { type: 'application/pdf' }));
    const pdf = await api.request('/api/documentos', { method: 'POST', headers: { 'X-Margem': '1', Origin: FIREFOX }, body: formulario });
    expect(pdf.status).toBe(202);
    expect(pdf.headers.get('access-control-allow-origin')).toBe(FIREFOX);

    // Outra extensão, não declarada, continua de fora.
    const outra = await enviar(api, PAGINA, { 'X-Margem': '1', Origin: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba' });
    expect(outra.status).toBe(403);
  }), 60_000);
