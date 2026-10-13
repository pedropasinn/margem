/**
 * Recortes do PDF para a dobra do braquete. A dobra é uma apresentação temporária sobre o leitor, e
 * a fonte visual é o próprio PDF. Cada página é renderizada pelo PDF.js com a mesma transformação do
 * leitor (`getViewport({ scale })` e a densidade da tela), fora da tela e com cache. O recorte mostra
 * essa página inteira deslocada dentro de uma janela com `overflow: hidden`. Nada aqui lê texto,
 * âncora ou canônico: só páginas, escala e retângulos.
 */
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { Retangulo } from '../ui/marcador/tracos';

/** Desenha a página no canvas como o leitor desenha: o mesmo viewport, a mesma densidade. */
export function renderizarPaginaNoCanvas(pagina: PDFPageProxy, canvas: HTMLCanvasElement, escala: number, densidade: number): RenderTask {
  const viewport = pagina.getViewport({ scale: escala });
  canvas.width = Math.ceil(viewport.width * densidade); canvas.height = Math.ceil(viewport.height * densidade);
  canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
  return pagina.render({ canvas, viewport, transform: [densidade, 0, 0, densidade, 0, 0] });
}

/** Uma ponta do braquete no PDF: a página e as linhas da citação, em pixels da página na escala do leitor. */
export interface RegiaoPdf {
  pagina: number;
  escala: number;
  /** Tamanho da página na tela (na escala do leitor). */
  largura: number;
  altura: number;
  linhas: Retangulo[];
  /** Todas as linhas de texto da página (a mesma geometria das palavras), para o recorte não cortar uma linha ao meio. */
  linhasDaPagina?: readonly Pick<Retangulo, 'y' | 'altura'>[];
}

/** O recorte de uma página: a faixa vertical `[y, y + altura]`, em pixels da página na escala do leitor. */
export interface RecortePdf {
  pagina: number;
  escala: number;
  largura: number;
  alturaDaPagina: number;
  y: number;
  altura: number;
}

/** Quantas linhas de contexto acima e abaixo da citação. */
export const LINHAS_DE_CONTEXTO = 2;
/** Sem a geometria das linhas da página, o contexto em px da tela. */
export const CONTEXTO_DO_RECORTE = 40;

/**
 * O recorte de uma ponta: a largura inteira da página e, na vertical, a citação com duas linhas de
 * contexto acima e duas abaixo. As bordas caem no vão entre linhas, pela geometria das palavras da
 * página. Não passa de `alturaMaxima` nem sai da página; se a citação não cabe, o recorte mostra o
 * começo dela.
 */
export function recorteDaRegiao(regiao: RegiaoPdf, alturaMaxima: number): RecortePdf {
  const topo = Math.min(...regiao.linhas.map((linha) => linha.y));
  const base = Math.max(...regiao.linhas.map((linha) => linha.y + linha.altura));
  const linhas = faixasVerticais(regiao.linhasDaPagina ?? []);
  let y: number; let fim: number;
  const primeira = linhas.findIndex((l) => l.y + l.altura > topo);
  const ultima = ultimoIndice(linhas, (l) => l.y < base);
  if (primeira !== -1 && ultima >= primeira) {
    y = Math.max(0, bordaAcima(linhas, Math.max(0, primeira - LINHAS_DE_CONTEXTO)));
    fim = Math.min(regiao.altura, bordaAbaixo(linhas, Math.min(linhas.length - 1, ultima + LINHAS_DE_CONTEXTO)));
    // Alto demais: fica o começo, cortado no vão da última linha que cabe.
    if (fim - y > alturaMaxima) {
      const cabe = ultimoIndice(linhas, (l) => l.y + l.altura <= y + alturaMaxima);
      fim = cabe >= 0 && linhas[cabe]!.y > y ? Math.min(y + alturaMaxima, bordaAbaixo(linhas, cabe)) : y + alturaMaxima;
    }
  } else {
    const altura = Math.max(0, Math.min(alturaMaxima, base - topo + 2 * CONTEXTO_DO_RECORTE, regiao.altura));
    y = Math.max(0, Math.min(regiao.altura - altura, topo - CONTEXTO_DO_RECORTE));
    fim = y + altura;
  }
  return { pagina: regiao.pagina, escala: regiao.escala, largura: regiao.largura, alturaDaPagina: regiao.altura, y, altura: Math.max(0, fim - y) };
}

function ultimoIndice<T>(lista: readonly T[], condicao: (item: T) => boolean): number {
  for (let i = lista.length - 1; i >= 0; i--) if (condicao(lista[i]!)) return i;
  return -1;
}

/** O meio do vão acima da linha `i` (ou um pouco acima dela, na primeira linha). */
function bordaAcima(linhas: readonly { y: number; altura: number }[], i: number): number {
  const linha = linhas[i]!; const anterior = linhas[i - 1];
  return anterior ? (anterior.y + anterior.altura + linha.y) / 2 : linha.y - 6;
}
/** O meio do vão abaixo da linha `i` (ou um pouco abaixo dela, na última linha). */
function bordaAbaixo(linhas: readonly { y: number; altura: number }[], i: number): number {
  const linha = linhas[i]!; const seguinte = linhas[i + 1];
  return seguinte ? (linha.y + linha.altura + seguinte.y) / 2 : linha.y + linha.altura + 6;
}

