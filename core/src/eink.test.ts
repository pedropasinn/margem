import { expect, test } from 'vitest';
import type { ApresentacaoDoPlanoV1, ModeloDoCapituloV1, PlanoPedagogicoV1 } from '@margem/contratos';
import { roteiroDoEink, trechosDoBloco } from './eink';

const id = (n: number): string => String(n).padStart(26, '0');
const V = id(20);
const blocos = [
  { id: id(1), tipo: 'paragrafo' as const, texto: 'Admitamos inicialmente que os preços são rígidos.' },
  { id: id(2), tipo: 'paragrafo' as const, texto: 'Logo, o produto cai.' },
];
const ancora = (bloco: number, inicio: number, citacao: string) => ({ versao_id: V, bloco_id: id(bloco), inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao, prefixo: '', sufixo: '' });
const origem = { estagio: 'revisao' as const, job_id: id(90) };
const modelo = {
  id: id(503), execucao_id: id(40), secao_id: id(60), dificuldades: [],
  elementos: [
    { id: id(101), nucleo: 'hipotese', papel: 'conceito', ancoras: [ancora(1, 0, 'Admitamos inicialmente')], enunciado: 'Hipótese provisória.', qualificadores: [], centralidade: 1, notas: [], origem },
    { id: id(102), nucleo: 'afirmacao', papel: 'tese', ancoras: [ancora(2, 0, 'Logo, o produto cai.')], enunciado: 'A conclusão.', qualificadores: [], centralidade: 3, notas: [], origem },
  ],
  relacoes: [{ id: id(201), tipo: 'pressupoe', origem_id: id(102), destino_id: id(101), explicacao: 'Usa a rigidez.', confianca: 'alta', retrospectiva: true, origem }],
} as unknown as ModeloDoCapituloV1;
const plano = {
  id: id(701), modelo_id: id(503), execucao_id: id(40), secao_id: id(60), apoios: [],
  passos: [
    { ordem: 0, bloco_inicio: id(1), bloco_fim: id(1), foco: [id(101)], observar: 'o', explicacao: { curta: 'c', longa: 'l' }, relacoes: [], parada: null },
    { ordem: 1, bloco_inicio: id(2), bloco_fim: id(2), foco: [id(102)], observar: 'o2', explicacao: { curta: 'c2', longa: 'l2' }, relacoes: [id(201)], parada: { tipo: 'pergunta', texto: 'E se?' } },
  ],
} as unknown as PlanoPedagogicoV1;
const apresentacao: ApresentacaoDoPlanoV1 = { versao: 1, plano_id: id(701), dispositivo: 'eink', telas: [
  { passo: 0, tipo: 'texto', blocos: [id(1)], texto: null }, { passo: 0, tipo: 'explicacao', blocos: [], texto: 'c\n\nObserve: o' },
  { passo: 1, tipo: 'texto', blocos: [id(2)], texto: null }, { passo: 1, tipo: 'explicacao', blocos: [], texto: 'c2\n\nObserve: o2' },
] };

test('e-ink: o texto do passo leva os grifos numerados; a explicação, os mesmos números, as ligações e a parada', () => {
  const telas = roteiroDoEink(apresentacao, plano, modelo, blocos);
  expect(telas.map((tela) => tela.tipo)).toEqual(['texto', 'explicacao', 'texto', 'explicacao']);
  const [texto, , segundo, explicacao] = telas;
  expect(texto?.tipo === 'texto' && texto.grifos[id(1)]).toEqual([{ inicio: 0, fim: 22, numero: 1, periferico: false }]);
  expect(segundo?.tipo === 'texto' && segundo.grifos[id(2)]?.[0]?.periferico).toBe(true);
  expect(explicacao?.tipo === 'explicacao' && explicacao.itens).toEqual([{ numero: 1, enunciado: 'A conclusão.', periferico: true }]);
  // A ligação aponta para a tela de texto onde está o outro trecho (a primeira).
  expect(explicacao?.tipo === 'explicacao' && explicacao.ligacoes).toEqual([{ tipo: 'pressupoe', explicacao: 'Usa a rigidez.', retrospectiva: true, citacao: 'Admitamos inicialmente', tela: 0 }]);
  expect(explicacao?.tipo === 'explicacao' && explicacao.parada?.texto).toBe('E se?');
});

test('e-ink: o bloco se parte nos grifos, sem perder texto', () => {
  const trechos = trechosDoBloco('abcdefghij', [{ inicio: 2, fim: 4, numero: 1, periferico: false }, { inicio: 3, fim: 6, numero: 2, periferico: false }, { inicio: 7, fim: 9, numero: 3, periferico: false }]);
  expect(trechos.map((trecho) => trecho.texto).join('')).toBe('abcdefghij');
  expect(trechos.filter((trecho) => trecho.grifo).map((trecho) => trecho.texto)).toEqual(['cd', 'hi']);
});

test('âncoras secundárias aparecem na tela correspondente com o mesmo número do elemento', () => {
  const multiplo = structuredClone(modelo);
  multiplo.elementos[0]!.ancoras.push(ancora(2, 0, 'Logo'));
  const p = structuredClone(plano);
  p.passos[1]!.foco = [id(101), id(102)];
  const telas = roteiroDoEink(apresentacao, p, multiplo, blocos);
  expect(telas[0]?.tipo === 'texto' && telas[0].grifos[id(1)]?.[0]?.numero).toBe(1);
  expect(telas[2]?.tipo === 'texto' && telas[2].grifos[id(2)]?.map(g => g.numero)).toEqual([1, 2]);
  expect(telas[3]?.tipo === 'explicacao' && telas[3].itens.map(i => i.numero)).toEqual([1, 2]);
});

test('e-ink recusa modelo de outra revisão e apresentação de outro plano', () => {
  expect(() => roteiroDoEink(apresentacao, plano, { ...modelo, id: id(999) }, blocos)).toThrow('não corresponde');
  expect(() => roteiroDoEink({ ...apresentacao, plano_id: id(999) }, plano, modelo, blocos)).toThrow('outro plano');
});
