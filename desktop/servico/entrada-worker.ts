/** Entrada do worker dentro do app de computador (ver `entrada-api.ts`). */
import { principal } from '../../servico/src/worker/main.js';
import { bancoNoAr, encerrarPorMensagem, pararBancoSemDono } from './encerramento.js';

// O worker é o último a largar o banco: sem o app (L-06), é ele quem para o Postgres, depois de devolver a
// tarefa à fila (ou no prazo, abaixo dos 45 s que o supervisor daria). Só o Postgres que estava no ar quando
// ele nasceu (R-02): o app pode ter reaberto e subido outro na mesma pasta.
const banco = bancoNoAr();
const encerramento = encerrarPorMensagem({ prazoMs: 40_000, aoPerderOPai: () => pararBancoSemDono(process.env, banco) });
principal().then(() => encerramento.limparSemPai(), (erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : 'falha desconhecida no worker');
  process.exitCode = 1;
  return encerramento.limparSemPai();
}).catch(() => undefined);
