/**
 * Karaokê sobre o texto do leitor: um só serviço para a leitura comentada (J92) e o player de áudio e
 * vídeo (J71), no estilo do ElevenReader com o filete do Readwise.
 *
 * Desenho (AGENTS.md, regra 7): o texto não ganha `background`, peso nem fonte. A faixa da frase (um
 * bloco arredondado por linha, cor suave) e o bloco da palavra (mais forte) ficam numa camada própria
 * dentro do artigo, atrás do SVG do Marcador (z-index −2 contra o −1 das marcas), a partir de
 * `Range.getClientRects()` juntados por linha. Só a cor da tinta da palavra muda, pela CSS Custom
 * Highlight API (`::highlight(margem-karaoke-palavra)`), que não mexe no DOM do texto.
 *
 * Desempenho: `definir` só compara chaves e agenda um quadro; no quadro, a faixa é remedida só quando
 * a frase muda (ou numa rolagem, redimensionamento ou reflow) e a palavra só quando a palavra muda.
 * Nada passa pelo React.
 */
import type { Id, TrechoTemporizado } from '@margem/contratos';
import { caixasVisiveis } from '../caixas-visiveis';
import { intervaloDoOffset, pontoDoNo } from '../posicao';
import type { PontoDeTexto, SnapshotCapitulo } from '../tipos';
import { blocosPorLinha, foraDaVista, type Bloco } from './geometria';
import './karaoke.css';

export const REALCE_DA_PALAVRA = 'margem-karaoke-palavra';
export type ModoDoDestaque = 'palavra' | 'frase' | 'nenhum';
type Trecho = Pick<TrechoTemporizado, 'bloco_id' | 'inicio_utf16' | 'fim_utf16'>;

export interface EstadoDoKaraoke {
  frase: Trecho | null;
  palavra: Trecho | null;
  modo: ModoDoDestaque;
}

interface RegistroDeRealces { set(nome: string, realce: unknown): void; delete(nome: string): boolean }
type ConstrutorDeRealce = new (...intervalos: Range[]) => { priority: number };

function api(): { registro: RegistroDeRealces; Realce: ConstrutorDeRealce } | null {
  const css = (globalThis as { CSS?: { highlights?: RegistroDeRealces } }).CSS;
  const Realce = (globalThis as { Highlight?: ConstrutorDeRealce }).Highlight;
  return css?.highlights && Realce ? { registro: css.highlights, Realce } : null;
}

/** O navegador pinta faixas de texto sem mexer no DOM? (Chromium 105+, Safari 17.2+, Firefox 140+.) */
export function realceDisponivel(): boolean {
  return api() !== null;
}

/** Um `Range` do DOM cobrindo o trecho (bloco + offsets UTF-16), ou `null` se o bloco não está na tela. */
export function intervaloDoTrecho(raiz: ParentNode, trecho: Trecho): Range | null {
  const inicio = intervaloDoOffset(raiz, trecho.bloco_id, trecho.inicio_utf16);
  const fim = intervaloDoOffset(raiz, trecho.bloco_id, trecho.fim_utf16);
  if (!inicio || !fim) return null;
  const intervalo = inicio.cloneRange();
  intervalo.setEnd(fim.startContainer, fim.startOffset);
  return intervalo.collapsed ? null : intervalo;
}

const chaveDe = (t: Trecho | null): string => (t ? `${t.bloco_id}:${String(t.inicio_utf16)}:${String(t.fim_utf16)}` : '');
const FOLGA_DA_FRASE = { x: 4, y: 3 };
const FOLGA_DA_PALAVRA = { x: 3, y: 3 };
/** Onde o leitor lê: abaixo da barra do leitor (e do vídeo, no celular) e acima do player. */
function vista(): { topo: number; base: number } {
  const estilo = document.documentElement.style;
  const video = (Number.parseFloat(estilo.getPropertyValue('--topo-do-video')) || 0) + (Number.parseFloat(estilo.getPropertyValue('--altura-do-video')) || 0);
  return { topo: Math.max(56, video), base: window.innerHeight - 150 };
}

