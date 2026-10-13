/**
 * Job `gerar_esquema`: o mapa esquemático do capítulo, gerado uma vez a partir do modelo da
 * compreensão (a revisão mais alta do capítulo no momento do pedido).
 *
 * - Fila: `dedup_key = esquema:<compreensão>:<seção>:<esquema>`; o id do esquema nasce no pedido.
 *   Gerar de novo é um pedido novo; os anteriores continuam guardados.
 * - Execução (fora de transação): o Codex recebe o modelo em texto com apelidos (`E1`, `U1`) e
 *   devolve grupos, nós e ligações. O serviço traduz os apelidos, confere a estrutura e, se ela
 *   vier incoerente, chama de novo **uma vez** com o erro. Cada nó ganha a âncora principal do
 *   elemento que resume; sem elemento, a citação literal é resolvida no bloco apontado (ausente
 *   ou ambígua vira diagnóstico, nunca a primeira ocorrência).
 * - Publicação: grava o JSON conferido na pasta da versão, na transação que fecha a tentativa.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import {
  MODO_F1, TIPOS_DO_NO_DO_ESQUEMA, validarEsquemaDoCapitulo, type AncoraV1, type Bloco, type EsquemaDoCapituloV1, type Id,
  type JobResultV1, type ModeloDoCapituloV1, type NoDoEsquemaV1, type TipoDoNoDoEsquema,
} from '@margem/contratos';
import { ancoraDeSelecao, resolverCitacao } from '@margem/core';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { modoOuNada } from '../modos.js';
import * as compreensaoRepo from '../repos/compreensao.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { blocosDaSecao } from '../visuais/manipuladores.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { gravarEsquema, lerEsquema } from './arquivos.js';
import { montarPromptDoEsquema, VERSAO_PROMPT_ESQUEMA, type ApelidosDoModelo, type ContextoDoEsquema, type Correcao } from './prompts.js';

export const TIPO_GERAR_ESQUEMA = 'gerar_esquema';
/** Um capítulo longo leva de 1 a 4 minutos no esforço medium. */
export const PRAZO_DO_ESQUEMA_MS = 900_000;

export interface ConfiguracaoDoEsquema {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoMs?: number;
  diretorioArtefatos?: string;
}

type Diagnostico = EsquemaDoCapituloV1['diagnosticos'][number];

// ---------------------------------------------------------------- fila

export interface ChaveDoEsquema { compreensaoId: Id; secaoId: Id; esquemaId: Id }
export const prefixoDoEsquema = (compreensaoId: Id, secaoId: Id): string => `esquema:${compreensaoId}:${secaoId}:`;
export const chaveDoEsquema = (chave: ChaveDoEsquema): string => `${prefixoDoEsquema(chave.compreensaoId, chave.secaoId)}${chave.esquemaId}`;
export function lerChaveDoEsquema(dedupKey: string): ChaveDoEsquema {
  const [prefixo, compreensaoId, secaoId, esquemaId, ...resto] = dedupKey.split(':');
  if (prefixo !== 'esquema' || !compreensaoId || !secaoId || !esquemaId || resto.length > 0) throw new Error(`Chave de esquema malformada: ${dedupKey}`);
  return { compreensaoId, secaoId, esquemaId };
}

export type EstadoDoEsquema = 'nenhum' | 'pendente' | 'executando' | 'pronto' | 'falhou';
export interface SituacaoDoEsquema {
  estado: EstadoDoEsquema;
  /** O pedido mais recente (o que está em curso, o que falhou ou o pronto). */
  pedido_id: Id | null;
  motivo?: string;
  aviso?: string;
  /** O esquema pronto mais recente (pode existir enquanto um novo é gerado ou depois de uma falha). */
  pronto: { esquema_id: Id; job_id: Id } | null;
}

interface LinhaDoJob { id: Id; dedup_key: string; estado: jobsRepo.EstadoJob; diagnosticos: JobResultV1['diagnosticos']; error_code: string | null; not_before: Date | null }

