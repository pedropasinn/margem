/**
 * J16 na API: modos, anotações, "primeiro eu", snapshot V2 com camadas (e compatível com
 * a web de F1), conexões, conversas com o job `responder` e o SSE. Postgres de teste,
 * executor e responder falsos; nenhuma chamada ao Codex.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import { ulid } from 'ulid';
import { afterEach, expect, test } from 'vitest';
import {
  lerModosDeLeitura, validarAnotacao, validarDificuldade, validarNotaDoGrifo, type DificuldadeV1, type NotaDoGrifoV1, validarConexaoV2, validarConversaV2, validarEtiqueta, validarExecucaoLeitura, validarMarca, validarMarcaV2,
  type AncoraV1, type AnotacaoV1, type EtiquetaV1, type Bloco, type CanonicoV1, type ConexaoV2, type ConversaV2, type ExecucaoLeituraV1,
  type Id, type MarcaV1, type MarcaV2,
} from '@margem/contratos';
import { readFileSync } from 'node:fs';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comBancoDeTeste } from '../db/conexao.js';
import { migrar } from '../db/migrar.js';
import { comTransacao } from '../db/transacao.js';
import {
  TIPO_RESPONDER, manipuladorResponder, responderFalso, type EntradaDoResponder, type Responder,
} from '../conversa/responder.js';
import * as documentos from '../repos/documentos.js';
import * as execucoes from '../repos/execucoes.js';
import * as marcasRepo from '../repos/marcas.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});
async function temporario(nome: string): Promise<string> {
  const diretorio = await mkdtemp(join(tmpdir(), `margem-j16-${nome}-`));
  temporarios.push(diretorio);
  return diretorio;
}

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };

function montar(banco: pg.Pool): Hono {
  return criarApi({ banco, leitura: () => { throw new Error('Leitura não usada neste teste.'); }, intervaloEventosMs: 20 });
}

async function corpo<T>(resposta: Response): Promise<T> {
  return await resposta.json() as T;
}

function escrever(api: Hono, metodo: string, caminho: string, dado?: unknown): Promise<Response> {
  return Promise.resolve(api.request(caminho, {
    method: metodo, headers: ESCRITA, ...(dado === undefined ? {} : { body: JSON.stringify(dado) }),
  }));
}

/** Âncora exata no bloco: prefixo e sufixo são o resto do bloco. */
function ancora(versaoId: Id, bloco: Bloco, citacao: string): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  if (inicio < 0) throw new Error(`Citação ausente: ${citacao}`);
  return {
    versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length,
    citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length),
  };
}

function execucaoDeTeste(versaoId: Id, criadaEm: string): ExecucaoLeituraV1 {
  const base: unknown = JSON.parse(readFileSync(new URL('../../../contratos/casos/ExecucaoLeitura/valido-minimo.json', import.meta.url), 'utf8'));
  if (!validarExecucaoLeitura(base)) throw new Error('Caso de execução inválido.');
  return { ...base, id: ulid(), versao_id: versaoId, plano_partes: [ulid()], criada_em: criadaEm };
}

function marca(ancoraDaMarca: AncoraV1, funcao: MarcaV1['funcao'], execucaoId: Id): MarcaV1 {
  return {
    id: ulid(), ancora: ancoraDaMarca, funcao, subfaixas: [], comentario: { tipo: 'LEITURA', rotulo: 'LEITURA', texto: 'Comentário da IA.' },
    origem: 'parte', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada', execucao_id: execucaoId,
    criada_em: '2026-09-23T12:00:00.000Z',
  };
}

interface Montado {
  documentoId: Id;
  versaoId: Id;
  canonico: CanonicoV1;
  capitulo: Id;
  outroCapitulo: Id;
  antiga: Id;
  recente: Id;
  bloco: (indice: number) => Bloco;
}

/**
 * Dois capítulos. Duas execuções (camadas): a antiga marca a tese e o conceito; a recente
 * marca a mesma tese (sobreposição permitida entre camadas) e a justificativa.
 */
async function preparar(banco: pg.Pool): Promise<Montado> {
  const canonico = canonicoDeTeste({
    blocos: [
      { tipo: 'capitulo', texto: 'Capítulo um' },
      { tipo: 'paragrafo', texto: 'A tese central é simples: ler devagar.' },
      { tipo: 'paragrafo', texto: 'O conceito de atenção vem depois 🧭.' },
      { tipo: 'paragrafo', texto: 'E a justificativa fecha o argumento.' },
      { tipo: 'capitulo', texto: 'Capítulo dois' },
      { tipo: 'paragrafo', texto: 'Outro capítulo, outro assunto.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 3 }, { nivel: 1, inicio: 4, fim: 5 }],
  });
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'teste.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const bloco = (indice: number): Bloco => canonico.blocos[indice]!;
    const antiga = execucaoDeTeste(versao.id, '2026-09-22T10:00:00.000Z');
    const recente = execucaoDeTeste(versao.id, '2026-09-23T10:00:00.000Z');
    await execucoes.criar(cliente, antiga);
    await execucoes.criar(cliente, recente);
    await marcasRepo.publicarMarcas(cliente, versao.id, [
      marca(ancora(versao.id, bloco(1), 'A tese central é simples'), 'tese', antiga.id),
      marca(ancora(versao.id, bloco(2), 'conceito de atenção'), 'conceito', antiga.id),
      marca(ancora(versao.id, bloco(1), 'tese central'), 'tese', recente.id),
      marca(ancora(versao.id, bloco(3), 'justificativa'), 'justificativa', recente.id),
      marca(ancora(versao.id, bloco(5), 'outro assunto'), 'conceito', recente.id),
    ]);
    return {
      documentoId: documento.id, versaoId: versao.id, canonico,
      capitulo: canonico.secoes[0]!.id, outroCapitulo: canonico.secoes[1]!.id,
      antiga: antiga.id, recente: recente.id, bloco,
    };
  });
}

interface Snapshot {
  marcas: MarcaV2[];
  camada: string | null;
  precedencia: Id[];
  camadas: { id: Id; tipo: string; modo: { id: string; revisao: number }; criada_em: string; marcas: number }[];
  anotacoes: AnotacaoV1[];
  conexoes: ConexaoV2[];
  conversas: { id: Id; ancora: AncoraV1; mensagens: number; ultima: { autor: string; texto: string } | null }[];
  primeiro_eu: { ativo: boolean; liberado: boolean };
  revisao_marcas: string;
  edicoes: Record<string, { funcao_da_ia?: string; comentario_da_ia?: unknown }>;
  etiquetas: EtiquetaV1[];
  blocos: Bloco[];
}

async function capitulo(api: Hono, m: Montado, consulta = '', secao = m.capitulo): Promise<Snapshot> {
  const resposta = await api.request(`/api/versoes/${m.versaoId}/capitulos/${secao}${consulta}`);
  expect(resposta.status).toBe(200);
  return corpo<Snapshot>(resposta);
}

/** Campos que a web de F1 (J09/J11) lê de cada marca do snapshot. */
const CAMPOS_DA_WEB = ['id', 'ancora', 'funcao', 'subfaixas', 'comentario', 'origem', 'validade', 'visivel', 'avaliacao'] as const;

