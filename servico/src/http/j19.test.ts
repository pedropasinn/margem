/**
 * J19: leitura por modo pela rota, ingestão com `poesia=1` e a execução V2 de ponta a
 * ponta com o worker e o executor falso. Nenhuma chamada ao Codex.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterEach, expect, test } from 'vitest';
import type { CanonicoV1, Id, MarcaGeradaV2, MarcaV2 } from '@margem/contratos';
import { validarExecucaoLeituraV2, validarMarcaV2 } from '@margem/contratos';
import {
  caminhoDoSchemaDoLeitor, canonicoDeTeste, comBanco, contadorDeIds, textosDaRevisao, textosDoPrompt, VERSOES,
} from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso, type Roteiro } from '../executor/fake.js';
import type { Executor, PedidoExecucao } from '../executor/tipos.js';
import type { ConfiguracaoDaLeitura } from '../leitura/manipuladores.js';
import * as documentos from '../repos/documentos.js';
import * as execucoesRepo from '../repos/execucoes.js';
import * as marcasRepo from '../repos/marcas.js';
import { raizDoRepositorio } from '../dados.js';
import { manipuladorCanonizar, TIPO_CANONIZAR } from '../worker/canonizar.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { manipuladoresDaLeitura } from '../worker/manipuladores-leitura.js';
import { Worker } from '../worker/worker.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
const dadosOriginais = process.env.MARGEM_DADOS;
afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
  if (dadosOriginais === undefined) delete process.env.MARGEM_DADOS;
  else process.env.MARGEM_DADOS = dadosOriginais;
});
async function temporario(nome: string): Promise<string> {
  const diretorio = await mkdtemp(join(tmpdir(), `margem-j19-${nome}-`));
  temporarios.push(diretorio);
  return diretorio;
}

const ESCRITA = { 'X-Margem': '1' };
const JSON_ESCRITA = { ...ESCRITA, 'Content-Type': 'application/json' };

interface Capturado { pedido: PedidoExecucao; schema: unknown; entrada: string[] }

/** Executor falso que também guarda o pedido e o schema montado (o temporário some depois). */
function capturando(roteiro: Roteiro): { executor: Executor; pedidos: Capturado[] } {
  const base = criarExecutorFalso(roteiro);
  const pedidos: Capturado[] = [];
  const executor: Executor = async (pedido) => {
    const { readdir } = await import('node:fs/promises');
    pedidos.push({ pedido, schema: JSON.parse(await readFile(pedido.schema, 'utf8')) as unknown, entrada: await readdir(pedido.diretorioEntrada) });
    return base(pedido);
  };
  return { executor, pedidos };
}

async function configurar(banco: pg.Pool, executor: Executor): Promise<ConfiguracaoDaLeitura> {
  return {
    banco, executor, versoes: VERSOES, textos: textosDoPrompt(), caminhoSchemaLeitor: caminhoDoSchemaDoLeitor(),
    revisao: textosDaRevisao(), modelo: 'modelo-pedido', esforco: 'alto',
    diretorioArtefatos: await temporario('artefatos'), prazoMs: 10_000, novoId: contadorDeIds('M'),
    agora: () => new Date('2026-09-24T12:00:00.000Z'),
  };
}

async function rodarWorker(banco: pg.Pool, config: ConfiguracaoDaLeitura, ciclos = 3): Promise<void> {
  const worker = new Worker({
    fila: new FilaPostgres(banco),
    manipuladores: {
      [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }),
      ...manipuladoresDaLeitura(config),
    },
    diretorioSlots: await temporario('vagas'), slots: 1, intervaloMs: 5, maximoCiclos: ciclos,
  });
  await worker.rodar();
}

