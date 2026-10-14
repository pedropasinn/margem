import type { JobResultV1 } from '@margem/contratos';
import type { ExecucaoOk, ResultadoExecutor } from '../executor/tipos.js';
import { ConcessaoPerdida } from './fila.js';
import type { Concessao, ContextoPublicacao, FilaDeJobs, Id, Job } from './fila.js';
import { comAuditoria } from '../executor/auditoria.js';
import { comJob } from '../executor/contexto-do-job.js';
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
  /** V-W2: código de saída e classe do Codex, quando a falha veio do processo. */
  codigo_saida?: number | null;
  classe?: string;
}

/** Código do diagnóstico que leva a frase legível da causa (lida pela lista de execuções). */
export const DIAGNOSTICO_CAUSA = 'causa';
/** Código do diagnóstico com o código de saída e a classe da CLI. */
export const DIAGNOSTICO_SAIDA = 'saida_do_codex';

/** Diagnósticos informativos do fim do processo do Codex, quando o executor os trouxe. */
function diagnosticosDaSaida(execucao: ResultadoExecutor): JobResultV1['diagnosticos'] {
  if (execucao.estado === 'ok' || execucao.detalhe === undefined) return [];
  const { codigo_saida, classe, causa } = execucao.detalhe;
  return [
    ...(causa === null ? [] : [{ nivel: 'info' as const, codigo: DIAGNOSTICO_CAUSA, mensagem: causa }]),
    { nivel: 'info' as const, codigo: DIAGNOSTICO_SAIDA, mensagem: `Código de saída ${codigo_saida === null ? 'nenhum' : String(codigo_saida)} · classe ${classe}` },
  ];
}

export interface OpcoesWorker {
  fila: FilaDeJobs;
  manipuladores: Record<string, Manipulador>;
  owner?: string;
  slots?: number;
  diretorioSlots?: string;
  /**
   * Primeira pausa depois de um ciclo ocioso (sem job elegível). Ocioso, o laço espera cada vez mais,
   * dobrando até `intervaloMaximoMs` (V-W7: no Windows o laço fixo de 200 ms dava ~10 consultas por
   * segundo com o app parado). Com `esperarNovidade`, um job novo acorda o laço na hora.
   */
  intervaloMs?: number;
  /** Teto da espera ociosa (padrão 5 s): o limite de latência para um job adiado que venceu. */
  intervaloMaximoMs?: number;
  /**
   * Espera um aviso de job novo (o `NOTIFY margem_evento` do Postgres) por até `limiteMs`. Sem ela,
   * o laço só dorme o intervalo.
   */
  esperarNovidade?: (limiteMs: number, sinal: AbortSignal) => Promise<unknown>;
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
      diagnosticos: [{ nivel: 'aviso', codigo: execucao.codigo, mensagem: execucao.mensagem }, ...diagnosticosDaSaida(execucao)],
    };
  }
  return {
    ...base, estado: 'falhou',
    diagnosticos: [{ nivel: 'erro', codigo: execucao.codigo, mensagem: execucao.mensagem }, ...diagnosticosDaSaida(execucao)],
  };
}

