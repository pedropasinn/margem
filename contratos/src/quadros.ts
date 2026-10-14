/**
 * Quadros da pessoa (J118): o Margem não distribui acervo. A pessoa envia a imagem de uma obra
 * (`POST /api/arte`, multipart) e o worker prepara a análise guiada pela fila (`preparar_quadro`).
 *
 * - `IdentificacaoDaObraV1`: título, artista e ano. Corpo de `PUT /api/arte/:slug/identificacao`.
 * - `QuadroDaPessoaV1`: a obra enquanto é preparada (em `preparando` de `GET /api/arte`).
 */
import type { Id } from './tipos';

export interface IdentificacaoDaObraV1 {
  titulo: string;
  artista: string;
  ano?: string | null;
}

export type EstadoDoQuadroDaPessoa = 'na_fila' | 'preparando' | 'pronto' | 'falhou';
export type EtapaDoQuadroDaPessoa = 'imagem' | 'identificacao' | 'dossie' | 'analise' | 'narracao';
export type FormatoDaImagemDoQuadro = 'jpeg' | 'png' | 'webp';

export interface QuadroDaPessoaV1 {
  versao: 1;
  id: Id;
  /** A pasta `<dados>/quadros/<slug>/` e o endereço `/quadros/<slug>`. */
  slug: string;
  estado: EstadoDoQuadroDaPessoa;
  etapa: EtapaDoQuadroDaPessoa | null;
  progresso: { feitas: number; total: number } | null;
  /** `null` enquanto ninguém identificou a obra (a pessoa não informou e o Codex ainda não propôs). */
  /** `acervo` (V-W5): a imagem é a de uma obra de exemplo do Margem, reconhecida pelo SHA-256, sem o Codex. */
  identificacao: { titulo: string; artista: string; ano: string | null; origem: 'pessoa' | 'codex' | 'acervo'; confianca?: 'alta' | 'media' | 'baixa' } | null;
  /**
   * V-W5: o que o Codex disse quando não reconheceu a obra (a análise segue só pela imagem). É palpite,
   * não identificação: título e artista, quando vêm, servem para a pessoa confirmar.
   */
  palpite?: { texto: string; titulo: string | null; artista: string | null; ano: string | null; confianca: 'alta' | 'media' | 'baixa' };
  imagem: { formato: FormatoDaImagemDoQuadro; bytes: number; nome?: string };
  enviado_em: string;
  /** Algo que não impede a preparação (ex.: cota do Codex esgotada, volta mais tarde). */
  aviso?: string;
  /** Só quando `estado` é `falhou`: o que deu errado, numa frase para a pessoa. */
  erro?: { codigo: string; mensagem: string };
}

/**
 * `erro` existe só na falha; pronto e na fila não têm etapa nem progresso; preparando tem etapa;
 * o progresso nunca passa do total; a confiança só vem com a proposta do Codex.
 */
export function regrasQuadroDaPessoa(valor: QuadroDaPessoaV1): boolean {
  if ((valor.erro !== undefined) !== (valor.estado === 'falhou')) return false;
  if ((valor.estado === 'pronto' || valor.estado === 'na_fila') && (valor.etapa !== null || valor.progresso !== null)) return false;
  if (valor.estado === 'preparando' && valor.etapa === null) return false;
  if (valor.progresso !== null && valor.progresso.feitas > valor.progresso.total) return false;
  if (valor.identificacao?.confianca !== undefined && valor.identificacao.origem !== 'codex') return false;
  return true;
}
