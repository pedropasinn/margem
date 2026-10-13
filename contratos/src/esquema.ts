/**
 * Esquema do capítulo: o capítulo resumido num fluxograma vertical, no estilo dos fluxogramas
 * didáticos (blocos de cor por parte do capítulo, formas por tipo de ideia, setas com rótulo).
 *
 * Gerado uma vez pelo Codex a partir do modelo da compreensão (`ModeloDoCapituloV1`) e guardado
 * como artefato da versão. O esquema resume: poucos nós (até 30), cada um com rótulo curto; a
 * âncora de cada nó vem do elemento do modelo que ele resume ou de uma citação que o serviço
 * resolveu no texto (citação ausente ou ambígua vira diagnóstico, e o nó fica sem trecho).
 */
import { diagnostico, type DiagnosticoContrato } from './contrato';
import type { AncoraV1, Id } from './tipos';

export type TipoDoNoDoEsquema = 'conceito' | 'tese' | 'mecanismo' | 'exemplo' | 'questao' | 'contraste' | 'conclusao';
export const TIPOS_DO_NO_DO_ESQUEMA: readonly TipoDoNoDoEsquema[] = ['conceito', 'tese', 'mecanismo', 'exemplo', 'questao', 'contraste', 'conclusao'];

export interface GrupoDoEsquemaV1 { id: string; titulo: string; resumo?: string }
export interface NoDoEsquemaV1 {
  id: string;
  /** 2 a 6 palavras. */
  rotulo: string;
  tipo: TipoDoNoDoEsquema;
  grupo_id: string;
  /** Uma frase que explica o nó (aparece ao passar o ponteiro). */
  detalhe?: string;
  /** Elemento do modelo da compreensão que o nó resume. */
  elemento_id?: Id;
  /** Onde o nó está no texto: a âncora principal do elemento ou a citação resolvida. */
  ancora?: AncoraV1;
}
export interface LigacaoDoEsquemaV1 { de: string; para: string; rotulo?: string; forca?: 'forte' | 'fraca' }

export interface EsquemaDoCapituloV1 {
  versao: 1;
  id: Id;
  versao_id: Id;
  secao_id: Id;
  /** A execução de compreensão (a camada) e a revisão do modelo de que o esquema saiu. */
  compreensao_id: Id;
  modelo_id: Id;
  titulo: string;
  /** As partes do capítulo, de cima para baixo. */
  grupos: GrupoDoEsquemaV1[];
  /** Na ordem de leitura. */
  nos: NoDoEsquemaV1[];
  ligacoes: LigacaoDoEsquemaV1[];
  diagnosticos: { codigo: string; mensagem: string }[];
  execucao: { modelo: string; esforco: string; prompt_versao: string };
  criado_em: string;
}

export function regrasEsquemaDoCapitulo(e: EsquemaDoCapituloV1): DiagnosticoContrato[] {
  const erros: DiagnosticoContrato[] = [];
  const grupos = new Set<string>();
  e.grupos.forEach((grupo, i) => {
    if (grupos.has(grupo.id)) erros.push(diagnostico('grupo_repetido', `Grupo ${grupo.id} repetido.`, ['grupos', i, 'id']));
    grupos.add(grupo.id);
  });
  const nos = new Set<string>();
  const usados = new Set<string>();
  e.nos.forEach((no, i) => {
    if (nos.has(no.id)) erros.push(diagnostico('no_repetido', `Nó ${no.id} repetido.`, ['nos', i, 'id']));
    nos.add(no.id);
    if (!grupos.has(no.grupo_id)) erros.push(diagnostico('grupo_inexistente', `O nó ${no.id} está num grupo que não existe.`, ['nos', i, 'grupo_id']));
    usados.add(no.grupo_id);
    if (no.ancora !== undefined && no.ancora.versao_id !== e.versao_id) erros.push(diagnostico('ancora_de_outra_versao', 'A âncora do nó é de outra versão.', ['nos', i, 'ancora', 'versao_id']));
  });
  e.grupos.forEach((grupo, i) => {
    if (!usados.has(grupo.id)) erros.push(diagnostico('grupo_vazio', `O grupo ${grupo.id} não tem nós.`, ['grupos', i]));
  });
  const pares = new Set<string>();
  e.ligacoes.forEach((ligacao, i) => {
    if (!nos.has(ligacao.de)) erros.push(diagnostico('ligacao_sem_origem', `A ligação parte de ${ligacao.de}, que não existe.`, ['ligacoes', i, 'de']));
    if (!nos.has(ligacao.para)) erros.push(diagnostico('ligacao_sem_destino', `A ligação chega em ${ligacao.para}, que não existe.`, ['ligacoes', i, 'para']));
    if (ligacao.de === ligacao.para) erros.push(diagnostico('ligacao_em_laco', 'Um nó não se liga a si mesmo.', ['ligacoes', i]));
    const par = `${ligacao.de}→${ligacao.para}`;
    if (pares.has(par)) erros.push(diagnostico('ligacao_repetida', `Ligação ${par} repetida.`, ['ligacoes', i]));
    pares.add(par);
  });
  return erros;
}
