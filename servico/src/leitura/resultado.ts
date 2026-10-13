import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ValidateFunction } from 'ajv';
import { ulid } from 'ulid';
import type { CanonicoV1, Comentario, Funcao, Id, MarcaGeradaV1, MarcaV1, ParteV1 } from '@margem/contratos';
import { validarMarca } from '@margem/contratos';
import { resolverCitacao, resolverSubfaixas, type BlocoDeVersao } from '@margem/core';

export interface RecuperacaoDaParte {
  secao_id: Id;
  perguntas: string[];
}

export interface MapaDaSecao {
  secao_id: Id;
  afirmacao_principal: string;
  definicoes: string[];
  condicoes: string[];
  duvidas_de_extracao: string[];
}

/** Forma exata do `prompts/leitor-de-parte@1.schema.json`. */
export interface SaidaDoLeitor {
  marcas: MarcaGeradaV1[];
  recuperacao: RecuperacaoDaParte[];
  mapa_da_secao: MapaDaSecao[];
  resumo_da_parte: string;
  limites: string[];
  leitura_integral: boolean;
}

export type MotivoDeRejeicao =
  | 'bloco_desconhecido'
  | 'bloco_fora_da_parte'
  | 'citacao_vazia'
  | 'citacao_ausente'
  | 'citacao_ambigua'
  | 'sobreposicao_editorial'
  | 'marca_invalida';

export interface MarcaRejeitada {
  indice: number;
  motivo: MotivoDeRejeicao;
  bloco_id: Id;
  citacao: string;
  detalhe?: string;
}

export interface AvisoDeMarca {
  indice: number;
  motivo: 'sublinhar_nao_resolvido';
  termos: string[];
}

export interface ResultadoDaParte {
  marcas: MarcaV1[];
  rejeitadas: MarcaRejeitada[];
  avisos: AvisoDeMarca[];
  recuperacao: RecuperacaoDaParte[];
  mapa_da_secao: MapaDaSecao[];
  resumo_da_parte: string;
  limites: string[];
  leitura_integral: boolean;
}

