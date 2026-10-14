/** Recursos pessoais atrás de `MARGEM_RECURSOS` (J102): leitura da configuração, API e worker. */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { describe, expect, test } from 'vitest';
import { comBanco } from '../testes/apoio.js';
import { criarExecutorFalso } from './executor/fake.js';
import { criarApi, recursosEfetivos } from './http/app.js';
import { exigirRecurso, listaDeRecursos, recursosDoAmbiente, type Recurso } from './recursos.js';
import { todosOsManipuladores } from './worker/main.js';

const ULID = '01K0000000000000000000A001';
const TODOS: readonly Recurso[] = ['noticias', 'audio-colab', 'arte', 'sala', 'horarium', 'eink'];

describe('MARGEM_RECURSOS', () => {
  test('sem a variável, só o padrão: a arte (J102b)', () => {
    expect(listaDeRecursos(recursosDoAmbiente({}))).toEqual(['arte']);
    expect(listaDeRecursos(recursosDoAmbiente({ MARGEM_RECURSOS: ' ' }))).toEqual(['arte']);
    expect(listaDeRecursos(recursosDoAmbiente({ MARGEM_RECURSOS: 'sala' }))).toEqual(['arte', 'sala']);
  });

  test('`-nome` tira do padrão ou da lista', () => {
    expect(listaDeRecursos(recursosDoAmbiente({ MARGEM_RECURSOS: '-arte' }))).toEqual([]);
    expect(listaDeRecursos(recursosDoAmbiente({ MARGEM_RECURSOS: 'sala,-ARTE, eink' }))).toEqual(['sala', 'eink']);
    const avisos: string[] = [];
    recursosDoAmbiente({ MARGEM_RECURSOS: '-xpto, -' }, (nome) => { avisos.push(nome); });
    expect(avisos).toEqual(['xpto']);
  });

  test('lista com vírgulas ou espaços, sem caixa, apelido audio e nomes desconhecidos avisados', () => {
    const avisos: string[] = [];
    const ativos = recursosDoAmbiente({ MARGEM_RECURSOS: 'Sala, noticias  audio,arte,xpto EINK,horarium' }, (nome) => { avisos.push(nome); });
    expect(listaDeRecursos(ativos)).toEqual(TODOS);
    expect(avisos).toEqual(['xpto']);
  });

  test('a lista completa (units em ops/) liga os seis', () => {
    expect(listaDeRecursos(recursosDoAmbiente({ MARGEM_RECURSOS: 'noticias,audio-colab,arte,sala,horarium,eink' }))).toEqual(TODOS);
  });

  test('ferramentas recusam com mensagem clara quando o recurso está desligado', () => {
    expect(() => { exigirRecurso('audio-colab', {}); }).toThrow(/audio-colab está desligado/u);
    expect(() => { exigirRecurso('arte', {}); }).not.toThrow();
    expect(() => { exigirRecurso('sala', { MARGEM_RECURSOS: 'noticias' }); }).toThrow(/MARGEM_RECURSOS=sala/u);
    expect(() => { exigirRecurso('sala', { MARGEM_RECURSOS: 'sala' }); }).not.toThrow();
  });

  test('MARGEM_ARTE=0 desliga a arte; sem nenhuma obra em disco ela continua ligada (estado vazio convida a adicionar)', () => {
    const pedidos = new Set<Recurso>(['arte', 'sala']);
    expect(listaDeRecursos(recursosEfetivos(pedidos, {}))).toEqual(['arte', 'sala']);
    expect(listaDeRecursos(recursosEfetivos(pedidos, { MARGEM_ARTE_DIR: '/nao/existe' }))).toEqual(['arte', 'sala']);
    expect(listaDeRecursos(recursosEfetivos(pedidos, { MARGEM_ARTE: '0' }))).toEqual(['sala']);
  });
});

function api(banco: pg.Pool, recursos: readonly Recurso[]) {
  return criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, recursos: new Set(recursos) });
}

async function erro(resposta: Response): Promise<string | undefined> {
  return ((await resposta.json()) as { erro?: string }).erro;
}

