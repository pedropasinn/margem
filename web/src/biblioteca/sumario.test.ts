import { expect, test } from 'vitest';
import type { NoDaArvore } from './tipos';
import { secoesDoCapitulo } from './Ler';

const no = (id: string, nivel: number, filhos: NoDaArvore[] = []): NoDaArvore => ({ id, titulo: `T${id}`, nivel, ordem: 0, bloco_inicio: `b${id}`, bloco_fim: `b${id}`, filhos });

test('sumário: as seções do capítulo, até dois níveis abaixo dele, na ordem do texto', () => {
  const arvore = [no('1', 1, [no('11', 2, [no('111', 3, [no('1111', 4)])]), no('12', 2)]), no('2', 1)];
  expect(secoesDoCapitulo(arvore, '1').map((s) => [s.id, s.profundidade, s.bloco_inicio])).toEqual([['11', 1, 'b11'], ['111', 2, 'b111'], ['12', 1, 'b12']]);
  expect(secoesDoCapitulo(arvore, '2')).toEqual([]);
  expect(secoesDoCapitulo(arvore, 'x')).toEqual([]);
});
