/**
 * Quem pode escrever (auditoria de 07/10): a API principal deixou de tratar qualquer `X-Margem` como
 * dono. Dono = loopback sem proxy de fora, ou o login de `MARGEM_DONOS` vindo pelo Tailscale Serve.
 * Convidado só escreve no portão da sala, e só o que é dele. Leituras não mudam.
 *
 * Roda contra um Postgres de teste (`margem_test_*`, criado e destruído aqui).
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Bloco, SalaDeTesteV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import { criarPortao } from '../sala/portao.js';
import { criarApi } from './app.js';
import { autorizarEscrita, identificar } from './autenticacao.js';
import { ErroDaApi } from './erros.js';

const SERVE = 'margem.exemplo.ts.net';
const DONO = 'leitor@github';
const VARIAVEIS = ['MARGEM_TAILSCALE_HOST', 'MARGEM_DONOS', 'MARGEM_ORIGENS'] as const;
const salvas: Partial<Record<(typeof VARIAVEIS)[number], string>> = {};

beforeEach(() => {
  for (const nome of VARIAVEIS) { const valor = process.env[nome]; if (valor !== undefined) salvas[nome] = valor; }
  process.env.MARGEM_TAILSCALE_HOST = SERVE;
  process.env.MARGEM_DONOS = ` ${DONO.toUpperCase()} , outro-dono@github `;
  delete process.env.MARGEM_ORIGENS;
});
afterEach(() => {
  for (const nome of VARIAVEIS) {
    const valor = salvas[nome];
    if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
    delete salvas[nome];
  }
});

/** Cabeçalhos de cada tipo de visitante, como chegam à API. */
const QUEM = {
  donoLoopback: { Host: '127.0.0.1:8730' },
  donoPeloVite: { Host: '127.0.0.1:8730', 'X-Forwarded-For': '127.0.0.1' },
  donoPeloServe: { Host: SERVE, 'Tailscale-User-Login': DONO, 'X-Forwarded-For': '100.64.0.2' },
  convidadoDaTailnet: { Host: SERVE, 'Tailscale-User-Login': 'convidada@github', 'X-Forwarded-For': '100.64.0.9' },
  anonimoSemLogin: { Host: SERVE },
  anonimoDoFunil: { Host: SERVE, 'Tailscale-Funnel-Request': '?1', 'Tailscale-User-Login': DONO },
  anonimoPeloVite: { Host: '127.0.0.1:8730', 'X-Forwarded-For': '192.168.0.40' },
  // Um proxy local repassa cabeçalhos sem limpar: o login forjado não vale fora do Host do Serve.
  forjadoPeloVite: { Host: '127.0.0.1:8730', 'X-Forwarded-For': '127.0.0.1, 192.168.0.40', 'Tailscale-User-Login': DONO },
} as const;

describe('identidade de quem escreve', () => {
  const de = (cabecalhos: Record<string, string>) => ({
    margem: '1', host: cabecalhos.Host, loginTailscale: cabecalhos['Tailscale-User-Login'],
    funil: cabecalhos['Tailscale-Funnel-Request'], encaminhadoPor: cabecalhos['X-Forwarded-For'],
  });

  test('cada visitante recebe a identidade certa', () => {
    expect(identificar(de(QUEM.donoLoopback))).toEqual({ usuario: 'dono', via: 'loopback' });
    expect(identificar(de(QUEM.donoPeloVite))).toEqual({ usuario: 'dono', via: 'loopback' });
    expect(identificar(de(QUEM.donoPeloServe))).toEqual({ usuario: 'dono', via: 'tailscale', login: DONO });
    expect(identificar({ ...de(QUEM.donoPeloServe), host: `${SERVE.toUpperCase()}:443` })).toMatchObject({ usuario: 'dono' });
    expect(identificar(de(QUEM.convidadoDaTailnet))).toEqual({ usuario: 'convidado', via: 'tailscale', login: 'convidada@github' });
    expect(identificar(de(QUEM.anonimoSemLogin))).toEqual({ usuario: 'anonimo', via: 'tailscale' });
    expect(identificar(de(QUEM.anonimoDoFunil))).toEqual({ usuario: 'anonimo', via: 'funil' });
    expect(identificar(de(QUEM.anonimoPeloVite))).toEqual({ usuario: 'anonimo', via: 'proxy' });
    expect(identificar(de(QUEM.forjadoPeloVite))).toEqual({ usuario: 'anonimo', via: 'proxy' });
    expect(identificar({ margem: '1', host: 'localhost', encaminhadoPor: '::1, [::ffff:127.0.0.1]' })).toMatchObject({ usuario: 'dono' });
  });

  test('sem MARGEM_DONOS ninguém escreve pelo Serve; o loopback continua dono', () => {
    delete process.env.MARGEM_DONOS;
    expect(identificar(de(QUEM.donoPeloServe))).toMatchObject({ usuario: 'convidado' });
    expect(identificar(de(QUEM.donoLoopback))).toMatchObject({ usuario: 'dono' });
  });

  test('autorizarEscrita: X-Margem continua obrigatório; convidado é 403, anônimo é 401', () => {
    const erro = (f: () => unknown) => { try { f(); } catch (e) { return e; } return null; };
    expect(erro(() => autorizarEscrita({ ...de(QUEM.donoLoopback), margem: undefined }))).toMatchObject({ status: 403, erro: 'cabecalho_ausente' });
    expect(autorizarEscrita(de(QUEM.donoPeloServe))).toMatchObject({ usuario: 'dono' });
    const convidado = erro(() => autorizarEscrita(de(QUEM.convidadoDaTailnet)));
    expect(convidado).toBeInstanceOf(ErroDaApi);
    expect(convidado).toMatchObject({ status: 403, erro: 'sem_permissao_de_escrita' });
    for (const anonimo of [QUEM.anonimoSemLogin, QUEM.anonimoDoFunil, QUEM.anonimoPeloVite, QUEM.forjadoPeloVite]) {
      expect(erro(() => autorizarEscrita(de(anonimo)))).toMatchObject({ status: 401, erro: 'nao_autenticado' });
    }
  });
});

