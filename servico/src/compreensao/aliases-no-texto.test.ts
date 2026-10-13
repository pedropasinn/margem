import { expect, test } from 'vitest';
import type { ElementoSemanticoV1 } from '@margem/contratos';
import { novosAliases } from '@margem/core';
import { contadorDeIds, idTeste } from '../../testes/apoio.js';
import { exigirModo } from '../modos.js';
import { retirarAliases, temAlias, traduzirAliasesNoTexto, trechoEntreAspas } from './aliases-no-texto.js';
import { resolverAnalise, resolverPlano } from './resolver.js';

const versao = idTeste('V', 1);
const b1 = { id: idTeste('B', 1), texto: 'Dividindo ambos os lados por (a − b), obtemos a + b = b, o que é absurdo.' };
const b2 = { id: idTeste('B', 2), texto: 'Uma cidade sem fila visível é, para todos os efeitos que importam, uma cidade saudável.' };
const elemento: ElementoSemanticoV1 = {
  id: idTeste('K', 1), nucleo: 'afirmacao', papel: 'tese', enunciado: 'e', qualificadores: [], centralidade: 1, notas: [],
  ancoras: [{ versao_id: versao, bloco_id: b2.id, citacao: b2.texto, prefixo: '', sufixo: '', inicio_utf16: 0, fim_utf16: b2.texto.length }],
  origem: { estagio: 'revisao', job_id: idTeste('J', 1) },
};

function fontes() {
  const aliases = novosAliases();
  aliases.blocos.registrar(b1.id);
  aliases.blocos.registrar(b2.id);
  aliases.elementos.registrar(elemento.id);
  return {
    aliases, blocos: new Map([[b1.id, b1], [b2.id, b2]]), elemento: (id: string) => (id === elemento.id ? elemento : undefined),
    textoDoCapitulo: `${b1.texto}\n${b2.texto}`,
  };
}

test('detecta aliases e cita o começo do que eles nomeiam', () => {
  expect(temAlias('divisão em B001')).toBe(true);
  expect(temAlias('vitamina B12 e Lula')).toBe(false);
  expect(trechoEntreAspas('Uma cidade sem fila visível é, para todos os efeitos')).toBe('“Uma cidade sem fila visível é…”');
});

test('tradução: bloco vira "no trecho “…”", elemento vira a citação; alias desconhecido some', () => {
  const f = fontes();
  expect(traduzirAliasesNoTexto('A divisão por a − b em B001 é ilegítima.', f))
    .toBe('A divisão por a − b no trecho “Dividindo ambos os lados por (a…” é ilegítima.');
  expect(traduzirAliasesNoTexto('A distinção encenada em L01.', f)).toBe('A distinção encenada em “Uma cidade sem fila visível é…”.');
  expect(traduzirAliasesNoTexto('Ver L01 (B002).', f)).toBe('Ver “Uma cidade sem fila visível é…” (o trecho “Uma cidade sem fila visível é…”).');
  expect(traduzirAliasesNoTexto('Como mostra L77, nada.', f)).toBe('Como mostra, nada.');
  // Token que é texto do capítulo fica.
  expect(traduzirAliasesNoTexto('O B001 citado.', { ...f, textoDoCapitulo: 'O modelo B001 da fábrica.' })).toBe('O B001 citado.');
});

test('rede de segurança sem tabela: tira alias e preposição, deixa refs n… e texto do autor', () => {
  expect(retirarAliases('identificando a divisão por a − b em B007 e explicitando', '')).toBe('identificando a divisão por a − b e explicitando');
  expect(retirarAliases('A igualdade em B008 usa a hipótese.', '')).toBe('A igualdade usa a hipótese.');
  expect(retirarAliases('Sem alias aqui.', '')).toBe('Sem alias aqui.');
  expect(retirarAliases('O termo n1 é notação.', '')).toBe('O termo n1 é notação.');
  expect(retirarAliases('O U2 tocou.', 'A banda U2 tocou.')).toBe('O U2 tocou.');
});

