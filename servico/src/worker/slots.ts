import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Limite **global** de execuções simultâneas do Codex na máquina.
 *
 * Protocolo: um arquivo por vaga em `~/.cache/margem/codex-slots/`, criado com `wx`
 * (exclusivo). O conteúdo é `{"pid":N,"desde":"<ISO>","dono":"..."}`. Tomar a vaga é
 * criar o arquivo; devolvê-la é removê-lo. Um arquivo cujo `pid` não existe mais é
 * resto de processo morto e pode ser removido por qualquer interessado, que então
 * tenta criar o arquivo de novo. Outros projetos na mesma máquina respeitam o mesmo
 * limite usando o mesmo diretório.
 */
export const SLOTS_PADRAO = 4;

export function diretorioSlots(): string {
  return process.env.MARGEM_SLOTS_DIR ?? join(homedir(), '.cache/margem/codex-slots');
}

export interface Vaga {
  indice: number;
  caminho: string;
  devolver: () => Promise<void>;
}

interface Ocupante { pid?: unknown; desde?: unknown; dono?: unknown }

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    // EPERM significa que o processo existe e pertence a outro usuário.
    return (erro as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function ocupanteMorto(caminho: string): Promise<boolean> {
  try {
    const bruto = JSON.parse(await readFile(caminho, 'utf8')) as Ocupante;
    if (typeof bruto.pid !== 'number' || !Number.isInteger(bruto.pid) || bruto.pid <= 0) return true;
    return !vivo(bruto.pid);
  } catch {
    // Arquivo ilegível ou vazio: resto de uma escrita interrompida.
    return true;
  }
}

/** Tenta tomar uma vaga. Devolve `undefined` quando todas estão ocupadas por processos vivos. */
export async function tomarVaga(
  opcoes: { slots?: number; diretorio?: string; dono?: string } = {},
): Promise<Vaga | undefined> {
  const slots = opcoes.slots ?? SLOTS_PADRAO;
  const diretorio = opcoes.diretorio ?? diretorioSlots();
  await mkdir(diretorio, { recursive: true, mode: 0o700 });
  for (const tentativa of [0, 1]) {
    for (let indice = 0; indice < slots; indice += 1) {
      const caminho = join(diretorio, `slot-${String(indice)}`);
      try {
        const arquivo = await open(caminho, 'wx', 0o600);
        try {
          await arquivo.writeFile(JSON.stringify({
            pid: process.pid,
            desde: new Date().toISOString(),
            dono: opcoes.dono ?? 'margem-worker',
          }));
        } finally {
          await arquivo.close();
        }
        return {
          indice,
          caminho,
          devolver: async () => { await rm(caminho, { force: true }); },
        };
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code !== 'EEXIST') throw erro;
        // Só na primeira passada recolhemos vagas de processos mortos.
        if (tentativa === 0 && await ocupanteMorto(caminho)) await rm(caminho, { force: true });
      }
    }
  }
  return undefined;
}

/** Espera uma vaga, conferindo a cada `intervaloMs`; desiste se o sinal abortar. */
export async function aguardarVaga(
  opcoes: { slots?: number; diretorio?: string; dono?: string; intervaloMs?: number; sinal?: AbortSignal } = {},
): Promise<Vaga | undefined> {
  const intervaloMs = opcoes.intervaloMs ?? 250;
  for (;;) {
    if (opcoes.sinal?.aborted) return undefined;
    const vaga = await tomarVaga(opcoes);
    if (vaga) return vaga;
    await new Promise<void>((resolver) => setTimeout(resolver, intervaloMs));
  }
}
