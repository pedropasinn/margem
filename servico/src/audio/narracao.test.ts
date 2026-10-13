/**
 * Áudio gerado no app (J106): chave no arquivo de segredos, rotas de configuração, prévia com
 * confirmação, job `narrar_audio` no worker com o provedor falso e a garantia de que a chave não
 * aparece em resposta, log, banco (inclusive `execucao_leitura` e eventos de job) nem auditoria.
 */
import { mkdtemp, readdir, readFile, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AncoraV1, AudioNarrado } from '@margem/contratos';
import { ancoraDeSelecao } from '@margem/core';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarApi } from '../http/app.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker, type AnotacaoWorker } from '../worker/worker.js';
import { apagarChave, gravarChave, lerChave, pastaDosSegredos, situacaoDaChave } from './configuracao.js';
import { manipuladoresDaNarracao, roteiroDoCapitulo } from './narracao.js';
import { provedorFalso } from './voz/falso.js';
import { ErroDoProvedor, type ProvedorDeVoz } from './voz/provedor.js';

const CHAVE = 'sk_0123456789abcdef0123456789abcdefSEGREDO9';
const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
const temporarios: string[] = [];
let dados = '';
const saidas: string[] = [];

beforeEach(async () => {
  dados = await mkdtemp(join(tmpdir(), 'margem-narracao-')); temporarios.push(dados);
  process.env.MARGEM_DADOS = dados;
  delete process.env.MARGEM_SEGREDOS;
  saidas.length = 0;
  for (const metodo of ['log', 'error', 'warn', 'info'] as const) {
    vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => { saidas.push(args.map(String).join(' ')); });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.MARGEM_DADOS;
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});

describe('arquivo de segredos', () => {
  test('grava 0600 em pasta 0700, devolve só o final e fecha permissão aberta demais', async () => {
    expect(await situacaoDaChave()).toEqual({ configurada: false, final: null });
    await expect(gravarChave('curta')).rejects.toThrow('malformada');
    await gravarChave(`  ${CHAVE}\n`);
    const arquivo = join(pastaDosSegredos(), 'elevenlabs.chave');
    expect((await stat(arquivo)).mode & 0o777).toBe(0o600);
    expect((await stat(pastaDosSegredos())).mode & 0o777).toBe(0o700);
    expect(pastaDosSegredos()).toBe(join(dados, 'segredos'));
    expect(await situacaoDaChave()).toEqual({ configurada: true, final: 'EDO9' });
    await chmod(arquivo, 0o644);
    expect(await lerChave()).toBe(CHAVE);
    expect((await stat(arquivo)).mode & 0o777).toBe(0o600);
    await apagarChave();
    expect(await lerChave()).toBeNull();
  });
});

describe('roteiro', () => {
  test('uma cena por frase, pula figura, respeita o trecho e recusa trecho de fora', () => {
    const c = canonicoDeTeste({ blocos: [{ tipo: 'capitulo', texto: 'Capítulo' }, { tipo: 'paragrafo', texto: 'Uma frase. Outra frase.' }, { tipo: 'figura', texto: 'Figura 1' }],
      secoes: [{ nivel: 1, inicio: 0, fim: 2 }] });
    const versao = '0000000000000000000000V001';
    const roteiro = roteiroDoCapitulo(c, versao, c.secoes[0]!.id, null);
    expect(roteiro.cenas.map((x) => [x.cena, x.texto, x.novoBloco])).toEqual([['c001', 'Capítulo', false], ['c002', 'Uma frase.', true], ['c003', 'Outra frase.', false]]);
    const trecho = ancoraDeSelecao({ ...c.blocos[1]!, versao_id: versao }, 4, 17);
    expect(roteiroDoCapitulo(c, versao, c.secoes[0]!.id, trecho).cenas.map((x) => x.texto)).toEqual(['frase.', 'Outra']);
    expect(() => roteiroDoCapitulo(c, versao, c.secoes[0]!.id, { ...trecho, citacao: 'inventada' })).toThrow('não é deste capítulo');
  });
});

