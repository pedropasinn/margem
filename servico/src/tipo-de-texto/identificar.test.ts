/**
 * Tipo de texto (v0.1, V-A2): detectado pelo Codex sem ação humana, nunca por cima da escolha da pessoa;
 * um "Preparar leitura" pedido antes do tipo espera por ele e começa sozinho na publicação.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import Ajv from 'ajv/dist/2020.js';
import { afterEach, expect, test } from 'vitest';
import { idsDosTipos, lerTiposDeTexto } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { livro, ROTEIRO } from '../../testes/compreensao.js';
import { comecarLeituraPedida, ESPERA_DO_TIPO_PADRAO_MS, seguirSemTipo } from '../compreensao/preparacao.js';
import { manipuladoresDaCompreensao } from '../compreensao/manipuladores.js';
import type { ConfiguracaoDaCompreensao } from '../compreensao/pipeline.js';
import { comTransacao } from '../db/transacao.js';
import { executorAuditado } from '../executor/auditoria.js';
import { criarExecutorFalso, type Roteiro } from '../executor/fake.js';
import { criarApi } from '../http/app.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import {
  amostrasDoTexto, aoPublicarVersao, gravarTipoDetectado, lerSaidaDoTipo, lerTipoDoDocumento, manipuladoresDoTipo, montarPromptDeTipo, tipoDeterministico,
} from './identificar.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
const pedir = (api: Hono, caminho: string, metodo = 'GET', dado?: unknown) =>
  Promise.resolve(api.request(caminho, { method: metodo, ...(metodo === 'GET' ? {} : { headers: ESCRITA }), ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));

const IDENTIFICACAO = (tipo: string) => ({ tipo_id: tipo, confianca: 'alta', justificativa: 'Argumenta a partir de uma hipótese.', alternativas: ['opiniao'] });

/** Identificação primeiro, depois as quatro chamadas da compreensão do capítulo um. */
function roteiroComTipo(tipo: string): Roteiro {
  return { versao: 1, passos: [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: IDENTIFICACAO(tipo) },
    ...ROTEIRO.passos.map((passo) => ({ ...passo, quando: { ordem: (passo.quando?.ordem ?? 0) + 1 } })),
  ] };
}

async function montar(banco: pg.Pool, roteiro: Roteiro) {
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-tipo-art-'));
  const auditoria = await mkdtemp(join(tmpdir(), 'margem-tipo-aud-'));
  const slots = await mkdtemp(join(tmpdir(), 'margem-tipo-slots-'));
  temporarios.push(artefatos, auditoria, slots);
  const falso = criarExecutorFalso(roteiro);
  const executor = executorAuditado((pedido) => falso({ ...pedido, diretorioArtefatos: artefatos }), { commit: () => 'teste' });
  const config: ConfiguracaoDaCompreensao = { banco, executor, modelo: 'modelo-de-teste', esforco: 'alto', esforcoDoPlano: 'medio', prazoMs: 10_000 };
  const manipuladores = {
    ...manipuladoresDaCompreensao(config),
    ...manipuladoresDoTipo({ banco, executor, modelo: 'modelo-de-teste', esforco: 'low', aoConhecerTipo: (cliente, id, pedido) => comecarLeituraPedida(config, cliente, id, pedido) }),
  };
  const rodar = async (vezes: number) => {
    for (let i = 0; i < vezes; i += 1) {
      await new Worker({ fila: new FilaPostgres(banco), manipuladores, auditoria, slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();
    }
  };
  return { config, rodar, api: criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config }) };
}

async function documentoDoLivro(banco: pg.Pool) {
  const canonico = livro();
  return comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: '/home/pessoa/textos/precos.md' });
    const versao = await documentos.criarVersao(cliente, criado.id, canonico);
    return { documento: criado, versao };
  });
}

