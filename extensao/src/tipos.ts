/** Tipos compartilhados entre o extrator (na página), o fundo (service worker) e as telas. */

/** O que foi capturado de uma aba, pronto para a prévia e para o envio. */
export type Captura = CapturaDeTexto | CapturaDePdf;

export interface CapturaDeTexto {
  tipo: 'pagina' | 'selecao';
  titulo: string;
  autor?: string;
  site?: string;
  url: string;
  /** RFC 3339 com fuso, ou AAAA-MM-DD. */
  publicado_em?: string;
  /** Corpo em Markdown, sem frontmatter (quem escreve o frontmatter é a API do Margem). */
  markdown: string;
  palavras: number;
  previa: string;
}

export interface CapturaDePdf {
  tipo: 'pdf';
  titulo: string;
  site?: string;
  url: string;
}

/** Corpo de `POST /api/importacoes/web` (contrato ImportacaoWebV1 do Margem). */
export interface ImportacaoWeb {
  markdown: string;
  titulo: string;
  autor?: string;
  site?: string;
  url_origem: string;
  publicado_em?: string;
  capturado_em?: string;
  trecho?: boolean;
}

export interface Configuracao {
  /** Endereço da API, sem barra final. */
  servidor: string;
  /** Token opcional; vai em `X-Margem` e em `Authorization: Bearer`. */
  token: string;
}

export interface Enviado {
  documento_id: string;
  /** Endereço do documento no leitor do Margem. */
  endereco: string;
}

/** Resultado de uma operação do fundo, sempre serializável. */
export type Resposta<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Mensagens das telas para o fundo. */
export type Pedido =
  | { tipo: 'capturar'; aba: number; modo?: 'pagina' | 'selecao' }
  | { tipo: 'enviar'; captura: Captura; aba: number; abrir: boolean }
  | { tipo: 'testar'; configuracao: Configuracao };