test('resolvedor da análise: aliases e refs novas saem do texto livre; relação distante vira retrospectiva', () => {
  const modo = exigirModo({ id: 'argumentativa', revisao: 1 });
  const aliases = novosAliases();
  const blocos = [b1, ...Array.from({ length: 4 }, (_, i) => ({ id: idTeste('B', 10 + i), texto: `Bloco ${String(i)}.` })), b2];
  for (const bloco of blocos) aliases.blocos.registrar(bloco.id);
  const resolvida = resolverAnalise({
    elementos: [
      { ref: 'n1', nucleo: 'afirmacao', papel: 'tese', citacoes: [{ bloco: 'B001', citacao: 'obtemos a + b = b', prefixo: '', sufixo: '' }],
        enunciado: 'O passo em B001 divide por zero.', qualificadores: [], centralidade: 1, notas: [{ tipo: 'OBJECAO', texto: 'Contraria n2.' }] },
      { ref: 'n2', nucleo: 'afirmacao', papel: 'tese', citacoes: [{ bloco: 'B006', citacao: 'Uma cidade sem fila visível', prefixo: '', sufixo: '' }],
        enunciado: 'A cidade.', qualificadores: [], centralidade: 2, notas: [] },
    ],
    relacoes: [{ origem: 'n2', destino: 'n1', tipo: 'retoma', explicacao: 'n2 retoma n1 em B001.', confianca: 'alta' }],
    dificuldades: [], resumo_da_parte: 'Resumo com B006.', limites: [], leitura_integral: true,
  }, { versao_id: versao, job_id: idTeste('J', 2), modo, aliases, responsaveis: blocos, novoId: contadorDeIds('N') });
  expect(resolvida.elementos[0]?.enunciado).toBe('O passo no trecho “Dividindo ambos os lados por (a…” divide por zero.');
  expect(resolvida.elementos[0]?.notas[0]?.texto).toBe('Contraria “Uma cidade sem fila visível”.');
  expect(resolvida.relacoes[0]?.explicacao).toBe('“Uma cidade sem fila visível” retoma “obtemos a + b = b” no trecho “Dividindo ambos os lados por (a…”.');
  expect(resolvida.relacoes[0]?.retrospectiva).toBe(true);
  expect(resolvida.resumo_da_parte).toBe('Resumo com o trecho “Uma cidade sem fila visível é…”.');
});

test('resolvedor do plano: passo e apoio sem aliases', () => {
  const aliases = novosAliases();
  aliases.blocos.registrar(b1.id);
  aliases.elementos.registrar(elemento.id);
  const modelo = {
    versao: 1 as const, id: idTeste('M', 1), execucao_id: idTeste('E', 1), versao_id: versao, secao_id: idTeste('S', 1), modo: { id: 'argumentativa', revisao: 1 },
    revisao: 2, estagio: 'revisao' as const, base_id: null, lote_id: null, movimento: null, unidades: [], elementos: [elemento], relacoes: [], dificuldades: [],
    criada_em: '2026-09-29T12:00:00Z',
  };
  const plano = resolverPlano({
    passos: [{ inicio: 'B001', foco: ['L01'], observar: 'Repare em L01.', explicacao: { curta: 'A igualdade em B001 usa a hipótese.', longa: 'x' },
      relacoes: [], parada: { tipo: 'pergunta', texto: 'O que B001 esconde?' } }],
    apoios: [{ alvo: 'L01', tipo: 'explicar', texto: 'L01 é a tese.' }],
  }, [b1.id], modelo, aliases, [b1, b2]);
  expect(plano.passos[0]?.observar).toBe('Repare em “Uma cidade sem fila visível é…”.');
  expect(plano.passos[0]?.explicacao.curta).toBe('A igualdade no trecho “Dividindo ambos os lados por (a…” usa a hipótese.');
  expect(plano.passos[0]?.parada?.texto).toBe('O que o trecho “Dividindo ambos os lados por (a…” esconde?');
  expect(plano.apoios[0]?.texto).toBe('“Uma cidade sem fila visível é…” é a tese.');
});