// ---------------------------------------------------------------- modos

test('GET /api/modos devolve todos os modos registrados e validados', async () => comBanco('j16_modos', async (banco) => {
  const api = montar(banco);
  const { modos } = await corpo<{ modos: { id: string; revisao: number; funcoes: unknown[] }[] }>(await api.request('/api/modos'));
  expect(modos.map((modo) => `${modo.id}@${String(modo.revisao)}`).sort())
    .toEqual(lerModosDeLeitura().map((modo) => `${modo.id}@${String(modo.revisao)}`).sort());
}));

// ---------------------------------------------------------------- snapshot e camadas

test('snapshot V2: camada padrão é a mais recente, ?camada= e todas com precedência; marcas legíveis como V1 pela web', async () =>
  comBanco('j16_snapshot', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const padrao = await capitulo(api, m);
    expect(padrao.camada).toBe(m.recente);
    expect(padrao.marcas.map((item) => item.funcao).sort()).toEqual(['justificativa', 'tese']);
    expect(padrao.camadas.map((item) => [item.id, item.tipo, item.marcas])).toEqual([[m.recente, 'execucao', 2], [m.antiga, 'execucao', 2]]);
    expect(padrao.camadas[0]?.modo).toEqual({ id: 'argumentativa', revisao: 1 });
    expect(padrao).toMatchObject({ anotacoes: [], conexoes: [], conversas: [], primeiro_eu: { ativo: false, liberado: true } });

    // Compatibilidade com a web: todo campo que ela lê está lá, e o V2 sem os campos novos é uma MarcaV1.
    for (const item of padrao.marcas) {
      expect(validarMarcaV2(item)).toBe(true);
      for (const campo of CAMPOS_DA_WEB) expect(item).toHaveProperty(campo);
      const v1: Record<string, unknown> = { ...item };
      delete v1.saliencia; delete v1.camada_id; delete v1.modo;
      expect(validarMarca(v1)).toBe(true);
    }

    const antiga = await capitulo(api, m, `?camada=${m.antiga}`);
    expect(antiga.camada).toBe(m.antiga);
    expect(antiga.marcas.map((item) => item.funcao).sort()).toEqual(['conceito', 'tese']);
    const todas = await capitulo(api, m, '?camada=todas');
    expect(todas.marcas).toHaveLength(4);
    expect(todas.precedencia).toEqual([m.recente, m.antiga]);
    // A revisão de marcas (snapshot_base do lote) continua a de todas as marcas da versão, em V1.
    expect(new Set([padrao.revisao_marcas, antiga.revisao_marcas, todas.revisao_marcas]).size).toBe(1);

    expect((await api.request(`/api/versoes/${m.versaoId}/capitulos/${m.capitulo}?camada=${ulid()}`)).status).toBe(404);
    expect((await api.request(`/api/versoes/${m.versaoId}/capitulos/${m.capitulo}?camada=xyz`)).status).toBe(400);

    // Preferência de camada padrão; e a rota de camadas conta as marcas da versão inteira.
    const preferencia = await escrever(api, 'PUT', `/api/documentos/${m.documentoId}/preferencias`, { camada_padrao: m.antiga });
    expect(preferencia.status).toBe(200);
    expect((await capitulo(api, m)).camada).toBe(m.antiga);
    const camadas = await corpo<{ camada_padrao: Id; camadas: { id: Id; marcas: number }[] }>(
      await api.request(`/api/documentos/${m.documentoId}/camadas`));
    expect(camadas.camada_padrao).toBe(m.antiga);
    expect(camadas.camadas.map((item) => [item.id, item.marcas])).toEqual([[m.recente, 3], [m.antiga, 2]]);
    expect((await escrever(api, 'PUT', `/api/documentos/${m.documentoId}/preferencias`, { camada_padrao: ulid() })).status).toBe(422);
    expect((await escrever(api, 'PUT', `/api/documentos/${m.documentoId}/preferencias`, { primeiro_eu: 'sim' })).status).toBe(400);
    expect((await escrever(api, 'PUT', `/api/documentos/${ulid()}/preferencias`, { primeiro_eu: true })).status).toBe(404);
    expect((await api.request(`/api/documentos/${ulid()}/camadas`)).status).toBe(404);
  }));

test('snapshot V2: a camada padrão é a mais recente com marcas no capítulo aberto, não na versão', async () =>
  comBanco('j16_padrao_cap', async (banco) => {
    // Como a importação legada: um lote por capítulo. A camada mais nova só marca o capítulo dois.
    const m = await preparar(banco);
    const novissima = execucaoDeTeste(m.versaoId, '2026-09-24T10:00:00.000Z');
    await comTransacao(banco, async (cliente) => {
      await execucoes.criar(cliente, novissima);
      await marcasRepo.publicarMarcas(cliente, m.versaoId, [
        marca(ancora(m.versaoId, m.bloco(5), 'Outro capítulo'), 'tese', novissima.id),
      ]);
    });
    const api = montar(banco);
    const primeiro = await capitulo(api, m);
    expect(primeiro.camada).toBe(m.recente);
    expect(primeiro.marcas).toHaveLength(2);
    const segundo = await capitulo(api, m, '', m.outroCapitulo);
    expect(segundo.camada).toBe(novissima.id);
    expect(segundo.marcas).toHaveLength(1);
  }));

// ---------------------------------------------------------------- anotações e primeiro eu

