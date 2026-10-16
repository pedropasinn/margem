/**
 * Retenção da auditoria por chamada (`executor/auditoria.ts`): `<raiz>/jobs/<job>/tentativa-<n>/` guarda
 * o prompt exato, os arquivos de entrada, a resposta e os metadados de cada chamada ao Codex, isto é, cópias
 * do texto dos documentos. Elas ficam 30 dias (o suficiente para entender um defeito) e saem antes quando
 * o job é apagado junto com a análise.
 *
 * Só pastas com nome de job (ULID) diretamente em `jobs/`; qualquer outra coisa fica intacta.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ehUlid } from '../dados.js';

export const DIAS_DE_RETENCAO = 30;

function ausente(erro: unknown): boolean {
  return erro instanceof Error && 'code' in erro && (erro.code === 'ENOENT' || erro.code === 'ENOTDIR');
}

/** A escrita mais recente na pasta do job: a própria pasta ou uma das tentativas. */
async function ultimaEscrita(pasta: string): Promise<number> {
  let maior = (await stat(pasta)).mtimeMs;
  for (const entrada of await readdir(pasta, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    try { maior = Math.max(maior, (await stat(join(pasta, entrada.name))).mtimeMs); }
    catch (erro) { if (!ausente(erro)) throw erro; }
  }
  return maior;
}

/** Apaga as pastas de job sem escrita há mais de `dias`. Devolve quantas saíram. */
export async function limparAuditoriaAntiga(raiz: string, agora: Date = new Date(), dias = DIAS_DE_RETENCAO): Promise<number> {
  const base = join(raiz, 'jobs');
  let entradas;
  try { entradas = await readdir(base, { withFileTypes: true }); }
  catch (erro) { if (ausente(erro)) return 0; throw erro; }
  const limite = agora.getTime() - dias * 86_400_000;
  let apagadas = 0;
  for (const entrada of entradas) {
    if (!entrada.isDirectory() || !ehUlid(entrada.name)) continue;
    const pasta = join(base, entrada.name);
    try {
      if (await ultimaEscrita(pasta) >= limite) continue;
      await rm(pasta, { recursive: true, force: true });
      apagadas += 1;
    } catch (erro) { if (!ausente(erro)) throw erro; }
  }
  return apagadas;
}

/** Apaga a auditoria dos jobs apagados (a análise foi descartada); id que não é ULID é ignorado. */
export async function apagarAuditoriaDosJobs(raiz: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    if (!ehUlid(id)) continue;
    await rm(join(raiz, 'jobs', id), { recursive: true, force: true });
  }
}
