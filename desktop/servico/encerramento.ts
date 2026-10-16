/**
 * Complemento da parada pelo IPC (`margem:parar`, que o serviço já trata depois de subir; J114):
 *
 * - pedido ANTES de o serviço registrar a parada (ainda preparando banco e executor): nada foi
 *   reservado da fila e a migração roda em transação, então sair já é seguro;
 * - canal fechado (o app caiu, ou foi encerrado pelo gerenciador de tarefas): pede a parada como um
 *   SIGTERM, para o filho não ficar órfão segurando o banco;
 * - prazo (L-07): pedida a parada, o processo sai em `prazoMs` mesmo que algo o segure (um SSE aberto
 *   por um navegador impede o `servidor.close()` de terminar). Com o app no ar, o supervisor também tem o
 *   prazo dele; sem o app, este é o único;
 * - sem o app (L-06), quem tem `aoPerderOPai` (o worker) o roda antes de sair: para o Postgres da
 *   biblioteca, que nenhum outro processo vivo vai parar. Os grupos do Codex que ainda rodam saem antes;
 * - o canal não segura o processo: quando o worker termina o laço, o processo sai sozinho.
 */
import { encerrarGrupoOrfao, gruposAbertos, MENSAGEM_DE_PARADA } from '../../servico/src/plataforma/processos.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerLock, parar as pararPostgres } from '../src/nucleo/postgres.js';

export interface OpcoesDoEncerramento {
  /** Pedida a parada, sair no máximo depois disto (padrão: 10 s). */
  prazoMs?: number;
  /** O app sumiu: o que fazer antes de sair (uma vez só). */
  aoPerderOPai?: () => Promise<void>;
}

export interface Encerramento {
  /** O canal com o app caiu sem pedido de parada. */
  semPai: () => boolean;
  /** Roda o `aoPerderOPai` (uma vez), se o app sumiu. */
  limparSemPai: () => Promise<void>;
}

function registrar(evento: string, detalhe: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evento, ...detalhe, em: new Date().toISOString() }));
}

export function encerrarPorMensagem(opcoes: OpcoesDoEncerramento = {}): Encerramento {
  const subindo = (): boolean => process.listenerCount('SIGTERM') === 0;
  let semPai = false;
  let limpeza: Promise<void> | null = null;
  const limparSemPai = (): Promise<void> => {
    if (!semPai || opcoes.aoPerderOPai === undefined) return Promise.resolve();
    limpeza ??= opcoes.aoPerderOPai().catch((erro: unknown) => {
      registrar('limpeza_sem_app_falhou', { detalhe: erro instanceof Error ? erro.message : String(erro) });
    });
    return limpeza;
  };
  let prazo: NodeJS.Timeout | null = null;
  const armarPrazo = (): void => {
    if (prazo !== null) return;
    prazo = setTimeout(() => {
      registrar('encerramento_estourou', { prazo_ms: opcoes.prazoMs ?? 10_000, sem_app: semPai });
      // Sem o app ninguém recolhe os grupos do Codex: saem aqui (L-03).
      const grupos = semPai ? gruposAbertos() : [];
      void Promise.all(grupos.map((pid) => encerrarGrupoOrfao(pid))).then(limparSemPai).finally(() => process.exit(0));
    }, opcoes.prazoMs ?? 10_000);
    prazo.unref();
  };
  process.on('message', (mensagem: unknown) => {
    const tipo = typeof mensagem === 'object' && mensagem !== null ? (mensagem as { tipo?: unknown }).tipo : mensagem;
    if (tipo !== MENSAGEM_DE_PARADA) return;
    if (subindo()) process.exit(0);
    armarPrazo();
  });
  process.on('disconnect', () => {
    semPai = true;
    // O app levou junto a outra ponta dos pipes de saída: escrever neles dá EPIPE, que não pode derrubar
    // o processo antes de ele parar o banco.
    for (const fluxo of [process.stdout, process.stderr]) fluxo.on('error', () => undefined);
    registrar('app_sumiu');
    if (subindo()) { void limparSemPai().finally(() => process.exit(0)); return; }
    armarPrazo();
    process.emit('SIGTERM');
  });
  process.channel?.unref();
  return { semPai: () => semPai, limparSemPai };
}

/** O Postgres que estava no ar (pid e início do `postmaster.pid`); `null` sem lock legível. */
export interface BancoVisto { pid: number; inicio: number | null }

export function bancoNoAr(ambiente: NodeJS.ProcessEnv = process.env): BancoVisto | null {
  const pasta = ambiente.MARGEM_PG_DADOS?.trim();
  if (!pasta) return null;
  try {
    const info = lerLock(readFileSync(join(pasta, 'postmaster.pid'), 'utf8'));
    return info === null ? null : { pid: info.pid, inicio: info.inicio };
  } catch {
    return null;
  }
}

/**
 * Para o Postgres da biblioteca (L-06) pelo `pg_ctl stop -m fast` que o app usaria, com o `pg_ctl` e a
 * pasta que o app passou (`MARGEM_PG_CTL`, `MARGEM_PG_DADOS`). Só o MESMO servidor que o worker viu ao
 * nascer (`visto`, R-02): se o app já reabriu e subiu outro Postgres na pasta, este fica. O lock
 * continua como segunda defesa: a próxima abertura recupera o que sobrar.
 */
export async function pararBancoSemDono(ambiente: NodeJS.ProcessEnv = process.env, visto: BancoVisto | null = bancoNoAr(ambiente)): Promise<void> {
  const pgCtl = ambiente.MARGEM_PG_CTL?.trim();
  const pasta = ambiente.MARGEM_PG_DADOS?.trim();
  if (!pgCtl || !pasta) return;
  const agora = bancoNoAr(ambiente);
  if (agora === null) { registrar('banco_parado_sem_app', { ok: true, ja_parado: true }); return; }
  if (visto === null || agora.pid !== visto.pid || agora.inicio !== visto.inicio) {
    registrar('banco_de_outra_sessao', { ok: true });
    return;
  }
  const ok = await pararPostgres({ pgCtl, initdb: '', postgres: '', origem: 'embutido' }, pasta);
  registrar('banco_parado_sem_app', { ok });
}