test('anotações: criar, editar, apagar; âncora falsa, campo desconhecido e escrita sem X-Margem são recusados', async () =>
  comBanco('j16_anotacoes', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const trecho = ancora(m.versaoId, m.bloco(2), 'atenção');
    const criada = await escrever(api, 'POST', '/api/anotacoes', { ancora: trecho, tipo: 'impressao', texto: 'Parece o centro do capítulo.' });
    expect(criada.status).toBe(201);
    const { anotacao } = await corpo<{ anotacao: AnotacaoV1 }>(criada);
    expect(validarAnotacao(anotacao)).toBe(true);
    expect(anotacao).toMatchObject({ versao_id: m.versaoId, ancora: trecho, tipo: 'impressao' });
    expect(anotacao.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);

    const editada = await corpo<{ anotacao: AnotacaoV1 }>(await escrever(api, 'PATCH', `/api/anotacoes/${anotacao.id}`, {
      revisao: 1, tipo: 'fonte', texto: 'Ver o capítulo 3.', fonte: { titulo: 'Mixtape', pagina: 'xii' },
    }));
    expect(editada.anotacao).toMatchObject({ id: anotacao.id, tipo: 'fonte', fonte: { titulo: 'Mixtape', pagina: 'xii' }, criada_em: anotacao.criada_em });
    expect(Date.parse(editada.anotacao.atualizada_em)).toBeGreaterThanOrEqual(Date.parse(anotacao.criada_em));
    const semFonte = await corpo<{ anotacao: AnotacaoV1 }>(await escrever(api, 'PATCH', `/api/anotacoes/${anotacao.id}`, { revisao: 2, tipo: 'hipotese', fonte: null }));
    expect(semFonte.anotacao).not.toHaveProperty('fonte');
    // Fonte em tipo que não é `fonte`: o contrato recusa.
    expect((await escrever(api, 'PATCH', `/api/anotacoes/${anotacao.id}`, { revisao: 3, fonte: { titulo: 'x' } })).status).toBe(422);

    expect((await capitulo(api, m)).anotacoes.map((item) => item.id)).toEqual([anotacao.id]);
    expect((await capitulo(api, m, '', m.outroCapitulo)).anotacoes).toEqual([]);

    // Âncora que não confere no bloco real, campo desconhecido, bloco de outra versão, sem cabeçalho.
    const falsa = { ...trecho, prefixo: 'Outro prefixo ' };
    expect((await escrever(api, 'POST', '/api/anotacoes', { ancora: falsa, tipo: 'nota', texto: 'x' })).status).toBe(422);
    expect((await escrever(api, 'POST', '/api/anotacoes', { ancora: trecho, tipo: 'nota', texto: 'x', id: ulid() })).status).toBe(400);
    expect((await escrever(api, 'POST', '/api/anotacoes', { ancora: { ...trecho, versao_id: ulid() }, tipo: 'nota', texto: 'x' })).status).toBe(422);
    expect((await escrever(api, 'POST', '/api/anotacoes', { ancora: trecho, tipo: 'nota', texto: '   ' })).status).toBe(422);
    const semCabecalho = await api.request('/api/anotacoes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ancora: trecho, tipo: 'nota', texto: 'x' }),
    });
    expect(semCabecalho.status).toBe(403);

    expect((await escrever(api, 'DELETE', `/api/anotacoes/${anotacao.id}`, { revisao: 3 })).status).toBe(200);
    expect((await escrever(api, 'DELETE', `/api/anotacoes/${anotacao.id}`, { revisao: 3 })).status).toBe(404);
    expect((await escrever(api, 'PATCH', `/api/anotacoes/${anotacao.id}`, { revisao: 3, texto: 'y' })).status).toBe(404);
    expect((await banco.query('SELECT count(*)::int AS n FROM anotacao')).rows[0]).toEqual({ n: 0 });
  }));

test('etiquetas livres e dificuldades, numa marca e numa anotação, sem repetir; somem com o alvo', async () =>
  comBanco('j16_etiquetas', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const marcaId = (await capitulo(api, m)).marcas[0]!.id;
    const criada = await escrever(api, 'POST', '/api/etiquetas', { versao_id: m.versaoId, alvo: { tipo: 'marca', id: marcaId }, nome: 'ambiguidade' });
    expect(criada.status).toBe(201);
    const { etiqueta } = await corpo<{ etiqueta: EtiquetaV1 }>(criada);
    expect(validarEtiqueta(etiqueta)).toBe(true);
    expect(etiqueta).toMatchObject({ versao_id: m.versaoId, alvo: { tipo: 'marca', id: marcaId }, nome: 'ambiguidade' });
    // A mesma no mesmo alvo devolve a que já existe.
    const repetida = await escrever(api, 'POST', '/api/etiquetas', { versao_id: m.versaoId, alvo: { tipo: 'marca', id: marcaId }, nome: 'ambiguidade' });
    expect(repetida.status).toBe(200);
    expect((await corpo<{ etiqueta: EtiquetaV1 }>(repetida)).etiqueta.id).toBe(etiqueta.id);
    // Trim na entrada, comparação sem maiúsculas e limites do contrato.
    const livre = await corpo<{ etiqueta: EtiquetaV1 }>(await escrever(api, 'POST', '/api/etiquetas', { versao_id: m.versaoId, alvo: { tipo: 'marca', id: marcaId }, nome: '  Para revisar  ' }));
    expect(livre.etiqueta.nome).toBe('Para revisar');
    const duplicada = await escrever(api, 'POST', '/api/etiquetas', { versao_id: m.versaoId, alvo: { tipo: 'marca', id: marcaId }, nome: 'para REVISAR' });
    expect(duplicada.status).toBe(200);
    expect((await corpo<{ etiqueta: EtiquetaV1 }>(duplicada)).etiqueta.id).toBe(livre.etiqueta.id);
    for (const nome of ['', '  ', 'a'.repeat(41), 'duas\nlinhas', 123]) {
      expect((await escrever(api, 'POST', '/api/etiquetas', { versao_id: m.versaoId, alvo: { tipo: 'marca', id: marcaId }, nome })).status).toBe(422);
    }

    const nota = await corpo<{ anotacao: AnotacaoV1 }>(await escrever(api, 'POST', '/api/anotacoes', {
      ancora: ancora(m.versaoId, m.bloco(2), 'atenção'), tipo: 'duvida', texto: 'Atenção a quê?' }));
    expect((await escrever(api, 'POST', '/api/etiquetas', { versao_id: m.versaoId, alvo: { tipo: 'anotacao', id: nota.anotacao.id }, nome: 'conceito_sem_definicao' })).status).toBe(201);
    expect((await escrever(api, 'POST', '/api/etiquetas', { versao_id: m.versaoId, alvo: { tipo: 'anotacao', id: nota.anotacao.id }, nome: 'para revisar' })).status).toBe(201);
    const filtrado = await capitulo(api, m, '?etiqueta=%20PARA%20REVISAR%20');
    expect(filtrado.marcas.map((item) => item.id)).toEqual([marcaId]);
    expect(filtrado.anotacoes.map((item) => item.id)).toEqual([nota.anotacao.id]);
    const vazio = await capitulo(api, m, '?etiqueta=inexistente');
    expect(vazio.anotacoes).toEqual([]);
    expect(vazio.marcas).toEqual([]);
    expect((await capitulo(api, m, '?etiqueta=')).anotacoes.map((item) => item.id)).toEqual([nota.anotacao.id]);
    const lista = await corpo<{ etiquetas: EtiquetaV1[]; sugestoes: string[] }>(await api.request(`/api/versoes/${m.versaoId}/etiquetas`));
    expect(lista.etiquetas.map((item) => item.nome)).toEqual(['ambiguidade', 'Para revisar', 'conceito_sem_definicao', 'para revisar']);
    expect(lista.sugestoes.map((nome) => nome.toLowerCase()).filter((nome) => nome === 'para revisar')).toHaveLength(1);
    // O capítulo traz as etiquetas.
    expect((await capitulo(api, m)).etiquetas.map((item) => item.nome).sort()).toEqual(['Para revisar', 'ambiguidade', 'conceito_sem_definicao', 'para revisar']);

    expect((await escrever(api, 'POST', '/api/etiquetas', { versao_id: m.versaoId, alvo: { tipo: 'marca', id: ulid() }, nome: 'ambiguidade' })).status).toBe(422);
    expect((await escrever(api, 'POST', '/api/etiquetas', { versao_id: m.versaoId, alvo: { tipo: 'marca', id: marcaId }, nome: 'ambiguidade', cor: 'azul' })).status).toBe(400);
    expect((await escrever(api, 'DELETE', `/api/etiquetas/${etiqueta.id}`)).status).toBe(200);
    expect((await escrever(api, 'DELETE', `/api/etiquetas/${etiqueta.id}`)).status).toBe(404);
    await escrever(api, 'DELETE', `/api/etiquetas/${livre.etiqueta.id}`);
    await escrever(api, 'DELETE', `/api/anotacoes/${nota.anotacao.id}`, { revisao: 1 });
    expect((await banco.query('SELECT count(*)::int AS n FROM etiqueta')).rows[0]).toEqual({ n: 0 });
  }));

