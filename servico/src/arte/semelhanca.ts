/**
 * Semelhança perceptual entre imagens de obras (V-T2): "é o mesmo quadro?" sem rede nem Codex.
 *
 * O SHA-256 só reconhece os mesmos bytes; a pessoa sobe a obra em WebP, reduzida, recortada ou com outra
 * cor, e o SHA muda. O pHash (DCT 32×32 da imagem em cinza, 8×8 frequências baixas, bit = acima da
 * mediana) sobrevive a recompressão, mudança de escala, brilho e saturação. O recorte muda o pHash; por
 * isso a comparação procura, na referência, janelas com a proporção da imagem enviada (e o contrário),
 * e fica com a menor distância.
 *
 * Distância de Hamming entre hashes de 64 bits (a menor entre as janelas). Medido com as obras de
 * exemplo: variações em WebP, reduzidas, recortadas até 75 %, com moldura e menos saturação ficaram
 * entre 0 e 8; obras diferentes e imagens sintéticas, entre 20 e 26 (`semelhanca.test.ts`).
 */
import { spawn } from 'node:child_process';
import { ffmpeg } from '../plataforma/executaveis.js';
import { opcoesDeProcesso } from '../plataforma/processos.js';

/** Imagem em tons de cinza, linha a linha (0..255). */
export interface Cinza { largura: number; altura: number; pixels: Uint8Array }
/** Uma janela da imagem, em pixels. */
export interface Janela { x: number; y: number; largura: number; altura: number }

/** Até aqui, a mesma obra (com folga para recorte, recompressão e cor). */
export const LIMIAR_MESMA_OBRA = 10;
/** Daqui para cima, obras diferentes; entre os dois, só o Codex olhando as duas imagens decide. */
export const LIMIAR_OBRA_DIFERENTE = 24;
/** Lado maior da imagem decodificada para comparar. */
export const LADO_DA_COMPARACAO = 256;

const N = 32;
const COSSENOS: Float64Array = (() => {
  const c = new Float64Array(N * N);
  for (let k = 0; k < N; k += 1) for (let n = 0; n < N; n += 1) c[k * N + n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N));
  return c;
})();

/** Reduz uma janela da imagem a 32×32 pela média das áreas (sem serrilhado). */
export function reduzir(imagem: Cinza, janela: Janela = { x: 0, y: 0, largura: imagem.largura, altura: imagem.altura }): Float64Array {
  const saida = new Float64Array(N * N);
  const passoX = janela.largura / N, passoY = janela.altura / N;
  for (let j = 0; j < N; j += 1) {
    const y0 = janela.y + j * passoY, y1 = y0 + passoY;
    for (let i = 0; i < N; i += 1) {
      const x0 = janela.x + i * passoX, x1 = x0 + passoX;
      let soma = 0, peso = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
        const py = Math.min(y + 1, y1) - Math.max(y, y0);
        if (py <= 0 || y >= imagem.altura) continue;
        const linha = y * imagem.largura;
        for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
          const px = Math.min(x + 1, x1) - Math.max(x, x0);
          if (px <= 0 || x >= imagem.largura) continue;
          soma += imagem.pixels[linha + x]! * px * py;
          peso += px * py;
        }
      }
      saida[j * N + i] = peso > 0 ? soma / peso : 0;
    }
  }
  return saida;
}

/** pHash de 64 bits de uma imagem 32×32: DCT-II, frequências 0..7 em cada eixo, bit = acima da mediana (sem o DC). */
export function phash(reduzida: Float64Array): bigint {
  const linhas = new Float64Array(8 * N);
  for (let v = 0; v < 8; v += 1) for (let x = 0; x < N; x += 1) {
    let s = 0; for (let y = 0; y < N; y += 1) s += reduzida[y * N + x]! * COSSENOS[v * N + y]!;
    linhas[v * N + x] = s;
  }
  const coeficientes: number[] = [];
  for (let v = 0; v < 8; v += 1) for (let u = 0; u < 8; u += 1) {
    let s = 0; for (let x = 0; x < N; x += 1) s += linhas[v * N + x]! * COSSENOS[u * N + x]!;
    coeficientes.push(s);
  }
  const semDc = coeficientes.slice(1).sort((a, b) => a - b);
  const mediana = (semDc[31]! + semDc[32]!) / 2;
  let hash = 0n;
  for (let k = 0; k < 64; k += 1) if (k > 0 && coeficientes[k]! > mediana) hash |= 1n << BigInt(k);
  return hash;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b, n = 0;
  while (x) { x &= x - 1n; n += 1; }
  return n;
}

