import { expect, test } from 'vitest';
import type { ModeloDoCapituloV1 } from '@margem/contratos';
import { novosAliases } from '@margem/core';
import { contadorDeIds, idTeste } from '../../testes/apoio.js';
import { exigirModo } from '../modos.js';
import { falaDoLeitor, resolverAnalise, resolverEstrutura, resolverOperacoes, SaidaInvalida } from './resolver.js';
import type { OperacaoGerada } from './prompts.js';

const modo = exigirModo({ id: 'argumentativa', revisao: 1 });
const versao = idTeste('V', 1);
const b1 = { id: idTeste('B', 1), texto: 'A tese vale somente aqui. A tese vale somente aqui.' };
const b2 = { id: idTeste('B', 2), texto: 'Outro bloco com um exemplo.' };

function base(): ModeloDoCapituloV1 {
  const elemento = (n: number, bloco: string, citacao: string, inicio: number, centralidade: 1 | 2 | 3) => ({
    id: idTeste('K', n), nucleo: 'afirmacao' as const, papel: 'tese', centralidade, enunciado: `E${String(n)}`, qualificadores: [], notas: [],
    ancoras: [{ versao_id: versao, bloco_id: bloco, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao, prefixo: '', sufixo: '' }],
    origem: { estagio: 'analise_local' as const, job_id: idTeste('J', 1) },
  });
  return {
    versao: 1, id: idTeste('M', 1), execucao_id: idTeste('E', 1), versao_id: versao, secao_id: idTeste('S', 1), modo: { id: 'argumentativa', revisao: 1 },
    revisao: 0, estagio: 'analise_local', base_id: null, lote_id: null, movimento: null, unidades: [],
    elementos: [elemento(1, b1.id, 'A tese vale', 0, 2), elemento(2, b2.id, 'um exemplo', 16, 2)], relacoes: [], dificuldades: [], criada_em: '2026-09-25T12:00:00Z',
  };
}

function aliasesDoBase() {
  const aliases = novosAliases();
  aliases.blocos.registrar(b1.id); aliases.blocos.registrar(b2.id);
  aliases.elementos.registrar(idTeste('K', 1)); aliases.elementos.registrar(idTeste('K', 2));
  return aliases;
}

test('citação ambígua sem prefixo cai; com prefixo resolve; papel fora do modo vira nulo', () => {
  const aliases = aliasesDoBase();
  const resolvida = resolverAnalise({
    elementos: [
      { ref: 'n1', nucleo: 'afirmacao', papel: 'tese', citacoes: [{ bloco: 'B001', citacao: 'somente aqui', prefixo: '', sufixo: '' }], enunciado: 'x', qualificadores: [], centralidade: 1, notas: [] },
      { ref: 'n2', nucleo: 'afirmacao', papel: 'imagem', citacoes: [{ bloco: 'B001', citacao: 'somente aqui', prefixo: 'A tese vale ', sufixo: '. A tese' }], enunciado: 'y', qualificadores: [], centralidade: 1, notas: [] },
      { ref: 'n3', nucleo: 'exemplo', papel: null, citacoes: [{ bloco: 'B999', citacao: 'x', prefixo: '', sufixo: '' }], enunciado: 'z', qualificadores: [], centralidade: 3, notas: [] },
    ],
    relacoes: [], dificuldades: [], resumo_da_parte: 'r', limites: [], leitura_integral: true,
  }, { versao_id: versao, job_id: idTeste('J', 2), modo, aliases, responsaveis: [b1], novoId: contadorDeIds('N') });
  expect(resolvida.elementos).toHaveLength(1);
  expect(resolvida.elementos[0]).toMatchObject({ papel: null, ancoras: [{ inicio_utf16: 12, fim_utf16: 24 }] });
  expect(resolvida.diagnosticos.map((item) => item.codigo)).toEqual([
    'citacao_ambigua', 'elemento_sem_ancora', 'papel_fora_do_modo', 'bloco_fora_do_escopo', 'elemento_sem_ancora',
  ]);
  expect(() => resolverAnalise({ elementos: 'nada' }, { versao_id: versao, job_id: idTeste('J', 2), modo, aliases, responsaveis: [b1] })).toThrow(SaidaInvalida);
});

