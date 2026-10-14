/**
 * Confinamento do Codex no Linux (contrato com o J114, `servico/src/executor/confinamento.ts`).
 *
 * O padrão do serviço no Linux é o `bwrap` do sistema. No app de computador ele pode não existir, ou o
 * Ubuntu 24.04+ pode bloquear namespaces sem privilégio pelo AppArmor. Antes de subir o serviço o app
 * testa o `bwrap` com a mesma forma de montagem que o serviço usa; se não funcionar, liga
 * `MARGEM_CONFINAMENTO=nativo` (o sandbox do próprio Codex, com o `bwrap` que vem no pacote do Codex)
 * e põe um aviso no estado da instalação. A leitura nunca fica quebrada por falta do bwrap.
 * Se a pessoa escolheu `MARGEM_CONFINAMENTO`, vale a escolha dela.
 */
import { execFile } from 'node:child_process';

export type TestarBwrap = (bwrap: string) => Promise<{ ok: boolean; detalhe: string }>;

/** Mesmo esqueleto do `montarConfinamento` do serviço, rodando só `true`. */
export function argumentosDaSonda(): string[] {
  return [
    '--die-with-parent', '--new-session', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try',
    '--ro-bind', '/usr', '/usr',
    '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '/usr/bin/true',
  ];
}

export const testarBwrapDeVerdade: TestarBwrap = (bwrap) => new Promise((resolver) => {
  execFile(bwrap, argumentosDaSonda(), { timeout: 15_000, windowsHide: true }, (erro, saida, saidaErro) => {
    resolver({ ok: erro === null, detalhe: `${saida}${saidaErro}`.trim().slice(0, 300) || (erro?.message ?? '') });
  });
});

export interface DecisaoDoConfinamento {
  /** Variáveis a acrescentar ao ambiente da API e do worker. */
  variaveis: Record<string, string>;
  /** Aviso para o estado da instalação (`MARGEM_AVISOS`), ou `null`. */
  aviso: string | null;
  /** Para o registro do app. */
  resumo: string;
}

export async function decidirConfinamento(opcoes: {
  sistema?: NodeJS.Platform; ambiente?: NodeJS.ProcessEnv; testar?: TestarBwrap;
} = {}): Promise<DecisaoDoConfinamento> {
  const sistema = opcoes.sistema ?? process.platform;
  const ambiente = opcoes.ambiente ?? process.env;
  if (sistema !== 'linux') return { variaveis: {}, aviso: null, resumo: 'nativo (padrão fora do Linux)' };
  const escolhido = ambiente.MARGEM_CONFINAMENTO?.trim();
  if (escolhido) return { variaveis: {}, aviso: null, resumo: `${escolhido} (escolha da pessoa)` };
  const bwrap = ambiente.MARGEM_BWRAP?.trim() || '/usr/bin/bwrap';
  const sonda = await (opcoes.testar ?? testarBwrapDeVerdade)(bwrap);
  if (sonda.ok) return { variaveis: {}, aviso: null, resumo: `bwrap (${bwrap})` };
  return {
    variaveis: { MARGEM_CONFINAMENTO: 'nativo' },
    aviso: 'O bubblewrap do sistema não funciona neste computador (ausente ou bloqueado pelo AppArmor). '
      + 'As leituras rodam no sandbox do próprio Codex, que também impede gravar e acessar a rede, '
      + 'mas isola menos o processo do Codex. Para o isolamento completo, instale o pacote bubblewrap.',
    resumo: `nativo (bwrap falhou: ${sonda.detalhe.slice(0, 160)})`,
  };
}
