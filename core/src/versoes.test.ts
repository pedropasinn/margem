import { expect, test } from 'vitest';
import type { CanonicoV1 } from '@margem/contratos';
import { hashEstrutural } from '@margem/contratos';
import { ancoraDeSelecao } from './ancoras';
import { compararCanonicos, proporAncoraEntreVersoes } from './versoes';
const id = (n: number): string => String(n).padStart(26, '0');
function canonico(textos: string[]): CanonicoV1 {
  const blocos = textos.map((texto, ordem) => ({ id: id(ordem + 10), tipo: 'paragrafo' as const, ordem, texto, inline: [], origens: [] }));
  return { versao: 1, documento: { titulo: 'Livro', formato: 'txt', idioma: 'pt', sha256_original: 'a'.repeat(64) },
    canonizacao: { motor: 'teste', gerado_em: '2026-09-28T00:00:00Z' }, hash_estrutural: hashEstrutural(blocos), blocos, secoes: [], assets: [], limites: [] };
}
test('comparação conta repetições sem chamar segmentação diferente de perda', () => {
  const a = canonico(['um', 'um', 'duas frases.']), b = canonico(['um', 'duas', 'frases.']);
  const copia = structuredClone([a, b]);
  const r = compararCanonicos(a, b);
  expect(r.blocos_iguais).toBe(1);
  expect(r.sem_par_antes.map(b => b.texto)).toEqual(['um', 'duas frases.']);
  expect(r.sem_par_depois.map(b => b.texto)).toEqual(['duas', 'frases.']);
  expect([a, b]).toEqual(copia);
});
test('proposta literal conserva UTF-16 e exige confirmação; outra edição é recusada', () => {
  const a = canonico(['Antes 🧭 café. Depois.']), b = canonico(['Introdução.', 'Antes 🧭 café. Depois.']);
  const ancora = ancoraDeSelecao({ ...a.blocos[0]!, versao_id: id(1) }, 6, 14);
  const copia = structuredClone(ancora);
  const r = proporAncoraEntreVersoes(ancora, { id: id(1), canonico: a }, { id: id(2), canonico: b });
  expect(r.tipo).toBe('proposta');
  if (r.tipo === 'proposta') {
    expect(r.exige_confirmacao).toBe(true);
    expect(r.ancora.versao_id).toBe(id(2));
    expect(r.ancora.citacao).toBe(ancora.citacao);
  }
  expect(ancora).toEqual(copia);
  b.documento.sha256_original = 'b'.repeat(64);
  expect(proporAncoraEntreVersoes(ancora, { id: id(1), canonico: a }, { id: id(2), canonico: b })).toEqual({ tipo: 'recusada', motivo: 'fonte_diferente' });
});
test('repetições no mesmo bloco ou em blocos diferentes nunca escolhem o primeiro', () => {
  const a = canonico(['frase']);
  const ancora = ancoraDeSelecao({ ...a.blocos[0]!, versao_id: id(1) }, 0, 5);
  for (const textos of [['frase frase'], ['frase', 'frase']]) {
    const r = proporAncoraEntreVersoes(ancora, { id: id(1), canonico: a }, { id: id(2), canonico: canonico(textos) });
    expect(r.tipo).toBe('ambigua');
    if (r.tipo === 'ambigua') expect(r.ocorrencias).toBe(2);
  }
});
test('origem inválida e citação modificada não viram propostas', () => {
  const a = canonico(['upfront']);
  const ancora = ancoraDeSelecao({ ...a.blocos[0]!, versao_id: id(1) }, 0, 7);
  const antes = { id: id(1), canonico: a }, depois = { id: id(2), canonico: canonico(['up-front']) };
  expect(proporAncoraEntreVersoes(ancora, antes, depois)).toEqual({ tipo: 'recusada', motivo: 'citacao_ausente' });
  expect(proporAncoraEntreVersoes({ ...ancora, versao_id: id(3) }, antes, depois)).toEqual({ tipo: 'recusada', motivo: 'origem_invalida' });
});
