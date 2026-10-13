import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { ulid } from 'ulid';
import type {
  AncoraV1, Bloco, ConexaoV2, Faixa, Id, MarcaV2, ModoDeLeituraV1, RespostaGeradaV1, Saliencia,
} from '@margem/contratos';
import { localizarCitacao, validadoresSchema, validarAncora, validarConexaoV2, validarMarcaV2 } from '@margem/contratos';
import { conferirTextoAncora } from '@margem/contratos/regras';
import { ancoraDeSelecao, resolverSubfaixas } from '@margem/core';
import { schemaDoLeitorV2 } from './prompt.js';

type BlocoResolvivel = Pick<Bloco, 'id' | 'texto'>;

// ---------------------------------------------------------------- marcas

export type CodigoDeMarca =
  | 'marca_invalida'
  | 'funcao_fora_do_modo'
  | 'comentario_fora_do_modo'
  | 'saliencia_acima_do_alvo'
  | 'bloco_fora_da_parte'
  | 'citacao_ausente'
  | 'citacao_ambigua'
  | 'sobreposicao_na_camada'
  | 'sublinhar_nao_resolvido';

export interface DiagnosticoDeMarca {
  /** Posição da marca na saída do modelo. */
  indice: number;
  codigo: CodigoDeMarca;
  mensagem: string;
  /** `descartada`: a marca não é publicada; `mantida`: publicada, com o aviso. */
  efeito: 'descartada' | 'mantida';
  bloco_id?: string;
  citacao?: string;
}

/** `MarcaV2` antes de o serviço dar id e data de criação na publicação. */
export type MarcaV2Resolvida = Omit<MarcaV2, 'id' | 'criada_em'>;

export interface ContextoDasMarcas {
  versao_id: Id;
  /** Camada = execução de leitura; a marca sai com `execucao_id = camada_id`. */
  camada_id: Id;
  modo: ModoDeLeituraV1;
  /** Quando informado, saliência acima dele é diagnóstico. */
  nivel_de_atencao_alvo?: Saliencia;
  job_id?: Id;
}

export interface MarcasResolvidas {
  marcas: MarcaV2Resolvida[];
  diagnosticos: DiagnosticoDeMarca[];
}

/** Id e data provisórios só para passar a marca montada por `validarMarcaV2`; saem antes do retorno. */
const ID_PROVISORIO = '00000000000000000000000000';
const DATA_PROVISORIA = '1970-01-01T00:00:00Z';

function textoDe(valor: unknown, campo: string): string | undefined {
  if (typeof valor !== 'object' || valor === null || !(campo in valor)) return undefined;
  const item: unknown = (valor as Record<string, unknown>)[campo];
  return typeof item === 'string' ? item : undefined;
}

function mesmoIntervalo(a: AncoraV1, b: AncoraV1): boolean {
  return a.versao_id === b.versao_id && a.bloco_id === b.bloco_id && a.inicio_utf16 === b.inicio_utf16 && a.fim_utf16 === b.fim_utf16;
}

function sobrepoe(a: Faixa & { bloco_id: Id }, b: Faixa & { bloco_id: Id }): boolean {
  return a.bloco_id === b.bloco_id && a.inicio_utf16 < b.fim_utf16 && b.inicio_utf16 < a.fim_utf16;
}

/**
 * Resolve as marcas geradas em `MarcaV2` (sem id nem `criada_em`) nos blocos que a parte podia marcar.
 * Cada item é conferido pelo schema de `MarcaGeradaV2` (a saída bruta pode trazer lixo), pelo modo e
 * pelo nível. Citação ausente ou ambígua vira diagnóstico, nunca a primeira ocorrência. Sobreposição
 * de marcas com cor na camada: fica a de menor saliência (a mais essencial; no empate, a que veio antes)
 * e a outra é descartada com diagnóstico. Termo de `sublinhar` não encontrado é aviso e a marca fica.
 * Aceita `MarcaGeradaV2[]` ou a lista bruta da saída do modelo (`unknown[]`): o tipo não é confiado.
 */
