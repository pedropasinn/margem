import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
/**
 * Porta `Responder` real (J19): `montarPromptDeResposta` (`responder@2`, J17; @1 até o J101) → executor
 * Codex no perfil restrito das leituras (`--output-schema`, sem rede, sem MCP, só leitura)
 * → `resolverResposta`, que ancora os apoios nos blocos recebidos. O modelo devolve bloco e
 * citação literal; quem acha o offset é o serviço.
 *
 * Falha do executor não vira exceção genérica: `FalhaDoResponder` carrega o resultado
 * (cota → `adiado` com `not_before`, `timeout`, `schema`…) até `executarResponder`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validadoresSchema, type RespostaGeradaV1 } from '@margem/contratos';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoAdiada, type ExecucaoFalhou, type Executor } from '../executor/tipos.js';
import { montarPromptDeResposta } from '../leitura/v2/prompt.js';
import { resolverResposta } from '../leitura/v2/resolver.js';
import type { Responder } from './responder.js';

/** Meia hora, como a leitura de uma parte. */
export const PRAZO_RESPOSTA_MS = 1_800_000;

export class FalhaDoResponder extends Error {
  constructor(public readonly resultado: ExecucaoFalhou | ExecucaoAdiada) {
    super(resultado.mensagem);
    this.name = 'FalhaDoResponder';
  }
}

export interface OpcoesDoResponderCodex {
  executor: Executor;
  /** Sem modelo, a CLI usa o padrão da conta (nada de `-m`). */
  modelo?: string;
  esforco?: string;
  prazoMs?: number;
  /** Onde o executor guarda a saída conferida. Padrão do executor: ~/.cache/margem/artefatos. */
  diretorioArtefatos?: string;
}

export function responderCodex(opcoes: OpcoesDoResponderCodex): Responder {
  return async (entrada, sinal) => {
    const inicio = Date.now();
    const { conversa } = entrada;
    const montado = montarPromptDeResposta({
      pergunta: entrada.pergunta,
      ancora: conversa.ancora,
      historico: conversa.mensagens,
      blocos_nucleo: entrada.blocos_nucleo,
      blocos_contexto: entrada.blocos_contexto,
      modo: entrada.modo,
    });
    const raiz = await mkdtemp(join(tmpdir(), `margem-resposta-${conversa.id}-`));
    try {
      const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
      const resultado = await opcoes.executor({
        diretorioEntrada: preparada.diretorioEntrada,
        prompt: preparada.prompt,
        schema: preparada.schema,
        prazoMs: opcoes.prazoMs ?? PRAZO_RESPOSTA_MS,
        ...(opcoes.modelo === undefined ? {} : { modelo: opcoes.modelo }),
        ...(opcoes.esforco === undefined ? {} : { esforco: opcoes.esforco }),
        ...(opcoes.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: opcoes.diretorioArtefatos }),
        ...(sinal === undefined ? {} : { sinal }),
      });
      if (resultado.estado !== 'ok') throw new FalhaDoResponder(resultado);
      const bruto: unknown = await lerJsonLimitado(resultado.artefato, ORCAMENTOS.resposta);
      // O executor já conferiu contra o schema do prompt; o contrato é a régua final.
      const validar = validadoresSchema.RespostaGeradaV1;
      if (!validar(bruto)) {
        const problemas = (validar.errors ?? []).slice(0, 3).map((erro) => `${erro.instancePath || '/'} ${erro.message ?? 'inválido'}`);
        throw new FalhaDoResponder(falhou('schema', `Resposta fora de RespostaGeradaV1: ${problemas.join('; ')}`, Date.now() - inicio));
      }
      const resposta: RespostaGeradaV1 = bruto;
      const resolvida = resolverResposta(resposta, [...entrada.blocos_nucleo, ...entrada.blocos_contexto], conversa.versao_id, {
        origem: conversa.ancora, conversa_id: conversa.id,
      });
      return {
        ...resolvida,
        modelo: resultado.modelo,
        esforco: resultado.esforco ?? opcoes.esforco ?? 'padrão da conta',
      };
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  };
}
