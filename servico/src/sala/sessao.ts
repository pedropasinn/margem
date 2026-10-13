/**
 * Sessão do testador: um cookie `HttpOnly`, `Secure`, `SameSite=Lax`, assinado com HMAC-SHA256.
 *
 * Valor: `<sessão>.<segredo>.<assinatura>`. A assinatura (chave do portão) recusa cookie forjado
 * sem ir ao banco; o segredo aleatório confere com o SHA-256 guardado em `sala_sessao`, que também
 * guarda a sala (o cookie só vale para ela), o testador e a expiração. Trocar a senha da sala ou
 * desligá-la encerra as sessões.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Id } from '@margem/contratos';

export const NOME_DO_COOKIE = 'margem_sala';
/** Três dias, ou menos se a sala vencer antes. */
export const DURACAO_PADRAO_MS = 3 * 24 * 60 * 60 * 1000;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function assinar(chave: Buffer, conteudo: string): string {
  return createHmac('sha256', chave).update(conteudo, 'utf8').digest('base64url');
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export interface CookieDaSessao { valor: string; sessaoId: Id; segredoSha256: string }

export function novoCookie(chave: Buffer, sessaoId: Id): CookieDaSessao {
  const segredo = randomBytes(32).toString('base64url');
  const conteudo = `${sessaoId}.${segredo}`;
  return { valor: `${conteudo}.${assinar(chave, conteudo)}`, sessaoId, segredoSha256: sha256(segredo) };
}

/** Confere a forma e a assinatura; devolve o id da sessão e o hash do segredo, ou `null`. */
export function lerCookie(chave: Buffer, valor: string | undefined): { sessaoId: Id; segredoSha256: string } | null {
  if (valor === undefined || valor.length > 200) return null;
  const partes = valor.split('.');
  if (partes.length !== 3) return null;
  const [sessaoId = '', segredo = '', assinatura = ''] = partes;
  if (!ULID.test(sessaoId) || !/^[A-Za-z0-9_-]{43}$/.test(segredo)) return null;
  const esperada = Buffer.from(assinar(chave, `${sessaoId}.${segredo}`));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  return { sessaoId, segredoSha256: sha256(segredo) };
}

export function cabecalhoDoCookie(valor: string, maxIdadeS: number): string {
  return `${NOME_DO_COOKIE}=${valor}; Path=/; Max-Age=${String(Math.max(0, Math.floor(maxIdadeS)))}; HttpOnly; Secure; SameSite=Lax`;
}

export function cabecalhoQueApaga(): string {
  return `${NOME_DO_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Chave do HMAC: `MARGEM_SALA_CHAVE` (≥ 32 caracteres) ou o arquivo `~/.config/margem/sala.chave`.
 * Sem nenhum dos dois, uma chave aleatória do processo: as sessões caem quando o portão reinicia.
 */
export function chaveDoPortao(anotar: (mensagem: string) => void = () => undefined): Buffer {
  const doAmbiente = process.env.MARGEM_SALA_CHAVE;
  if (doAmbiente !== undefined && doAmbiente.trim() !== '') {
    if (doAmbiente.trim().length < 32) throw new Error('MARGEM_SALA_CHAVE precisa de ao menos 32 caracteres.');
    return Buffer.from(doAmbiente.trim(), 'utf8');
  }
  try {
    const doArquivo = readFileSync(join(homedir(), '.config/margem/sala.chave'), 'utf8').trim();
    if (doArquivo.length >= 32) return Buffer.from(doArquivo, 'utf8');
  } catch { /* sem arquivo: chave do processo */ }
  anotar('sem MARGEM_SALA_CHAVE nem ~/.config/margem/sala.chave: chave aleatória; as sessões caem ao reiniciar o portão');
  return randomBytes(32);
}
