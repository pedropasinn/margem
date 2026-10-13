import type { MarcaDoLeitor } from '../leitor/f2';
import type { DadosF2, FormatoDaFonte } from '../leitor/tipos';
import type { Bloco, Id, ProgressoV1, Secao } from '@margem/contratos';

/** Espelho dos tipos que a API devolve (`servico/src/http/consultas.ts`). */
export type EstadoDoDocumento =
  | 'sem_texto' | 'canonizando' | 'transcrevendo' | 'pronto' | 'marcando' | 'revisando' | 'falhou';

/** Uma função contada: chave, rótulo do modo da marca e quantas o leitor mostra (J107). */
export interface FuncaoContada {
  funcao: string;
  rotulo: string;
  quantidade: number;
}

/** As marcas que o leitor mostra na última versão; `por_funcao` vale para todos os modos (J107). */
export interface ContagemDeMarcas {
  /** Na ordem do modo, sem as zeradas; ausente nas APIs anteriores ao J107. */
  por_funcao?: FuncaoContada[];
  /** Os campos de F1 (`argumentativa`), do mesmo recorte. */
  tese: number;
  conceito: number;
  justificativa: number;
  nenhuma: number;
  total: number;
}

export interface ItemDaBiblioteca {
  id: Id;
  titulo: string;
  autor: string | null;
  formato: string;
  criado_em: string;
  arquivado_em?: string | null;
  versao_id: Id | null;
  texto_disponivel: boolean;
  estado: EstadoDoDocumento;
  detalhe: string | null;
  partes_prontas: number;
  partes_total: number;
  marcas: ContagemDeMarcas;
  progresso: { capitulos_concluidos: number; atualizado_em: string } | null;
  jobs_em_curso: number;
  /** Vídeo ou áudio com transcrição (J71); ausente nas APIs antigas e `null` nos textos. */
  midia?: { tipo: 'video' | 'audio'; duracao_s: number; fonte_url: string | null } | null;
}

/** "Vídeo · 43 min" para quem tem mídia; o formato do arquivo para os textos. */
/**
 * O ícone de cada tipo de documento (Player v2, 1b): vídeo e áudio pela mídia, PDF pelo formato (distinto
 * do texto, mesmo quando é um livro), livro quando há mais de um capítulo, e texto (Markdown, TXT, colado).
 */
export function iconeDoDocumento(item: Pick<ItemDaBiblioteca, 'formato' | 'midia'>, capitulos?: number): string {
  if (item.midia) return item.midia.tipo === 'video' ? 'video-doc' : 'ouvir';
  if (item.formato === 'pdf') return 'pdf';
  return capitulos !== undefined && capitulos > 1 ? 'livro' : 'texto';
}

/** O tipo com o ícone e o nome, para o Info, a página do documento e o painel da biblioteca. */
export function tipoDoDocumento(item: Pick<ItemDaBiblioteca, 'formato' | 'midia'>, capitulos?: number): { icone: string; rotulo: string } {
  const icone = iconeDoDocumento(item, capitulos);
  const rotulo = item.midia ? (item.midia.tipo === 'video' ? 'Vídeo' : 'Áudio') : item.formato === 'pdf' ? (capitulos !== undefined && capitulos > 1 ? 'PDF · livro' : 'PDF') : capitulos !== undefined && capitulos > 1 ? 'Livro' : 'Texto';
  return { icone, rotulo };
}

/** O verbo da ação principal: vídeo se assiste, áudio se ouve, o resto se lê. */
export function verboDoDocumento(item: Pick<ItemDaBiblioteca, 'midia'>): 'Ler' | 'Assistir' | 'Ouvir' {
  return item.midia ? (item.midia.tipo === 'video' ? 'Assistir' : 'Ouvir') : 'Ler';
}

export function rotuloDoDocumento(item: Pick<ItemDaBiblioteca, 'formato' | 'midia'>, formatos: Readonly<Record<string, string>>): string {
  if (item.midia) return `${item.midia.tipo === 'video' ? 'Vídeo' : 'Áudio'} · ${String(Math.max(1, Math.round(item.midia.duracao_s / 60)))} min`;
  return formatos[item.formato] ?? item.formato.toUpperCase();
}

