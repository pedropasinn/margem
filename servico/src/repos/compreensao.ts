import { conferirPlanoNoModelo } from '@margem/core';
import { conferirOrcamento, ORCAMENTOS } from '../entrada-json.js';
/**
 * Persistência da compreensão do capítulo (migração 0007, `docs/desenho/10-MODELO-DO-CAPITULO.md`).
 * Só o serviço escreve aqui, dentro das transações de publicação dos jobs ou das rotas.
 */
import { hashDoPerfil, hashesDoPerfil } from '../compreensao/perfil.js';
export { hashDoPerfil } from '../compreensao/perfil.js';
import {
  validarExecucaoCompreensao, validarPartes, validarPerfilDoLeitor, contratoPlanoPedagogico,
  type DificuldadeTextualV1, type ElementoSemanticoV1, type ExecucaoCompreensaoV1, type Id, type LoteDoModeloV1, type ModeloDoCapituloV1,
  type ParteV1, type PerfilDoLeitorV1, type PlanoPedagogicoV1, type RelacaoSemanticaV1,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { obterVersao } from './documentos.js';

export const METODO_DA_COMPREENSAO = 'compreensao@1';

const DATA = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

// ---------------------------------------------------------------- execução

/** A execução V3 e o seu plano de partes, numa transação: não existe execução com metade do plano. */
export async function criarExecucao(
  cliente: Transacao, execucao: ExecucaoCompreensaoV1, partes: readonly (ParteV1 & { secao_id: Id | null })[],
): Promise<void> {
  if (!validarExecucaoCompreensao(execucao)) throw new Error('Execução de compreensão inválida.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  const semSecao: ParteV1[] = partes.map((parte) => ({
    id: parte.id, execucao_id: parte.execucao_id, ordem: parte.ordem, blocos_responsaveis: parte.blocos_responsaveis,
    blocos_contexto: parte.blocos_contexto, hash_entrada: parte.hash_entrada,
  }));
  if (!validarPartes(semSecao, undefined, versao.canonico) || JSON.stringify(semSecao.map((parte) => parte.id)) !== JSON.stringify(execucao.plano_partes)
    || semSecao.some((parte) => parte.execucao_id !== execucao.id)) {
    throw new Error('Plano de partes inválido para a execução de compreensão.');
  }
  await cliente.query(`INSERT INTO execucao_leitura
    (id,versao_id,metodo_versao,prompt_versao,schema_versao,modelo,esforco,tamanho_parte_tokens,concorrencia,plano,criada_em,
     modelo_pedido,esforco_pedido,modo_id,modo_revisao,nivel_de_atencao_alvo,prompts)
    VALUES ($1,$2,$3,$4,3,$5,$6,$7,1,$8,$9,$5,$6,$10,$11,3,$12)`,
  [execucao.id, execucao.versao_id, METODO_DA_COMPREENSAO, execucao.prompts.analise, execucao.executor.modelo, execucao.executor.esforco,
    execucao.tamanho_parte_tokens, JSON.stringify(execucao.plano_partes), execucao.criada_em, execucao.modo.id, execucao.modo.revisao,
    JSON.stringify(execucao.prompts)]);
  for (const parte of partes) {
    await cliente.query(`INSERT INTO parte (id,execucao_id,ordem,blocos_responsaveis,blocos_contexto,continuidade_anterior,hash_entrada,secao_id)
      VALUES ($1,$2,$3,$4,$5,NULL,$6,$7)`, [parte.id, parte.execucao_id, parte.ordem, JSON.stringify(parte.blocos_responsaveis),
      JSON.stringify(parte.blocos_contexto), parte.hash_entrada, parte.secao_id]);
  }
}

interface LinhaDaExecucao {
  id: Id; versao_id: Id; schema_versao: number; modo_id: string; modo_revisao: number; prompts: ExecucaoCompreensaoV1['prompts'] | null;
  modelo: string; esforco: string; tamanho_parte_tokens: number; plano: Id[]; criada_em: string;
}
const PROJECAO_EXECUCAO = `id, versao_id, schema_versao, modo_id, modo_revisao, prompts, modelo, esforco,
  tamanho_parte_tokens::float8 AS tamanho_parte_tokens, plano, to_char(criada_em AT TIME ZONE 'UTC', ${DATA}) AS criada_em`;

