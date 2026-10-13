import { expect, test } from 'vitest';
import type { AncoraV1, PalavraGeometria, QuadPdf } from '@margem/contratos';
import { conferirAncora } from '@margem/contratos';
import { ancoraDaSelecao, completarPaginasDoCapitulo, paginasDoCapitulo, quadsDaAncora, resolverSelecaoPdf } from './geometria';

const id = '00000000000000000000000000';
const quad = (x = 0, y = 0): QuadPdf => [x, y, x + 20, y, x + 20, y + 10, x, y + 10];
const palavra = (inicio: number, fim: number, x = 0, y = 0, pagina = 1): PalavraGeometria =>
  ({ bloco_id: id, inicio_utf16: inicio, fim_utf16: fim, pagina, quad: quad(x, y) });
const ancora = (texto: string, inicio = 0, fim = texto.length): AncoraV1 => ({ versao_id: id, bloco_id: id,
  inicio_utf16: inicio, fim_utf16: fim, citacao: texto.slice(inicio, fim), prefixo: texto.slice(0, inicio), sufixo: texto.slice(fim) });
const retangulo = (q: QuadPdf) => ({ x: q[0], y: q[1], largura: q[2] - q[0], altura: q[7] - q[1] });

test.each(['🧭 café fim', 'fi café fim'])('ida e volta preserva UTF-16 e ligatura desfeita: %s', (texto) => {
  const partes = texto.split(' ');
  const p1 = partes[0]!.length;
  const palavras = [palavra(0, p1), palavra(p1 + 1, p1 + 6, 24), palavra(p1 + 7, texto.length, 0, 15)];
  const a = ancora(texto);
  const quads = quadsDaAncora(a, { versao_id: id, palavras: palavras });
  expect(quads[0]!.quads).toHaveLength(2);
  const bloco = { id, versao_id: id, texto };
  const volta = ancoraDaSelecao(1, quads[0]!.quads.map(retangulo), { versao_id: id, palavras: palavras }, new Map([[id, bloco]]));
  expect(volta).toEqual(a);
  expect(conferirAncora(bloco, volta!)).toBe(true);
});
test('recorta palavra proporcionalmente e não modifica o original', () => {
  const p = palavra(0, 4);
  expect(quadsDaAncora(ancora('abcd', 1, 3), { versao_id: id, palavras: [p] })).toEqual([{ pagina: 1, quads: [[5, 0, 15, 0, 15, 10, 5, 10]] }]);
  expect(p.quad).toEqual(quad());
  expect(quadsDaAncora(ancora('abcd', 1, 3), { versao_id: id, palavras: [palavra(0, 1), palavra(3, 4), { ...p, bloco_id: 'outro' }] })).toEqual([]);
});
test('hífen desfeito tem partes em linhas e páginas; páginas ordenadas', () => {
  const a = ancora('upfront');
  expect(quadsDaAncora(a, { versao_id: id, palavras: [palavra(2, 7, 0, 0, 2), palavra(0, 2, 0, 15, 1)] }).map((p) => p.pagina)).toEqual([1, 2]);
  expect(quadsDaAncora(a, { versao_id: id, palavras: [palavra(0, 2), palavra(2, 7, 0, 15)] })[0]!.quads).toHaveLength(2);
  expect(quadsDaAncora(a, { versao_id: id, palavras: [palavra(0, 2), palavra(2, 7, 90)] })[0]!.quads).toHaveLength(2);
});
test('contextos de até 32 sem partir emoji', () => {
  const texto = '🧭' + 'a'.repeat(31) + 'oi' + 'b'.repeat(31) + '🧭';
  const p = palavra(33, 35);
  const mapa = new Map([[id, { id, versao_id: id, texto }]]);
  const a = ancoraDaSelecao(1, [retangulo(p.quad)], { versao_id: id, palavras: [p] }, mapa)!;
  expect(a.citacao).toBe('oi');
  expect(a.prefixo).toBe('a'.repeat(31)); expect(a.sufixo).toBe('b'.repeat(31));
  expect(conferirAncora(mapa.get(id)!, a)).toBe(true);
});
test('recusa seleção vazia, página errada, bloco ausente e fronteira inválida', () => {
  const p = palavra(0, 2);
  const r = retangulo(p.quad);
  const mapa = new Map([[id, { id, versao_id: id, texto: '🧭 fim' }]]);
  expect(ancoraDaSelecao(1, [], { versao_id: id, palavras: [p] }, mapa)).toBeNull();
  expect(ancoraDaSelecao(2, [r], { versao_id: id, palavras: [p] }, mapa)).toBeNull();
  expect(ancoraDaSelecao(1, [r], { versao_id: id, palavras: [p] }, new Map())).toBeNull();
  expect(ancoraDaSelecao(1, [r], { versao_id: id, palavras: [{ ...p, fim_utf16: 1 }] }, mapa)).toBeNull();
  expect(ancoraDaSelecao(1, [r], { versao_id: id, palavras: [{ ...p, inicio_utf16: 2, fim_utf16: 1 }] }, mapa)).toBeNull();
});
test('intervalo do capítulo considera apenas origens PDF', () => {
  expect(paginasDoCapitulo([])).toBeNull();
  expect(paginasDoCapitulo([{ texto: 'x', origens: [{ tipo: 'texto', linha_inicio: 1, linha_fim: 3 }] }])).toBeNull();
  expect(paginasDoCapitulo([{ texto: 'x', origens: [{ tipo: 'pdf', pagina: 3, bbox: [0, 0, 1, 1] }, { tipo: 'pdf', pagina: 1, bbox: [0, 0, 1, 1] }] }])).toEqual({ inicio: 1, fim: 3 });
});

