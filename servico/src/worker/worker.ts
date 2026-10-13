import type { JobResultV1 } from '@margem/contratos';
import type { ExecucaoOk, ResultadoExecutor } from '../executor/tipos.js';
import { ConcessaoPerdida } from './fila.js';
import type { Concessao, ContextoPublicacao, FilaDeJobs, Id, Job } from './fila.js';
import { comAuditoria } from '../executor/auditoria.js';
import { SLOTS_PADRAO, aguardarVaga } from './slots.js';
import type { Vaga } from './slots.js';

export interface Tarefa {
  job: Job;
  lease_token: Id;
  /** Aborta quando o job é cancelado, a concessão se perde ou o worker encerra. */
  sinal: AbortSignal;
}

/** Cada tipo de job registra o seu manipulador; J06 e J07 registram os deles. */
export interface Manipulador {
  /** Parte demorada, fora de qualquer transação. */
  executar: (tarefa: Tarefa) => Promise<ResultadoExecutor>;
  /** Escrita final, dentro da transação de publicação. */
  publicar: (tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao) => Promise<JobResultV1>;
}

export interface AnotacaoWorker {
  evento: 'reservado' | 'publicado' | 'falhou' | 'adiado' | 'concessao_perdida' | 'cancelado' | 'erro' | 'interrompido';
  job_id: Id;
  attempt: number;
  detalhe?: string;
}

export interface OpcoesWorker {
  fila: FilaDeJobs;
  manipuladores: Record<string, Manipulador>;
  owner?: string;
  slots?: number;
  diretorioSlots?: string;
  /** Pausa entre ciclos ociosos. */
  intervaloMs?: number;
  heartbeatMs?: number;
  /** Tempo concedido aos jobs em curso depois de um SIGTERM. */
  prazoEncerramentoMs?: number;
  /** Limita o número de ciclos; usado pelos testes para não girar para sempre. */
  maximoCiclos?: number;
  anotar?: (anotacao: AnotacaoWorker) => void;
  /**
   * Raiz da auditoria por chamada (J26). Com ela, cada tentativa roda num contexto que o
   * executor auditado e a publicação usam para gravar prompt, resposta e diagnósticos.
   */
  auditoria?: string;
}

/** Converte o desfecho do executor no JobResultV1 que a fila persiste. */
export function resultadoDoJob(
  job: Job, lease_token: Id, execucao: ResultadoExecutor,
): JobResultV1 {
  const base = { job_id: job.id, attempt: job.attempt, lease_token, duracao_ms: execucao.duracao_ms };
  if (execucao.estado === 'ok') {
    return {
      ...base, estado: 'ok', modelo: execucao.modelo, diagnosticos: [],
      artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
    };
  }
  if (execucao.estado === 'adiado') {
    return {
      ...base, estado: 'adiado', not_before: execucao.not_before.toISOString(),
      diagnosticos: [{ nivel: 'aviso', codigo: execucao.codigo, mensagem: execucao.mensagem }],
    };
  }
  return {
    ...base, estado: 'falhou',
    diagnosticos: [{ nivel: 'erro', codigo: execucao.codigo, mensagem: execucao.mensagem }],
  };
}

function pausar(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise<void>((resolver) => {
    if (sinal.aborted || ms <= 0) { resolver(); return; }
    const relogio = setTimeout(() => { sinal.removeEventListener('abort', parar); resolver(); }, ms);
    function parar() { clearTimeout(relogio); resolver(); }
    sinal.addEventListener('abort', parar, { once: true });
  });
}

/** Processo de trabalho: reserva, executa fora de transação e publica com a concessão válida. */
export class Worker {
  private readonly opcoes: Required<Omit<OpcoesWorker, 'anotar' | 'diretorioSlots' | 'auditoria'>> & Pick<OpcoesWorker, 'anotar' | 'diretorioSlots' | 'auditoria'>;
  private readonly emCurso = new Set<Promise<void>>();
  private readonly abortarTudo = new AbortController();
  /** Aborta as esperas do laço (vaga e pausa) assim que a parada é pedida. */
  private readonly pararControlador = new AbortController();
  private parando = false;

  constructor(opcoes: OpcoesWorker) {
    this.opcoes = {
      owner: `margem-worker-${String(process.pid)}`,
      slots: SLOTS_PADRAO,
      intervaloMs: 200,
      heartbeatMs: 30_000,
      prazoEncerramentoMs: 30_000,
      maximoCiclos: Number.POSITIVE_INFINITY,
      ...opcoes,
    };
  }

  get tarefasEmCurso(): number { return this.emCurso.size; }

  /** Para de reservar; os jobs em curso continuam até o prazo de encerramento. */
  pedirParada(): void {
    this.parando = true;
    this.pararControlador.abort();
  }

  async rodar(): Promise<void> {
    const { fila, manipuladores, owner, intervaloMs, maximoCiclos } = this.opcoes;
    const tipos = Object.keys(manipuladores);
    let ciclos = 0;
    while (!this.parando && ciclos < maximoCiclos) {
      ciclos += 1;
      await fila.expirarConcessoes();
      const vaga = await aguardarVaga({
        slots: this.opcoes.slots,
        diretorio: this.opcoes.diretorioSlots,
        dono: owner,
        intervaloMs,
        sinal: this.pararControlador.signal,
      });
      if (!vaga) break;
      let concessoes: Concessao[] = [];
      try {
        concessoes = await fila.reservar(owner, tipos, 1);
      } catch (erro) {
        await vaga.devolver();
        throw erro;
      }
      const concessao = concessoes[0];
      if (!concessao) {
        await vaga.devolver();
        await pausar(intervaloMs, this.pararControlador.signal);
        continue;
      }
      this.opcoes.anotar?.({ evento: 'reservado', job_id: concessao.job.id, attempt: concessao.job.attempt });
      const promessa = this.processar(concessao, vaga).finally(() => { this.emCurso.delete(promessa); });
      this.emCurso.add(promessa);
    }
    await this.encerrar();
  }

