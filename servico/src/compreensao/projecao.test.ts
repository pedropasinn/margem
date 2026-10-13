import { expect, test } from 'vitest';
import type { ElementoSemanticoV1, ModeloDoCapituloV1, RelacaoSemanticaV1 } from '@margem/contratos';
import { idTeste } from '../../testes/apoio.js';
import { exigirModo } from '../modos.js';
import { frasesDoTrecho, PROJECAO_ORIGINAL, PROJECAO_PADRAO, projetarMarcas, recortarNaFrase, vozAlheia } from './projecao.js';
import { derivarRetrospectivas, retrospectivaPelaOrdem } from './retrospectivas.js';

const versao = idTeste('V', 1);
const argumentativa = exigirModo({ id: 'argumentativa', revisao: 1 });
const matematica = exigirModo({ id: 'matematica', revisao: 1 });
const filosofica = exigirModo({ id: 'filosofica', revisao: 1 });

const b1 = { id: idTeste('B', 1), texto: 'Se o hedonismo fosse verdadeiro, só a experiência contaria. Mas há bens que não chegam como experiência. Logo, o hedonismo é falso.' };
const b2 = { id: idTeste('B', 2), texto: 'O contraexemplo é a função valor absoluto no ponto zero. Ela é contínua ali e não é derivável.' };
const b3 = { id: idTeste('B', 3), texto: 'A sentença recorrida considerou o festival abrangido pela exceção. O tribunal reformou a sentença.' };
const enchimento = Array.from({ length: 6 }, (_, i) => ({ id: idTeste('B', 10 + i), texto: 'Texto de enchimento sem marca nenhuma, só para o capítulo ter tamanho de verdade e o alvo caber. '.repeat(8) }));
const blocos = [b1, b2, b3, ...enchimento];

function citacao(bloco: { id: string; texto: string }, trecho: string) {
  const inicio = bloco.texto.indexOf(trecho);
  if (inicio < 0) throw new Error(`trecho ausente: ${trecho}`);
  return { versao_id: versao, bloco_id: bloco.id, citacao: trecho, prefixo: '', sufixo: '', inicio_utf16: inicio, fim_utf16: inicio + trecho.length };
}

function elemento(n: number, campos: Partial<ElementoSemanticoV1> & Pick<ElementoSemanticoV1, 'ancoras'>): ElementoSemanticoV1 {
  return {
    id: idTeste('K', n), nucleo: 'afirmacao', papel: 'tese', enunciado: `Enunciado ${String(n)}.`, qualificadores: [], centralidade: 2, notas: [],
    origem: { estagio: 'revisao', job_id: idTeste('J', 1) }, ...campos,
  };
}

function modelo(elementos: ElementoSemanticoV1[], relacoes: RelacaoSemanticaV1[] = [], modo = argumentativa): ModeloDoCapituloV1 {
  return {
    versao: 1, id: idTeste('M', 1), execucao_id: idTeste('E', 1), versao_id: versao, secao_id: idTeste('S', 1), modo: { id: modo.id, revisao: modo.revisao },
    revisao: 2, estagio: 'revisao', base_id: null, lote_id: null, movimento: null, unidades: [], elementos, relacoes, dificuldades: [],
    criada_em: '2026-09-29T12:00:00Z',
  };
}

function relacao(n: number, origem: number, destino: number, tipo: RelacaoSemanticaV1['tipo'] = 'suporta'): RelacaoSemanticaV1 {
  return { id: idTeste('R', n), tipo, origem_id: idTeste('K', origem), destino_id: idTeste('K', destino), explicacao: 'e', confianca: 'alta',
    retrospectiva: false, origem: { estagio: 'revisao', job_id: idTeste('J', 1) } };
}

const contexto = (modo = argumentativa) => ({ modo, camada_id: idTeste('E', 1), blocos });

test('frases de um trecho: ponto seguido de espaço, abreviações e verso', () => {
  const texto = 'O Sr. Silva chegou. Viu tudo! E saiu? Não.';
  expect(frasesDoTrecho(texto, 0, texto.length).map((f) => texto.slice(f.inicio, f.fim))).toEqual(['O Sr. Silva chegou.', 'Viu tudo!', 'E saiu?', 'Não.']);
  const verso = 'Minha terra tem palmeiras,\nOnde canta o Sabiá;\nAs aves, que aqui gorjeiam,\nNão gorjeiam como lá.';
  expect(frasesDoTrecho(verso, 0, verso.length)).toHaveLength(2);
  expect(frasesDoTrecho('3.290 egressos responderam.', 0, 27)).toHaveLength(1);
});