function paraExecucao(linha: LinhaDaExecucao): ExecucaoCompreensaoV1 | null {
  if (Number(linha.schema_versao) !== 3 || linha.prompts === null) return null;
  return {
    id: linha.id, versao_id: linha.versao_id, schema_versao: 3, modo: { id: linha.modo_id, revisao: linha.modo_revisao },
    prompts: linha.prompts, executor: { modelo: linha.modelo, esforco: linha.esforco },
    tamanho_parte_tokens: Number(linha.tamanho_parte_tokens), plano_partes: linha.plano, criada_em: linha.criada_em,
  };
}

/** A execução de compreensão, ou `null` quando o id é de outra leitura (ou não existe). */
export async function obterExecucao(cliente: Transacao, id: Id): Promise<ExecucaoCompreensaoV1 | null> {
  const linha = (await cliente.query<LinhaDaExecucao>(`SELECT ${PROJECAO_EXECUCAO} FROM execucao_leitura WHERE id=$1`, [id])).rows[0];
  return linha === undefined ? null : paraExecucao(linha);
}

export async function listarExecucoes(cliente: Transacao, versaoId: Id): Promise<ExecucaoCompreensaoV1[]> {
  const linhas = (await cliente.query<LinhaDaExecucao>(
    `SELECT ${PROJECAO_EXECUCAO} FROM execucao_leitura WHERE versao_id=$1 AND schema_versao=3 ORDER BY criada_em DESC, id DESC`, [versaoId])).rows;
  return linhas.map(paraExecucao).filter((item): item is ExecucaoCompreensaoV1 => item !== null);
}

export interface ParteDaCompreensao extends ParteV1 { secao_id: Id | null }

export async function listarPartes(cliente: Transacao, execucaoId: Id, secaoId?: Id): Promise<ParteDaCompreensao[]> {
  return (await cliente.query<ParteDaCompreensao>(`SELECT id, execucao_id, ordem::float8 AS ordem, blocos_responsaveis, blocos_contexto,
      hash_entrada, secao_id FROM parte WHERE execucao_id=$1 AND ($2::text IS NULL OR secao_id=$2) ORDER BY ordem`,
  [execucaoId, secaoId ?? null])).rows;
}

export async function obterParte(cliente: Transacao, parteId: Id): Promise<ParteDaCompreensao | null> {
  return (await cliente.query<ParteDaCompreensao>(`SELECT id, execucao_id, ordem::float8 AS ordem, blocos_responsaveis, blocos_contexto,
      hash_entrada, secao_id FROM parte WHERE id=$1`, [parteId])).rows[0] ?? null;
}

// ---------------------------------------------------------------- análise local

export interface ConteudoDaAnalise {
  elementos: ElementoSemanticoV1[];
  relacoes: RelacaoSemanticaV1[];
  dificuldades: DificuldadeTextualV1[];
  resumo_da_parte: string;
  limites: string[];
  leitura_integral: boolean;
}

export async function gravarAnalise(cliente: Transacao, parteId: Id, jobId: Id, conteudo: ConteudoDaAnalise): Promise<void> {
  await cliente.query('INSERT INTO analise_local (parte_id, job_id, conteudo) VALUES ($1,$2,$3)', [parteId, jobId, JSON.stringify(conteudo)]);
  await cliente.query(`UPDATE parte SET estado='ok', resumo_da_parte=$2, limites=$3, leitura_integral=$4 WHERE id=$1`,
    [parteId, conteudo.resumo_da_parte, JSON.stringify(conteudo.limites), conteudo.leitura_integral]);
}

export async function analisesDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<{ parte: ParteDaCompreensao; analise: ConteudoDaAnalise; job_id: Id }[]> {
  const partes = await listarPartes(cliente, execucaoId, secaoId);
  const saida: { parte: ParteDaCompreensao; analise: ConteudoDaAnalise; job_id: Id }[] = [];
  for (const parte of partes) {
    const linha = (await cliente.query<{ conteudo: ConteudoDaAnalise; job_id: Id }>(
      'SELECT conteudo, job_id FROM analise_local WHERE parte_id=$1', [parte.id])).rows[0];
    if (linha) saida.push({ parte, analise: linha.conteudo, job_id: linha.job_id });
  }
  return saida;
}

export async function resumosAnteriores(cliente: Transacao, execucaoId: Id, secaoId: Id | null, ordem: number): Promise<{ ordem: number; resumo: string }[]> {
  return (await cliente.query<{ ordem: number; resumo: string }>(`SELECT ordem::float8 AS ordem, resumo_da_parte AS resumo FROM parte
    WHERE execucao_id=$1 AND secao_id IS NOT DISTINCT FROM $2 AND ordem < $3 AND resumo_da_parte IS NOT NULL ORDER BY ordem`,
  [execucaoId, secaoId, ordem])).rows;
}

