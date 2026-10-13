import { expect, test } from 'vitest';
import type { PerfilDoLeitorV1 } from '@margem/contratos';
import { hashDoPerfil, hashLegadoDoPerfil, hashesDoPerfil } from './perfil.js';
import { serializarPerfil } from './prompts.js';
const vazio: PerfilDoLeitorV1 = { versao: 1, revisao: 0, areas: [], preferencias: [], observacoes: '', atualizado_em: '2026-01-01T00:00:00Z' };
test('identidade do plano segue a semântica do prompt, não existência ou revisão do perfil', () => {
  for (const perfil of [null, vazio, { ...vazio, revisao: 8, observacoes: ' \n ' }]) {
    expect(serializarPerfil(perfil)).toBe(serializarPerfil(null));
    expect(hashDoPerfil(perfil)).toBe(hashDoPerfil(null));
  }
  for (const perfil of [{ ...vazio, areas: [{ nome: 'dados', nivel: 'basico' as const }] },
    { ...vazio, preferencias: ['exemplos'] }, { ...vazio, observacoes: 'Sou iniciante.' }]) {
    expect(hashDoPerfil(perfil)).not.toBe(hashDoPerfil(null));
    expect(hashDoPerfil(perfil)).toBe(hashDoPerfil({ ...perfil, observacoes: ` ${perfil.observacoes} ` }));
  }
  expect(hashDoPerfil({ ...vazio, preferencias: ['a', 'b'] })).not.toBe(hashDoPerfil({ ...vazio, preferencias: ['b', 'a'] }));
});
test('receita histórica permanece disponível, incluindo as duas identidades vazias', () => {
  expect(hashLegadoDoPerfil(null)).toBe('128e77577a91ee112bf19cb87df51af470397adb1c206dc24ccb1dd6c3b46650');
  expect(hashesDoPerfil(null)).toContain(hashLegadoDoPerfil(vazio));
  expect(hashesDoPerfil(vazio)).toContain(hashLegadoDoPerfil(null));
});
