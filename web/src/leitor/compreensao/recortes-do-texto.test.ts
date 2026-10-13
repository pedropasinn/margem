// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { montarRecortesDoTexto, prepararRecortesDoTexto } from './recortes-do-texto';
import { caixasVisiveis } from '../caixas-visiveis';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); delete (Range.prototype as Partial<Range>).getClientRects; });
function artigo() {
  const raiz = document.createElement('article');
  const bloco = document.createElement('p'); bloco.dataset['bloco'] = 'B'; bloco.id = 'original'; bloco.textContent = 'Um parágrafo de quarenta linhas.';
  raiz.append(bloco); document.body.append(raiz);
  vi.spyOn(bloco, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 600, 1200));
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => Array.from({ length: 40 }, (_, i) => new DOMRect(100, 105 + i * 30, 600, 20)) });
  return { raiz, bloco };
}
const ponta = (linha: number) => ({ blocoId: 'B', faixa: { topo: 105 + linha * 30, base: 125 + linha * 30, esquerda: 100, direita: 700 } });

test('uma citação no meio de parágrafo longo conserva só duas linhas acima e abaixo', () => {
  const { raiz, bloco } = artigo();
  const recortes = prepararRecortesDoTexto(raiz, [ponta(10)]);
  expect(recortes).toHaveLength(1);
  expect(recortes[0]).toMatchObject({ topo: 240, altura: 150 }); // linhas 8–12, bordas nos vãos
  const texto = bloco.textContent;
  const janelas = montarRecortesDoTexto(recortes);
  expect(janelas[0]?.style.height).toBe('150px');
  expect(janelas[0]?.textContent).toBe(texto);
  expect(janelas[0]?.querySelector('[id]')).toBeNull();
  janelas.forEach((j) => j.remove());
  expect(raiz.children).toHaveLength(1);
  expect(bloco.textContent).toBe(texto);
});

test('duas pontas distantes no mesmo parágrafo geram recortes separados; contextos sobrepostos se unem', () => {
  const { raiz } = artigo();
  expect(prepararRecortesDoTexto(raiz, [ponta(30), ponta(10)]).map((r) => r.topo)).toEqual([240, 840]);
  const juntos = prepararRecortesDoTexto(raiz, [ponta(10), ponta(12)]);
  expect(juntos).toHaveLength(1);
  expect(juntos[0]?.altura).toBe(210);
});

test('início e fim do parágrafo não inventam contexto; grifos fora da janela não são desenhados', () => {
  const { raiz } = artigo();
  const recortes = prepararRecortesDoTexto(raiz, [ponta(0), ponta(39)]);
  expect(recortes[0]?.topo).toBe(0);
  expect(recortes[0]?.altura).toBe(90);
  expect(recortes[1]?.altura).toBeLessThanOrEqual(90);
  const janela = montarRecortesDoTexto(recortes)[0]!;
  vi.spyOn(janela, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 600, 90));
  const caixas = caixasVisiveis(janela.firstElementChild!, [new DOMRect(100, 170, 600, 20), new DOMRect(100, 230, 600, 20), new DOMRect(100, 295, 600, 20)]);
  expect(caixas).toHaveLength(1);
  expect(caixas[0]?.top).toBe(230);
});