export interface ContextoDaInterpretacao {
  versao_id: Id;
  execucao_id: Id;
  job_id?: Id;
  /** Injetáveis para determinismo nos testes. */
  novoId?: () => Id;
  agora?: () => Date;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
let compilado: ValidateFunction | undefined;

export function caminhoDoSchemaDoLeitor(): URL {
  return new URL('../../../prompts/leitor-de-parte@1.schema.json', import.meta.url);
}

/** Ajv compilado uma vez por processo sobre o schema versionado do prompt. */
export function validadorDaSaida(): ValidateFunction {
  compilado ??= ajv.compile(JSON.parse(readFileSync(caminhoDoSchemaDoLeitor(), 'utf8')) as AnySchema);
  return compilado;
}

export class SaidaInvalida extends Error {
  constructor(public readonly problemas: string[]) {
    super(`Saída do leitor fora do schema: ${problemas.join('; ')}`);
    this.name = 'SaidaInvalida';
  }
}

export function lerSaidaDoLeitor(valor: unknown): SaidaDoLeitor {
  const validar = validadorDaSaida();
  if (!validar(valor)) {
    throw new SaidaInvalida((validar.errors ?? []).slice(0, 5)
      .map((erro) => `${erro.instancePath || '/'} ${erro.message ?? 'inválido'}`));
  }
  return valor as SaidaDoLeitor;
}

function faixasSeSobrepoem(a: MarcaV1, b: MarcaV1): boolean {
  return a.ancora.bloco_id === b.ancora.bloco_id
    && a.ancora.inicio_utf16 < b.ancora.fim_utf16 && b.ancora.inicio_utf16 < a.ancora.fim_utf16;
}

function ehCamadaEditorial(funcao: Funcao): boolean {
  return funcao !== 'nenhuma';
}

/**
 * Interpreta a resposta do leitor: valida contra o schema, resolve cada citação no bloco
 * indicado e devolve `MarcaV1[]` com as rejeições visíveis. Nenhuma ocorrência é escolhida
 * em silêncio: citação ambígua é diagnóstico, nunca a primeira ocorrência.
 */
export function interpretarSaida(
  canonico: CanonicoV1, parte: Pick<ParteV1, 'blocos_responsaveis'>, bruto: unknown, contexto: ContextoDaInterpretacao,
): ResultadoDaParte {
  const saida = lerSaidaDoLeitor(bruto);
  const novoId = contexto.novoId ?? ulid;
  const agora = contexto.agora ?? (() => new Date());
  const porId = new Map(canonico.blocos.map((bloco) => [bloco.id, bloco]));
  const responsaveis = new Set(parte.blocos_responsaveis);
  const marcas: MarcaV1[] = [];
  const rejeitadas: MarcaRejeitada[] = [];
  const avisos: AvisoDeMarca[] = [];

  saida.marcas.forEach((gerada, indice) => {
    const rejeitar = (motivo: MotivoDeRejeicao, detalhe?: string): void => {
      rejeitadas.push(detalhe === undefined
        ? { indice, motivo, bloco_id: gerada.bloco_id, citacao: gerada.citacao }
        : { indice, motivo, bloco_id: gerada.bloco_id, citacao: gerada.citacao, detalhe });
    };
    const bloco = porId.get(gerada.bloco_id);
    if (!bloco) { rejeitar('bloco_desconhecido'); return; }
    if (!responsaveis.has(gerada.bloco_id)) { rejeitar('bloco_fora_da_parte'); return; }
    const blocoDeVersao: BlocoDeVersao = { id: bloco.id, texto: bloco.texto, versao_id: contexto.versao_id };
    const resolucao = resolverCitacao(blocoDeVersao, {
      citacao: gerada.citacao, prefixo: gerada.prefixo, sufixo: gerada.sufixo,
    });
    if (!resolucao.ok) {
      const motivo = resolucao.motivo === 'ambigua' ? 'citacao_ambigua'
        : resolucao.motivo === 'vazia' ? 'citacao_vazia' : 'citacao_ausente';
      rejeitar(motivo, resolucao.motivo === 'ambigua'
        ? `${String(resolucao.ocorrencias)} ocorrências no bloco; peça mais contexto`
        : undefined);
      return;
    }
    const { subfaixas, nao_resolvidas } = resolverSubfaixas(blocoDeVersao, resolucao.ancora, gerada.sublinhar);
    if (nao_resolvidas.length > 0) {
      avisos.push({ indice, motivo: 'sublinhar_nao_resolvido', termos: nao_resolvidas.map((item) => item.texto) });
    }
    const comentario: Comentario | null = gerada.comentario;
    const marca: MarcaV1 = {
      id: novoId(),
      ancora: resolucao.ancora,
      funcao: gerada.funcao,
      subfaixas,
      comentario,
      origem: 'parte',
      validade: 'resolvida',
      visivel: true,
      avaliacao: 'nao_avaliada',
      execucao_id: contexto.execucao_id,
      ...(contexto.job_id === undefined ? {} : { job_id: contexto.job_id }),
      criada_em: agora().toISOString(),
    };
    if (!validarMarca(marca)) { rejeitar('marca_invalida'); return; }
    // Conflito dentro do próprio resultado: a primeira fica, a segunda é rejeitada com motivo.
    if (ehCamadaEditorial(marca.funcao)) {
      const conflito = marcas.find((outra) => ehCamadaEditorial(outra.funcao) && faixasSeSobrepoem(outra, marca));
      if (conflito) { rejeitar('sobreposicao_editorial', `sobrepõe a marca ${conflito.id}`); return; }
    }
    marcas.push(marca);
  });

  return {
    marcas,
    rejeitadas,
    avisos,
    recuperacao: saida.recuperacao,
    mapa_da_secao: saida.mapa_da_secao,
    resumo_da_parte: saida.resumo_da_parte,
    limites: saida.limites,
    leitura_integral: saida.leitura_integral,
  };
}
