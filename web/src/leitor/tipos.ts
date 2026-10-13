import type { MarcaDoLeitor } from './f2';
import type { AncoraV1, Bloco, Id, Secao } from '@margem/contratos';

/**
 * Tudo o que o leitor precisa para desenhar um capítulo: a seção, seus blocos em ordem,
 * as marcas daquela versão e a tabela de assets já resolvida em URLs pelo chamador.
 * O SPEC chama os tipos de `SecaoV1`/`BlocoV1`; os contratos os nomeiam `Secao` e `Bloco`.
 */
export interface SnapshotCapitulo extends DadosF2 {
  palavras_no_livro?: { antes: number; total: number };
  formato?: string;
  paginas?: { inicio: number; fim: number } | null;
  geometria_disponivel?: boolean;
  versao_id: Id;
  /** Idioma do documento (BCP-47), para a hifenização do texto justificado. */
  idioma?: string;
  secao: Secao;
  blocos: Bloco[];
  marcas: MarcaDoLeitor[];
  assets: Record<Id, string>;
  formatacao?: Record<Id, FormatoDaFonte>;
  ilustracoes?: { bloco_id: string; url: string; alt: string; posicao: 'antes' | 'depois'; largura?: number; altura?: number }[];
  /** Leitura guiada: as marcas do passo ficam acesas, as outras recuam; `ativa` é a que a barra aponta. */
  guia?: GuiaDoPasso | null;
}

export interface GuiaDoPasso { marcas: readonly Id[]; ativa: Id | null }

/** F1 só tem rolagem; `columns` entra depois sem mudar texto nem identificadores. */
export type EstrategiaDeLayout = 'scroll';

/** Identidade textual de uma posição de leitura: bloco mais deslocamento UTF-16. */
export interface PontoDeTexto {
  bloco_id: Id;
  offset_utf16: number;
}

/** Superfície imperativa do leitor, exposta por `ref` (J09 usa para retomada e margem). */
export interface ApiDoLeitor {
  localizar(blocoId: Id, offsetUtf16: number): DOMRect | null;
  ancoraVisivel(): PontoDeTexto | null;
  retangulosDaAncora?(ancora: AncoraV1): DOMRect[];
  selecao?(selecao: Selection | null): import('./selecao').SelecaoDoLeitor | null;
  /**
   * Só no PDF: o trecho de texto sob uma área da página (em frações dela), pelas palavras da geometria —
   * o bloco com mais palavras na área, do começo da primeira ao fim da última. `null` sem texto (imagem).
   */
  ancoraDaArea?(pagina: number, area: { x: number; y: number; largura: number; altura: number }): AncoraV1 | null;
  /** Só no PDF: o que a dobra do braquete precisa para recortar o original (veja `pdf-recortes.ts`). */
  dobraPdf?: DobraDoPdf;
}

/**
 * A dobra do braquete no PDF lê do leitor uma verdade geométrica só. São três coisas:
 * - as regiões de uma âncora, em pixels da página na escala do leitor;
 * - a renderização prévia das páginas pelo PDF.js;
 * - o recorte já pronto: a página inteira deslocada, com as mesmas marcas.
 */
export interface DobraDoPdf {
  regioes(ancora: AncoraV1): import('./pdf-recortes').RegiaoPdf[];
  preparar(recortes: readonly import('./pdf-recortes').RecortePdf[]): Promise<void>;
  recorte(recorte: import('./pdf-recortes').RecortePdf): import('react').ReactNode;
  /** Onde a página está na tela agora (canto superior esquerdo), a mesma base das marcas do leitor. */
  origemDaPagina(pagina: number): { x: number; y: number } | null;
}

export interface DadosF2 {
  camada?: string;
  camadas?: import('./f2').CamadaResumida[];
  precedencia?: string[];
  anotacoes?: import('@margem/contratos').AnotacaoV1[];
  conversas?: import('./f2').ResumoConversa[];
  conexoes?: import('@margem/contratos').ConexaoV2[];
  primeiro_eu?: { ativo: boolean; liberado: boolean };
  modos?: import('@margem/contratos').ModoDeLeituraV1[];
  tracosPessoais?: import('./f2').TracoPessoal[];
  /** J37: o que o leitor mudou nas marcas da IA (função e nota originais), por marca. */
  edicoes?: Record<string, { funcao_da_ia?: string; comentario_da_ia?: import('@margem/contratos').MarcaV2['comentario'] }>;
  /** J37: etiquetas "?" (tipos de dificuldade) do leitor sobre marcas e anotações. */
  etiquetas?: import('@margem/contratos').EtiquetaV1[];
  /** J37: notas do leitor que o Codex está revisando. */
  revisoes_pendentes?: string[];
}

/** Formatação visual da fonte que não altera os caracteres nem os offsets canônicos. */
export interface FormatoDaFonte {
  marcador?: string;
  inline: { inicio: number; fim: number; estilo: 'sobrescrito' | 'subscrito' }[];
}
