import { expect, test } from 'vitest';
import { canonicoDeTeste } from '../../testes/apoio.js';
import { capituloDoBloco } from './consultas.js';

// I-04: a leitura reabre no capítulo da posição salva; a árvore diz qual é pelo bloco da âncora.
test('o capítulo que contém o bloco; bloco de fora da versão, nenhum', () => {
  const canonico = canonicoDeTeste({
    titulo: 'Livro',
    blocos: [
      { tipo: 'capitulo', texto: 'Um' }, { tipo: 'paragrafo', texto: 'a' },
      { tipo: 'capitulo', texto: 'Dois' }, { tipo: 'paragrafo', texto: 'b' }, { tipo: 'paragrafo', texto: 'c' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 1 }, { nivel: 1, inicio: 2, fim: 4 }],
  });
  const [um, dois] = canonico.secoes;
  expect(capituloDoBloco(canonico, canonico.blocos[1]!.id)).toBe(um!.id);
  expect(capituloDoBloco(canonico, canonico.blocos[4]!.id)).toBe(dois!.id);
  expect(capituloDoBloco(canonico, canonico.blocos[2]!.id)).toBe(dois!.id);
  expect(capituloDoBloco(canonico, 'Z'.repeat(26))).toBeNull();
});
