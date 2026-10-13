/**
 * Job `roteirizar_visita` (J91): o roteiro narrado da visita guiada de um capítulo. O worker monta o
 * prompt (modelo r2, plano, notas do leitor, visuais, capítulos vizinhos), chama o Codex fora de
 * transação e publica o roteiro resolvido na transação que fecha a tentativa.
 *
 * A chave `visita:<execução>:<seção>:<modelo>:<perfil>` torna o pedido idempotente: a mesma revisão
 * do modelo com o mesmo perfil só gera um roteiro.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { AncoraV1, Id, JobResultV1, RoteiroGuiadoV1, VisualV1 } from '@margem/contratos';
import { TabelaDeAliases, aliasesDeEntradas, aliasesParaAuditoria } from '@margem/core';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { capituloDe } from '../compreensao/pipeline.js';
import { hashDoPerfil } from '../compreensao/perfil.js';
import * as anotacoesRepo from '../repos/anotacoes.js';
import * as compreensaoRepo from '../repos/compreensao.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as marcasRepo from '../repos/marcas.js';
import * as visuaisRepo from '../repos/visuais.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { PROMPT_DA_VISITA, idDaNota, montarPromptDaVisita, type EntradaDaVisita, type NotaDoLeitor, type SaidaDaVisita } from './prompts.js';
import * as repo from './repo.js';
import { resolverRoteiro } from './roteiro.js';

export const TIPO_ROTEIRIZAR_VISITA = 'roteirizar_visita';
/** Um capítulo longo leva alguns minutos com `medium`; o teto cobre o maior do ESM com folga. */
export const PRAZO_DA_VISITA_MS = 1_200_000;

export interface ConfiguracaoDaVisita {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoMs?: number;
  diretorioArtefatos?: string;
  novoId?: () => Id;
  agora?: () => Date;
}

// ---------------------------------------------------------------- chave e fila

export interface ChaveDaVisita { execucao_id: Id; secao_id: Id; modelo_id: Id; perfil_hash: string }
export const chaveDaVisita = (c: ChaveDaVisita): string => `visita:${c.execucao_id}:${c.secao_id}:${c.modelo_id}:${c.perfil_hash}`;
export function lerChaveDaVisita(dedupKey: string): ChaveDaVisita {
  const [prefixo, execucao, secao, modelo, ...perfil] = dedupKey.split(':');
  if (prefixo !== 'visita' || !execucao || !secao || !modelo || perfil.length === 0) throw new Error(`Chave de visita malformada: ${dedupKey}`);
  return { execucao_id: execucao, secao_id: secao, modelo_id: modelo, perfil_hash: perfil.join(':') };
}

export class CapituloSemModelo extends Error {
  constructor() { super('O capítulo ainda não tem a compreensão pronta (revisão final do modelo).'); this.name = 'CapituloSemModelo'; }
}

/** Enfileira o roteiro do capítulo sobre a revisão final do modelo e o perfil atual. */
export async function pedirVisita(cliente: Transacao, execucaoId: Id, secaoId: Id, prioridade: number = jobsRepo.PRIORIDADE.artefato_pedido): Promise<jobsRepo.Job> {
  const execucao = await compreensaoRepo.obterExecucao(cliente, execucaoId);
  if (!execucao) throw new Error('Execução de compreensão inexistente.');
  const modelo = await compreensaoRepo.revisaoDoCapitulo(cliente, execucaoId, secaoId, 2);
  if (!modelo) throw new CapituloSemModelo();
  const perfil = hashDoPerfil(await compreensaoRepo.perfilAtual(cliente));
  const chave = chaveDaVisita({ execucao_id: execucaoId, secao_id: secaoId, modelo_id: modelo.id, perfil_hash: perfil });
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_ROTEIRIZAR_VISITA, dedup_key: chave, input_snapshot_hash: sha256(chave), versao_id: execucao.versao_id, prioridade,
  });
}

export type EstadoDaVisita = 'nao_preparada' | 'preparando' | 'pronta' | 'falhou';

