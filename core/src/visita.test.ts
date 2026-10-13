import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { NarracaoDaVisitaV1, RoteiroGuiadoV1 } from '@margem/contratos';
import { etapaNoInstante, frasesDaFala, fraseNoInstante, inicioDaParada, montarSequenciaDaVisita, saltarParada } from './visita';

const roteiro = JSON.parse(readFileSync(new URL('../../contratos/casos/RoteiroGuiado/valido-completo.json', import.meta.url), 'utf8')) as RoteiroGuiadoV1;
const narracao: NarracaoDaVisitaV1 = {
  versao: 1, id: '01K0000000000000000000N001', roteiro_id: roteiro.id, sha256_audio: 'a'.repeat(64), voz_sha256: 'b'.repeat(64),
  job_colab: 'job_ab', receita: 'margem-poesia-omnivoice', duracao_s: 70,
  falas: roteiro.falas.map((fala, i) => ({ fala_id: fala.id, inicio_s: i * 10, fim_s: i * 10 + 9 })), criado_em: '2026-09-29T23:10:00.000Z',
};

describe('sequência da visita (J91)', () => {
  test('com narração, os tempos vêm do manifesto; cada fala sabe a parada', () => {
    const s = montarSequenciaDaVisita(roteiro, narracao);
    expect(s.narrada).toBe(true);
    expect(s.etapas.map((e) => e.parada)).toEqual([null, 1, 1, 2, 2, null, null]);
    expect(etapaNoInstante(s, 25)?.fala.id).toBe('f003');
    expect(etapaNoInstante(s, 9.5)?.fala.id).toBe('f001');
    expect(inicioDaParada(s, 2)).toBe(30);
  });
  test('narração de outro roteiro ou incompleta cai para os tempos estimados', () => {
    const outra = { ...narracao, falas: narracao.falas.slice(1) };
    expect(montarSequenciaDaVisita(roteiro, outra).narrada).toBe(false);
    const s = montarSequenciaDaVisita(roteiro, null);
    expect(s.narrada).toBe(false);
    expect(s.etapas[1]!.inicio_s).toBeGreaterThan(s.etapas[0]!.fim_s);
    expect(s.duracao_s).toBeCloseTo(s.etapas.at(-1)!.fim_s);
  });
  test('próxima e anterior pulam de parada em parada, com abertura e fechamento nas pontas', () => {
    const s = montarSequenciaDaVisita(roteiro, narracao);
    expect(saltarParada(s, 2, 1)).toBe(10);
    expect(saltarParada(s, 12, 1)).toBe(30);
    expect(saltarParada(s, 35, 1)).toBe(50);
    expect(saltarParada(s, 65, 1)).toBe(70);
    expect(saltarParada(s, 35, -1)).toBe(30);
    expect(saltarParada(s, 31, -1)).toBe(10);
    expect(saltarParada(s, 1, -1)).toBe(0);
  });
  test('frases por proporção de caracteres', () => {
    const frases = frasesDaFala('Primeira frase. Segunda, mais longa, frase! Fim');
    expect(frases.map((f) => f.texto.trim())).toEqual(['Primeira frase.', 'Segunda, mais longa, frase!', 'Fim']);
    expect(frases.at(-1)!.fim).toBe(1);
    const etapa = { indice: 0, fala: { id: 'f001', papel: 'abertura' as const, parada: null, texto: 'Um. Dois dois dois dois.' }, parada: null, inicio_s: 0, fim_s: 10 };
    expect(fraseNoInstante(etapa, 1)).toBe(0);
    expect(fraseNoInstante(etapa, 9)).toBe(1);
  });
});
