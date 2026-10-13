/**
 * Repetição espaçada dos flashcards: um SM-2 simplificado, com as quatro respostas do Anki.
 *
 * - 1 Errei: volta ao começo (repetições 0) e continua na fila de hoje; facilidade −0,20.
 * - 2 Difícil: intervalo × 1,2 (no mínimo 1 dia); facilidade −0,15.
 * - 3 Bom: 1 dia, depois 3, depois intervalo × facilidade.
 * - 4 Fácil: 4 dias na primeira vez, depois intervalo × facilidade × 1,3; facilidade +0,15.
 *
 * A facilidade fica entre 1,3 e 4. O cartão volta no começo do dia (horário de Brasília) da data
 * marcada, para que "amanhã" seja amanhã de manhã e não 24 horas depois.
 */
export type NotaDaRevisao = 1 | 2 | 3 | 4;

export interface EstadoDaAgenda {
  facilidade: number;
  intervalo_dias: number;
  repeticoes: number;
}

export interface Agendamento extends EstadoDaAgenda {
  proxima_revisao: Date;
}

export const ESTADO_INICIAL: EstadoDaAgenda = { facilidade: 2.5, intervalo_dias: 0, repeticoes: 0 };
export const NOTAS: readonly NotaDaRevisao[] = [1, 2, 3, 4];
export const ehNota = (valor: unknown): valor is NotaDaRevisao => NOTAS.includes(valor as NotaDaRevisao);

/** Brasília não tem horário de verão desde 2019: −03:00 o ano todo. */
const FUSO_MS = -3 * 3_600_000;
const DIA_MS = 86_400_000;

/** O começo do dia em Brasília, `dias` depois do dia de `agora`. */
export function inicioDoDia(agora: Date, dias = 0): Date {
  const local = agora.getTime() + FUSO_MS;
  return new Date(Math.floor(local / DIA_MS) * DIA_MS + dias * DIA_MS - FUSO_MS);
}

const limitar = (facilidade: number) => Math.round(Math.min(4, Math.max(1.3, facilidade)) * 100) / 100;

export function agendar(anterior: EstadoDaAgenda, nota: NotaDaRevisao, agora: Date): Agendamento {
  const { facilidade, intervalo_dias: intervalo, repeticoes } = anterior;
  if (nota === 1) return { facilidade: limitar(facilidade - 0.2), intervalo_dias: 0, repeticoes: 0, proxima_revisao: agora };
  let novo: number;
  let novaFacilidade = facilidade;
  if (nota === 2) {
    novo = Math.max(1, Math.round(intervalo * 1.2));
    novaFacilidade = facilidade - 0.15;
  } else if (nota === 3) {
    novo = repeticoes === 0 ? 1 : repeticoes === 1 ? 3 : Math.round(intervalo * facilidade);
  } else {
    novo = repeticoes === 0 ? 4 : Math.round(Math.max(intervalo, 1) * facilidade * 1.3);
    novaFacilidade = facilidade + 0.15;
  }
  novo = Math.max(1, Math.min(novo, 3650));
  return { facilidade: limitar(novaFacilidade), intervalo_dias: novo, repeticoes: repeticoes + 1, proxima_revisao: inicioDoDia(agora, novo) };
}