const MOTIVOS: Record<string, string> = {
  timeout: 'O Codex passou do prazo.', cancelado: 'O pedido foi cancelado.', auth: 'A conta do Codex está sem sessão válida.',
  schema: 'A resposta do Codex veio fora do formato.', json_invalido: 'A resposta do Codex veio truncada.', processo: 'O Codex terminou com erro.',
};

/** O estado vem dos jobs do capítulo, do mais novo para o mais antigo. */
export async function situacaoDoEsquema(cliente: Transacao, compreensaoId: Id, secaoId: Id): Promise<SituacaoDoEsquema> {
  const linhas = (await cliente.query<LinhaDoJob>(`SELECT id, dedup_key, estado, diagnosticos, error_code, not_before FROM job
    WHERE tipo=$1 AND starts_with(dedup_key, $2) ORDER BY criado_em DESC, id DESC`, [TIPO_GERAR_ESQUEMA, prefixoDoEsquema(compreensaoId, secaoId)])).rows;
  const ultimo = linhas[0];
  const ok = linhas.find((linha) => linha.estado === 'ok');
  const pronto = ok ? { esquema_id: lerChaveDoEsquema(ok.dedup_key).esquemaId, job_id: ok.id } : null;
  if (!ultimo) return { estado: 'nenhum', pedido_id: null, pronto: null };
  const pedido_id = lerChaveDoEsquema(ultimo.dedup_key).esquemaId;
  switch (ultimo.estado) {
    case 'ok': return { estado: 'pronto', pedido_id, pronto };
    case 'fila': return { estado: 'pendente', pedido_id, pronto };
    case 'adiado': return { estado: 'pendente', pedido_id, pronto,
      aviso: ultimo.not_before ? `Cota do Codex esgotada; volta a tentar em ${ultimo.not_before.toISOString()}.` : 'Adiado pela fila.' };
    case 'reservado': return { estado: 'executando', pedido_id, pronto };
    default: {
      const diagnostico = ultimo.diagnosticos.find((item) => item.nivel === 'erro') ?? ultimo.diagnosticos[0];
      const motivo = diagnostico?.mensagem ?? (ultimo.error_code === null ? undefined : MOTIVOS[ultimo.error_code]) ?? 'O Codex não conseguiu gerar o esquema.';
      return { estado: 'falhou', pedido_id, pronto, motivo: motivo.slice(0, 1000) };
    }
  }
}

export class EsquemaEmCurso extends Error {
  constructor() { super('Já há um esquema sendo gerado para este capítulo.'); this.name = 'EsquemaEmCurso'; }
}

/** Enfileira um pedido novo (recusa se outro está em curso). Devolve o id do esquema pedido. */
export async function pedirEsquema(cliente: Transacao, entrada: { compreensaoId: Id; secaoId: Id; versaoId: Id }): Promise<{ esquema_id: Id; job: jobsRepo.Job }> {
  // Serializa pedidos do mesmo capítulo: dois cliques simultâneos não geram dois jobs.
  await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [prefixoDoEsquema(entrada.compreensaoId, entrada.secaoId)]);
  const situacao = await situacaoDoEsquema(cliente, entrada.compreensaoId, entrada.secaoId);
  if (situacao.estado === 'pendente' || situacao.estado === 'executando') throw new EsquemaEmCurso();
  const esquemaId = ulid();
  const dedup_key = chaveDoEsquema({ compreensaoId: entrada.compreensaoId, secaoId: entrada.secaoId, esquemaId });
  const job = await jobsRepo.enfileirar(cliente, {
    tipo: TIPO_GERAR_ESQUEMA, dedup_key, input_snapshot_hash: sha256(dedup_key), versao_id: entrada.versaoId,
    prioridade: jobsRepo.PRIORIDADE.artefato_pedido,
  });
  return { esquema_id: esquemaId, job };
}

