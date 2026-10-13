import type { JobResultV1 } from '@margem/contratos';
import type { Executor } from '../src/executor/tipos.js';
import { resultadoDoJob } from '../src/worker/worker.js';
import type { Manipulador, Tarefa } from '../src/worker/worker.js';
import type { ContextoPublicacao } from '../src/worker/fila.js';
import type { ExecucaoOk } from '../src/executor/tipos.js';

export interface EntradaTeste {
  diretorioEntrada: string;
  prompt: string;
  schema: string;
  prazoMs?: number;
  diretorioArtefatos?: string;
}

function lerEntrada(valor: unknown): EntradaTeste {
  const bruto = valor as Partial<EntradaTeste> | null;
  if (!bruto || typeof bruto.diretorioEntrada !== 'string' || typeof bruto.prompt !== 'string' || typeof bruto.schema !== 'string') {
    throw new Error('Entrada do job de teste incompleta.');
  }
  return { ...bruto, diretorioEntrada: bruto.diretorioEntrada, prompt: bruto.prompt, schema: bruto.schema };
}

/**
 * Manipulador exclusivo dos testes do worker; não é registrado pela aplicação.
 */
export function manipuladorDeTeste(executor: Executor): Manipulador {
  return {
    executar: (tarefa: Tarefa) => {
      const entrada = lerEntrada(tarefa.job.entrada);
      return executor({
        diretorioEntrada: entrada.diretorioEntrada,
        prompt: entrada.prompt,
        schema: entrada.schema,
        prazoMs: entrada.prazoMs ?? 600_000,
        sinal: tarefa.sinal,
        diretorioArtefatos: entrada.diretorioArtefatos,
      });
    },
    publicar: (tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> =>
      Promise.resolve(resultadoDoJob(contexto.job, contexto.lease_token, execucao)),
  };
}