async function documentoDeTeste(banco: pg.Pool, titulo: string, sha: string) {
  const canonico = canonicoDeTeste({ titulo, blocos: [
    { tipo: 'capitulo', texto: 'Primeiro' },
    { tipo: 'paragrafo', texto: 'A razão comum basta para ver que a ordem pede explicação.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
  canonico.documento.sha256_original = sha.repeat(64);
  return comTransacao(banco, async (cliente) => {
    const doc = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: `${titulo}.md` });
    const versao = await documentos.criarVersao(cliente, doc.id, canonico);
    return { documento: doc.id, versao: versao.id, blocos: canonico.blocos };
  });
}

function ancora(versao: string, bloco: Bloco, citacao: string) {
  const inicio = bloco.texto.indexOf(citacao);
  return { versao_id: versao, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao,
    prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length) };
}

function pedido(metodo: string, cabecalhos: Record<string, string>, corpo?: unknown): RequestInit {
  return { method: metodo, headers: { ...cabecalhos, 'X-Margem': '1', 'Content-Type': 'application/json' },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) };
}

const url = (cabecalhos: { Host: string }, caminho: string) => `http://${cabecalhos.Host}${caminho}`;

test('API principal: só o dono escreve; convidado e anônimo não; leitura igual para todos', async () => comBanco('escrita_identidade', async (banco) => {
  const api: Hono = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); } });
  const doc = await documentoDeTeste(banco, 'Ensaio', 'e');
  const bloco = doc.blocos[1]!;
  const grifos = async () => Number((await banco.query<{ n: string }>('SELECT count(*) AS n FROM marca')).rows[0]?.n);
  const grifar = (cabecalhos: Record<string, string> & { Host: string }, citacao: string) =>
    api.request(url(cabecalhos, '/api/grifos'), pedido('POST', cabecalhos, { ancora: ancora(doc.versao, bloco, citacao), funcao: 'tese' }));

  // Dono escreve: em loopback, pelo Vite local e pelo Serve com o próprio login.
  expect((await grifar(QUEM.donoLoopback, 'razão comum')).status).toBe(201);
  expect((await grifar(QUEM.donoPeloVite, 'ordem pede')).status).toBe(201);
  expect((await grifar(QUEM.donoPeloServe, 'explicação')).status).toBe(201);
  const depoisDoDono = await grifos();

  // Convidado da tailnet: nada da API principal é dele nem foi compartilhado com escrita.
  const convidado = await grifar(QUEM.convidadoDaTailnet, 'basta');
  expect(convidado.status).toBe(403);
  expect(await convidado.json()).toMatchObject({ erro: 'sem_permissao_de_escrita' });
  // Anônimo: sem login do Serve, do Funnel, ou de fora por um proxy local (com login forjado ou não).
  for (const anonimo of [QUEM.anonimoSemLogin, QUEM.anonimoDoFunil, QUEM.anonimoPeloVite, QUEM.forjadoPeloVite]) {
    const resposta = await grifar(anonimo, 'basta');
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toMatchObject({ erro: 'nao_autenticado' });
  }
  // Os outros métodos de escrita passam pelo mesmo ponto (DELETE, PATCH, PUT).
  for (const metodo of ['DELETE', 'PATCH', 'PUT']) {
    expect((await api.request(url(QUEM.convidadoDaTailnet, `/api/documentos/${doc.documento}`), pedido(metodo, QUEM.convidadoDaTailnet, {}))).status).toBe(403);
    expect((await api.request(url(QUEM.anonimoSemLogin, `/api/documentos/${doc.documento}`), pedido(metodo, QUEM.anonimoSemLogin, {}))).status).toBe(401);
  }
  expect(await grifos()).toBe(depoisDoDono);

  // Leitura inalterada: as mesmas respostas para todos os visitantes.
  const ler = async (cabecalhos: Record<string, string> & { Host: string }, caminho: string) => {
    const resposta = await api.request(url(cabecalhos, caminho), { headers: cabecalhos });
    return { status: resposta.status, corpo: await resposta.text() };
  };
  for (const caminho of ['/api/documentos', `/api/versoes/${doc.versao}/secoes`]) {
    const referencia = await ler(QUEM.donoLoopback, caminho);
    expect(referencia.status).toBe(200);
    for (const visitante of Object.values(QUEM)) expect(await ler(visitante, caminho)).toEqual(referencia);
  }
}));