test('grifos do leitor: numa camada própria que não é de leitura, em qualquer camada, sem sobrepor; só os dele se apagam', async () =>
  comBanco('j37_grifos', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const trecho = ancora(m.versaoId, m.bloco(3), 'fecha o argumento');
    const criado = await escrever(api, 'POST', '/api/grifos', { ancora: trecho, funcao: 'tese' });
    expect(criado.status).toBe(201);
    const { marca } = await corpo<{ marca: MarcaV2 }>(criado);
    expect(validarMarcaV2(marca)).toBe(true);
    expect(marca).toMatchObject({ origem: 'manual', funcao: 'tese', avaliacao: 'confirmada', comentario: null, modo: { id: 'argumentativa', revisao: 1 } });
    // A camada do leitor não é escolhível nem padrão, e o grifo aparece na camada antiga e na recente.
    const agora = await capitulo(api, m);
    expect(agora.camadas.map((camada) => camada.id)).not.toContain(marca.camada_id);
    expect(agora.camada).toBe(m.recente);
    expect(agora.marcas.map((item) => item.id)).toContain(marca.id);
    expect((await capitulo(api, m, `?camada=${m.antiga}`)).marcas.map((item) => item.id)).toContain(marca.id);
    expect((await capitulo(api, m, '?camada=todas')).marcas.filter((item) => item.id === marca.id)).toHaveLength(1);
    // Fora da V1: o hash das marcas não muda com o grifo do leitor.
    expect(agora.revisao_marcas).toBe((await capitulo(api, m, `?camada=${m.antiga}`)).revisao_marcas);

    // Sobrepor outro grifo dele é conflito; função fora do modo e âncora falsa, dado inválido.
    expect((await escrever(api, 'POST', '/api/grifos', { ancora: ancora(m.versaoId, m.bloco(3), 'o argumento'), funcao: 'conceito' })).status).toBe(409);
    expect((await escrever(api, 'POST', '/api/grifos', { ancora: ancora(m.versaoId, m.bloco(2), 'atenção'), funcao: 'metafora' })).status).toBe(422);
    expect((await escrever(api, 'POST', '/api/grifos', { ancora: { ...trecho, prefixo: 'x' }, funcao: 'tese' })).status).toBe(422);
    expect((await escrever(api, 'POST', '/api/grifos', { ancora: trecho })).status).toBe(400);

    // A etiqueta de função troca a função do grifo; na marca da IA, a original fica guardada e voltar a ela limpa.
    expect((await corpo<{ marca: MarcaV2 }>(await escrever(api, 'PUT', `/api/marcas/${marca.id}/funcao`, { funcao: 'conceito' }))).marca.funcao).toBe('conceito');
    expect((await capitulo(api, m)).edicoes[marca.id]).toBeUndefined();
    const daIa = (await capitulo(api, m)).marcas.find((item) => item.origem !== 'manual' && item.funcao === 'justificativa')!;
    expect((await corpo<{ marca: MarcaV2 }>(await escrever(api, 'PUT', `/api/marcas/${daIa.id}/funcao`, { funcao: 'tese' }))).marca.funcao).toBe('tese');
    expect((await capitulo(api, m)).edicoes[daIa.id]).toEqual({ funcao_da_ia: 'justificativa' });
    await escrever(api, 'PUT', `/api/marcas/${daIa.id}/funcao`, { funcao: 'justificativa' });
    expect((await capitulo(api, m)).edicoes[daIa.id]).toBeUndefined();
    expect((await escrever(api, 'PUT', `/api/marcas/${daIa.id}/funcao`, { funcao: 'metafora' })).status).toBe(422);

    // A nota da IA editada pelo leitor: o original fica; null volta a ele.
    const editada = await corpo<{ marca: MarcaV2 }>(await escrever(api, 'PUT', `/api/marcas/${daIa.id}/nota`, { texto: 'Minha versão da nota.' }));
    expect(editada.marca.comentario).toMatchObject({ tipo: 'LEITURA', texto: 'Minha versão da nota.' });
    expect((await capitulo(api, m)).edicoes[daIa.id]?.comentario_da_ia).toMatchObject({ texto: 'Comentário da IA.' });
    expect((await corpo<{ marca: MarcaV2 }>(await escrever(api, 'PUT', `/api/marcas/${daIa.id}/nota`, { texto: null }))).marca.comentario).toMatchObject({ texto: 'Comentário da IA.' });
    expect((await capitulo(api, m)).edicoes[daIa.id]).toBeUndefined();
    // O grifo do leitor ganha uma nota sem "original".
    expect((await corpo<{ marca: MarcaV2 }>(await escrever(api, 'PUT', `/api/marcas/${marca.id}/nota`, { texto: 'Por que isto fecha.' }))).marca.comentario).toMatchObject({ texto: 'Por que isto fecha.' });
    expect((await escrever(api, 'PUT', `/api/marcas/${marca.id}/nota`, { texto: '  ' })).status).toBe(400);

    // Apagar: só os grifos dele.
    expect((await escrever(api, 'DELETE', `/api/grifos/${daIa.id}`)).status).toBe(409);
    expect((await escrever(api, 'DELETE', `/api/grifos/${marca.id}`)).status).toBe(200);
    expect((await escrever(api, 'DELETE', `/api/grifos/${marca.id}`)).status).toBe(404);
    expect((await capitulo(api, m)).marcas.map((item) => item.id)).not.toContain(marca.id);
  }));