/** O esquema pronto mais recente do capítulo, lido do disco. */
export async function esquemaPronto(cliente: Transacao, compreensaoId: Id, secaoId: Id, situacao: SituacaoDoEsquema): Promise<EsquemaDoCapituloV1 | null> {
  if (situacao.pronto === null) return null;
  const execucao = await compreensaoRepo.obterExecucao(cliente, compreensaoId);
  if (!execucao) return null;
  const documento = (await cliente.query<{ documento_id: Id }>('SELECT documento_id FROM versao_texto WHERE id=$1', [execucao.versao_id])).rows[0];
  if (!documento) return null;
  return lerEsquema(documento.documento_id, execucao.versao_id, compreensaoId, secaoId, situacao.pronto.esquema_id);
}

// ---------------------------------------------------------------- saída do modelo

export interface SaidaDoEsquema {
  titulo: string;
  grupos: { id: string; titulo: string; resumo: string }[];
  nos: { id: string; rotulo: string; tipo: string; grupo: string; detalhe: string; elemento: string | null; citacao: { bloco_id: string; texto: string } | null }[];
  ligacoes: { de: string; para: string; rotulo: string; forca: string }[];
}

const texto = (valor: unknown): valor is string => typeof valor === 'string';
function ehSaidaDoEsquema(valor: unknown): valor is SaidaDoEsquema {
  const v = valor as Partial<SaidaDoEsquema> | null;
  return v !== null && typeof v === 'object' && texto(v.titulo) && Array.isArray(v.grupos) && Array.isArray(v.nos) && Array.isArray(v.ligacoes)
    && v.grupos.every((g) => typeof g === 'object' && g !== null && texto(g.id) && texto(g.titulo) && texto(g.resumo))
    && v.nos.every((n) => typeof n === 'object' && n !== null && texto(n.id) && texto(n.rotulo) && texto(n.tipo) && texto(n.grupo) && texto(n.detalhe)
      && (n.elemento === null || texto(n.elemento))
      && (n.citacao === null || (typeof n.citacao === 'object' && texto(n.citacao.bloco_id) && texto(n.citacao.texto))))
    && v.ligacoes.every((l) => typeof l === 'object' && l !== null && texto(l.de) && texto(l.para) && texto(l.rotulo) && texto(l.forca));
}

const limpo = (valor: string, maximo: number): string => valor.replace(/\s+/gu, ' ').trim().slice(0, maximo).trim();

/** Erros que pedem uma segunda chamada: a estrutura não se sustenta. `null` quando passa. */
export function erroDoEsquema(saida: SaidaDoEsquema): string | null {
  const grupos = saida.grupos.map((grupo) => grupo.id);
  if (new Set(grupos).size !== grupos.length) return 'há ids de grupo repetidos';
  const nos = saida.nos.map((no) => no.id);
  if (new Set(nos).size !== nos.length) return 'há ids de nó repetidos';
  if (saida.nos.length < 3) return 'o esquema precisa de pelo menos 3 nós';
  if (saida.nos.length > 30) return `são ${String(saida.nos.length)} nós; o máximo é 30 (o esquema resume)`;
  const semGrupo = saida.nos.filter((no) => !grupos.includes(no.grupo)).map((no) => no.id);
  if (semGrupo.length > 0) return `nós em grupos que não existem: ${semGrupo.join(', ')}`;
  const tipos = saida.nos.filter((no) => !(TIPOS_DO_NO_DO_ESQUEMA as readonly string[]).includes(no.tipo)).map((no) => no.id);
  if (tipos.length > 0) return `nós com tipo desconhecido: ${tipos.join(', ')}`;
  const vazios = saida.nos.filter((no) => limpo(no.rotulo, 80) === '').map((no) => no.id);
  if (vazios.length > 0) return `nós sem rótulo: ${vazios.join(', ')}`;
  return null;
}

