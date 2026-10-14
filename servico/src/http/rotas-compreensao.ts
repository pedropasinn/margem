import { carregarContextoDoPlano } from '../compreensao/contexto-plano.js';
import { lerCorpoJson } from './entrada-json.js';
/**
 * Rotas da compreensão do capítulo (J30, `docs/desenho/10-MODELO-DO-CAPITULO.md`).
 *
 *   GET  /api/documentos/:id/compreensoes                         execuções da última versão
 *   POST /api/documentos/:id/compreensoes                         { modo_de_leitura } → nova execução (sem jobs)
 *   GET  /api/compreensoes/:id/capitulos                          estado de cada capítulo
 *   POST /api/compreensoes/:id/capitulos/:secao/preparar          { prefetch?, tentar_de_novo? } → enfileira o que falta
 *   GET  /api/documentos/:id/analise                              "Analisar" (J142): estado por capítulo e, no vídeo, transcrição, partes e momentos
 *   POST /api/documentos/:id/analise                              { todos?, itens? } → decide pelo tipo: texto = preparação da leitura;
 *                                                                 vídeo = transcrição limpa → grifos e relações → partes e momentos (midia/analise-do-video)
 *   GET  /api/documentos/:id/preparacao                           o mesmo que GET …/analise (nome antigo)
 *   POST /api/documentos/:id/preparacao                           o mesmo que POST …/analise (nome antigo)
 *   GET  /api/preparacao/itens                                    o que "Preparar leitura" pode criar, e o padrão
 *   PUT  /api/configuracoes/preparacao                            { ao_importar, itens } → o padrão aplicado ao importar
 *   GET  /api/tipos-de-texto                                      grupos e tipos de texto (contratos/tipos-de-texto.json)
 *   PUT  /api/documentos/:id/tipo-de-texto                        { tipo_id } → a escolha da pessoa (nunca sobrescrita)
 *   GET  /api/compreensoes/:id/capitulos/:secao                   estado, revisão final e plano
 *   GET  /api/compreensoes/:id/capitulos/:secao/revisoes          r0…rN e os lotes (auditoria)
 *   GET  /api/compreensoes/:id/capitulos/:secao/relacoes?filtro=  relações (braquetes): relevantes | todas
 *   POST /api/compreensoes/:id/capitulos/:secao/relacoes/:rel/adotar → conexão do leitor
 *   (apagar um item da análise, o capítulo ou o documento: `rotas-apagar.ts`; o que foi apagado sai das leituras daqui)
 *   GET  /api/planos/:id/apresentacao?dispositivo=desktop|eink|audio
 *   GET  /api/compreensoes/:id/tempos?segundos_por_mil=&trabalhadores=   preparar em segundo plano basta? (medida e simulação)
 *   GET  /api/planos/:id/eink.epub                                a leitura guiada como EPUB (Xteink X4 Pro)
 *   GET  /api/perfil · PUT /api/perfil
 *
 * Toda escrita passa pela `seguranca()` de `/api/*`. Ids e datas são do serviço.
 */
import type { Context, Hono } from 'hono';
import type pg from 'pg';
import { ulid } from 'ulid';
import {
  FAMILIA_DA_RELACAO_SEMANTICA, validarConexaoV3, type Dispositivo, type ElementoSemanticoV1, type Id, type ModeloDoCapituloV1, type PerfilDoLeitorV1,
  type RelacaoConexao, type RelacaoSemanticaV1, type TipoRelacaoSemantica,
} from '@margem/contratos';
import { apresentarPlano, roteiroDoEink } from '@margem/core';
import { montarEpub } from '../eink/epub.js';
import { medirPreparacao } from '../compreensao/tempos.js';
import {
  SemCapitulos, capitulosDaExecucao, estadoDoCapitulo, iniciarCompreensao, prepararCapitulo, type ConfiguracaoDaCompreensao,
} from '../compreensao/pipeline.js';
import { DocumentoSemTexto, prepararDocumentoNa, seguirSemTipo } from '../compreensao/preparacao.js';
import { analisarDocumento, situacaoDaAnalise } from '../midia/analise-do-video.js';
import { gravarPadrao, ItemInvalido, ITENS_DA_PREPARACAO, lerPadrao } from '../compreensao/itens.js';
import { gravarTipoEscolhido, TipoInexistente, tiposDeTexto } from '../tipo-de-texto/identificar.js';
import { comTransacao } from '../db/transacao.js';
import { modoOuNada } from '../modos.js';
import * as conexoesRepo from '../repos/conexoes.js';
import { obterVersao, type VersaoTexto } from '../repos/documentos.js';
import * as repo from '../repos/compreensao.js';
import { ErroDaApi } from './erros.js';
import { itensApagados, planoSemApagados, semApagados } from '../apagar/compreensao.js';