test('o schema do prompt lista exatamente os tipos do contrato; a saída é conferida contra o catálogo', () => {
  const tipos = lerTiposDeTexto();
  const { prompt, schema } = montarPromptDeTipo({ titulo: 'Um apólogo', autor: 'Machado de Assis', formato: 'md', origem: 'apologo.md', canonico: livro() });
  const propriedades = (schema as { properties: { tipo_id: { enum: string[] }; alternativas: { items: { enum: string[] } } } }).properties;
  expect(propriedades.tipo_id.enum).toEqual(idsDosTipos(tipos));
  expect(propriedades.alternativas.items.enum).toEqual(idsDosTipos(tipos));
  expect(new Ajv({ strict: true }).compile(schema)(IDENTIFICACAO('conto'))).toBe(true);
  expect(prompt).not.toMatch(/\{\{[a-z_]+\}\}/u);
  for (const trecho of ['Machado de Assis', 'apologo.md', 'Capítulo dois', 'Admitamos inicialmente', '`conto` — Literatura · Conto', 'Estrofes']) expect(prompt).toContain(trecho);
  expect(lerSaidaDoTipo({ ...IDENTIFICACAO('conto'), alternativas: ['conto', 'romance'] })).toMatchObject({ tipo_id: 'conto', alternativas: ['romance'] });
  expect(() => lerSaidaDoTipo({ ...IDENTIFICACAO('conto'), tipo_id: 'inventado' })).toThrow();
  expect(() => lerSaidaDoTipo({ ...IDENTIFICACAO('conto'), extra: 1 })).toThrow();
  expect(() => lerSaidaDoTipo({ ...IDENTIFICACAO('conto'), alternativas: ['a', 'b', 'c'] })).toThrow();
  expect(amostrasDoTexto(livro()).map((amostra) => amostra.rotulo)).toEqual(['Começo do texto', 'Começo do capítulo 2', 'Meio do texto']);
  const email = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'De: Ana\nPara: Bruno\nAssunto: prazo' }, { tipo: 'paragrafo', texto: 'Oi, Bruno.' }] });
  expect(tipoDeterministico(email)).toBe('email');
  expect(tipoDeterministico(livro())).toBeNull();
});

test('depois da canonização o tipo é detectado sem ação humana; a escolha da pessoa nunca é sobrescrita', async () => comBanco('tipo_detectado', async (banco) => {
  const { documento, versao } = await documentoDoLivro(banco);
  const { rodar, api } = await montar(banco, roteiroComTipo('economia_teorica'));
  // Sem preparar sozinho ao importar (o padrão é preparar; ver o teste do padrão abaixo).
  expect((await pedir(api, '/api/configuracoes/preparacao', 'PUT', { ao_importar: false, itens: ['grifos_relacoes'] })).status).toBe(200);
  // O que a canonização faz ao publicar a versão: o job leve de identificação.
  const job = await comTransacao(banco, (cliente) => aoPublicarVersao(cliente, documento.id, versao.id, versao.canonico));
  expect(job).toMatchObject({ tipo: 'identificar_tipo', prioridade: 50 });
  await rodar(1);
  const detectado = await comTransacao(banco, (cliente) => lerTipoDoDocumento(cliente, documento.id));
  expect(detectado).toMatchObject({ tipo_id: 'economia_teorica', origem: 'detectado', confianca: 'alta', alternativas: ['opiniao'], job_id: job?.id });
  const situacao = await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { tipo: unknown; estado: string };
  expect(situacao).toMatchObject({ estado: 'nao_preparada', tipo: { tipo_id: 'economia_teorica', rotulo: 'Teoria e modelo formal', grupo: 'Economia', origem: 'detectado' } });
  // Documento com tipo não pede outra identificação.
  expect(await comTransacao(banco, (cliente) => aoPublicarVersao(cliente, documento.id, versao.id, versao.canonico))).toBeNull();

  // A pessoa muda o tipo: grava "escolhido"; uma nova detecção não o substitui.
  expect((await pedir(api, `/api/documentos/${documento.id}/tipo-de-texto`, 'PUT', { tipo_id: 'inventado' })).status).toBe(422);
  expect((await pedir(api, `/api/documentos/${documento.id}/tipo-de-texto`, 'PUT', { tipo: 'conto' })).status).toBe(400);
  expect((await pedir(api, `/api/documentos/${documento.id}/tipo-de-texto`, 'PUT', { tipo_id: 'conto' })).status).toBe(200);
  await banco.query(`UPDATE job SET estado='fila', attempt=attempt+1 WHERE tipo='identificar_tipo'`);
  const { rodar: rodarDeNovo } = await montar(banco, roteiroComTipo('poesia'));
  await rodarDeNovo(1);
  expect(await comTransacao(banco, (cliente) => lerTipoDoDocumento(cliente, documento.id))).toMatchObject({ tipo_id: 'conto', origem: 'escolhido' });
  const { tipos } = await (await pedir(api, '/api/tipos-de-texto')).json() as { tipos: { grupos: unknown[] } };
  expect(tipos.grupos.length).toBeGreaterThanOrEqual(12);
}));

