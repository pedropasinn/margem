/**
 * Exportação para o Obsidian: o índice que o plugin lê antes de baixar as notas.
 *
 * Cada documento vira um arquivo Markdown determinístico; o `sha256` é o dos bytes UTF-8 da nota
 * gerada, e é o que o plugin compara para não reescrever o que não mudou.
 */
import type { Id } from './tipos';

export type MarcasDaExportacao = 'minhas' | 'todas';

export interface DocumentoDoIndiceObsidianV1 {
  documento_id: Id;
  versao_id: Id;
  titulo: string;
  arquivo: string;
  sha256: string;
  itens: number;
  atualizado_em: string;
}

export interface IndiceObsidianV1 {
  versao: 1;
  url_base: string;
  marcas: MarcasDaExportacao;
  documentos: DocumentoDoIndiceObsidianV1[];
}

/** Um documento por entrada e um arquivo por documento (o vault não distingue maiúsculas em todo sistema). */
export function regrasIndiceObsidian(indice: IndiceObsidianV1): boolean {
  const ids = new Set(indice.documentos.map((documento) => documento.documento_id));
  const arquivos = new Set(indice.documentos.map((documento) => documento.arquivo.toLowerCase()));
  return ids.size === indice.documentos.length && arquivos.size === indice.documentos.length;
}
