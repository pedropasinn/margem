import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AncoraV1 } from '@margem/contratos';
import { CacheDePaginas, faixasVerticais, paginaParaDobra, recorteDaRegiao, vaoAbaixo, vaoAcima, type RegiaoPdf } from '../pdf-recortes';
import { ALTURA_DA_DOBRA, arranjarDobra, construirDobra, distanciaOmitida, linhasNaDobra, SobreposicaoDaDobra, TOPO_DA_DOBRA } from './DobraDoPdf';
import type { DobraDoPdf } from '../tipos';

afterEach(() => { cleanup(); });

// Página de 850 × 1100 na escala do leitor, com uma linha de texto a cada 24 px (18 de altura).
const LINHAS = Array.from({ length: 40 }, (_, i) => ({ x: 100, y: 80 + i * 24, largura: 640, altura: 18 }));
function regiao(pagina: number, primeira: number, quantas: number): RegiaoPdf {
  return { pagina, escala: 1.5, largura: 850, altura: 1100, linhas: LINHAS.slice(primeira, primeira + quantas), linhasDaPagina: LINHAS };
}
const ANCORA = (id: string): AncoraV1 => ({ versao_id: 'V'.repeat(26), bloco_id: id.repeat(26), inicio_utf16: 0, fim_utf16: 1, citacao: 'x', prefixo: '', sufixo: '' });

test('o recorte: largura da página, a citação com contexto, bordas no vão entre linhas e dentro da página', () => {
  const r = recorteDaRegiao(regiao(14, 10, 2), 300);
  expect(r).toMatchObject({ pagina: 14, escala: 1.5, largura: 850, alturaDaPagina: 1100 });
  // A citação (y 320–362) inteira dentro do recorte, com folga.
  expect(r.y).toBeLessThan(320 - 30);
  expect(r.y + r.altura).toBeGreaterThan(362 + 30);
  // Nenhuma borda corta uma linha.
  for (const borda of [r.y, r.y + r.altura]) expect(LINHAS.some((l) => l.y < borda && borda < l.y + l.altura)).toBe(false);
  // Citação maior que o limite: mostra o começo dela; e nunca sai da página.
  const longa = recorteDaRegiao(regiao(14, 5, 30), 200);
  expect(longa.y).toBeLessThanOrEqual(80 + 5 * 24);
  expect(longa.altura).toBeLessThanOrEqual(230);
  const noFim = recorteDaRegiao(regiao(14, 39, 1), 300);
  expect(noFim.y + noFim.altura).toBeLessThanOrEqual(1100);
  expect(recorteDaRegiao(regiao(14, 0, 1), 300).y).toBeGreaterThanOrEqual(0);
});

test('duas linhas de contexto acima e duas abaixo da citação, nem mais nem menos', () => {
  const r = recorteDaRegiao(regiao(14, 10, 2), 400);
  const dentro = LINHAS.filter((l) => l.y >= r.y && l.y + l.altura <= r.y + r.altura).map((l) => (l.y - 80) / 24);
  expect(dentro).toEqual([8, 9, 10, 11, 12, 13]);
  // No topo da página, só o que houver acima.
  expect(LINHAS.filter((l) => { const t = recorteDaRegiao(regiao(14, 1, 1), 400); return l.y >= t.y && l.y + l.altura <= t.y + t.altura; }).map((l) => (l.y - 80) / 24)).toEqual([0, 1, 2, 3]);
});

test('vãos: pedaços da mesma linha viram uma faixa; a borda sobe ou desce ao meio do vão', () => {
  expect(faixasVerticais([{ y: 10, altura: 10 }, { y: 12, altura: 10 }, { y: 40, altura: 10 }])).toEqual([{ y: 10, altura: 12 }, { y: 40, altura: 10 }]);
  const faixas = [{ y: 0, altura: 18 }, { y: 24, altura: 18 }, { y: 48, altura: 18 }];
  expect(vaoAcima(faixas, 30)).toBe(21);
  expect(vaoAbaixo(faixas, 30)).toBe(45);
  expect(vaoAcima(faixas, 20)).toBe(20);
  expect(vaoAcima(faixas, 5)).toBe(-4);
});

test('da página para a dobra: o mesmo retângulo menos o deslocamento do recorte, mais a posição na tela', () => {
  expect(paginaParaDobra({ x: 100, y: 500, largura: 40, altura: 18 }, { y: 450 }, { x: 295, y: 300 })).toEqual({ x: 395, y: 350, largura: 40, altura: 18 });
  const r = recorteDaRegiao(regiao(15, 10, 2), 300);
  const linhas = linhasNaDobra(regiao(15, 10, 2), r, { x: 0, y: 0 });
  expect(linhas.map((l) => l.y)).toEqual([320 - r.y, 344 - r.y]);
});