test('recorte: a marca cai na frase que realiza o papel, não na primeira citação inteira', () => {
  const conclusao = elemento(1, {
    ancoras: [citacao(b1, b1.texto)], enunciado: 'O autor conclui que o hedonismo é falso.', centralidade: 1,
  });
  const recorte = recortarNaFrase(conclusao, new Map(blocos.map((b) => [b.id, b])));
  expect(recorte?.ancora.citacao).toBe('Logo, o hedonismo é falso.');
  expect(recorte?.cortada).toBe(true);
  // A âncora recortada é uma âncora válida do bloco (offsets batem com a citação).
  expect(b1.texto.slice(recorte?.ancora.inicio_utf16, recorte?.ancora.fim_utf16)).toBe('Logo, o hedonismo é falso.');

  const original = projetarMarcas(modelo([conclusao]), contexto(), PROJECAO_ORIGINAL);
  expect(original.marcas[0]?.marca.ancora.citacao).toBe(b1.texto);
  const nova = projetarMarcas(modelo([conclusao]), contexto(), PROJECAO_PADRAO);
  expect(nova.marcas[0]?.marca.ancora.citacao).toBe('Logo, o hedonismo é falso.');
});

test('recorte: com o mesmo peso, a primeira frase da primeira citação vence', () => {
  const el = elemento(1, { ancoras: [citacao(b2, b2.texto)], enunciado: 'Nada em comum com as frases.' });
  const recorte = recortarNaFrase(el, new Map(blocos.map((b) => [b.id, b])), 0.6);
  expect(recorte?.ancora.citacao).toBe('O contraexemplo é a função valor absoluto no ponto zero.');
});

test('recorte: qualificadores fora da frase recortada saem das subfaixas, com diagnóstico', () => {
  const el = elemento(1, {
    ancoras: [citacao(b1, b1.texto)], enunciado: 'O hedonismo é falso, logo.', qualificadores: ['só a experiência'],
  });
  const { marcas, diagnosticos } = projetarMarcas(modelo([el]), contexto(), PROJECAO_PADRAO);
  expect(marcas[0]?.marca.subfaixas).toEqual([]);
  expect(diagnosticos.map((d) => d.codigo)).toContain('qualificador_fora_do_recorte');
});

test('alvo: o excedente de s1 desce para s2, ficando os de mais dependentes', () => {
  const curto = [b1, b2, b3];
  const els = [
    elemento(1, { ancoras: [citacao(b1, 'Logo, o hedonismo é falso.')], centralidade: 1 }),
    elemento(2, { ancoras: [citacao(b2, 'Ela é contínua ali e não é derivável.')], centralidade: 1, papel: 'conceito' }),
    elemento(3, { ancoras: [citacao(b3, 'O tribunal reformou a sentença.')], centralidade: 1, papel: 'justificativa' }),
  ];
  // K3 tem dois dependentes, K2 um, K1 nenhum.
  const rels = [relacao(1, 1, 3), relacao(2, 2, 3), relacao(3, 1, 2)];
  const { marcas, diagnosticos } = projetarMarcas(modelo(els, rels), { modo: argumentativa, camada_id: idTeste('E', 1), blocos: curto }, PROJECAO_PADRAO);
  const saliencia = new Map(marcas.map((m) => [m.elemento_id, m.marca.saliencia]));
  // Capítulo de ~290 caracteres: 2 × 4% ≈ 23 caracteres; só a primeira s1 (a de mais dependentes) fica.
  expect(saliencia.get(idTeste('K', 3))).toBe(1);
  expect(saliencia.get(idTeste('K', 2))).toBe(2);
  expect(saliencia.get(idTeste('K', 1))).toBe(2);
  expect(diagnosticos.filter((d) => d.codigo === 'saliencia_rebaixada_pelo_alvo')).toHaveLength(2);
  // Sem o alvo, a centralidade passa direto.
  const semAlvo = projetarMarcas(modelo(els, rels), { modo: argumentativa, camada_id: idTeste('E', 1), blocos: curto }, { ...PROJECAO_PADRAO, alvo: false });
  expect(semAlvo.marcas.every((m) => m.marca.saliencia === 1)).toBe(true);
});