/** A âncora do nó: a principal do elemento; sem elemento, a citação resolvida no bloco (só os do capítulo). */
function ancoraDoNo(
  no: SaidaDoEsquema['nos'][number], apelidos: ApelidosDoModelo, blocos: ReadonlyMap<Id, Bloco>, versaoId: Id, diagnosticos: Diagnostico[],
): { elemento_id?: Id; ancora?: AncoraV1 } {
  if (no.elemento !== null) {
    const elemento = apelidos.elementos.get(no.elemento);
    if (elemento) {
      const ancora = elemento.ancoras[0];
      return ancora && ancora.versao_id === versaoId ? { elemento_id: elemento.id, ancora } : { elemento_id: elemento.id };
    }
    diagnosticos.push({ codigo: 'elemento_inexistente', mensagem: `Nó ${no.id}: o elemento ${no.elemento} não existe no modelo; ficou sem trecho.` });
  }
  if (no.citacao === null) return {};
  const bloco = blocos.get(no.citacao.bloco_id);
  if (!bloco) {
    diagnosticos.push({ codigo: 'citacao_fora_do_texto', mensagem: `Nó ${no.id}: a citação aponta um bloco fora do capítulo; ficou sem trecho.` });
    return {};
  }
  const resolvida = resolverCitacao({ ...bloco, versao_id: versaoId }, { citacao: no.citacao.texto });
  if (!resolvida.ok) {
    diagnosticos.push(resolvida.motivo === 'ambigua'
      ? { codigo: 'citacao_ambigua', mensagem: `Nó ${no.id}: a citação aparece ${String(resolvida.ocorrencias)} vezes no bloco; ficou sem trecho.` }
      : { codigo: 'citacao_ausente', mensagem: `Nó ${no.id}: a citação não está literalmente no bloco; ficou sem trecho.` });
    return {};
  }
  return { ancora: ancoraDeSelecao({ ...bloco, versao_id: versaoId }, resolvida.ancora.inicio_utf16, resolvida.ancora.fim_utf16) };
}

export interface MetaDoEsquema {
  id: Id; versao_id: Id; secao_id: Id; compreensao_id: Id; modelo_id: Id;
  execucao: EsquemaDoCapituloV1['execucao']; criado_em: string;
}

/**
 * Saída do modelo (já sem erro estrutural) → `EsquemaDoCapituloV1`. O que é só descuido vira
 * diagnóstico e sai do esquema: ligação a nó inexistente, laço, par repetido, grupo vazio.
 */
export function montarEsquema(
  saida: SaidaDoEsquema, apelidos: ApelidosDoModelo, blocosDoCapitulo: readonly Bloco[], meta: MetaDoEsquema, anteriores: Diagnostico[] = [],
): EsquemaDoCapituloV1 {
  const diagnosticos: Diagnostico[] = [...anteriores];
  const blocos = new Map(blocosDoCapitulo.map((bloco) => [bloco.id, bloco]));
  const nos = saida.nos.map((no): NoDoEsquemaV1 => {
    const detalhe = limpo(no.detalhe, 400);
    return {
      id: no.id, rotulo: limpo(no.rotulo, 80), tipo: no.tipo as TipoDoNoDoEsquema, grupo_id: no.grupo,
      ...(detalhe === '' ? {} : { detalhe }),
      ...ancoraDoNo(no, apelidos, blocos, meta.versao_id, diagnosticos),
    };
  });
  const usados = new Set(nos.map((no) => no.grupo_id));
  const grupos = saida.grupos.filter((grupo) => {
    if (usados.has(grupo.id)) return true;
    diagnosticos.push({ codigo: 'grupo_vazio', mensagem: `O grupo ${grupo.id} (“${limpo(grupo.titulo, 80)}”) veio sem nós e saiu do esquema.` });
    return false;
  }).map((grupo) => {
    const resumo = limpo(grupo.resumo, 300);
    return { id: grupo.id, titulo: limpo(grupo.titulo, 80) || grupo.id, ...(resumo === '' ? {} : { resumo }) };
  });
  const ids = new Set(nos.map((no) => no.id));
  const pares = new Set<string>();
  const ligacoes = saida.ligacoes.flatMap((ligacao) => {
    const par = `${ligacao.de}→${ligacao.para}`;
    if (!ids.has(ligacao.de) || !ids.has(ligacao.para) || ligacao.de === ligacao.para || pares.has(par)) {
      diagnosticos.push({ codigo: 'ligacao_descartada', mensagem: `Ligação ${par} descartada (nó inexistente, laço ou repetida).` });
      return [];
    }
    pares.add(par);
    const rotulo = limpo(ligacao.rotulo, 40);
    return [{ de: ligacao.de, para: ligacao.para, ...(rotulo === '' ? {} : { rotulo }), forca: ligacao.forca === 'fraca' ? 'fraca' as const : 'forte' as const }];
  });
  return {
    versao: 1, id: meta.id, versao_id: meta.versao_id, secao_id: meta.secao_id, compreensao_id: meta.compreensao_id, modelo_id: meta.modelo_id,
    titulo: limpo(saida.titulo, 200) || 'Esquema do capítulo', grupos, nos, ligacoes, diagnosticos, execucao: meta.execucao, criado_em: meta.criado_em,
  };
}

