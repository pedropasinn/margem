/**
 * Tar (ustar) mínimo com gzip, sem dependência nova e sem o `tar` do sistema: o pacote do acervo de
 * quadros (`pacote.ts`) é escrito e lido aqui, igual no Linux, no macOS, no Windows e na imagem Docker.
 *
 * Só arquivos regulares. Na leitura, qualquer outro tipo (link, diretório, cabeçalho pax, dispositivo)
 * é recusado: o instalador nunca cria nada além de arquivos comuns dentro da pasta de destino.
 */
import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';

const BLOCO = 512;

export interface EntradaParaEscrever {
  /** Caminho relativo com `/` (até 255 caracteres, partido em prefixo + nome). */
  caminho: string;
  /** Arquivo de origem no disco, ou o conteúdo em memória. */
  origem: { arquivo: string } | { bytes: Buffer };
  bytes: number;
  /** Segundos desde a época (o instalador devolve a data aos arquivos). */
  mtime: number;
}

function campoOctal(valor: number, largura: number): string {
  return valor.toString(8).padStart(largura - 1, '0') + '\0';
}

function partirCaminho(caminho: string): { nome: string; prefixo: string } {
  if (Buffer.byteLength(caminho) <= 100) return { nome: caminho, prefixo: '' };
  for (let i = caminho.indexOf('/'); i >= 0; i = caminho.indexOf('/', i + 1)) {
    const prefixo = caminho.slice(0, i);
    const nome = caminho.slice(i + 1);
    if (Buffer.byteLength(prefixo) <= 155 && Buffer.byteLength(nome) <= 100) return { nome, prefixo };
  }
  throw new Error(`caminho_longo_demais: ${caminho}`);
}

