import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { offsetDeSegmento, segmentar } from '@margem/core/segmentos';
import { ChapterContent } from './ChapterContent';
import { pontoDoNo, segmentosDoBloco } from './posicao';
import { capituloExemplo, TEXTOS_DO_CANONICO } from './fixtures/capitulo-exemplo';

afterEach(cleanup);

describe('estrutura do capítulo', () => {
  test('o título da seção aparece uma vez', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    const titulo = capituloExemplo.secao.titulo;
    const ocorrencias = (container.textContent ?? '').split(titulo).length - 1;
    expect(ocorrencias).toBe(1);
    expect(container.querySelectorAll('.titulo-da-secao')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  test('cada tipo de bloco vira o elemento previsto, na ordem do canônico', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    const esperado: Record<string, string> = {
      capitulo: 'H1',
      epigrafe: 'P',
      paragrafo: 'P',
      lista: 'LI',
      citacao: 'BLOCKQUOTE',
      codigo: 'PRE',
      equacao: 'FIGURE',
      figura: 'FIGURE',
      tabela: 'FIGURE',
      nota_rodape: 'ASIDE',
    };
    for (const bloco of capituloExemplo.blocos) {
      const elemento = container.querySelector(`[data-bloco="${bloco.id}"]`);
      expect(elemento?.tagName).toBe(esperado[bloco.tipo]);
    }
    const ordemNoDom = [...container.querySelectorAll('[data-bloco]')].map((el) => el.getAttribute('data-bloco'));
    expect(ordemNoDom).toEqual(capituloExemplo.blocos.map((bloco) => bloco.id));
  });

  test('blocos de lista vizinhos ficam num único ul', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    const listas = container.querySelectorAll('ul.lista');
    expect(listas).toHaveLength(1);
    expect(listas[0]?.querySelectorAll('li')).toHaveLength(2);
  });

  test('figura e equação trazem o asset e a legenda discreta', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    const comAsset = capituloExemplo.blocos.filter((bloco) => bloco.asset_id !== undefined);
    expect(comAsset.length).toBeGreaterThan(0);
    for (const bloco of comAsset) {
      const figura = container.querySelector(`[data-bloco="${bloco.id}"]`);
      const imagem = figura?.querySelector('img');
      expect(imagem?.getAttribute('src')).toBe(capituloExemplo.assets[bloco.asset_id ?? '']);
      expect(imagem?.getAttribute('alt')).toBe(bloco.texto);
      expect(figura?.querySelector('figcaption')?.textContent).toBe(bloco.texto);
    }
  });

  test('o fixture usa os textos do canônico de teste dos contratos', () => {
    const textos = capituloExemplo.blocos.map((bloco) => bloco.texto);
    expect(textos).toContain(TEXTOS_DO_CANONICO.emoji);
    expect(textos).toContain(TEXTOS_DO_CANONICO.ligaturas);
    expect(textos).toContain(TEXTOS_DO_CANONICO.ultimo);
    expect(capituloExemplo.secao.titulo).toBe(TEXTOS_DO_CANONICO.titulo);
  });
});

describe('seleção do DOM para offset canônico', () => {
  test('data-bloco e data-inicio convertem um Range sintético em offset UTF-16', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    const bloco = capituloExemplo.blocos.find((candidato) => candidato.texto === TEXTOS_DO_CANONICO.emoji);
    expect(bloco).toBeDefined();
    if (bloco === undefined) return;

    const segmentos = segmentar(bloco, capituloExemplo.marcas);
    const spans = segmentosDoBloco(container, bloco.id);
    expect(spans).toHaveLength(segmentos.length);

    const indice = 1;
    const span = spans[indice];
    const alvo = span?.firstChild;
    expect(alvo).toBeDefined();
    if (span === undefined || alvo === null || alvo === undefined) return;

    const intervalo = container.ownerDocument.createRange();
    intervalo.setStart(alvo, 2);
    intervalo.setEnd(alvo, 3);

    const ponto = pontoDoNo(intervalo.startContainer, intervalo.startOffset, capituloExemplo);
    expect(ponto).toEqual({ bloco_id: bloco.id, offset_utf16: offsetDeSegmento(segmentos, indice, 2) });
    expect(span.getAttribute('data-inicio')).toBe(String(segmentos[indice]?.inicio_utf16));
    expect(bloco.texto.slice(ponto?.offset_utf16 ?? 0, (ponto?.offset_utf16 ?? 0) + 1)).toBe(intervalo.toString());
  });

  test('um nó fora do texto do capítulo não vira ponto', () => {
    render(<ChapterContent snapshot={capituloExemplo} />);
    const solto = document.createElement('div');
    expect(pontoDoNo(solto, 0, capituloExemplo)).toBeNull();
  });
});


test('ilustrações suplementares preservam texto, ordem e offsets das listas', () => {
  const bloco = capituloExemplo.blocos.find((item) => item.tipo === 'lista')!;
  const snapshot = { ...capituloExemplo, ilustracoes: [
    { bloco_id: bloco.id, url: '/antes.svg', alt: 'Antes', posicao: 'antes' as const },
    { bloco_id: bloco.id, url: '/depois.svg', alt: 'Depois', posicao: 'depois' as const },
  ] };
  const { container } = render(<ChapterContent snapshot={snapshot} />);
  const elemento = container.querySelector(`[data-bloco="${bloco.id}"]`)!;
  expect(elemento.textContent).toBe(bloco.texto);
  expect(elemento.firstElementChild?.getAttribute('src')).toBe('/antes.svg');
  expect(elemento.lastElementChild?.getAttribute('src')).toBe('/depois.svg');
  const segmento = segmentosDoBloco(container, bloco.id)[0]!;
  expect(pontoDoNo(segmento.firstChild!, 2, snapshot)).toEqual({ bloco_id: bloco.id, offset_utf16: 2 });
});

test('expoentes e numeração da fonte preservam os caracteres e a seleção', () => {
  const original = capituloExemplo.blocos.find((item) => item.tipo === 'lista')!;
  const bloco = { ...original, texto: 'Há 264 combinações.', inline: [] };
  const snapshot = { ...capituloExemplo, blocos: [bloco], marcas: [], formatacao: {
    [bloco.id]: { marcador: '5.', inline: [{ inicio: 4, fim: 6, estilo: 'sobrescrito' as const }] },
  } };
  const { container } = render(<ChapterContent snapshot={snapshot} />);
  const elemento = container.querySelector(`[data-bloco="${bloco.id}"]`)!;
  expect(elemento.getAttribute('data-marcador')).toBe('5.');
  expect(elemento.textContent).toBe(bloco.texto);
  const expoente = elemento.querySelector('sup')!;
  expect(expoente.textContent).toBe('64');
  expect(pontoDoNo(expoente.firstChild!, 1, snapshot)).toEqual({ bloco_id: bloco.id, offset_utf16: 5 });
});