// ---------------------------------------------------------------- execução

interface Entrada { chave: ChaveDoEsquema; documentoId: Id; versaoId: Id; modelo: ModeloDoCapituloV1; blocos: Bloco[]; contexto: ContextoDoEsquema }

async function montarEntrada(cliente: Transacao, chave: ChaveDoEsquema): Promise<Entrada | string> {
  const execucao = await compreensaoRepo.obterExecucao(cliente, chave.compreensaoId);
  if (!execucao) return 'A compreensão do esquema não existe.';
  const versao = await obterVersao(cliente, execucao.versao_id);
  const secao = versao.canonico.secoes.find((candidata) => candidata.id === chave.secaoId);
  if (!secao) return 'O capítulo do esquema não existe na versão.';
  const modelo = await compreensaoRepo.revisaoDoCapitulo(cliente, chave.compreensaoId, chave.secaoId);
  if (!modelo) return 'O capítulo ainda não tem o modelo da compreensão.';
  const modo = modoOuNada(execucao.modo) ?? modoOuNada(MODO_F1);
  return {
    chave, documentoId: versao.documento_id, versaoId: versao.id, modelo, blocos: blocosDaSecao(versao.canonico, secao),
    contexto: { documento: versao.canonico.documento.titulo, capitulo: secao.titulo, modo: modo?.nome ?? execucao.modo.id },
  };
}