test('portão: o convidado só escreve o que é dele, na sala em que entrou', async () => comBanco('escrita_convidado', async (banco) => {
  const api: Hono = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, recursos: new Set(['sala'] as const) });
  const doc = await documentoDeTeste(banco, 'Ensaio da sala', 'a');
  const fora = await documentoDeTeste(banco, 'Diário', 'c');
  const bloco = doc.blocos[1]!;
  const criarSala = async (titulo: string, documentosDaSala: string[]) => {
    const resposta = await api.request(url(QUEM.donoLoopback, '/api/salas'),
      pedido('POST', QUEM.donoLoopback, { titulo, documentos: documentosDaSala, senha: 'senha-de-teste-1' }));
    expect(resposta.status).toBe(201);
    return (await resposta.json() as { sala: SalaDeTesteV1 }).sala;
  };
  const sala = await criarSala('Beta', [doc.documento]);
  const outraSala = await criarSala('Outra', [fora.documento]);
  // Criar sala é escrita do dono: convidado e anônimo não abrem sala.
  expect((await api.request(url(QUEM.convidadoDaTailnet, '/api/salas'), pedido('POST', QUEM.convidadoDaTailnet, { titulo: 'x', documentos: [doc.documento] }))).status).toBe(403);
  expect((await api.request(url(QUEM.anonimoSemLogin, '/api/salas'), pedido('POST', QUEM.anonimoSemLogin, { titulo: 'x', documentos: [doc.documento] }))).status).toBe(401);

  const portao: Hono = criarPortao({ banco, chave: Buffer.alloc(32, 7), raizWeb: null, ipDoPedido: () => '10.0.0.1' });
  const entrar = async (slug: string, nome: string) => {
    const resposta = await portao.request(`/api/salas/publico/${slug}/entrar`, pedido('POST', {}, { nome, senha: 'senha-de-teste-1' }));
    expect(resposta.status).toBe(200);
    return (resposta.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  };
  const ana = await entrar(sala.slug, 'Ana');
  const bruno = await entrar(sala.slug, 'Bruno');
  const carla = await entrar(outraSala.slug, 'Carla');
  const base = `/api/salas/publico/${sala.slug}`;
  const comentar = (cookie: string | null, versao = doc.versao, b: Bloco = bloco) =>
    portao.request(`${base}/comentarios`, pedido('POST', cookie === null ? {} : { Cookie: cookie },
      { versao_id: versao, bloco_id: b.id, inicio_utf16: 0, fim_utf16: 5, citacao: b.texto.slice(0, 5), texto: 'Não entendi.' }));

  // Ana comenta o documento compartilhado com a sala (permissão explícita: comentar e responder).
  const criado = await comentar(ana);
  expect(criado.status).toBe(201);
  const { comentario } = await criado.json() as { comentario: { id: string } };
  // Sem sessão não escreve; sessão de outra sala também não (o portão é mudo: 404).
  expect((await comentar(null)).status).toBe(404);
  expect((await comentar(carla)).status).toBe(404);
  // Documento fora da sala: 404, mesmo com sessão válida.
  const blocoDeFora = fora.blocos[1]!;
  expect((await comentar(ana, fora.versao, blocoDeFora)).status).toBe(404);
  // Bruno não apaga o comentário da Ana; a Ana apaga.
  const apagar = (cookie: string) => portao.request(`${base}/comentarios/${comentario.id}`, { method: 'DELETE', headers: { Cookie: cookie, 'X-Margem': '1' } });
  expect((await apagar(bruno)).status).toBe(404);
  expect((await banco.query('SELECT 1 FROM sala_comentario WHERE id=$1', [comentario.id])).rowCount).toBe(1);
  expect((await apagar(ana)).status).toBe(200);

  // Respostas: cada um grava só a própria; o rascunho do Bruno não toca o da Ana.
  const responder = (cookie: string, texto: string) => portao.request(`${base}/respostas`,
    pedido('PUT', { Cookie: cookie }, { geral: { o_que_confundiu: texto } }));
  expect((await responder(ana, 'Da Ana.')).status).toBe(200);
  expect((await responder(bruno, 'Do Bruno.')).status).toBe(200);
  const daAna = await (await portao.request(`${base}/respostas`, { headers: { Cookie: ana } })).json() as { resposta: { geral: Record<string, unknown> } };
  expect(daAna.resposta.geral.o_que_confundiu).toBe('Da Ana.');

  // O convidado não chega à API principal pelo portão: escrita fora da lista é 404.
  expect((await portao.request('/api/grifos', pedido('POST', { Cookie: ana }, { ancora: ancora(doc.versao, bloco, 'razão'), funcao: 'tese' }))).status).toBe(404);
  expect((await banco.query('SELECT 1 FROM marca')).rowCount).toBe(0);
}));
