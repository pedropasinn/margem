/** Espelho do que `servico/src/http/rotas-arte.ts` devolve. */
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1, QuadroDaPessoaV1 } from '@margem/contratos';

export type { QuadroDaPessoaV1 } from '@margem/contratos';

export interface ResumoDaAnalise {
  rotulo: string;
  titulo: string;
  origem: 'esperado' | 'geracao';
  publicada: boolean;
  audio: boolean;
  atualizada_em: string;
}

/** Um quadro na Biblioteca. */
export interface ResumoDoQuadro {
  slug: string;
  titulo: string;
  titulo_original: string;
  artista: string;
  data: string;
  ano: string | null;
  tecnica: string;
  largura: number;
  altura: number;
  imagem: string;
  miniatura: string;
  adicionado_em: string;
  analises: ResumoDaAnalise[];
  /** Uma das duas obras de exemplo do repositório (não conta como obra da pessoa). */
  exemplo?: boolean;
  /** Obra que a pessoa adicionou: pode ser removida e ter a identificação corrigida (J118). */
  removivel?: boolean;
  /** V-W5: a análise publicada é só pela imagem (o Codex não reconheceu a obra). */
  nao_identificada?: true;
  /** O que o Codex disse ao não reconhecer a obra: palpite, nunca identificação. */
  palpite?: PalpiteDaObra;
}

/** O palpite do Codex sobre uma obra que ele não reconheceu (o mesmo de `QuadroDaPessoaV1.palpite`). */
export type PalpiteDaObra = NonNullable<QuadroDaPessoaV1['palpite']>;

/**
 * `GET /api/arte`: as obras prontas e, em `preparando`, as que a pessoa adicionou e ainda estão na
 * fila, sendo preparadas ou com falha (J118). O Margem não distribui acervo.
 */
export interface ListaDeQuadros { obras: ResumoDoQuadro[]; preparando?: QuadroDaPessoaV1[] }

export interface InfoDaImagem {
  origem_url: string | null; arquivo_url: string | null; licenca: string | null; credito: string | null;
  sha256: string | null; largura: number | null; altura: number | null; baixado_em: string | null;
}

export interface AnaliseDoQuadro {
  rotulo: string;
  titulo: string;
  origem: 'esperado' | 'geracao';
  audio: boolean;
  /** A rota da imagem no serviço (o `modelo.imagem.url` do contrato é `/arte/<slug>.jpg`, não usado pelo app). */
  imagem: string;
  modelo: ModeloDaObraV1;
  curta: AnaliseCurtaDaObraV1;
}

export interface DetalheDoQuadro {
  slug: string;
  origem: 'acervo' | 'fixture';
  adicionado_em: string;
  imagem: { url: string; miniatura: string; info: InfoDaImagem | null };
  analises: ResumoDaAnalise[];
  analise: AnaliseDoQuadro;
  /** Obra que a pessoa adicionou (pode ter título e artista informados depois). */
  removivel?: boolean;
  nao_identificada?: true;
  palpite?: PalpiteDaObra;
}

/** `audio/<rotulo>/manifesto.json` (`docs/arte/QUADROS-PLANO.md`, "Áudio"). */
export interface ManifestoDaNarracao {
  versao: 1;
  analise: string;
  curta_sha256: string;
  voz: { perfil: string; modelo: string; seed: number };
  arquivo: string;
  duracao_s: number;
  batidas: { indice: number; inicio_s: number; fim_s: number; texto: string; palavras: { texto: string; inicio_s: number; fim_s: number }[] }[];
}