/** Soneto de teste: título, duas estrofes e um parágrafo de prosa. */
function poema(): CanonicoV1 {
  return canonicoDeTeste({
    titulo: 'Poema de teste',
    blocos: [
      { tipo: 'capitulo', texto: 'Círculo' },
      { tipo: 'estrofe', texto: 'Bailando no ar, gemia inquieto vaga-lume:\nQuem me dera que fosse aquela loura estrela' },
      { tipo: 'estrofe', texto: 'Mas o sol, inclinando a rútila capela:\nPor que não nasci eu um simples vaga-lume?' },
      { tipo: 'paragrafo', texto: 'Nota do editor.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 3 }],
  });
}

async function gravar(banco: pg.Pool, canonico: CanonicoV1): Promise<documentos.VersaoTexto> {
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'poema.md' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
}

function marca(bloco: Id, citacao: string, funcao: string, saliencia: 1 | 2 | 3, extra: Partial<MarcaGeradaV2> = {}): MarcaGeradaV2 {
  return { bloco_id: bloco, citacao, prefixo: '', sufixo: '', funcao, saliencia, sublinhar: [], comentario: null, ...extra };
}

test('leitura em modo literário: execução V2, prompt @3 com o schema do modo, MarcaV2 na camada, sem revisão V1', async () =>
  comBanco('j19_modo', async (banco) => {
    const canonico = poema();
    const [, e1, e2, prosa] = canonico.blocos;
    if (!e1 || !e2 || !prosa) throw new Error('poema incompleto');
    const { executor, pedidos } = capturando({
      versao: 1,
      passos: [{
        tipo: 'ok', modelo: 'gpt-6-astra', esforco: 'high',
        conteudo: {
          marcas: [
            marca(e2.id, 'Por que não nasci eu um simples vaga-lume?', 'virada', 1, {
              comentario: { tipo: 'LEITURA', rotulo: '→ LEITURA', texto: 'O sol deseja o lugar do primeiro.' },
            }),
            // Atravessa o verso: a citação carrega o `\n`.
            marca(e1.id, 'vaga-lume:\nQuem me dera', 'imagem', 2),
            marca(e1.id, 'estrela que não existe', 'imagem', 2),
            marca(prosa.id, 'Nota do editor.', 'voz', 2),
          ],
          resumo_da_parte: 'Soneto circular.',
          limites: [],
          leitura_integral: true,
        },
      }],
    });
    const config = await configurar(banco, executor);
    const api = criarApi({ banco, leitura: () => config, intervaloEventosMs: 20 });
    const versao = await gravar(banco, canonico);

    const resposta = await api.request(`/api/documentos/${versao.documento_id}/leituras`, {
      method: 'POST', headers: JSON_ESCRITA,
      body: JSON.stringify({ modo_de_leitura: { id: 'literaria', revisao: 1 }, nivel_de_atencao: 2, config: { modo: 'capitulos' } }),
    });
    expect(resposta.status).toBe(202);
    const corpo = await resposta.json() as {
      execucao_id: Id; schema_versao: number; modo_de_leitura: unknown; nivel_de_atencao: number;
      jobs: { tipo: string }[]; diagnosticos: { codigo: string }[];
    };
    expect(corpo).toMatchObject({ schema_versao: 2, modo_de_leitura: { id: 'literaria', revisao: 1 }, nivel_de_atencao: 2 });
    // Só as partes: a revisão V1 não é enfileirada sobre V2, e isso vem dito.
    expect(corpo.jobs.map((job) => job.tipo)).toEqual(['ler_parte']);
    expect(corpo.diagnosticos.map((item) => item.codigo)).toEqual(['revisao_v2_indisponivel']);

    const antes = await comTransacao(banco, (cliente) => execucoesRepo.obterV2(cliente, corpo.execucao_id));
    expect(antes && validarExecucaoLeituraV2(antes)).toBe(true);
    expect(antes).toMatchObject({
      schema_versao: 2, prompt_versao: 'leitor-de-parte@4', metodo_versao: 'modo:literaria@1',
      modo: { id: 'literaria', revisao: 1 }, nivel_de_atencao_alvo: 2, executor: { modelo: 'modelo-pedido', esforco: 'alto' },
    });

    await rodarWorker(banco, config);

    // O executor recebeu o prompt @2 do modo literário, com o texto dentro, e o schema especializado.
    expect(pedidos).toHaveLength(1);
    const { pedido, schema, entrada } = pedidos[0]!;
    expect(pedido.prompt).toContain('literaria@1');
    expect(pedido.prompt).toContain(`⟦b:${e1.id}⟧ [estrofe]\nBailando no ar`);
    expect(pedido.prompt).toContain(`⟦b:${canonico.blocos[0]!.id}⟧ [contexto · capitulo]`);
    expect(entrada).toEqual([]);
    const propriedades = (schema as { properties: { marcas: { items: { properties: Record<string, { enum?: unknown[] }> } } } })
      .properties.marcas.items.properties;
    expect(propriedades.bloco_id?.enum).toEqual([e1.id, e2.id, prosa.id]);
    expect(propriedades.saliencia?.enum).toEqual([1, 2]);
    expect(propriedades.funcao?.enum).toContain('imagem');
    expect(propriedades.funcao?.enum).not.toContain('tese');

    // Publicou MarcaV2 na camada da execução; a citação que não existe virou diagnóstico.
    const marcas: MarcaV2[] = await comTransacao(banco, (cliente) => marcasRepo.listarV2PorVersao(cliente, versao.id));
    expect(marcas).toHaveLength(3);
    for (const item of marcas) {
      expect(validarMarcaV2(item)).toBe(true);
      expect(item).toMatchObject({ camada_id: corpo.execucao_id, execucao_id: corpo.execucao_id, modo: { id: 'literaria', revisao: 1 } });
    }
    expect(marcas.map((item) => [item.funcao, item.saliencia, item.ancora.citacao]).sort()).toEqual([
      ['imagem', 2, 'vaga-lume:\nQuem me dera'],
      ['virada', 1, 'Por que não nasci eu um simples vaga-lume?'],
      ['voz', 2, 'Nota do editor.'],
    ]);
    const job = (await banco.query<{ estado: string; diagnosticos: { codigo: string; nivel: string }[] }>(
      "SELECT estado, diagnosticos FROM job WHERE tipo='ler_parte'")).rows[0];
    expect(job?.estado).toBe('ok');
    // O executor declarou `high` para um pedido `alto`: a divergência do pedido fica registrada.
    expect(job?.diagnosticos.map((item) => item.codigo)).toEqual(['citacao_ausente', 'proveniencia_divergente', 'revisao_v2_indisponivel']);
    expect(await banco.query("SELECT 1 FROM job WHERE tipo='revisar_consistencia'").then((r) => r.rowCount)).toBe(0);

    // Proveniência: quem executou.
    const depois = await comTransacao(banco, (cliente) => execucoesRepo.obterV2(cliente, corpo.execucao_id));
    expect(depois?.executor).toEqual({ modelo: 'gpt-6-astra', esforco: 'high' });
    const parte = (await banco.query<{ estado: string; resumo_da_parte: string }>('SELECT estado, resumo_da_parte FROM parte')).rows[0];
    expect(parte).toEqual({ estado: 'ok', resumo_da_parte: 'Soneto circular.' });

    // O detalhe do documento mostra o modo e o nível.
    const detalhe = await (await api.request(`/api/documentos/${versao.documento_id}`)).json() as {
      execucoes: { schema_versao: number; modo: unknown; nivel_de_atencao_alvo: number; modelo: string }[];
    };
    expect(detalhe.execucoes[0]).toMatchObject({
      schema_versao: 2, modo: { id: 'literaria', revisao: 1 }, nivel_de_atencao_alvo: 2, modelo: 'gpt-6-astra',
    });
    // O snapshot do capítulo serve a camada nova.
    const snapshot = await (await api.request(`/api/versoes/${versao.id}/capitulos/${canonico.secoes[0]!.id}`)).json() as {
      camada: Id; marcas: MarcaV2[];
    };
    expect(snapshot.camada).toBe(corpo.execucao_id);
    expect(snapshot.marcas).toHaveLength(3);
  }));

test('rota de leitura: padrões, modo inexistente, nível e forma inválidos; sem os campos novos, F1 igual', async () =>
  comBanco('j19_rota', async (banco) => {
    const config = await configurar(banco, criarExecutorFalso({ versao: 1, passos: [] }));
    const api = criarApi({ banco, leitura: () => config, intervaloEventosMs: 20 });
    const versao = await gravar(banco, poema());
    const ler = (corpo: unknown) => api.request(`/api/documentos/${versao.documento_id}/leituras`, {
      method: 'POST', headers: JSON_ESCRITA, body: JSON.stringify(corpo),
    });

    const inexistente = await ler({ modo_de_leitura: { id: 'astrologica', revisao: 1 } });
    expect(inexistente.status).toBe(400);
    expect(await inexistente.json()).toMatchObject({ erro: 'modo_inexistente' });
    const revisaoFutura = await ler({ modo_de_leitura: { id: 'literaria', revisao: 9 } });
    expect(await revisaoFutura.json()).toMatchObject({ erro: 'modo_inexistente' });
    for (const ruim of [{ modo_de_leitura: 'literaria' }, { modo_de_leitura: { id: 'literaria' } }, { modo_de_leitura: { id: 'literaria', revisao: 1, x: 1 } }]) {
      const resposta = await ler(ruim);
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toMatchObject({ erro: 'modo_invalido' });
    }
    for (const nivel of [0, 4, '2', 1.5]) {
      const resposta = await ler({ nivel_de_atencao: nivel });
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toMatchObject({ erro: 'nivel_invalido' });
    }
    expect(await banco.query('SELECT 1 FROM execucao_leitura').then((r) => r.rowCount)).toBe(0);

    // Só o nível: modo padrão argumentativa@1. `config.modo` continua sendo o particionamento.
    const soNivel = await ler({ nivel_de_atencao: 3, config: { modo: 'sequencial' } });
    expect(soNivel.status).toBe(202);
    expect(await soNivel.json()).toMatchObject({ schema_versao: 2, modo_de_leitura: { id: 'argumentativa', revisao: 1 }, nivel_de_atencao: 3 });

    // Sem os campos novos: a execução de F1, com a revisão enfileirada, como antes.
    const f1 = await ler({ config: { modo: 'capitulos' } });
    expect(f1.status).toBe(202);
    const corpoF1 = await f1.json() as { execucao_id: Id; jobs: { tipo: string }[]; schema_versao?: number };
    expect(corpoF1.schema_versao).toBeUndefined();
    expect(corpoF1.jobs.map((job) => job.tipo)).toContain('revisar_consistencia');
    const linha = (await banco.query<{ schema_versao: number; prompt_versao: string; modo_id: string }>(
      'SELECT schema_versao, prompt_versao, modo_id FROM execucao_leitura WHERE id=$1', [corpoF1.execucao_id])).rows[0];
    expect(linha).toEqual({ schema_versao: 1, prompt_versao: 'leitor-de-parte@1', modo_id: 'argumentativa' });
    expect(await comTransacao(banco, (cliente) => execucoesRepo.obterV2(cliente, corpoF1.execucao_id))).toBeNull();
  }));

function formulario(campos: Record<string, string>, arquivo?: { nome: string; conteudo: string; tipo: string }): FormData {
  const dados = new FormData();
  for (const [chave, valor] of Object.entries(campos)) dados.set(chave, valor);
  if (arquivo) dados.set('arquivo', new File([arquivo.conteudo], arquivo.nome, { type: arquivo.tipo }));
  return dados;
}

test('ingestão com poesia=1: o motor recebe --poesia (md, txt, colado); pdf e valor estranho são recusados', async () =>
  comBanco('j19_poesia', async (banco) => {
    process.env.MARGEM_DADOS = await temporario('dados');
    const config = await configurar(banco, criarExecutorFalso({ versao: 1, passos: [] }));
    const api = criarApi({ banco, leitura: () => config, intervaloEventosMs: 20 });
    // Sem frontmatter e sem quebra dura: só o `--poesia` faz disto estrofes.
    const versos = 'Primeiro verso da estrofe\nsegundo verso da estrofe\n\nterceiro verso\nquarto verso\n';
    const enviar = (campos: Record<string, string>, arquivo?: { nome: string; conteudo: string; tipo: string }) =>
      api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario(campos, arquivo) });

    const comPoesia = await enviar({ titulo: 'Versos', formato: 'colado', texto: versos, poesia: '1' });
    expect(comPoesia.status).toBe(202);
    const ids = await comPoesia.json() as { documento_id: Id; poesia?: boolean };
    expect(ids.poesia).toBe(true);
    const semPoesia = await enviar({ titulo: 'Prosa', formato: 'txt' }, { nome: 'v.txt', conteudo: versos, tipo: 'text/plain' });
    const idsProsa = await semPoesia.json() as { documento_id: Id; poesia?: boolean };
    expect(idsProsa.poesia).toBeUndefined();
    const md = await readFile(join(raizDoRepositorio(), 'fixtures/poesia/circulo-vicioso.md'), 'utf8');
    const soneto = await enviar({ titulo: 'Círculo vicioso', formato: 'md', poesia: '1' }, { nome: 'c.md', conteudo: md, tipo: 'text/markdown' });
    const idsSoneto = await soneto.json() as { documento_id: Id };

    const pdf = await enviar({ titulo: 'x', formato: 'pdf', poesia: '1' }, { nome: 'x.pdf', conteudo: '%PDF-1.4', tipo: 'application/pdf' });
    expect(pdf.status).toBe(400);
    expect(await pdf.json()).toMatchObject({ erro: 'poesia_so_texto' });
    const estranho = await enviar({ titulo: 'x', formato: 'colado', texto: 'a', poesia: 'sim' });
    expect(estranho.status).toBe(400);
    expect(await estranho.json()).toMatchObject({ erro: 'poesia_invalida' });
    expect(await banco.query('SELECT 1 FROM documento').then((r) => r.rowCount)).toBe(3);
    const flags = (await banco.query<{ id: Id; poesia: boolean }>('SELECT id, poesia FROM documento')).rows;
    expect(Object.fromEntries(flags.map((linha) => [linha.id, linha.poesia]))).toEqual({
      [ids.documento_id]: true, [idsProsa.documento_id]: false, [idsSoneto.documento_id]: true,
    });

    await rodarWorker(banco, config, 4);
    const tipos = async (documentoId: Id): Promise<{ tipos: string[]; poesia: unknown; versos: number }> => {
      const linha = (await banco.query<{ canonico: CanonicoV1 }>(
        'SELECT canonico FROM versao_texto WHERE documento_id=$1', [documentoId])).rows[0];
      if (!linha) throw new Error('sem versão');
      const estrofes = linha.canonico.blocos.filter((bloco) => bloco.tipo === 'estrofe');
      return {
        // O motor abre com o título do documento (`--titulo`) como capítulo.
        tipos: linha.canonico.blocos.map((bloco) => bloco.tipo).filter((tipo) => tipo !== 'capitulo'),
        poesia: linha.canonico.canonizacao.config?.poesia,
        versos: estrofes.reduce((total, bloco) => total + bloco.texto.split('\n').length, 0),
      };
    };
    expect(await tipos(ids.documento_id)).toMatchObject({ tipos: ['estrofe', 'estrofe'], poesia: true, versos: 4 });
    expect((await tipos(idsProsa.documento_id)).tipos).toEqual(['paragrafo', 'paragrafo']);
    const circulo = await tipos(idsSoneto.documento_id);
    expect(circulo.tipos.filter((tipo) => tipo === 'estrofe')).toHaveLength(4);
    expect(circulo.versos).toBe(14);
  }), 120_000);