/** Intervalo mínimo entre duas conferências do vigia de cancelamento (avisos chegam em rajada). */
export const INTERVALO_DO_VIGIA_MS = 250;

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
  private readonly opcoes: Required<Omit<OpcoesWorker, 'anotar' | 'diretorioSlots' | 'auditoria' | 'esperarNovidade'>>
    & Pick<OpcoesWorker, 'anotar' | 'diretorioSlots' | 'auditoria' | 'esperarNovidade'>;
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
      intervaloMaximoMs: 5_000,
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

  /**
   * O laço: reserva no banco primeiro e só então disputa a vaga global do Codex (V-W7). Ocioso, não
   * toca no diretório de vagas e espera com recuo crescente ou até o aviso de job novo. Cada ciclo é
   * uma tentativa de reserva; com as vagas locais cheias, o laço espera um job terminar.
   */
  async rodar(): Promise<void> {
    const { fila, manipuladores, owner, intervaloMs, intervaloMaximoMs, maximoCiclos, slots } = this.opcoes;
    const tipos = Object.keys(manipuladores);
    let ciclos = 0;
    let espera = intervaloMs;
    while (!this.parando && ciclos < maximoCiclos) {
      if (this.emCurso.size >= slots) {
        await this.esperarUmTerminar();
        continue;
      }
      ciclos += 1;
      // A espera pelo aviso começa antes da reserva: um job enfileirado durante a consulta não se perde.
      const aviso = this.esperarNovidade(espera);
      await fila.expirarConcessoes();
      const concessao = (await fila.reservar(owner, tipos, 1))[0];
      if (!concessao) {
        await (aviso ?? pausar(espera, this.pararControlador.signal));
        espera = Math.min(Math.max(espera * 2, 1), Math.max(intervaloMaximoMs, intervaloMs));
        continue;
      }
      espera = intervaloMs;
      this.opcoes.anotar?.({ evento: 'reservado', job_id: concessao.job.id, attempt: concessao.job.attempt });
      const promessa = this.processar(concessao).finally(() => { this.emCurso.delete(promessa); });
      this.emCurso.add(promessa);
    }
    await this.encerrar();
  }

  /** Vagas locais cheias: espera um job em curso terminar (ou a parada). */
  private async esperarUmTerminar(): Promise<void> {
    const parar = this.pararControlador.signal;
    if (parar.aborted) return;
    let aoParar = (): void => undefined;
    const parada = new Promise<void>((resolver) => { aoParar = resolver; parar.addEventListener('abort', aoParar, { once: true }); });
    try { await Promise.race([...this.emCurso, parada]); } finally { parar.removeEventListener('abort', aoParar); }
  }

  /** Até `ms` ou o aviso de job novo (o que vier primeiro); a parada interrompe. `null` sem ouvinte. */
  private esperarNovidade(ms: number): Promise<void> | null {
    const { esperarNovidade } = this.opcoes;
    if (!esperarNovidade) return null;
    const parar = this.pararControlador.signal;
    // Sem aviso (ouvinte caído), o relógio basta.
    return esperarNovidade(ms, parar).then(() => undefined, () => pausar(ms, parar));
  }

  /**
   * Enquanto o job roda, cada aviso do banco (no máximo a cada `INTERVALO_DO_VIGIA_MS`) confere a
   * concessão: um cancelamento (concessão revogada) ou a concessão perdida abortam o executor, que mata o
   * processo do Codex. Sem ouvinte, nada a fazer: a batida cuida disso no ritmo dela.
   */
  private async vigiarCancelamento(jobId: Id, token: Id, sinal: AbortSignal, cancelar: () => void): Promise<void> {
    const { esperarNovidade } = this.opcoes;
    if (!esperarNovidade) return;
    let ultima = 0;
    while (!sinal.aborted) {
      try { await esperarNovidade(this.opcoes.heartbeatMs, sinal); }
      catch { await pausar(this.opcoes.heartbeatMs, sinal); }
      if (sinal.aborted) return;
      const espera = ultima + INTERVALO_DO_VIGIA_MS - Date.now();
      if (espera > 0) await pausar(espera, sinal);
      if (sinal.aborted) return;
      ultima = Date.now();
      try {
        const estado = await this.opcoes.fila.heartbeat(jobId, token);
        if (estado.cancelamento_pedido && !sinal.aborted) cancelar();
      } catch {
        if (!sinal.aborted) cancelar();
      }
    }
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

  private async processar(concessao: Concessao): Promise<void> {
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
    // Cancelar pelo botão não espera a próxima batida (30 s): o cancelamento grava um evento, o aviso do
    // banco acorda este vigia e ele confere a concessão na hora (V-T8).
    const fimDaExecucao = new AbortController();
    void this.vigiarCancelamento(job.id, lease_token, AbortSignal.any([fimDaExecucao.signal, controlador.signal]),
      () => { cancelamentoDoJob = true; controlador.abort(); });

    let vaga: Vaga | undefined;
    try {
      if (!manipulador) {
        await fila.falhar(job.id, lease_token, resultadoDoJob(job, lease_token, {
          estado: 'falhou', codigo: 'desconhecido',
          mensagem: `Nenhum manipulador registrado para o tipo ${job.tipo}.`, duracao_ms: 0,
        }));
        anotar?.({ evento: 'falhou', job_id: job.id, attempt: job.attempt, detalhe: 'sem manipulador' });
        return;
      }
      // A vaga global (limite de Codex simultâneos na máquina) só é disputada com um job na mão. A
      // batida já corre: esperar a vaga não deixa a concessão vencer.
      vaga = await aguardarVaga({
        slots: this.opcoes.slots, diretorio: this.opcoes.diretorioSlots, dono: this.opcoes.owner, intervaloMs: this.opcoes.intervaloMs,
        sinal: AbortSignal.any([this.pararControlador.signal, this.abortarTudo.signal]),
      });
      if (!vaga) {
        // O worker parou antes de haver vaga: nada roda; a concessão vence e o job volta à fila.
        anotar?.({ evento: 'interrompido', job_id: job.id, attempt: job.attempt, detalhe: 'parada do worker antes da vaga' });
        return;
      }
      // O executor sabe de que tipo de job veio a chamada (escolha de modelo por categoria, V-T10).
      const execucao = await auditar(() => comJob({ id: job.id, tipo: job.tipo }, () => manipulador.executar(tarefa)));
      fimDaExecucao.abort();
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
          ...(execucao.detalhe === undefined ? {} : { codigo_saida: execucao.detalhe.codigo_saida, classe: execucao.detalhe.classe }),
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
      fimDaExecucao.abort();
      clearInterval(batida);
      this.abortarTudo.signal.removeEventListener('abort', abortar);
      await vaga?.devolver();
    }
  }
}
