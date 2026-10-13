import type { CodigoFalha } from './tipos.js';

const COTA = /usage limit|quota|rate limit|too many requests|429|limite de uso/i;
const AUTH = /not logged in|please (?:log|sign) in|authentication required|unauthorized|401|refresh_token|login required|authentication token.*invalid/i;

export type Classe = 'cota' | 'auth' | CodigoFalha;

/** Classifica o fim de um processo do Codex a partir do stderr acumulado. */
export function classificarSaida(stderr: string, codigoSaida: number | null): Classe {
  if (COTA.test(stderr)) return 'cota';
  if (AUTH.test(stderr)) return 'auth';
  if (codigoSaida === null) return 'processo';
  return 'desconhecido';
}

const MINUTOS_PADRAO = 60;

/**
 * Extrai o horário de volta anunciado pela CLI. Sem anúncio legível, adia sessenta minutos.
 * Aceita data ISO, "in N minutes/hours" e "at HH:MM" (próxima ocorrência).
 */
export function horarioDeVolta(stderr: string, agora: Date = new Date()): Date {
  const iso = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(stderr);
  if (iso?.[1]) {
    const quando = new Date(iso[1].replace(' ', 'T'));
    if (!Number.isNaN(quando.getTime())) return quando;
  }
  const relativo = /in\s+(\d+)\s*(second|minute|hour|segundo|minuto|hora)/i.exec(stderr);
  if (relativo?.[1] && relativo[2]) {
    const quantidade = Number(relativo[1]);
    const unidade = relativo[2].toLowerCase();
    const fator = unidade.startsWith('s') ? 1_000 : unidade.startsWith('m') ? 60_000 : 3_600_000;
    return new Date(agora.getTime() + quantidade * fator);
  }
  const relogio = /(?:resets?|try again|volta)[^0-9\n]{0,20}(\d{1,2}):(\d{2})/i.exec(stderr);
  if (relogio?.[1] && relogio[2]) {
    const hora = Number(relogio[1]);
    const minuto = Number(relogio[2]);
    if (hora < 24 && minuto < 60) {
      const quando = new Date(agora);
      quando.setHours(hora, minuto, 0, 0);
      if (quando.getTime() <= agora.getTime()) quando.setDate(quando.getDate() + 1);
      return quando;
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
