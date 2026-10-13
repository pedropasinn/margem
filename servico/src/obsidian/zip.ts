/**
 * ZIP mínimo e determinístico (deflate, nomes UTF-8, sem extras): os mesmos arquivos com as mesmas
 * datas produzem os mesmos bytes. Basta para a exportação do vault; não lê ZIP.
 */
import { deflateRawSync } from 'node:zlib';

export interface ArquivoDoZip {
  nome: string;
  conteudo: Uint8Array;
  /** Data e hora gravadas no ZIP (campos DOS, sem fuso). */
  modificado_em: Date;
}

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (TABELA_CRC[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Data DOS a partir dos campos UTC da data (quem chama decide o fuso). */
function dataDos(data: Date): { hora: number; dia: number } {
  const ano = Math.min(2107, data.getUTCFullYear());
  if (Number.isNaN(ano) || ano < 1980) return { hora: 0, dia: (1 << 5) | 1 };
  return {
    hora: (data.getUTCHours() << 11) | (data.getUTCMinutes() << 5) | Math.floor(data.getUTCSeconds() / 2),
    dia: ((ano - 1980) << 9) | ((data.getUTCMonth() + 1) << 5) | data.getUTCDate(),
  };
}

export function criarZip(arquivos: readonly ArquivoDoZip[]): Uint8Array<ArrayBuffer> {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, 'utf8');
    const comprimido = deflateRawSync(arquivo.conteudo, { level: 9 });
    const crc = crc32(arquivo.conteudo);
    const { hora, dia } = dataDos(arquivo.modificado_em);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(arquivo.conteudo.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // feito por: Unix, 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(arquivo.conteudo.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // atributos externos: arquivo comum, rw-r--r--
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);
    deslocamento += local.length + nome.length + comprimido.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return new Uint8Array(Buffer.concat([...locais, diretorio, fim]));
}