test('modelo D (J138): a nota é do grifo, um por grifo, sem tipo; sai com o grifo; outro olhar muda o modo do grifo', async () =>
  comBanco('j138_nota_do_grifo', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const { marca } = await corpo<{ marca: MarcaV2 }>(await escrever(api, 'POST', '/api/grifos', { ancora: ancora(m.versaoId, m.bloco(3), 'fecha o argumento'), funcao: 'tese' }));
    const url = `/api/marcas/${marca.id}/nota-do-leitor`;
    const criada = await escrever(api, 'PUT', url, { texto: '  Por que isto fecha.  ' });
    expect(criada.status).toBe(200);
    const { nota } = await corpo<{ nota: NotaDoGrifoV1 }>(criada);
    expect(validarNotaDoGrifo(nota), JSON.stringify(validarNotaDoGrifo.errors)).toBe(true);
    expect(nota).toMatchObject({ marca_id: marca.id, texto: 'Por que isto fecha.', revisao_edicao: 1 });
    expect(nota).not.toHaveProperty('tipo');
    // Salvar de novo troca o texto da mesma nota (o debounce da tela manda a revisão que viu).
    const trocada = await corpo<{ nota: NotaDoGrifoV1 }>(await escrever(api, 'PUT', url, { texto: 'Fecha porque retoma a tese.', revisao: 1 }));
    expect(trocada.nota).toMatchObject({ id: nota.id, texto: 'Fecha porque retoma a tese.', revisao_edicao: 2 });
    expect((await escrever(api, 'PUT', url, { texto: 'Velha.', revisao: 1 })).status).toBe(409);
    expect((await escrever(api, 'PUT', url, { texto: '   ' })).status).toBe(400);
    expect((await escrever(api, 'PUT', url, { texto: 'x', tipo: 'duvida' })).status).toBe(400);
    expect((await escrever(api, 'PUT', `/api/marcas/${ulid()}/nota-do-leitor`, { texto: 'Sem grifo.' })).status).toBe(404);
    // A nota do grifo é a anotação dele: o capítulo a traz; uma segunda nota no mesmo grifo é recusada.
    expect((await capitulo(api, m)).anotacoes.filter((a) => a.marca_id === marca.id).map((a) => a.id)).toEqual([nota.id]);
    expect((await escrever(api, 'POST', '/api/anotacoes', { ancora: marca.ancora, tipo: 'nota', texto: 'Outra.', marca_id: marca.id })).status).toBe(422);
    // Tirar a nota deixa o grifo.
    expect((await escrever(api, 'DELETE', url, { revisao: 2 })).status).toBe(200);
    expect((await capitulo(api, m)).marcas.map((item) => item.id)).toContain(marca.id);
    expect((await escrever(api, 'DELETE', url, { revisao: 2 })).status).toBe(404);
    // Apagar o grifo leva a nota junto.
    await escrever(api, 'PUT', url, { texto: 'De novo.' });
    expect((await escrever(api, 'DELETE', `/api/grifos/${marca.id}`)).status).toBe(200);
    expect((await banco.query('SELECT count(*)::int AS n FROM anotacao WHERE texto=$1', ['De novo.'])).rows[0]).toEqual({ n: 0 });

    // Outros olhares: a função de outro modo leva o grifo para aquele modo; grifos de modos diferentes convivem.
    const outro = lerModosDeLeitura().find((modo) => modo.id !== 'argumentativa' && modo.funcoes.length > 0)!;
    const { marca: grifo } = await corpo<{ marca: MarcaV2 }>(await escrever(api, 'POST', '/api/grifos', { ancora: ancora(m.versaoId, m.bloco(2), 'atenção'), funcao: 'conceito' }));
    await escrever(api, 'POST', '/api/grifos', { ancora: ancora(m.versaoId, m.bloco(1), 'ler devagar'), funcao: 'tese' });
    const olhar = await escrever(api, 'PUT', `/api/marcas/${grifo.id}/funcao`, { funcao: outro.funcoes[0]!.chave, modo: { id: outro.id, revisao: outro.revisao } });
    expect(olhar.status).toBe(200);
    const movido = (await corpo<{ marca: MarcaV2 }>(olhar)).marca;
    expect(movido).toMatchObject({ id: grifo.id, funcao: outro.funcoes[0]!.chave, modo: { id: outro.id, revisao: outro.revisao } });
    expect(validarMarcaV2(movido)).toBe(true);
    const modos = new Set((await capitulo(api, m)).marcas.filter((item) => item.origem === 'manual').map((item) => item.modo.id));
    expect(modos).toEqual(new Set(['argumentativa', outro.id]));
    expect((await escrever(api, 'PUT', `/api/marcas/${grifo.id}/funcao`, { funcao: 'nao_existe', modo: { id: outro.id, revisao: outro.revisao } })).status).toBe(422);
    expect((await escrever(api, 'PUT', `/api/marcas/${grifo.id}/funcao`, { funcao: 'tese', modo: { id: 'inexistente', revisao: 1 } })).status).toBe(422);
    const daIa = (await capitulo(api, m)).marcas.find((item) => item.origem !== 'manual')!;
    expect((await escrever(api, 'PUT', `/api/marcas/${daIa.id}/funcao`, { funcao: outro.funcoes[0]!.chave, modo: { id: outro.id, revisao: outro.revisao } })).status).toBe(422);
  }));

test('modelo D (J138): o sinal de dificuldade, do leitor (confirmado) e do Codex (confirmar ou descartar), sem apagar nada', async () =>
  comBanco('j138_dificuldade', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const trecho = ancora(m.versaoId, m.bloco(2), 'atenção');
    const marcada = await escrever(api, 'POST', '/api/dificuldades', { ancora: trecho });
    expect(marcada.status).toBe(201);
    const { dificuldade } = await corpo<{ dificuldade: DificuldadeV1 }>(marcada);
    expect(validarDificuldade(dificuldade), JSON.stringify(validarDificuldade.errors)).toBe(true);
    expect(dificuldade).toMatchObject({ origem: 'leitor', estado: 'confirmada' });
    expect(dificuldade).not.toHaveProperty('tipo');
    // A categoria é um detalhe escolhido depois; descartar é um estado; a do leitor não vira "sugerida".
    const comTipo = await corpo<{ dificuldade: DificuldadeV1 }>(await escrever(api, 'PATCH', `/api/dificuldades/${dificuldade.id}`, { tipo: 'conceito_sem_definicao' }));
    expect(comTipo.dificuldade.tipo).toBe('conceito_sem_definicao');
    expect((await escrever(api, 'PATCH', `/api/dificuldades/${dificuldade.id}`, { tipo: 'cor' })).status).toBe(400);
    expect((await escrever(api, 'PATCH', `/api/dificuldades/${dificuldade.id}`, { estado: 'sugerida' })).status).toBe(422);
    expect((await corpo<{ dificuldade: DificuldadeV1 }>(await escrever(api, 'PATCH', `/api/dificuldades/${dificuldade.id}`, { estado: 'descartada', tipo: null }))).dificuldade)
      .toMatchObject({ estado: 'descartada' });
    expect((await escrever(api, 'POST', '/api/dificuldades', { ancora: { ...trecho, prefixo: 'x' } })).status).toBe(422);
    // A sugestão do Codex: a primeira decisão grava a linha; a seguinte muda o estado.
    const modeloId = ulid(); const sugeridaId = ulid();
    const outro = ancora(m.versaoId, m.bloco(3), 'justificativa');
    await banco.query(`INSERT INTO modelo_capitulo (id,execucao_id,secao_id,revisao,estagio,conteudo) VALUES ($1,$2,$3,2,'revisao',$4)`,
      [modeloId, m.recente, m.capitulo, JSON.stringify({ id: modeloId, dificuldades: [{ id: sugeridaId, tipo: 'salto_argumentativo', ancoras: [outro], descricao: 'O passo do meio falta.', origem: { estagio: 'revisao', job_id: ulid() } }] })]);
    const decidida = await corpo<{ dificuldade: DificuldadeV1 }>(await escrever(api, 'POST', '/api/dificuldades/codex', { modelo_id: modeloId, dificuldade_id: sugeridaId, estado: 'confirmada' }));
    expect(decidida.dificuldade).toMatchObject({ origem: 'codex', estado: 'confirmada', tipo: 'salto_argumentativo', codex: { modelo_id: modeloId, dificuldade_id: sugeridaId } });
    const descartada = await corpo<{ dificuldade: DificuldadeV1 }>(await escrever(api, 'POST', '/api/dificuldades/codex', { modelo_id: modeloId, dificuldade_id: sugeridaId, estado: 'descartada' }));
    expect(descartada.dificuldade).toMatchObject({ id: decidida.dificuldade.id, estado: 'descartada' });
    expect((await escrever(api, 'POST', '/api/dificuldades/codex', { modelo_id: modeloId, dificuldade_id: ulid(), estado: 'confirmada' })).status).toBe(422);
    const doCapitulo = (await capitulo(api, m)) as unknown as { dificuldades: DificuldadeV1[]; modo_principal: unknown };
    expect(doCapitulo.dificuldades.map((d) => d.id).sort()).toEqual([dificuldade.id, decidida.dificuldade.id].sort());
    expect(doCapitulo.modo_principal).toBeNull();
    expect((await banco.query('SELECT count(*)::int AS n FROM dificuldade')).rows[0]).toEqual({ n: 2 });
  }));

