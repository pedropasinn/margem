/**
 * Página "Perguntar": conversa com o agente que lê a biblioteca inteira (pacote agente, noite 2).
 *
 * Só tipos: o serviço monta e confere tudo (citações literais resolvidas por ele, Mermaid pela régua
 * do core); nada disto vem cru do modelo. Persistência em `0021_agente.sql`.
 */
import type { AncoraV1, Id } from './tipos';
import type { NoDoDiagramaV1 } from './visual';

/** Uma citação conferida: o trecho existe literalmente, uma só vez, no bloco da versão atual do documento. */
export interface CitacaoDoAgenteV1 {
  /** Marcador usado no texto da resposta (`[c1]`). */
  ref: string;
  documento_id: Id;
  /** Título do documento e do capítulo, para a lista de fontes. */
  documento: string;
  capitulo: string | null;
  /** Seção de nível 1 em que o bloco está; leva a `/ler/<documento>/<secao>?bloco=<bloco>`. */
  secao_id: Id | null;
  ancora: AncoraV1;
}

/** Capítulo a que um artefato se refere (quando se refere a um só). */
export interface CapituloDoArtefatoV1 { documento_id: Id; versao_id: Id; secao_id: Id; titulo: string; documento: string }

export type ArtefatoDoAgenteV1 =
  | { tipo: 'mapa'; titulo: string; codigo: string; nos: NoDoDiagramaV1[]; capitulo: CapituloDoArtefatoV1 | null; visual_id?: Id }
  | { tipo: 'resumo' | 'quadro' | 'conceitos'; titulo: string; markdown: string; capitulo: CapituloDoArtefatoV1 | null };

export type TipoDoArtefatoDoAgente = ArtefatoDoAgenteV1['tipo'];

/** Estado de uma pergunta do leitor, vindo do job que a responde. */
export type EstadoDaPerguntaV1 = 'na_fila' | 'pensando' | 'respondida' | 'falhou';

export interface MensagemDoAgenteV1 {
  id: Id;
  /** J101: `leitor` (era `pedro`); tipo só de API, sem schema publicado. */
  autor: 'leitor' | 'agente';
  /** Pergunta (texto puro) ou resposta (Markdown sem HTML; `[c1]` marca as citações). */
  texto: string;
  citacoes: CitacaoDoAgenteV1[];
  artefatos: ArtefatoDoAgenteV1[];
  diagnosticos: { codigo: string; mensagem: string }[];
  execucao?: { modelo: string; esforco: string; duracao_ms: number };
  /** Só nas perguntas. */
  estado?: EstadoDaPerguntaV1;
  motivo?: string;
  aviso?: string;
  criada_em: string;
}

export interface ConversaDoAgenteV1 {
  id: Id;
  titulo: string;
  criada_em: string;
  atualizada_em: string;
}
