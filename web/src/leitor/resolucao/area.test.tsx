// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AncoraV1 } from '@margem/contratos';
import { FerramentaDeArea } from './FerramentaDeArea';

// O jsdom não tem PointerEvent: sem ele, o evento chega sem clientX/clientY.
if (typeof window.PointerEvent === 'undefined') (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

/** Uma página de PDF falsa em 100–700 × 100–900, com um canvas desenhado. */
function pagina(): HTMLElement {
  const folha = document.createElement('div');
  folha.className = 'pdf-pagina'; folha.dataset['pagina'] = '17';
  folha.getBoundingClientRect = () => new DOMRect(100, 100, 600, 800);
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => new DOMRect(100, 100, 600, 800);
  folha.append(canvas);
  document.body.append(folha);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: () => undefined, drawImage: () => undefined, fillStyle: '' } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
  return folha;
}

function arrastar(de: [number, number], ate: [number, number]): void {
  const camada = screen.getByRole('application');
  camada.setPointerCapture = () => undefined;
  fireEvent.pointerDown(camada, { clientX: de[0], clientY: de[1], pointerId: 1 });
  fireEvent.pointerMove(camada, { clientX: ate[0], clientY: ate[1], pointerId: 1 });
  fireEvent.pointerUp(camada, { clientX: ate[0], clientY: ate[1], pointerId: 1 });
}

test('área com texto: minibarra Resolver · Explicar · Imagem · Nota; a ação leva o recorte (em frações da página) e o trecho', () => {
  pagina();
  const ancora = { bloco_id: 'B', citacao: 'x' } as unknown as AncoraV1;
  const agir = vi.fn();
  const ancoraDaArea = vi.fn(() => ancora);
  render(<FerramentaDeArea aoAgir={agir} aoCancelar={() => undefined} ancoraDaArea={ancoraDaArea} />);
  arrastar([160, 180], [460, 380]);
  const barra = screen.getByRole('toolbar', { name: 'O que fazer com a área' });
  expect([...barra.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Resolver', 'Explicar', 'Imagem', 'Nota', '']);
  expect(ancoraDaArea).toHaveBeenLastCalledWith(17, { x: .1, y: .1, largura: .5, altura: .25 });
  fireEvent.click(screen.getByRole('button', { name: 'Explicar' }));
  expect(agir).toHaveBeenCalledWith('explicar', expect.objectContaining({ pagina: 17, retangulo: { x: .1, y: .1, largura: .5, altura: .25 }, imagem_png: 'data:image/png;base64,AAAA' }), ancora);
});

test('área sem texto (página escaneada): só o Resolver; Esc cancela', () => {
  pagina();
  const cancelar = vi.fn();
  render(<FerramentaDeArea aoAgir={() => undefined} aoCancelar={cancelar} ancoraDaArea={() => null} />);
  arrastar([160, 180], [460, 380]);
  expect(screen.getByRole('button', { name: 'Resolver' }).hasAttribute('disabled')).toBe(false);
  for (const nome of ['Explicar', 'Imagem', 'Nota']) expect(screen.getByRole('button', { name: nome }).hasAttribute('disabled')).toBe(true);
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(cancelar).toHaveBeenCalled();
});
