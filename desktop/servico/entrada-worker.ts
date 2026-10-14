/** Entrada do worker dentro do app de computador (ver `entrada-api.ts`). */
import { principal } from '../../servico/src/worker/main.js';
import { encerrarPorMensagem } from './encerramento.js';

encerrarPorMensagem();
principal().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : 'falha desconhecida no worker');
  process.exitCode = 1;
});
