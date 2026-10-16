/**
 * Subprocessos nos três sistemas (J114): opções de `spawn` e encerramento da árvore.
 *
 * - **Linux e macOS**: o filho nasce líder do próprio grupo (`detached`) quando precisamos encerrar a
 *   árvore inteira; o encerramento manda o sinal ao grupo (`kill(-pid)`), e cai no próprio filho se o
 *   grupo já não existir.
 * - **Windows**: não há grupos de processos nem SIGTERM. `detached` lá abriria um console novo, então
 *   não é usado; a árvore é encerrada pelo `taskkill /T` do próprio sistema (`%SystemRoot%\System32`,
 *   nunca pelo PATH). Sem `/F` é o pedido educado (equivale ao SIGTERM); com `/F`, à força (SIGKILL).
 *   O `taskkill` só existe no Windows; se falhar, cai no `kill()` do Node, que encerra só o filho.
 */
import { execFile, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { join } from 'node:path';

export type Plataforma = NodeJS.Platform;
/** `suave`: pede para sair (SIGTERM / taskkill sem /F). `forcado`: encerra (SIGKILL / taskkill /F). */
export type ModoDeEncerramento = 'suave' | 'forcado';

/**
 * Opções comuns de `spawn`/`execFile` para um programa externo: nunca por shell (os argumentos vão como
 * estão, sem aspas nem expansão) e, no Windows, sem janela de console.
 * `arvore`: o filho vai ser encerrado com a árvore inteira (só muda algo fora do Windows).
 */
export function opcoesDeProcesso(plataforma: Plataforma = process.platform, arvore = false): Pick<SpawnOptions, 'shell' | 'windowsHide' | 'detached'> {
  return { shell: false, windowsHide: true, ...(arvore && plataforma !== 'win32' ? { detached: true } : {}) };
}

/** O `taskkill` do sistema, pelo caminho absoluto (`%SystemRoot%\System32\taskkill.exe`). */
export function caminhoDoTaskkill(ambiente: NodeJS.ProcessEnv = process.env): string {
  const sistema = ambiente.SystemRoot ?? ambiente.SYSTEMROOT ?? ambiente.windir ?? 'C:\\Windows';
  return join(sistema, 'System32', 'taskkill.exe');
}

/** Argumentos do `taskkill` para a árvore de um pid. */
export function argumentosDoTaskkill(pid: number, modo: ModoDeEncerramento): string[] {
  return ['/PID', String(pid), '/T', ...(modo === 'forcado' ? ['/F'] : [])];
}

export interface Encerrador {
  plataforma?: Plataforma;
  /** Troca o `process.kill` (testes). */
  matar?: (pid: number, sinal: NodeJS.Signals) => void;
  /** Troca a chamada ao `taskkill` (testes). */
  rodarTaskkill?: (programa: string, argumentos: string[]) => Promise<boolean>;
  ambiente?: NodeJS.ProcessEnv;
}

const taskkillPadrao = (programa: string, argumentos: string[]): Promise<boolean> =>
  new Promise((resolver) => {
    execFile(programa, argumentos, { windowsHide: true, timeout: 15_000 }, (erro) => { resolver(erro === null); });
  });

/**
 * Encerra o filho e, quando dá, os netos. Nunca lança: processo que já saiu não é erro.
 * `grupo`: o filho nasceu com `detached` (fora do Windows) e lidera um grupo próprio.
 */
export async function encerrarArvore(
  filho: Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'kill'>,
  modo: ModoDeEncerramento,
  opcoes: Encerrador & { grupo?: boolean } = {},
): Promise<void> {
  const plataforma = opcoes.plataforma ?? process.platform;
  const sinal: NodeJS.Signals = modo === 'forcado' ? 'SIGKILL' : 'SIGTERM';
  const pid = filho.pid;
  // `!= null`: processo encerrado tem código ou sinal; os dublês dos testes nem têm os campos.
  if (filho.exitCode != null || filho.signalCode != null) return;
  const proprio = () => { try { filho.kill(sinal); } catch { /* já saiu */ } };
  // Sem pid (o spawn falhou ou ainda não houve): só o próprio objeto, sem grupo nem taskkill.
  if (pid === undefined) { proprio(); return; }
  if (plataforma === 'win32') {
    const rodar = opcoes.rodarTaskkill ?? taskkillPadrao;
    const ok = await rodar(caminhoDoTaskkill(opcoes.ambiente), argumentosDoTaskkill(pid, modo)).catch(() => false);
    // Sem /F o programa pode recusar (console sem janela não recebe WM_CLOSE): o suave vira forçado
    // pelo Node, que no Windows sempre termina o processo (TerminateProcess).
    if (!ok || modo === 'suave') proprio();
    return;
  }
  if (opcoes.grupo === true) {
    const matar = opcoes.matar ?? ((alvo: number, s: NodeJS.Signals) => { process.kill(alvo, s); });
    try { matar(-pid, sinal); return; } catch { /* grupo já desfeito: cai no próprio filho */ }
  }
  proprio();
}

/**
 * Este módulo é o ponto de entrada do processo? Compara o fim de `process.argv[1]` com barras normais:
 * no Windows o caminho vem com `\` (`C:\…\servico\src\api.ts`) e o `endsWith('src/api.ts')` falhava.
 */
export function ehPontoDeEntrada(sufixos: readonly string[], argumento: string | undefined = process.argv[1]): boolean {
  const caminho = (argumento ?? '').replaceAll('\\', '/');
  return sufixos.some((sufixo) => caminho.endsWith(sufixo));
}

/** Mensagem de parada pelo canal IPC do processo pai (o app de desktop, J113). */
export const MENSAGEM_DE_PARADA = 'margem:parar';

/**
 * Chama `parar` quando pedirem a parada: SIGTERM/SIGINT (Linux, macOS, systemd, Docker), SIGBREAK
 * (Ctrl+Break no console do Windows) e, se o processo tiver canal IPC, a mensagem `margem:parar` ou
 * `{ tipo: 'margem:parar' }`. No Windows não há SIGTERM entre processos: é pelo IPC que o app de
 * desktop pede a parada limpa antes do `taskkill`.
 */
export function aoPedirParada(parar: (origem: string) => void, processo: NodeJS.Process = process): void {
  const sinais: NodeJS.Signals[] = processo.platform === 'win32' ? ['SIGINT', 'SIGBREAK', 'SIGTERM'] : ['SIGTERM', 'SIGINT'];
  for (const sinal of sinais) processo.on(sinal, () => { parar(sinal); });
  if (typeof processo.send === 'function') {
    processo.on('message', (mensagem: unknown) => {
      const tipo = typeof mensagem === 'object' && mensagem !== null ? (mensagem as { tipo?: unknown }).tipo : mensagem;
      if (tipo === MENSAGEM_DE_PARADA) parar('ipc');
    });
  }
}

/**
 * Subprocessos que lideram o próprio grupo (o Codex, `opcoesDeProcesso(…, true)`) não morrem com o grupo
 * de quem os abriu (L-03). Quem os abre os anuncia aqui: o processo guarda a lista (para o próprio prazo de
 * encerramento) e, com canal IPC, conta ao pai (o supervisor do app de computador), que encerra os que
 * sobrarem quando este processo morrer — inclusive de OOM ou à força, quando nada daqui roda mais.
 */
export const MENSAGEM_DE_GRUPO = 'margem:grupo';

export interface AvisoDeGrupo { tipo: typeof MENSAGEM_DE_GRUPO; acao: 'abrir' | 'fechar'; pid: number }

const gruposAtivos = new Set<number>();

/** Os grupos anunciados que ainda não saíram. */
export function gruposAbertos(): number[] {
  return [...gruposAtivos];
}

export function anunciarGrupo(
  filho: { pid?: number | undefined; once?: (evento: 'exit', ouvinte: () => void) => unknown },
  processo: Pick<NodeJS.Process, 'send' | 'connected'> = process,
): void {
  const pid = filho.pid;
  if (typeof pid !== 'number' || typeof filho.once !== 'function') return;
  const avisar = (acao: AvisoDeGrupo['acao']): void => {
    if (typeof processo.send !== 'function' || processo.connected !== true) return;
    try { processo.send({ tipo: MENSAGEM_DE_GRUPO, acao, pid } satisfies AvisoDeGrupo); } catch { /* canal fechado */ }
  };
  gruposAtivos.add(pid);
  avisar('abrir');
  filho.once('exit', () => { gruposAtivos.delete(pid); avisar('fechar'); });
}

export function ehAvisoDeGrupo(mensagem: unknown): mensagem is AvisoDeGrupo {
  if (typeof mensagem !== 'object' || mensagem === null) return false;
  const aviso = mensagem as Partial<AvisoDeGrupo>;
  return aviso.tipo === MENSAGEM_DE_GRUPO && (aviso.acao === 'abrir' || aviso.acao === 'fechar') && Number.isInteger(aviso.pid) && (aviso.pid ?? 0) > 0;
}

/**
 * Encerra à força um grupo cujo dono já morreu (sem o objeto `ChildProcess`): `kill(-pid)` no Linux e no
 * macOS, `taskkill /T /F` no Windows. Nunca lança.
 */
export async function encerrarGrupoOrfao(pid: number, opcoes: Encerrador = {}): Promise<void> {
  const plataforma = opcoes.plataforma ?? process.platform;
  if (plataforma === 'win32') {
    const rodar = opcoes.rodarTaskkill ?? taskkillPadrao;
    await rodar(caminhoDoTaskkill(opcoes.ambiente), argumentosDoTaskkill(pid, 'forcado')).catch(() => false);
    return;
  }
  const matar = opcoes.matar ?? ((alvo: number, s: NodeJS.Signals) => { process.kill(alvo, s); });
  try { matar(-pid, 'SIGKILL'); } catch { /* grupo já desfeito */ }
}