// ---------------------------------------------------------------- revisões e lotes

export async function obterModelo(cliente: Transacao, id: Id): Promise<ModeloDoCapituloV1 | null> {
  return (await cliente.query<{ conteudo: ModeloDoCapituloV1 }>('SELECT conteudo FROM modelo_capitulo WHERE id=$1', [id])).rows[0]?.conteudo ?? null;
}

/** A revisão mais alta do capítulo (ou a de número `revisao`). */
export async function revisaoDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id, revisao?: number): Promise<ModeloDoCapituloV1 | null> {
  return (await cliente.query<{ conteudo: ModeloDoCapituloV1 }>(`SELECT conteudo FROM modelo_capitulo
    WHERE execucao_id=$1 AND secao_id=$2 AND ($3::int IS NULL OR revisao=$3) ORDER BY revisao DESC LIMIT 1`,
  [execucaoId, secaoId, revisao ?? null])).rows[0]?.conteudo ?? null;
}

export async function revisoesDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<ModeloDoCapituloV1[]> {
  return (await cliente.query<{ conteudo: ModeloDoCapituloV1 }>(`SELECT conteudo FROM modelo_capitulo
    WHERE execucao_id=$1 AND secao_id=$2 ORDER BY revisao`, [execucaoId, secaoId])).rows.map((linha) => linha.conteudo);
}

export async function lotesDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<LoteDoModeloV1[]> {
  return (await cliente.query<{ conteudo: LoteDoModeloV1 }>(`SELECT conteudo FROM lote_modelo
    WHERE execucao_id=$1 AND secao_id=$2 ORDER BY criado_em, id`, [execucaoId, secaoId])).rows.map((linha) => linha.conteudo);
}

// ---------------------------------------------------------------- janelas da revisão

export async function gravarJanela(cliente: Transacao, janela: { execucao_id: Id; secao_id: Id; janela: number; job_id: Id; base_id: Id; saida: unknown }): Promise<void> {
  await cliente.query(`INSERT INTO revisao_janela (execucao_id, secao_id, janela, job_id, base_id, saida) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (execucao_id, secao_id, janela) DO NOTHING`,
  [janela.execucao_id, janela.secao_id, janela.janela, janela.job_id, janela.base_id, JSON.stringify(janela.saida)]);
}

export async function janelasDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<{ janela: number; job_id: Id; saida: unknown }[]> {
  return (await cliente.query<{ janela: number; job_id: Id; saida: unknown }>(`SELECT janela, job_id, saida FROM revisao_janela
    WHERE execucao_id=$1 AND secao_id=$2 ORDER BY janela`, [execucaoId, secaoId])).rows;
}

// ---------------------------------------------------------------- preparação

/** Registra o pedido (ou sobe a prioridade) e devolve a prioridade vigente do capítulo. */
export async function pedirPreparacao(cliente: Transacao, execucaoId: Id, secaoId: Id, prioridade: number): Promise<number> {
  const linha = (await cliente.query<{ prioridade: number }>(`INSERT INTO preparacao_capitulo (execucao_id, secao_id, prioridade) VALUES ($1,$2,$3)
    ON CONFLICT (execucao_id, secao_id) DO UPDATE SET prioridade = GREATEST(preparacao_capitulo.prioridade, EXCLUDED.prioridade)
    RETURNING prioridade`, [execucaoId, secaoId, prioridade])).rows[0];
  return linha?.prioridade ?? prioridade;
}

export async function prioridadeDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<number | null> {
  return (await cliente.query<{ prioridade: number }>('SELECT prioridade FROM preparacao_capitulo WHERE execucao_id=$1 AND secao_id=$2',
    [execucaoId, secaoId])).rows[0]?.prioridade ?? null;
}

export async function capitulosPedidos(cliente: Transacao, execucaoId: Id): Promise<Set<Id>> {
  return new Set((await cliente.query<{ secao_id: Id }>('SELECT secao_id FROM preparacao_capitulo WHERE execucao_id=$1', [execucaoId]))
    .rows.map((linha) => linha.secao_id));
}

// ---------------------------------------------------------------- projeção, plano, perfil, adoção

export async function gravarMarcaElemento(cliente: Transacao, marcaId: Id, elementoId: Id, modeloId: Id, regra: string): Promise<void> {
  await cliente.query('INSERT INTO marca_elemento (marca_id, elemento_id, modelo_id, regra) VALUES ($1,$2,$3,$4)', [marcaId, elementoId, modeloId, regra]);
}

