import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BarraDeSelecao } from './BarraDeSelecao';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import { readFileSync } from 'node:fs';
const estilos = readFileSync(`${import.meta.dirname}/estudo.css`, 'utf8');

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
