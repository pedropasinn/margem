/** A revista é uma síntese própria; evidências apontam às fontes, nunca viram âncoras de paráfrases. */
export interface FonteDaNoticiaV1 {
  url: string; titulo: string; publicada_em: string | null; texto: string;
  sha256: string; acesso: 'pagina' | 'feed';
}
export interface CoberturaDeNoticiasV1 {
  nome: string; url: string; estado: 'ok' | 'parcial' | 'falhou';
  candidatos: number; lidos: number; limite: string;
}
export interface MateriaDaNoticiaV1 {
  titulo: string; resumo: string; importancia: string;
  projeto: 'Margem' | 'Gibraltar' | 'Series' | 'Geral';
  natureza: 'novidade' | 'atualizacao' | 'repertorio';
  evidencias: { fonte_url: string; citacao: string }[];
  limite: string;
}
export interface EditorialDeNoticiasV1 {
  titulo: string; abertura: string; roteiro: string; noticias: MateriaDaNoticiaV1[];
}
export interface EdicaoDeNoticiasV1 extends EditorialDeNoticiasV1 {
  versao: 1; corte_em: string; foco: 'ia_aplicada';
  fontes: FonteDaNoticiaV1[]; cobertura: CoberturaDeNoticiasV1[];
}
export interface CapaDeNoticiasV1 {
  sha256: string; sha256_edicao: string; descricao: string;
  largura: number; altura: number; bytes: number;
}
export interface ItemDoHubDeNoticias {
  id: string; dia: string; conteudo: EdicaoDeNoticiasV1 | null; documento_id: string | null;
  estado: 'fila' | 'reservado' | 'adiado' | 'ok' | 'falhou' | 'cancelado';
  diagnostico: string | null;
  audio: { duracao_s: number; sha256_roteiro: string } | null;
  estado_audio: string | null;
  capa: CapaDeNoticiasV1 | null;
  estado_capa: string | null;
}
export interface HubDeNoticiasV1 {
  edicoes: ItemDoHubDeNoticias[];
  agenda: { ativa: boolean; hora: number; fuso: 'America/Sao_Paulo'; foco: 'ia_aplicada' };
}
