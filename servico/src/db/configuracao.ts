import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { modoInstalado } from '../instalacao.js';

/**
 * URL do Postgres. No modo padrão (desenvolvimento) só 127.0.0.1:5435; no modo instalado (J100) o banco é o
 * serviço do compose, em qualquer host e porta, mas sempre pela `DATABASE_URL` e sem parâmetros.
 */
export function lerUrlBanco(ambiente: NodeJS.ProcessEnv = process.env): URL {
  const instalado = modoInstalado(ambiente);
  let valor = ambiente.DATABASE_URL;
  if (valor === undefined && instalado) throw new Error('DATABASE_URL ausente (MARGEM_MODO=instalado).');
  if (valor === undefined) {
    try {
      valor = parseEnv(readFileSync(join(homedir(), '.config/margem/postgres.env'), 'utf8')).DATABASE_URL;
    } catch {
      throw new Error('Não foi possível ler a configuração local do Postgres.');
    }
  }
  if (!valor) throw new Error('DATABASE_URL ausente.');
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }
  // Impede que parâmetros do driver redirecionem a conexão para outro destino.
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('DATABASE_URL deve ser postgres://, sem parâmetros na URL.');
  }
  if (instalado) {
    if (url.hostname === '') throw new Error('DATABASE_URL sem host.');
    return url;
  }
  if (url.hostname !== '127.0.0.1' || url.port !== '5435') {
    throw new Error('O banco deve usar 127.0.0.1:5435, sem parâmetros na URL.');
  }
  return url;
}
