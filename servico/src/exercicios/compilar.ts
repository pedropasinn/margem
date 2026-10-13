/**
 * Compila o `.tex` dos exercícios com o tectonic (XeTeX num binário só, sem instalação do TeX Live;
 * os pacotes vêm do pacote padrão e ficam no cache do usuário depois da primeira vez).
 *
 * Quando um exercício não compila, ele volta no modo seguro (fórmulas como código) ou, em último caso,
 * sai com um aviso, e o resto do livro continua desenhado: as linhas apontadas no erro dizem qual foi.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { montarTex, type DocumentoDoTex, type ExercicioParaExportar } from './latex.js';

export class LatexIndisponivel extends Error {}

export function binarioDoTectonic(): string | null {
  const escolhido = process.env.MARGEM_TECTONIC?.trim();
  if (escolhido) return existsSync(escolhido) ? escolhido : null;
  const local = join(homedir(), '.local/bin/tectonic');
  if (existsSync(local)) return local;
  const caminhos = (process.env.PATH ?? '').split(':').map((pasta) => join(pasta, 'tectonic'));
  return caminhos.find((caminho) => existsSync(caminho)) ?? null;
}

interface Compilacao { ok: boolean; pdf?: Buffer; log: string }

async function compilarUmaVez(binario: string, tex: string, prazoMs: number): Promise<Compilacao> {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-latex-'));
  try {
    await writeFile(join(pasta, 'exercicios.tex'), tex, 'utf8');
    const log = await new Promise<{ codigo: number | null; texto: string }>((resolver, rejeitar) => {
      const processo = spawn(binario, ['-X', 'compile', '--untrusted', 'exercicios.tex'], { cwd: pasta, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      const juntar = (pedaco: Buffer) => { texto = (texto + pedaco.toString()).slice(-60_000); };
      processo.stdout.on('data', juntar);
      processo.stderr.on('data', juntar);
      const relogio = setTimeout(() => processo.kill('SIGKILL'), prazoMs);
      processo.on('error', (erro) => { clearTimeout(relogio); rejeitar(erro); });
      processo.on('close', (codigo) => { clearTimeout(relogio); resolver({ codigo, texto }); });
    });
    if (log.codigo !== 0) return { ok: false, log: log.texto };
    return { ok: true, pdf: await readFile(join(pasta, 'exercicios.pdf')), log: log.texto };
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

/** As linhas do `.tex` apontadas nos erros (`exercicios.tex:123:` do tectonic, `l.123` do TeX). */
export function linhasComErro(log: string): number[] {
  const linhas = [...log.matchAll(/exercicios\.tex:(\d+):/g), ...log.matchAll(/^l\.(\d+)\s/gm)].map((achado) => Number(achado[1]));
  return [...new Set(linhas)].filter((linha) => Number.isSafeInteger(linha) && linha > 0);
}

export interface PdfDosExercicios { pdf: Buffer; seguros: string[]; omitidos: string[] }

/**
 * Compila. A cada falha, os exercícios das linhas com erro descem um degrau: primeiro o modo seguro
 * (fórmulas como código), depois saem do PDF com um aviso. Sem linha apontada, todos vão ao modo seguro.
 */
export async function compilarExercicios(documento: DocumentoDoTex, exercicios: readonly ExercicioParaExportar[], prazoMs = 240_000): Promise<PdfDosExercicios> {
  const binario = binarioDoTectonic();
  if (!binario) throw new LatexIndisponivel('O tectonic não está instalado (~/.local/bin/tectonic ou MARGEM_TECTONIC).');
  const seguros = new Set<string>();
  const omitidos = new Set<string>();
  let ultimoLog = '';
  for (let tentativa = 0; tentativa < 6; tentativa += 1) {
    const { tex, linhas } = montarTex(documento, exercicios, seguros, omitidos);
    const resultado = await compilarUmaVez(binario, tex, prazoMs);
    if (resultado.ok && resultado.pdf) return { pdf: resultado.pdf, seguros: [...seguros], omitidos: [...omitidos] };
    ultimoLog = resultado.log;
    const culpados = new Set(linhasComErro(resultado.log).flatMap((linha) => linhas.filter((faixa) => faixa.inicio <= linha && linha <= faixa.fim).map((faixa) => faixa.id)));
    let mudou = false;
    for (const id of culpados) {
      if (omitidos.has(id)) continue;
      if (seguros.has(id)) omitidos.add(id); else seguros.add(id);
      mudou = true;
    }
    if (!mudou) {
      if (seguros.size === exercicios.length) break;
      for (const ex of exercicios) seguros.add(ex.sessao.id);
    }
  }
  throw new Error(`O LaTeX não compilou: ${ultimoLog.split('\n').filter((linha) => /error|!/.test(linha)).slice(0, 6).join(' | ')}`);
}