test('voz: sentença recorrida, objeção e tese provisória não recebem a cor de tese', () => {
  const recorrida = elemento(1, { ancoras: [citacao(b3, 'A sentença recorrida considerou o festival abrangido pela exceção.')],
    enunciado: 'A sentença recorrida considerou o festival abrangido pela exceção.' });
  const provisoria = elemento(2, { ancoras: [citacao(b1, 'Se o hedonismo fosse verdadeiro, só a experiência contaria.')],
    notas: [{ tipo: 'LEITURA', texto: 'A abertura funciona como tese provisória, corrigida adiante.' }] });
  const autor = elemento(3, { ancoras: [citacao(b3, 'O tribunal reformou a sentença.')], enunciado: 'O tribunal reforma a sentença.' });
  expect([recorrida, provisoria, autor].map(vozAlheia)).toEqual([true, true, false]);
  const { marcas, diagnosticos } = projetarMarcas(modelo([recorrida, provisoria, autor]), contexto(), PROJECAO_PADRAO);
  const funcao = new Map(marcas.map((m) => [m.elemento_id, m.marca.funcao]));
  expect(funcao.get(idTeste('K', 1))).toBe('nenhuma');
  expect(funcao.get(idTeste('K', 2))).toBe('nenhuma');
  expect(funcao.get(idTeste('K', 3))).toBe('tese');
  // A marca sem cor guarda o comentário: a leitura não se perde.
  expect(marcas.find((m) => m.elemento_id === idTeste('K', 2))?.marca.comentario?.tipo).toBe('LEITURA');
  expect(diagnosticos.filter((d) => d.codigo === 'tese_em_voz_alheia')).toHaveLength(2);
  // No modo filosófico, uma objeção pintada de tese vira a função objeção.
  const objecao = elemento(4, { nucleo: 'objecao', ancoras: [citacao(b1, 'Mas há bens que não chegam como experiência.')] });
  expect(projetarMarcas(modelo([objecao], [], filosofica), contexto(filosofica), PROJECAO_PADRAO).marcas[0]?.marca.funcao).toBe('objecao');
});

test('papel nulo: contraexemplo em matemática vira passo não trivial; afirmação e passo continuam sem cor', () => {
  const contraexemplo = elemento(1, { nucleo: 'exemplo', papel: null, ancoras: [citacao(b2, 'O contraexemplo é a função valor absoluto no ponto zero.')] });
  const passo = elemento(2, { nucleo: 'passo', papel: null, ancoras: [citacao(b2, 'Ela é contínua ali e não é derivável.')] });
  const afirmacao = elemento(3, { nucleo: 'afirmacao', papel: null, ancoras: [citacao(b1, 'Logo, o hedonismo é falso.')] });
  const { marcas, diagnosticos } = projetarMarcas(modelo([contraexemplo, passo, afirmacao], [], matematica), contexto(matematica), PROJECAO_PADRAO);
  const funcao = new Map(marcas.map((m) => [m.elemento_id, m.marca.funcao]));
  expect(funcao.get(idTeste('K', 1))).toBe('passo_nao_trivial');
  expect(funcao.get(idTeste('K', 2))).toBe('nenhuma');
  expect(funcao.get(idTeste('K', 3))).toBe('nenhuma');
  expect(marcas.find((m) => m.elemento_id === idTeste('K', 1))?.marca.comentario?.rotulo).toBe('AUTOR · PASSO NÃO TRIVIAL');
  expect(diagnosticos.map((d) => d.codigo)).toContain('papel_padrao_do_nucleo');
  // Na argumentativa, um exemplo sem papel é decisão do modelo (âncora sem cor para crítica): fica sem cor.
  const exemploArg = elemento(4, { nucleo: 'exemplo', papel: null, ancoras: [citacao(b2, 'O contraexemplo é a função valor absoluto no ponto zero.')] });
  expect(projetarMarcas(modelo([exemploArg]), contexto(), PROJECAO_PADRAO).marcas[0]?.marca.funcao).toBe('nenhuma');
});

