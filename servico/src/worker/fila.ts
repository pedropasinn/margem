import { ulid } from 'ulid';
import type { JobResultV1 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

export type Id = string;

/** Registro durável de um job, no formato pedido pela crítica ("A fila precisa ser durável"). */
export interface Job {
  id: Id;
  tipo: string;
  entrada: unknown;
  attempt: number;
  dedup_key: string | null;
  input_snapshot_hash: string | null;
  not_before: Date | null;
  cancel_requested_at: Date | null;
}

/** Job reservado com a concessão que autoriza publicar. */
export interface Concessao {
  job: Job;
  lease_owner: string;
  lease_token: Id;
  lease_expires_at: Date;
}

export interface EstadoConcessao {
  lease_expires_at: Date;
  cancelamento_pedido: boolean;
}

export interface ContextoPublicacao {
  job: Job;
  lease_token: Id;
  /**
   * Cliente da transação que fecha a tentativa. A fila do Postgres (J07) sempre o entrega;
   * a fila em memória, usada só nos testes do laço, não tem banco e entrega `null`.
   */
  transacao: Transacao | null;
}

/** Fecha a tentativa dentro da mesma transação da publicação. */
export type EfeitoPublicacao = (contexto: ContextoPublicacao) => Promise<JobResultV1>;

/** Tentativa que perdeu a concessão e por isso não pode publicar nem falhar o job. */
export class ConcessaoPerdida extends Error {
  constructor(public readonly jobId: Id) {
    super(`A concessão do job ${jobId} não é mais válida; a publicação foi recusada.`);
    this.name = 'ConcessaoPerdida';
  }
}

/**
 * Contrato da fila. O J07 liga isto ao Postgres (`FOR UPDATE SKIP LOCKED`);
 * aqui existe apenas a implementação em memória usada pelos testes.
 * Execução repetida é tolerada; publicação duplicada, não.
 */
export interface FilaDeJobs {
  /** Devolve concessões vencidas à fila com `attempt` incrementado. Retorna quantas. */
  expirarConcessoes(agora?: Date): Promise<number>;
  /** Reserva até `limite` jobs elegíveis dos `tipos` pedidos. */
  reservar(owner: string, tipos: readonly string[], limite?: number): Promise<Concessao[]>;
  /** Renova a concessão e informa se houve pedido de cancelamento. */
  heartbeat(jobId: Id, token: Id): Promise<EstadoConcessao>;
  /** Publica em transação única; recusa quem perdeu a concessão. */
  publicar(jobId: Id, token: Id, efeito: EfeitoPublicacao): Promise<JobResultV1>;
  /** Encerra a tentativa sem artefato. */
  falhar(jobId: Id, token: Id, resultado: JobResultV1): Promise<void>;
  /** Devolve o job à fila com `not_before`, sem gastar tentativa. */
  adiar(jobId: Id, token: Id, resultado: JobResultV1): Promise<void>;
  /** Pede o cancelamento de um job em curso. */
  pedirCancelamento(jobId: Id, agora?: Date): Promise<void>;
}

interface Linha extends Job {
  estado: 'pendente' | 'reservado' | 'concluido' | 'falhou';
  lease_owner: string | null;
  lease_token: Id | null;
  lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  resultado: JobResultV1 | null;
}

export interface OpcoesFilaEmMemoria {
  /** Duração da concessão em milissegundos. */
  concessaoMs?: number;
  relogio?: () => Date;
}

/** Fila em memória com a mesma semântica de concessão da fila durável. */
export class FilaEmMemoria implements FilaDeJobs {
  private readonly linhas = new Map<Id, Linha>();
  private readonly concessaoMs: number;
  private readonly relogio: () => Date;
  /** Efeitos colaterais confirmados pelas publicações; serve de prova de transação. */
  readonly publicados: { job_id: Id; lease_token: Id }[] = [];

  constructor(opcoes: OpcoesFilaEmMemoria = {}) {
    this.concessaoMs = opcoes.concessaoMs ?? 60_000;
    this.relogio = opcoes.relogio ?? (() => new Date());
  }

  enfileirar(parcial: { tipo: string; entrada?: unknown; not_before?: Date | null; dedup_key?: string | null; input_snapshot_hash?: string | null }): Job {
    const linha: Linha = {
      id: ulid(),
      tipo: parcial.tipo,
      entrada: parcial.entrada ?? null,
      attempt: 0,
      dedup_key: parcial.dedup_key ?? null,
      input_snapshot_hash: parcial.input_snapshot_hash ?? null,
      not_before: parcial.not_before ?? null,
      cancel_requested_at: null,
      estado: 'pendente',
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      heartbeat_at: null,
      resultado: null,
    };
    // Recusa duplicidade lógica como a tabela fará com índice único parcial.
    if (linha.dedup_key !== null) {
      for (const existente of this.linhas.values()) {
        if (existente.dedup_key === linha.dedup_key && existente.estado !== 'concluido') {
          throw new Error(`Job duplicado para a chave ${linha.dedup_key}.`);
        }
      }
    }
    this.linhas.set(linha.id, linha);
    return this.instantaneo(linha);
  }

  ler(jobId: Id): (Job & { estado: Linha['estado']; resultado: JobResultV1 | null }) | undefined {
    const linha = this.linhas.get(jobId);
    if (!linha) return undefined;
    return { ...this.instantaneo(linha), estado: linha.estado, resultado: linha.resultado };
  }

  private instantaneo(linha: Linha): Job {
    return {
      id: linha.id, tipo: linha.tipo, entrada: linha.entrada, attempt: linha.attempt,
      dedup_key: linha.dedup_key, input_snapshot_hash: linha.input_snapshot_hash,
      not_before: linha.not_before, cancel_requested_at: linha.cancel_requested_at,
    };
  }

  private comConcessao(jobId: Id, token: Id): Linha {
    const linha = this.linhas.get(jobId);
    if (!linha || linha.estado !== 'reservado' || linha.lease_token !== token) throw new ConcessaoPerdida(jobId);
    if (linha.lease_expires_at !== null && linha.lease_expires_at.getTime() <= this.relogio().getTime()) {
      throw new ConcessaoPerdida(jobId);
    }
    return linha;
  }

  expirarConcessoes(agora: Date = this.relogio()): Promise<number> {
    let quantos = 0;
    for (const linha of this.linhas.values()) {
      if (linha.estado !== 'reservado' || linha.lease_expires_at === null) continue;
      if (linha.lease_expires_at.getTime() > agora.getTime()) continue;
      linha.estado = 'pendente';
      linha.attempt += 1;
      linha.lease_owner = null;
      linha.lease_token = null;
      linha.lease_expires_at = null;
      linha.heartbeat_at = null;
      quantos += 1;
    }
    return Promise.resolve(quantos);
  }

  reservar(owner: string, tipos: readonly string[], limite = 1): Promise<Concessao[]> {
    const agora = this.relogio();
    const concessoes: Concessao[] = [];
    for (const linha of this.linhas.values()) {
      if (concessoes.length >= limite) break;
      if (linha.estado !== 'pendente' || !tipos.includes(linha.tipo)) continue;
      if (linha.not_before !== null && linha.not_before.getTime() > agora.getTime()) continue;
      linha.estado = 'reservado';
      linha.attempt += 1;
      linha.lease_owner = owner;
      linha.lease_token = ulid();
      linha.lease_expires_at = new Date(agora.getTime() + this.concessaoMs);
      linha.heartbeat_at = agora;
      concessoes.push({
        job: this.instantaneo(linha),
        lease_owner: owner,
        lease_token: linha.lease_token,
        lease_expires_at: linha.lease_expires_at,
      });
    }
    return Promise.resolve(concessoes);
  }

  heartbeat(jobId: Id, token: Id): Promise<EstadoConcessao> {
    const linha = this.comConcessao(jobId, token);
    const agora = this.relogio();
    linha.heartbeat_at = agora;
    linha.lease_expires_at = new Date(agora.getTime() + this.concessaoMs);
    return Promise.resolve({
      lease_expires_at: linha.lease_expires_at,
      cancelamento_pedido: linha.cancel_requested_at !== null,
    });
  }

  async publicar(jobId: Id, token: Id, efeito: EfeitoPublicacao): Promise<JobResultV1> {
    const linha = this.comConcessao(jobId, token);
    const antes = { ...linha };
    const marcaPublicados = this.publicados.length;
    let resultado: JobResultV1;
    try {
      resultado = await efeito({ job: this.instantaneo(linha), lease_token: token, transacao: null });
      // A concessão precisa continuar válida no instante da publicação.
      this.comConcessao(jobId, token);
      linha.estado = 'concluido';
      linha.resultado = resultado;
      linha.lease_owner = null;
      linha.lease_token = null;
      linha.lease_expires_at = null;
      this.publicados.push({ job_id: jobId, lease_token: token });
    } catch (erro) {
      // Rollback: nenhum efeito parcial sobrevive à transação abortada.
      Object.assign(linha, antes);
      this.publicados.length = marcaPublicados;
      throw erro;
    }
    return resultado;
  }

  falhar(jobId: Id, token: Id, resultado: JobResultV1): Promise<void> {
    const linha = this.comConcessao(jobId, token);
    linha.estado = 'falhou';
    linha.resultado = resultado;
    linha.lease_owner = null;
    linha.lease_token = null;
    linha.lease_expires_at = null;
    return Promise.resolve();
  }

  adiar(jobId: Id, token: Id, resultado: JobResultV1): Promise<void> {
    const linha = this.comConcessao(jobId, token);
    linha.estado = 'pendente';
    linha.resultado = resultado;
    // Adiamento não gasta tentativa: a execução nem chegou a acontecer.
    linha.attempt = Math.max(linha.attempt - 1, 0);
    linha.not_before = new Date(resultado.estado === 'adiado' ? resultado.not_before : this.relogio());
    linha.lease_owner = null;
    linha.lease_token = null;
    linha.lease_expires_at = null;
    return Promise.resolve();
  }

  pedirCancelamento(jobId: Id, agora: Date = this.relogio()): Promise<void> {
    const linha = this.linhas.get(jobId);
    if (linha) linha.cancel_requested_at = agora;
    return Promise.resolve();
  }
}