function fonteFalsa(origens: Record<number, { x: number; y: number } | null>, regioes: Record<string, RegiaoPdf>): DobraDoPdf {
  return {
    regioes: (ancora) => { const r = regioes[ancora.bloco_id[0]!]; return r ? [r] : []; },
    preparar: () => Promise.resolve(),
    recorte: (recorte) => <div className="recorte-falso" data-pagina={recorte.pagina} />,
    origemDaPagina: (pagina) => origens[pagina] ?? null,
  };
}

test('A é a ponta de cima no documento; A à vista fica onde está e B vem logo abaixo; senão, B fica e A vem acima', () => {
  const fonte = fonteFalsa({ 14: { x: 295, y: -200 }, 16: { x: 295, y: 2000 } }, { a: regiao(16, 5, 2), b: regiao(14, 20, 2) });
  // A origem da relação está depois (p. 16): A continua sendo a de cima (p. 14).
  const estado = construirDobra(fonte, 'R', ANCORA('a'), ANCORA('b'), 900)!;
  expect([estado.regiaoA.pagina, estado.regiaoB.pagina]).toEqual([14, 16]);
  const arranjo = arranjarDobra(estado, fonte, 900)!;
  expect(arranjo.a).toEqual({ x: 295, y: -200 + estado.recorteA.y });
  expect(arranjo.b.y).toBe(arranjo.a.y + estado.recorteA.altura + ALTURA_DA_DOBRA);
  expect(arranjo.dobra).toBe(arranjo.a.y + estado.recorteA.altura);
  // A fora da tela, B à vista: B fica no lugar.
  const comB = fonteFalsa({ 14: { x: 295, y: -3000 }, 16: { x: 295, y: 400 - estado.recorteB.y } }, {});
  const arranjoB = arranjarDobra(estado, comB, 900)!;
  expect(arranjoB.b.y).toBe(400);
  // Nenhuma à vista: as duas juntas, a partir do topo útil.
  const longe = fonteFalsa({ 14: { x: 295, y: -5000 }, 16: { x: 295, y: 9000 } }, {});
  expect(arranjarDobra(estado, longe, 900)!.a.y).toBeGreaterThanOrEqual(TOPO_DA_DOBRA);
  // Página sem posição (não montada): sem arranjo.
  expect(arranjarDobra(estado, fonteFalsa({}, {}), 900)).toBeNull();
});

test('a sobreposição monta os dois recortes que o leitor entrega, o vinco e o braquete religado; sem estado, nada', () => {
  const fonte = fonteFalsa({ 14: { x: 295, y: 0 }, 16: { x: 295, y: 3000 } }, { a: regiao(14, 10, 2), b: regiao(16, 5, 2) });
  const estado = construirDobra(fonte, 'R', ANCORA('a'), ANCORA('b'), 900)!;
  const arranjo = arranjarDobra(estado, fonte, 900);
  const { container, rerender } = render(<SobreposicaoDaDobra estado={estado} fonte={fonte} arranjo={arranjo} xColchete={280} xEspinha={250} cor={1} retrospectiva={false} />);
  expect([...container.querySelectorAll('.recorte-falso')].map((e) => e.getAttribute('data-pagina'))).toEqual(['14', '16']);
  expect(container.querySelector('.dobra-pdf-vinco')).not.toBeNull();
  expect(container.querySelectorAll('.dobra-pdf-braquete path.braquete')).toHaveLength(2);
  rerender(<SobreposicaoDaDobra estado={null} fonte={fonte} arranjo={null} xColchete={280} xEspinha={250} cor={1} retrospectiva={false} />);
});

test('o cache renderiza cada página uma vez por escala e densidade, e as mais antigas saem', async () => {
  const pedidas: number[] = [];
  const documento = { getPage: (n: number) => { pedidas.push(n); return Promise.resolve({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  }); } } as unknown as Parameters<CacheDePaginas['renderizar']>[0];
  const cache = new CacheDePaginas(2);
  const [a, a2] = await Promise.all([cache.renderizar(documento, 'D', 1, 1.5, 2), cache.renderizar(documento, 'D', 1, 1.5, 2)]);
  expect(a).toBe(a2);
  expect([a.width, a.height, a.style.width]).toEqual([300, 600, '150px']);
  expect(cache.pronta(cache.chave('D', 1, 1.5, 2))).toBe(a);
  await cache.renderizar(documento, 'D', 2, 1.5, 2);
  await cache.renderizar(documento, 'D', 3, 1.5, 2);
  expect(cache.pronta(cache.chave('D', 1, 1.5, 2))).toBeUndefined();
  expect(pedidas).toEqual([1, 2, 3]);
});

