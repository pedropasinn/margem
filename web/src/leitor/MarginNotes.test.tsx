import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Comentario, Id } from '@margem/contratos';
import { DESLOCAMENTO_MAXIMO, ESPACO_ENTRE_NOTAS, MarginNotes } from './MarginNotes';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import { FILTRO_PADRAO, marcasFiltradas, notasDoCapitulo } from './notas';

/**
 * O jsdom não tem layout: todos os retângulos são zero. Estes dois mapas fazem as vezes da
 * geometria do navegador — topo do trecho por marca e altura da nota por marca.
 */
const topoDoTrecho = new Map<Id, number>();
const alturaDaNota = new Map<Id, number>();
let aoRedimensionar: (() => void) | null = null;

function caixa(topo: number, altura: number): DOMRect {
  return {
    top: topo, bottom: topo + altura, height: altura, left: 0, right: 0, width: 0, x: 0, y: topo,
    toJSON: () => ({}),
  };
}

function listaDeRetangulos(retangulos: readonly DOMRect[]): DOMRectList {
  const lista: unknown = Object.assign([...retangulos], {
    item: (indice: number) => retangulos[indice] ?? null,
  });
  return lista as DOMRectList;
}

function retanguloDe(elemento: Element): DOMRect {
  const alvo = elemento as HTMLElement;
  const nota = alvo.dataset['nota'];
  if (nota !== undefined) return caixa(0, alturaDaNota.get(nota) ?? 0);
  const marcas = alvo.dataset['marcas'];
  if (marcas !== undefined) {
    const primeira = marcas.split(' ')[0] ?? '';
    return caixa(topoDoTrecho.get(primeira) ?? 0, 18);
  }
  return caixa(0, 0);
}

beforeEach(() => {
  topoDoTrecho.clear();
  alturaDaNota.clear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return retanguloDe(this);
  });
  // `Range.selectNodeContents(span)` deixa o próprio span como `startContainer`.
  Range.prototype.getClientRects = function (this: Range): DOMRectList {
    const inicio = this.startContainer;
    return listaDeRetangulos(inicio instanceof Element ? [retanguloDe(inicio)] : []);
  };
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly retorno: () => void) { aoRedimensionar = retorno; }
    observe(): void { /* a geometria é dos mapas acima. */ }
    disconnect(): void { aoRedimensionar = null; }
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  aoRedimensionar = null;
});

const COMENTARIO: Comentario = { tipo: 'AUTOR', rotulo: 'Rótulo', texto: 'Texto da nota.' };

/** Três marcas do fixture, com comentário, na ordem do capítulo. */
function notasDeTeste(): ReturnType<typeof notasDoCapitulo> {
  return notasDoCapitulo(capituloExemplo.blocos, marcasFiltradas(capituloExemplo.marcas, FILTRO_PADRAO))
    .slice(0, 3)
    .map((nota) => ({ ...nota, comentario: COMENTARIO }));
}

/** DOM mínimo do artigo: um span por marca, com `data-marcas`, como `AnnotatedText` produz. */
function artigoCom(ids: readonly Id[]): HTMLElement {
  const artigo = document.createElement('div');
  for (const id of ids) {
    const span = document.createElement('span');
    span.dataset['marcas'] = id;
    span.dataset['inicio'] = '0';
    span.append(document.createTextNode('trecho'));
    artigo.append(span);
  }
  document.body.append(artigo);
  return artigo;
}

function topos(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>('.nota')].map((nota) =>
    Number(/translateY\((-?[\d.]+)px\)/.exec(nota.style.transform)?.[1] ?? NaN));
}

