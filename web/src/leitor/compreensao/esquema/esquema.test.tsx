/**
 * Mapa esquemático do capítulo: layout em faixas (ELK de verdade, sem canvas), estados da tela
 * (sem mapa → gerar → gerando → pronto), clique no nó leva ao trecho, cartão com a citação,
 * vista em texto e regenerar. Nenhuma chamada real: as fontes do esquema são falsas.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { AncoraV1, EsquemaDoCapituloV1 } from '@margem/contratos';
import type { SituacaoDoEsquema } from '../../../biblioteca/api';
import { MapaDoCapitulo } from '../MapaDoCapitulo';
import { vistaInicial } from './DesenhoDoEsquema';
import { calcularLayout, caminhoArredondado, formaDoNo, MEDIDAS_LARGAS, quebrarLinhas, type MotorDeLayout } from './layout';
import type { FontesDoEsquema } from './useEsquema';

afterEach(() => { vi.useRealTimers(); });

const id = (n: number): string => `01K${String(n).padStart(23, '0')}`;
const V = id(1);
const ancora = (bloco: number, citacao: string): AncoraV1 => ({ versao_id: V, bloco_id: id(bloco), inicio_utf16: 0, fim_utf16: citacao.length, citacao, prefixo: '', sufixo: ' e mais' });

function esquema(): EsquemaDoCapituloV1 {
  return {
    versao: 1, id: id(900), versao_id: V, secao_id: id(60), compreensao_id: id(70), modelo_id: id(80), titulo: 'Da hipótese à conclusão',
    grupos: [{ id: 'G1', titulo: 'O problema', resumo: 'Onde começa.' }, { id: 'G2', titulo: 'A saída' }, { id: 'G3', titulo: 'O fecho' }],
    nos: [
      { id: 'N1', rotulo: 'Preços são rígidos?', tipo: 'questao', grupo_id: 'G1', detalhe: 'A pergunta de partida.', ancora: ancora(2, 'Admitamos que os preços são rígidos') },
      { id: 'N2', rotulo: 'Rigidez de preços', tipo: 'tese', grupo_id: 'G1' },
      { id: 'N3', rotulo: 'Cardápio impresso', tipo: 'exemplo', grupo_id: 'G2', ancora: ancora(3, 'o cardápio impresso') },
      { id: 'N4', rotulo: 'Choque reduz o produto', tipo: 'conclusao', grupo_id: 'G3', detalhe: 'A consequência.', ancora: ancora(5, 'o choque reduz o produto') },
    ],
    ligacoes: [
      { de: 'N1', para: 'N2', rotulo: 'leva a', forca: 'forte' },
      { de: 'N2', para: 'N3', rotulo: 'exemplifica', forca: 'forte' },
      { de: 'N3', para: 'N4', rotulo: 'sustenta', forca: 'forte' },
      { de: 'N1', para: 'N4', rotulo: 'responde', forca: 'fraca' },
    ],
    diagnosticos: [], execucao: { modelo: 'm', esforco: 'medium', prompt_versao: 'esquema-capitulo@1' }, criado_em: '2026-09-30T12:00:00.000Z',
  };
}
const motor = (): Promise<MotorDeLayout> => Promise.resolve(new ELK() as unknown as MotorDeLayout);

test('layout: faixas empilhadas na ordem dos grupos, nós dentro da sua faixa, salto pela raia e rótulo sobre a linha', async () => {
  for (const direcao of ['RIGHT', 'DOWN'] as const) {
    const layout = await calcularLayout(esquema(), MEDIDAS_LARGAS, await motor(), direcao);
    expect(layout.grupos.map((g) => g.id)).toEqual(['G1', 'G2', 'G3']);
    for (let i = 1; i < layout.grupos.length; i += 1) expect(layout.grupos[i]!.y).toBeGreaterThan(layout.grupos[i - 1]!.y + layout.grupos[i - 1]!.altura);
    expect(new Set(layout.grupos.map((g) => g.largura)).size).toBe(1);
    for (const item of layout.nos) {
      const faixa = layout.grupos.find((g) => g.id === item.no.grupo_id)!;
      expect(item.y).toBeGreaterThanOrEqual(faixa.y + 40);
      expect(item.y + item.altura).toBeLessThanOrEqual(faixa.y + faixa.altura);
      expect(item.x).toBeGreaterThanOrEqual(faixa.x);
    }
    const salto = layout.ligacoes.find((l) => l.de === 'N1' && l.para === 'N4')!;
    expect(salto.raia).toBe(true);
    expect(Math.max(...salto.pontos.map((p) => p.x))).toBeGreaterThan(layout.grupos[0]!.largura);
    const direta = layout.ligacoes.find((l) => l.de === 'N2' && l.para === 'N3')!;
    expect(direta.raia).toBeUndefined();
    expect(direta.pontos[0]!.y).toBe(layout.nos.find((n) => n.no.id === 'N2')!.y + layout.nos.find((n) => n.no.id === 'N2')!.altura);
    // Todas as setas têm um desenho; as com rótulo têm a etiqueta.
    expect(layout.ligacoes).toHaveLength(4);
    for (const ligacao of layout.ligacoes) expect(ligacao.etiqueta).toBeDefined();
  }
});

test('régua do desenho: quebra de linhas, formas por tipo, cantos arredondados e vista inicial legível', () => {
  const medir = (texto: string) => texto.length * 8;
  expect(quebrarLinhas('Engenharia busca produtividade e qualidade', 130, 14, medir)).toEqual(['Engenharia busca', 'produtividade e', 'qualidade']);
  expect(formaDoNo('tese', 200, 44)).toEqual({ tipo: 'rect', rx: 22 });
  expect(formaDoNo('questao', 200, 44)).toMatchObject({ tipo: 'polygon' });
  expect(formaDoNo('mecanismo', 200, 44)).toEqual({ tipo: 'rect', rx: 4 });
  expect(caminhoArredondado([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 50, y: 50 }])).toBe('M 0 0 L 0 40 Q 0 50 10 50 L 50 50');
  // Cabe inteiro: mostra tudo; no telefone, nunca abaixo de 80%.
  expect(vistaInicial({ largura: 1000, altura: 700 }, 1440, 900).escala).toBeCloseTo(1.1);
  expect(vistaInicial({ largura: 600, altura: 3000 }, 412, 800).escala).toBeCloseTo(0.8);
});

function fontes(situacoes: SituacaoDoEsquema[]): FontesDoEsquema & { gerar: ReturnType<typeof vi.fn> } {
  let i = 0;
  const ler = vi.fn(() => Promise.resolve(situacoes[Math.min(i++, situacoes.length - 1)]!));
  const gerar = vi.fn(() => Promise.resolve({ estado: 'pendente', pedido_id: id(901), esquema: situacoes.at(-1)?.esquema ?? null } as SituacaoDoEsquema));
  return { ler, gerar };
}

test('sem mapa: oferece gerar; gerando mostra a linha do pensamento; não há mais vista em texto', async () => {
  const falsas = fontes([{ estado: 'nenhum', pedido_id: null, esquema: null }]);
  render(<MapaDoCapitulo titulo="Capítulo um" aoIr={() => undefined} aoFechar={() => undefined}
    compreensaoId={id(70)} secaoId={id(60)} fontesDoEsquema={falsas} motorDoLayout={motor} />);
  expect(await screen.findByText('Este capítulo ainda não tem mapa')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Gerar mapa' }));
  await waitFor(() => expect(falsas.gerar).toHaveBeenCalledWith(id(70), id(60)));
  expect(await screen.findByText(/Leva um ou dois minutos/u)).toBeDefined();
  expect(screen.queryByRole('button', { name: /ver em texto/iu })).toBeNull();
  expect(screen.queryByRole('radio', { name: 'Em texto' })).toBeNull();
});

test('pronto: nós por tipo; foco mostra o cartão com a citação; clique leva ao trecho; regenerar pede outro', async () => {
  const pronto: SituacaoDoEsquema = { estado: 'pronto', pedido_id: id(900), esquema: esquema() };
  const falsas = fontes([pronto]);
  const aoIr = vi.fn();
  const { container } = render(<MapaDoCapitulo titulo="Capítulo um" aoIr={aoIr} aoFechar={() => undefined}
    compreensaoId={id(70)} secaoId={id(60)} fontesDoEsquema={falsas} motorDoLayout={motor} />);
  const questao = await screen.findByRole('button', { name: /^Questão: Preços são rígidos\?/u });
  expect(container.querySelectorAll('.no-do-esquema')).toHaveLength(4);
  expect(container.querySelector('.no-do-esquema.tipo-questao polygon')).not.toBeNull();
  expect(container.querySelector('.no-do-esquema.tipo-tese')?.getAttribute('role')).toBe('img');
  expect(container.querySelectorAll('.faixa-do-esquema .titulo-da-faixa')).toHaveLength(3);
  // O rótulo do salto (raia) só aparece com o nó aceso.
  expect(screen.queryByText('responde')).toBeNull();
  act(() => { questao.focus(); });
  const cartao = await screen.findByRole('tooltip');
  expect(cartao.textContent).toContain('A pergunta de partida.');
  expect(cartao.textContent).toContain('“Admitamos que os preços são rígidos”');
  expect(screen.getByText('responde')).toBeDefined();
  expect(container.querySelector('.no-do-esquema.tipo-exemplo')?.classList.contains('apagado')).toBe(true);
  // Clique (sem arrasto) leva ao trecho; Enter também.
  const tela = container.querySelector('.esquema-tela')!;
  fireEvent.pointerDown(questao, { pointerId: 1, button: 0, clientX: 10, clientY: 10, pointerType: 'mouse' });
  fireEvent.pointerUp(tela, { pointerId: 1, clientX: 11, clientY: 10, pointerType: 'mouse' });
  expect(aoIr).toHaveBeenCalledWith(esquema().nos[0]!.ancora);
  fireEvent.keyDown(screen.getByRole('button', { name: /^Conclusão: Choque reduz o produto/u }), { key: 'Enter' });
  expect(aoIr).toHaveBeenLastCalledWith(esquema().nos[3]!.ancora);
  // Arrastar não é clique.
  aoIr.mockClear();
  fireEvent.pointerDown(questao, { pointerId: 2, button: 0, clientX: 10, clientY: 10, pointerType: 'mouse' });
  fireEvent.pointerMove(tela, { pointerId: 2, clientX: 80, clientY: 60, pointerType: 'mouse' });
  fireEvent.pointerUp(tela, { pointerId: 2, clientX: 80, clientY: 60, pointerType: 'mouse' });
  expect(aoIr).not.toHaveBeenCalled();
  // Aproximar muda a escala; regenerar pede um esquema novo e o atual continua na tela.
  const antes = container.querySelector('.esquema-svg')?.getAttribute('data-escala');
  fireEvent.click(screen.getByRole('button', { name: 'Aproximar' }));
  expect(container.querySelector('.esquema-svg')?.getAttribute('data-escala')).not.toBe(antes);
  fireEvent.click(screen.getByRole('button', { name: 'Regenerar o mapa' }));
  await waitFor(() => expect(falsas.gerar).toHaveBeenCalledTimes(1));
  expect((await screen.findAllByText('Gerando um mapa novo…')).length).toBeGreaterThan(0);
  expect(container.querySelectorAll('.no-do-esquema')).toHaveLength(4);
});

test('falha ao gerar de novo: o esquema anterior fica, com o aviso dispensável', async () => {
  const falsas = fontes([{ estado: 'falhou', pedido_id: id(902), motivo: 'O Codex passou do prazo.', esquema: esquema() }]);
  render(<MapaDoCapitulo titulo="Capítulo um" aoIr={() => undefined} aoFechar={() => undefined}
    compreensaoId={id(70)} secaoId={id(60)} fontesDoEsquema={falsas} motorDoLayout={motor} />);
  expect((await screen.findByRole('alert')).textContent).toContain('O Codex passou do prazo.');
  fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(await screen.findByRole('button', { name: /^Questão:/u })).toBeDefined();
});