test('"Preparar leitura" antes do tipo espera a identificação e começa sozinho com o modo detectado', async () => comBanco('tipo_espera', async (banco) => {
  const { documento } = await documentoDoLivro(banco);
  const { rodar, api } = await montar(banco, roteiroComTipo('outro'));
  const pedido = await pedir(api, `/api/documentos/${documento.id}/preparacao`, 'POST');
  expect(pedido.status).toBe(202);
  expect(await pedido.json()).toMatchObject({ aguardando_tipo: true, compreensao_id: null, situacao: { estado: 'identificando', tipo: null } });
  // Alguém espera: a identificação sobe para a prioridade do capítulo aberto, e nenhuma leitura começa antes dela.
  expect((await banco.query<{ tipo: string; prioridade: number }>('SELECT tipo, prioridade FROM job')).rows).toEqual([{ tipo: 'identificar_tipo', prioridade: 100 }]);
  // Clicar de novo enquanto espera não cria nada.
  expect((await pedir(api, `/api/documentos/${documento.id}/preparacao`, 'POST')).status).toBe(202);
  expect(Number((await banco.query<{ n: string }>('SELECT count(*) AS n FROM job')).rows[0]?.n)).toBe(1);

  await rodar(1);
  const comecou = await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { estado: string; compreensao: { modo: { id: string } } | null; tipo: { tipo_id: string } };
  expect(comecou).toMatchObject({ estado: 'preparando', tipo: { tipo_id: 'outro' } });
  expect((await banco.query<{ preparacao_pedida: unknown }>('SELECT preparacao_pedida FROM documento')).rows[0]?.preparacao_pedida).toBeNull();
  await rodar(4);
  const pronta = await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { capitulos: { estado: string; relacoes: number | null }[] };
  expect(pronta.capitulos[0]).toMatchObject({ estado: 'pronto' });
  expect(pronta.capitulos[0]?.relacoes).toBeGreaterThanOrEqual(1);
}));

test('se a identificação falha, a leitura segue sozinha com o tipo padrão (sem esperar um clique)', async () => comBanco('tipo_falha', async (banco) => {
  const { documento } = await documentoDoLivro(banco);
  const { rodar, api } = await montar(banco, { versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'processo' }, ...ROTEIRO.passos.map((passo) => ({ ...passo, quando: { ordem: (passo.quando?.ordem ?? 0) + 1 } }))] });
  expect((await pedir(api, `/api/documentos/${documento.id}/preparacao`, 'POST')).status).toBe(202);
  await rodar(1);
  const seguiu = await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { estado: string; tipo: unknown; compreensao: { modo: { id: string } } | null };
  expect(seguiu).toMatchObject({ estado: 'preparando', tipo: null });
  expect(seguiu.compreensao).not.toBeNull();
  expect((await banco.query<{ preparacao_pedida: unknown }>('SELECT preparacao_pedida FROM documento')).rows[0]?.preparacao_pedida).toBeNull();
  // Clicar de novo não cria outra leitura.
  expect((await pedir(api, `/api/documentos/${documento.id}/preparacao`, 'POST')).status).toBe(200);
}));

