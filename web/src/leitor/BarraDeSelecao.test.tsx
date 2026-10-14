import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AcoesDaSelecao, BarraDeSelecao } from './BarraDeSelecao';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import { readFileSync } from 'node:fs';
const estilos = readFileSync(`${import.meta.dirname}/barra-de-selecao.css`, 'utf8');

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('limita a seleção pela largura medida, recalcula no resize e preserva o aviso', () => {
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
  let largura = 520;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: largura, height: 40 } as DOMRect));
  const selecao = { ancora: capituloExemplo.marcas[0]!.ancora, aparada: true, caixa: { left: 950, bottom: 100 } as DOMRect };
  render(<BarraDeSelecao selecao={selecao}><span>Conectar a este trecho</span></BarraDeSelecao>);
  const barra = screen.getByRole('toolbar', { name: 'Ações da seleção' });
  expect(barra.style.left).toBe('468px');
  expect(barra.style.top).toBe('108px');
  expect(estilos.match(/\.barra-selecao \{([^}]+)\}/)?.[1]).toContain('flex-wrap: nowrap');
  expect(screen.getByRole('status').textContent).toBe('Seleção aparada ao primeiro bloco.');
  largura = 260;
  fireEvent.resize(window);
  expect(barra.style.left).toBe('728px');
});

test('fica acima da seleção quando cabe, sem cobrir a linha seguinte; perto do topo, desce para baixo dela', () => {
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 380, height: 40 } as DOMRect));
  const ancora = capituloExemplo.marcas[0]!.ancora;
  const { rerender } = render(<BarraDeSelecao selecao={{ ancora, aparada: false, caixa: { left: 200, top: 300, bottom: 360 } as DOMRect }}><span>a</span></BarraDeSelecao>);
  const barra = screen.getByRole('toolbar', { name: 'Ações da seleção' });
  expect(barra.style.top).toBe(`${String(300 - 40 - 8)}px`);
  expect(barra.dataset['lado']).toBe('acima');
  rerender(<BarraDeSelecao selecao={{ ancora, aparada: false, caixa: { left: 200, top: 70, bottom: 120 } as DOMRect }}><span>b</span></BarraDeSelecao>);
  expect(barra.style.top).toBe('128px');
  expect(barra.dataset['lado']).toBe('abaixo');
});

test('ações da seleção: cores grifam já com a função (também pelas teclas 1 a 4), sem Anotar; o resto fica no "…"', () => {
  const aoGrifar = vi.fn(); const flashcard = vi.fn();
  render(<AcoesDaSelecao aoGrifar={aoGrifar} aoPerguntar={vi.fn()} aoConectar={vi.fn()} mais={[{ id: 'flashcard', rotulo: 'Criar flashcard', executar: flashcard }]} />);
  expect(screen.getAllByRole('button').map((botao) => botao.getAttribute('aria-label'))).toEqual(['Grifar como Tese', 'Grifar como Conceito', 'Grifar como Justificativa', 'Grifar', 'Perguntar', 'Conectar', 'Mais ações']);
  fireEvent.click(screen.getByRole('button', { name: 'Grifar como Conceito' }));
  expect(aoGrifar).toHaveBeenLastCalledWith(expect.objectContaining({ chave: 'conceito' }));
  fireEvent.keyDown(window, { key: '4' });
  expect(aoGrifar).toHaveBeenLastCalledWith(expect.objectContaining({ chave: 'nenhuma' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Criar flashcard' }));
  expect(flashcard).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});
