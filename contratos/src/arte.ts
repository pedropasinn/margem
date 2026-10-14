/** Contratos específicos de obras visuais. A imagem, não o roteiro, define as coordenadas. */
export interface RetanguloDaObra { x: number; y: number; largura: number; altura: number }
export type FormaDaRegiao =
  | ({ tipo: 'bbox' } & RetanguloDaObra)
  | { tipo: 'ponto'; x: number; y: number }
  | { tipo: 'poligono'; pontos: { x: number; y: number }[] };
export type TipoDeAfirmacaoDaObra = 'observacao' | 'fato' | 'interpretacao_documentada' | 'inferencia_ia' | 'intencao_desconhecida';
export interface FonteDaObra {
  id: string; titulo: string; url: string;
  /** `imagem_enviada` (V-W5): a própria imagem que a pessoa enviou, única fonte de uma obra não identificada. */
  categoria: 'instituicao_proprietaria' | 'museu' | 'catalogo' | 'academica' | 'arquivo' | 'leilao' | 'google_arts' | 'secundaria' | 'popular' | 'imagem_enviada';
  consultado_em: string;
}
export interface AfirmacaoDaObra {
  id: string; texto: string; tipo: TipoDeAfirmacaoDaObra; confianca: 'alta' | 'media' | 'baixa' | 'nao_aplicavel';
  evidencia: string; fontes: string[]; regioes: string[]; apoios: string[];
  proveniencia: { autor: 'curadoria' | 'ia'; metodo: string };
}
export interface RegiaoDaObra { id: string; rotulo: string; imagem_sha256: string; forma: FormaDaRegiao }
export type TemaDaObra = 'composicao' | 'iconografia' | 'tecnica' | 'historia' | 'artista' | 'contexto' | 'interpretacoes' | 'obras_relacionadas';
export interface ModeloDaObraV1 {
  versao: 1; id: string; revisao: number;
  identidade: { titulo: string; titulo_original: string; artista: string; data: string; tecnica: string; afirmacoes: string[] };
  imagem: { url: string; sha256: string; largura: number; altura: number; credito: string; fonte_id: string };
  localizacao: { instituicao_proprietaria: string | null; localizacao_conhecida: string | null; atualmente_exposto: boolean | null; sala: string | null; verificado_em: string; fontes: string[] };
  fontes: FonteDaObra[]; regioes: RegiaoDaObra[]; afirmacoes: AfirmacaoDaObra[];
  estudo: { tema: TemaDaObra; afirmacoes: string[] }[]; limites: string[];
}
export interface BatidaVisual {
  inicio_s: number; fim_s: number; narracao: string; legenda: string;
  papel: 'abertura' | 'evidencia_visual' | 'contexto' | 'interpretacao' | 'fechamento';
  afirmacoes: string[]; regiao_id: string | null;
  camera: { de: RetanguloDaObra; para: RetanguloDaObra };
}
export interface AnaliseCurtaDaObraV1 {
  versao: 1; obra_id: string; revisao_modelo: number; imagem_sha256: string;
  tese: string; afirmacoes_da_tese: string[]; tempo: 'estimado'; batidas: BatidaVisual[];
}
/** Índices locais são resolvidos pelo serviço; o modelo não fabrica IDs persistentes. */
export interface AnaliseDaObraGeradaV1 {
  regioes: { rotulo: string; forma: FormaDaRegiao }[];
  afirmacoes: { texto: string; tipo: TipoDeAfirmacaoDaObra; confianca: AfirmacaoDaObra['confianca']; evidencia: string; fontes: string[]; regioes: number[]; apoios: number[] }[];
  estudo: { tema: TemaDaObra; afirmacoes: number[] }[]; limites: string[];
}
