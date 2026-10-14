import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TiposDeTextoV1 } from '@margem/contratos';
import catalogo from '../../../contratos/tipos-de-texto.json';
import type { SituacaoDaPreparacao } from './api';
import { fraseDaPreparacao, rotuloDeAnalisar, tipoDeAnalise, TipoDoTexto, usePreparacao } from './Operacoes';
afterEach(() => { cleanup(); });

const base: SituacaoDaPreparacao = { documento_id: 'd', versao_id: 'v', estado: 'nao_preparada', tipo: null, itens: [], compreensao: null, capitulos: [], erro: null };
const capitulo = (estado: SituacaoDaPreparacao['capitulos'][number]['estado'], relacoes: number | null = null) =>
  ({ secao_id: estado, titulo: estado, estado, etapa: estado, relacoes });

test('"Analisar" é o botão principal em todo estado com texto; a frase do estado é honesta e curta', () => {
  expect(rotuloDeAnalisar(null)).toEqual({ rotulo: 'Analisar', desabilitado: false });
  expect(rotuloDeAnalisar(base)).toEqual({ rotulo: 'Analisar', desabilitado: false });
  expect(rotuloDeAnalisar({ ...base, estado: 'falhou' })).toEqual({ rotulo: 'Tentar de novo', desabilitado: false });
  expect(rotuloDeAnalisar({ ...base, estado: 'preparando' })).toEqual({ rotulo: 'Analisando…', desabilitado: true });
  expect(rotuloDeAnalisar({ ...base, estado: 'identificando' })).toEqual({ rotulo: 'Analisando…', desabilitado: true });
  // Pronta: a mesma janela acrescenta o que faltar (flashcards, mapa…).
  expect(rotuloDeAnalisar({ ...base, estado: 'pronta' })).toEqual({ rotulo: 'Analisar', desabilitado: false });
  expect(rotuloDeAnalisar({ ...base, estado: 'sem_texto' })).toBeNull();
  expect(tipoDeAnalise({ midia: { tipo: 'video' } })).toBe('video');
  expect(tipoDeAnalise({ midia: null })).toBe('texto');
  // Sem texto explicativo antes da análise: o botão basta.
  expect(fraseDaPreparacao(base, true)).toBeNull();
  expect(fraseDaPreparacao({ ...base, estado: 'pronta', capitulos: [capitulo('pronto', 1)] }, true)).toBe('Análise pronta · 1 relação.');
  const livro = { ...base, estado: 'preparando' as const, capitulos: [capitulo('pronto', 4), capitulo('preparando'), capitulo('nao_preparado')] };
  expect(fraseDaPreparacao(livro, false)).toBe('Analisando… 1 de 3 capítulos prontos.');
  expect(fraseDaPreparacao({ ...base, estado: 'falhou', erro: { codigo: 'cota', mensagem: 'A cota do Codex acabou por agora.' } }, true))
    .toBe('A análise parou: A cota do Codex acabou por agora.');
});

const guardada: { atual: SituacaoDaPreparacao | null } = { atual: null };
function ComTipo({ situacao, escolhas }: { situacao: SituacaoDaPreparacao; escolhas: string[] }) {
  guardada.atual ??= situacao;
  const preparacao = usePreparacao('d', true, {
    situacao: () => Promise.resolve(guardada.atual ?? situacao),
    preparar: () => Promise.reject(new Error('não usado')),
    tipos: () => Promise.resolve({ tipos: catalogo as TiposDeTextoV1 }),
    escolherTipo: (_id, tipo) => {
      escolhas.push(tipo);
      guardada.atual = { ...situacao, tipo: { ...situacao.tipo!, tipo_id: tipo, rotulo: 'Documento da Igreja', grupo: 'Religião e espiritualidade', origem: 'escolhido', confianca: null } };
      return Promise.resolve(guardada.atual);
    },
  });
  return <TipoDoTexto preparacao={preparacao} />;
}

test('o tipo detectado aparece como chip; "mudar" abre os tipos do contrato, agrupados e com busca', async () => {
  const escolhas: string[] = [];
  const situacao: SituacaoDaPreparacao = { ...base, tipo: { tipo_id: 'conto', rotulo: 'Conto', grupo: 'Literatura', origem: 'detectado', confianca: 'baixa',
    justificativa: 'Narrativa curta com desfecho.', alternativas: [{ tipo_id: 'cronica', rotulo: 'Crônica' }] } };
  render(<ComTipo situacao={situacao} escolhas={escolhas} />);
  // Confiança baixa: "Conto?" e o convite a confirmar.
  expect((await screen.findByText(/Tipo: Conto\?/u)).textContent).toBe('Tipo: Conto? Literatura');
  fireEvent.click(screen.getByRole('button', { name: 'confirmar' }));
  expect(await screen.findByRole('region', { name: 'Religião e espiritualidade' })).toBeDefined();
  expect(screen.getByText('Também pode ser: Crônica.')).toBeDefined();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'encíclica' } });
  expect(screen.queryByRole('region', { name: 'Literatura' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Documento da Igreja/u }));
  await waitFor(() => expect(escolhas).toEqual(['magisterio']));
  expect(await screen.findByText(/Tipo: Documento da Igreja/u)).toBeDefined();
  expect(screen.getByRole('button', { name: 'mudar' })).toBeDefined();
});
