// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { ResolucaoGeradaV1 } from '@margem/contratos';
import { formulaSegura, partesDaMatematica, TextoComMatematica, LinhasDoCalculo } from './Matematica';
import v1 from './fixtures/resolucao-p17-v1.json';
import v2 from './fixtures/resolucao-p17-v2.json';

afterEach(cleanup);

test('separa texto e fórmulas: $$ antes de $, \\$ literal, $ sem par fica como texto', () => {
  expect(partesDaMatematica('para $n \\ge 1$, vale')).toEqual([{ tipo: 'texto', valor: 'para ' }, { tipo: 'formula', tex: 'n \\ge 1', destacada: false }, { tipo: 'texto', valor: ', vale' }]);
  expect(partesDaMatematica('$$\\frac{1}{2}$$')).toEqual([{ tipo: 'formula', tex: '\\frac{1}{2}', destacada: true }]);
  expect(partesDaMatematica('custa \\$ 10')).toEqual([{ tipo: 'texto', valor: 'custa $ 10' }]);
  expect(partesDaMatematica('um $ solto')).toEqual([{ tipo: 'texto', valor: 'um $ solto' }]);
  expect(partesDaMatematica('1 + 2 + ⋯ + n = n(n + 1)/2')).toEqual([{ tipo: 'texto', valor: '1 + 2 + ⋯ + n = n(n + 1)/2' }]);
  expect(partesDaMatematica('$$ $$')).toEqual([{ tipo: 'texto', valor: '$$ $$' }]);
});

test('a fórmula passa pelo KaTeX sem trust e pelo DOMPurify: nada de link, script nem manipulador', async () => {
  const caixa = document.createElement('div');
  caixa.append(await formulaSegura('\\href{javascript:alert(1)}{x} + \\url{http://x} + \\htmlClass{a}{b}', false));
  expect(caixa.querySelector('a, script, [onclick], [href]')).toBeNull();
  const quebrada = document.createElement('div');
  quebrada.append(await formulaSegura('\\frac{1}{', false));
  // throwOnError: false: a fórmula quebrada vira o próprio código, sem exceção.
  expect(quebrada.textContent).toContain('\\frac{1}{');
  const { container } = render(<TextoComMatematica texto={'<img src=x onerror=alert(1)> e $<b>x</b>$'} />);
  expect(container.querySelector('img, b')).toBeNull();
  expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
});

// A validade da fixture no contrato é conferida em `servico/src/resolucao/prompts.test.ts`.
test('fixture real do @2 (p. 17): desenhada pelo KaTeX; a do @1 continua texto', async () => {
  const gerada = v2 as ResolucaoGeradaV1;
  const passo = gerada.itens[0]!.passos[0]!;
  const { container } = render(<><p><TextoComMatematica texto={passo.texto} /></p><p><LinhasDoCalculo calculo={passo.calculo!} /></p></>);
  await waitFor(() => expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2));
  expect(container.querySelector('.formula-destacada .katex-display')).not.toBeNull();
  expect(container.textContent).not.toContain('$');
  cleanup();
  const antiga = v1 as ResolucaoGeradaV1;
  const { container: antigo } = render(<LinhasDoCalculo calculo={antiga.itens[1]!.passos[4]!.calculo!} />);
  expect(antigo.querySelector('.katex')).toBeNull();
  expect([...antigo.querySelectorAll('.linha-do-calculo')].map((linha) => linha.textContent)).toEqual(['k² + (2k + 1) = k² + 2k + 1', 'k² + 2k + 1 = (k + 1)²']);
});