export function resolverMarcasGeradas(
  geradas: readonly unknown[], blocos: readonly BlocoResolvivel[], contexto: ContextoDasMarcas,
): MarcasResolvidas {
  const { versao_id, camada_id, modo, nivel_de_atencao_alvo, job_id } = contexto;
  const porId = new Map(blocos.map((bloco) => [bloco.id, bloco]));
  const funcoes = new Set(modo.funcoes.map((funcao) => funcao.chave));
  const diagnosticos: DiagnosticoDeMarca[] = [];
  const candidatas: { indice: number; marca: MarcaV2Resolvida }[] = [];

  geradas.forEach((bruta, indice) => {
    const diagnosticar = (codigo: CodigoDeMarca, mensagem: string, efeito: DiagnosticoDeMarca['efeito'] = 'descartada'): void => {
      const bloco_id = textoDe(bruta, 'bloco_id');
      const citacao = textoDe(bruta, 'citacao');
      diagnosticos.push({
        indice, codigo, mensagem, efeito,
        ...(bloco_id === undefined ? {} : { bloco_id }),
        ...(citacao === undefined ? {} : { citacao }),
      });
    };
    const validarSchema = validadoresSchema.MarcaGeradaV2;
    if (!validarSchema(bruta)) {
      const problemas = (validarSchema.errors ?? []).slice(0, 3).map((erro) => `${erro.instancePath || '/'} ${erro.message ?? 'inválido'}`);
      diagnosticar('marca_invalida', `Fora do schema de MarcaGeradaV2: ${problemas.join('; ')}.`);
      return;
    }
    const gerada = bruta;
    if (gerada.funcao !== 'nenhuma' && !funcoes.has(gerada.funcao)) {
      diagnosticar('funcao_fora_do_modo', `A função "${gerada.funcao}" não pertence ao modo ${modo.id}@${String(modo.revisao)}.`);
      return;
    }
    if (gerada.comentario !== null && !modo.comentarios.includes(gerada.comentario.tipo)) {
      diagnosticar('comentario_fora_do_modo', `O comentário ${gerada.comentario.tipo} não é permitido no modo ${modo.id}.`);
      return;
    }
    if (nivel_de_atencao_alvo !== undefined && gerada.saliencia > nivel_de_atencao_alvo) {
      diagnosticar('saliencia_acima_do_alvo', `Saliência ${String(gerada.saliencia)} acima do nível alvo ${String(nivel_de_atencao_alvo)}.`);
      return;
    }
    const bloco = porId.get(gerada.bloco_id);
    if (!bloco) { diagnosticar('bloco_fora_da_parte', 'O bloco não é um dos que esta parte podia marcar.'); return; }
    const local = localizarCitacao(bloco, gerada.citacao, gerada.prefixo, gerada.sufixo);
    if (local.tipo === 'ausente') {
      diagnosticar('citacao_ausente', gerada.prefixo || gerada.sufixo
        ? 'A citação não aparece literalmente no bloco com o prefixo e o sufixo informados.'
        : 'A citação não aparece literalmente no bloco.');
      return;
    }
    if (local.tipo === 'ambigua') {
      diagnosticar('citacao_ambigua', `${String(local.ocorrencias)} ocorrências compatíveis no bloco; falta prefixo ou sufixo que as distinga.`);
      return;
    }
    const ancora: AncoraV1 = {
      versao_id, bloco_id: bloco.id, citacao: gerada.citacao, prefixo: gerada.prefixo, sufixo: gerada.sufixo,
      inicio_utf16: local.inicio_utf16, fim_utf16: local.fim_utf16,
    };
    if (!conferirTextoAncora(bloco, ancora)) {
      diagnosticar('citacao_ausente', 'A citação corta um caractere ao meio (par substituto UTF-16).');
      return;
    }
    const { subfaixas, nao_resolvidas } = resolverSubfaixas({ ...bloco, versao_id }, ancora, gerada.sublinhar);
    const marca: MarcaV2Resolvida = {
      ancora,
      funcao: gerada.funcao,
      saliencia: gerada.saliencia,
      subfaixas,
      comentario: gerada.comentario,
      origem: 'parte',
      validade: 'resolvida',
      visivel: true,
      avaliacao: 'nao_avaliada',
      camada_id,
      modo: { id: modo.id, revisao: modo.revisao },
      execucao_id: camada_id,
      ...(job_id === undefined ? {} : { job_id }),
    };
    if (!validarMarcaV2({ ...marca, id: ID_PROVISORIO, criada_em: DATA_PROVISORIA })) {
      diagnosticar('marca_invalida', 'A marca resolvida não satisfaz MarcaV2.');
      return;
    }
    if (nao_resolvidas.length > 0) {
      diagnosticar('sublinhar_nao_resolvido',
        `Termos de sublinhado sem ocorrência única na citação: ${nao_resolvidas.map((item) => `"${item.texto}" (${item.motivo})`).join(', ')}.`, 'mantida');
    }
    candidatas.push({ indice, marca });
  });

  // Sobreposição na camada: as mais essenciais primeiro; no empate, a ordem da saída.
  const aceitas = new Set<number>();
  const comCor: { indice: number; marca: MarcaV2Resolvida }[] = [];
  for (const candidata of [...candidatas].sort((a, b) => a.marca.saliencia - b.marca.saliencia || a.indice - b.indice)) {
    if (candidata.marca.funcao === 'nenhuma') { aceitas.add(candidata.indice); continue; }
    const conflito = comCor.find((outra) => sobrepoe(outra.marca.ancora, candidata.marca.ancora));
    if (conflito) {
      diagnosticos.push({
        indice: candidata.indice,
        codigo: 'sobreposicao_na_camada',
        mensagem: `Sobrepõe a marca ${String(conflito.indice)} (saliência ${String(conflito.marca.saliencia)}), que fica.`,
        efeito: 'descartada',
        bloco_id: candidata.marca.ancora.bloco_id,
        citacao: candidata.marca.ancora.citacao,
      });
      continue;
    }
    comCor.push(candidata);
    aceitas.add(candidata.indice);
  }
  // Aviso de sublinhado de uma marca que acabou descartada por sobreposição não interessa mais.
  const descartadas = new Set(candidatas.filter((c) => !aceitas.has(c.indice)).map((c) => c.indice));
  return {
    marcas: candidatas.filter((candidata) => aceitas.has(candidata.indice)).map((candidata) => candidata.marca),
    diagnosticos: diagnosticos
      .filter((d) => !(d.codigo === 'sublinhar_nao_resolvido' && descartadas.has(d.indice)))
      .sort((a, b) => a.indice - b.indice),
  };
}

