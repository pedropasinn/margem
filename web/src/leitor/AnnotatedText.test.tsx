import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Bloco } from '@margem/contratos';
import { segmentar } from '@margem/core/segmentos';
import { AnnotatedText } from './AnnotatedText';
import { ChapterContent } from './ChapterContent';
import { segmentosDoBloco } from './posicao';
import { capituloExemplo } from './fixtures/capitulo-exemplo';

afterEach(cleanup);

function textoRenderizado(raiz: ParentNode, blocoId: string): string {
  return segmentosDoBloco(raiz, blocoId)
    .map((span) => span.textContent ?? '')
    .join('');
}

const SURROGATE_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

describe('fidelidade do texto', () => {
  test('a concatenação dos segmentos devolve o texto de cada bloco, com marcas', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    for (const bloco of capituloExemplo.blocos) {
      expect(textoRenderizado(container, bloco.id)).toBe(bloco.texto);
    }
  });

  test('a concatenação continua fiel sem nenhuma marca', () => {
    const { container } = render(<ChapterContent snapshot={{ ...capituloExemplo, marcas: [] }} />);
    for (const bloco of capituloExemplo.blocos) {
      expect(textoRenderizado(container, bloco.id)).toBe(bloco.texto);
    }
  });

  test('não há um span por caractere', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    for (const bloco of capituloExemplo.blocos) {
      const spans = segmentosDoBloco(container, bloco.id);
      if (bloco.texto.length > 0) expect(spans.length).toBeLessThan(bloco.texto.length);
    }
  });
});

describe('nada do modelo vira HTML', () => {
  const hostil = '<script>alert(1)</script>';

  test('texto de bloco parecido com HTML aparece literal e não cria elemento', () => {
    const bloco = capituloExemplo.blocos.find((candidato) => candidato.texto.includes(hostil));
    expect(bloco).toBeDefined();
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(textoRenderizado(container, bloco?.id ?? '')).toContain(hostil);
  });

  test('texto de comentário parecido com HTML também é só texto', () => {
    const comentario = capituloExemplo.marcas
      .map((marca) => marca.comentario)
      .find((candidato) => candidato !== null && candidato.texto.includes(hostil));
    expect(comentario).toBeDefined();
    const comoBloco: Pick<Bloco, 'id' | 'texto' | 'inline'> = {
      id: capituloExemplo.blocos[0]?.id ?? '',
      texto: comentario?.texto ?? '',
      inline: [],
    };
    const { container } = render(<AnnotatedText bloco={comoBloco} marcas={[]} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe(comoBloco.texto);
  });
});

describe('marcas no DOM', () => {
  test('cada função vira classe de sublinhado e a subfaixa vira ênfase', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    for (const funcao of ['tese', 'conceito', 'justificativa']) {
      expect(container.querySelectorAll(`.marca-${funcao}`).length).toBeGreaterThan(0);
    }
    expect(container.querySelectorAll('.enfase').length).toBeGreaterThan(0);
    const comMarcas = container.querySelectorAll('span[data-marcas]');
    expect(comMarcas.length).toBeGreaterThan(0);
    for (const span of comMarcas) {
      expect(span.getAttribute('data-marcas')).toMatch(/^[0-9A-Z]{26}( [0-9A-Z]{26})*$/);
    }
  });

  test('marca oculta e marca ambígua não são apresentadas', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    for (const marca of capituloExemplo.marcas) {
      if (marca.visivel && marca.validade === 'resolvida') continue;
      expect(container.querySelector(`span[data-marcas~="${marca.id}"]`)).toBeNull();
    }
  });

  test('estilos inline viram em, strong, code e sup sem quebrar o texto', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    expect(container.querySelector('.bloco em')).not.toBeNull();
    expect(container.querySelector('.bloco strong')).not.toBeNull();
    expect(container.querySelector('sup.nota-ref')).not.toBeNull();
  });
});

describe('Unicode', () => {
  test('emoji fora do BMP no limite de uma marca não quebra o texto', () => {
    const bloco = capituloExemplo.blocos.find((candidato) => candidato.texto.includes('🧭'));
    expect(bloco).toBeDefined();
    if (bloco === undefined) return;
    const marcas = capituloExemplo.marcas.filter((marca) => marca.ancora.bloco_id === bloco.id);
    expect(marcas.some((marca) => marca.ancora.citacao.endsWith('🧭'))).toBe(true);

    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    expect(textoRenderizado(container, bloco.id)).toBe(bloco.texto);
    for (const span of segmentosDoBloco(container, bloco.id)) {
      expect(SURROGATE_SOLTO.test(span.textContent ?? '')).toBe(false);
    }
    for (const segmento of segmentar(bloco, capituloExemplo.marcas)) {
      expect(SURROGATE_SOLTO.test(segmento.texto)).toBe(false);
    }
  });
});
