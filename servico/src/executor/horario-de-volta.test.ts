import { expect, test } from 'vitest';
import { ESPERA_MINIMA_MS, horarioDeVolta } from './classificacao.js';

/** Horário local (a CLI anuncia no relógio da máquina): o teste vale em qualquer fuso. */
function local(dia: number, hora: number, minuto = 0): Date {
  return new Date(2026, 9, dia, hora, minuto, 0, 0);
}

test('D-11: AM/PM, meia-noite, meio-dia e virada do dia', () => {
  const dez = local(14, 10);
  expect(horarioDeVolta('Try again at 7:27 PM.', dez)).toEqual(local(14, 19, 27));
  expect(horarioDeVolta('try again at 7:27 pm', dez)).toEqual(local(14, 19, 27));
  expect(horarioDeVolta('Try again at 7:27 AM.', dez)).toEqual(local(15, 7, 27));
  expect(horarioDeVolta('Try again at 12:00 AM.', dez)).toEqual(local(15, 0, 0));
  expect(horarioDeVolta('Try again at 12:30 PM.', dez)).toEqual(local(14, 12, 30));
  expect(horarioDeVolta('Try again at 12:30 p.m.', dez)).toEqual(local(14, 12, 30));
  // Sem AM/PM, como antes: 24 horas.
  expect(horarioDeVolta('Try again at 19:27.', dez)).toEqual(local(14, 19, 27));
  expect(horarioDeVolta('Try again at 9:00.', dez)).toEqual(local(15, 9, 0));
  // AM/PM com hora impossível: formato não reconhecido, a espera padrão (60 min).
  expect(horarioDeVolta('Try again at 13:00 PM.', dez)).toEqual(local(14, 11, 0));
});

test('D-11: anúncio no passado ou imediato vira a espera mínima', () => {
  const agora = new Date('2026-10-14T12:00:00Z');
  const minimo = new Date(agora.getTime() + ESPERA_MINIMA_MS);
  expect(horarioDeVolta('usage limit; resets at 2026-10-14T11:00:00Z', agora)).toEqual(minimo);
  expect(horarioDeVolta('usage limit; retry in 0 seconds', agora)).toEqual(minimo);
  expect(horarioDeVolta('usage limit; resets at 2026-10-14T15:00:00Z', agora).toISOString()).toBe('2026-10-14T15:00:00.000Z');
  expect(horarioDeVolta('usage limit; retry in 30 minutes', agora).toISOString()).toBe('2026-10-14T12:30:00.000Z');
});
