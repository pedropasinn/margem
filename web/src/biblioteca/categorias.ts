/**
 * As categorias da Biblioteca pelo tipo de arquivo (V-D1): campos estáveis do próprio documento, que a
 * pessoa enxerga, e nunca a quantidade de capítulos que o motor detectou. Cada documento cai em uma só
 * categoria, então a soma das contagens é o total de "Todos". "Livro" deixou de ser categoria: é um
 * atributo do cartão (mais de um capítulo).
 */
import type { ItemDaBiblioteca } from './tipos';

export type CategoriaDoDocumento = 'pdfs' | 'epubs' | 'textos' | 'markdowns' | 'videos';
export type CategoriaDaBiblioteca = CategoriaDoDocumento | 'quadros';

export interface DescricaoDaCategoria {
  tipo: CategoriaDaBiblioteca;
  /** Nome na barra lateral e no título da lista. */
  rotulo: string;
  icone: string;
  /** O substantivo do contador: "1 PDF", "47 PDFs". */
  singular: string;
  plural: string;
  /** Frase do estado vazio com busca ou aba sem resultado. */
  vazio: string;
}

export const CATEGORIAS: readonly DescricaoDaCategoria[] = [
  { tipo: 'pdfs', rotulo: 'PDFs', icone: 'pdf', singular: 'PDF', plural: 'PDFs', vazio: 'Nenhum PDF' },
  { tipo: 'epubs', rotulo: 'EPUBs', icone: 'livro', singular: 'EPUB', plural: 'EPUBs', vazio: 'Nenhum EPUB' },
  { tipo: 'textos', rotulo: 'Textos', icone: 'texto', singular: 'texto', plural: 'textos', vazio: 'Nenhum texto' },
  { tipo: 'markdowns', rotulo: 'Markdowns', icone: 'sumario', singular: 'Markdown', plural: 'Markdowns', vazio: 'Nenhum Markdown' },
  // Vídeos e Quadros não são tipo de arquivo: o nome é só o que são (decisão MV-P11). Áudios entram aqui.
  { tipo: 'videos', rotulo: 'Vídeos', icone: 'video-doc', singular: 'vídeo ou áudio', plural: 'vídeos e áudios', vazio: 'Nenhum vídeo ou áudio' },
  { tipo: 'quadros', rotulo: 'Quadros', icone: 'quadro', singular: 'quadro', plural: 'quadros', vazio: 'Nenhum quadro' },
];

export function descricaoDaCategoria(tipo: CategoriaDaBiblioteca): DescricaoDaCategoria {
  return CATEGORIAS.find((categoria) => categoria.tipo === tipo)!;
}

/**
 * A categoria de um documento. Vídeo e áudio vêm primeiro (são `txt` com mídia); depois o formato do
 * arquivo. TXT, texto colado e qualquer formato raro (o antigo `pdf_foto` vai para PDFs) caem num lugar só.
 */
export function categoriaDoDocumento(item: Pick<ItemDaBiblioteca, 'formato' | 'midia'>): CategoriaDoDocumento {
  if (item.midia) return 'videos';
  if (item.formato === 'pdf' || item.formato.startsWith('pdf_')) return 'pdfs';
  if (item.formato === 'epub') return 'epubs';
  if (item.formato === 'md') return 'markdowns';
  return 'textos';
}

export type ContagemPorCategoria = Record<CategoriaDaBiblioteca, number>;

export function contarPorCategoria(documentos: readonly Pick<ItemDaBiblioteca, 'formato' | 'midia'>[], quadros = 0): ContagemPorCategoria {
  const contagem: ContagemPorCategoria = { pdfs: 0, epubs: 0, textos: 0, markdowns: 0, videos: 0, quadros };
  for (const documento of documentos) contagem[categoriaDoDocumento(documento)] += 1;
  return contagem;
}

/**
 * "1 PDF", "47 PDFs", "3 itens". Na categoria de mídia, o substantivo segue o que há: só vídeos, só
 * áudios ou os dois.
 */
export function contadorDaCategoria(quantidade: number, tipo: CategoriaDaBiblioteca | null, midias: readonly ('video' | 'audio')[] = []): string {
  const n = String(quantidade);
  if (tipo === null) return `${n} ${quantidade === 1 ? 'item' : 'itens'}`;
  if (tipo === 'videos' && midias.length > 0 && midias.every((m) => m === midias[0])) {
    const video = midias[0] === 'video';
    return `${n} ${quantidade === 1 ? (video ? 'vídeo' : 'áudio') : (video ? 'vídeos' : 'áudios')}`;
  }
  const categoria = descricaoDaCategoria(tipo);
  return `${n} ${quantidade === 1 ? categoria.singular : categoria.plural}`;
}

/** Capítulos do documento: o número que a lista já traz ou, nas APIs antigas, o da árvore carregada. */
export function capitulosDoItem(item: Pick<ItemDaBiblioteca, 'capitulos_total' | 'versao_id'>, arvores: Readonly<Record<string, { capitulos: unknown[] }>> = {}): number | undefined {
  if (typeof item.capitulos_total === 'number') return item.capitulos_total;
  return arvores[item.versao_id ?? '']?.capitulos.length;
}