test('primeiro eu: sem anotação do leitor no capítulo, marcas vêm vazias e continuam no banco; a primeira anotação libera', async () =>
  comBanco('j16_primeiro_eu', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    expect((await escrever(api, 'PUT', `/api/documentos/${m.documentoId}/preferencias`, { primeiro_eu: true })).status).toBe(200);
    const preso = await capitulo(api, m);
    expect(preso.primeiro_eu).toEqual({ ativo: true, liberado: false });
    expect(preso.marcas).toEqual([]);
    expect(preso.blocos).toHaveLength(4);
    expect((await banco.query('SELECT count(*)::int AS n FROM marca WHERE versao_id=$1', [m.versaoId])).rows[0]).toEqual({ n: 5 });
    // Anotação em outro capítulo não libera este.
    await escrever(api, 'POST', '/api/anotacoes', { ancora: ancora(m.versaoId, m.bloco(5), 'outro assunto'), tipo: 'impressao', texto: 'Outra coisa.' });
    expect((await capitulo(api, m)).marcas).toEqual([]);
    const outro = await capitulo(api, m, '', m.outroCapitulo);
    expect(outro.primeiro_eu).toEqual({ ativo: true, liberado: true });
    expect(outro.marcas).toHaveLength(1);
    // A primeira anotação neste capítulo libera.
    await escrever(api, 'POST', '/api/anotacoes', { ancora: ancora(m.versaoId, m.bloco(1), 'ler devagar'), tipo: 'impressao', texto: 'Gosto disto.' });
    const livre = await capitulo(api, m);
    expect(livre.primeiro_eu).toEqual({ ativo: true, liberado: true });
    expect(livre.marcas).toHaveLength(2);
    // Desligar a preferência mostra tudo de novo, mesmo sem anotação.
    await escrever(api, 'PUT', `/api/documentos/${m.documentoId}/preferencias`, { primeiro_eu: false });
    expect((await capitulo(api, m)).primeiro_eu).toEqual({ ativo: false, liberado: true });
  }));

test('primeiro eu: um grifo do leitor no capítulo também libera as marcas da IA (a nota agora é do grifo)', async () =>
  comBanco('j132_grifo_libera', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    expect((await escrever(api, 'PUT', `/api/documentos/${m.documentoId}/preferencias`, { primeiro_eu: true })).status).toBe(200);
    expect((await capitulo(api, m)).primeiro_eu).toEqual({ ativo: true, liberado: false });
    expect((await escrever(api, 'POST', '/api/grifos', { ancora: ancora(m.versaoId, m.bloco(2), 'atenção'), funcao: 'nenhuma' })).status).toBe(201);
    const livre = await capitulo(api, m);
    expect(livre.primeiro_eu).toEqual({ ativo: true, liberado: true });
    expect(livre.marcas.filter((marca) => marca.origem !== 'manual')).toHaveLength(2);
  }));

// ---------------------------------------------------------------- conexões

test('conexões: a do leitor nasce aceita; decidir só vale para sugestão da IA; aparecem por origem e destino', async () =>
  comBanco('j16_conexoes', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const origem = ancora(m.versaoId, m.bloco(1), 'ler devagar');
    const destino = ancora(m.versaoId, m.bloco(5), 'outro assunto');
    const resposta = await escrever(api, 'POST', '/api/conexoes', {
      origem, destino: { tipo: 'trecho', ancora: destino }, relacao: 'contraste', justificativa: 'Um pede calma, o outro muda de assunto.',
    });
    expect(resposta.status).toBe(201);
    const { conexao } = await corpo<{ conexao: ConexaoV2 }>(resposta);
    expect(validarConexaoV2(conexao)).toBe(true);
    expect(conexao).toMatchObject({ autor: 'leitor', estado: 'aceita', decidida_em: conexao.criada_em });
    expect((await escrever(api, 'POST', `/api/conexoes/${conexao.id}/decidir`, { estado: 'rejeitada' })).status).toBe(409);
    // Aparece no capítulo da origem e no do destino.
    expect((await capitulo(api, m)).conexoes.map((item) => item.id)).toEqual([conexao.id]);
    expect((await capitulo(api, m, '', m.outroCapitulo)).conexoes.map((item) => item.id)).toEqual([conexao.id]);

    const nota = await escrever(api, 'POST', '/api/conexoes', {
      origem, destino: { tipo: 'nota_externa', caminho: 'leitura/atencao.md', titulo: 'Atenção' }, relacao: 'desenvolve', justificativa: 'Nota do cofre.',
    });
    expect(nota.status).toBe(201);
    expect((await escrever(api, 'POST', '/api/conexoes', {
      origem, destino: { tipo: 'nota_externa', caminho: '../fora.md', titulo: 'x' }, relacao: 'desenvolve', justificativa: 'x',
    })).status).toBe(422);
    expect((await escrever(api, 'POST', '/api/conexoes', {
      origem, destino: { tipo: 'documento', documento_id: ulid() }, relacao: 'exemplo', justificativa: 'x',
    })).status).toBe(422);
    expect((await escrever(api, 'POST', '/api/conexoes', {
      origem: { ...origem, citacao: 'ler devagaR' }, destino: { tipo: 'documento', documento_id: m.documentoId }, relacao: 'exemplo', justificativa: 'x',
    })).status).toBe(422);
    expect((await escrever(api, 'POST', '/api/conexoes', { origem, destino: { tipo: 'documento', documento_id: m.documentoId }, relacao: 'exemplo', justificativa: 'x', autor: 'ia' })).status).toBe(400);
    expect((await escrever(api, 'POST', `/api/conexoes/${ulid()}/decidir`, { estado: 'aceita' })).status).toBe(404);
    expect((await escrever(api, 'POST', `/api/conexoes/${conexao.id}/decidir`, { estado: 'sugerida' })).status).toBe(400);
  }));

