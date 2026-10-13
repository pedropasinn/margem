/**
 * Registra no `Worker` do J05 os manipuladores de leitura do J06.
 *
 * A parte demorada (o `codex exec`) roda fora de transação; a escrita final roda
 * dentro da transação que a fila do Postgres entrega em `ContextoPublicacao.transacao`.
 */
import type { JobResultV1 } from '@margem/contratos';
import type { ExecucaoOk, ResultadoExecutor } from '../executor/tipos.js';
import {
  TIPO_LER_PARTE, TIPO_REVISAR, executarLerParte, executarRevisarConsistencia,
  execucaoDoDedup, publicarNaTransacao, type ConfiguracaoDaLeitura,
} from '../leitura/manipuladores.js';
import { exigirTransacao } from './canonizar.js';
import { entradaDoJob } from './fila-postgres.js';
import type { ContextoPublicacao } from './fila.js';
import type { Manipulador, Tarefa } from './worker.js';

function publicar(config: ConfiguracaoDaLeitura) {
  return (tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
    const entrada = entradaDoJob(contexto.job.entrada);
    return publicarNaTransacao(config, exigirTransacao(contexto), {
      id: contexto.job.id, tipo: contexto.job.tipo, attempt: contexto.job.attempt,
      parte_id: entrada.parte_id, dedup_key: entrada.dedup_key,
    }, contexto.lease_token, execucao);
  };
}

export function manipuladoresDaLeitura(config: ConfiguracaoDaLeitura): Record<string, Manipulador> {
  return {
    [TIPO_LER_PARTE]: {
      executar: (tarefa: Tarefa): Promise<ResultadoExecutor> => {
        const entrada = entradaDoJob(tarefa.job.entrada);
        if (entrada.parte_id === null) throw new Error('Job de leitura sem parte.');
        return executarLerParte(config, entrada.parte_id, tarefa.sinal);
      },
      publicar: publicar(config),
    },
    [TIPO_REVISAR]: {
      executar: (tarefa: Tarefa): Promise<ResultadoExecutor> =>
        executarRevisarConsistencia(config, execucaoDoDedup(entradaDoJob(tarefa.job.entrada).dedup_key), tarefa.sinal),
      publicar: publicar(config),
    },
  };
}
