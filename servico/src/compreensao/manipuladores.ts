/**
 * Registra no `Worker` os quatro jobs da compreensão (J29/J30). A parte demorada (o `codex exec`) roda
 * fora de transação; a escrita final, dentro da transação que a fila entrega na publicação.
 */
import type { JobResultV1 } from '@margem/contratos';
import type { ExecucaoOk } from '../executor/tipos.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import {
  TIPO_ANALISAR, TIPO_PLANEJAR, TIPO_REVISAR_CAPITULO, TIPO_SINTETIZAR, executarAnalise, executarPlano, executarRevisaoDoCapitulo,
  executarSintese, publicarAnalise, publicarPlano, publicarRevisaoDoCapitulo, publicarSintese, type ConfiguracaoDaCompreensao,
} from './pipeline.js';

type Publicador = (config: ConfiguracaoDaCompreensao, cliente: Parameters<typeof publicarAnalise>[1], chave: string, jobId: string,
  execucao: ExecucaoOk) => Promise<JobResultV1['diagnosticos']>;

function publicar(config: ConfiguracaoDaCompreensao, publicador: Publicador, chave: (contexto: ContextoPublicacao) => string) {
  return async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
    const diagnosticos = await publicador(config, exigirTransacao(contexto), chave(contexto), contexto.job.id, execucao);
    return {
      job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
      estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 }, diagnosticos,
    };
  };
}

function parteDo(contexto: ContextoPublicacao | Tarefa): string {
  const parte = entradaDoJob(contexto.job.entrada).parte_id;
  if (parte === null) throw new Error('Job de análise sem parte.');
  return parte;
}
function chaveDo(contexto: ContextoPublicacao | Tarefa): string { return entradaDoJob(contexto.job.entrada).dedup_key; }

export function manipuladoresDaCompreensao(config: ConfiguracaoDaCompreensao): Record<string, Manipulador> {
  return {
    [TIPO_ANALISAR]: {
      executar: (tarefa) => executarAnalise(config, parteDo(tarefa), tarefa.sinal),
      publicar: publicar(config, publicarAnalise, parteDo),
    },
    [TIPO_SINTETIZAR]: {
      executar: (tarefa) => executarSintese(config, chaveDo(tarefa), tarefa.sinal),
      publicar: publicar(config, publicarSintese, chaveDo),
    },
    [TIPO_REVISAR_CAPITULO]: {
      executar: (tarefa) => executarRevisaoDoCapitulo(config, chaveDo(tarefa), tarefa.sinal),
      publicar: publicar(config, publicarRevisaoDoCapitulo, chaveDo),
    },
    [TIPO_PLANEJAR]: {
      executar: (tarefa) => executarPlano(config, chaveDo(tarefa), tarefa.sinal),
      publicar: publicar(config, publicarPlano, chaveDo),
    },
  };
}
