/**
 * Conferência do sumário (J164), heurísticas locais: o Zero to One do motor antigo (bab4ab8) é suspeito,
 * o do motor atual (sumário do próprio EPUB, J153) não; os fixtures têm só títulos, níveis e contagens.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { canonicoDeTeste } from '../../testes/apoio.js';
import { resumirSecoes, suspeitasDoSumario, tituloSoNumero, type SecaoResumida } from './heuristica.js';

interface Fixture { formato: string; palavras: number; secoes: SecaoResumida[] }
const fixture = (nome: string): Fixture => JSON.parse(readFileSync(new URL(`./fixtures/${nome}.json`, import.meta.url), 'utf8')) as Fixture;
const codigos = (secoes: readonly SecaoResumida[], palavras: number) => suspeitasDoSumario(secoes, palavras).map((suspeita) => suspeita.codigo);
const secao = (nivel: number, titulo: string, palavras: number, proprias = palavras): SecaoResumida => ({ nivel, titulo, palavras, proprias });

test('Zero to One no motor antigo: 123 seções, números soltos e capítulos vazios disparam a conferência', () => {
  const antigo = fixture('zero-to-one-motor-antigo');
  expect(antigo.secoes).toHaveLength(123);
  const suspeitas = suspeitasDoSumario(antigo.secoes, antigo.palavras);
  expect(suspeitas.map((suspeita) => suspeita.codigo)).toEqual(['titulo_so_numero', 'numero_seguido_de_titulo', 'secoes_vazias', 'capitulos_repetidos']);
  const numeros = suspeitas[0];
  expect(numeros?.mensagem).toBe('14 seções têm só um número como título e quase nenhum texto.');
  // Os 14 capítulos numerados do livro: "1", "2", "3"…
  expect(numeros?.secoes.slice(0, 3).map((i) => antigo.secoes[i]?.titulo)).toEqual(['1', '2', '3']);
  // "Zero to One" (o título posto pelo motor) e "ZERO TO ONE" (o prefácio) como dois capítulos.
  expect(suspeitas[3]?.secoes.map((i) => antigo.secoes[i]?.titulo)).toEqual(['ZERO TO ONE']);
});

test('Zero to One no motor atual (sumário do EPUB): nada suspeito, o Codex nem é chamado', () => {
  const novo = fixture('zero-to-one-motor-novo');
  expect(codigos(novo.secoes, novo.palavras)).toEqual([]);
});

test('cada regra, e os livros bem estruturados que não a disparam', () => {
  expect(['1', 'II', '12.', 'Capítulo 3', 'CHAPTER IV', 'Parte 2', ' 7 '].every(tituloSoNumero)).toBe(true);
  expect(['1. Introdução', 'Capítulo um', '1999', 'Mixtape'].some(tituloSoNumero)).toBe(false);
  // Poemas numerados com texto: "I", "II" são títulos de verdade.
  expect(codigos([secao(1, 'I', 120), secao(1, 'II', 90), secao(1, 'III', 200)], 410)).toEqual([]);
  // "Capítulo 1" que abre o capítulo inteiro, com o nome numa subseção: tem texto próprio, não é suspeito.
  expect(codigos([secao(1, 'Capítulo 1', 5000, 300), secao(2, 'O começo', 4700), secao(1, 'Capítulo 2', 6000, 400)], 20_000)).toEqual([]);
  // Uma parte sem texto próprio, mas com capítulos dentro, não é vazia.
  expect(codigos([secao(1, 'Primeira parte', 8000, 0), secao(2, 'Um', 8000), secao(1, 'Segunda parte', 9000, 0), secao(2, 'Dois', 9000)], 17_000)).toEqual([]);
  expect(codigos([secao(1, 'Livro', 50_000)], 50_000)).toEqual(['sumario_raso']);
  expect(codigos([secao(1, 'Ensaio', 3_000)], 3_000)).toEqual([]);
  expect(codigos([secao(1, 'Introdução', 900), secao(1, 'O mercado', 900), secao(1, 'O MERCADO', 900), secao(1, 'Notas', 50), secao(1, 'Notas', 50)], 2_800))
    .toEqual(['capitulos_repetidos']);
  expect(codigos([secao(1, 'Capa', 1), secao(1, 'Rosto', 2), secao(1, 'Dedicatória', 5), secao(1, 'Um', 20_000)], 20_008)).toEqual(['capitulos_curtos_seguidos']);
  expect(codigos([secao(1, 'Capa', 1), secao(1, 'Rosto', 2), secao(1, 'Um', 20_000)], 20_003)).toEqual([]);
  const longo = 'Este parágrafo inteiro foi tomado por um título porque a fonte dele era um pouco maior que a do resto do texto, coisa comum em PDFs mal marcados por aí, e que ninguém confundiria com o nome de um capítulo.';
  expect(codigos([secao(1, longo, 100), secao(1, `${longo} 2`, 100), secao(1, `${longo} 3`, 100)], 300)).toEqual(['titulos_longos']);
  expect(codigos([secao(1, 'Prefácio', 0), secao(1, 'Um', 300)], 300)).toEqual([]);
  expect(codigos([secao(1, 'Prefácio', 0), secao(1, 'Apresentação', 0), secao(1, 'Um', 300)], 300)).toEqual(['secoes_vazias']);
});

test('as contagens saem do canônico: palavras da seção inteira e só dela, sem os títulos', () => {
  const canonico = canonicoDeTeste({
    blocos: [
      { tipo: 'capitulo', texto: '1' }, { tipo: 'capitulo', texto: 'O DESAFIO' }, { tipo: 'paragrafo', texto: 'Três palavras aqui.' },
      { tipo: 'secao', texto: 'Pensamento' }, { tipo: 'paragrafo', texto: 'Mais duas.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 0 }, { nivel: 1, inicio: 1, fim: 4 }, { nivel: 2, inicio: 3, fim: 4 }],
  });
  expect(resumirSecoes(canonico)).toEqual([secao(1, '1', 0), secao(1, 'O DESAFIO', 5, 3), secao(2, 'Pensamento', 2)]);
});
