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

// ------------------------------------------------------------------ V2: uma nota por item

/**
 * Formato V2 da exportação (v0.1): uma pasta por documento, com a nota-índice (o mesmo nome e os
 * mesmos blocos `^margem-<id>` da nota V1, para os links antigos continuarem valendo) e uma nota por
 * grifo, anotação, pergunta, relação, flashcard e exercício, nas subpastas. Cada nota tem
 * `margem_esquema: 2`, `margem_tipo` e `margem_id` no frontmatter: é o `margem_id` que permite
 * reexportar sem duplicar (o caminho é só uma dica). O formato das notas está em
 * `servico/src/obsidian/FORMATO.md`.
 */
export type TipoDeNotaDoObsidian = 'documento' | 'grifo' | 'anotacao' | 'pergunta' | 'relacao' | 'flashcard' | 'exercicio';
export const TIPOS_DE_NOTA_DO_OBSIDIAN: readonly TipoDeNotaDoObsidian[] = ['documento', 'grifo', 'anotacao', 'pergunta', 'relacao', 'flashcard', 'exercicio'];
/** A subpasta de cada tipo de nota dentro da pasta do documento (a nota-índice fica na raiz dela). */
export const PASTAS_DO_OBSIDIAN: Readonly<Record<Exclude<TipoDeNotaDoObsidian, 'documento'>, string>> = {
  grifo: 'Grifos', anotacao: 'Anotações', pergunta: 'Perguntas', relacao: 'Relações', flashcard: 'Flashcards', exercicio: 'Exercícios',
};

export interface NotaDoIndiceObsidianV2 {
  /** O `margem_id` da nota: o ULID do item (ou do documento, na nota-índice). */
  id: Id;
  tipo: TipoDeNotaDoObsidian;
  documento_id: Id;
  /** Relativo à pasta da exportação: `<documento>/<documento>.md` ou `<documento>/<Subpasta>/<nota>.md`. */
  caminho: string;
  sha256: string;
  atualizado_em: string;
}

export interface IndiceObsidianV2 {
  versao: 2;
  url_base: string;
  marcas: MarcasDaExportacao;
  /** Os tipos de nota exportados. */
  incluir: TipoDeNotaDoObsidian[];
  notas: NotaDoIndiceObsidianV2[];
}

/**
 * Ids e caminhos únicos (sem distinguir maiúsculas); cada documento com exatamente uma nota-índice,
 * cujo id é o do documento, na raiz da pasta dele; cada item numa subpasta do seu tipo, na mesma
 * pasta da nota-índice do seu documento.
 */
export function regrasIndiceObsidianV2(indice: IndiceObsidianV2): boolean {
  const ids = new Set(indice.notas.map((nota) => nota.id));
  const caminhos = new Set(indice.notas.map((nota) => nota.caminho.toLowerCase()));
  if (ids.size !== indice.notas.length || caminhos.size !== indice.notas.length) return false;
  const pastaDo = new Map<Id, string>();
  for (const nota of indice.notas) {
    if (nota.tipo !== 'documento') continue;
    const partes = nota.caminho.split('/');
    if (nota.id !== nota.documento_id || partes.length !== 2 || pastaDo.has(nota.documento_id)) return false;
    pastaDo.set(nota.documento_id, partes[0] ?? '');
  }
  for (const nota of indice.notas) {
    const partes = nota.caminho.split('/');
    const pasta = pastaDo.get(nota.documento_id);
    if (pasta === undefined || partes[0] !== pasta) return false;
    if (nota.tipo !== 'documento' && (partes.length !== 3 || partes[1] !== PASTAS_DO_OBSIDIAN[nota.tipo])) return false;
  }
  return true;
}
