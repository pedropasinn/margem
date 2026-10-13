import { describe, expect, test } from 'vitest';
import { caixaNoPdf, pontoNaTela, pontoNoPdf, quadNaTela, tamanhoDaPagina, type PaginaPdf } from './pdf-geometria';
import { ancoraDaSelecao } from '../../../core/src/geometria';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import { validarPreferencias } from './preferencias';
describe('geometria do PDF no navegador', () => {
  for (const rotacao of [0, 90, 180, 270] as const) for (const escala of [.5, 1, 1.75]) test(`ida e volta ${rotacao}° a ${escala}`, () => {
    const pagina: PaginaPdf = { numero: 1, largura: 600, altura: 800, rotacao };
    const ponto = pontoNaTela(50, 100, pagina, escala);
    expect(pontoNoPdf(...ponto, pagina, escala)).toEqual([50, 100]);
    const quad = [50, 100, 150, 100, 150, 120, 50, 120] as [number, number, number, number, number, number, number, number];
    const r = quadNaTela(quad, pagina, escala);
    const base = new DOMRect(24, 80, 1000, 1000);
    expect(caixaNoPdf(new DOMRect(base.x + r.x, base.y + r.y, r.largura, r.altura), base, pagina, escala)).toEqual({ x: 50, y: 100, largura: 100, altura: 20 });
    expect(tamanhoDaPagina(pagina, escala).largura).toBe((rotacao % 180 ? 800 : 600) * escala);
    const bloco = { ...capituloExemplo.blocos[0]!, texto: 'palavra', versao_id: capituloExemplo.versao_id };
    const selecao = ancoraDaSelecao(1, [caixaNoPdf(new DOMRect(base.x + r.x, base.y + r.y, r.largura, r.altura), base, pagina, escala)], { versao_id: bloco.versao_id, palavras: [{ bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: 7, pagina: 1, quad }] }, new Map([[bloco.id, bloco]]));
    expect(selecao?.citacao).toBe('palavra');
  });
  test('zoom persistido é finito e limitado', () => {
    expect(validarPreferencias({ zoomPdf: Infinity }).zoomPdf).toBe('largura');
    expect(validarPreferencias({ zoomPdf: 99 }).zoomPdf).toBe(3);
    expect(validarPreferencias({ zoomPdf: .01 }).zoomPdf).toBe(.25);
    expect(validarPreferencias({ zoomPdf: 1.25 }).zoomPdf).toBe(1.25);
  });
});
