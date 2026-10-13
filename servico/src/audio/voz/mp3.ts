/**
 * Leitura mínima de MP3 (MPEG-1/2/2.5, camada III) para o provedor de voz (J106): duração exata pela
 * contagem de quadros e junção de pedaços sem ffmpeg. Os pedaços vêm do mesmo provedor no mesmo formato,
 * então juntar é concatenar os quadros, tirando as etiquetas ID3 de cada um.
 */

const TAXAS_DE_BITS: Record<'1' | '2', readonly number[]> = {
  // kbit/s por índice (0 = livre, 15 = inválido), camada III.
  '1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  '2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const AMOSTRAGENS: Record<number, readonly number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export interface QuadroMp3 { inicio: number; tamanho: number; amostras: number; taxa: number }

/** Cabeçalho de quadro em `posicao`, ou null se não for um quadro de camada III válido. */
export function lerQuadro(bytes: Uint8Array, posicao: number): QuadroMp3 | null {
  if (posicao + 4 > bytes.length) return null;
  const b1 = bytes[posicao]!, b2 = bytes[posicao + 1]!, b3 = bytes[posicao + 2]!;
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;
  const versao = (b2 >> 3) & 0b11; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5, 1 = reservado
  const camada = (b2 >> 1) & 0b11; // 1 = camada III
  if (versao === 1 || camada !== 1) return null;
  const kbps = TAXAS_DE_BITS[versao === 3 ? '1' : '2'][(b3 >> 4) & 0x0f] ?? 0;
  const taxa = AMOSTRAGENS[versao]?.[(b3 >> 2) & 0b11];
  if (!kbps || taxa === undefined) return null;
  const preenchimento = (b3 >> 1) & 1;
  const amostras = versao === 3 ? 1152 : 576;
  const tamanho = Math.floor((amostras / 8) * kbps * 1000 / taxa) + preenchimento;
  return tamanho > 4 ? { inicio: posicao, tamanho, amostras, taxa } : null;
}

/** Tamanho da etiqueta ID3v2 no começo (0 se não houver). */
function tamanhoId3v2(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const tamanho = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
  const rodape = (bytes[5]! & 0x10) !== 0 ? 10 : 0;
  return 10 + tamanho + rodape;
}

/** Os quadros de áudio, sem ID3v2 no início nem ID3v1 no fim. Recusa arquivo que não é MP3. */
export function quadrosDoMp3(bytes: Uint8Array): QuadroMp3[] {
  let fim = bytes.length;
  if (fim >= 128 && bytes[fim - 128] === 0x54 && bytes[fim - 127] === 0x41 && bytes[fim - 126] === 0x47) fim -= 128;
  const quadros: QuadroMp3[] = [];
  let posicao = tamanhoId3v2(bytes);
  while (posicao < fim) {
    const quadro = lerQuadro(bytes, posicao);
    if (!quadro || quadro.inicio + quadro.tamanho > fim) {
      // Lixo no meio: procura o próximo sincronismo; sem quadro nenhum, não é MP3.
      posicao += 1;
      continue;
    }
    quadros.push(quadro);
    posicao += quadro.tamanho;
  }
  if (quadros.length === 0) throw new Error('O provedor devolveu um áudio que não é MP3.');
  return quadros;
}

export function duracaoDoMp3(bytes: Uint8Array): number {
  return quadrosDoMp3(bytes).reduce((total, q) => total + q.amostras / q.taxa, 0);
}

/** Junta pedaços MP3 do mesmo formato; devolve os bytes e a duração de cada pedaço. */
export function juntarMp3(pedacos: readonly Uint8Array[]): { bytes: Buffer; duracoes: number[] } {
  const partes: Buffer[] = [];
  const duracoes: number[] = [];
  for (const pedaco of pedacos) {
    const quadros = quadrosDoMp3(pedaco);
    duracoes.push(quadros.reduce((total, q) => total + q.amostras / q.taxa, 0));
    for (const q of quadros) partes.push(Buffer.from(pedaco.buffer, pedaco.byteOffset + q.inicio, q.tamanho));
  }
  return { bytes: Buffer.concat(partes), duracoes };
}

/** Quadros de silêncio (MPEG-1, 44,1 kHz, 128 kbit/s) para o provedor falso e os testes. */
export function mp3Silencioso(segundos: number): Buffer {
  const quadros = Math.max(1, Math.ceil(segundos * 44100 / 1152));
  const tamanho = 417; // 144 × 128000 / 44100, sem preenchimento
  const quadro = Buffer.alloc(tamanho);
  quadro.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat(Array.from({ length: quadros }, () => quadro));
}