test('conserva a página compartilhada, inclusive conclusão curta e rótulo', () => {
  const na = (pagina: number, texto: string) => ({ texto, origens: [{ tipo: 'pdf' as const, pagina, bbox: [0, 0, 1, 1] as [number, number, number, number] }] });
  for (const texto of ['Portanto, a hipótese foi rejeitada.', 'CAPÍTULO 2', '1']) {
    expect(paginasDoCapitulo([na(4, 'Corpo'), na(5, texto)])).toEqual({ inicio: 4, fim: 5 });
  }
  expect(paginasDoCapitulo([na(5, 'Um capítulo curto.')])).toEqual({ inicio: 5, fim: 5 });
});

test('recusa seleção entre blocos ou com uma palavra intermediária não selecionada', () => {
  const mapa = new Map([[id, { id, versao_id: id, texto: 'um dois três' }]]);
  const p = palavra(0, 2), p2 = palavra(3, 7, 25), p3 = palavra(8, 12, 50);
  expect(ancoraDaSelecao(1, [retangulo(p.quad)], { versao_id: id, palavras: [p, { ...p, bloco_id: 'outro' }] }, mapa)).toBeNull();
  expect(ancoraDaSelecao(1, [retangulo(p.quad), retangulo(p3.quad)], { versao_id: id, palavras: [p, p2, p3] }, mapa)).toBeNull();
});

test('lacuna textual sem geometria não vira parte da citação, inclusive entre páginas', () => {
  const mapa = new Map([[id, { id, versao_id: id, texto: 'AA BB CC' }]]);
  for (const pagina of [1, 2]) {
    const palavras = [palavra(0, 2), palavra(6, 8, 50, 0, pagina)];
    const selecao = [{ pagina: 1, retangulos: [retangulo(palavras[0]!.quad)] },
      ...(pagina === 1 ? [] : [{ pagina, retangulos: [retangulo(palavras[1]!.quad)] }])];
    if (pagina === 1) selecao[0]!.retangulos.push(retangulo(palavras[1]!.quad));
    expect(resolverSelecaoPdf(selecao, { versao_id: id, palavras }, mapa)).toEqual({ ok: false, motivo: 'cobertura_insuficiente' });
    expect(resolverSelecaoPdf(selecao, { versao_id: id, palavras: [...palavras, palavra(3, 5, 100)] }, mapa)).toEqual({ ok: false, motivo: 'descontinua' });
  }
});

test('seleção contínua entre páginas tolera somente separadores e é independente da ordem das palavras', () => {
  const mapa = new Map([[id, { id, versao_id: id, texto: 'AA \nCC' }]]);
  const palavras = [palavra(0, 2), palavra(4, 6, 0, 0, 2)];
  const selecao = [1, 2].map(pagina => ({ pagina, retangulos: [retangulo(quad())] }));
  for (const ps of [palavras, [...palavras].reverse()]) {
    expect(resolverSelecaoPdf(selecao, { versao_id: id, palavras: ps }, mapa)).toMatchObject({ ok: true, ancora: { citacao: 'AA \nCC' } });
  }
  expect(resolverSelecaoPdf(selecao, { versao_id: id, palavras: palavras.slice(0, 1) }, mapa)).toEqual({ ok: false, motivo: 'cobertura_insuficiente' });
});

test('geometria de outra versão é recusada mesmo com IDs e offsets iguais', () => {
  const geometria = { versao_id: 'outra', palavras: [palavra(0, 2)] };
  expect(() => quadsDaAncora(ancora('AA'), geometria)).toThrow('outra versão');
  expect(resolverSelecaoPdf([{ pagina: 1, retangulos: [retangulo(quad())] }], geometria,
    new Map([[id, { id, versao_id: id, texto: 'AA' }]]))).toEqual({ ok: false, motivo: 'versao_divergente' });
});


test('completarPaginasDoCapitulo: PDF escaneado de um capítulo só: vai da primeira à última página', () => {
  expect(completarPaginasDoCapitulo({ inicio: 1, fim: 1 }, null, null, 191)).toEqual({ inicio: 1, fim: 191 });
});
test('completarPaginasDoCapitulo: vai até a página anterior ao próximo capítulo', () => {
  expect(completarPaginasDoCapitulo({ inicio: 10, fim: 18 }, null, { inicio: 25, fim: 40 }, 300)).toEqual({ inicio: 10, fim: 24 });
});
test('completarPaginasDoCapitulo: página compartilhada com o próximo capítulo continua acessível', () => {
  expect(completarPaginasDoCapitulo({ inicio: 10, fim: 25 }, null, { inicio: 25, fim: 40 }, 300)).toEqual({ inicio: 10, fim: 25 });
});
test('completarPaginasDoCapitulo: capítulo sem texto começa depois do anterior', () => {
  expect(completarPaginasDoCapitulo(null, { inicio: 1, fim: 9 }, { inicio: 30, fim: 40 }, 300)).toEqual({ inicio: 10, fim: 29 });
});
test('completarPaginasDoCapitulo: sem total conhecido, o último capítulo fica como estava', () => {
  expect(completarPaginasDoCapitulo({ inicio: 5, fim: 9 }, null, null, null)).toEqual({ inicio: 5, fim: 9 });
  expect(completarPaginasDoCapitulo(null, null, null, null)).toBeNull();
});
test('completarPaginasDoCapitulo: nunca passa do total de páginas', () => {
  expect(completarPaginasDoCapitulo({ inicio: 5, fim: 9 }, null, { inicio: 400, fim: 410 }, 120)).toEqual({ inicio: 5, fim: 120 });
});
