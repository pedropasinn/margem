import { linhasFatais } from './stderr.js';
import type { CodigoFalha } from './tipos.js';

/**
 * Padrões com contexto (V-W2, auditoria B-07). Um `429` ou `401` soltos casavam com ids de
 * requisição, `cf-ray` e avisos que a CLI sobrevive ("failed to refresh available models:
 * unexpected status 401"): um job que falhasse por outro motivo virava "sem sessão", e um 429
 * qualquer adiava o job por uma hora.
 */
const COTA = /usage limit|usage_limit_reached|rate_limit_exceeded|insufficient_quota|quota exceeded|too many requests|status(?: code)?:? 429\b|\b429 Too Many Requests|limite de uso/iu;
const AUTH = /not logged in|please (?:log|sign) in|authentication required|login required|\b401 Unauthorized\b|status(?: code)?:? 401\b|refresh[_ ]token\b.*\b(?:invalid|expired|revoked|reused|not found)|authentication token.*invalid|token (?:has |is )?expired|plan type is required|codex login/iu;

export type Classe = 'cota' | 'auth' | CodigoFalha;

/**
 * Onde procurar a causa: as linhas `ERROR:` do fim (o desfecho que a CLI anuncia). Sem nenhuma,
 * a última linha não vazia (CLIs antigas e mensagens curtas). O resto do stderr, com os
 * registros internos e os avisos, não decide a classe.
 */
export function trechoDecisivo(stderr: string): string {
  const fatais = linhasFatais(stderr);
  if (fatais.length > 0) return fatais.join('\n');
  return stderr.split(/\r?\n/u).map((linha) => linha.trim()).filter((linha) => linha !== '').at(-1) ?? '';
}

/** Classifica o fim de um processo do Codex a partir do stderr acumulado. */
export function classificarSaida(stderr: string, codigoSaida: number | null): Classe {
  const decisivo = trechoDecisivo(stderr);
  if (COTA.test(decisivo)) return 'cota';
  if (AUTH.test(decisivo)) return 'auth';
  if (codigoSaida === null) return 'processo';
  return 'desconhecido';
}

const MINUTOS_PADRAO = 60;
/** Espera mínima (D-11): anúncio no passado ou "in 0 seconds" não pode virar nova chamada imediata. */
export const ESPERA_MINIMA_MS = 60_000;

function noFuturo(quando: Date, agora: Date): Date {
  return quando.getTime() - agora.getTime() >= ESPERA_MINIMA_MS ? quando : new Date(agora.getTime() + ESPERA_MINIMA_MS);
}

/**
 * Extrai o horário de volta anunciado pela CLI. Sem anúncio legível, adia sessenta minutos.
 * Aceita data ISO, "in N minutes/hours" e "at HH:MM", com ou sem AM/PM (próxima ocorrência, no
 * relógio local). Nunca devolve menos que `ESPERA_MINIMA_MS` à frente.
 */
export function horarioDeVolta(stderr: string, agora: Date = new Date()): Date {
  const iso = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(stderr);
  if (iso?.[1]) {
    const quando = new Date(iso[1].replace(' ', 'T'));
    if (!Number.isNaN(quando.getTime())) return noFuturo(quando, agora);
  }
  const relativo = /in\s+(\d+)\s*(second|minute|hour|segundo|minuto|hora)/i.exec(stderr);
  if (relativo?.[1] && relativo[2]) {
    const quantidade = Number(relativo[1]);
    const unidade = relativo[2].toLowerCase();
    const fator = unidade.startsWith('s') ? 1_000 : unidade.startsWith('m') ? 60_000 : 3_600_000;
    return noFuturo(new Date(agora.getTime() + quantidade * fator), agora);
  }
  const relogio = /(?:resets?|try again|volta)[^0-9\n]{0,20}(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\b\.?)?/i.exec(stderr);
  if (relogio?.[1] && relogio[2]) {
    let hora = Number(relogio[1]);
    const minuto = Number(relogio[2]);
    const meridiano = relogio[3]?.toLowerCase();
    // 12 AM é meia-noite e 12 PM, meio-dia; com AM/PM, a hora vai de 1 a 12.
    const valida = meridiano === undefined ? hora < 24 : hora >= 1 && hora <= 12;
    if (meridiano !== undefined) hora = (hora % 12) + (meridiano === 'p' ? 12 : 0);
    if (valida && minuto < 60) {
      const quando = new Date(agora);
      quando.setHours(hora, minuto, 0, 0);
      if (quando.getTime() <= agora.getTime()) quando.setDate(quando.getDate() + 1);
      return noFuturo(quando, agora);
    }
  }
  return new Date(agora.getTime() + MINUTOS_PADRAO * 60_000);
}

/** A CLI anuncia o modelo efetivo numa linha "model: <nome>". */
export function modeloDaSaida(stderr: string): string | null {
  return /^\s*model:\s*(\S+)\s*$/m.exec(stderr)?.[1] ?? null;
}

/** A CLI anuncia o esforço efetivo numa linha "reasoning effort: <nível>". */
export function esforcoDaSaida(stderr: string): string | null {
  return /^\s*reasoning effort:\s*(\S+)\s*$/m.exec(stderr)?.[1] ?? null;
}