function retangulos(intervalo: Range | null): DOMRect[] {
  if (!intervalo || typeof intervalo.getClientRects !== 'function') return [];
  const elemento = intervalo.startContainer instanceof Element ? intervalo.startContainer : intervalo.startContainer.parentElement;
  const caixas = [...intervalo.getClientRects()];
  return elemento ? caixasVisiveis(elemento, caixas) : caixas;
}

function posicionar(div: HTMLElement, b: Bloco): void {
  div.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
  div.style.width = `${b.largura.toFixed(1)}px`;
  div.style.height = `${b.altura.toFixed(1)}px`;
}

/**
 * A camada do karaokê de um leitor. `definir` a cada quadro (ou a cada mudança) com a frase e a
 * palavra em curso; `destruir` ao fechar. `aoMudarFora` avisa quando a frase sai da área de leitura
 * (para o "Voltar ao trecho atual").
 */
export class Karaoke {
  private raiz: HTMLElement | null = null;
  private estado: EstadoDoKaraoke = { frase: null, palavra: null, modo: 'nenhum' };
  private chaves = { frase: '', palavra: '', modo: '' };
  private sujo = { frase: false, palavra: false };
  private quadro = 0;
  private camada: HTMLDivElement | null = null;
  private artigo: HTMLElement | null = null;
  private faixas: HTMLDivElement[] = [];
  private filete: HTMLDivElement | null = null;
  private palavras: HTMLDivElement[] = [];
  private blocosDaFrase: Bloco[] = [];
  private ultimaPalavra: Bloco | null = null;
  private fora = false;
  private observador: ResizeObserver | null = null;
  private readonly ouvintes = new Set<(fora: boolean) => void>();
  private readonly remedir = (): void => { this.sujo.frase = true; this.sujo.palavra = true; this.agendar(); };
  private depoisDeRolar = 0;
  private destruido = false;
  /** Na rolagem, a camada anda com o artigo: basta ver se a frase saiu da vista; remede quando a rolagem para (a dobra pode ter mudado). */
  private readonly aoRolar = (): void => {
    this.agendar();
    window.clearTimeout(this.depoisDeRolar);
    this.depoisDeRolar = window.setTimeout(this.remedir, 140);
  };

