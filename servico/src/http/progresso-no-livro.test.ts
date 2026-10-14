import { expect, test } from 'vitest';
import { canonicoDeTeste } from '../../testes/apoio.js';
import { palavrasNoLivro } from './consultas.js';

const lista = (ultimo: string) => canonicoDeTeste({
  titulo: 'Lista 1',
  blocos: [
    { tipo: 'capitulo', texto: 'Lista 1' },
    { tipo: 'paragrafo', texto: 'um dois três quatro cinco seis sete oito' },
    { tipo: 'capitulo', texto: ultimo },
    { tipo: 'paragrafo', texto: 'JAMES, B. R. Probabilidade.' },
  ],
  secoes: [{ nivel: 1, inicio: 0, fim: 1 }, { nivel: 1, inicio: 2, fim: 3 }],
});

test('referências no fim não contam: o fim da lista é o fim do documento (V-T5)', () => {
  const canonico = lista('Referências');
  const [primeiro, segundo] = canonico.secoes;
  // "Lista 1" (2 palavras do título + 8) é tudo o que conta.
  expect(palavrasNoLivro(canonico, primeiro!.bloco_inicio)).toEqual({ antes: 0, total: 10 });
  // Abrir as referências não passa de 100%: o leitor limita o percentual.
  expect(palavrasNoLivro(canonico, segundo!.bloco_inicio).antes).toBe(10);
});

test('um capítulo comum no fim continua contando', () => {
  const canonico = lista('Conclusão');
  expect(palavrasNoLivro(canonico, canonico.secoes[0]!.bloco_inicio)).toEqual({ antes: 0, total: 15 });
});