async function prepararVersao(banco: pg.Pool) {
  const c = canonicoDeTeste({ blocos: [
    { tipo: 'capitulo', texto: 'Capítulo um' },
    { tipo: 'paragrafo', texto: 'Primeira frase do texto. Segunda frase, com 🧭 no meio.' },
    { tipo: 'paragrafo', texto: 'Outro parágrafo fecha o capítulo.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 2 }] });
  const versao = await comTransacao(banco, async (tx) => {
    const d = await documentos.criar(tx, { ...c.documento, origem_caminho: 'teste.txt' });
    return documentos.criarVersao(tx, d.id, c);
  });
  return { c, versao, secao: c.secoes[0]! };
}

async function rodarWorker(banco: pg.Pool, provedor: ProvedorDeVoz, auditoria: string, anotacoes: AnotacaoWorker[]): Promise<void> {
  const slots = await mkdtemp(join(tmpdir(), 'margem-narracao-slots-')); temporarios.push(slots);
  await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDaNarracao({ banco, criarProvedor: () => provedor }), auditoria,
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000,
    anotar: (a) => { anotacoes.push(a); console.log(JSON.stringify(a)); } }).rodar();
}

async function arquivosEmTexto(raiz: string, fora: string): Promise<string> {
  const partes: string[] = [];
  for (const nome of await readdir(raiz, { recursive: true })) {
    const caminho = join(raiz, nome);
    if (caminho.startsWith(fora)) continue;
    if ((await stat(caminho)).isFile()) partes.push(nome, await readFile(caminho, 'latin1'));
  }
  return partes.join('\n');
}

test('configuração, prévia, geração pelo worker, erros claros e a chave em lugar nenhum', async () => comBanco('narracao_j106', async (banco) => {
  const { c, versao, secao } = await prepararVersao(banco);
  const registro: string[] = [];
  let provedorDaApi: ProvedorDeVoz = provedorFalso({ registro });
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, provedorDeVoz: () => provedorDaApi });
  const respostas: string[] = [];
  const pedir = async (caminho: string, inicio: RequestInit = {}) => {
    const resposta = await api.request(caminho, inicio);
    const texto = await resposta.text();
    respostas.push(texto);
    return { status: resposta.status, corpo: (texto === '' ? null : JSON.parse(texto)) as Record<string, unknown> };
  };
  const base = `/api/versoes/${versao.id}/capitulos/${secao.id}`;

  // Sem chave: nada de geração; a tela recebe o convite.
  expect((await pedir('/api/configuracoes/audio')).corpo).toMatchObject({ provedor: 'elevenlabs', chave: { configurada: false, final: null }, voz: null, modelo_id: 'eleven_multilingual_v2' });
  expect((await pedir(`${base}/narracao`)).corpo).toMatchObject({ estado: 'nenhum', chave_configurada: false });
  expect((await pedir(`${base}/narracao`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ caracteres_confirmados: 1 }) })).status).toBe(409);
  expect((await pedir('/api/configuracoes/audio/vozes')).status).toBe(409);

  // Chave: só "configurada" e os 4 últimos.
  expect((await pedir('/api/configuracoes/audio/chave', { method: 'PUT', headers: ESCRITA, body: JSON.stringify({ chave: 'tem espaço no meio da chave' }) })).corpo).toMatchObject({ erro: 'chave_malformada' });
  const gravada = await pedir('/api/configuracoes/audio/chave', { method: 'PUT', headers: ESCRITA, body: JSON.stringify({ chave: CHAVE }) });
  expect(gravada.corpo).toMatchObject({ chave: { configurada: true, final: 'EDO9' } });
  expect((await pedir('/api/configuracoes/audio/testar', { method: 'POST', headers: ESCRITA })).corpo).toEqual({ ok: true, creditos_restantes: 10_000 });
  provedorDaApi = provedorFalso({ falhar: 'chave_invalida' });
  const recusada = await pedir('/api/configuracoes/audio/testar', { method: 'POST', headers: ESCRITA, body: JSON.stringify({ chave: 'sk_outra_chave_qualquer_123' }) });
  expect(recusada).toMatchObject({ status: 422, corpo: { erro: 'chave_invalida' } });
  expect(String(recusada.corpo.detalhe)).toContain('Chave inválida');
  provedorDaApi = provedorFalso({ falhar: 'sem_creditos' });
  expect((await pedir('/api/configuracoes/audio/vozes')).status).toBe(402);
  provedorDaApi = provedorFalso({ registro });
  const vozes = (await pedir('/api/configuracoes/audio/vozes')).corpo.vozes as { id: string; nome: string }[];
  expect(vozes.map((v) => v.nome)).toEqual(['Clara', 'Bento']);

  // Sem voz escolhida, a confirmação é recusada; voz e modelo inválidos também.
  const previaSemVoz = await pedir(`${base}/narracao/previa`, { method: 'POST', headers: ESCRITA });
  expect(previaSemVoz.corpo).toMatchObject({ voz_id: null, cenas: 4 });
  expect((await pedir(`${base}/narracao`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ caracteres_confirmados: previaSemVoz.corpo.caracteres }) })).corpo).toMatchObject({ erro: 'sem_voz' });
  expect((await pedir('/api/configuracoes/audio/preferencias', { method: 'PUT', headers: ESCRITA, body: JSON.stringify({ voz_id: vozes[0]!.id, voz_nome: 'Clara', modelo_id: 'gpt-voz' }) })).status).toBe(400);
  expect((await pedir('/api/configuracoes/audio/preferencias', { method: 'PUT', headers: ESCRITA, body: JSON.stringify({ voz_id: vozes[0]!.id, voz_nome: 'Clara', modelo_id: 'eleven_flash_v2_5' }) })).corpo)
    .toMatchObject({ voz: { id: vozes[0]!.id, nome: 'Clara' }, modelo_id: 'eleven_flash_v2_5' });

  // Prévia: caracteres, créditos (Flash: 0,5 por caractere) e referência em dólares.
  const previa = (await pedir(`${base}/narracao/previa`, { method: 'POST', headers: ESCRITA })).corpo;
  const texto = 'Capítulo um\n\nPrimeira frase do texto. Segunda frase, com 🧭 no meio.\n\nOutro parágrafo fecha o capítulo.';
  expect(previa).toMatchObject({ caracteres: [...texto].length, pedidos: 1, creditos: Math.ceil([...texto].length / 2), cenas: 4, voz_nome: 'Clara', titulo: 'Narração · Capítulo um' });
  expect((await pedir(`${base}/narracao`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({}) })).corpo).toMatchObject({ erro: 'sem_confirmacao' });
  expect((await pedir(`${base}/narracao`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ caracteres_confirmados: 3 }) })).corpo).toMatchObject({ erro: 'estimativa_mudou' });
  const pedido = await pedir(`${base}/narracao`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ caracteres_confirmados: previa.caracteres }) });
  expect(pedido).toMatchObject({ status: 202, corpo: { estado: 'pendente' } });
  expect((await pedir(`${base}/narracao`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ caracteres_confirmados: previa.caracteres }) })).corpo).toMatchObject({ erro: 'narracao_em_curso' });

  // Worker com o provedor falso: publica AudioV2 que o player lista ao lado dos do Colab.
  const auditoria = await mkdtemp(join(tmpdir(), 'margem-narracao-auditoria-')); temporarios.push(auditoria);
  const anotacoes: AnotacaoWorker[] = [];
  await rodarWorker(banco, provedorFalso({ registro }), auditoria, anotacoes);
  expect(anotacoes.map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  expect(registro.at(-1)).toBe(texto);
  expect((await pedir(`${base}/narracao`)).corpo).toMatchObject({ estado: 'pronto', chave_configurada: true });
  const audios = (await pedir(`${base}/audios`)).corpo.audios as AudioNarrado[];
  expect(audios).toHaveLength(1);
  const audio = audios[0]!;
  expect(audio).toMatchObject({ versao: 2, titulo: 'Narração · Capítulo um', origem: { provedor: 'elevenlabs', voz_nome: 'Clara', modelo_id: 'eleven_flash_v2_5', caracteres: [...texto].length } });
  expect(audio.trechos.map((t) => t.ancora.citacao)).toEqual(['Capítulo um', 'Primeira frase do texto.', 'Segunda frase, com 🧭 no meio.', 'Outro parágrafo fecha o capítulo.']);
  const arquivo = await api.request(`/api/audios/${audio.id}/arquivo`);
  expect(arquivo.status).toBe(200);
  expect(arquivo.headers.get('content-type')).toBe('audio/mpeg');

  // Trecho selecionado: só ele vai para o provedor.
  const trecho: AncoraV1 = ancoraDeSelecao({ ...c.blocos[1]!, versao_id: versao.id }, 25, 55);
  const previaDoTrecho = (await pedir(`${base}/narracao/previa`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ trecho }) })).corpo;
  expect(previaDoTrecho).toMatchObject({ cenas: 1, caracteres: [...'Segunda frase, com 🧭 no meio.'].length, titulo: 'Narração do trecho · Capítulo um' });

  // Sem créditos no meio da geração: falha com a frase clara, visível no estado.
  expect((await pedir(`${base}/narracao`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ trecho, caracteres_confirmados: previaDoTrecho.caracteres }) })).status).toBe(202);
  await rodarWorker(banco, provedorFalso({ falharNoPedaco: { pedaco: 1, tipo: 'sem_creditos' } }), auditoria, anotacoes);
  expect((await pedir(`${base}/narracao`)).corpo).toMatchObject({ estado: 'falhou', codigo: 'sem_creditos', motivo: expect.stringContaining('Sem créditos') as unknown });

  // Erro do provedor que ecoa a chave: a mensagem gravada vem redigida.
  const eco: ProvedorDeVoz = { ...provedorFalso(), narrar: () => Promise.reject(new ErroDoProvedor('pedido_recusado', `eco ${CHAVE}`)) };
  await pedir(`${base}/narracao`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ trecho, caracteres_confirmados: previaDoTrecho.caracteres }) });
  await rodarWorker(banco, eco, auditoria, anotacoes);
  const ecoada = (await pedir(`${base}/narracao`)).corpo;
  expect(ecoada).toMatchObject({ estado: 'falhou', codigo: 'pedido_recusado' });
  expect(String(ecoada.motivo)).toContain('[chave omitida]');

  // Chave apagada antes do worker: falha "sem chave", sem chamar o provedor.
  await pedir(`${base}/narracao`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ trecho, caracteres_confirmados: previaDoTrecho.caracteres }) });
  expect((await pedir('/api/configuracoes/audio/chave', { method: 'DELETE', headers: ESCRITA })).corpo).toMatchObject({ chave: { configurada: false } });
  await rodarWorker(banco, provedorFalso({ falhar: 'chave_invalida' }), auditoria, anotacoes);
  expect((await pedir(`${base}/narracao`)).corpo).toMatchObject({ estado: 'falhou', codigo: 'sem_chave' });

  // A chave não está em nenhuma resposta, log, tabela (inclusive execucao_leitura e eventos) nem arquivo fora dos segredos.
  expect(respostas.join('\n')).not.toContain(CHAVE);
  expect(saidas.join('\n')).not.toContain(CHAVE);
  expect(JSON.stringify(anotacoes)).not.toContain(CHAVE);
  const tabelas = (await banco.query<{ tabela: string }>("SELECT table_name AS tabela FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows;
  expect(tabelas.map((t) => t.tabela)).toEqual(expect.arrayContaining(['job', 'evento_job', 'execucao_leitura', 'audio']));
  for (const { tabela } of tabelas) {
    const { rows } = await banco.query<{ linha: string }>(`SELECT t::text AS linha FROM "${tabela}" t`);
    expect(rows.map((r) => r.linha).join('\n'), tabela).not.toContain(CHAVE);
  }
  expect(await arquivosEmTexto(auditoria, '\0')).not.toContain(CHAVE);
  expect(await arquivosEmTexto(dados, pastaDosSegredos())).not.toContain(CHAVE);
}), 60_000);