type ContextoDeCorpo = { req: { raw: Request } };

export interface ApoioDaCompreensao {
  banco: pg.Pool;
  corpoJson: (c: ContextoDeCorpo) => Promise<unknown>;
  exigirUlid: (valor: string, papel: string) => Id;
  ultimaVersao: (banco: pg.Pool, documentoId: Id) => Promise<VersaoTexto>;
  configuracao: () => ConfiguracaoDaCompreensao;
}

type Corpo = Record<string, unknown>;
function objeto(bruto: unknown, permitidas: readonly string[]): Corpo {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  const desconhecidas = Object.keys(bruto).filter((chave) => !permitidas.includes(chave));
  if (desconhecidas.length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${desconhecidas.join(', ')}.`);
  return bruto as Corpo;
}

/** Tipo da relação semântica → família da conexão na adoção (§7 do desenho); o mapa canônico mora em `contratos/src/relacoes.ts`. */
export const RELACAO_DA_ADOCAO: Readonly<Record<TipoRelacaoSemantica, RelacaoConexao>> = FAMILIA_DA_RELACAO_SEMANTICA;

/** Relevante: as duas pontas estruturais ou importantes e confiança não baixa, ou retrospectiva. */
export function relacaoRelevante(relacao: RelacaoSemanticaV1, elementos: ReadonlyMap<Id, ElementoSemanticoV1>): boolean {
  if (relacao.retrospectiva) return true;
  const origem = elementos.get(relacao.origem_id);
  const destino = elementos.get(relacao.destino_id);
  return origem !== undefined && destino !== undefined && origem.centralidade <= 2 && destino.centralidade <= 2 && relacao.confianca !== 'baixa';
}

const DISPOSITIVOS: readonly Dispositivo[] = ['desktop', 'eink', 'audio'];

export function registrarRotasDaCompreensao(api: Hono, apoio: ApoioDaCompreensao): void {
  const { banco, corpoJson, exigirUlid, ultimaVersao } = apoio;

  const exigirExecucao = async (id: Id) => {
    const execucao = await comTransacao(banco, (cliente) => repo.obterExecucao(cliente, id));
    if (!execucao) throw new ErroDaApi(404, 'compreensao_inexistente', 'Execução de compreensão inexistente.');
    return execucao;
  };
  const exigirCapitulo = async (execucaoId: Id, secaoId: Id) => {
    const capitulos = await comTransacao(banco, (cliente) => capitulosDaExecucao(cliente, execucaoId));
    if (!capitulos.includes(secaoId)) throw new ErroDaApi(404, 'capitulo_inexistente', 'O capítulo não tem partes nesta execução.');
  };
  const revisaoFinal = async (execucaoId: Id, secaoId: Id): Promise<ModeloDoCapituloV1> => {
    const modelo = await comTransacao(banco, (cliente) => repo.revisaoDoCapitulo(cliente, execucaoId, secaoId));
    if (!modelo) throw new ErroDaApi(409, 'capitulo_nao_preparado', 'O capítulo ainda não tem modelo.');
    return modelo;
  };

  api.get('/api/documentos/:id/compreensoes', async (c) => {
    const versao = await ultimaVersao(banco, exigirUlid(c.req.param('id'), 'documento'));
    const execucoes = await comTransacao(banco, (cliente) => repo.listarExecucoes(cliente, versao.id));
    return c.json({ versao_id: versao.id, compreensoes: execucoes });
  });

  api.post('/api/documentos/:id/compreensoes', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = objeto(await corpoJson(c), ['modo_de_leitura']);
    const pedido = corpo.modo_de_leitura as { id?: unknown; revisao?: unknown } | undefined;
    if (typeof pedido !== 'object' || typeof pedido.id !== 'string' || typeof pedido.revisao !== 'number') {
      throw new ErroDaApi(400, 'modo_invalido', 'Use modo_de_leitura: { "id": "<modo>", "revisao": <inteiro> }.');
    }
    const modo = modoOuNada({ id: pedido.id, revisao: pedido.revisao });
    if (!modo) throw new ErroDaApi(422, 'modo_inexistente', `Modo ${pedido.id}@${String(pedido.revisao)} não existe.`);
    const versao = await ultimaVersao(banco, id);
    try {
      const execucao = await iniciarCompreensao(apoio.configuracao(), versao.id, modo);
      return c.json({ compreensao: execucao }, 201);
    } catch (erro) {
      if (erro instanceof SemCapitulos) throw new ErroDaApi(409, 'sem_capitulos', erro.message);
      throw erro;
    }
  });

  // "Analisar" (J142): uma função por tipo; `/preparacao` é o nome antigo da mesma coisa.
  const situacaoDoDocumento = async (c: Context) => {
    const id = exigirUlid(c.req.param('id') ?? '', 'documento');
    return comTransacao(banco, async (cliente) => {
      if (!(await cliente.query('SELECT 1 FROM documento WHERE id=$1', [id])).rowCount) throw new ErroDaApi(404, 'documento_inexistente');
      // A leitura que espera o tipo do texto além do prazo começa com o tipo padrão (V-T4).
      await seguirSemTipo(apoio.configuracao, cliente, { documentoId: id });
      return situacaoDaAnalise(cliente, id);
    });
  };
  const analisar = async (c: Context) => {
    const id = exigirUlid(c.req.param('id') ?? '', 'documento');
    const corpo = objeto(await lerCorpoJson(c.req.raw, true), ['todos', 'itens']);
    if (corpo.todos !== undefined && typeof corpo.todos !== 'boolean') throw new ErroDaApi(400, 'todos_invalido', 'todos é verdadeiro ou falso.');
    if (corpo.itens !== undefined && (!Array.isArray(corpo.itens) || corpo.itens.length === 0)) throw new ErroDaApi(400, 'itens_invalidos', 'itens é uma lista não vazia.');
    if (!(await comTransacao(banco, (cliente) => cliente.query('SELECT 1 FROM documento WHERE id=$1', [id]))).rowCount) throw new ErroDaApi(404, 'documento_inexistente');
    try {
      const resultado = await analisarDocumento(apoio.configuracao(), id, { todos: corpo.todos === true, ...(corpo.itens === undefined ? {} : { itens: corpo.itens as unknown[] }) });
      const situacao = await comTransacao(banco, (cliente) => situacaoDaAnalise(cliente, id));
      // 202: a leitura começa sozinha quando o tipo do texto for reconhecido (ou a transcrição ficar limpa).
      return c.json({ ...resultado, situacao }, resultado.aguardando_tipo || resultado.aguardando_transcricao ? 202 : resultado.criada ? 201 : 200);
    } catch (erro) {
      if (erro instanceof SemCapitulos) throw new ErroDaApi(409, 'sem_capitulos', erro.message);
      if (erro instanceof DocumentoSemTexto) throw new ErroDaApi(409, 'sem_texto', erro.message);
      if (erro instanceof ItemInvalido) throw new ErroDaApi(422, 'item_invalido', erro.message);
      throw erro;
    }
  };
  for (const rota of ['/api/documentos/:id/analise', '/api/documentos/:id/preparacao']) {
    api.get(rota, async (c) => c.json(await situacaoDoDocumento(c)));
    api.post(rota, analisar);
  }

  api.get('/api/preparacao/itens', async (c) => {
    const padrao = await comTransacao(banco, (cliente) => lerPadrao(cliente));
    return c.json({ itens: ITENS_DA_PREPARACAO, padrao });
  });

  api.put('/api/configuracoes/preparacao', async (c) => {
    const corpo = objeto(await corpoJson(c), ['ao_importar', 'itens']);
    try {
      const padrao = await comTransacao(banco, (cliente) => gravarPadrao(cliente, { ao_importar: corpo.ao_importar, itens: corpo.itens }));
      return c.json({ itens: ITENS_DA_PREPARACAO, padrao });
    } catch (erro) {
      if (erro instanceof ItemInvalido) throw new ErroDaApi(422, 'item_invalido', erro.message);
      throw erro;
    }
  });

  api.get('/api/tipos-de-texto', (c) => c.json({ tipos: tiposDeTexto() }));

  api.put('/api/documentos/:id/tipo-de-texto', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = objeto(await corpoJson(c), ['tipo_id']);
    if (typeof corpo.tipo_id !== 'string') throw new ErroDaApi(400, 'tipo_invalido', 'Use { "tipo_id": "<tipo>" }.');
    const tipoId = corpo.tipo_id;
    try {
      const situacao = await comTransacao(banco, async (cliente) => {
        const linha = (await cliente.query<{ preparacao_pedida: { todos?: boolean } | null }>(
          'SELECT preparacao_pedida FROM documento WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!linha) throw new ErroDaApi(404, 'documento_inexistente');
        await gravarTipoEscolhido(cliente, id, tipoId);
        // Um "Preparar leitura" esperava pelo tipo: com a escolha, começa já.
        if (linha.preparacao_pedida) await prepararDocumentoNa(apoio.configuracao(), cliente, id, linha.preparacao_pedida);
        return situacaoDaAnalise(cliente, id);
      });
      return c.json(situacao);
    } catch (erro) {
      if (erro instanceof TipoInexistente) throw new ErroDaApi(422, 'tipo_inexistente', erro.message);
      if (erro instanceof SemCapitulos) throw new ErroDaApi(409, 'sem_capitulos', erro.message);
      throw erro;
    }
  });

  api.get('/api/compreensoes/:id/capitulos', async (c) => {
    const execucao = await exigirExecucao(exigirUlid(c.req.param('id'), 'compreensão'));
    const capitulos = await comTransacao(banco, async (cliente) => {
      const versao = await obterVersao(cliente, execucao.versao_id);
      const titulos = new Map(versao.canonico.secoes.map((secao) => [secao.id, secao.titulo]));
      const ids = await capitulosDaExecucao(cliente, execucao.id);
      const saida = [];
      for (const secaoId of ids) {
        const estado = await estadoDoCapitulo(cliente, execucao.id, secaoId);
        saida.push({ secao_id: secaoId, titulo: titulos.get(secaoId) ?? '', estado: estado.estado, visivel: estado.visivel,
          revisao: estado.revisao, plano_id: estado.plano_id });
      }
      return saida;
    });
    return c.json({ compreensao: execucao, capitulos });
  });

  api.post('/api/compreensoes/:id/capitulos/:secao/preparar', async (c) => {
    const execucao = await exigirExecucao(exigirUlid(c.req.param('id'), 'compreensão'));
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    await exigirCapitulo(execucao.id, secaoId);
    // Sem corpo (ou corpo vazio), prepara com prefetch do capítulo seguinte; um corpo JSON pode desligá-lo.
    const bruto = await lerCorpoJson(c.req.raw, true);
    const corpo = objeto(bruto, ['prefetch', 'tentar_de_novo']);
    const prefetch = corpo.prefetch === undefined ? true : corpo.prefetch === true;
    // "Tentar de novo": os jobs do capítulo que falharam ou foram cancelados voltam à fila antes de avançar.
    const pedido = await prepararCapitulo(apoio.configuracao(), execucao.id, secaoId, { prefetch, tentarDeNovo: corpo.tentar_de_novo === true });
    const estado = await comTransacao(banco, (cliente) => estadoDoCapitulo(cliente, execucao.id, secaoId));
    return c.json({ ...pedido, estado: estado.estado, visivel: estado.visivel }, 202);
  });

  api.get('/api/compreensoes/:id/capitulos/:secao', async (c) => {
    const execucao = await exigirExecucao(exigirUlid(c.req.param('id'), 'compreensão'));
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    await exigirCapitulo(execucao.id, secaoId);
    const dados = await comTransacao(banco, async (cliente) => {
      const estado = await estadoDoCapitulo(cliente, execucao.id, secaoId);
      const perfil = repo.hashDoPerfil(await repo.perfilAtual(cliente));
      const doPerfil = await repo.planoDoCapitulo(cliente, execucao.id, secaoId, perfil);
      const plano = doPerfil ?? await repo.planoDoCapitulo(cliente, execucao.id, secaoId);
      const modelo = plano ? (await carregarContextoDoPlano(cliente, plano, execucao)).modelo
        : await repo.revisaoDoCapitulo(cliente, execucao.id, secaoId);
      if (plano && plano.secao_id !== secaoId) throw new ErroDaApi(409, 'plano_incompativel');
      // O que a pessoa apagou (uma relação, uma dificuldade, um grifo) não volta pela leitura (V-T8).
      const apagados = await itensApagados(cliente, execucao.id, secaoId);
      return { estado: estado.estado, visivel: estado.visivel, modelo: modelo && semApagados(modelo, apagados),
        plano: plano && planoSemApagados(plano, apagados), plano_do_perfil_atual: doPerfil !== null };
    });
    return c.json(dados);
  });

  api.get('/api/compreensoes/:id/capitulos/:secao/revisoes', async (c) => {
    const execucao = await exigirExecucao(exigirUlid(c.req.param('id'), 'compreensão'));
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    await exigirCapitulo(execucao.id, secaoId);
    const dados = await comTransacao(banco, async (cliente) => ({
      revisoes: await repo.revisoesDoCapitulo(cliente, execucao.id, secaoId),
      lotes: await repo.lotesDoCapitulo(cliente, execucao.id, secaoId),
    }));
    return c.json(dados);
  });

  api.get('/api/compreensoes/:id/capitulos/:secao/relacoes', async (c) => {
    const execucao = await exigirExecucao(exigirUlid(c.req.param('id'), 'compreensão'));
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    await exigirCapitulo(execucao.id, secaoId);
    const filtro = c.req.query('filtro') ?? 'relevantes';
    if (filtro !== 'relevantes' && filtro !== 'todas') throw new ErroDaApi(400, 'filtro_invalido', 'Use filtro=relevantes ou filtro=todas.');
    const pedidoModelo = c.req.query('modelo_id');
    const modelo = pedidoModelo ? await comTransacao(banco, cliente => repo.obterModelo(cliente, exigirUlid(pedidoModelo, 'modelo')))
      : await revisaoFinal(execucao.id, secaoId);
    if (!modelo || modelo.execucao_id !== execucao.id || modelo.secao_id !== secaoId || modelo.versao_id !== execucao.versao_id) {
      throw new ErroDaApi(409, 'modelo_incompativel', 'A revisão não pertence a este capítulo.');
    }
    const vivo = semApagados(modelo, await comTransacao(banco, (cliente) => itensApagados(cliente, execucao.id, secaoId)));
    const elementos = new Map(vivo.elementos.map((item) => [item.id, item]));
    const escolhidas = vivo.relacoes.filter((relacao) => filtro === 'todas' || relacaoRelevante(relacao, elementos));
    const adotadas = await comTransacao(banco, (cliente) => repo.adocoes(cliente, escolhidas.map((relacao) => relacao.id)));
    return c.json({
      modelo_id: modelo.id, filtro,
      relacoes: escolhidas.map((relacao) => ({
        relacao, relevante: relacaoRelevante(relacao, elementos),
        origem: elementos.get(relacao.origem_id), destino: elementos.get(relacao.destino_id),
        conexao_id: adotadas.get(relacao.id) ?? null,
      })),
    });
  });

  api.post('/api/compreensoes/:id/capitulos/:secao/relacoes/:relacao/adotar', async (c) => {
    const execucao = await exigirExecucao(exigirUlid(c.req.param('id'), 'compreensão'));
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    const relacaoId = exigirUlid(c.req.param('relacao'), 'relação');
    await exigirCapitulo(execucao.id, secaoId);
    const modelo = await revisaoFinal(execucao.id, secaoId);
    const relacao = modelo.relacoes.find((item) => item.id === relacaoId);
    if (!relacao) throw new ErroDaApi(404, 'relacao_inexistente', 'A relação não está na revisão final do capítulo.');
    const origem = modelo.elementos.find((item) => item.id === relacao.origem_id)?.ancoras[0];
    const destino = modelo.elementos.find((item) => item.id === relacao.destino_id)?.ancoras[0];
    if (!origem || !destino) throw new ErroDaApi(409, 'relacao_sem_ancora', 'Uma ponta da relação não tem âncora.');
    const quando = new Date().toISOString();
    // V3: a família que o leitor vê e, sem perda, o tipo fino e a relação de onde veio.
    const conexao: unknown = {
      versao: 3, id: ulid(), origem, destino: { tipo: 'trecho', ancora: destino }, relacao: RELACAO_DA_ADOCAO[relacao.tipo],
      relacao_semantica: relacao.tipo, origem_compreensao: { modelo_id: modelo.id, relacao_id: relacao.id },
      justificativa: relacao.explicacao, autor: 'leitor', estado: 'aceita', criada_em: quando, decidida_em: quando,
    };
    if (!validarConexaoV3(conexao)) throw new ErroDaApi(422, 'conexao_invalida', 'A relação não vira uma conexão válida (pontas no mesmo trecho?).');
    const resultado = await comTransacao(banco, async (cliente) => {
      await cliente.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 3009))', [relacao.id]);
      const ja = (await repo.adocoes(cliente, [relacao.id])).get(relacao.id);
      if (ja !== undefined) return { conexao_id: ja, criada: false };
      const criada = await conexoesRepo.criar(cliente, conexao);
      await repo.gravarAdocao(cliente, relacao.id, modelo.id, criada.id, relacao.tipo);
      return { conexao_id: criada.id, criada: true };
    });
    return c.json(resultado, resultado.criada ? 201 : 200);
  });

  api.get('/api/planos/:id/apresentacao', async (c) => {
    const planoId = exigirUlid(c.req.param('id'), 'plano');
    const dispositivo = (c.req.query('dispositivo') ?? 'desktop') as Dispositivo;
    if (!DISPOSITIVOS.includes(dispositivo)) throw new ErroDaApi(400, 'dispositivo_invalido', 'Use dispositivo=desktop, eink ou audio.');
    const bruto = c.req.query('caracteres');
    const caracteres = bruto === undefined ? undefined : Number.parseInt(bruto, 10);
    if (caracteres !== undefined && (!Number.isInteger(caracteres) || caracteres < 200 || caracteres > 20_000)) {
      throw new ErroDaApi(400, 'caracteres_invalidos', 'caracteres vai de 200 a 20000.');
    }
    const apresentacao = await comTransacao(banco, async (cliente) => {
      const plano = await repo.obterPlano(cliente, planoId);
      if (!plano) throw new ErroDaApi(404, 'plano_inexistente');
      const { capitulo } = await carregarContextoDoPlano(cliente, plano);
      return apresentarPlano(plano, capitulo.blocos, dispositivo,
        caracteres === undefined ? {} : { caracteres_por_tela: caracteres });
    });
    return c.json({ apresentacao });
  });

  api.get('/api/compreensoes/:id/tempos', async (c) => {
    const execucaoId = exigirUlid(c.req.param('id'), 'compreensao');
    const bruto = c.req.query('segundos_por_mil');
    const taxa = bruto === undefined ? undefined : Number(bruto);
    if (taxa !== undefined && (!Number.isFinite(taxa) || taxa <= 0 || taxa > 10_000)) throw new ErroDaApi(400, 'taxa_invalida', 'segundos_por_mil vai de 0 a 10000.');
    const trabalhadores = Number.parseInt(c.req.query('trabalhadores') ?? '1', 10);
    if (!Number.isInteger(trabalhadores) || trabalhadores < 1 || trabalhadores > 8) throw new ErroDaApi(400, 'trabalhadores_invalidos', 'trabalhadores vai de 1 a 8.');
    const medida = await comTransacao(banco, async (cliente) => {
      if (!await repo.obterExecucao(cliente, execucaoId)) throw new ErroDaApi(404, 'compreensao_inexistente');
      return medirPreparacao(cliente, execucaoId, apoio.configuracao().profundidadeDoPrefetch ?? 1, taxa, trabalhadores);
    });
    return c.json(medida);
  });

  api.get('/api/planos/:id/eink.epub', async (c) => {
    const planoId = exigirUlid(c.req.param('id'), 'plano');
    const { epub, nome } = await comTransacao(banco, async (cliente) => {
      const plano = await repo.obterPlano(cliente, planoId);
      if (!plano) throw new ErroDaApi(404, 'plano_inexistente');
      const { modelo, versao, capitulo } = await carregarContextoDoPlano(cliente, plano);
      const apresentacao = apresentarPlano(plano, capitulo.blocos, 'eink');
      const { titulo, autor, idioma } = versao.canonico.documento;
      return {
        epub: montarEpub({
          id: plano.id, titulo, autor: autor ?? null, capitulo: capitulo.titulo, idioma, plano,
          telas: roteiroDoEink(apresentacao, plano, modelo, capitulo.blocos), gerado_em: new Date().toISOString(),
        }),
        nome: `${titulo} - ${capitulo.titulo}`,
      };
    });
    // Nome de arquivo só com ASCII (o aparelho e o cabeçalho HTTP agradecem); o completo vai no filename*.
    const ascii = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ._-]+/g, '').trim().slice(0, 80) || 'leitura-guiada';
    return new Response(new Uint8Array(epub), { headers: {
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `attachment; filename="${ascii}.epub"; filename*=UTF-8''${encodeURIComponent(`${nome}.epub`)}`,
    } });
  });

  api.get('/api/perfil', async (c) => {
    const perfil = await comTransacao(banco, (cliente) => repo.perfilAtual(cliente));
    return c.json({ perfil, hash: repo.hashDoPerfil(perfil) });
  });

  api.put('/api/perfil', async (c) => {
    const corpo = objeto(await corpoJson(c), ['areas', 'preferencias', 'observacoes']);
    const dados = {
      areas: (corpo.areas ?? []) as PerfilDoLeitorV1['areas'],
      preferencias: (corpo.preferencias ?? []) as string[],
      observacoes: typeof corpo.observacoes === 'string' ? corpo.observacoes : '',
    };
    try {
      const perfil = await comTransacao(banco, (cliente) => repo.gravarPerfil(cliente, dados));
      return c.json({ perfil, hash: repo.hashDoPerfil(perfil) });
    } catch (erro) {
      if (erro instanceof Error && erro.message.startsWith('Perfil do leitor inválido')) throw new ErroDaApi(422, 'perfil_invalido', erro.message);
      throw erro;
    }
  });
}