  constructor(private readonly opcoes: { filete?: boolean } = {}) {
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', this.aoRolar, { passive: true });
      window.addEventListener('resize', this.remedir);
      void document.fonts?.ready.then(this.remedir);
    }
  }

  definir(raiz: HTMLElement | null, estado: EstadoDoKaraoke): void {
    const ligado = estado.modo !== 'nenhum';
    const frase = ligado ? chaveDe(estado.frase) : '';
    const palavra = ligado && estado.modo === 'palavra' ? chaveDe(estado.palavra) : '';
    if (raiz !== this.raiz) { this.raiz = raiz; this.sujo.frase = true; this.sujo.palavra = true; }
    if (frase !== this.chaves.frase) { this.sujo.frase = true; this.sujo.palavra = true; }
    if (palavra !== this.chaves.palavra) this.sujo.palavra = true;
    this.chaves = { frase, palavra, modo: estado.modo };
    this.estado = estado;
    if (this.sujo.frase || this.sujo.palavra) this.agendar();
  }

  /** A frase em curso está fora da área de leitura? */
  get fraseFora(): boolean { return this.fora; }

  aoMudarFora(ouvinte: (fora: boolean) => void): () => void {
    this.ouvintes.add(ouvinte);
    return () => { this.ouvintes.delete(ouvinte); };
  }

  /** Leva a frase em curso para ~38 % da altura. */
  rolarAteAFrase(comportamento: ScrollBehavior = 'smooth'): void {
    if (!this.raiz || !this.estado.frase) return;
    const caixa = intervaloDoTrecho(this.raiz, this.estado.frase)?.getBoundingClientRect();
    if (!caixa || caixa.height === 0) return;
    window.scrollBy({ top: caixa.top - window.innerHeight * 0.38, behavior: comportamento });
  }

  destruir(): void {
    this.destruido = true;
    cancelAnimationFrame(this.quadro);
    window.clearTimeout(this.depoisDeRolar);
    window.removeEventListener('scroll', this.aoRolar);
    window.removeEventListener('resize', this.remedir);
    this.observador?.disconnect();
    this.camada?.remove();
    this.camada = null;
    this.ouvintes.clear();
    api()?.registro.delete(REALCE_DA_PALAVRA);
  }

  private agendar(): void {
    if (this.destruido || this.quadro !== 0 || typeof requestAnimationFrame !== 'function') return;
    this.quadro = requestAnimationFrame(() => { this.quadro = 0; this.desenhar(); });
  }

  private garantirCamada(): HTMLDivElement | null {
    const raiz = this.raiz;
    const artigo = raiz ? (raiz.matches('.capitulo') ? raiz : raiz.querySelector<HTMLElement>('.capitulo')) : null;
    if (!artigo) { this.camada?.remove(); this.camada = null; this.artigo = null; return null; }
    if (this.camada && this.camada.parentElement === artigo) return this.camada;
    this.camada?.remove();
    const camada = document.createElement('div');
    camada.className = 'camada-do-karaoke';
    camada.setAttribute('aria-hidden', 'true');
    artigo.append(camada);
    this.camada = camada;
    this.faixas = []; this.palavras = []; this.filete = null; this.ultimaPalavra = null;
    if (artigo !== this.artigo) {
      this.observador?.disconnect();
      this.observador = typeof ResizeObserver === 'function' ? new ResizeObserver(this.remedir) : null;
      this.observador?.observe(artigo);
      this.artigo = artigo;
    }
    return camada;
  }

  private desenhar(): void {
    const camada = this.garantirCamada();
    const raiz = this.raiz;
    const { frase, palavra, modo } = this.estado;
    const realces = api();
    if (!camada || !raiz || modo === 'nenhum') {
      this.camada?.replaceChildren();
      this.faixas = []; this.palavras = []; this.filete = null; this.ultimaPalavra = null; this.blocosDaFrase = [];
      realces?.registro.delete(REALCE_DA_PALAVRA);
      this.sujo = { frase: false, palavra: false };
      this.avisarFora(false);
      return;
    }
    const base = camada.getBoundingClientRect();
    if (this.sujo.frase) {
      const intervalo = frase ? intervaloDoTrecho(raiz, frase) : null;
      const blocos = blocosPorLinha(retangulos(intervalo), base, FOLGA_DA_FRASE);
      const mudou = chaveDe(frase) !== camada.dataset['frase'];
      camada.dataset['frase'] = chaveDe(frase);
      // Frase nova: blocos novos (a animação de entrada recomeça); a mesma frase remedida: só reposiciona.
      if (mudou) { for (const f of this.faixas) f.remove(); this.faixas = []; }
      while (this.faixas.length < blocos.length) {
        const div = document.createElement('div');
        div.className = 'karaoke-faixa';
        camada.prepend(div);
        this.faixas.push(div);
      }
      for (const div of this.faixas.splice(blocos.length)) div.remove();
      blocos.forEach((b, i) => posicionar(this.faixas[i]!, b));
      this.blocosDaFrase = blocos;
      this.desenharFilete(camada, intervalo, base, blocos);
    }
    if (this.sujo.palavra) {
      const intervalo = modo === 'palavra' && palavra ? intervaloDoTrecho(raiz, palavra) : null;
      const blocos = blocosPorLinha(retangulos(intervalo), base, FOLGA_DA_PALAVRA);
      while (this.palavras.length < blocos.length) {
        const div = document.createElement('div');
        div.className = 'karaoke-palavra';
        div.dataset['salto'] = '';
        camada.append(div);
        this.palavras.push(div);
      }
      for (const div of this.palavras.splice(blocos.length)) div.remove();
      blocos.forEach((b, i) => {
        const div = this.palavras[i]!;
        // Na mesma linha a palavra desliza; ao trocar de linha (ou de frase), salta.
        const salto = i > 0 || !this.ultimaPalavra || Math.abs(this.ultimaPalavra.y - b.y) > 3;
        if (salto) div.dataset['salto'] = ''; else delete div.dataset['salto'];
        posicionar(div, b);
        if (salto) { void div.offsetWidth; delete div.dataset['salto']; }
      });
      this.ultimaPalavra = blocos[0] ?? null;
      if (realces) {
        if (intervalo) { const realce = new realces.Realce(intervalo); realce.priority = 3; realces.registro.set(REALCE_DA_PALAVRA, realce); }
        else realces.registro.delete(REALCE_DA_PALAVRA);
      }
    }
    this.sujo = { frase: false, palavra: false };
    this.avisarFora(foraDaVista(this.blocosDaFrase, base, vista()));
  }

  /** O filete do Readwise: fino, à esquerda do parágrafo em leitura. */
  private desenharFilete(camada: HTMLDivElement, intervalo: Range | null, base: DOMRect, blocos: readonly Bloco[]): void {
    const no = intervalo?.startContainer;
    const paragrafo = (no instanceof Element ? no : no?.parentElement)?.closest<HTMLElement>('[data-bloco]');
    const caixa = this.opcoes.filete === false || !paragrafo || blocos.length === 0 ? null : paragrafo.getBoundingClientRect();
    if (!caixa || caixa.height === 0) { this.filete?.remove(); this.filete = null; return; }
    if (!this.filete) { this.filete = document.createElement('div'); this.filete.className = 'karaoke-filete'; camada.prepend(this.filete); }
    const recuo = window.innerWidth < 600 ? 9 : 22;
    posicionar(this.filete, { x: caixa.left - base.left - recuo, y: caixa.top - base.top, largura: 2, altura: caixa.height });
  }

  private avisarFora(fora: boolean): void {
    if (fora === this.fora) return;
    this.fora = fora;
    for (const ouvinte of this.ouvintes) ouvinte(fora);
  }
}

