/**
 * Complemento da parada pelo IPC (`margem:parar`, que o serviço já trata depois de subir; J114):
 *
 * - pedido ANTES de o serviço registrar a parada (ainda preparando banco e executor): nada foi
 *   reservado da fila e a migração roda em transação, então sair já é seguro;
 * - canal fechado (o app caiu): pede a parada como um SIGTERM, para o filho não ficar órfão segurando o
 *   banco;
 * - o canal não segura o processo: quando o worker termina o laço, o processo sai sozinho.
 */
import { MENSAGEM_DE_PARADA } from '../../servico/src/plataforma/processos.js';

export function encerrarPorMensagem(): void {
  const subindo = (): boolean => process.listenerCount('SIGTERM') === 0;
  process.on('message', (mensagem: unknown) => {
    const tipo = typeof mensagem === 'object' && mensagem !== null ? (mensagem as { tipo?: unknown }).tipo : mensagem;
    if (tipo === MENSAGEM_DE_PARADA && subindo()) process.exit(0);
  });
  process.on('disconnect', () => {
    if (subindo()) process.exit(0);
    process.emit('SIGTERM');
  });
  process.channel?.unref();
}