/** Junta as linhas que se sobrepõem na vertical (pedaços da mesma linha, colunas lado a lado) em faixas. */
export function faixasVerticais(linhas: readonly Pick<Retangulo, 'y' | 'altura'>[]): { y: number; altura: number }[] {
  const faixas: { y: number; altura: number }[] = [];
  for (const linha of [...linhas].sort((a, b) => a.y - b.y)) {
    const ultima = faixas.at(-1);
    if (ultima && linha.y < ultima.y + ultima.altura) ultima.altura = Math.max(ultima.altura, linha.y + linha.altura - ultima.y);
    else faixas.push({ y: linha.y, altura: linha.altura });
  }
  return faixas;
}

/** Se `y` corta uma linha, o meio do vão acima dela; senão, `y`. */
export function vaoAcima(linhas: readonly Pick<Retangulo, 'y' | 'altura'>[], y: number): number {
  const indice = linhas.findIndex((linha) => linha.y < y && y < linha.y + linha.altura);
  if (indice === -1) return y;
  const linha = linhas[indice]!;
  const anterior = linhas[indice - 1];
  return anterior ? Math.min(linha.y, (anterior.y + anterior.altura + linha.y) / 2) : linha.y - 4;
}

/** Se `y` corta uma linha, o meio do vão abaixo dela; senão, `y`. */
export function vaoAbaixo(linhas: readonly Pick<Retangulo, 'y' | 'altura'>[], y: number): number {
  const indice = linhas.findIndex((linha) => linha.y < y && y < linha.y + linha.altura);
  if (indice === -1) return y;
  const linha = linhas[indice]!;
  const seguinte = linhas[indice + 1];
  return seguinte ? Math.max(linha.y + linha.altura, (linha.y + linha.altura + seguinte.y) / 2) : linha.y + linha.altura + 4;
}

/**
 * Apara o contexto do recorte para caber entre `topo` e `base` (em px da página), sem nunca cortar a
 * citação: as bordas vão ao vão entre linhas mais próximo que ainda caiba. `null` se a citação não
 * cabe nesses limites.
 */
export function apararRecorte(regiao: RegiaoPdf, recorte: RecortePdf, limites: { topo?: number; base?: number }): RecortePdf | null {
  const citacaoTopo = Math.min(...regiao.linhas.map((linha) => linha.y));
  const citacaoBase = Math.max(...regiao.linhas.map((linha) => linha.y + linha.altura));
  const faixas = faixasVerticais(regiao.linhasDaPagina ?? []);
  let y = recorte.y; let fim = recorte.y + recorte.altura;
  if (limites.topo !== undefined && y < limites.topo) {
    const limite = limites.topo;
    if (citacaoTopo < limite) return null;
    const i = faixas.findIndex((l) => l.y >= limite);
    y = Math.min(citacaoTopo, i >= 0 ? Math.max(limite, bordaAcima(faixas, i)) : limite);
  }
  if (limites.base !== undefined && fim > limites.base) {
    const limite = limites.base;
    if (citacaoBase > limite) return null;
    const j = ultimoIndice(faixas, (l) => l.y + l.altura <= limite);
    fim = Math.max(citacaoBase, j >= 0 ? Math.min(limite, bordaAbaixo(faixas, j)) : limite);
  }
  return { ...recorte, y, altura: Math.max(0, fim - y) };
}

/** Da página para a dobra: o mesmo retângulo, menos o deslocamento do recorte, mais onde ele está na tela. */
export function paginaParaDobra(retangulo: Retangulo, recorte: Pick<RecortePdf, 'y'>, noEcra: { x: number; y: number }): Retangulo {
  return { ...retangulo, x: noEcra.x + retangulo.x, y: noEcra.y + retangulo.y - recorte.y };
}

const LIMITE_DO_CACHE = 6;

/**
 * Páginas já renderizadas para recorte, por documento, página, escala e densidade. Guarda as promessas,
 * para que dois pedidos da mesma página não a renderizem duas vezes. As mais antigas saem primeiro.
 */
export class CacheDePaginas {
  private readonly paginas = new Map<string, Promise<HTMLCanvasElement>>();
  private readonly prontas = new Map<string, HTMLCanvasElement>();
  constructor(private readonly limite = LIMITE_DO_CACHE) {}

  chave(documentoId: string, pagina: number, escala: number, densidade: number): string {
    return `${documentoId}|${String(pagina)}|${escala.toFixed(5)}|${String(densidade)}`;
  }

  /** O canvas já pronto (ou `undefined`): o recorte só monta depois de a página estar pronta. */
  pronta(chave: string): HTMLCanvasElement | undefined { return this.prontas.get(chave); }

  renderizar(documento: PDFDocumentProxy, documentoId: string, pagina: number, escala: number, densidade: number): Promise<HTMLCanvasElement> {
    const chave = this.chave(documentoId, pagina, escala, densidade);
    const existente = this.paginas.get(chave);
    if (existente) { this.paginas.delete(chave); this.paginas.set(chave, existente); return existente; }
    const promessa: Promise<HTMLCanvasElement> = documento.getPage(pagina).then(async (proxy) => {
      const canvas = document.createElement('canvas');
      try { await renderizarPaginaNoCanvas(proxy, canvas, escala, densidade).promise; }
      finally { proxy.cleanup(); }
      // Expulsa antes de terminar (navegação ou zoom rápidos): não volta para `prontas`, onde ficaria
      // fora do controle de expulsão segurando o canvas.
      if (this.paginas.get(chave) === promessa) this.prontas.set(chave, canvas);
      return canvas;
    });
    promessa.catch(() => { this.paginas.delete(chave); this.prontas.delete(chave); });
    this.paginas.set(chave, promessa);
    while (this.paginas.size > this.limite) {
      const antiga = this.paginas.keys().next().value;
      if (antiga === undefined) break;
      this.paginas.delete(antiga); this.prontas.delete(antiga);
    }
    return promessa;
  }
}