describe('MarginNotes', () => {
  test('a saliência não muda o número da nota (V-T3: sem níveis de atenção)', () => {
    const [primeira, segunda] = notasDeTeste();
    if (!primeira || !segunda) throw new Error('notas esperadas');
    const periferica = { ...segunda, marca: { ...segunda.marca, saliencia: 3 as const } };
    const { container } = render(
      <MarginNotes notas={[primeira, periferica]} artigo={artigoCom([primeira.marca.id, segunda.marca.id])} ativa={null} fixada={null} />,
    );
    const numeros = [...container.querySelectorAll('.nota-numero')];
    expect(numeros.map((numero) => numero.classList.contains('periferica'))).toEqual([false, false]);
  });
  test('alinha pelo topo do trecho e empilha sem cobrir a nota anterior', () => {
    const notas = notasDeTeste();
    const ids = notas.map((nota) => nota.marca.id);
    topoDoTrecho.set(ids[0] ?? '', 100);
    topoDoTrecho.set(ids[1] ?? '', 110);
    topoDoTrecho.set(ids[2] ?? '', 900);
    for (const id of ids) alturaDaNota.set(id, 60);

    const { container } = render(
      <MarginNotes notas={notas} artigo={artigoCom(ids)} ativa={null} fixada={null} />,
    );
    // A primeira fica no topo do trecho; a segunda desce o necessário; a terceira volta a alinhar.
    expect(topos(container)).toEqual([100, 100 + 60 + ESPACO_ENTRE_NOTAS, 900]);
  });

  test('recolhida (J132): o que começa na mesma linha fica lado a lado, na altura do trecho, sem descer', () => {
    const notas = notasDeTeste();
    const ids = notas.map((nota) => nota.marca.id);
    topoDoTrecho.set(ids[0] ?? '', 100);
    topoDoTrecho.set(ids[1] ?? '', 104);
    topoDoTrecho.set(ids[2] ?? '', 300);
    for (const id of ids) alturaDaNota.set(id, 24);
    const { container } = render(<MarginNotes notas={notas} artigo={artigoCom(ids)} ativa={null} fixada={null} recolhida />);
    const transformacoes = [...container.querySelectorAll<HTMLElement>('.nota')].map((nota) => nota.style.transform);
    expect(transformacoes).toEqual(['translateY(100px)', 'translate(30px, 100px)', 'translateY(300px)']);
  });

  test('a nota nunca empurra nem cobre o texto: fica em absoluto na própria coluna', () => {
    const notas = notasDeTeste();
    const ids = notas.map((nota) => nota.marca.id);
    const { container } = render(
      <MarginNotes notas={notas} artigo={artigoCom(ids)} ativa={null} fixada={null} />,
    );
    expect(container.querySelector('.margem')).not.toBeNull();
    for (const nota of container.querySelectorAll<HTMLElement>('.nota')) {
      expect(nota.closest('.capitulo')).toBeNull();
    }
  });

  test('deslocamento acima do máximo vira resumo, e a nota ativa abre inteira', () => {
    const notas = notasDeTeste();
    const ids = notas.map((nota) => nota.marca.id);
    topoDoTrecho.set(ids[0] ?? '', 0);
    topoDoTrecho.set(ids[1] ?? '', 10);
    topoDoTrecho.set(ids[2] ?? '', 20);
    alturaDaNota.set(ids[0] ?? '', DESLOCAMENTO_MAXIMO + 100);
    alturaDaNota.set(ids[1] ?? '', 40);
    alturaDaNota.set(ids[2] ?? '', 40);

    const artigo = artigoCom(ids);
    const { container, rerender } = render(
      <MarginNotes notas={notas} artigo={artigo} ativa={null} fixada={null} />,
    );
    const segunda = container.querySelectorAll<HTMLElement>('.nota')[1];
    expect(segunda?.classList.contains('resumo')).toBe(true);

    rerender(<MarginNotes notas={notas} artigo={artigo} ativa={ids[1] ?? null} fixada={null} />);
    const ativa = container.querySelectorAll<HTMLElement>('.nota')[1];
    expect(ativa?.classList.contains('resumo')).toBe(false);
    expect(ativa?.classList.contains('ativa')).toBe(true);
  });

  test('ResizeObserver do artigo reposiciona as notas', () => {
    const notas = notasDeTeste();
    const ids = notas.map((nota) => nota.marca.id);
    topoDoTrecho.set(ids[0] ?? '', 100);
    const { container } = render(
      <MarginNotes notas={notas} artigo={artigoCom(ids)} ativa={null} fixada={null} />,
    );
    expect(topos(container)[0]).toBe(100);

    topoDoTrecho.set(ids[0] ?? '', 320);
    expect(aoRedimensionar).not.toBeNull();
    act(() => { aoRedimensionar?.(); });
    expect(topos(container)[0]).toBe(320);
  });

  test('as ações só aparecem na nota fixada e a recuperação fica no fim da margem', () => {
    const notas = notasDeTeste();
    const ids = notas.map((nota) => nota.marca.id);
    const acoes = { alternarVisibilidade: vi.fn(), avaliar: vi.fn() };
    const { container } = render(
      <MarginNotes
        notas={notas}
        artigo={artigoCom(ids)}
        ativa={ids[0] ?? null}
        fixada={ids[0] ?? null}
        acoes={acoes}
        perguntas={['O que muda quando a citação é ambígua?']}
      />,
    );
    expect(container.querySelectorAll('.nota-acoes')).toHaveLength(1);
    const recuperacao = container.querySelector<HTMLElement>('.recuperacao');
    expect(recuperacao?.textContent).toContain('ambígua');
    expect(recuperacao?.tagName).toBe('DETAILS');
    expect(recuperacao?.hasAttribute('open')).toBe(false);
  });
});