export function cabecalhoUstar(caminho: string, bytes: number, mtime: number): Buffer {
  const { nome, prefixo } = partirCaminho(caminho);
  const h = Buffer.alloc(BLOCO, 0);
  h.write(nome, 0, 100, 'utf8');
  h.write(campoOctal(0o644, 8), 100, 8, 'ascii');
  h.write(campoOctal(0, 8), 108, 8, 'ascii');
  h.write(campoOctal(0, 8), 116, 8, 'ascii');
  h.write(campoOctal(bytes, 12), 124, 12, 'ascii');
  h.write(campoOctal(Math.max(0, Math.floor(mtime)), 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write('0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(prefixo, 345, 155, 'utf8');
  let soma = 0;
  for (const b of h) soma += b;
  h.write(campoOctal(soma, 7) + ' ', 148, 8, 'ascii');
  return h;
}

async function escreverNo(destino: Writable, pedaco: Buffer): Promise<void> {
  if (!destino.write(pedaco)) await once(destino, 'drain');
}

/** Escreve `arquivo` (.tar.gz) com as entradas na ordem dada. */
export async function escreverTarGz(arquivo: string, entradas: Iterable<EntradaParaEscrever>, nivel = 6): Promise<void> {
  const gzip = createGzip({ level: nivel });
  const saida = createWriteStream(arquivo, { mode: 0o644 });
  const fim = once(saida, 'close');
  gzip.pipe(saida);
  try {
    for (const entrada of entradas) {
      await escreverNo(gzip, cabecalhoUstar(entrada.caminho, entrada.bytes, entrada.mtime));
      let escritos = 0;
      if ('bytes' in entrada.origem) {
        await escreverNo(gzip, entrada.origem.bytes);
        escritos = entrada.origem.bytes.length;
      } else {
        for await (const pedaco of createReadStream(entrada.origem.arquivo)) {
          const b = pedaco as Buffer;
          escritos += b.length;
          await escreverNo(gzip, b);
        }
      }
      if (escritos !== entrada.bytes) throw new Error(`tamanho_mudou_ao_empacotar: ${entrada.caminho}`);
      const sobra = escritos % BLOCO;
      if (sobra) await escreverNo(gzip, Buffer.alloc(BLOCO - sobra, 0));
    }
    await escreverNo(gzip, Buffer.alloc(BLOCO * 2, 0));
    gzip.end();
    await fim;
  } catch (erro) {
    gzip.destroy();
    saida.destroy();
    throw erro;
  }
}

/** Leitor de bytes sobre um fluxo: pede exatamente n bytes, ou copia n bytes para um destino. */
class Leitor {
  private resto: Buffer = Buffer.alloc(0);
  private acabou = false;
  private readonly iterador: AsyncIterator<Buffer>;
  constructor(fluxo: Readable) { this.iterador = (fluxo as AsyncIterable<Buffer>)[Symbol.asyncIterator](); }

  private async encher(): Promise<boolean> {
    if (this.acabou) return false;
    const passo = await this.iterador.next();
    if (passo.done) { this.acabou = true; return false; }
    this.resto = this.resto.length ? Buffer.concat([this.resto, passo.value]) : passo.value;
    return true;
  }

  /** Exatamente `n` bytes; `null` se o fluxo acabou antes de começar; erro se acabou no meio. */
  async ler(n: number): Promise<Buffer | null> {
    while (this.resto.length < n) {
      if (!(await this.encher())) {
        if (this.resto.length === 0) return null;
        throw new Error('pacote_truncado');
      }
    }
    const parte = this.resto.subarray(0, n);
    this.resto = this.resto.subarray(n);
    return parte;
  }

  /** Repassa `n` bytes a `consumir` (em pedaços), sem juntar tudo na memória. */
  async repassar(n: number, consumir: (pedaco: Buffer) => Promise<void>): Promise<void> {
    let falta = n;
    while (falta > 0) {
      if (this.resto.length === 0 && !(await this.encher())) throw new Error('pacote_truncado');
      const parte = this.resto.subarray(0, Math.min(falta, this.resto.length));
      this.resto = this.resto.subarray(parte.length);
      falta -= parte.length;
      await consumir(parte);
    }
  }

  /** Lê e descarta até o fim (o gzip termina de conferir o CRC). */
  async esvaziar(): Promise<void> { this.resto = Buffer.alloc(0); while (await this.encher()) this.resto = Buffer.alloc(0); }
}

function lerTexto(h: Buffer, inicio: number, largura: number): string {
  const parte = h.subarray(inicio, inicio + largura);
  const zero = parte.indexOf(0);
  return parte.subarray(0, zero >= 0 ? zero : parte.length).toString('utf8');
}

function lerOctal(h: Buffer, inicio: number, largura: number): number {
  const texto = lerTexto(h, inicio, largura).trim();
  if (!/^[0-7]+$/.test(texto)) throw new Error('cabecalho_invalido');
  return Number.parseInt(texto, 8);
}

export interface EntradaLida {
  caminho: string;
  bytes: number;
  mtime: number;
}

/**
 * O que fazer com cada entrada: `null` recusa a entrada (o leitor para com erro); senão, uma função
 * que recebe os pedaços e outra chamada no fim com o SHA-256 calculado.
 */
export type AoLerEntrada = (entrada: EntradaLida) => Promise<{ pedaco: (b: Buffer) => Promise<void>; fim: (sha256: string) => Promise<void> }>;

/** Lê um .tar.gz entrada por entrada. Só arquivos regulares; o resto é erro. */
export async function lerTarGz(arquivo: string, aoLer: AoLerEntrada, limiteDeEntradas = 100_000): Promise<number> {
  const fluxo = createReadStream(arquivo).pipe(createGunzip());
  const leitor = new Leitor(fluxo);
  let entradas = 0;
  try {
    for (;;) {
      const h = await leitor.ler(BLOCO);
      if (h === null) throw new Error('pacote_truncado');
      if (h.every((b) => b === 0)) { await leitor.esvaziar(); return entradas; }
      let soma = 0;
      for (let i = 0; i < BLOCO; i += 1) soma += i >= 148 && i < 156 ? 32 : h[i]!;
      if (soma !== lerOctal(h, 148, 8)) throw new Error('cabecalho_invalido: soma de verificação');
      if (lerTexto(h, 257, 6) !== 'ustar') throw new Error('cabecalho_invalido: não é ustar');
      const tipo = String.fromCharCode(h[156]!);
      const nome = lerTexto(h, 0, 100);
      const prefixo = lerTexto(h, 345, 155);
      const caminho = prefixo ? `${prefixo}/${nome}` : nome;
      if (tipo !== '0' && tipo !== '\0') throw new Error(`tipo_de_entrada_recusado: ${caminho} (${tipo})`);
      const bytes = lerOctal(h, 124, 12);
      const mtime = lerOctal(h, 136, 12);
      entradas += 1;
      if (entradas > limiteDeEntradas) throw new Error('entradas_demais');
      const destino = await aoLer({ caminho, bytes, mtime });
      const hash: Hash = createHash('sha256');
      await leitor.repassar(bytes, async (pedaco) => { hash.update(pedaco); await destino.pedaco(pedaco); });
      const sobra = bytes % BLOCO;
      if (sobra) await leitor.ler(BLOCO - sobra);
      await destino.fim(hash.digest('hex'));
    }
  } finally {
    fluxo.destroy();
  }
}
