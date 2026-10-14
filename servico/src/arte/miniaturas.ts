/**
 * Miniatura leve de cada quadro (capa na Biblioteca): gerada uma vez e guardada em cache. No acervo, em
 * `<obra>/.cache/miniatura-<lado>.jpg`; nas fixtures (ou num acervo só de leitura), no diretório
 * temporário do sistema. Pillow do `python3` do sistema; sem ele, o PyMuPDF do motor (`motor/.venv`, o que
 * a imagem Docker tem: J110, ou o motor congelado do app de desktop: J114); por fim `ffmpeg`. Sem
 * dependência nova. Com o motor congelado (`MARGEM_MOTOR`) o `python3` do sistema não é tentado: no
 * Windows ele pode ser o atalho da loja, e o motor já basta.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { renomearComRetentativa } from '../plataforma/disco.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { comandoDoMotor, ffmpeg, motorCongelado } from '../plataforma/executaveis.js';

const executar = promisify(execFile);
export const LADO_DA_MINIATURA = 640;

const SCRIPT_PIL = [
  'import sys',
  'from PIL import Image, ImageOps',
  'im = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert("RGB")',
  'lado = int(sys.argv[3])',
  'im.thumbnail((lado, lado), Image.LANCZOS)',
  'im.save(sys.argv[2], "JPEG", quality=82, optimize=True, progressive=True)',
].join('\n');


async function gerar(origem: string, destino: string, lado: number): Promise<void> {
  const temporario = `${destino}.${String(process.pid)}.${String(Date.now())}.tmp.jpg`;
  const doMotor = comandoDoMotor('miniatura', [origem, temporario, String(lado)]);
  const tentativas: [string, string[]][] = [
    ...(motorCongelado() === undefined ? [['python3', ['-c', SCRIPT_PIL, origem, temporario, String(lado)]] as [string, string[]]] : []),
    [doMotor.programa, doMotor.argumentos],
    [ffmpeg(), ['-y', '-loglevel', 'error', '-i', origem, '-vf', `scale='min(${String(lado)},iw)':'min(${String(lado)},ih)':force_original_aspect_ratio=decrease`, '-q:v', '4', temporario]],
  ];
  let ultimo: unknown = null;
  for (const [programa, argumentos] of tentativas) {
    try {
      await executar(programa, argumentos, { timeout: 60_000, windowsHide: true });
      await renomearComRetentativa(temporario, destino);
      return;
    } catch (erro) { ultimo = erro; }
  }
  throw ultimo instanceof Error ? ultimo : new Error('miniatura_indisponivel');
}

const emCurso = new Map<string, Promise<string>>();

async function fresca(destino: string, origem: string): Promise<boolean> {
  if (!existsSync(destino)) return false;
  const [a, b] = await Promise.all([stat(destino), stat(origem)]);
  return a.mtimeMs >= b.mtimeMs && a.size > 0;
}

/** Caminho da miniatura pronta (gera na primeira vez, ou se a imagem mudou). */
export async function miniaturaDe(obra: { slug: string; pasta: string | null; imagem: string }, lado = LADO_DA_MINIATURA): Promise<string> {
  const candidatos = [
    ...(obra.pasta ? [join(obra.pasta, '.cache')] : []),
    join(tmpdir(), 'margem-arte-miniaturas', obra.slug),
  ];
  for (const pasta of candidatos) {
    const destino = join(pasta, `miniatura-${String(lado)}.jpg`);
    if (await fresca(destino, obra.imagem)) return destino;
  }
  const chave = `${obra.imagem}:${String(lado)}`;
  const andando = emCurso.get(chave);
  if (andando) return andando;
  const tarefa = (async () => {
    let ultimo: unknown = null;
    for (const pasta of candidatos) {
      const destino = join(pasta, `miniatura-${String(lado)}.jpg`);
      try { await mkdir(pasta, { recursive: true }); await gerar(obra.imagem, destino, lado); return destino; }
      catch (erro) { ultimo = erro; }
    }
    throw ultimo instanceof Error ? ultimo : new Error('miniatura_indisponivel');
  })();
  emCurso.set(chave, tarefa);
  try { return await tarefa; } finally { emCurso.delete(chave); }
}
