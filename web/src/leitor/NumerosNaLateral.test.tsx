// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { NumerosNaLateral, type ItemDaLateral } from './NumerosNaLateral';

afterEach(cleanup);
const id = (n: number): string => String(n).padStart(26, '0');
const ancora = (inicio: number) => ({ versao_id: id(1), bloco_id: id(2), inicio_utf16: inicio, fim_utf16: inicio + 3, citacao: 'abc', prefixo: '', sufixo: '' });
const leitor = { current: { localizar: () => null, ancoraVisivel: () => null, retangulosDaAncora: () => [new DOMRect(40, 100, 200, 20)] } };

test('notas na mesma linha viram uma pilha de três com "+N"; o "+N" espalha a fileira', () => {
  const abertas: string[] = [];
  const itens: ItemDaLateral[] = [1, 2, 3, 4, 5].map((n) => ({ id: `m${String(n)}`, ancora: ancora(n * 5), rotulo: String(n), descricao: `Nota ${String(n)}`, aoAbrir: () => abertas.push(`m${String(n)}`) }));
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  try {
    render(<NumerosNaLateral itens={itens} leitor={leitor} coluna={() => new DOMRect(20, 0, 300, 1000)} />);
    expect(screen.getAllByRole('button', { name: /^Nota/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Mais 2 notas nesta linha' }));
    expect(screen.getAllByRole('button', { name: /^Nota/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Nota 5' }));
    expect(abertas).toEqual(['m5']);
    // Recolhida de novo, o primeiro toque num círculo da pilha só a espalha.
    fireEvent.click(screen.getByRole('button', { name: 'Nota 1' }));
    expect(abertas).toEqual(['m5']);
    expect(screen.getAllByRole('button', { name: /^Nota/ })).toHaveLength(5);
  } finally { vi.unstubAllGlobals(); }
});
