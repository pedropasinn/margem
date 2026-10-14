/**
 * Escolha de modelo e esforço por categoria (V-T10), sem banco: a tabela de categorias cobre todo
 * tipo do worker, o executor recebe o modelo e o esforço da categoria do job em curso, a preferência
 * inválida cai no padrão e o modelo recusado nomeia o modelo.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { describe, expect, test } from 'vitest';
import { comJob } from '../executor/contexto-do-job.js';
import { CAUSA_MODELO_INDISPONIVEL, causaDoStderr } from '../executor/stderr.js';
import type { Executor, PedidoExecucao, ResultadoExecutor } from '../executor/tipos.js';
import { todosOsManipuladores } from '../worker/main.js';
import { CATEGORIAS, TIPOS_SEM_CODEX, categoriaDoTipo, padraoDaCategoria } from './categorias.js';
import { buscarCatalogo, lerCatalogoDoCodex } from './catalogo.js';
import { executorComModelos } from './executor.js';
import { normalizarEscolhas, type EscolhasDeModelo } from './preferencias.js';

function gravador(resultado?: ResultadoExecutor): { executor: Executor; pedidos: PedidoExecucao[] } {
  const pedidos: PedidoExecucao[] = [];
  return {
    pedidos,
    executor: (pedido) => {
      pedidos.push(pedido);
      return Promise.resolve(resultado ?? { estado: 'ok', artefato: '/tmp/x.json', sha256: 'a', duracao_ms: 1, modelo: pedido.modelo ?? 'conta', ...(pedido.esforco === undefined ? {} : { esforco: pedido.esforco }) });
    },
  };
}

const PEDIDO: PedidoExecucao = { diretorioEntrada: '/tmp/entrada', prompt: 'p', schema: '/tmp/s.json', prazoMs: 1000, modelo: 'modelo-do-margem', esforco: 'high' };

describe('categorias', () => {
  test('todo tipo de job do worker tem categoria ou está entre os que não chamam o Codex', () => {
    const ambiente = { MARGEM_RECURSOS: 'noticias,arte', MARGEM_MODELO: 'conta' };
    const tipos = Object.keys(todosOsManipuladores({} as pg.Pool, gravador().executor, ambiente));
    const soltos = tipos.filter((tipo) => categoriaDoTipo(tipo) === undefined && !TIPOS_SEM_CODEX.includes(tipo));
    expect(soltos).toEqual([]);
    // E nenhum tipo em duas categorias.
    const todos = CATEGORIAS.flatMap((categoria) => categoria.grupos.flatMap((grupo) => grupo.tipos));
    expect(new Set(todos).size).toBe(todos.length);
  });

  test('o padrão de cada categoria em uma linha, com as exceções de esforço', () => {
    const ambiente = { MARGEM_MODELO: 'conta' };
    const texto = (id: string) => padraoDaCategoria(CATEGORIAS.find((categoria) => categoria.id === id)!, ambiente).texto;
    expect(texto('analise')).toBe('o modelo padrão da sua conta, esforço alto (o plano do capítulo: médio)');
    expect(texto('flashcards')).toBe('o modelo padrão da sua conta, esforço baixo');
    expect(texto('tipo_de_texto')).toBe('o modelo padrão da sua conta, esforço baixo');
    expect(texto('visuais')).toBe('o modelo padrão da sua conta, esforço médio');
    expect(texto('exercicios')).toBe('o modelo padrão da sua conta, esforço alto (explicações: médio)');
    // Um modelo fixado no serviço aparece pelo nome; os quadros usam sempre o da conta.
    const fixo = { MARGEM_MODELO: 'gpt-5.6-sol', MARGEM_ESFORCO_FLASHCARDS: 'medium' };
    expect(padraoDaCategoria(CATEGORIAS.find((c) => c.id === 'flashcards')!, fixo)).toEqual({ modelo: 'gpt-5.6-sol', esforco: 'medium', texto: 'gpt-5.6-sol, esforço médio' });
    expect(padraoDaCategoria(CATEGORIAS.find((c) => c.id === 'quadros')!, fixo).modelo).toBeNull();
  });
});

describe('executor com a escolha por categoria', () => {
  const escolhas: EscolhasDeModelo = {
    flashcards: { modelo: 'gpt-6-luna', esforco: 'medium' },
    visuais: { modelo: null, esforco: 'low' },
    analise: { modelo: 'gpt-6-astra', esforco: null },
  };

  test('cada categoria recebe o modelo e o esforço escolhidos; o que não foi escolhido fica com o padrão', async () => {
    const { executor, pedidos } = gravador();
    const comModelos = executorComModelos(executor, () => Promise.resolve(escolhas));
    await comJob({ id: 'j1', tipo: 'gerar_flashcards' }, () => comModelos(PEDIDO));
    await comJob({ id: 'j2', tipo: 'gerar_diagrama' }, () => comModelos(PEDIDO));
    await comJob({ id: 'j3', tipo: 'planejar_leitura' }, () => comModelos({ ...PEDIDO, esforco: 'medium' }));
    await comJob({ id: 'j4', tipo: 'resolver_exercicio' }, () => comModelos(PEDIDO));
    expect(pedidos.map((p) => [p.modelo, p.esforco, p.preferencia ?? null])).toEqual([
      ['gpt-6-luna', 'medium', { categoria: 'flashcards', modelo: 'gpt-6-luna', esforco: 'medium' }],
      ['modelo-do-margem', 'low', { categoria: 'visuais', modelo: null, esforco: 'low' }],
      // Só o modelo foi escolhido: o plano mantém o esforço próprio dele.
      ['gpt-6-astra', 'medium', { categoria: 'analise', modelo: 'gpt-6-astra', esforco: null }],
      ['modelo-do-margem', 'high', null],
    ]);
  });

  test('fora de um job, com tipo sem categoria ou sem conseguir ler as preferências, o pedido passa intacto', async () => {
    const { executor, pedidos } = gravador();
    await executorComModelos(executor, () => Promise.resolve(escolhas))(PEDIDO);
    await comJob({ id: 'j', tipo: 'canonizar' }, () => executorComModelos(executor, () => Promise.resolve(escolhas))(PEDIDO));
    await comJob({ id: 'j', tipo: 'gerar_flashcards' }, () => executorComModelos(executor, () => Promise.reject(new Error('banco fora')))(PEDIDO));
    expect(pedidos).toEqual([PEDIDO, PEDIDO, PEDIDO]);
  });

  test('preferência gravada inválida cai no padrão da categoria', async () => {
    const lidas = normalizarEscolhas({
      flashcards: { modelo: 'gpt 6; rm -rf', esforco: 'extremo' },
      visuais: { modelo: '--sandbox', esforco: 'high' },
      inventada: { modelo: 'gpt-6-luna', esforco: 'low' },
      analise: 'gpt-6-astra',
      exercicios: { modelo: 'conta', esforco: null },
    });
    expect(lidas).toEqual({ visuais: { modelo: null, esforco: 'high' } });
    const { executor, pedidos } = gravador();
    const comModelos = executorComModelos(executor, () => Promise.resolve(lidas));
    await comJob({ id: 'j', tipo: 'gerar_flashcards' }, () => comModelos(PEDIDO));
    await comJob({ id: 'j', tipo: 'gerar_imagem' }, () => comModelos(PEDIDO));
    expect(pedidos.map((p) => [p.modelo, p.esforco])).toEqual([['modelo-do-margem', 'high'], ['modelo-do-margem', 'high']]);
  });

  test('o stderr real do codex 0.162.1 com modelo recusado pela conta ChatGPT é reconhecido', () => {
    const stderr = readFileSync(new URL('../executor/casos-stderr/modelo-recusado.txt', import.meta.url), 'utf8');
    expect(causaDoStderr(stderr)).toBe(CAUSA_MODELO_INDISPONIVEL);
  });

  test('modelo recusado pela conta: a falha nomeia o modelo e sugere voltar ao padrão', async () => {
    const recusa: ResultadoExecutor = {
      estado: 'falhou', codigo: 'processo', mensagem: CAUSA_MODELO_INDISPONIVEL, duracao_ms: 5,
      detalhe: { codigo_saida: 1, classe: 'processo', stderr_resumo: 'ERROR: model_not_found', causa: CAUSA_MODELO_INDISPONIVEL },
    };
    const { executor } = gravador(recusa);
    const resultado = await comJob({ id: 'j', tipo: 'gerar_flashcards' }, () => executorComModelos(executor, () => Promise.resolve(escolhas))(PEDIDO));
    const esperado = 'O modelo gpt-6-luna não está disponível na sua conta. Em Configurações → Modelos, volte ao Padrão do Margem.';
    expect(resultado).toMatchObject({ estado: 'falhou', mensagem: esperado, detalhe: { causa: esperado, classe: 'processo' } });
    // Sem modelo escolhido (só esforço), a frase genérica fica.
    const soEsforco = await comJob({ id: 'j', tipo: 'gerar_imagem' }, () => executorComModelos(executor, () => Promise.resolve(escolhas))(PEDIDO));
    expect(soEsforco).toMatchObject({ mensagem: CAUSA_MODELO_INDISPONIVEL });
  });
});

describe('lista de modelos da conta', () => {
  const CATALOGO = JSON.stringify({ models: [
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', description: 'Frontier.', visibility: 'list', priority: 2, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'Workhorse.', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'medium' }] },
    { slug: 'escondido', display_name: 'X', visibility: 'hide', priority: 0 },
    { slug: 'com espaço', visibility: 'list', priority: 3 },
  ] });

  test('só os modelos que o Codex lista, na ordem dele', () => {
    expect(lerCatalogoDoCodex(CATALOGO)).toEqual([
      { id: 'gpt-6.1-sol', nome: 'GPT-6.1-Sol', descricao: 'Workhorse.', esforcos: ['medium'] },
      { id: 'gpt-6-astra', nome: 'GPT-6-Astra', descricao: 'Frontier.', esforcos: ['low', 'high'] },
    ]);
    expect(lerCatalogoDoCodex('não é json')).toEqual([]);
  });

  test('`codex debug models` primeiro; falhando, o cache do Codex; sem nenhum, nada', async () => {
    const agora = () => new Date('2026-10-14T12:00:00Z');
    const argumentos: string[][] = [];
    const daConta = await buscarCatalogo({ executar: (a) => { argumentos.push([...a]); return Promise.resolve({ codigo: 0, saida: CATALOGO }); }, agora, ambiente: { HOME: '/casa' } });
    expect(argumentos).toEqual([['debug', 'models']]);
    expect(daConta).toMatchObject({ origem: 'conta', obtido_em: '2026-10-14T12:00:00.000Z' });
    expect(daConta?.modelos.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-astra']);

    const lidos: string[] = [];
    const doCache = await buscarCatalogo({
      executar: () => Promise.resolve({ codigo: 1, saida: '' }), agora, ambiente: { HOME: '/casa', CODEX_HOME: '/codex' },
      lerArquivo: (caminho) => { lidos.push(caminho); return Promise.resolve(CATALOGO); },
    });
    expect(lidos).toEqual(['/codex/models_cache.json']);
    expect(doCache?.origem).toBe('cache_do_codex');

    expect(await buscarCatalogo({ executar: () => Promise.reject(new Error('ENOENT')), lerArquivo: () => Promise.reject(new Error('ENOENT')), ambiente: { HOME: '/casa' } })).toBeNull();
  });
});