// ---------------------------------------------------------------- saída do leitor

/** Forma do `leitor-de-parte@2.schema.json` com as marcas ainda brutas (cada uma é conferida na resolução). */
export interface SaidaDoLeitorV2 {
  marcas: unknown[];
  resumo_da_parte: string;
  limites: string[];
  leitura_integral: boolean;
}

export class SaidaInvalidaV2 extends Error {
  constructor(public readonly problemas: string[]) {
    super(`Saída do leitor V2 fora do schema: ${problemas.join('; ')}`);
    this.name = 'SaidaInvalidaV2';
  }
}

let validadorDoEnvelope: ValidateFunction | undefined;
/**
 * Confere o envelope da saída com o schema versionado, mas sem as regras de cada marca:
 * uma marca ruim vira diagnóstico na resolução, em vez de derrubar a parte inteira.
 */
export function lerSaidaDoLeitorV2(bruto: unknown): SaidaDoLeitorV2 {
  if (!validadorDoEnvelope) {
    const schema = schemaDoLeitorV2();
    const propriedades = schema.properties;
    if (typeof propriedades !== 'object' || propriedades === null || Array.isArray(propriedades)) throw new Error('Schema do leitor sem propriedades.');
    const envelope = { ...schema, properties: { ...propriedades, marcas: { type: 'array' } } };
    validadorDoEnvelope = new Ajv2020({ allErrors: true, strict: false }).compile(envelope);
  }
  if (!validadorDoEnvelope(bruto)) {
    throw new SaidaInvalidaV2((validadorDoEnvelope.errors ?? []).slice(0, 5).map((erro) => `${erro.instancePath || '/'} ${erro.message ?? 'inválido'}`));
  }
  return bruto as SaidaDoLeitorV2;
}

