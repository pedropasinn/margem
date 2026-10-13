export { AnnotatedText } from './AnnotatedText';
export { BlockRenderer } from './BlockRenderer';
export { ChapterContent } from './ChapterContent';
export { MarginNotes } from './MarginNotes';
export { NoteSheet } from './NoteSheet';
export { ReaderController } from './ReaderController';
export { ReaderViewport } from './ReaderViewport';
export { ancoraDoPonto, pontoDaAncora } from './ancora';
export { INTERACAO_VAZIA, marcaAtiva, reduzirInteracao } from './interacao';
export {
  FILTRO_PADRAO, comMudanca, marcasEmOrdem, marcasFiltradas, notasDoCapitulo, origensPresentes,
} from './notas';
export { intervaloDoOffset, nosDeTexto, pontoDoNo, retanguloDoIntervalo, segmentosDoBloco } from './posicao';
export { useControlador } from './useControlador';
export { useProgresso } from './hooks/useProgresso';
export { useTelaEstreita } from './hooks/useTelaEstreita';
export type { AcoesDaNota } from './MarginNotes';
export type { AtualizarMarca, PropsDoControlador } from './ReaderController';
export type { AcaoDaInteracao, EstadoDaInteracao } from './interacao';
export type { FiltroDeMarcas, MudancaDeMarca, Nota, OrigemDeMarca, RecorteDeMarcas } from './notas';
export type { ControladorDoLeitor } from './useControlador';
export type {
  FontesDoProgresso, ProgressoDoLeitor, ProgressoGravado, RespostaDoProgresso,
} from './hooks/useProgresso';
export type { ApiDoLeitor, EstrategiaDeLayout, PontoDeTexto, SnapshotCapitulo } from './tipos';
