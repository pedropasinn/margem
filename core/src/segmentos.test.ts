import { describe, expect, test } from 'vitest';
import { validarMarca } from '@margem/contratos';
import type { MarcaV1 } from '@margem/contratos';
import { ancoraDeSelecao } from './ancoras';
import { offsetDeSegmento, segmentar } from './segmentos';
import { bloco, blocoDeVersao, id, marca } from '../testes/apoio';

const TEXTO = 'A hipótese 🧭 sustenta o argumento inteiro do capítulo.';
const paraAncora = blocoDeVersao(TEXTO);

function marcaEm(inicio: number, fim: number, parcial: Partial<MarcaV1> = {}): MarcaV1 {
  return marca({ ancora: ancoraDeSelecao(paraAncora, inicio, fim), ...parcial });
}

describe('segmentar', () => {
  test('sem marcas devolve o bloco inteiro em um segmento', () => {
    const segmentos = segmentar(bloco(TEXTO), []);
    expect(segmentos).toHaveLength(1);
    expect(segmentos[0]).toMatchObject({ inicio_utf16: 0, fim_utf16: TEXTO.length, funcao: null, enfase: false, marca_ids: [], inline: [] });
  });

  test('bloco vazio não produz segmento e o join continua valendo', () => {
    const segmentos = segmentar(bloco(''), []);
    expect(segmentos).toEqual([]);
    expect(segmentos.map((s) => s.texto).join('')).toBe('');
  });

  test('marca com subfaixa e inline cruzando a âncora mantém o texto íntegro', () => {
    const ancorada = marcaEm(2, 24, { funcao: 'tese', subfaixas: [{ inicio_utf16: 14, fim_utf16: 22 }] });
    expect(validarMarca({ ...ancorada, ancora: { ...ancorada.ancora, versao_id: id(20) } })).toBe(true);
    const comInline = bloco(TEXTO, [{ inicio: 18, fim: 30, estilo: 'italico' }]);
    const segmentos = segmentar(comInline, [ancorada]);
    expect(segmentos.map((s) => s.texto).join('')).toBe(TEXTO);
    expect(segmentos.map((s) => [s.inicio_utf16, s.fim_utf16])).toEqual([[0, 2], [2, 14], [14, 18], [18, 22], [22, 24], [24, 30], [30, TEXTO.length]]);
    expect(segmentos.filter((s) => s.enfase).map((s) => [s.inicio_utf16, s.fim_utf16])).toEqual([[14, 18], [18, 22]]);
    expect(segmentos.filter((s) => s.inline.includes('italico')).map((s) => s.inicio_utf16)).toEqual([18, 22, 24]);
    expect(segmentos.filter((s) => s.funcao === 'tese')).toHaveLength(4);
    expect(segmentos.at(-1)).toMatchObject({ funcao: null, marca_ids: [], inline: [] });
  });

  test('emoji fora do BMP nos limites não é partido', () => {
    const ancorada = marcaEm(11, 13, { funcao: 'conceito' });
    const segmentos = segmentar(bloco(TEXTO), [ancorada]);
    expect(segmentos.map((s) => s.texto).join('')).toBe(TEXTO);
    expect(segmentos.find((s) => s.funcao === 'conceito')?.texto).toBe('🧭');
  });

  test('marcas ocultas ou não resolvidas ficam de fora, salvo opção explícita', () => {
    const oculta = marcaEm(2, 10, { id: id(51), visivel: false });
    const ambigua = marcaEm(14, 22, { id: id(52), validade: 'ambigua' });
    const deOutroBloco = marca({ ancora: { ...ancoraDeSelecao(paraAncora, 2, 10), bloco_id: id(9) }, id: id(53) });
    expect(segmentar(bloco(TEXTO), [oculta, ambigua, deOutroBloco])).toHaveLength(1);
    const comOcultas = segmentar(bloco(TEXTO), [oculta, ambigua, deOutroBloco], { incluirOcultas: true });
    expect(comOcultas.map((s) => s.texto).join('')).toBe(TEXTO);
    expect(comOcultas.flatMap((s) => s.marca_ids)).toEqual([id(51), id(52)]);
  });

  test('marca com funcao nenhuma não colore o segmento mas continua listada', () => {
    const semCor = marcaEm(2, 10, { funcao: 'nenhuma' });
    const segmentos = segmentar(bloco(TEXTO), [semCor]);
    const coberto = segmentos.find((s) => s.inicio_utf16 === 2);
    expect(coberto?.funcao).toBeNull();
    expect(coberto?.marca_ids).toEqual([id(50)]);
  });

  test('marcas encaixadas: a interna aparece nos dois conjuntos de ids', () => {
    const externa = marcaEm(2, 30, { id: id(60), funcao: 'nenhuma' });
    const interna = marcaEm(14, 22, { id: id(61), funcao: 'justificativa' });
    const segmentos = segmentar(bloco(TEXTO), [externa, interna]);
    expect(segmentos.map((s) => s.texto).join('')).toBe(TEXTO);
    expect(segmentos.find((s) => s.inicio_utf16 === 14)?.marca_ids).toEqual([id(60), id(61)]);
    expect(segmentos.find((s) => s.inicio_utf16 === 14)?.funcao).toBe('justificativa');
  });

  test('limites fora do bloco e inline repetido não criam segmentos vazios', () => {
    const comInline = bloco(TEXTO, [
      { inicio: 0, fim: TEXTO.length, estilo: 'italico' },
      { inicio: 0, fim: TEXTO.length, estilo: 'italico' },
      { inicio: 2, fim: 6, estilo: 'negrito' },
    ]);
    const segmentos = segmentar(comInline, []);
    expect(segmentos.every((s) => s.texto.length > 0)).toBe(true);
    expect(segmentos[0]?.inline).toEqual(['italico']);
    expect(segmentos[1]?.inline).toEqual(['italico', 'negrito']);
  });
});

describe('offsetDeSegmento', () => {
  const segmentos = segmentar(bloco(TEXTO), [marcaEm(2, 10)]);

  test('converte deslocamento local em offset do bloco', () => {
    expect(offsetDeSegmento(segmentos, 0, 0)).toBe(0);
    expect(offsetDeSegmento(segmentos, 1, 3)).toBe(5);
    expect(offsetDeSegmento(segmentos, 1, segmentos[1]?.texto.length ?? 0)).toBe(10);
  });

  test('recusa índice e deslocamento fora da lista', () => {
    expect(() => offsetDeSegmento(segmentos, 99, 0)).toThrow(/fora da lista/);
    expect(() => offsetDeSegmento(segmentos, 1.5, 0)).toThrow(/fora da lista/);
    expect(() => offsetDeSegmento(segmentos, 0, -1)).toThrow(/fora do segmento/);
    expect(() => offsetDeSegmento(segmentos, 0, 999)).toThrow(/fora do segmento/);
  });
});