export interface ParteInterpretadaV2 extends MarcasResolvidas {
  resumo_da_parte: string;
  limites: string[];
  leitura_integral: boolean;
}

/** `lerSaidaDoLeitorV2` seguido de `resolverMarcasGeradas`. */
export function interpretarSaidaV2(bruto: unknown, blocos: readonly BlocoResolvivel[], contexto: ContextoDasMarcas): ParteInterpretadaV2 {
  const saida = lerSaidaDoLeitorV2(bruto);
  return {
    ...resolverMarcasGeradas(saida.marcas, blocos, contexto),
    resumo_da_parte: saida.resumo_da_parte,
    limites: saida.limites,
    leitura_integral: saida.leitura_integral,
  };
}

// ---------------------------------------------------------------- resposta

export type CodigoDeResposta =
  | 'bloco_fora_do_contexto'
  | 'citacao_ausente'
  | 'citacao_ambigua'
  | 'ponto_sem_apoio'
  | 'conexao_para_a_origem'
  | 'conexao_repetida'
  | 'conexao_invalida'
  | 'sugestoes_excedentes';

/** `{ codigo, mensagem }` é a forma da porta `Responder` (J16); `caminho` aponta o item na saída. */
export interface DiagnosticoDeResposta {
  codigo: CodigoDeResposta;
  mensagem: string;
  caminho: string;
}

export interface ContextoDaResposta {
  /** Âncora da conversa: origem das conexões sugeridas. */
  origem: AncoraV1;
  conversa_id?: Id;
  /** Injetáveis para determinismo nos testes. */
  novoId?: () => Id;
  agora?: () => Date;
}

/** O que a porta `Responder` do J16 devolve, menos `modelo` e `esforco` (que vêm de quem executou). */
export interface RespostaResolvida {
  texto: string;
  citacoes: AncoraV1[];
  sugestoes: ConexaoV2[];
  diagnosticos: DiagnosticoDeResposta[];
}

/** Máximo de sugestões de conexão por resposta (o contrato aceita até 10; o método pede até 3). */
export const MAXIMO_SUGESTOES = 3;

/**
 * Resolve os apoios da resposta em âncoras dos blocos recebidos (núcleo + contexto) e as sugestões
 * em `ConexaoV2` da IA, `sugerida`, com destino `trecho`. O texto da resposta não muda. Apoio sem
 * ocorrência única sai das citações e entra nos diagnósticos; citações repetidas saem uma vez só.
 * Os ids das conexões são do serviço (`novoId`), nunca do modelo.
 */
