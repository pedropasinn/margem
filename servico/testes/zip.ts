import { inflateRawSync } from 'node:zlib';
import { crc32 } from '../src/obsidian/zip.js';

export interface EntradaLida { nome: string; conteudo: string; dia: number; hora: number }

/** Leitor mínimo de ZIP para os testes: percorre o diretório central, descomprime e confere CRC e tamanho. */
export function lerZip(bytes: Uint8Array): EntradaLida[] {
  const dados = Buffer.from(bytes);
  const fim = dados.length - 22;
  if (dados.readUInt32LE(fim) !== 0x06054b50) throw new Error('Sem o fim do diretório central.');
  const total = dados.readUInt16LE(fim + 10);
  let posicao = dados.readUInt32LE(fim + 16);
  const arquivos: EntradaLida[] = [];
  for (let i = 0; i < total; i++) {
    if (dados.readUInt32LE(posicao) !== 0x02014b50) throw new Error('Entrada do diretório central inválida.');
    const comprimido = dados.readUInt32LE(posicao + 20);
    const tamanhoNome = dados.readUInt16LE(posicao + 28);
    const local = dados.readUInt32LE(posicao + 42);
    if (dados.readUInt32LE(local) !== 0x04034b50) throw new Error('Cabeçalho local inválido.');
    const nome = dados.subarray(posicao + 46, posicao + 46 + tamanhoNome).toString('utf8');
    const inicio = local + 30 + dados.readUInt16LE(local + 26) + dados.readUInt16LE(local + 28);
    const conteudo = inflateRawSync(dados.subarray(inicio, inicio + comprimido));
    if (crc32(new Uint8Array(conteudo)) !== dados.readUInt32LE(posicao + 16)) throw new Error(`CRC divergente em ${nome}.`);
    if (conteudo.length !== dados.readUInt32LE(posicao + 24)) throw new Error(`Tamanho divergente em ${nome}.`);
    arquivos.push({ nome, conteudo: conteudo.toString('utf8'), hora: dados.readUInt16LE(posicao + 12), dia: dados.readUInt16LE(posicao + 14) });
    posicao += 46 + tamanhoNome;
  }
  return arquivos;
}