test('o vinco diz quanto ficou escondido: linhas na mesma página, páginas entre páginas', () => {
  const fonte = fonteFalsa({}, { a: regiao(14, 2, 1), b: regiao(14, 30, 1), c: regiao(17, 30, 1), d: regiao(15, 1, 1) });
  const mesma = construirDobra(fonte, 'R', ANCORA('a'), ANCORA('b'), 900)!;
  const entre = faixasVerticais(LINHAS).filter((l) => l.y >= mesma.recorteA.y + mesma.recorteA.altura && l.y + l.altura <= mesma.recorteB.y).length;
  expect(distanciaOmitida(mesma)).toBe(`${String(entre)} linhas`);
  expect(distanciaOmitida(construirDobra(fonte, 'R', ANCORA('a'), ANCORA('c'), 900)!)).toBe('4 páginas');
  // Do pé de uma página ao topo da seguinte, menos de uma página: em linhas.
  const vizinhas = construirDobra(fonte, 'R', ANCORA('b'), ANCORA('d'), 900)!;
  expect(distanciaOmitida(vizinhas)).toMatch(/^\d+ linhas?$/);
});

test('com o véu, cada recorte escurece fora da citação', () => {
  const fonte = fonteFalsa({ 14: { x: 295, y: 0 }, 16: { x: 295, y: 3000 } }, { a: regiao(14, 10, 2), b: regiao(16, 5, 2) });
  const estado = construirDobra(fonte, 'R', ANCORA('a'), ANCORA('b'), 900)!;
  const { container } = render(<SobreposicaoDaDobra estado={estado} fonte={fonte} arranjo={arranjarDobra(estado, fonte, 900)} xColchete={280} xEspinha={250} cor={1} retrospectiva={false}
    veu={{ desfoque: 2.5, citacao: { x: 7, y: 5, raio: 5 } }} />);
  const veus = container.querySelectorAll('.dobra-pdf-veu-do-recorte');
  expect(veus).toHaveLength(2);
  // Uma janela limpa por linha da citação.
  expect(veus[0]!.querySelectorAll('mask rect[fill="#000"]')).toHaveLength(2);
  expect(container.querySelector('.dobra-pdf-omitido')?.textContent).toMatch(/página/);
});

test('a ponta à vista não sai do lugar: o contexto sob a barra é aparado, a citação fica onde estava', () => {
  const fonte = fonteFalsa({}, { a: regiao(15, 10, 2), b: regiao(17, 20, 2) });
  const estado = construirDobra(fonte, 'R', ANCORA('a'), ANCORA('b'), 700)!;
  // A citação de A (linha 10, y 320 na página) está a 105 px do topo da tela: a primeira linha de
  // contexto (linha 8, y 272) ficaria em 57, sob a barra.
  const origemA = { x: 343, y: 105 - 320 };
  const arranjo = arranjarDobra(estado, fonteFalsa({ 15: origemA, 17: { x: 343, y: 4000 } }, {}), 700)!;
  expect(arranjo.fixa).toBe('a');
  expect(arranjo.recorteA.y).toBeGreaterThan(estado.recorteA.y);
  // A citação continua em 125 na tela: o recorte está exatamente sobre a página do leitor.
  expect(arranjo.a.y + (320 - arranjo.recorteA.y)).toBe(105);
  expect(arranjo.a.y).toBeGreaterThanOrEqual(TOPO_DA_DOBRA);
  // B vem logo abaixo e cabe na tela, aparado no pé se preciso.
  expect(arranjo.b.y).toBe(arranjo.a.y + arranjo.recorteA.altura + ALTURA_DA_DOBRA);
  expect(arranjo.b.y + arranjo.recorteB.altura).toBeLessThanOrEqual(700 - 12);
});

test('com A fora e B à vista, B fica e A vem acima; a citação de A nunca é cortada', () => {
  const fonte = fonteFalsa({}, { a: regiao(15, 10, 2), b: regiao(17, 20, 2) });
  const estado = construirDobra(fonte, 'R', ANCORA('a'), ANCORA('b'), 700)!;
  // B: citação (linha 20, y 560) em 300 na tela.
  const arranjo = arranjarDobra(estado, fonteFalsa({ 15: { x: 343, y: -3000 }, 17: { x: 343, y: 300 - 560 } }, {}), 700)!;
  expect(arranjo.fixa).toBe('b');
  expect(arranjo.b.y + (560 - arranjo.recorteB.y)).toBe(300);
  expect(arranjo.recorteA.y).toBeLessThanOrEqual(320);
  expect(arranjo.recorteA.y + arranjo.recorteA.altura).toBeGreaterThanOrEqual(344 + 18);
});