async function chamar(config: ConfiguracaoDoEsquema, prompt: { prompt: string; schema: unknown }, sinal: AbortSignal): Promise<ResultadoExecutor> {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-esquema-'));
  try {
    const preparada = await prepararEntrada(raiz, prompt.prompt, prompt.schema);
    return await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? PRAZO_DO_ESQUEMA_MS, modelo: config.modelo, esforco: config.esforco, sinal,
      ...(config.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: join(config.diretorioArtefatos, 'saidas') }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

/** O que `executar` deixa em disco para `publicar` ler. */
interface ArtefatoDoEsquema { documento_id: Id; esquema: EsquemaDoCapituloV1 }

async function gravarArtefato(config: ConfiguracaoDoEsquema, tarefa: Tarefa, artefato: ArtefatoDoEsquema): Promise<{ caminho: string; hash: string }> {
  const conteudo = `${JSON.stringify(artefato, null, 2)}\n`;
  const pasta = join(config.diretorioArtefatos ?? join(homedir(), '.cache/margem/esquemas'), `esquema-${artefato.esquema.id}`);
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const caminho = join(pasta, `tentativa-${String(tarefa.job.attempt)}-${ulid()}.json`);
  await writeFile(caminho, conteudo, { mode: 0o600 });
  return { caminho, hash: sha256(conteudo) };
}

export async function executarEsquema(config: ConfiguracaoDoEsquema, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const chave = lerChaveDoEsquema(entradaDoJob(tarefa.job.entrada).dedup_key);
  const entrada = await comTransacao(config.banco, (cliente) => montarEntrada(cliente, chave));
  if (typeof entrada === 'string') return falhou('desconhecido', entrada, Date.now() - inicio);
  let correcao: Correcao | null = null;
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    if (tarefa.sinal.aborted) return falhou('cancelado', 'Job cancelado.', Date.now() - inicio);
    const prompt = montarPromptDoEsquema(entrada.contexto, entrada.modelo, entrada.blocos, correcao);
    const resultado = await chamar(config, prompt, tarefa.sinal);
    if (resultado.estado !== 'ok') return resultado;
    const bruto: unknown = JSON.parse(await readFile(resultado.artefato, 'utf8'));
    if (!ehSaidaDoEsquema(bruto)) return falhou('schema', 'Resposta fora do schema do esquema.', Date.now() - inicio);
    const erro = erroDoEsquema(bruto);
    if (erro === null) {
      const anteriores: Diagnostico[] = correcao === null ? []
        : [{ codigo: 'esquema_corrigido', mensagem: `A primeira resposta foi recusada (${correcao.erro}); valeu a segunda.` }];
      const esquema = montarEsquema(bruto, prompt.apelidos, entrada.blocos, {
        id: chave.esquemaId, versao_id: entrada.versaoId, secao_id: chave.secaoId, compreensao_id: chave.compreensaoId, modelo_id: entrada.modelo.id,
        execucao: { modelo: resultado.modelo, esforco: resultado.esforco ?? config.esforco, prompt_versao: VERSAO_PROMPT_ESQUEMA },
        criado_em: new Date().toISOString(),
      }, anteriores);
      if (!validarEsquemaDoCapitulo(esquema)) {
        return falhou('schema', `O esquema montado não passou no contrato: ${JSON.stringify(validarEsquemaDoCapitulo.errors).slice(0, 400)}`, Date.now() - inicio);
      }
      const artefato = await gravarArtefato(config, tarefa, { documento_id: entrada.documentoId, esquema });
      return { estado: 'ok', artefato: artefato.caminho, sha256: artefato.hash, duracao_ms: Date.now() - inicio, modelo: resultado.modelo, esforco: resultado.esforco ?? config.esforco };
    }
    await registrarNaAuditoria(`esquema-recusado-${String(tentativa)}.json`, { erro, saida: bruto });
    if (correcao !== null) return falhou('schema', `O esquema veio incoerente duas vezes. Último erro: ${erro}.`, Date.now() - inicio);
    correcao = { erro };
  }
  return falhou('desconhecido', 'Esquema sem desfecho.', Date.now() - inicio);
}

export async function publicarEsquema(cliente: Transacao, execucao: ExecucaoOk): Promise<Diagnostico[]> {
  const artefato = JSON.parse(await readFile(execucao.artefato, 'utf8')) as Partial<ArtefatoDoEsquema>;
  if (typeof artefato.documento_id !== 'string' || !validarEsquemaDoCapitulo(artefato.esquema)) throw new Error('Artefato do esquema inválido.');
  const { esquema } = artefato;
  // O modelo de que o esquema saiu continua sendo do capítulo e da compreensão (revisões são imutáveis).
  const modelo = await compreensaoRepo.obterModelo(cliente, esquema.modelo_id);
  if (!modelo || modelo.secao_id !== esquema.secao_id || modelo.execucao_id !== esquema.compreensao_id) throw new Error('O esquema não é do modelo do capítulo.');
  await gravarEsquema(artefato.documento_id, esquema);
  await registrarNaAuditoria('esquema.publicado.json', esquema);
  return esquema.diagnosticos;
}

export function manipuladoresDoEsquema(config: ConfiguracaoDoEsquema): Record<string, Manipulador> {
  return {
    [TIPO_GERAR_ESQUEMA]: {
      executar: (tarefa) => executarEsquema(config, tarefa),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
        const diagnosticos = await publicarEsquema(exigirTransacao(contexto), execucao);
        return {
          job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
          estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
          diagnosticos: diagnosticos.map((d) => ({ nivel: 'aviso' as const, codigo: d.codigo, mensagem: d.mensagem })),
        };
      },
    },
  };
}
