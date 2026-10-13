/**
 * Rotas de F2 (J16): modos, anotações, etiquetas, conexões, conversas, preferências e camadas.
 *
 * Toda escrita passa pela `seguranca()` registrada em `/api/*` no `app.ts`. Todo id e
 * toda data são do serviço; o corpo só traz o que o leitor decide (âncora, tipo, texto,
 * relação…), e campos desconhecidos são recusados, como nos contratos.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import { ulid } from 'ulid';
import {
  validarAnotacao, validarConexaoV2, validarConversaV2, validarEtiqueta,
  MODO_F1, type AncoraV1, type ConversaV2, type Id, type MensagemDoLeitorV2, type ReferenciaModo,
} from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { enfileirarResposta } from '../conversa/responder.js';
import { modoOuNada, modosDeLeitura } from '../modos.js';
import * as anotacoesRepo from '../repos/anotacoes.js';
import { DadoRecusado } from '../repos/anotacoes.js';
import * as camadasRepo from '../repos/camadas.js';
import * as conexoesRepo from '../repos/conexoes.js';
import * as conversasRepo from '../repos/conversas.js';
import * as etiquetasRepo from '../repos/etiquetas.js';
import * as marcasRepo from '../repos/marcas.js';
import { chaveDaRevisao, enfileirarRevisao } from '../notas/revisar.js';
import { GrifoRecusado } from '../repos/marcas.js';
import type { VersaoTexto } from '../repos/documentos.js';
import * as preferenciasRepo from '../repos/preferencias.js';
import { camadasResumidas } from './consultas.js';
import { ErroDaApi } from './erros.js';

type ContextoDeCorpo = { req: { raw: Request } };

export interface ApoioDasRotas {
  banco: pg.Pool;
  corpoJson: (c: ContextoDeCorpo) => Promise<unknown>;
  exigirUlid: (valor: string, papel: string) => Id;
  ultimaVersao: (banco: pg.Pool, documentoId: Id) => Promise<VersaoTexto>;
}

type Corpo = Record<string, unknown>;

/** Objeto JSON só com as chaves permitidas. */
function objeto(bruto: unknown, permitidas: readonly string[]): Corpo {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  }
  const desconhecidas = Object.keys(bruto).filter((chave) => !permitidas.includes(chave));
  if (desconhecidas.length > 0) {
    throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${desconhecidas.join(', ')}.`);
  }
  return bruto as Corpo;
}

function exigirRevisao(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > 2147483647) {
    throw new ErroDaApi(400, 'revisao_invalida', 'Envie a revisão da anotação.');
  }
  return valor;
}

function agora(): string {
  return new Date().toISOString();
}

/** Nunca antes de `anterior`: datas do fio e da edição não andam para trás. */
function depoisDe(instante: string, anterior: string | undefined): string {
  return anterior !== undefined && Date.parse(anterior) > Date.parse(instante) ? anterior : instante;
}

/** Erro de dado de repositório vira 422 com o código e a mensagem escritos pelo serviço. */
async function comDados<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (erro) {
    if (erro instanceof DadoRecusado) throw new ErroDaApi(422, erro.codigo, erro.message);
    throw erro;
  }
}

function versaoDaAncora(ancora: unknown): unknown {
  return typeof ancora === 'object' && ancora !== null ? (ancora as { versao_id?: unknown }).versao_id : undefined;
}

async function documentoExiste(cliente: Transacao, id: Id): Promise<boolean> {
  return ((await cliente.query('SELECT 1 FROM documento WHERE id=$1', [id])).rowCount ?? 0) > 0;
}

export function registrarRotasF2(api: Hono, apoio: ApoioDasRotas): void {
  const { banco, corpoJson, exigirUlid, ultimaVersao } = apoio;

  // ------------------------------------------------------------------ modos

  api.get('/api/modos', (c) => c.json({ modos: modosDeLeitura() }));

  // ------------------------------------------------------------------ anotações

  api.post('/api/anotacoes', async (c) => {
    const corpo = objeto(await corpoJson(c), ['ancora', 'tipo', 'texto', 'fonte', 'marca_id', 'chave_cliente']);
    const chave = corpo.chave_cliente;
    if (chave !== undefined && (typeof chave !== 'string' || !/^(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(chave))) {
      throw new ErroDaApi(400, 'chave_cliente_invalida', 'Use uma chave ULID ou UUID.');
    }
    const quando = agora();
    const anotacao: unknown = {
      versao: 1, revisao_edicao: 1, id: ulid(), versao_id: versaoDaAncora(corpo.ancora), ancora: corpo.ancora,
      tipo: corpo.tipo, texto: corpo.texto,
      ...(corpo.fonte === undefined ? {} : { fonte: corpo.fonte }),
      ...(corpo.marca_id === undefined ? {} : { marca_id: corpo.marca_id }),
      criada_em: quando, atualizada_em: quando,
    };
    if (!validarAnotacao(anotacao)) throw new ErroDaApi(422, 'anotacao_invalida', 'A anotação não segue o contrato AnotacaoV1.');
    const criada = await comDados(() => comTransacao(banco, (cliente) => anotacoesRepo.criar(cliente, anotacao, chave)));
    return c.json({ anotacao: criada }, criada.id === anotacao.id ? 201 : 200);
  });

  api.patch('/api/anotacoes/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'anotação');
    const corpo = objeto(await corpoJson(c), ['tipo', 'texto', 'fonte', 'marca_id', 'revisao']);
    exigirRevisao(corpo.revisao);
    if (Object.keys(corpo).filter((chave) => chave !== 'revisao').length === 0) throw new ErroDaApi(400, 'sem_mudanca', 'Envie ao menos um de tipo, texto, fonte ou marca_id.');
    const anotacao = await comDados(() => comTransacao(banco, async (cliente) => {
      const atual = await anotacoesRepo.obter(cliente, id, true);
      if (!atual) throw new ErroDaApi(404, 'anotacao_inexistente');
      if (atual.revisao_edicao !== corpo.revisao) throw new anotacoesRepo.AnotacaoObsoleta(atual);
      const base: Record<string, unknown> = { ...atual };
      delete base.fonte; delete base.marca_id;
      const fonte = corpo.fonte === undefined ? atual.fonte : corpo.fonte;
      const marca = corpo.marca_id === undefined ? atual.marca_id : corpo.marca_id;
      const nova: unknown = {
        ...base,
        ...(corpo.tipo === undefined ? {} : { tipo: corpo.tipo }),
        ...(corpo.texto === undefined ? {} : { texto: corpo.texto }),
        // `null` remove a fonte ou a marca; ausente mantém.
        ...(fonte === undefined || fonte === null ? {} : { fonte }),
        ...(marca === undefined || marca === null ? {} : { marca_id: marca }),
        atualizada_em: depoisDe(agora(), atual.criada_em),
      };
      if (!validarAnotacao(nova)) throw new ErroDaApi(422, 'anotacao_invalida', 'A anotação editada não segue o contrato AnotacaoV1.');
      return anotacoesRepo.atualizar(cliente, nova);
    }));
    return c.json({ anotacao });
  });

  api.delete('/api/anotacoes/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'anotação');
    const corpo = objeto(await corpoJson(c), ['revisao']);
    const revisao = exigirRevisao(corpo.revisao);
    const apagada = await comTransacao(banco, (cliente) => anotacoesRepo.apagar(cliente, id, revisao));
    if (!apagada) throw new ErroDaApi(404, 'anotacao_inexistente');
    return c.json({ anotacao_id: id, apagada: true });
  });

  // ------------------------------------------------------------------ grifos do leitor e edições (J37)

  /** Recusa de grifo: sobreposição é conflito (409); o resto é dado inválido (422). */
  const comGrifo = async <T>(acao: () => Promise<T>): Promise<T> => {
    try { return await comDados(acao); }
    catch (erro) {
      if (erro instanceof GrifoRecusado) throw new ErroDaApi(erro.codigo.endsWith('sobreposto') || erro.codigo.endsWith('sobreposta') ? 409 : 422, erro.codigo, erro.message);
      throw erro;
    }
  };

  api.post('/api/grifos', async (c) => {
    const corpo = objeto(await corpoJson(c), ['ancora', 'funcao', 'modo']);
    if (typeof corpo.funcao !== 'string') throw new ErroDaApi(400, 'funcao_ausente', 'Diga a função do grifo (tese, conceito, justificativa ou nenhuma).');
    const modo = corpo.modo === undefined ? MODO_F1 : corpo.modo as ReferenciaModo;
    if (!modoOuNada(modo)) throw new ErroDaApi(422, 'modo_inexistente', 'O modo do grifo não existe.');
    const versaoId = versaoDaAncora(corpo.ancora);
    if (typeof versaoId !== 'string') throw new ErroDaApi(422, 'ancora_invalida', 'A âncora do grifo não é válida.');
    const grifo = await comGrifo(() => comTransacao(banco, async (cliente) => {
      const versao = await cliente.query('SELECT 1 FROM versao_texto WHERE id=$1', [versaoId]);
      if (!versao.rowCount) throw new DadoRecusado('versao_inexistente', 'A versão do grifo não existe.');
      return marcasRepo.criarGrifo(cliente, { id: ulid(), ancora: corpo.ancora as AncoraV1, funcao: corpo.funcao as string, modo, criada_em: agora() });
    }));
    return c.json({ marca: grifo }, 201);
  });

  api.delete('/api/grifos/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'grifo');
    const apagado = await comTransacao(banco, (cliente) => marcasRepo.apagarGrifo(cliente, id));
    if (apagado === null) throw new ErroDaApi(404, 'marca_inexistente');
    if (!apagado) throw new ErroDaApi(409, 'marca_da_ia', 'Só os seus grifos se apagam; as marcas da IA se removem (rejeitam).');
    return c.json({ marca_id: id, apagada: true });
  });

  api.put('/api/marcas/:id/funcao', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'marca');
    const corpo = objeto(await corpoJson(c), ['funcao']);
    if (typeof corpo.funcao !== 'string') throw new ErroDaApi(400, 'funcao_ausente', 'Envie a função.');
    const marca = await comGrifo(() => comTransacao(banco, (cliente) => marcasRepo.trocarFuncao(cliente, id, corpo.funcao as string)));
    if (!marca) throw new ErroDaApi(404, 'marca_inexistente');
    return c.json({ marca });
  });

  api.put('/api/marcas/:id/nota', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'marca');
    const corpo = objeto(await corpoJson(c), ['texto']);
    // `texto: null` volta à nota original da IA.
    if (corpo.texto !== null && (typeof corpo.texto !== 'string' || corpo.texto.trim() === '')) throw new ErroDaApi(400, 'texto_ausente', 'Envie o texto da nota, ou null para voltar ao original.');
    const marca = await comGrifo(() => comTransacao(banco, (cliente) => marcasRepo.editarComentario(cliente, id, corpo.texto === null ? null : (corpo.texto as string).trim())));
    if (!marca) throw new ErroDaApi(404, 'marca_inexistente');
    return c.json({ marca });
  });

  // ------------------------------------------------------------------ etiquetas

  api.get('/api/versoes/:id/etiquetas', async (c) => {
    const versaoId = exigirUlid(c.req.param('id'), 'versão');
    const [etiquetas, sugestoes] = await comTransacao(banco, async (cliente) =>
      [await etiquetasRepo.daVersao(cliente, versaoId), await etiquetasRepo.nomesUsados(cliente)] as const);
    return c.json({ etiquetas, sugestoes });
  });

  api.post('/api/etiquetas', async (c) => {
    const corpo = objeto(await corpoJson(c), ['versao_id', 'alvo', 'nome']);
    const etiqueta: unknown = {
      versao: 1, id: ulid(), versao_id: corpo.versao_id, alvo: corpo.alvo,
      nome: typeof corpo.nome === 'string' ? corpo.nome.trim() : corpo.nome,
      criada_em: agora(),
    };
    if (!validarEtiqueta(etiqueta)) throw new ErroDaApi(422, 'etiqueta_invalida', 'Use uma etiqueta de 1 a 40 caracteres, sem quebras de linha.');
    const criada = await comDados(() => comTransacao(banco, (cliente) => etiquetasRepo.criar(cliente, etiqueta)));
    return c.json({ etiqueta: criada }, criada.id === etiqueta.id ? 201 : 200);
  });

  api.delete('/api/etiquetas/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'etiqueta');
    const apagada = await comTransacao(banco, (cliente) => etiquetasRepo.apagar(cliente, id));
    if (!apagada) throw new ErroDaApi(404, 'etiqueta_inexistente');
    return c.json({ etiqueta_id: id, apagada: true });
  });

  /**
   * O Codex revisa uma nota do leitor (J37): o pedido, com instrução opcional, fica pendente na nota e vira
   * o job `revisar_anotacao`. Um pedido por vez; se o job anterior falhou de vez, o novo pedido o substitui.
   */
  api.post('/api/anotacoes/:id/revisar', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'anotação');
    const corpo = objeto(await corpoJson(c), ['instrucao']);
    if (corpo.instrucao !== undefined && corpo.instrucao !== null && (typeof corpo.instrucao !== 'string' || corpo.instrucao.length > 1000)) {
      throw new ErroDaApi(400, 'instrucao_invalida', 'A instrução é um texto de até 1000 caracteres.');
    }
    const instrucao = typeof corpo.instrucao === 'string' && corpo.instrucao.trim() !== '' ? corpo.instrucao.trim() : null;
    const resposta = await comTransacao(banco, async (cliente) => {
      const anotacao = await anotacoesRepo.obter(cliente, id);
      if (!anotacao) throw new ErroDaApi(404, 'anotacao_inexistente');
      const anterior = await anotacoesRepo.pedidoDeRevisao(cliente, id, true);
      if (anterior) {
        const job = (await cliente.query<{ estado: string }>('SELECT estado FROM job WHERE dedup_key=$1', [chaveDaRevisao(id, anterior.id)])).rows[0];
        if (job && job.estado !== 'falhou' && job.estado !== 'cancelado') throw new ErroDaApi(409, 'revisao_pendente', 'O Codex ainda está revisando esta nota.');
        await anotacoesRepo.desistirDaRevisao(cliente, id);
      }
      const pedido = { id: ulid(), instrucao, pedido_em: agora() };
      await anotacoesRepo.pedirRevisao(cliente, id, pedido);
      const job = await enfileirarRevisao(cliente, anotacao, pedido);
      return { anotacao_id: id, pedido_id: pedido.id, job_id: job.id };
    });
    return c.json(resposta, 202);
  });

  // ------------------------------------------------------------------ conexões

  api.post('/api/conexoes', async (c) => {
    const corpo = objeto(await corpoJson(c), ['origem', 'destino', 'relacao', 'justificativa']);
    const quando = agora();
    // Conexão do leitor nasce aceita, decidida no instante em que foi criada.
    const conexao: unknown = {
      versao: 2, id: ulid(), origem: corpo.origem, destino: corpo.destino, relacao: corpo.relacao,
      justificativa: corpo.justificativa, autor: 'leitor', estado: 'aceita', criada_em: quando, decidida_em: quando,
    };
    if (!validarConexaoV2(conexao)) throw new ErroDaApi(422, 'conexao_invalida', 'A conexão não segue o contrato ConexaoV2.');
    const criada = await comDados(() => comTransacao(banco, (cliente) => conexoesRepo.criar(cliente, conexao)));
    return c.json({ conexao: criada }, 201);
  });

  api.post('/api/conexoes/:id/decidir', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'conexão');
    const corpo = objeto(await corpoJson(c), ['estado']);
    if (corpo.estado !== 'aceita' && corpo.estado !== 'rejeitada') {
      throw new ErroDaApi(400, 'estado_invalido', 'Use estado "aceita" ou "rejeitada".');
    }
    const estado = corpo.estado;
    try {
      const conexao = await comTransacao(banco, (cliente) => conexoesRepo.decidir(cliente, id, estado, agora()));
      if (!conexao) throw new ErroDaApi(404, 'conexao_inexistente');
      return c.json({ conexao });
    } catch (erro) {
      if (erro instanceof conexoesRepo.DecisaoRecusada) {
        throw new ErroDaApi(409, 'conexao_nao_decidivel',
          `Só uma sugestão da IA pode ser decidida; esta é de ${erro.autor} e está ${erro.estado_atual}.`);
      }
      throw erro;
    }
  });

  // ------------------------------------------------------------------ conversas

  api.post('/api/conversas', async (c) => {
    const corpo = objeto(await corpoJson(c), ['ancora', 'pergunta', 'marca_id', 'anotacao_id']);
    const quando = agora();
    const pergunta: MensagemDoLeitorV2 = { id: ulid(), autor: 'leitor', texto: corpo.pergunta as string, criada_em: quando };
    const conversa: unknown = {
      versao: 2, id: ulid(), versao_id: versaoDaAncora(corpo.ancora), ancora: corpo.ancora,
      ...(corpo.marca_id === undefined ? {} : { marca_id: corpo.marca_id }),
      ...(corpo.anotacao_id === undefined ? {} : { anotacao_id: corpo.anotacao_id }),
      mensagens: [pergunta], estado: 'aberta', criada_em: quando,
    };
    if (!validarConversaV2(conversa)) throw new ErroDaApi(422, 'conversa_invalida', 'A pergunta e a âncora não seguem o contrato ConversaV2.');
    const resultado = await comDados(() => comTransacao(banco, async (cliente) => {
      const criada = await conversasRepo.criar(cliente, conversa);
      const job = await enfileirarResposta(cliente, criada, pergunta.id);
      return { conversa: criada, job_id: job.id };
    }));
    return c.json(resultado, 201);
  });

  api.post('/api/conversas/:id/mensagens', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'conversa');
    const corpo = objeto(await corpoJson(c), ['pergunta']);
    const resultado = await comDados(() => comTransacao(banco, async (cliente) => {
      const atual = await conversasRepo.obter(cliente, id, { travar: true });
      if (!atual) throw new ErroDaApi(404, 'conversa_inexistente');
      if (atual.estado !== 'aberta') throw new ErroDaApi(409, 'conversa_arquivada', 'A conversa está arquivada.');
      const mensagem: MensagemDoLeitorV2 = {
        id: ulid(), autor: 'leitor', texto: corpo.pergunta as string,
        criada_em: depoisDe(agora(), atual.mensagens.at(-1)?.criada_em),
      };
      const fio: unknown = { ...atual, mensagens: [...atual.mensagens, mensagem] };
      if (!validarConversaV2(fio)) throw new ErroDaApi(422, 'mensagem_invalida', 'A pergunta não segue o contrato ConversaV2.');
      const conversa: ConversaV2 = await conversasRepo.acrescentar(cliente, atual, mensagem);
      const job = await enfileirarResposta(cliente, conversa, mensagem.id);
      return { conversa_id: id, mensagem, job_id: job.id };
    }));
    return c.json(resultado, 202);
  });

  api.get('/api/conversas/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'conversa');
    const resultado = await comTransacao(banco, async (cliente) => {
      const conversa = await conversasRepo.obter(cliente, id);
      if (!conversa) throw new ErroDaApi(404, 'conversa_inexistente');
      return { conversa, pendentes: await conversasRepo.pendentes(cliente, id) };
    });
    return c.json(resultado);
  });

  // ------------------------------------------------------------------ preferências e camadas

  api.put('/api/documentos/:id/preferencias', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = objeto(await corpoJson(c), ['primeiro_eu', 'camada_padrao']);
    if (corpo.primeiro_eu === undefined && corpo.camada_padrao === undefined) {
      throw new ErroDaApi(400, 'sem_mudanca', 'Envie primeiro_eu e/ou camada_padrao.');
    }
    if (corpo.primeiro_eu !== undefined && typeof corpo.primeiro_eu !== 'boolean') {
      throw new ErroDaApi(400, 'primeiro_eu_invalido', 'primeiro_eu é booleano.');
    }
    const camada = corpo.camada_padrao;
    if (camada !== undefined && camada !== null && (typeof camada !== 'string' || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(camada))) {
      throw new ErroDaApi(400, 'camada_invalida', 'camada_padrao é o id de uma camada ou null.');
    }
    const preferencias = await comDados(() => comTransacao(banco, async (cliente) => {
      if (!(await documentoExiste(cliente, id))) throw new ErroDaApi(404, 'documento_inexistente');
      return preferenciasRepo.gravar(cliente, id, {
        ...(typeof corpo.primeiro_eu === 'boolean' ? { primeiro_eu: corpo.primeiro_eu } : {}),
        ...(camada === undefined ? {} : { camada_padrao: camada }),
      });
    }));
    return c.json({ preferencias });
  });

  api.get('/api/documentos/:id/camadas', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const pedida = c.req.query('versao');
    if (!(await comTransacao(banco, (cliente) => documentoExiste(cliente, id)))) throw new ErroDaApi(404, 'documento_inexistente');
    const versaoId = pedida === undefined || pedida === '' ? (await ultimaVersao(banco, id)).id : exigirUlid(pedida, 'versão');
    const corpo = await comTransacao(banco, async (cliente) => {
      const daVersao = (await cliente.query('SELECT 1 FROM versao_texto WHERE id=$1 AND documento_id=$2', [versaoId, id])).rowCount;
      if (!daVersao) throw new ErroDaApi(404, 'versao_inexistente', 'A versão não é deste documento.');
      const preferencias = await preferenciasRepo.ler(cliente, id);
      return {
        documento_id: id, versao_id: versaoId,
        camada_padrao: await camadasRepo.camadaPadrao(cliente, versaoId),
        preferencias,
        camadas: await camadasResumidas(cliente, versaoId),
      };
    });
    return c.json(corpo);
  });
}