// ---------------------------------------------------------------- conversas e responder

async function rodarWorker(banco: pg.Pool, responder: Responder, artefatos: string, ciclos = 3): Promise<void> {
  const worker = new Worker({
    fila: new FilaPostgres(banco),
    manipuladores: { [TIPO_RESPONDER]: manipuladorResponder({ banco, responder, diretorioArtefatos: artefatos }) },
    diretorioSlots: await temporario('vagas'),
    slots: 1, intervaloMs: 5, maximoCiclos: ciclos,
  });
  await worker.rodar();
}

function contando(base: Responder): { responder: Responder; entradas: EntradaDoResponder[] } {
  const entradas: EntradaDoResponder[] = [];
  return { entradas, responder: (entrada) => { entradas.push(entrada); return base(entrada); } };
}

async function lerEventos(api: Hono): Promise<{ tipo: string; job_tipo: string; detalhe: Record<string, unknown> }[]> {
  const resposta = await api.request('/api/eventos', { headers: { 'last-event-id': '0' } });
  const leitor = resposta.body?.getReader();
  if (!leitor) throw new Error('SSE sem corpo');
  const decodificador = new TextDecoder();
  let bruto = '';
  const pausa = new Promise<'pausa'>((resolver) => { setTimeout(() => { resolver('pausa'); }, 300); });
  try {
    for (;;) {
      const cru: unknown = await Promise.race([leitor.read(), pausa]);
      if (cru === 'pausa') break;
      const passo = cru as { done: boolean; value?: Uint8Array };
      if (passo.done || passo.value === undefined) break;
      bruto += decodificador.decode(passo.value, { stream: true });
    }
  } finally {
    await leitor.cancel();
  }
  return bruto.split('\n\n').filter((bloco) => bloco.trim() !== '').map((bloco) => {
    const dado = /^data:\s*(.*)$/m.exec(bloco)?.[1] ?? '{}';
    return JSON.parse(dado) as { tipo: string; job_tipo: string; detalhe: Record<string, unknown> };
  });
}

test('conversa: pergunta vira job responder; o worker publica resposta citada e sugestão; o fio segue; SSE avisa', async () =>
  comBanco('j16_conversa', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const artefatos = await temporario('respostas');
    const trecho = ancora(m.versaoId, m.bloco(2), 'conceito de atenção');
    const criada = await escrever(api, 'POST', '/api/conversas', { ancora: trecho, pergunta: 'O que o autor entende por atenção?' });
    expect(criada.status).toBe(201);
    const { conversa, job_id } = await corpo<{ conversa: ConversaV2; job_id: Id }>(criada);
    expect(validarConversaV2(conversa)).toBe(true);
    expect(conversa.mensagens).toHaveLength(1);
    expect((await banco.query('SELECT tipo, estado FROM job WHERE id=$1', [job_id])).rows[0]).toEqual({ tipo: TIPO_RESPONDER, estado: 'fila' });
    const pendente = await corpo<{ pendentes: { mensagem_id: Id; job_id: Id }[] }>(await api.request(`/api/conversas/${conversa.id}`));
    expect(pendente.pendentes).toEqual([{ mensagem_id: conversa.mensagens[0]!.id, job_id, estado: 'fila' }]);

    const { responder, entradas } = contando(responderFalso());
    await rodarWorker(banco, responder, artefatos);
    expect(entradas).toHaveLength(1);
    // Núcleo: a âncora e os vizinhos no capítulo; contexto: o resto do capítulo; modo da camada padrão.
    expect(entradas[0]!.blocos_nucleo.map((bloco) => bloco.id)).toEqual([m.bloco(1).id, m.bloco(2).id, m.bloco(3).id]);
    expect(entradas[0]!.blocos_contexto.map((bloco) => bloco.id)).toEqual([m.bloco(0).id]);
    expect(entradas[0]!.modo.id).toBe('argumentativa');

    const fio = await corpo<{ conversa: ConversaV2; pendentes: unknown[] }>(await api.request(`/api/conversas/${conversa.id}`));
    expect(validarConversaV2(fio.conversa)).toBe(true);
    expect(fio.pendentes).toEqual([]);
    const [, resposta] = fio.conversa.mensagens;
    expect(resposta).toMatchObject({ autor: 'ia', citacoes: [trecho], execucao: { modelo: 'responder-falso', esforco: 'nenhum' } });
    expect(resposta?.autor === 'ia' ? resposta.contexto?.blocos : []).toEqual([m.bloco(1).id, m.bloco(2).id, m.bloco(3).id, m.bloco(0).id]);

    const snapshot = await capitulo(api, m);
    expect(snapshot.conversas).toEqual([expect.objectContaining({ id: conversa.id, ancora: trecho, mensagens: 2 })]);
    expect(snapshot.conversas[0]?.ultima?.autor).toBe('ia');
    const [sugestao] = snapshot.conexoes;
    expect(sugestao).toMatchObject({ autor: 'ia', estado: 'sugerida', conversa_id: conversa.id, relacao: 'desenvolve' });
    expect(sugestao && validarConexaoV2(sugestao)).toBe(true);
    const decidida = await corpo<{ conexao: ConexaoV2 }>(await escrever(api, 'POST', `/api/conexoes/${sugestao!.id}/decidir`, { estado: 'aceita' }));
    expect(decidida.conexao).toMatchObject({ estado: 'aceita', autor: 'ia' });
    expect((await escrever(api, 'POST', `/api/conexoes/${sugestao!.id}/decidir`, { estado: 'rejeitada' })).status).toBe(409);

    // Segunda pergunta no mesmo fio.
    const segunda = await escrever(api, 'POST', `/api/conversas/${conversa.id}/mensagens`, { pergunta: 'E como isso liga com a tese?' });
    expect(segunda.status).toBe(202);
    await rodarWorker(banco, responder, artefatos);
    const final = await corpo<{ conversa: ConversaV2 }>(await api.request(`/api/conversas/${conversa.id}`));
    expect(final.conversa.mensagens.map((mensagem) => mensagem.autor)).toEqual(['leitor', 'ia', 'leitor', 'ia']);
    expect(validarConversaV2(final.conversa)).toBe(true);
    // O modelo viu o fio até a pergunta que respondia.
    expect(entradas[1]!.conversa.mensagens.map((mensagem) => mensagem.autor)).toEqual(['leitor', 'ia', 'leitor']);

    // O SSE existente avisa: eventos do job `responder`, com o da resposta publicada.
    const eventos = (await lerEventos(api)).filter((evento) => evento.job_tipo === TIPO_RESPONDER);
    expect(eventos.filter((evento) => evento.tipo === 'resposta_publicada').map((evento) => evento.detalhe.conversa_id))
      .toEqual([conversa.id, conversa.id]);
    expect(eventos.filter((evento) => evento.tipo === 'publicado')).toHaveLength(2);

    // Recusas: âncora falsa, conversa inexistente, pergunta vazia, arquivada.
    expect((await escrever(api, 'POST', '/api/conversas', { ancora: { ...trecho, sufixo: 'x' }, pergunta: 'x' })).status).toBe(422);
    expect((await escrever(api, 'POST', `/api/conversas/${ulid()}/mensagens`, { pergunta: 'x' })).status).toBe(404);
    expect((await escrever(api, 'POST', `/api/conversas/${conversa.id}/mensagens`, { pergunta: ' ' })).status).toBe(422);
    expect((await api.request(`/api/conversas/${ulid()}`)).status).toBe(404);
    await banco.query("UPDATE conversa SET estado='arquivada' WHERE id=$1", [conversa.id]);
    expect((await escrever(api, 'POST', `/api/conversas/${conversa.id}/mensagens`, { pergunta: 'Ainda?' })).status).toBe(409);
  }));