export function resolverResposta(
  resposta: RespostaGeradaV1, blocos: readonly BlocoResolvivel[], versao_id: Id, contexto: ContextoDaResposta,
): RespostaResolvida {
  const { origem, conversa_id } = contexto;
  if (!validarAncora(origem) || origem.versao_id !== versao_id) throw new Error('A origem precisa ser uma âncora válida da mesma versão.');
  const novoId = contexto.novoId ?? ulid;
  const agora = contexto.agora ?? (() => new Date());
  const porId = new Map(blocos.map((bloco) => [bloco.id, bloco]));
  const diagnosticos: DiagnosticoDeResposta[] = [];

  const ancorar = (caminho: string, bloco_id: Id, citacao: string): AncoraV1 | undefined => {
    const bloco = porId.get(bloco_id);
    if (!bloco) {
      diagnosticos.push({ caminho, codigo: 'bloco_fora_do_contexto', mensagem: `O bloco ${bloco_id} não estava no contexto da resposta.` });
      return undefined;
    }
    const local = localizarCitacao(bloco, citacao);
    if (local.tipo === 'ausente') {
      diagnosticos.push({ caminho, codigo: 'citacao_ausente', mensagem: 'A citação não aparece literalmente no bloco.' });
      return undefined;
    }
    if (local.tipo === 'ambigua') {
      diagnosticos.push({ caminho, codigo: 'citacao_ambigua', mensagem: `A citação aparece ${String(local.ocorrencias)} vezes no bloco.` });
      return undefined;
    }
    try {
      return ancoraDeSelecao({ ...bloco, versao_id }, local.inicio_utf16, local.fim_utf16);
    } catch {
      diagnosticos.push({ caminho, codigo: 'citacao_ausente', mensagem: 'A citação corta um caractere ao meio (par substituto UTF-16).' });
      return undefined;
    }
  };

  const citacoes: AncoraV1[] = [];
  resposta.pontos.forEach((ponto, i) => {
    let apoiados = 0;
    ponto.apoios.forEach((apoio, j) => {
      const ancora = ancorar(`/pontos/${String(i)}/apoios/${String(j)}`, apoio.bloco_id, apoio.citacao);
      if (!ancora) return;
      apoiados += 1;
      if (!citacoes.some((outra) => mesmoIntervalo(outra, ancora))) citacoes.push(ancora);
    });
    if (ponto.tipo !== 'pergunta' && apoiados === 0) {
      diagnosticos.push({ caminho: `/pontos/${String(i)}`, codigo: 'ponto_sem_apoio', mensagem: `O ponto (${ponto.tipo}) ficou sem nenhum apoio resolvido.` });
    }
  });

  const sugestoes: ConexaoV2[] = [];
  resposta.sugestoes_de_conexao.forEach((sugestao, i) => {
    const caminho = `/sugestoes_de_conexao/${String(i)}`;
    if (i >= MAXIMO_SUGESTOES) {
      diagnosticos.push({ caminho, codigo: 'sugestoes_excedentes', mensagem: `Só as ${String(MAXIMO_SUGESTOES)} primeiras sugestões são consideradas.` });
      return;
    }
    const destino = ancorar(caminho, sugestao.destino_bloco_id, sugestao.citacao);
    if (!destino) return;
    if (mesmoIntervalo(origem, destino)) {
      diagnosticos.push({ caminho, codigo: 'conexao_para_a_origem', mensagem: 'O destino é o próprio trecho perguntado.' });
      return;
    }
    if (sugestoes.some((outra) => outra.destino.tipo === 'trecho' && mesmoIntervalo(outra.destino.ancora, destino) && outra.relacao === sugestao.relacao)) {
      diagnosticos.push({ caminho, codigo: 'conexao_repetida', mensagem: 'Mesma relação com o mesmo destino de uma sugestão anterior.' });
      return;
    }
    const conexao: ConexaoV2 = {
      versao: 2,
      id: novoId(),
      origem,
      destino: { tipo: 'trecho', ancora: destino },
      relacao: sugestao.relacao,
      justificativa: sugestao.justificativa,
      autor: 'ia',
      estado: 'sugerida',
      ...(conversa_id === undefined ? {} : { conversa_id }),
      criada_em: agora().toISOString(),
    };
    if (!validarConexaoV2(conexao)) {
      diagnosticos.push({ caminho, codigo: 'conexao_invalida', mensagem: 'A sugestão resolvida não satisfaz ConexaoV2.' });
      return;
    }
    sugestoes.push(conexao);
  });

  return { texto: resposta.texto, citacoes, sugestoes, diagnosticos };
}
