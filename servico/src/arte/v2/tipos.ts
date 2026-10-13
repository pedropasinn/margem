/** Saídas de cada etapa do algoritmo v2 (espelham `prompts/arte-*@2.schema.json`). */
import type { FormaDaRegiao, TemaDaObra, TipoDeAfirmacaoDaObra } from '@margem/contratos';

export type Confianca = 'alta' | 'media' | 'baixa' | 'nao_aplicavel';
export type Enquadramento = 'inteiro' | 'meio' | 'detalhe';
export type PapelDaBatida = 'abertura' | 'evidencia_visual' | 'contexto' | 'interpretacao' | 'fechamento';

export interface LeituraVisual {
  descricao: string;
  composicao: string;
  luz_e_cor: string;
  objetos: { rotulo: string; descricao: string; x: number; y: number; largura: number; altura: number; saliencia: 'alta' | 'media' | 'baixa' }[];
  relacoes: { objetos: number[]; relacao: string }[];
  incertezas: string[];
}

export interface AfirmacaoCandidata {
  texto: string;
  tipo: TipoDeAfirmacaoDaObra;
  dimensao: TemaDaObra;
  confianca: Confianca;
  evidencia: string;
  fontes: string[];
  citacoes: { fonte: string; trecho: string }[];
  regioes: number[];
  apoios: number[];
  /** Só no serviço: afirmação verificada da pesquisa curada, transportada para o modelo sem passar pelo Codex. */
  origem?: 'curadoria';
}

export interface ModeloCandidato {
  regioes: { rotulo: string; objeto: number | null; forma: FormaDaRegiao }[];
  afirmacoes: AfirmacaoCandidata[];
  teses: { texto: string; afirmacoes: number[]; gancho: string; por_que_interessa: string }[];
  limites: string[];
}

export interface RevisaoDoModelo {
  regioes: { indice: number; veredito: 'manter' | 'ajustar' | 'cortar'; forma: FormaDaRegiao | null; motivo: string }[];
  afirmacoes: { indice: number; veredito: 'manter' | 'corrigir' | 'cortar'; texto: string | null; tipo: TipoDeAfirmacaoDaObra | null; confianca: Confianca | null; evidencia: string | null; motivo: string }[];
  tese: { indice: number; texto: string; motivo: string };
}

export interface RoteiroCandidato {
  tese: string;
  afirmacoes_da_tese: number[];
  gancho: 'detalhe' | 'contraste' | 'pergunta' | 'cena' | 'paradoxo';
  batidas: { papel: PapelDaBatida; narracao: string; afirmacoes: number[]; regiao: number | null; enquadramento: Enquadramento; novidade: string }[];
}

/** Um diagnóstico das conferências determinísticas: `grave` bloqueia; `aviso` só registra. */
export interface Diagnostico { codigo: string; gravidade: 'grave' | 'aviso'; detalhe: string }
