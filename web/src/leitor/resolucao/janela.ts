/**
 * A forma da janela da resolução: barra lateral (o texto se recentra no que sobra), janela flutuante ao
 * lado do exercício na página (arrastável pelo cabeçalho) ou tela cheia. A última escolha fica guardada.
 */
export type FormaDaJanela = 'lateral' | 'flutuante' | 'tela-cheia';
export const FORMAS_DA_JANELA: readonly FormaDaJanela[] = ['lateral', 'flutuante', 'tela-cheia'];
const CHAVE = 'margem:resolucao:janela';

export function formaGuardada(): FormaDaJanela {
  try {
    const valor = localStorage.getItem(CHAVE);
    return FORMAS_DA_JANELA.includes(valor as FormaDaJanela) ? valor as FormaDaJanela : 'lateral';
  } catch { return 'lateral'; }
}
export function guardarForma(forma: FormaDaJanela): void {
  try { localStorage.setItem(CHAVE, forma); } catch { /* A escolha vale só para esta visita. */ }
}

export const LARGURA_FLUTUANTE = 420;
export const LARGURA_LATERAL = 460;

/** O tamanho que o leitor deu à barra lateral e à janela flutuante (puxando a borda ou o canto); fica guardado. */
export interface TamanhoDaJanela { lateral: number; flutuante: { largura: number; altura: number } | null }
const CHAVE_DO_TAMANHO = 'margem:resolucao:tamanho';
export const LIMITES = { lateral: { min: 360, folgaDoTexto: 360 }, flutuante: { largura: 340, altura: 320 } } as const;

export function tamanhoGuardado(): TamanhoDaJanela {
  try {
    const valor = JSON.parse(localStorage.getItem(CHAVE_DO_TAMANHO) ?? 'null') as Partial<TamanhoDaJanela> | null;
    const lateral = typeof valor?.lateral === 'number' && Number.isFinite(valor.lateral) ? valor.lateral : LARGURA_LATERAL;
    const f = valor?.flutuante;
    const flutuante = f && typeof f.largura === 'number' && typeof f.altura === 'number' ? { largura: f.largura, altura: f.altura } : null;
    return { lateral, flutuante };
  } catch { return { lateral: LARGURA_LATERAL, flutuante: null }; }
}
export function guardarTamanho(tamanho: TamanhoDaJanela): void {
  try { localStorage.setItem(CHAVE_DO_TAMANHO, JSON.stringify(tamanho)); } catch { /* Vale só para esta visita. */ }
}

/** A barra lateral entre o mínimo e o que deixa pelo menos uma coluna de texto à esquerda. */
export function larguraLateral(largura: number, viewport = window.innerWidth): number {
  return Math.round(Math.max(LIMITES.lateral.min, Math.min(largura, viewport - LIMITES.lateral.folgaDoTexto)));
}
/** A janela flutuante entre o mínimo e a tela, a partir de onde ela está. */
export function tamanhoFlutuante(largura: number, altura: number, onde: { left: number; top: number }, viewport = { largura: window.innerWidth, altura: window.innerHeight }): { largura: number; altura: number } {
  return {
    largura: Math.round(Math.max(LIMITES.flutuante.largura, Math.min(largura, viewport.largura - onde.left - FOLGA / 2))),
    altura: Math.round(Math.max(LIMITES.flutuante.altura, Math.min(altura, viewport.altura - onde.top - FOLGA / 2))),
  };
}
const FOLGA = 16;
/** Da barra do leitor para baixo é que a página é visível. */
const TOPO_UTIL = 64;

export interface Caixa { left: number; top: number; width: number; height: number }
export interface Retangulo { x: number; y: number; largura: number; altura: number }

/** Onde o retângulo recortado está agora na tela (a página tem de estar no DOM). */
export function caixaDoRecorte(pagina: number, retangulo: Retangulo, raiz: ParentNode = document): Caixa | null {
  const folha = raiz.querySelector<HTMLElement>(`.pdf-pagina[data-pagina="${String(pagina)}"]`);
  if (!folha) return null;
  const r = folha.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { left: r.left + retangulo.x * r.width, top: r.top + retangulo.y * r.height, width: retangulo.largura * r.width, height: retangulo.altura * r.height };
}

/**
 * A janela flutuante ao lado do exercício: à direita se couber, senão à esquerda, senão encostada na
 * borda direita; na altura do exercício, dentro da tela. Sem o exercício à vista, no canto direito.
 */
export function posicaoFlutuante(exercicio: Caixa | null, altura: number, viewport = { largura: window.innerWidth, altura: window.innerHeight }, larguraDaJanela = LARGURA_FLUTUANTE): { left: number; top: number } {
  const largura = Math.min(larguraDaJanela, viewport.largura - 2 * FOLGA);
  const limitarTopo = (topo: number) => Math.max(TOPO_UTIL, Math.min(topo, viewport.altura - altura - FOLGA));
  if (!exercicio) return { left: viewport.largura - largura - FOLGA, top: limitarTopo(TOPO_UTIL + FOLGA) };
  const direita = exercicio.left + exercicio.width + FOLGA;
  const esquerda = exercicio.left - FOLGA - largura;
  const left = direita + largura <= viewport.largura - FOLGA ? direita : esquerda >= FOLGA ? esquerda : viewport.largura - largura - FOLGA;
  return { left, top: limitarTopo(exercicio.top) };
}