export async function marcasDoModelo(cliente: Transacao, modeloId: Id): Promise<{ marca_id: Id; elemento_id: Id }[]> {
  return (await cliente.query<{ marca_id: Id; elemento_id: Id }>('SELECT marca_id, elemento_id FROM marca_elemento WHERE modelo_id=$1', [modeloId])).rows;
}

export async function gravarPlano(cliente: Transacao, entrada: PlanoPedagogicoV1): Promise<PlanoPedagogicoV1> {
  conferirOrcamento(entrada, ORCAMENTOS.plano);
  const plano = structuredClone(entrada);
  const local = contratoPlanoPedagogico.validarLocal(plano);
  if (!local.ok) throw new Error(`Plano pedagógico inválido: ${JSON.stringify(local.erros.slice(0, 3))}`);
  // Modelo, versão e capítulo são imutáveis. O lock serializa deduplicação por perfil.
  await cliente.query('SELECT id FROM modelo_capitulo WHERE id=$1 FOR UPDATE', [plano.modelo_id]);
  const modelo = await obterModelo(cliente, plano.modelo_id);
  const execucao = await obterExecucao(cliente, plano.execucao_id);
  if (!modelo || !execucao || modelo.versao_id !== execucao.versao_id) throw new Error('Plano fora da versão da execução.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  const secao = versao.canonico.secoes.find(s => s.id === plano.secao_id && s.nivel === 1);
  if (!secao) throw new Error('Capítulo do plano ausente.');
  const inicio = versao.canonico.blocos.findIndex(b => b.id === secao.bloco_inicio);
  const fim = versao.canonico.blocos.findIndex(b => b.id === secao.bloco_fim);
  const conferido = conferirPlanoNoModelo(plano, modelo, versao.canonico.blocos.slice(inicio, fim + 1));
  if (!conferido.ok) throw new Error(`Plano contextual inválido: ${JSON.stringify(conferido.erros)}`);
  const equivalentes = await hashesCompativeisDoPerfil(cliente, plano.perfil_hash);
  const existente = await cliente.query<{ conteudo: PlanoPedagogicoV1 }>('SELECT conteudo FROM plano_pedagogico WHERE modelo_id=$1 AND perfil_hash = ANY($2::text[]) ORDER BY criado_em,id LIMIT 1', [plano.modelo_id, equivalentes]);
  if (existente.rows[0]) return existente.rows[0].conteudo;
  await cliente.query(`INSERT INTO plano_pedagogico (id, execucao_id, secao_id, modelo_id, perfil_hash, conteudo, criado_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (modelo_id, perfil_hash) DO NOTHING`,
  [plano.id, plano.execucao_id, plano.secao_id, plano.modelo_id, plano.perfil_hash, JSON.stringify(plano), plano.criado_em]);
  return plano;
}

/** O plano mais recente do capítulo; com `perfilHash`, só o desse perfil. */
export async function planoDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id, perfilHash?: string): Promise<PlanoPedagogicoV1 | null> {
  const hashes = perfilHash === undefined ? null : await hashesCompativeisDoPerfil(cliente, perfilHash);
  return (await cliente.query<{ conteudo: PlanoPedagogicoV1 }>(`SELECT conteudo FROM plano_pedagogico
    WHERE execucao_id=$1 AND secao_id=$2 AND ($3::text[] IS NULL OR perfil_hash = ANY($3::text[])) ORDER BY criado_em DESC, id DESC LIMIT 1`,
  [execucaoId, secaoId, hashes])).rows[0]?.conteudo ?? null;
}

export async function obterPlano(cliente: Transacao, planoId: Id): Promise<PlanoPedagogicoV1 | null> {
  return (await cliente.query<{ conteudo: PlanoPedagogicoV1 }>('SELECT conteudo FROM plano_pedagogico WHERE id=$1', [planoId])).rows[0]?.conteudo ?? null;
}

/** Resolve hashes atuais ou históricos sem reescrever revisões do perfil. */
export async function perfilPeloHash(cliente: Transacao, hash: string): Promise<PerfilDoLeitorV1 | null> {
  if (hashesDoPerfil(null).includes(hash)) return null;
  const perfis = (await cliente.query<{ conteudo: PerfilDoLeitorV1; hash: string }>('SELECT conteudo,hash FROM perfil_leitor ORDER BY revisao DESC')).rows;
  const achado = perfis.find(p => p.hash === hash || hashesDoPerfil(p.conteudo).includes(hash));
  if (!achado) throw new Error('Perfil do leitor do plano não encontrado.');
  return achado.conteudo;
}
export async function hashesCompativeisDoPerfil(cliente: Transacao, hash: string): Promise<string[]> {
  const perfil = await perfilPeloHash(cliente, hash);
  const identidade = hashDoPerfil(perfil);
  const perfis = (await cliente.query<{ conteudo: PerfilDoLeitorV1; hash: string }>('SELECT conteudo,hash FROM perfil_leitor')).rows;
  return [...new Set([hash, ...hashesDoPerfil(perfil), ...perfis.filter(p => hashDoPerfil(p.conteudo) === identidade)
    .flatMap(p => [p.hash, ...hashesDoPerfil(p.conteudo)])])];
}