const FRACOES = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7];
const POSICOES = [0, 0.5, 1];

/** Janelas da referência com a proporção `proporcao` (largura/altura), de 70 % a 100 % de cada lado. */
export function janelasComProporcao(imagem: Cinza, proporcao: number, tolerancia = 0.06): Janela[] {
  const janelas: Janela[] = [{ x: 0, y: 0, largura: imagem.largura, altura: imagem.altura }];
  for (const fl of FRACOES) for (const fa of FRACOES) {
    if (fl === 1 && fa === 1) continue;
    const largura = imagem.largura * fl, altura = imagem.altura * fa;
    if (Math.abs(largura / altura / proporcao - 1) > tolerancia) continue;
    for (const px of POSICOES) for (const py of POSICOES) {
      if ((fl === 1 && px !== 0) || (fa === 1 && py !== 0)) continue;
      janelas.push({ x: (imagem.largura - largura) * px, y: (imagem.altura - altura) * py, largura, altura });
    }
  }
  return janelas;
}

/**
 * Menor distância entre a imagem enviada e a referência, aceitando que uma seja recorte da outra: a
 * enviada inteira contra janelas da referência com a proporção dela, e a referência inteira contra
 * janelas da enviada.
 */
export function distanciaPerceptual(enviada: Cinza, referencia: Cinza): number {
  const hashEnviada = phash(reduzir(enviada));
  const hashReferencia = phash(reduzir(referencia));
  let menor = hamming(hashEnviada, hashReferencia);
  for (const j of janelasComProporcao(referencia, enviada.largura / enviada.altura)) menor = Math.min(menor, hamming(hashEnviada, phash(reduzir(referencia, j))));
  for (const j of janelasComProporcao(enviada, referencia.largura / referencia.altura)) menor = Math.min(menor, hamming(hashReferencia, phash(reduzir(enviada, j))));
  return menor;
}

/** PGM binário (P5) → imagem em cinza. */
export function lerPgm(bytes: Uint8Array): Cinza {
  let pos = 0;
  const campos: string[] = [];
  while (campos.length < 4) {
    while (pos < bytes.length && /\s/u.test(String.fromCharCode(bytes[pos]!))) pos += 1;
    if (bytes[pos] === 0x23) { while (pos < bytes.length && bytes[pos] !== 0x0a) pos += 1; continue; }
    let campo = '';
    while (pos < bytes.length && !/\s/u.test(String.fromCharCode(bytes[pos]!))) { campo += String.fromCharCode(bytes[pos]!); pos += 1; }
    if (campo === '') throw new Error('pgm_truncado');
    campos.push(campo);
  }
  pos += 1;
  const [magica, l, a, maximo] = campos;
  const largura = Number(l), altura = Number(a);
  if (magica !== 'P5' || maximo !== '255' || !(largura > 0) || !(altura > 0) || bytes.length - pos < largura * altura) throw new Error('pgm_invalido');
  return { largura, altura, pixels: bytes.slice(pos, pos + largura * altura) };
}

/** Decodifica qualquer imagem que o ffmpeg leia (JPEG, PNG, WebP) em cinza, com o lado maior de 256 px. */
export function decodificarEmCinza(caminho: string, lado = LADO_DA_COMPARACAO): Promise<Cinza> {
  const filtro = `scale=w=${String(lado)}:h=${String(lado)}:force_original_aspect_ratio=decrease:flags=area,format=gray`;
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(ffmpeg(), ['-v', 'error', '-i', caminho, '-vf', filtro, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'pgm', '-'], { stdio: ['ignore', 'pipe', 'pipe'], ...opcoesDeProcesso() });
    const partes: Buffer[] = [];
    let erro = '';
    filho.stdout.on('data', (b: Buffer) => { partes.push(b); });
    filho.stderr.on('data', (b: Buffer) => { erro = (erro + b.toString()).slice(-2000); });
    filho.on('error', rejeitar);
    filho.on('close', (codigo) => {
      if (codigo !== 0) { rejeitar(new Error(`ffmpeg saiu com ${String(codigo)}: ${erro}`)); return; }
      try { resolver(lerPgm(new Uint8Array(Buffer.concat(partes)))); } catch (e) { rejeitar(e instanceof Error ? e : new Error(String(e))); }
    });
  });
}

/** Distância perceptual entre dois arquivos de imagem. */
export async function distanciaEntreArquivos(enviada: string, referencia: string): Promise<number> {
  return distanciaPerceptual(await decodificarEmCinza(enviada), await decodificarEmCinza(referencia));
}