test('operações: direção corrigida, janela respeitada, fundir, refs novas e evidência desconhecida', () => {
  const aliases = aliasesDoBase();
  const geradas: OperacaoGerada[] = [
    { op: 'promover', alvo: 'L01', para: 3, motivo: 'na verdade rebaixa', evidencia: ['L77'] },
    { op: 'promover', alvo: 'L02', para: 1, motivo: 'fora da janela', evidencia: [] },
    { op: 'adicionar_elemento', ref: 'n1', nucleo: 'hipotese', papel: 'conceito', citacoes: [{ bloco: 'B001', citacao: 'A tese vale somente aqui. A tese', prefixo: '', sufixo: '' }],
      enunciado: 'nova', qualificadores: ['somente'], centralidade: 2, notas: [], motivo: 'faltava', evidencia: [] },
    { op: 'criar_relacao', ref: 'n2', origem: 'n1', destino: 'L01', tipo: 'pressupoe', explicacao: 'e', confianca: 'media', retrospectiva: false, motivo: 'm', evidencia: [] },
    { op: 'criar_relacao', ref: 'n2', origem: 'L01', destino: 'n1', tipo: 'suporta', explicacao: 'e', confianca: 'media', retrospectiva: false, motivo: 'ref repetida', evidencia: [] },
    { op: 'fundir', alvo: 'L01', absorvidos: ['L01'], motivo: 'em si', evidencia: [] },
    { op: 'rebaixar', alvo: 'L01', para: 3, motivo: 'já é 3', evidencia: [] },
  ];
  const { operacoes, diagnosticos, resultado } = resolverOperacoes(geradas, {
    versao_id: versao, job_id: idTeste('J', 3), modo, aliases, estagio: 'revisao', base: base(), blocos: [b1],
    elementosPermitidos: new Set([idTeste('K', 1)]), novoId: contadorDeIds('N'),
  });
  expect(operacoes.map((item) => item.op)).toEqual(['rebaixar', 'adicionar_elemento', 'criar_relacao']);
  expect(operacoes.map((item) => item.ordem)).toEqual([0, 1, 2]);
  expect(diagnosticos.map((item) => item.codigo)).toEqual([
    'evidencia_desconhecida', 'direcao_corrigida', 'fora_da_janela', 'ref_repetida', 'fundir_em_si', 'sem_efeito',
  ]);
  expect(resultado.elementos).toHaveLength(3);
  expect(resultado.relacoes).toHaveLength(1);
});

test('estrutura: unidades particionam o capítulo e o movimento só guarda unidades válidas', () => {
  const aliases = aliasesDoBase();
  const ordem = [b1.id, b2.id];
  const estrutura = resolverEstrutura({
    unidades: [{ ref: 'U1', inicio: 'B002', titulo: 't', funcao_no_capitulo: 'f' }, { ref: 'U2', inicio: 'B999', titulo: 't2', funcao_no_capitulo: 'f2' }],
    movimento: { texto: 'm', etapas: [{ unidades: ['U1'], descricao: 'd' }, { unidades: ['U2'], descricao: 'sem unidade' }] },
  }, ordem, aliases, contadorDeIds('W'));
  expect(estrutura.unidades.map((item) => [item.bloco_inicio, item.bloco_fim])).toEqual([[b1.id, b2.id]]);
  expect(estrutura.movimento.etapas).toHaveLength(1);
  expect(estrutura.diagnosticos.map((item) => item.codigo)).toEqual(['unidade_descartada', 'unidade_ajustada', 'etapa_sem_unidade']);
});

test('dificuldade que fala do leitor é reconhecida', () => {
  expect(falaDoLeitor('O leitor vai tropeçar.')).toBe(true);
  expect(falaDoLeitor('Você não vai entender.')).toBe(true);
  expect(falaDoLeitor('O autor omite a premissa.')).toBe(false);
});