test('aliases internos saem do comentário da marca; token do próprio texto fica', () => {
  const el = elemento(1, { ancoras: [citacao(b1, 'Logo, o hedonismo é falso.')],
    notas: [{ tipo: 'LEITURA', texto: 'A conclusão depende da premissa em B007 e contrasta com L10.' }] });
  const { marcas, diagnosticos } = projetarMarcas(modelo([el]), contexto(), PROJECAO_PADRAO);
  expect(marcas[0]?.marca.comentario?.texto).toBe('A conclusão depende da premissa e contrasta.');
  expect(diagnosticos.map((d) => d.codigo)).toContain('alias_no_comentario');
  const comU2 = [{ id: idTeste('B', 40), texto: 'A banda U2 tocou. Logo, o hedonismo é falso.' }];
  const el2 = elemento(2, { ancoras: [citacao(comU2[0] ?? b1, 'Logo, o hedonismo é falso.')], notas: [{ tipo: 'LEITURA', texto: 'Como o U2 do começo.' }] });
  expect(projetarMarcas(modelo([el2]), { modo: argumentativa, camada_id: idTeste('E', 1), blocos: comU2 }, PROJECAO_PADRAO).marcas[0]?.marca.comentario?.texto)
    .toBe('Como o U2 do começo.');
});

test('projecao@1 continua reproduzível pelas opções originais', () => {
  const el = elemento(1, { ancoras: [citacao(b1, b1.texto)], centralidade: 1, notas: [{ tipo: 'LEITURA', texto: 'Ver B007.' }] });
  const { marcas } = projetarMarcas(modelo([el]), contexto(), PROJECAO_ORIGINAL);
  expect(marcas[0]?.marca).toMatchObject({ funcao: 'tese', saliencia: 1, ancora: { citacao: b1.texto }, comentario: { texto: 'Ver B007.' } });
});

test('retrospectivas: a origem bem depois do destino marca a relação; nunca desmarca', () => {
  expect(retrospectivaPelaOrdem('pressupoe', 5, 1)).toBe(true);
  expect(retrospectivaPelaOrdem('pressupoe', 3, 1)).toBe(false);
  expect(retrospectivaPelaOrdem('suporta', 5, 1)).toBe(false);
  expect(retrospectivaPelaOrdem('suporta', 6, 1)).toBe(true);
  expect(retrospectivaPelaOrdem('retoma', 1, 5)).toBe(false);
  expect(retrospectivaPelaOrdem('retoma', undefined, 1)).toBe(false);
  const ordem = blocos.map((b) => b.id);
  const els = [
    elemento(1, { ancoras: [citacao(b1, 'Logo, o hedonismo é falso.')] }),
    elemento(2, { ancoras: [citacao(enchimento[2] ?? b1, 'Texto de enchimento')] }),
  ];
  const marcada = { ...relacao(2, 1, 2), retrospectiva: true };
  const derivado = derivarRetrospectivas(modelo(els, [relacao(1, 2, 1, 'retoma'), marcada]), ordem);
  expect(derivado.relacoes.map((r) => r.retrospectiva)).toEqual([true, true]);
  const semMudanca = modelo(els, [relacao(1, 1, 2, 'retoma')]);
  expect(derivarRetrospectivas(semMudanca, ordem)).toBe(semMudanca);
});

test('novas revisões dão cor a exemplo filosófico e premissa sem papel, sem mudar V1', () => {
  const nova = exigirModo({ id: 'filosofica', revisao: 2 });
  const exemplo = elemento(1, { nucleo: 'exemplo', papel: null, ancoras: [citacao(b2, 'O contraexemplo é a função valor absoluto no ponto zero.')] });
  const premissa = elemento(2, { nucleo: 'hipotese', papel: null, ancoras: [citacao(b1, 'Se o hedonismo fosse verdadeiro, só a experiência contaria.')] });
  const marcas = projetarMarcas(modelo([exemplo, premissa], [], nova), contexto(nova)).marcas;
  expect(marcas.map(m => m.marca.funcao).sort()).toEqual(['caso', 'premissa']);
  expect(projetarMarcas(modelo([exemplo], [], filosofica), contexto(filosofica)).marcas[0]?.marca.funcao).toBe('nenhuma');
});
