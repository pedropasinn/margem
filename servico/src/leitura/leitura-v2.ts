import { modeloDoPrompt } from './protocolos.js';
/**
 * Leitura V2 por modo (J19): o que muda entre uma parte de F1 e uma parte V2.
 *
 * O laço é o mesmo do J06 (a parte roda fora de transação e publica dentro de
 * `jobs.publicar`). Muda a entrada — `montarPromptDeLeitura` (`leitor-de-parte@2`) com o
 * modo e o nível da execução, com o texto no próprio prompt — e a saída, resolvida por
 * `interpretarSaidaV2` em `MarcaV2` da camada da execução. As peças puras moram aqui; a
 * orquestração (execução, proveniência, fila) continua em `manipuladores.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import type { Bloco, CanonicoV1, Id, JobResultV1, MarcaV2, ModoDeLeituraV1, ParteV1, Saliencia } from '@margem/contratos';
import { raizDoRepositorio } from '../dados.js';
import type { TextosDoPacote, VersoesDoPacote } from './pacote.js';
import { TIPOS_ELEGIVEIS_V2 } from './partes.js';
import { VERSAO_PROMPT_LEITURA, montarPromptDeLeitura, type PromptMontado } from './v2/prompt.js';
import { interpretarSaidaV2, type DiagnosticoDeMarca } from './v2/resolver.js';

/** O que o corpo de `POST /api/documentos/:id/leituras` pede a mais em F2. */
export interface PedidoDeLeituraV2 {
  /** Versão persistida, preenchida apenas ao retomar uma execução. */
  prompt_versao?: string;
  modo: ModoDeLeituraV1;
  nivel: Saliencia;
}

type Diagnostico = JobResultV1['diagnosticos'][number];

/**
 * A revisão de consistência de F1 (`LoteRevisaoV2`) não sabe mudar função por chave do modo
 * nem saliência. Sobre execução V2 ela não é enfileirada; isto fica registrado na resposta
 * da rota e no job da última parte.
 */
export const REVISAO_V2_INDISPONIVEL: Diagnostico = {
  nivel: 'info',
  codigo: 'revisao_v2_indisponivel',
  mensagem: 'A revisão de consistência V1 não roda sobre execução V2 (LoteRevisaoV2 é trabalho futuro): as marcas ficam como a leitura as publicou.',
};

function lerDoRepositorio(nome: string): string {
  return readFileSync(join(raizDoRepositorio(), 'prompts', nome), 'utf8');
}

export function referenciaDoModo(modo: Pick<ModoDeLeituraV1, 'id' | 'revisao'>): string {
  return `${modo.id}@${String(modo.revisao)}`;
}

/**
 * Versões e textos que entram no `hash_entrada` das partes V2. O "método" de V2 é o modo
 * (com o nível): o `metodo-leitor.md` de F1 não entra no prompt `@2`.
 */
export function opcoesDoPlanoV2(pedido: PedidoDeLeituraV2, versao = pedido.prompt_versao ?? VERSAO_PROMPT_LEITURA): {
  versoes: VersoesDoPacote; textos: TextosDoPacote; tiposElegiveis: ReadonlySet<Bloco['tipo']>;
} {
  return {
    versoes: { metodo_versao: `modo:${referenciaDoModo(pedido.modo)}`, prompt_versao: versao, schema_versao: 2 },
    textos: {
      metodo: JSON.stringify({ modo: pedido.modo, nivel: pedido.nivel }),
      prompt: modeloDoPrompt(versao, pedido.modo),
      schema: lerDoRepositorio(`${versao}.schema.json`),
    },
    tiposElegiveis: TIPOS_ELEGIVEIS_V2,
  };
}

function blocosDaParte(canonico: CanonicoV1, ids: readonly Id[]): Bloco[] {
  const porId = new Map(canonico.blocos.map((bloco) => [bloco.id, bloco]));
  return ids.map((id) => {
    const bloco = porId.get(id);
    if (!bloco) throw new Error(`Bloco ${id} não pertence a esta versão do texto.`);
    return bloco;
  });
}

/** Prompt e schema especializados da parte (função pura sobre o canônico). */
export function montarPedidoDaParteV2(
  canonico: CanonicoV1, parte: ParteV1, pedido: PedidoDeLeituraV2, continuidade?: string, prompt_versao = pedido.prompt_versao ?? VERSAO_PROMPT_LEITURA,
): PromptMontado {
  return montarPromptDeLeitura({
    prompt_versao,
    modo: pedido.modo,
    nivel: pedido.nivel,
    blocos: blocosDaParte(canonico, [...parte.blocos_responsaveis, ...parte.blocos_contexto]),
    responsaveis: parte.blocos_responsaveis,
    ...(continuidade === undefined ? {} : { continuidade }),
  });
}

export interface ResultadoDaParteV2 {
  marcas: MarcaV2[];
  diagnosticos: DiagnosticoDeMarca[];
  resumo_da_parte: string;
  limites: string[];
  leitura_integral: boolean;
}

export interface ContextoDaParteV2 {
  versao_id: Id;
  execucao_id: Id;
  job_id: Id;
  novoId?: () => Id;
  agora?: () => Date;
}

/**
 * Resolve a saída do modelo nos blocos que a parte podia marcar. As marcas saem com a
 * camada = execução, o modo da execução, id e data do serviço (nunca do modelo).
 */
export function interpretarParteV2(
  canonico: CanonicoV1, parte: ParteV1, pedido: PedidoDeLeituraV2, bruto: unknown, contexto: ContextoDaParteV2,
): ResultadoDaParteV2 {
  const novoId = contexto.novoId ?? ulid;
  const agora = contexto.agora ?? (() => new Date());
  const resolvido = interpretarSaidaV2(bruto, blocosDaParte(canonico, parte.blocos_responsaveis), {
    versao_id: contexto.versao_id, camada_id: contexto.execucao_id, modo: pedido.modo,
    nivel_de_atencao_alvo: pedido.nivel, job_id: contexto.job_id,
  });
  const criada_em = agora().toISOString();
  return {
    marcas: resolvido.marcas.map((marca) => ({ ...marca, id: novoId(), criada_em })),
    diagnosticos: resolvido.diagnosticos,
    resumo_da_parte: resolvido.resumo_da_parte,
    limites: resolvido.limites,
    leitura_integral: resolvido.leitura_integral,
  };
}

/** Diagnósticos do job: descarte é aviso; marca mantida com ressalva é informação. */
export function diagnosticosDaParteV2(resultado: ResultadoDaParteV2): Diagnostico[] {
  const diagnosticos: Diagnostico[] = resultado.diagnosticos.map((item) => ({
    nivel: item.efeito === 'descartada' ? 'aviso' : 'info',
    codigo: item.codigo,
    mensagem: `Marca ${String(item.indice)}${item.bloco_id === undefined ? '' : ` no bloco ${item.bloco_id}`}`
      + `${item.citacao === undefined ? '' : `: “${item.citacao.slice(0, 80)}”`} — ${item.mensagem}`,
  }));
  if (!resultado.leitura_integral) {
    diagnosticos.push({ nivel: 'aviso', codigo: 'leitura_parcial', mensagem: resultado.limites.join(' | ') || 'O leitor declarou cobertura parcial.' });
  }
  return diagnosticos;
}
