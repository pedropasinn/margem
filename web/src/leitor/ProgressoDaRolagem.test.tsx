import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ProgressoDaRolagem } from './ProgressoDaRolagem';

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.getElementById('raiz-do-teste')?.remove(); });

test('o artigo que chega depois (o PDF carrega por último) passa a ser medido', async () => {
  const raiz = document.createElement('div'); raiz.id = 'raiz-do-teste'; document.body.append(raiz);
  render(<ProgressoDaRolagem raiz={raiz} />);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  // O artigo aparece depois de a barra montar, já rolado até a metade.
  vi.stubGlobal('innerHeight', 1000);
  const artigo = document.createElement('article'); artigo.className = 'capitulo';
  artigo.getBoundingClientRect = () => new DOMRect(0, -1500, 800, 4000);
  await act(async () => { raiz.append(artigo); await new Promise((pronto) => setTimeout(pronto, 0)); });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  vi.unstubAllGlobals();
});
