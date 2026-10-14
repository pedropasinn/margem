/**
 * Quadro enviado em WebP (no teste do J133, "Educação Obrigatória" foi enviada assim): a imagem chega íntegra ao
 * preparo, convertida em JPEG com as mesmas dimensões, pelo ffmpeg configurado (MARGEM_FFMPEG no app
 * de computador, onde o ffmpeg não está no PATH). Precisa do ffmpeg com libwebp; sem ele, pula.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { formatoPelaAssinatura, normalizadorComFfmpeg } from './imagem-enviada.js';

const comWebp = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes('libwebp') === true;
const pastas: string[] = [];
afterAll(async () => { for (const p of pastas) await rm(p, { recursive: true, force: true }); });

test.skipIf(!comWebp)('WebP vira JPEG íntegro, com as mesmas dimensões, mesmo com o ffmpeg fora do PATH', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-j133-webp-'));
  pastas.push(pasta);
  const origem = join(pasta, 'educacao.webp');
  expect(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=96x64', '-frames:v', '1', '-c:v', 'libwebp', origem]).status).toBe(0);
  expect(formatoPelaAssinatura(new Uint8Array(await readFile(origem)))).toBe('webp');
  // O app de computador aponta MARGEM_FFMPEG/MARGEM_FFPROBE para os binários que leva; o PATH não os tem.
  const binarios = join(pasta, 'bin');
  await mkdir(binarios);
  const onde = (nome: string) => spawnSync('which', [nome], { encoding: 'utf8' }).stdout.trim();
  await symlink(onde('ffmpeg'), join(binarios, 'ffmpeg-do-app'));
  await symlink(onde('ffprobe'), join(binarios, 'ffprobe-do-app'));
  const antes = { PATH: process.env.PATH, MARGEM_FFMPEG: process.env.MARGEM_FFMPEG, MARGEM_FFPROBE: process.env.MARGEM_FFPROBE };
  process.env.MARGEM_FFMPEG = join(binarios, 'ffmpeg-do-app');
  process.env.MARGEM_FFPROBE = join(binarios, 'ffprobe-do-app');
  process.env.PATH = '/nao-existe';
  try {
    const destino = join(pasta, 'imagem.jpg');
    const resultado = await normalizadorComFfmpeg()(origem, destino, 'webp');
    expect(resultado).toEqual({ largura: 96, altura: 64, convertida: true });
    expect(formatoPelaAssinatura(new Uint8Array(await readFile(destino)))).toBe('jpeg');
  } finally {
    for (const [chave, valor] of Object.entries(antes)) { if (valor === undefined) delete process.env[chave]; else process.env[chave] = valor; }
  }
});
