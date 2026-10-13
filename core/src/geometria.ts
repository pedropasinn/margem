import type { AncoraV1, Bloco, Id, PalavraGeometria, QuadPdf } from '@margem/contratos';
import { ancoraDeSelecao, type BlocoDeVersao } from './ancoras';

export interface RetanguloPdf { x: number; y: number; largura: number; altura: number }
export interface QuadsDaPagina { pagina: number; quads: QuadPdf[] }

/** Interpolação sobre as duas bordas preserva também quads inclinados. */
function recortar(q: QuadPdf, inicio: number, fim: number): QuadPdf {
  const x = (a: number, b: number, t: number): number => a + (b - a) * t;
  return [x(q[0], q[2], inicio), x(q[1], q[3], inicio), x(q[0], q[2], fim), x(q[1], q[3], fim),
    x(q[6], q[4], fim), x(q[7], q[5], fim), x(q[6], q[4], inicio), x(q[7], q[5], inicio)];
}

/** Envelope da publicação: índices/filtros devem conservar esta identidade. */
export interface GeometriaDaVersao { readonly versao_id: Id; readonly palavras: readonly PalavraGeometria[] }

/** Requer geometria local válida da mesma publicação. Interpola recortes intrapalavra;
 * representa somente a cobertura disponível, sem prometer largura por glifo ou coluna. O(palavras).
 */
export function quadsDaAncora(ancora: AncoraV1, geometria: GeometriaDaVersao): QuadsDaPagina[] {
  if (ancora.versao_id !== geometria.versao_id) throw new Error('A geometria pertence a outra versão.');
  const { palavras } = geometria;
  const paginas = new Map<number, QuadPdf[]>();
  for (const palavra of palavras) {
    if (palavra.bloco_id !== ancora.bloco_id || palavra.fim_utf16 <= ancora.inicio_utf16 || palavra.inicio_utf16 >= ancora.fim_utf16) continue;
    const tamanho = palavra.fim_utf16 - palavra.inicio_utf16;
    const quad = recortar(palavra.quad, Math.max(0, ancora.inicio_utf16 - palavra.inicio_utf16) / tamanho,
      Math.min(tamanho, ancora.fim_utf16 - palavra.inicio_utf16) / tamanho);
    const quads = paginas.get(palavra.pagina) ?? [];
    const anterior = quads.at(-1);
    // Fusão por proximidade nas duas bordas; não há identidade de coluna nesta projeção.
    const altura = Math.hypot(quad[6] - quad[0], quad[7] - quad[1]);
    if (anterior && Math.abs(anterior[3] - quad[1]) <= 1 && Math.abs(anterior[5] - quad[7]) <= 1 &&
        quad[0] >= anterior[2] - 1 && quad[0] - anterior[2] <= altura * 1.5) {
      anterior[2] = quad[2]; anterior[3] = quad[3]; anterior[4] = quad[4]; anterior[5] = quad[5];
    } else quads.push(quad);
    paginas.set(palavra.pagina, quads);
  }
  return [...paginas].sort(([a], [b]) => a - b).map(([pagina, quads]) => ({ pagina, quads }));
}

export interface SelecaoNaPagina { pagina: number; retangulos: readonly RetanguloPdf[] }
export type ResultadoSelecaoPdf =
  | { ok: true; ancora: AncoraV1 }
  | { ok: false; motivo: 'sem_correspondencia' | 'versao_divergente' | 'entre_blocos' | 'descontinua' | 'cobertura_insuficiente' };

/** Quantiza por centros de palavras. Só espaços podem preencher lacunas entre intervalos.
 * Confere todas as páginas juntas; ausência de geometria nunca autoriza acrescentar texto.
 * Não promete precisão intrapalavra. Custo: O(palavras × retângulos da página + selecionadas log selecionadas).
 */
