/**
 * Senha da sala de teste: só o hash scrypt (node:crypto) vai para o banco, no formato
 * `scrypt$<N>$<r>$<p>$<sal>$<hash>` (sal e hash em base64url). A conferência é em tempo constante.
 *
 * Também gera senhas legíveis (para o leitor ditar ou colar) e o `slug` aleatório do link.
 */
import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 32_768;
const R = 8;
const P = 1;
const TAMANHO = 32;
/** 128·N·r·p = 32 MiB; o padrão do Node (32 MiB) não deixa folga. */
const MEMORIA = 64 * 1024 * 1024;
const FORMATO = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

export const SENHA_MINIMA = 8;
export const SENHA_MAXIMA = 200;

function derivar(senha: string, sal: Buffer, tamanho: number, opcoes: ScryptOptions): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    scrypt(senha.normalize('NFC'), sal, tamanho, opcoes, (erro, chave) => { if (erro) rejeitar(erro); else resolver(chave); });
  });
}

export async function hashDaSenha(senha: string): Promise<string> {
  if (senha.length < SENHA_MINIMA || senha.length > SENHA_MAXIMA) throw new Error('Senha fora do tamanho aceito.');
  const sal = randomBytes(16);
  const chave = await derivar(senha, sal, TAMANHO, { N, r: R, p: P, maxmem: MEMORIA });
  return `scrypt$${String(N)}$${String(R)}$${String(P)}$${sal.toString('base64url')}$${chave.toString('base64url')}`;
}

/** Hash fixo para gastar o mesmo tempo quando a sala não existe (ninguém descobre slugs pelo relógio). */
let hashFicticio: Promise<string> | null = null;
export function hashParaComparacaoVazia(): Promise<string> {
  hashFicticio ??= hashDaSenha(randomBytes(18).toString('base64url'));
  return hashFicticio;
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const partes = FORMATO.exec(guardado);
  if (!partes || senha.length === 0 || senha.length > SENHA_MAXIMA) return false;
  const [n, r, p] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  // Parâmetros absurdos no banco não viram negação de serviço aqui.
  if (n > 1_048_576 || r > 32 || p > 16) return false;
  const sal = Buffer.from(partes[4] ?? '', 'base64url');
  const esperado = Buffer.from(partes[5] ?? '', 'base64url');
  if (esperado.length === 0) return false;
  const obtido = await derivar(senha, sal, esperado.length, { N: n, r, p, maxmem: Math.max(MEMORIA, 256 * n * r * p) });
  return timingSafeEqual(obtido, esperado);
}

/** Sem 0/o, 1/l/i: a senha é ditada ou copiada. */
const ALFABETO_DA_SENHA = 'abcdefghjkmnpqrstuvwxyz23456789';
/** `xxxx-xxxx-xxxx`: 12 símbolos de 31, cerca de 59 bits. */
export function gerarSenha(): string {
  const grupos: string[] = [];
  for (let g = 0; g < 3; g++) {
    let grupo = '';
    for (let i = 0; i < 4; i++) grupo += ALFABETO_DA_SENHA[randomInt(ALFABETO_DA_SENHA.length)];
    grupos.push(grupo);
  }
  return grupos.join('-');
}

const ALFABETO_DO_SLUG = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Doze símbolos aleatórios: o link não revela nada e não se adivinha. */
export function gerarSlug(): string {
  let slug = '';
  for (let i = 0; i < 12; i++) slug += ALFABETO_DO_SLUG[randomInt(ALFABETO_DO_SLUG.length)];
  return slug;
}

export const SLUG_VALIDO = /^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]$/;