export interface VersaoResumida {
  id: Id;
  numero: number;
  criado_em: string;
  motor: string;
  hash_estrutural: string;
  blocos: number;
  secoes: number;
  assets: number;
  limites: string[];
}

export interface JobResumido {
  id: Id;
  tipo: string;
  estado: string;
  attempt: number;
  not_before: string | null;
  error_code: string | null;
  atualizado_em: string;
}

export interface ExecucaoResumida {
  id: Id;
  versao_id: Id;
  modelo: string;
  esforco: string;
  criada_em: string;
  partes_total: number;
  partes_prontas: number;
}

export interface ExportacaoResumida {
  id: Id;
  tipo: string;
  criada_em: string;
  sha256: string;
}

export interface DetalheDoDocumento extends ItemDaBiblioteca {
  /** Páginas da última versão sem camada de texto (PDF escaneado). */
  paginas_sem_texto?: number;
  versoes: VersaoResumida[];
  execucoes: ExecucaoResumida[];
  jobs: JobResumido[];
  exportacoes: ExportacaoResumida[];
}

export interface NoDaArvore {
  id: Id;
  titulo: string;
  nivel: number;
  ordem: number;
  bloco_inicio: Id;
  bloco_fim: Id;
  filhos: NoDaArvore[];
}

export interface ArvoreDaVersao {
  versao_id: Id;
  documento_id: Id;
  titulo: string;
  secoes: NoDaArvore[];
  capitulos: { id: Id; titulo: string }[];
  limites: string[];
}

export interface PerguntasDaSecao {
  secao_id: Id;
  perguntas: string[];
}

export interface SnapshotDoCapitulo extends DadosF2 {
  palavras_no_livro?: { antes: number; total: number };
  formato?: string;
  paginas?: { inicio: number; fim: number } | null;
  geometria_disponivel?: boolean;
  versao_id: Id;
  idioma?: string;
  documento_id: Id;
  secao: Secao;
  blocos: Bloco[];
  marcas: MarcaDoLeitor[];
  assets: Record<Id, string>;
  formatacao?: Record<Id, FormatoDaFonte>;
  ilustracoes?: { bloco_id: string; url: string; alt: string; posicao: 'antes' | 'depois'; largura?: number; altura?: number }[];
  revisao_marcas: string;
  recuperacao: PerguntasDaSecao[];
  anterior: Id | null;
  proxima: Id | null;
}

export interface ProgressoPersistido extends Omit<ProgressoV1, 'revisao_esperada'> {
  revisao: number;
}

/** Um bloco achado pela busca no texto (`GET /api/busca`, `GET /api/documentos/:id/busca`). */
export interface ResultadoDaBusca {
  documento_id: string;
  titulo: string;
  autor: string | null;
  formato: string;
  versao_id: string;
  capitulo: { id: string; titulo: string } | null;
  bloco_id: string;
  pagina: number | null;
  /** Os termos achados, em offsets UTF-16 no texto do bloco. */
  ocorrencias: { inicio_utf16: number; fim_utf16: number }[];
  /** O recorte em volta da primeira ocorrência, com os termos marcados. */
  trecho: { texto: string; marcado: boolean }[];
}
export interface RespostaDaBusca { consulta: string; total: number; resultados: ResultadoDaBusca[]; proximo: number | null }

/** Uma anotação ou um grifo do leitor na tela "Notas" (`servico/src/notas/listar.ts`). */
export interface ItemDeNota {
  id: Id;
  especie: 'anotacao' | 'grifo';
  tipo: string;
  rotulo: string;
  cor: { claro: string; escuro: string } | null;
  citacao: string;
  nota: string | null;
  marca_id: Id | null;
  documento: { id: Id; titulo: string; autor: string | null };
  versao_id: Id;
  bloco_id: Id;
  capitulo: { id: Id; titulo: string } | null;
  pagina: string | null;
  /** `/ler/<documento>/<capítulo>?bloco=<bloco>`. */
  link: string;
  criada_em: string;
  atualizada_em: string;
}
