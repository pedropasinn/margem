/**
 * Imagem de uma questão (J119): o print ou a foto que a pessoa cola ou solta na biblioteca.
 *
 * Aqui só se confere o que chega (assinatura, tamanho, dimensões pelo cabeçalho, sem decodificar) e
 * se chama o motor, que transforma a imagem num PDF de uma página (`margem_motor.imagem`). O serviço
 * aceita PNG e JPEG; WebP e HEIC são reconhecidos para a recusa dizer o que fazer (o navegador os
 * converte em PNG antes do envio).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { raizDoRepositorio } from '../dados.js';
import { ambienteSaneado } from '../executor/ambiente.js';
import { comandoDoMotor } from '../plataforma/executaveis.js';

/** Um print cabe com folga; uma foto de celular em JPEG também. */
export const LIMITE_DA_QUESTAO_BYTES = 25 * 1024 * 1024;
/** O mesmo teto do motor: acima disso é foto de câmera profissional ou bomba de descompressão. */
export const PIXELS_MAXIMOS = 40_000_000;
const PRAZO_DA_CONVERSAO_MS = 60_000;

export type FormatoDaImagem = 'png' | 'jpeg';
export interface CabecalhoDaImagem { formato: FormatoDaImagem; largura: number; altura: number }
export type LeituraDoCabecalho = CabecalhoDaImagem | { recusa: 'outro_formato'; nome: string } | { recusa: 'desconhecido' | 'ilegivel' };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const comeca = (bytes: Uint8Array, prefixo: readonly number[], deslocamento = 0) => prefixo.every((valor, i) => bytes[deslocamento + i] === valor);
const ascii = (bytes: Uint8Array, inicio: number, fim: number) => String.fromCharCode(...bytes.subarray(inicio, fim));
const be16 = (bytes: Uint8Array, i: number) => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
const be32 = (bytes: Uint8Array, i: number) => (be16(bytes, i) * 65536) + be16(bytes, i + 2);

/** Dimensões do JPEG pelo primeiro SOF, sem decodificar. */
function dimensoesDoJpeg(bytes: Uint8Array): { largura: number; altura: number } | null {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    while (bytes[i] === 0xff && i < bytes.length) i++;
    const marcador = bytes[i] ?? 0;
    i++;
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) continue;
    if (marcador === 0xd9 || marcador === 0xda) return null;
    const tamanho = be16(bytes, i);
    if (tamanho < 2) return null;
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      if (i + 7 > bytes.length) return null;
      return { altura: be16(bytes, i + 3), largura: be16(bytes, i + 5) };
    }
    i += tamanho;
  }
  return null;
}

/** O que a imagem é, pela assinatura, e o tamanho dela, pelo cabeçalho. */
export function lerCabecalhoDaImagem(bytes: Uint8Array): LeituraDoCabecalho {
  if (comeca(bytes, PNG)) {
    if (bytes.length < 24 || ascii(bytes, 12, 16) !== 'IHDR') return { recusa: 'ilegivel' };
    return { formato: 'png', largura: be32(bytes, 16), altura: be32(bytes, 20) };
  }
  if (comeca(bytes, [0xff, 0xd8, 0xff])) {
    const dimensoes = dimensoesDoJpeg(bytes);
    return dimensoes ? { formato: 'jpeg', ...dimensoes } : { recusa: 'ilegivel' };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { recusa: 'outro_formato', nome: 'WebP' };
  if (ascii(bytes, 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(ascii(bytes, 8, 12))) {
    return { recusa: 'outro_formato', nome: ascii(bytes, 8, 12) === 'avif' ? 'AVIF' : 'HEIC' };
  }
  if (ascii(bytes, 0, 4) === 'GIF8') return { recusa: 'outro_formato', nome: 'GIF' };
  return { recusa: 'desconhecido' };
}

export interface ImagemConvertida { pdf: Uint8Array; png: Uint8Array; largura: number; altura: number }

export class ImagemRecusadaPeloMotor extends Error {}

/** Chama o subcomando `imagem` do motor (`margem-motor imagem` ou `python -m margem_motor.imagem`) numa pasta temporária e lê o PDF e o PNG que ele grava. */
export async function converterImagemEmPdf(bytes: Uint8Array, raiz: string = raizDoRepositorio()): Promise<ImagemConvertida> {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-questao-'));
  try {
    const entrada = join(pasta, 'imagem');
    const saida = join(pasta, 'saida');
    await writeFile(entrada, bytes, { mode: 0o600 });
    const { codigo, stdout, stderr } = await new Promise<{ codigo: number | null; stdout: string; stderr: string }>((resolver, rejeitar) => {
      const comando = comandoDoMotor('imagem', ['--entrada', entrada, '--saida', saida], { raiz });
      const processo = spawn(comando.programa, comando.argumentos, {
        cwd: comando.cwd, env: ambienteSaneado(), stdio: ['ignore', 'pipe', 'pipe'],
      });
      let saidaPadrao = '';
      let erro = '';
      processo.stdout.setEncoding('utf8');
      processo.stderr.setEncoding('utf8');
      processo.stdout.on('data', (pedaco: string) => { saidaPadrao = `${saidaPadrao}${pedaco}`.slice(-4_000); });
      processo.stderr.on('data', (pedaco: string) => { erro = `${erro}${pedaco}`.slice(-2_000); });
      const prazo = setTimeout(() => { processo.kill('SIGKILL'); }, PRAZO_DA_CONVERSAO_MS);
      processo.on('error', (falha) => { clearTimeout(prazo); rejeitar(falha); });
      processo.on('close', (codigoDeSaida) => { clearTimeout(prazo); resolver({ codigo: codigoDeSaida, stdout: saidaPadrao, stderr: erro }); });
    });
    if (codigo === 2) throw new ImagemRecusadaPeloMotor(stderr.trim().split('\n').at(-1) ?? 'Imagem recusada.');
    if (codigo !== 0) throw new Error(`O motor não converteu a imagem (saída ${String(codigo)}).`);
    const dados = JSON.parse(stdout) as { largura: number; altura: number };
    const [pdf, png] = await Promise.all([readFile(join(saida, 'questao.pdf')), readFile(join(saida, 'questao.png'))]);
    return { pdf: new Uint8Array(pdf), png: new Uint8Array(png), largura: dados.largura, altura: dados.altura };
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

/** "Questão de 13/10/2026", na data local da instalação. */
export function tituloDaQuestao(agora: Date): string {
  const dia = String(agora.getDate()).padStart(2, '0');
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  return `Questão de ${dia}/${mes}/${String(agora.getFullYear())}`;
}