test('responder: citação e sugestão que não conferem viram diagnóstico, nunca gravação silenciosa', async () =>
  comBanco('j16_diagnostico', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const trecho = ancora(m.versaoId, m.bloco(1), 'ler devagar');
    const { conversa, job_id } = await corpo<{ conversa: ConversaV2; job_id: Id }>(
      await escrever(api, 'POST', '/api/conversas', { ancora: trecho, pergunta: 'Por quê?' }));
    const torto: Responder = (entrada) => Promise.resolve({
      texto: 'Resposta com uma citação inventada.',
      citacoes: [entrada.conversa.ancora, { ...entrada.conversa.ancora, citacao: 'ler depressa' },
        ancora(m.versaoId, m.bloco(5), 'outro assunto')],
      sugestoes: [{ origem: entrada.conversa.ancora, destino: { tipo: 'trecho', ancora: entrada.conversa.ancora }, relacao: 'exemplo', justificativa: 'Ela mesma.' }],
      diagnosticos: [{ codigo: 'citacao_ambigua', mensagem: 'Apoio 2 aparece duas vezes.' }],
      modelo: 'torto', esforco: 'baixo',
    });
    await rodarWorker(banco, torto, await temporario('respostas'));
    const fio = await corpo<{ conversa: ConversaV2 }>(await api.request(`/api/conversas/${conversa.id}`));
    expect(fio.conversa.mensagens[1]).toMatchObject({ autor: 'ia', citacoes: [trecho] });
    expect((await banco.query('SELECT count(*)::int AS n FROM conexao')).rows[0]).toEqual({ n: 0 });
    const job = (await banco.query<{ estado: string; diagnosticos: { codigo: string }[] }>('SELECT estado, diagnosticos FROM job WHERE id=$1', [job_id])).rows[0];
    expect(job?.estado).toBe('ok');
    // A citação fora do contexto (outro capítulo) também é recusada.
    expect(job?.diagnosticos.map((item) => item.codigo).sort()).toEqual(['citacao_ambigua', 'citacao_recusada', 'citacao_recusada', 'sugestao_recusada']);
  }));

test('notas-sync: reenvios concorrentes criam uma nota; revisão impede sobrescrita e exclusão obsoletas', async () =>
  comBanco('notas_sync', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);
    const entrada = { ancora: ancora(m.versaoId, m.bloco(2), 'atenção'), tipo: 'nota', texto: 'Primeiro texto.', chave_cliente: ulid() };
    const respostas = await Promise.all([escrever(api, 'POST', '/api/anotacoes', entrada), escrever(api, 'POST', '/api/anotacoes', entrada)]);
    expect(respostas.map((r) => r.status).sort()).toEqual([200, 201]);
    const notas = await Promise.all(respostas.map((r) => corpo<{ anotacao: AnotacaoV1 }>(r)));
    expect(notas[0]!.anotacao).toEqual(notas[1]!.anotacao);
    const nota = notas[0]!.anotacao;
    expect(nota.revisao_edicao).toBe(1);
    expect((await banco.query('SELECT count(*)::int AS n FROM anotacao')).rows[0]).toEqual({ n: 1 });
    const caminho = `/api/anotacoes/${nota.id}`;
    for (const revisao of [undefined, 0, -1, 1.5, '1', 2147483648]) {
      expect((await escrever(api, 'PATCH', caminho, { texto: 'Inválido', revisao })).status).toBe(400);
      expect((await escrever(api, 'DELETE', caminho, { revisao })).status).toBe(400);
    }
    expect((await escrever(api, 'POST', '/api/anotacoes', { ...entrada, chave_cliente: 'x' })).status).toBe(400);
    const edicoes = await Promise.all(['Aparelho A', 'Aparelho B'].map((texto) => escrever(api, 'PATCH', caminho, { texto, revisao: 1 })));
    expect(edicoes.map((r) => r.status).sort()).toEqual([200, 409]);
    const vencedora = await corpo<{ anotacao: AnotacaoV1 }>(edicoes.find((r) => r.status === 200)!);
    const conflito = await corpo<{ anotacao: AnotacaoV1; revisao_atual: number }>(edicoes.find((r) => r.status === 409)!);
    expect(conflito.anotacao).toEqual(vencedora.anotacao);
    expect(conflito.revisao_atual).toBe(2);
    const exclusao = await escrever(api, 'DELETE', caminho, { revisao: 1 });
    expect(exclusao.status).toBe(409);
    expect((await corpo<{ anotacao: AnotacaoV1 }>(exclusao)).anotacao).toEqual(vencedora.anotacao);
    const reenvio = await escrever(api, 'POST', '/api/anotacoes', entrada);
    expect(reenvio.status).toBe(200);
    expect((await corpo<{ anotacao: AnotacaoV1 }>(reenvio)).anotacao).toEqual(vencedora.anotacao);
    expect((await capitulo(api, m)).anotacoes).toEqual([vencedora.anotacao]);
    expect((await escrever(api, 'DELETE', caminho, { revisao: 2 })).status).toBe(200);
    expect((await escrever(api, 'PATCH', caminho, { texto: 'Não ressuscita', revisao: 2 })).status).toBe(404);
  }));


test('notas-sync: migração preserva notas antigas e revisão textual do Codex', async () =>
  comBancoDeTeste('notas_migracao', async (banco) => {
    await migrar(banco, { ate: '0016_leitura_comentada.sql' });
    const m = await preparar(banco);
    const trecho = ancora(m.versaoId, m.bloco(2), 'atenção');
    const id = ulid();
    const revisao = { autor: 'codex', texto_anterior: 'Antes', motivo: 'Clareza', em: '2026-09-24T12:00:00.000Z' };
    await banco.query(`INSERT INTO anotacao (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,tipo,texto,criada_em,atualizada_em,revisao)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'nota','Depois','2026-09-24T12:00:00Z','2026-09-24T12:00:00Z',$9)`,
    [id, m.versaoId, trecho.bloco_id, trecho.inicio_utf16, trecho.fim_utf16, trecho.citacao, trecho.prefixo, trecho.sufixo, JSON.stringify(revisao)]);
    await migrar(banco);
    await migrar(banco);
    const notas = (await capitulo(montar(banco), m)).anotacoes;
    expect(notas).toHaveLength(1);
    expect(notas[0]).toMatchObject({ id, texto: 'Depois', revisao, revisao_edicao: 1 });
    expect(validarAnotacao(notas[0])).toBe(true);
  }));
