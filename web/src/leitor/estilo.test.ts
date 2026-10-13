import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// `new URL(...)` devolveria a URL do jsdom, que `node:fs` recusa; o diretório do módulo basta.
const folha = readFileSync(`${import.meta.dirname}/reader.css`, 'utf8');

interface Regra {
  seletor: string;
  corpo: string;
}

/** Leitura simples das regras de primeiro nível, suficiente para as invariantes de estilo. */
function regras(css: string): Regra[] {
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const achadas: Regra[] = [];
  const padrao = /([^{}]+)\{([^{}]*)\}/g;
  let achado = padrao.exec(semComentarios);
  while (achado !== null) {
    achadas.push({ seletor: (achado[1] ?? '').trim(), corpo: achado[2] ?? '' });
    achado = padrao.exec(semComentarios);
  }
  return achadas;
}

const camada = readFileSync(`${import.meta.dirname}/../ui/marcador/marcador.css`, 'utf8');
const tokens = readFileSync(`${import.meta.dirname}/../ui/tokens.css`, 'utf8');
const todas = regras(folha);

describe('regras de interface do leitor', () => {
  test('nenhuma classe de marca define fundo', () => {
    const comFundo = todas.filter((regra) => /\.marca-|\.segmento/.test(regra.seletor) && /background/.test(regra.corpo));
    expect(comFundo).toEqual([]);
  });

  test('nenhum segmento de marca muda o peso da fonte', () => {
    const comPeso = todas.filter(
      (regra) => /\.marca-|\.segmento/.test(regra.seletor) && /font-weight/.test(regra.corpo),
    );
    expect(comPeso).toEqual([]);
  });

  test('a camada SVG não captura interação e fica atrás das letras', () => {
    const svg = regras(camada).find((regra) => regra.seletor.includes('.camada-de-marcas'));
    expect(svg?.corpo).toContain('pointer-events: none');
    expect(svg?.corpo).toContain('z-index: -1');
    expect(svg?.corpo).toContain('mix-blend-mode');
    expect(todas.find((regra) => regra.seletor === '.segmento')?.corpo).toContain('text-decoration: none');
  });

  test('corpo em serifa de 22 px, coluna de 630–680 px e margem independente de 320 px', () => {
    const leitor = todas.find((regra) => regra.seletor === '.leitor');
    expect(leitor?.corpo).toContain('font-family: var(--serif)');
    expect(leitor?.corpo).toContain('font-size: var(--tamanho-leitura, 22px)');
    expect(leitor?.corpo).toContain('width: var(--medida-texto, min(var(--largura-leitura, 850px), calc(100% - 48px)))');
    expect(leitor?.corpo).toContain('margin-inline: auto');
    expect(todas.find((regra) => regra.seletor === '.margem')?.corpo).toContain('left: calc(100% + var(--intervalo-margem, 56px))');
  });

  test('as notas ficam em absoluto na coluna da margem: nunca empurram o texto', () => {
    expect(todas.find((regra) => regra.seletor === '.margem')?.corpo).toContain('position: absolute');
    const nota = todas.find((regra) => regra.seletor === '.nota');
    expect(nota?.corpo).toContain('position: absolute');
    expect(nota?.corpo).not.toMatch(/background|font-weight/);
    // A margem só existe acima do limiar do `useTelaEstreita`; abaixo dele quem responde é a folha.
    expect(folha).toContain('@media (max-width: 1417.98px)');
  });

  test('a nota ativa muda o sublinhado, nunca o fundo', () => {
    const ativa = todas.find((regra) => regra.seletor === '.nota.ativa .nota-rotulo');
    expect(ativa?.corpo).toContain('text-decoration-line: underline');
    expect(ativa?.corpo).not.toMatch(/background|font-weight/);
  });

  test('há quatro opções de tema e no máximo duas famílias tipográficas', () => {
    expect(tokens).toContain('@media (prefers-color-scheme: dark)');
    expect(tokens).toContain(':root[data-tema="escuro"]');
    expect(tokens).toContain(':root[data-tema="sepia"]');
    const familias = new Set([...folha.matchAll(/font-family:\s*([^;]+);/g)].map((achado) => (achado[1] ?? '').trim()));
    expect([...familias].every((familia) => familia === 'var(--serif)' || familia === 'var(--sans)')).toBe(true);
    expect([...folha.matchAll(/^\s*--(serif|sans):/gm)]).toHaveLength(2);
  });
});
