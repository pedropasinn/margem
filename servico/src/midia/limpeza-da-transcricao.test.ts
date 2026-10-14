/**
 * J142 · transcrição passada a limpo: as funções puras (tempos levados para o texto limpo, recusa do que
 * mudou demais, trechos, prompt) e a decisão de quando limpar.
 */
import { expect, test } from 'vitest';
import type { PalavraTranscrita } from '@margem/core';
import {
  dividirEmTrechos, montarPromptDaLimpeza, montarTranscricaoLimpa, palavrasDoParagrafo, precisaPassarALimpo, recusaDoParagrafo,
  semelhanca, transferirTempos,
} from './limpeza-da-transcricao.js';

const falas = (texto: string, inicio = 0): PalavraTranscrita[] => texto.split(' ').map((t, i) => ({ texto: t, inicio_s: inicio + i, fim_s: inicio + i + 0.8 }));

test('tempos: igual sem pontuação nem caixa, troca 1:1 e nome corrigido mantêm o tempo de cada palavra', () => {
  const antigas = falas('hoje a open ai lançou o modelo novo da antropic');
  const novas = transferirTempos(antigas, 'Hoje a OpenAI lançou o modelo novo da Anthropic.'.split(' '));
  expect(novas.map((p) => p.texto)).toEqual(['Hoje', 'a', 'OpenAI', 'lançou', 'o', 'modelo', 'novo', 'da', 'Anthropic.']);
  // "Hoje" e "a" iguais; "open ai" → "OpenAI" reparte os dois segundos; "antropic" → "Anthropic." 1:1.
  expect(novas[0]).toEqual({ texto: 'Hoje', inicio_s: 0, fim_s: 0.8 });
  expect(novas[2]).toEqual({ texto: 'OpenAI', inicio_s: 2, fim_s: 3.8 });
  expect(novas[3]).toEqual({ texto: 'lançou', inicio_s: 4, fim_s: 4.8 });
  expect(novas[8]).toEqual({ texto: 'Anthropic.', inicio_s: 9, fim_s: 9.8 });
});

test('tempos: número por extenso vira algarismo no intervalo das palavras; inserção cai na pausa; os tempos nunca voltam', () => {
  const antigas = falas('em dois mil e vinte e seis o pib cresceu');
  const novas = transferirTempos(antigas, 'Em 2026, o PIB cresceu.'.split(' '));
  expect(novas.find((p) => p.texto === '2026,')).toEqual({ texto: '2026,', inicio_s: 1, fim_s: 6.8 });
  expect(novas.at(-1)).toEqual({ texto: 'cresceu.', inicio_s: 9, fim_s: 9.8 });
  const comPausa: PalavraTranscrita[] = [{ texto: 'o', inicio_s: 0, fim_s: 0.5 }, { texto: 'presidente', inicio_s: 2, fim_s: 2.6 }];
  const inserida = transferirTempos(comPausa, ['O', 'novo', 'presidente']);
  expect(inserida[1]).toEqual({ texto: 'novo', inicio_s: 0.5, fim_s: 2 });
  for (let i = 1; i < inserida.length; i++) expect(inserida[i]!.inicio_s).toBeGreaterThanOrEqual(inserida[i - 1]!.inicio_s);
});

test('recusa: o que mudou demais, sumiu ou abriria uma lista fica como estava', () => {
  const original = 'a gente vai falar hoje sobre a china e o ouro que ela comprou';
  expect(recusaDoParagrafo(original, 'A gente vai falar hoje sobre a China e o ouro que ela comprou.')).toBeNull();
  expect(recusaDoParagrafo(original, undefined)).toBe('ausente');
  expect(recusaDoParagrafo(original, '  ')).toBe('vazio');
  expect(recusaDoParagrafo(original, 'Resumo: a China comprou ouro.')).toBe('mudou_demais');
  expect(recusaDoParagrafo(original, '- A gente vai falar hoje sobre a China e o ouro que ela comprou.')).toBe('abre_lista');
  expect(semelhanca(['a', 'b', 'c', 'd'], ['A,', 'b', 'x', 'd.'])).toBe(0.75);
});