export async function perfilAtual(cliente: Transacao): Promise<PerfilDoLeitorV1 | null> {
  return (await cliente.query<{ conteudo: PerfilDoLeitorV1 }>('SELECT conteudo FROM perfil_leitor ORDER BY revisao DESC LIMIT 1')).rows[0]?.conteudo ?? null;
}

/** Grava uma revisão nova do perfil (a seguinte à atual) e a devolve. */
export async function gravarPerfil(
  cliente: Transacao, perfil: Omit<PerfilDoLeitorV1, 'revisao' | 'atualizado_em' | 'versao'>, agora = new Date(),
): Promise<PerfilDoLeitorV1> {
  await cliente.query('LOCK TABLE perfil_leitor IN SHARE ROW EXCLUSIVE MODE');
  const atual = await perfilAtual(cliente);
  const novo: PerfilDoLeitorV1 = {
    versao: 1, revisao: atual === null ? 0 : atual.revisao + 1, areas: perfil.areas, preferencias: perfil.preferencias,
    observacoes: perfil.observacoes, atualizado_em: agora.toISOString(),
  };
  if (!validarPerfilDoLeitor(novo)) throw new Error(`Perfil do leitor inválido: ${JSON.stringify(validarPerfilDoLeitor.errors?.slice(0, 3))}`);
  await cliente.query('INSERT INTO perfil_leitor (revisao, conteudo, hash) VALUES ($1,$2,$3)', [novo.revisao, JSON.stringify(novo), hashDoPerfil(novo)]);
  return novo;
}

export async function gravarAdocao(cliente: Transacao, relacaoId: Id, modeloId: Id, conexaoId: Id, tipoOriginal: string): Promise<void> {
  await cliente.query('INSERT INTO relacao_adotada (relacao_id, modelo_id, conexao_id, tipo_original) VALUES ($1,$2,$3,$4)',
    [relacaoId, modeloId, conexaoId, tipoOriginal]);
}

export async function adocoes(cliente: Transacao, relacoes: readonly Id[]): Promise<Map<Id, Id>> {
  if (relacoes.length === 0) return new Map();
  const linhas = (await cliente.query<{ relacao_id: Id; conexao_id: Id }>('SELECT relacao_id, conexao_id FROM relacao_adotada WHERE relacao_id = ANY($1::text[])',
    [[...relacoes]])).rows;
  return new Map(linhas.map((linha) => [linha.relacao_id, linha.conexao_id]));
}

/** Os jobs de uma execução com o tempo de trabalho de cada um: da última reserva à publicação. */
export async function temposDosJobs(cliente: Transacao, execucaoId: Id): Promise<{ dedup_key: string; estado: string; segundos: number | null; publicado_em: Date | null }[]> {
  return (await cliente.query<{ dedup_key: string; estado: string; segundos: number | null; publicado_em: Date | null }>(`
    SELECT j.dedup_key, j.estado, p.quando AS publicado_em,
      EXTRACT(EPOCH FROM p.quando - (SELECT max(r.quando) FROM evento_job r WHERE r.job_id = j.id AND r.tipo = 'reservado' AND r.quando <= p.quando))::float8 AS segundos
    FROM job j
    LEFT JOIN LATERAL (SELECT max(quando) AS quando FROM evento_job e WHERE e.job_id = j.id AND e.tipo = 'publicado') p ON true
    WHERE split_part(j.dedup_key, ':', 2) = $1`, [execucaoId])).rows;
}

/** Quando cada capítulo foi pedido pela primeira vez. */
export async function pedidosDePreparacao(cliente: Transacao, execucaoId: Id): Promise<Map<Id, Date>> {
  const linhas = (await cliente.query<{ secao_id: Id; pedida_em: Date }>('SELECT secao_id, pedida_em FROM preparacao_capitulo WHERE execucao_id=$1', [execucaoId])).rows;
  return new Map(linhas.map((linha) => [linha.secao_id, linha.pedida_em]));
}