const escrita = (corpo: unknown): RequestInit => ({
  method: 'POST', headers: { 'X-Margem': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
});

test('API desligada: rotas pessoais respondem 404 e /api/recursos vem vazio; áudio publicado continua servido', async () => comBanco('recursos_deslig', async (banco) => {
  const app = api(banco, []);
  expect(await (await app.request('/api/recursos')).json()).toEqual({ recursos: [] });
  for (const [metodo, caminho] of [
    ['GET', '/api/noticias'], ['POST', '/api/noticias/gerar'], ['PUT', '/api/noticias/agenda'], ['GET', `/api/noticias/${ULID}/audio`],
    ['GET', '/api/salas'], ['POST', '/api/salas'], ['GET', `/api/salas/${ULID}/respostas`],
    ['GET', '/api/arte'], ['GET', '/api/arte/educacao/imagem'],
    ['POST', '/api/importar/horarium'], ['GET', `/api/planos/${ULID}/eink.epub`],
  ] as const) {
    const resposta = await app.request(caminho, metodo === 'GET' ? {} : { ...escrita({}), method: metodo });
    expect(resposta.status, `${metodo} ${caminho}`).toBe(404);
    expect(await erro(resposta), `${metodo} ${caminho}`).toBe('recurso_desligado');
  }
  // Tocar áudio já publicado (capítulo, visita, leitura comentada) não é recurso pessoal: a rota existe.
  for (const caminho of [`/api/audios/${ULID}/arquivo`, `/api/narracoes-visita/${ULID}/arquivo`, `/api/narracoes-leitura/${ULID}/arquivo`]) {
    const resposta = await app.request(caminho);
    expect(resposta.status, caminho).toBe(404);
    expect(await erro(resposta), caminho).not.toBe('recurso_desligado');
  }
  // Genéricos que ficam: a apresentação `eink` do plano (só divide em telas) e o importador de marcas legadas.
  const apresentacao = await app.request(`/api/planos/${ULID}/apresentacao?dispositivo=eink`);
  expect(await erro(apresentacao)).toBe('plano_inexistente');
  const legado = await app.request(`/api/documentos/${ULID}/importar-legado`, escrita({ marcas: [] }));
  expect(await erro(legado)).not.toBe('recurso_desligado');
}));

test('API com horarium e eink: a importação e o EPUB respondem como antes', async () => comBanco('recursos_j102b', async (banco) => {
  const app = api(banco, ['horarium', 'eink']);
  expect(await (await app.request('/api/recursos')).json()).toEqual({ recursos: ['horarium', 'eink'] });
  const horarium = await app.request('/api/importar/horarium', escrita({ documento: {} }));
  expect(horarium.status).toBe(422);
  expect(await erro(horarium)).toBe('importacao_recusada');
  const epub = await app.request(`/api/planos/${ULID}/eink.epub`);
  expect(epub.status).toBe(404);
  expect(await erro(epub)).toBe('plano_inexistente');
}));

test('API ligada: tudo como antes', async () => comBanco('recursos_ligados', async (banco) => {
  const app = api(banco, ['noticias', 'audio-colab', 'sala']);
  expect(await (await app.request('/api/recursos')).json()).toEqual({ recursos: ['noticias', 'audio-colab', 'sala'] });
  expect((await app.request('/api/noticias')).status).toBe(200);
  expect((await app.request('/api/salas')).status).toBe(200);
  // MARGEM_ARTE=0 desliga a arte mesmo pedida.
  const anterior = process.env.MARGEM_ARTE;
  process.env.MARGEM_ARTE = '0';
  try {
    const desligada = api(banco, ['arte']);
    expect(await (await desligada.request('/api/recursos')).json()).toEqual({ recursos: [] });
    expect(await erro(await desligada.request('/api/arte'))).toBe('recurso_desligado');
  } finally {
    if (anterior === undefined) delete process.env.MARGEM_ARTE; else process.env.MARGEM_ARTE = anterior;
  }
}));

test('instalação nova: a arte vem ligada sem obras em disco; mostra as duas obras de exemplo e nenhuma obra da pessoa', async () => comBanco('recursos_arte', async (banco) => {
  const antes = { dir: process.env.MARGEM_ARTE_DIR, recursos: process.env.MARGEM_RECURSOS, arte: process.env.MARGEM_ARTE };
  process.env.MARGEM_ARTE_DIR = join(tmpdir(), `margem-sem-acervo-${String(process.pid)}`);
  delete process.env.MARGEM_RECURSOS;
  delete process.env.MARGEM_ARTE;
  try {
    // Sem a opção `recursos`: a API lê o ambiente, como numa instalação nova.
    const app = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); } });
    expect(await (await app.request('/api/recursos')).json()).toEqual({ recursos: ['arte'] });
    const lista = await app.request('/api/arte');
    expect(lista.status).toBe(200);
    // Sem obras, as fixtures do J94 (web/public/arte + fixtures/arte) entram no lugar: nunca quebra.
    const corpo = await lista.json() as { obras: { slug: string; exemplo: boolean }[]; preparando: unknown[] };
    expect(corpo.obras.map((o) => o.slug).sort()).toEqual(['educacao', 'tolo']);
    // As obras de exemplo vêm marcadas: a tela Quadros convida a adicionar a primeira obra (J118). Nada de pacote.
    expect(corpo.obras.every((o) => o.exemplo)).toBe(true);
    expect(corpo.preparando).toEqual([]);
    expect(Object.keys(corpo).sort()).toEqual(['obras', 'preparando']);
    expect((await app.request('/api/arte/educacao')).status).toBe(200);
    const obra = await app.request('/api/arte/inexistente');
    expect(obra.status).toBe(404);
    expect(await erro(obra)).toBe('obra_inexistente');
    expect(await erro(await app.request('/api/noticias'))).toBe('recurso_desligado');
  } finally {
    for (const [nome, valor] of [['MARGEM_ARTE_DIR', antes.dir], ['MARGEM_RECURSOS', antes.recursos], ['MARGEM_ARTE', antes.arte]] as const) {
      if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
    }
  }
}));

test('worker: sem noticias, os jobs das Notícias não têm manipulador (nem são reservados)', async () => comBanco('recursos_worker', (banco) => {
  const executor = criarExecutorFalso({ versao: 1, passos: [] });
  const tiposDasNoticias = ['editar_noticias', 'narrar_noticias', 'ilustrar_noticias'];
  const desligado = Object.keys(todosOsManipuladores(banco, executor, { MARGEM_RESPONDER: 'falso' }));
  const ligado = Object.keys(todosOsManipuladores(banco, executor, { MARGEM_RESPONDER: 'falso', MARGEM_RECURSOS: 'noticias' }));
  for (const tipo of tiposDasNoticias) {
    expect(desligado).not.toContain(tipo);
    expect(ligado).toContain(tipo);
  }
  // O resto do worker não muda.
  expect(ligado.filter((tipo) => !tiposDasNoticias.includes(tipo)).sort()).toEqual([...desligado].sort());
  expect(desligado).toContain('canonizar');
  return Promise.resolve();
}));