interface DocumentoComCursor {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

/** O ponto do texto (bloco + offset) sob as coordenadas do clique. */
export function pontoNoClique(documento: Document, x: number, y: number, snapshot: SnapshotCapitulo): PontoDeTexto | null {
  const cursor = documento as unknown as DocumentoComCursor;
  if (typeof cursor.caretPositionFromPoint === 'function') {
    const posicao = cursor.caretPositionFromPoint(x, y);
    return posicao ? pontoDoNo(posicao.offsetNode, posicao.offset, snapshot) : null;
  }
  if (typeof cursor.caretRangeFromPoint === 'function') {
    const intervalo = cursor.caretRangeFromPoint(x, y);
    return intervalo ? pontoDoNo(intervalo.startContainer, intervalo.startOffset, snapshot) : null;
  }
  return null;
}

/** Índice da palavra (ou frase) que contém o ponto, por bloco; -1 se nenhuma. */
export function trechoNoPonto(trechos: readonly TrechoTemporizado[], porBloco: ReadonlyMap<Id, readonly number[]>, ponto: PontoDeTexto): number {
  const indices = porBloco.get(ponto.bloco_id) ?? [];
  let achado = -1;
  for (const indice of indices) {
    const t = trechos[indice]!;
    if (t.inicio_utf16 <= ponto.offset_utf16) achado = indice;
    if (t.inicio_utf16 > ponto.offset_utf16) break;
  }
  if (achado < 0) return indices[0] ?? -1;
  return achado;
}

/** Índices dos trechos de cada bloco, em ordem de texto. */
export function indicePorBloco(trechos: readonly TrechoTemporizado[]): Map<Id, number[]> {
  const mapa = new Map<Id, number[]>();
  trechos.forEach((t, i) => { const lista = mapa.get(t.bloco_id) ?? []; lista.push(i); mapa.set(t.bloco_id, lista); });
  for (const lista of mapa.values()) lista.sort((a, b) => trechos[a]!.inicio_utf16 - trechos[b]!.inicio_utf16);
  return mapa;
}
