/**
 * Fila durável: a interface `FilaDeJobs` do J05 sobre os repositórios do J03.
 *
 * O laço do `Worker` não muda. O que muda é que a publicação agora recebe o cliente
 * da transação (`ContextoPublicacao.transacao`), de modo que o manipulador do J06
 * escreve marcas, partes e eventos na mesma transação que fecha a tentativa.
 */
import type pg from 'pg';
import type { JobResultV1 } from '@margem/contratos';
import * as jobsRepo from '../repos/jobs.js';
import { comTransacao } from '../db/transacao.js';
import { ConcessaoPerdida } from './fila.js';
import type { Concessao, EfeitoPublicacao, EstadoConcessao, FilaDeJobs, Id, Job } from './fila.js';

/** O que o manipulador precisa saber da linha do job, sem reconsultar o banco. */
export interface EntradaDoJob {
  documento_id: Id | null;
  versao_id: Id | null;
  parte_id: Id | null;
  dedup_key: string;
}

export function entradaDoJob(valor: unknown): EntradaDoJob {
  const bruto = valor as Partial<EntradaDoJob> | null;
  if (!bruto || typeof bruto.dedup_key !== 'string') throw new Error('Entrada do job incompleta.');
  return {
    documento_id: bruto.documento_id ?? null,
    versao_id: bruto.versao_id ?? null,
    parte_id: bruto.parte_id ?? null,
    dedup_key: bruto.dedup_key,
  };
}

function converter(linha: jobsRepo.Job): Job {
  const entrada: EntradaDoJob = {
    documento_id: linha.documento_id, versao_id: linha.versao_id,
    parte_id: linha.parte_id, dedup_key: linha.dedup_key,
  };
  return {
    id: linha.id, tipo: linha.tipo, entrada, attempt: linha.attempt,
    dedup_key: linha.dedup_key, input_snapshot_hash: linha.input_snapshot_hash,
    not_before: linha.not_before, cancel_requested_at: linha.cancel_requested_at,
  };
}

/** Traduz a concessão perdida do repositório para a exceção que o `Worker` reconhece. */
async function comConcessaoTraduzida<T>(jobId: Id, acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (erro) {
    if (erro instanceof jobsRepo.ConcessaoPerdida) throw new ConcessaoPerdida(jobId);
    throw erro;
  }
}

export interface OpcoesFilaPostgres {
  /** Duração da concessão, renovada a cada batida do worker. */
  concessaoMs?: number;
}

export class FilaPostgres implements FilaDeJobs {
  private readonly concessaoMs: number;

  constructor(private readonly banco: pg.Pool, opcoes: OpcoesFilaPostgres = {}) {
    this.concessaoMs = opcoes.concessaoMs ?? 60_000;
  }

  expirarConcessoes(agora?: Date): Promise<number> {
    return jobsRepo.expirarConcessoes(this.banco, agora ?? new Date());
  }

  async reservar(owner: string, tipos: readonly string[], limite = 1): Promise<Concessao[]> {
    const concessoes: Concessao[] = [];
    for (let i = 0; i < limite; i += 1) {
      const linha = await jobsRepo.reservar(this.banco, owner, [...tipos], new Date(), this.concessaoMs);
      if (!linha) break;
      concessoes.push({
        job: converter(linha),
        lease_owner: owner,
        lease_token: linha.lease_token ?? '',
        lease_expires_at: linha.lease_expires_at ?? new Date(Date.now() + this.concessaoMs),
      });
    }
    return concessoes;
  }

  async heartbeat(jobId: Id, token: Id): Promise<EstadoConcessao> {
    await comConcessaoTraduzida(jobId, () => jobsRepo.heartbeat(this.banco, jobId, token, this.concessaoMs));
    const linha = await comTransacao(this.banco, (cliente) => jobsRepo.obter(cliente, jobId));
    return {
      lease_expires_at: linha?.lease_expires_at ?? new Date(Date.now() + this.concessaoMs),
      cancelamento_pedido: linha?.cancel_requested_at !== null && linha?.cancel_requested_at !== undefined,
    };
  }

  publicar(jobId: Id, token: Id, efeito: EfeitoPublicacao): Promise<JobResultV1> {
    return comConcessaoTraduzida(jobId, () => jobsRepo.publicar(
      this.banco, jobId, token,
      async (cliente) => {
        const linha = await jobsRepo.obter(cliente, jobId);
        if (!linha) throw new Error('Job desapareceu durante a publicação.');
        return efeito({ job: converter(linha), lease_token: token, transacao: cliente });
      },
      (resultado: JobResultV1) => (resultado.estado === 'ok' ? resultado.artefato.sha256 : undefined),
      // Só os diagnósticos da tentativa vencedora ficam no job (J14).
      (resultado: JobResultV1) => resultado.diagnosticos,
    ));
  }

  async falhar(jobId: Id, token: Id, resultado: JobResultV1): Promise<void> {
    const codigo = resultado.diagnosticos.find((item) => item.nivel === 'erro')?.codigo
      ?? resultado.diagnosticos[0]?.codigo ?? 'desconhecido';
    await comConcessaoTraduzida(jobId, () =>
      jobsRepo.falhar(this.banco, jobId, token, codigo, resultado.diagnosticos));
  }

  async adiar(jobId: Id, token: Id, resultado: JobResultV1): Promise<void> {
    if (resultado.estado !== 'adiado') throw new Error('Adiar exige um JobResultV1 adiado.');
    const codigo = resultado.diagnosticos[0]?.codigo ?? 'cota';
    await comConcessaoTraduzida(jobId, () =>
      jobsRepo.falhar(this.banco, jobId, token, codigo, resultado.diagnosticos, new Date(resultado.not_before)));
  }

  async pedirCancelamento(jobId: Id): Promise<void> {
    await jobsRepo.cancelar(this.banco, jobId);
  }
}
