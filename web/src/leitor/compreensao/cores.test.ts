import { expect, test } from 'vitest';
import { CORES_DAS_RELACOES, corDaRelacao, indiceDaCorDaRelacao } from './cores';

test('a cor da relação vem do id: estável entre filtros e ordens, sempre da paleta dos braquetes', () => {
  const ids = ['01REL0000000000000000000A1', '01REL0000000000000000000B2', '01REL0000000000000000000C3', '01REL0000000000000000000D4'];
  const antes = ids.map(corDaRelacao);
  // Outra ordem (outro filtro) não muda a cor de nenhuma.
  const depois = [...ids].reverse().map(corDaRelacao).reverse();
  expect(depois).toEqual(antes);
  for (const id of ids) {
    expect(CORES_DAS_RELACOES).toContain(corDaRelacao(id));
    expect(indiceDaCorDaRelacao(id)).toBe(CORES_DAS_RELACOES.indexOf(corDaRelacao(id) as typeof CORES_DAS_RELACOES[number]));
  }
  // Ids diferentes espalham pelas cinco cores.
  expect(new Set(Array.from({ length: 40 }, (_, i) => corDaRelacao(`relacao-${String(i)}`))).size).toBe(5);
});