test('identificação presa além do prazo: é cancelada e a leitura começa com o tipo padrão; um tipo que chega depois não a esconde', async () => comBanco('tipo_prazo', async (banco) => {
  const { documento } = await documentoDoLivro(banco);
  const { config, api } = await montar(banco, roteiroComTipo('outro'));
  expect((await pedir(api, `/api/documentos/${documento.id}/preparacao`, 'POST')).status).toBe(202);
  // Dentro do prazo, nada muda: a identificação continua na fila.
  expect(await comTransacao(banco, (cliente) => seguirSemTipo(config, cliente))).toEqual([]);
  expect((await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { estado: string }).estado).toBe('identificando');
  // Passado o prazo (o worker confere de tempos em tempos), a leitura segue.
  const depois = new Date(Date.now() + ESPERA_DO_TIPO_PADRAO_MS + 1_000);
  expect(await comTransacao(banco, (cliente) => seguirSemTipo(config, cliente, { agora: depois }))).toEqual([documento.id]);
  expect((await banco.query<{ tipo: string; estado: string }>('SELECT tipo, estado FROM job WHERE tipo=$1', ['identificar_tipo'])).rows).toEqual([{ tipo: 'identificar_tipo', estado: 'cancelado' }]);
  const seguiu = await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { estado: string; compreensao: { id: string } | null };
  expect(seguiu.estado).toBe('preparando');
  // Um tipo detectado depois (a identificação que já publicava) não esconde a leitura que começou.
  await comTransacao(banco, (cliente) => gravarTipoDetectado(cliente, documento.id, { tipo_id: 'conto', confianca: 'alta', justificativa: 'tarde', alternativas: [], job_id: null, em: new Date().toISOString() }));
  const comTipo = await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { estado: string; compreensao: { id: string } | null };
  expect(comTipo.compreensao?.id).toBe(seguiu.compreensao?.id);
  expect(comTipo.estado).toBe('preparando');
}));

test('padrão das Configurações: ao importar, a identificação começa a leitura com os itens marcados; mapa e flashcards por capítulo pronto', async () => comBanco('tipo_padrao', async (banco) => {
  const { documento, versao } = await documentoDoLivro(banco);
  const { rodar, api } = await montar(banco, roteiroComTipo('outro'));
  const catalogo = await (await pedir(api, '/api/preparacao/itens')).json() as { itens: { id: string; disponivel: boolean }[]; padrao: { ao_importar: boolean; itens: string[] } };
  expect(catalogo.padrao).toEqual({ ao_importar: true, itens: ['grifos_relacoes'] });
  expect(catalogo.itens.filter((item) => !item.disponivel).map((item) => item.id)).toEqual(['narracao', 'marcadores', 'imagens']);
  expect((await pedir(api, '/api/configuracoes/preparacao', 'PUT', { ao_importar: true, itens: ['exercicios'] })).status).toBe(422);
  // Mapa requer grifos e relações: entra sozinho.
  const gravado = await (await pedir(api, '/api/configuracoes/preparacao', 'PUT', { ao_importar: true, itens: ['mapa', 'flashcards'] })).json() as { padrao: { itens: string[] } };
  expect(gravado.padrao.itens).toEqual(['grifos_relacoes', 'flashcards', 'mapa']);
  await comTransacao(banco, (cliente) => aoPublicarVersao(cliente, documento.id, versao.id, versao.canonico));
  expect((await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { estado: string }).estado).toBe('identificando');
  await rodar(5);
  const situacao = await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { capitulos: { estado: string }[]; itens: { id: string; estado: string }[] };
  expect(situacao.capitulos[0]?.estado).toBe('pronto');
  // O capítulo um ficou pronto: flashcards e mapa dele foram pedidos (e esperam o worker).
  expect(situacao.itens).toEqual([
    expect.objectContaining({ id: 'flashcards', estado: 'preparando', total: 1 }),
    expect.objectContaining({ id: 'mapa', estado: 'preparando', total: 1 }),
  ]);
  expect((await pedir(api, `/api/documentos/${documento.id}/preparacao`, 'POST', { itens: ['narracao'] })).status).toBe(422);
}));
