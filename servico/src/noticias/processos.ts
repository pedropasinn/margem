import { spawn } from 'node:child_process';
import { ffprobe } from '../plataforma/executaveis.js';
import { fileURLToPath } from 'node:url';
import type { CoberturaDeNoticiasV1, FonteDaNoticiaV1 } from '@margem/contratos';

export interface ColetaNoticias { fontes: FonteDaNoticiaV1[]; cobertura: CoberturaDeNoticiasV1[] }
export function processo(comando: string, args: string[], entrada: unknown, sinal: AbortSignal, prazo = 150_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const filho = spawn(comando, args, { stdio: ['pipe', 'pipe', 'pipe'], signal: sinal, windowsHide: true,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
    const saida: Buffer[] = []; let tamanho = 0; let erro = ''; let falha: Error | null = null;
    const tempo = setTimeout(() => { falha = new Error('Tempo de processamento esgotado.'); filho.kill('SIGKILL'); }, prazo);
    filho.stdout.on('data', (d: Buffer) => { tamanho += d.length; if (tamanho > 4_000_000) { falha = new Error('Saída excessiva.'); filho.kill('SIGKILL'); } else saida.push(d); });
    filho.stderr.on('data', (d: Buffer) => { erro = (erro + d.toString()).slice(-1500); });
    filho.on('error', e => { clearTimeout(tempo); reject(e); });
    filho.on('close', codigo => { clearTimeout(tempo); if (falha) reject(falha); else if (codigo !== 0) reject(new Error(`Processamento interrompido (${String(codigo)}). ${erro}`)); else resolve(Buffer.concat(saida).toString('utf8')); });
    filho.stdin.on('error', () => undefined);
    filho.stdin.end(entrada === null ? '' : JSON.stringify(entrada));
  });
}

export async function coletarNoticias(corte: string, vistas: string[], sinal: AbortSignal): Promise<ColetaNoticias> {
  return JSON.parse(await processo('python3', [fileURLToPath(new URL('../../../tools/noticias/coletar.py', import.meta.url))], { corte_em: corte, vistas }, sinal)) as ColetaNoticias;
}

export async function narrarNoticias(roteiro: string, saida: string, sinal: AbortSignal): Promise<number> {
  const python = process.env.MARGEM_NOTICIAS_PYTHON ?? 'python3';
  await processo(python, [fileURLToPath(new URL('../../../tools/noticias/narrar.py', import.meta.url))], { roteiro, saida }, sinal);
  return Number((await processo(ffprobe(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', saida], null, sinal, 15_000)).trim());
}