export function resolverSelecaoPdf(selecao: readonly SelecaoNaPagina[], geometria: GeometriaDaVersao,
  blocosPorId: ReadonlyMap<Id, BlocoDeVersao>): ResultadoSelecaoPdf {
  const porPagina = new Map(selecao.map(s => [s.pagina, s.retangulos]));
  const paginasEncontradas = new Set<number>();
  const selecionadas = geometria.palavras.filter(p => {
    const q = p.quad, x = (q[0] + q[2] + q[4] + q[6]) / 4, y = (q[1] + q[3] + q[5] + q[7]) / 4;
    const dentro = porPagina.get(p.pagina)?.some(r => r.largura > 0 && r.altura > 0 &&
      x >= r.x && x <= r.x + r.largura && y >= r.y && y <= r.y + r.altura) ?? false;
    if (dentro) paginasEncontradas.add(p.pagina);
    return dentro;
  });
  const primeira = selecionadas[0];
  if (!primeira) return { ok: false, motivo: 'sem_correspondencia' };
  const bloco = blocosPorId.get(primeira.bloco_id);
  if (!bloco) return { ok: false, motivo: 'cobertura_insuficiente' };
  if (bloco.versao_id !== geometria.versao_id) return { ok: false, motivo: 'versao_divergente' };
  if (selecionadas.some(p => p.bloco_id !== bloco.id)) return { ok: false, motivo: 'entre_blocos' };
  if (selecao.some(s => s.retangulos.some(r => r.largura > 0 && r.altura > 0) && !paginasEncontradas.has(s.pagina))) {
    return { ok: false, motivo: 'cobertura_insuficiente' };
  }
  selecionadas.sort((a, b) => a.inicio_utf16 - b.inicio_utf16 || a.fim_utf16 - b.fim_utf16);
  const inicio = selecionadas[0]!.inicio_utf16;
  let fim = inicio;
  for (const p of selecionadas) {
    if (!Number.isInteger(p.inicio_utf16) || !Number.isInteger(p.fim_utf16) || p.inicio_utf16 < 0 ||
      p.fim_utf16 <= p.inicio_utf16 || p.fim_utf16 > bloco.texto.length) return { ok: false, motivo: 'cobertura_insuficiente' };
    if (p.inicio_utf16 > fim && /\S/u.test(bloco.texto.slice(fim, p.inicio_utf16))) {
      const conhecida = geometria.palavras.some(g => g.bloco_id === bloco.id && g.inicio_utf16 < p.inicio_utf16 && g.fim_utf16 > fim);
      return { ok: false, motivo: conhecida ? 'descontinua' : 'cobertura_insuficiente' };
    }
    fim = Math.max(fim, p.fim_utf16);
  }
  try { return { ok: true, ancora: ancoraDeSelecao(bloco, inicio, fim) }; }
  catch { return { ok: false, motivo: 'cobertura_insuficiente' }; }
}

/** Compatibilidade para consumidores de uma página; a interface usa o resultado com diagnóstico. */
export function ancoraDaSelecao(pagina: number, retangulos: readonly RetanguloPdf[], geometria: GeometriaDaVersao,
  blocosPorId: ReadonlyMap<Id, BlocoDeVersao>): AncoraV1 | null {
  const resultado = resolverSelecaoPdf([{ pagina, retangulos }], geometria, blocosPorId);
  return resultado.ok ? resultado.ancora : null;
}

function paginasDoBloco(bloco: Pick<Bloco, 'origens'>): number[] {
  return bloco.origens.flatMap((origem) => origem.tipo === 'pdf' ? [origem.pagina] : []);
}

/** Intervalo bruto: uma página compartilhada continua acessível aos dois capítulos. */
export function paginasDoCapitulo(
  blocos: readonly Pick<Bloco, 'origens' | 'texto'>[],
): { inicio: number; fim: number } | null {
  const paginas = blocos.flatMap(paginasDoBloco);
  return paginas.length ? { inicio: Math.min(...paginas), fim: Math.max(...paginas) } : null;
}

type Faixa = { inicio: number; fim: number };

/**
 * Completa o intervalo bruto do capítulo com as páginas sem texto em volta dele:
 * vai até a página anterior ao próximo capítulo, e o último vai até o fim do PDF.
 * Sem isso, um PDF escaneado (sem camada de texto) mostraria só a primeira página.
 */
export function completarPaginasDoCapitulo(
  bruta: Faixa | null, anterior: Faixa | null, proxima: Faixa | null, total: number | null,
): Faixa | null {
  const inicio = bruta?.inicio ?? (anterior ? anterior.fim + 1 : 1);
  const minimo = bruta?.fim ?? inicio;
  let fim = proxima ? Math.max(minimo, proxima.inicio - 1) : Math.max(minimo, total ?? minimo);
  if (bruta === null && proxima === null && total === null) return null;
  if (total !== null) fim = Math.min(fim, total);
  return { inicio: Math.min(inicio, fim), fim };
}
