/**
 * Visual ancorado (J70): uma imagem ou um fluxograma que o Codex gera a pedido do leitor,
 * ligado a um trecho (seleção), a um bloco inteiro (a estrofe, o parágrafo) ou ao capítulo.
 *
 * O estado é o do job da fila (o serviço o deriva na leitura); o artefato só existe pronto.
 */
import { diagnostico, type DiagnosticoContrato } from './contrato';
import type { AncoraV1, Id } from './tipos';

export type TipoDoVisual = 'imagem' | 'diagrama';
export type EstadoDoVisual = 'pendente' | 'executando' | 'pronto' | 'falhou';
export type AlvoDoVisual =
  | { tipo: 'trecho'; ancora: AncoraV1 }
  | { tipo: 'bloco'; ancora: AncoraV1 }
  | { tipo: 'capitulo' };

export interface NoDoDiagramaV1 { id: string; rotulo: string; ancora?: AncoraV1 }
export interface ImagemDoVisualV1 { tipo: 'png'; sha256: string; bytes: number; largura: number; altura: number; descricao: string }
export interface DiagramaDoVisualV1 { tipo: 'mermaid'; codigo: string; titulo: string; nos: NoDoDiagramaV1[] }

export interface VisualV1 {
  versao: 1;
  id: Id;
  versao_id: Id;
  /** Seção de nível 1 (o capítulo) em que o visual mora; para o alvo `capitulo`, o próprio alvo. */
  secao_id: Id;
  tipo: TipoDoVisual;
  alvo: AlvoDoVisual;
  /** O que o leitor escreveu junto com o trecho. */
  pedido?: string;
  estado: EstadoDoVisual;
  /** Só em `falhou`: o porquê, legível. */
  motivo?: string;
  /** Só em `pronto`. */
  artefato?: ImagemDoVisualV1 | DiagramaDoVisualV1;
  /** Citações que o serviço não conseguiu ancorar, Mermaid corrigido na segunda tentativa etc. */
  diagnosticos: { codigo: string; mensagem: string }[];
  /** A versão anterior, quando este é um "gerar de novo". */
  substitui?: Id;
  execucao?: { modelo: string; esforco: string };
  criado_em: string;
  atualizado_em: string;
}

/** Cabeçalho obrigatório do fluxograma: vertical, de cima para baixo. */
export const CABECALHO_DO_FLUXOGRAMA = 'flowchart TD';

/** Primeira linha que não é comentário nem vazia. */
export function cabecalhoDoMermaid(codigo: string): string | undefined {
  return codigo.split('\n').map((linha) => linha.trim()).find((linha) => linha !== '' && !linha.startsWith('%%'));
}

export function regrasVisual(v: VisualV1): DiagnosticoContrato[] {
  const erros: DiagnosticoContrato[] = [];
  if (v.alvo.tipo !== 'capitulo') {
    if (v.alvo.ancora.versao_id !== v.versao_id) erros.push(diagnostico('alvo_de_outra_versao', 'A âncora do alvo é de outra versão.', ['alvo', 'ancora', 'versao_id']));
    if (v.alvo.tipo === 'bloco' && v.alvo.ancora.inicio_utf16 !== 0) erros.push(diagnostico('bloco_parcial', 'O alvo `bloco` cobre o bloco desde o começo.', ['alvo', 'ancora', 'inicio_utf16']));
  }
  if ((v.estado === 'pronto') !== (v.artefato !== undefined)) erros.push(diagnostico('artefato_e_estado', 'Só o visual pronto tem artefato, e todo visual pronto tem.', ['artefato']));
  if ((v.estado === 'falhou') !== (v.motivo !== undefined)) erros.push(diagnostico('motivo_e_estado', 'Só o visual que falhou tem motivo, e todo visual que falhou tem.', ['motivo']));
  if (v.artefato !== undefined) {
    const esperado = v.tipo === 'imagem' ? 'png' : 'mermaid';
    if (v.artefato.tipo !== esperado) erros.push(diagnostico('artefato_do_tipo', `Um visual ${v.tipo} guarda artefato ${esperado}.`, ['artefato', 'tipo']));
    if (v.artefato.tipo === 'mermaid') {
      if (cabecalhoDoMermaid(v.artefato.codigo) !== CABECALHO_DO_FLUXOGRAMA) erros.push(diagnostico('fluxograma_vertical', `O código começa por "${CABECALHO_DO_FLUXOGRAMA}".`, ['artefato', 'codigo']));
      const ids = v.artefato.nos.map((no) => no.id);
      if (new Set(ids).size !== ids.length) erros.push(diagnostico('no_repetido', 'Ids de nó repetidos.', ['artefato', 'nos']));
      v.artefato.nos.forEach((no, i) => {
        if (no.ancora !== undefined && no.ancora.versao_id !== v.versao_id) erros.push(diagnostico('no_de_outra_versao', 'A âncora do nó é de outra versão.', ['artefato', 'nos', i, 'ancora']));
      });
    }
  }
  if (v.substitui === v.id) erros.push(diagnostico('substitui_a_si', 'Um visual não substitui a si mesmo.', ['substitui']));
  if (Date.parse(v.atualizado_em) < Date.parse(v.criado_em)) erros.push(diagnostico('atualizado_antes', 'Atualizado antes de criado.', ['atualizado_em']));
  return erros;
}
