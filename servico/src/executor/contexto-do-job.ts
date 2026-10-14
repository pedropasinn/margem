/**
 * O job em curso, visto de dentro do executor (V-T10).
 *
 * O `Worker` roda cada `executar` dentro de `comJob`; quem embrulha o executor (a escolha de modelo
 * por categoria, `modelos/executor.ts`) sabe assim de que tipo de job veio a chamada sem mudar a
 * assinatura de nenhum manipulador. Fora do worker (testes de unidade, ferramentas), não há job.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface JobEmCurso {
  id: string;
  tipo: string;
}

const armazenamento = new AsyncLocalStorage<JobEmCurso>();

export function comJob<T>(job: JobEmCurso, acao: () => Promise<T>): Promise<T> {
  return armazenamento.run(job, acao);
}

export function jobEmCurso(): JobEmCurso | undefined {
  return armazenamento.getStore();
}
