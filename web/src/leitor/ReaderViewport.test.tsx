import { afterEach, describe, expect, test, vi } from 'vitest';
import { createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { ReaderViewport } from './ReaderViewport';
import type { ApiDoLeitor } from './tipos';
import { capituloExemplo } from './fixtures/capitulo-exemplo';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ReaderViewport', () => {
  test('a estratégia de F1 é a rolagem e não muda o texto', () => {
    const { container } = render(<ReaderViewport snapshot={capituloExemplo} estrategia="scroll" />);
    const leitor = container.querySelector('.leitor');
    expect(leitor?.getAttribute('data-estrategia')).toBe('scroll');
    expect(container.querySelectorAll('[data-bloco]')).toHaveLength(capituloExemplo.blocos.length);
  });

  test('localizar devolve a geometria de um ponto textual e null fora do texto', () => {
    const referencia = createRef<ApiDoLeitor>();
    render(<ReaderViewport ref={referencia} snapshot={capituloExemplo} />);
    const bloco = capituloExemplo.blocos[2];
    expect(bloco).toBeDefined();
    if (bloco === undefined) return;

    expect(referencia.current?.localizar(bloco.id, 0)).not.toBeNull();
    expect(referencia.current?.localizar(bloco.id, bloco.texto.length)).not.toBeNull();
    expect(referencia.current?.localizar(bloco.id, bloco.texto.length + 5)).toBeNull();
    expect(referencia.current?.localizar('00000000000000000000000ZZZ', 0)).toBeNull();
  });

  test('ancoraVisivel devolve identidade textual, não página nem scrollTop', () => {
    const referencia = createRef<ApiDoLeitor>();
    render(<ReaderViewport ref={referencia} snapshot={capituloExemplo} />);
    const ponto = referencia.current?.ancoraVisivel();
    expect(ponto).not.toBeNull();
    expect(capituloExemplo.blocos.some((bloco) => bloco.id === ponto?.bloco_id)).toBe(true);
    expect(Number.isSafeInteger(ponto?.offset_utf16 ?? -1)).toBe(true);
  });
});


test('âncoras no mesmo bloco usam a janela visível correta e ignoram o texto fora dos recortes', () => {
  const referencia = createRef<ApiDoLeitor>();
  const { container } = render(<ReaderViewport ref={referencia} snapshot={capituloExemplo} />);
  const bloco = capituloExemplo.blocos[2]!;
  const original = container.querySelector<HTMLElement>(`[data-bloco="${bloco.id}"]`)!;
  for (const [indice, topo] of [200, 400].entries()) {
    const janela = document.createElement('div');
    janela.dataset['recorteTexto'] = ''; janela.dataset['recorteBloco'] = bloco.id;
    janela.dataset['indiceTeste'] = String(indice);
    janela.append(original.cloneNode(true)); original.before(janela);
    vi.spyOn(janela, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, topo, 600, 40));
  }
  const anterior = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: function (this: Range) {
    const janela = this.startContainer.parentElement?.closest<HTMLElement>('[data-recorte-texto]');
    const certa = janela?.dataset['indiceTeste'] === String(this.startOffset);
    return [new DOMRect(100, certa ? Number(janela?.dataset['indiceTeste']) * 200 + 210 : 0, 100, 20)];
  } });
  try {
    const ancora = { ...capituloExemplo.marcas[0]!.ancora, bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: 1 };
    expect(referencia.current?.retangulosDaAncora?.(ancora).map((r) => r.top)).toEqual([210]);
    expect(referencia.current?.retangulosDaAncora?.({ ...ancora, inicio_utf16: 1, fim_utf16: 2 }).map((r) => r.top)).toEqual([410]);
    expect(referencia.current?.retangulosDaAncora?.({ ...ancora, inicio_utf16: 2, fim_utf16: 3 })).toEqual([]);
  } finally {
    if (anterior) Object.defineProperty(Range.prototype, 'getClientRects', anterior);
    else delete (Range.prototype as Partial<Range>).getClientRects;
  }
});