/** Estado derivado do job mais recente do capítulo e do roteiro publicado. */
export async function estadoDaVisita(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<{ estado: EstadoDaVisita; roteiro: RoteiroGuiadoV1 | null }> {
  const roteiro = await repo.roteiroDoCapitulo(cliente, execucaoId, secaoId);
  const { rows: [job] } = await cliente.query<{ estado: string }>(
    `SELECT estado FROM job WHERE tipo=$1 AND dedup_key LIKE $2 ORDER BY criado_em DESC, id DESC LIMIT 1`,
    [TIPO_ROTEIRIZAR_VISITA, `visita:${execucaoId}:${secaoId}:%`]);
  const pendente = job !== undefined && ['fila', 'reservado', 'adiado'].includes(job.estado);
  if (pendente) return { estado: 'preparando', roteiro };
  if (roteiro) return { estado: 'pronta', roteiro };
  return { estado: job?.estado === 'falhou' ? 'falhou' : 'nao_preparada', roteiro: null };
}

// ---------------------------------------------------------------- entrada do prompt

interface Contexto {
  chave: ChaveDaVisita;
  versaoId: Id;
  entrada: EntradaDaVisita;
  proximaSecao: Id | null;
}

async function montarContexto(cliente: Transacao, chave: ChaveDaVisita): Promise<Contexto> {
  const execucao = await compreensaoRepo.obterExecucao(cliente, chave.execucao_id);
  if (!execucao) throw new Error('Execução de compreensão inexistente.');
  const modelo = await compreensaoRepo.obterModelo(cliente, chave.modelo_id);
  if (!modelo || modelo.secao_id !== chave.secao_id || modelo.execucao_id !== execucao.id) throw new Error('Revisão do modelo incompatível com a visita.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  const capitulo = capituloDe(versao.canonico, chave.secao_id);
  const capitulos = versao.canonico.secoes.filter((secao) => secao.nivel === 1);
  const indice = capitulos.findIndex((secao) => secao.id === chave.secao_id);
  if (indice === -1) throw new Error('A seção da visita não é um capítulo.');
  const vizinho = async (secao: (typeof capitulos)[number] | undefined) => {
    if (!secao) return null;
    const dele = await compreensaoRepo.revisaoDoCapitulo(cliente, execucao.id, secao.id, 2);
    return { id: secao.id, titulo: secao.titulo, movimento: dele?.movimento?.texto ?? null };
  };
  const [anterior, proximo] = [await vizinho(capitulos[indice - 1]), await vizinho(capitulos[indice + 1])];
  const blocos = new Set(capitulo.blocos.map((bloco) => bloco.id));
  const anotacoes = await anotacoesRepo.listarNosBlocos(cliente, execucao.versao_id, [...blocos]);
  const grifos = (await marcasRepo.listarDoLeitor(cliente, execucao.versao_id)).filter((marca) => blocos.has(marca.ancora.bloco_id));
  const notas: NotaDoLeitor[] = [
    ...anotacoes.map((anotacao): NotaDoLeitor => ({ tipo: 'anotacao', anotacao })),
    ...grifos.map((marca): NotaDoLeitor => ({ tipo: 'grifo', marca })),
  ].sort((a, b) => {
    const pa = capitulo.blocos.findIndex((bloco) => bloco.id === (a.tipo === 'anotacao' ? a.anotacao.ancora : a.marca.ancora).bloco_id);
    const pb = capitulo.blocos.findIndex((bloco) => bloco.id === (b.tipo === 'anotacao' ? b.anotacao.ancora : b.marca.ancora).bloco_id);
    return pa - pb;
  });
  const visuais = (await visuaisRepo.doCapitulo(cliente, execucao.versao_id, chave.secao_id)).filter((visual) => visual.estado === 'pronto');
  const plano = await compreensaoRepo.planoDoCapitulo(cliente, execucao.id, chave.secao_id);
  const perfil = await compreensaoRepo.perfilPeloHash(cliente, chave.perfil_hash) ?? await compreensaoRepo.perfilAtual(cliente);
  return {
    chave, versaoId: execucao.versao_id, proximaSecao: proximo?.id ?? null,
    entrada: {
      livro: versao.canonico.documento.titulo, capitulo: capitulo.titulo, numero: indice + 1, total: capitulos.length,
      anterior: anterior && { titulo: anterior.titulo, movimento: anterior.movimento },
      proximo: proximo && { titulo: proximo.titulo, movimento: proximo.movimento },
      blocos: capitulo.blocos, modelo, plano, perfil, notas, visuais,
    },
  };
}

// ---------------------------------------------------------------- execução

/** O que `executar` deixa em disco para `publicar`: a saída bruta e as tabelas de aliases. */
interface ArtefatoDaVisita {
  chave: ChaveDaVisita;
  saida: SaidaDaVisita;
  aliases: ReturnType<typeof aliasesParaAuditoria>;
  notas: { alias: string; id: Id }[];
  visuais: { alias: string; id: Id }[];
  modelo: string;
  esforco: string;
}

function ehSaida(valor: unknown): valor is SaidaDaVisita {
  const v = valor as Partial<SaidaDaVisita> | null;
  return v !== null && typeof v === 'object' && typeof v.abertura === 'string' && Array.isArray(v.paradas) && typeof v.fechamento === 'string'
    && Array.isArray(v.perguntas) && typeof v.ponte === 'string';
}

export async function executarVisita(config: ConfiguracaoDaVisita, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const chave = lerChaveDaVisita(entradaDoJob(tarefa.job.entrada).dedup_key);
  const contexto = await comTransacao(config.banco, (cliente) => montarContexto(cliente, chave));
  if (tarefa.sinal.aborted) return falhou('cancelado', 'Job cancelado.', Date.now() - inicio);
  const montado = montarPromptDaVisita(contexto.entrada);
  await registrarNaAuditoria('aliases.json', { ...aliasesParaAuditoria(montado.aliases), notas: montado.notas.entradas(), visuais: montado.visuais.entradas() });
  const raiz = await mkdtemp(join(tmpdir(), 'margem-visita-'));
  let resultado: ResultadoExecutor;
  try {
    const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
    resultado = await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? PRAZO_DA_VISITA_MS, modelo: config.modelo, esforco: config.esforco, sinal: tarefa.sinal,
      ...(config.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: join(config.diretorioArtefatos, 'saidas') }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
  if (resultado.estado !== 'ok') return resultado;
  const bruto: unknown = JSON.parse(await readFile(resultado.artefato, 'utf8'));
  if (!ehSaida(bruto)) return falhou('schema', 'Resposta fora do schema do roteiro.', Date.now() - inicio);
  const artefato: ArtefatoDaVisita = {
    chave, saida: bruto, aliases: aliasesParaAuditoria(montado.aliases), notas: montado.notas.entradas(), visuais: montado.visuais.entradas(),
    modelo: resultado.modelo, esforco: resultado.esforco ?? config.esforco,
  };
  const texto = `${JSON.stringify(artefato, null, 2)}\n`;
  const pasta = join(config.diretorioArtefatos ?? join(homedir(), '.cache/margem/visitas'), `visita-${chave.secao_id}`);
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const caminho = join(pasta, `tentativa-${String(tarefa.job.attempt)}-${ulid()}.json`);
  await writeFile(caminho, texto, { mode: 0o600 });
  return { estado: 'ok', artefato: caminho, sha256: sha256(texto), duracao_ms: Date.now() - inicio, modelo: artefato.modelo, esforco: artefato.esforco };
}

// ---------------------------------------------------------------- publicação

function tabela(prefixo: string, largura: number, entradas: readonly { alias: string; id: Id }[]): TabelaDeAliases {
  const nova = new TabelaDeAliases(prefixo, largura);
  for (const { alias, id } of entradas) if (nova.registrar(id) !== alias) throw new Error(`Tabela ${prefixo} gravada fora de ordem.`);
  return nova;
}

export async function publicarVisita(config: ConfiguracaoDaVisita, cliente: Transacao, jobId: Id, execucaoOk: ExecucaoOk): Promise<RoteiroGuiadoV1> {
  const artefato = JSON.parse(await readFile(execucaoOk.artefato, 'utf8')) as ArtefatoDaVisita;
  const contexto = await montarContexto(cliente, artefato.chave);
  const ancorasDasNotas = new Map<Id, AncoraV1>(contexto.entrada.notas.map((nota) => [idDaNota(nota), nota.tipo === 'anotacao' ? nota.anotacao.ancora : nota.marca.ancora]));
  const visuaisPorId = new Map<Id, Pick<VisualV1, 'alvo'>>(contexto.entrada.visuais.map((visual) => [visual.id, visual]));
  const resolvido = resolverRoteiro(artefato.saida, {
    versaoId: contexto.versaoId, blocos: contexto.entrada.blocos, modelo: contexto.entrada.modelo,
    aliases: aliasesDeEntradas(artefato.aliases), notas: tabela('N', 1, artefato.notas), visuais: tabela('V', 1, artefato.visuais),
    ancorasDasNotas, visuaisPorId, temProximo: contexto.proximaSecao !== null,
  });
  const roteiro: RoteiroGuiadoV1 = {
    versao: 1, id: (config.novoId ?? ulid)(), execucao_id: artefato.chave.execucao_id, versao_id: contexto.versaoId, secao_id: artefato.chave.secao_id,
    modelo_id: artefato.chave.modelo_id, perfil_hash: artefato.chave.perfil_hash,
    capitulo: { titulo: contexto.entrada.capitulo, numero: contexto.entrada.numero, total: contexto.entrada.total },
    paradas: resolvido.paradas, falas: resolvido.falas, perguntas_finais: resolvido.perguntas_finais,
    proxima_secao_id: resolvido.falas.some((fala) => fala.papel === 'ponte') ? contexto.proximaSecao : null,
    diagnosticos: resolvido.diagnosticos,
    execucao: { modelo: artefato.modelo, esforco: artefato.esforco, prompt: PROMPT_DA_VISITA },
    job_id: jobId, criado_em: (config.agora ?? (() => new Date()))().toISOString(),
  };
  const gravado = await repo.gravarRoteiro(cliente, roteiro);
  await registrarNaAuditoria('resposta.validada.json', gravado);
  await registrarNaAuditoria('diagnosticos.json', resolvido.diagnosticos);
  return gravado;
}

export function manipuladoresDaVisita(config: ConfiguracaoDaVisita): Record<string, Manipulador> {
  return {
    [TIPO_ROTEIRIZAR_VISITA]: {
      executar: (tarefa) => executarVisita(config, tarefa),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
        const roteiro = await publicarVisita(config, exigirTransacao(contexto), contexto.job.id, execucao);
        return {
          job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
          estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
          diagnosticos: roteiro.diagnosticos.map((d) => ({ nivel: 'aviso' as const, codigo: d.codigo, mensagem: d.mensagem })),
        };
      },
    },
  };
}