  /** Espera os jobs em curso; passado o prazo, aborta o que restar. */
  private async encerrar(): Promise<void> {
    if (this.emCurso.size === 0) return;
    const prazo = new Promise<'prazo'>((resolver) => {
      const relogio = setTimeout(() => { resolver('prazo'); }, this.opcoes.prazoEncerramentoMs);
      relogio.unref?.();
    });
    const fim = await Promise.race([Promise.allSettled([...this.emCurso]).then(() => 'fim' as const), prazo]);
    if (fim === 'prazo') {
      this.abortarTudo.abort();
      await Promise.allSettled([...this.emCurso]);
    }
  }

  private async processar(concessao: Concessao, vaga: Vaga): Promise<void> {
    const { fila, manipuladores, anotar } = this.opcoes;
    const { job, lease_token } = concessao;
    const manipulador = manipuladores[job.tipo];
    const controlador = new AbortController();
    const abortar = () => { controlador.abort(); };
    this.abortarTudo.signal.addEventListener('abort', abortar, { once: true });
    // Quem pediu o cancelamento foi o leitor (ou o heartbeat perdeu a concessão)? Só então o
    // `cancelado` do executor é o desfecho do job; a parada do próprio worker não é.
    let cancelamentoDoJob = job.cancel_requested_at !== null;
    if (cancelamentoDoJob) controlador.abort();
    const tarefa: Tarefa = { job, lease_token, sinal: controlador.signal };
    const raiz = this.opcoes.auditoria;
    const auditar = <T>(acao: () => Promise<T>): Promise<T> => (raiz === undefined ? acao()
      : comAuditoria({ job_id: job.id, tipo: job.tipo, attempt: job.attempt, raiz }, acao));

    const batida = setInterval(() => {
      void fila.heartbeat(job.id, lease_token).then(
        (estado) => { if (estado.cancelamento_pedido) { cancelamentoDoJob = true; controlador.abort(); } },
        () => { cancelamentoDoJob = true; controlador.abort(); },
      );
    }, this.opcoes.heartbeatMs);
    batida.unref?.();

    try {
      if (!manipulador) {
        await fila.falhar(job.id, lease_token, resultadoDoJob(job, lease_token, {
          estado: 'falhou', codigo: 'desconhecido',
          mensagem: `Nenhum manipulador registrado para o tipo ${job.tipo}.`, duracao_ms: 0,
        }));
        anotar?.({ evento: 'falhou', job_id: job.id, attempt: job.attempt, detalhe: 'sem manipulador' });
        return;
      }
      const execucao = await auditar(() => manipulador.executar(tarefa));
      const resultado = resultadoDoJob(job, lease_token, execucao);
      if (execucao.estado === 'adiado') {
        await fila.adiar(job.id, lease_token, resultado);
        anotar?.({ evento: 'adiado', job_id: job.id, attempt: job.attempt, detalhe: execucao.not_before.toISOString() });
        return;
      }
      if (execucao.estado === 'falhou' && execucao.codigo === 'cancelado' && !cancelamentoDoJob && this.abortarTudo.signal.aborted) {
        // O worker está parando (reinício, deploy) e abortou o job no prazo: não é falha do job. Não
        // grava nada; a concessão vence e `expirarConcessoes` o devolve à fila com a espera de sempre.
        anotar?.({ evento: 'interrompido', job_id: job.id, attempt: job.attempt, detalhe: 'parada do worker' });
        return;
      }
      if (execucao.estado === 'falhou') {
        await fila.falhar(job.id, lease_token, resultado);
        anotar?.({
          evento: execucao.codigo === 'cancelado' ? 'cancelado' : 'falhou',
          job_id: job.id, attempt: job.attempt, detalhe: execucao.codigo,
        });
        return;
      }
      try {
        await auditar(() => fila.publicar(job.id, lease_token, (contexto) => manipulador.publicar(tarefa, execucao, contexto)));
        anotar?.({ evento: 'publicado', job_id: job.id, attempt: job.attempt });
      } catch (erro) {
        if (erro instanceof ConcessaoPerdida) {
          // A tentativa perdeu a concessão: nada foi escrito e o job volta à fila.
          anotar?.({ evento: 'concessao_perdida', job_id: job.id, attempt: job.attempt });
          return;
        }
        const detalhe = erro instanceof Error ? erro.message : 'erro desconhecido na publicação';
        await fila.falhar(job.id, lease_token, resultadoDoJob(job, lease_token, {
          estado: 'falhou', codigo: 'desconhecido', mensagem: detalhe, duracao_ms: execucao.duracao_ms,
        })).catch(() => undefined);
        anotar?.({ evento: 'falhou', job_id: job.id, attempt: job.attempt, detalhe });
      }
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : 'erro desconhecido no manipulador';
      anotar?.({ evento: 'erro', job_id: job.id, attempt: job.attempt, detalhe });
    } finally {
      clearInterval(batida);
      this.abortarTudo.signal.removeEventListener('abort', abortar);
      await vaga.devolver();
    }
  }
}
