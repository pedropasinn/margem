/**
 * V-T2: semelhança perceptual. As funções puras com imagens sintéticas; com o ffmpeg, a calibragem nas
 * obras de exemplo: a cópia enviada no teste (WebP, menor, recortada, outra cor) fica perto da original e longe
 * da outra obra.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { distanciaEntreArquivos, distanciaPerceptual, hamming, janelasComProporcao, LIMIAR_MESMA_OBRA, LIMIAR_OBRA_DIFERENTE, lerPgm, phash, reduzir, type Cinza } from './semelhanca.js';

/** Imagem sintética: ondas e um retângulo, com semente. */
function sintetica(largura: number, altura: number, semente: number): Cinza {
  const pixels = new Uint8Array(largura * altura);
  for (let y = 0; y < altura; y += 1) for (let x = 0; x < largura; x += 1) {
    const v = 128 + 60 * Math.sin((x * (semente + 1)) / 17) * Math.cos((y * (semente + 2)) / 23) + ((x > largura * 0.3 && x < largura * 0.6 && y > altura * (0.2 + semente / 20) && y < altura * 0.7) ? 50 : 0);
    pixels[y * largura + x] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { largura, altura, pixels };
}
function recortar(img: Cinza, x: number, y: number, largura: number, altura: number): Cinza {
  const pixels = new Uint8Array(largura * altura);
  for (let j = 0; j < altura; j += 1) pixels.set(img.pixels.subarray((y + j) * img.largura + x, (y + j) * img.largura + x + largura), j * largura);
  return { largura, altura, pixels };
}

describe('pHash e distância', () => {
  test('hamming conta os bits diferentes', () => {
    expect(hamming(0n, 0n)).toBe(0);
    expect(hamming(0b1011n, 0b0001n)).toBe(2);
    expect(hamming((1n << 64n) - 1n, 0n)).toBe(64);
  });

  test('a mesma imagem dá distância 0; mais clara, quase 0; outra imagem, longe', () => {
    const a = sintetica(200, 260, 1);
    expect(hamming(phash(reduzir(a)), phash(reduzir(a)))).toBe(0);
    const clara = { ...a, pixels: a.pixels.map((p) => Math.min(255, p + 20)) };
    expect(distanciaPerceptual(clara, a)).toBeLessThanOrEqual(4);
    expect(distanciaPerceptual(sintetica(200, 260, 5), a)).toBeGreaterThan(LIMIAR_MESMA_OBRA);
  });

  test('um recorte da referência é achado pelas janelas com a proporção dele (e o contrário)', () => {
    const a = sintetica(240, 300, 2);
    const recorte = recortar(a, 12, 18, 216, 270);
    expect(distanciaPerceptual(recorte, a)).toBeLessThanOrEqual(LIMIAR_MESMA_OBRA);
    expect(distanciaPerceptual(a, recorte)).toBeLessThanOrEqual(LIMIAR_MESMA_OBRA);
  });

  test('janelas: sempre a imagem inteira; as outras com a proporção pedida', () => {
    const img = { largura: 200, altura: 300, pixels: new Uint8Array(200 * 300) };
    const janelas = janelasComProporcao(img, 0.8);
    expect(janelas[0]).toEqual({ x: 0, y: 0, largura: 200, altura: 300 });
    for (const j of janelas.slice(1)) {
      expect(Math.abs(j.largura / j.altura / 0.8 - 1)).toBeLessThanOrEqual(0.06);
      expect(j.x + j.largura).toBeLessThanOrEqual(200 + 1e-9);
      expect(j.y + j.altura).toBeLessThanOrEqual(300 + 1e-9);
    }
  });

  test('PGM binário: cabeçalho com comentário; truncado ou de outro tipo é recusado', () => {
    const corpo = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const pgm = new Uint8Array([...Buffer.from('P5\n# margem\n3 2\n255\n'), ...corpo]);
    expect(lerPgm(pgm)).toEqual({ largura: 3, altura: 2, pixels: corpo });
    expect(() => lerPgm(new Uint8Array([...Buffer.from('P5\n3 2\n255\n'), 1, 2]))).toThrow('pgm_invalido');
    expect(() => lerPgm(new Uint8Array(Buffer.from('P6\n1 1\n255\nabc')))).toThrow('pgm_invalido');
  });
});

const comFfmpeg = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes('libwebp') === true;
const raiz = (relativo: string) => new URL(`../../../${relativo}`, import.meta.url).pathname;
const pastas: string[] = [];
afterAll(async () => { for (const p of pastas) await rm(p, { recursive: true, force: true }); });

test.skipIf(!comFfmpeg)('calibragem nas obras de exemplo: a cópia enviada perto da original, longe da outra obra; um recorte de 75 % com moldura também', async () => {
  const educacao = raiz('web/public/arte/educacao.jpg'), tolo = raiz('web/public/arte/tolo.jpg');
  const enviada = raiz('fixtures/arte/variacoes/educacao-enviada.webp');
  expect(await distanciaEntreArquivos(enviada, educacao)).toBeLessThanOrEqual(LIMIAR_MESMA_OBRA);
  expect(await distanciaEntreArquivos(enviada, tolo)).toBeGreaterThan(LIMIAR_OBRA_DIFERENTE - 6);
  const pasta = await mkdtemp(join(tmpdir(), 'margem-vt2-sem-')); pastas.push(pasta);
  const forte = join(pasta, 'recorte.webp');
  expect(spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', educacao, '-vf', 'crop=iw*0.75:ih*0.75:iw*0.12:ih*0.1,pad=iw*1.1:ih*1.1:(ow-iw)/2:(oh-ih)/2:color=0x3a2a1a,scale=600:-2,hue=s=0.6', '-c:v', 'libwebp', '-quality', '50', forte]).status).toBe(0);
  expect(await distanciaEntreArquivos(forte, educacao)).toBeLessThanOrEqual(LIMIAR_MESMA_OBRA);
  expect(await distanciaEntreArquivos(forte, tolo)).toBeGreaterThan(LIMIAR_MESMA_OBRA);
});
