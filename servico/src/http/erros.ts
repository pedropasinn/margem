/**
 * Erros em JSON, sempre `{erro, detalhe?}`.
 *
 * Nenhuma resposta carrega pilha de chamadas ou caminho do sistema de arquivos:
 * a mensagem de exceções desconhecidas é substituída por um texto genérico e o
 * detalhe só aparece quando o próprio serviço o escreveu para o usuário ler.
 */
import { AnotacaoObsoleta } from '../repos/anotacoes.js';
import type { AnotacaoV1 } from '@margem/contratos';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface CorpoDeErro {
  erro: string;
  anotacao?: AnotacaoV1;
  revisao_atual?: number;
  detalhe?: string;
}

export class ErroDaApi extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly erro: string,
    readonly detalhe?: string,
    /** Cabeçalhos da resposta de erro (por exemplo `Retry-After` no 429). */
    readonly cabecalhos?: Readonly<Record<string, string>>,
  ) {
    super(erro);
    this.name = 'ErroDaApi';
  }
}

/** D-13: o que a pessoa lê quando o disco enche no meio do uso. */
export const MENSAGEM_SEM_ESPACO = 'Sem espaço no disco: a operação não foi concluída. Libere espaço e tente de novo.';

/**
 * Disco cheio: `ENOSPC`/`EDQUOT` do sistema de arquivos ou SQLSTATE `53100` (disk_full) do Postgres,
 * no próprio erro ou na causa dele.
 */
export function semEspacoNoDisco(erro: unknown): boolean {
  for (let atual: unknown = erro, passos = 0; atual instanceof Object && passos < 5; atual = (atual as { cause?: unknown }).cause, passos += 1) {
    const codigo = (atual as { code?: unknown }).code;
    if (codigo === 'ENOSPC' || codigo === 'EDQUOT' || codigo === '53100') return true;
  }
  return false;
}

export function corpoDoErro(erro: unknown): { status: ContentfulStatusCode; corpo: CorpoDeErro } {
  if (erro instanceof AnotacaoObsoleta) {
    return { status: 409, corpo: { erro: 'anotacao_obsoleta', detalhe: erro.message, anotacao: erro.atual, revisao_atual: erro.atual.revisao_edicao } };
  }
  if (erro instanceof ErroDaApi) {
    return {
      status: erro.status,
      corpo: erro.detalhe === undefined ? { erro: erro.erro } : { erro: erro.erro, detalhe: erro.detalhe },
    };
  }
  if (semEspacoNoDisco(erro)) return { status: 507, corpo: { erro: 'sem_espaco', detalhe: MENSAGEM_SEM_ESPACO } };
  return { status: 500, corpo: { erro: 'falha_interna' } };
}

/** Recusa mensagens que possam carregar caminho do sistema para dentro do detalhe. */
export function detalheSeguro(texto: string): string {
  const limpo = texto.replaceAll(/(?:\/[\w.@+-]+){2,}/g, '…').replaceAll(/\s+/g, ' ').trim();
  return limpo.length > 400 ? `${limpo.slice(0, 400)}…` : limpo;
}