test('montagem: aceitos entram limpos com os tempos, recusados ficam como estavam e entram na lista', () => {
  const p1 = falas('bom dia pessoal hoje vamos falar de juros', 0);
  const p2 = falas('a selic subiu de novo', 20);
  const p3 = falas('e o dólar caiu', 40);
  const limpa = montarTranscricaoLimpa([p1, p2, p3], new Map([[1, 'Bom dia, pessoal! Hoje vamos falar de juros.'], [2, 'Outra coisa totalmente diferente aqui.']]));
  expect(limpa.paragrafos).toEqual(['Bom dia, pessoal! Hoje vamos falar de juros.', 'a selic subiu de novo', 'e o dólar caiu']);
  expect(limpa.mudados).toBe(1);
  expect(limpa.recusas).toEqual([{ paragrafo: 2, motivo: 'mudou_demais' }, { paragrafo: 3, motivo: 'ausente' }]);
  // As palavras são exatamente os tokens dos parágrafos (o que a revisão do J90 exige).
  expect(limpa.palavras.map((p) => p.texto)).toEqual(limpa.paragrafos.join(' ').split(' '));
  expect(limpa.palavras[2]).toMatchObject({ texto: 'pessoal!', inicio_s: 2 });
});

test('palavras do parágrafo: os tokens do texto com o tempo da mídia; o que ficou sem par é interpolado', () => {
  const bloco = { id: 'B1', texto: 'Uma fala — com pausa' };
  const palavras = [
    { bloco_id: 'B1', inicio_utf16: 0, fim_utf16: 3, inicio_s: 1, fim_s: 1.5 },
    { bloco_id: 'B1', inicio_utf16: 4, fim_utf16: 8, inicio_s: 2, fim_s: 2.5 },
    { bloco_id: 'B1', inicio_utf16: 15, fim_utf16: 20, inicio_s: 4, fim_s: 4.5 },
  ];
  const saida = palavrasDoParagrafo(bloco, { palavras });
  expect(saida.map((p) => p.texto)).toEqual(['Uma', 'fala', '—', 'com', 'pausa']);
  expect(saida[2]!.inicio_s).toBeGreaterThanOrEqual(2.5);
  expect(saida[3]!.fim_s).toBeLessThanOrEqual(4);
});

test('trechos, prompt e decisão', () => {
  const paragrafos = ['um dois três', 'quatro cinco', 'seis sete oito nove'];
  expect(dividirEmTrechos(paragrafos, 5)).toEqual([[0, 1], [2]]);
  const { prompt, schema } = montarPromptDaLimpeza({ titulo: 'A jogada da China', canal: 'Fernando Ulrich', idioma: 'pt' }, paragrafos, [1]);
  expect(prompt).toContain('[2] quatro cinco');
  expect(prompt).toContain('um dois três');
  expect(prompt).toContain('seis sete oito nove');
  expect(prompt).toContain('em português');
  expect(prompt).not.toContain('{{');
  expect(schema).toMatchObject({ required: ['paragrafos'] });
  const automatica = { transcricao: { motor: 'legendas do YouTube (automáticas, pt)', idioma: 'pt', sha256: 'x' } };
  expect(precisaPassarALimpo(automatica, { transcricao: { estado: 'pronta', origem: 'legendas_automaticas' } })).toBe(true);
  expect(precisaPassarALimpo(automatica, { transcricao: { estado: 'pronta', origem: 'legendas' } })).toBe(false);
  expect(precisaPassarALimpo({ transcricao: { ...automatica.transcricao, motor: 'x + passada a limpo pelo Codex (revisar-transcricao@3)' } }, null)).toBe(false);
  expect(precisaPassarALimpo({ transcricao: { ...automatica.transcricao, motor: 'whisper large-v3' } }, null)).toBe(true);
});
