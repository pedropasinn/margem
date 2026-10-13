/**
 * Job `comentar_leitura` (J92): a leitura comentada integral de um capítulo. O worker monta, sem IA, o
 * capítulo em frases e as pausas (todos os grifos e todas as relações, cada um no ponto em que está
 * ancorado); o Codex só escreve a fala de cada pausa; a publicação junta os dois numa transação.
 *
 * A chave `comentada:<execução>:<seção>:<modelo>:<hash das fontes>` torna o pedido idempotente: a mesma
 * revisão do modelo com os mesmos grifos só gera uma leitura.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { Id, JobResultV1, LeituraComentadaV1, PausaDaLeituraV1 } from '@margem/contratos';
import { textoFalado } from '@margem/core';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { capituloDe } from '../compreensao/pipeline.js';
import { modoOuNada } from '../modos.js';
import * as compreensaoRepo from '../repos/compreensao.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as marcasRepo from '../repos/marcas.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { grifosDoCapitulo, hashDasFontes, montarEsboco, type Diagnostico, type EsbocoDaLeitura } from './montagem.js';
import { PROMPT_DA_LEITURA_COMENTADA, montarPromptDaLeitura, type SaidaDaLeituraComentada } from './prompts.js';
import * as repo from './repo.js';

export const TIPO_COMENTAR_LEITURA = 'comentar_leitura';
/** Um capítulo longo tem dezenas de pausas; `medium` leva alguns minutos. */
export const PRAZO_DA_LEITURA_MS = 1_500_000;

export interface ConfiguracaoDaLeituraComentada {
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

export interface ChaveDaLeitura { execucao_id: Id; secao_id: Id; modelo_id: Id; fontes_hash: string }
export const chaveDaLeitura = (c: ChaveDaLeitura): string => `comentada:${c.execucao_id}:${c.secao_id}:${c.modelo_id}:${c.fontes_hash}`;
export function lerChaveDaLeitura(dedupKey: string): ChaveDaLeitura {
  const [prefixo, execucao, secao, modelo, fontes, ...resto] = dedupKey.split(':');
  if (prefixo !== 'comentada' || !execucao || !secao || !modelo || !fontes || resto.length > 0) throw new Error(`Chave de leitura comentada malformada: ${dedupKey}`);
  return { execucao_id: execucao, secao_id: secao, modelo_id: modelo, fontes_hash: fontes };
}

export class CapituloSemCompreensao extends Error {
  constructor() { super('O capítulo ainda não tem a compreensão pronta (revisão final do modelo).'); this.name = 'CapituloSemCompreensao'; }
}

interface Contexto {
  chave: ChaveDaLeitura;
  versaoId: Id;
  livro: string;
  capitulo: { titulo: string; numero: number; total: number };
  movimento: string | null;
  proximaSecao: Id | null;
  esboco: EsbocoDaLeitura;
}

/** Tudo o que a leitura precisa, lido do banco: capítulo, grifos visíveis, modelo r2 e vizinhos. */
async function montarContexto(cliente: Transacao, execucaoId: Id, secaoId: Id, modeloId?: Id): Promise<Contexto> {
  const execucao = await compreensaoRepo.obterExecucao(cliente, execucaoId);
  if (!execucao) throw new Error('Execução de compreensão inexistente.');
  const modelo = modeloId ? await compreensaoRepo.obterModelo(cliente, modeloId) : await compreensaoRepo.revisaoDoCapitulo(cliente, execucaoId, secaoId, 2);
  if (!modelo) throw new CapituloSemCompreensao();
  if (modelo.secao_id !== secaoId || modelo.execucao_id !== execucao.id) throw new Error('Revisão do modelo incompatível com a leitura.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  const capitulo = capituloDe(versao.canonico, secaoId);
  const capitulos = versao.canonico.secoes.filter((secao) => secao.nivel === 1);
  const indice = capitulos.findIndex((secao) => secao.id === secaoId);
  if (indice === -1) throw new Error('A seção não é um capítulo.');
  const marcas = [
    ...await marcasRepo.listarV2PorVersao(cliente, execucao.versao_id, { camada_id: execucao.id }),
    ...await marcasRepo.listarDoLeitor(cliente, execucao.versao_id),
  ];
  const grifos = grifosDoCapitulo(marcas, capitulo.blocos);
  const modo = modoOuNada(execucao.modo);
  const rotulos = new Map((modo?.funcoes ?? []).map((f) => [f.chave, f.rotulo]));
  const fontesHash = hashDasFontes(grifos, modelo);
  const esboco = montarEsboco({ blocos: capitulo.blocos, grifos, modelo, rotuloDaFuncao: (f) => rotulos.get(f) ?? f }, fontesHash);
  return {
    chave: { execucao_id: execucao.id, secao_id: secaoId, modelo_id: modelo.id, fontes_hash: fontesHash },
    versaoId: execucao.versao_id, livro: versao.canonico.documento.titulo,
    capitulo: { titulo: capitulo.titulo, numero: indice + 1, total: capitulos.length },
    movimento: modelo.movimento?.texto ?? null, proximaSecao: capitulos[indice + 1]?.id ?? null, esboco,
  };
}

/** Enfileira a leitura do capítulo sobre a revisão final do modelo e os grifos de agora. */
export async function pedirLeituraComentada(cliente: Transacao, execucaoId: Id, secaoId: Id, prioridade: number = jobsRepo.PRIORIDADE.artefato_pedido): Promise<jobsRepo.Job> {
  const contexto = await montarContexto(cliente, execucaoId, secaoId);
  const chave = chaveDaLeitura(contexto.chave);
  return jobsRepo.enfileirar(cliente, { tipo: TIPO_COMENTAR_LEITURA, dedup_key: chave, input_snapshot_hash: sha256(chave), versao_id: contexto.versaoId, prioridade });
}

export type EstadoDaLeituraComentada = 'nao_preparada' | 'preparando' | 'pronta' | 'falhou';

export async function estadoDaLeituraComentada(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<{ estado: EstadoDaLeituraComentada; leitura: LeituraComentadaV1 | null }> {
  const leitura = await repo.leituraDoCapitulo(cliente, execucaoId, secaoId);
  const { rows: [job] } = await cliente.query<{ estado: string }>(
    'SELECT estado FROM job WHERE tipo=$1 AND dedup_key LIKE $2 ORDER BY criado_em DESC, id DESC LIMIT 1',
    [TIPO_COMENTAR_LEITURA, `comentada:${execucaoId}:${secaoId}:%`]);
  if (job !== undefined && ['fila', 'reservado', 'adiado'].includes(job.estado)) return { estado: 'preparando', leitura };
  if (leitura) return { estado: 'pronta', leitura };
  return { estado: job?.estado === 'falhou' ? 'falhou' : 'nao_preparada', leitura: null };
}

// ---------------------------------------------------------------- execução

interface ArtefatoDaLeitura {
  chave: ChaveDaLeitura;
  saida: SaidaDaLeituraComentada;
  modelo: string;
  esforco: string;
}

function ehSaida(valor: unknown): valor is SaidaDaLeituraComentada {
  const v = valor as Partial<SaidaDaLeituraComentada> | null;
  return v !== null && typeof v === 'object' && Array.isArray(v.falas)
    && v.falas.every((f: unknown) => typeof f === 'object' && f !== null && typeof (f as { pausa?: unknown }).pausa === 'string' && typeof (f as { fala?: unknown }).fala === 'string');
}

export async function executarLeituraComentada(config: ConfiguracaoDaLeituraComentada, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const chave = lerChaveDaLeitura(entradaDoJob(tarefa.job.entrada).dedup_key);
  const contexto = await comTransacao(config.banco, (cliente) => montarContexto(cliente, chave.execucao_id, chave.secao_id, chave.modelo_id));
  if (contexto.chave.fontes_hash !== chave.fontes_hash) return falhou('desconhecido', 'Os grifos do capítulo mudaram depois do pedido; peça a leitura de novo.', Date.now() - inicio);
  if (tarefa.sinal.aborted) return falhou('cancelado', 'Job cancelado.', Date.now() - inicio);
  let saida: SaidaDaLeituraComentada = { falas: [] };
  let modelo = config.modelo;
  let esforco = config.esforco;
  if (contexto.esboco.pausas.length > 0) {
    const montado = montarPromptDaLeitura({ livro: contexto.livro, capitulo: contexto.capitulo.titulo, numero: contexto.capitulo.numero, total: contexto.capitulo.total, movimento: contexto.movimento, esboco: contexto.esboco });
    await registrarNaAuditoria('pausas.json', contexto.esboco.pausas.map((p) => ({ alias: p.alias, depois_de: p.depois_de, fontes: p.fontes })));
    const raiz = await mkdtemp(join(tmpdir(), 'margem-comentada-'));
    let resultado: ResultadoExecutor;
    try {
      const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
      resultado = await config.executor({
        diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
        prazoMs: config.prazoMs ?? PRAZO_DA_LEITURA_MS, modelo: config.modelo, esforco: config.esforco, sinal: tarefa.sinal,
        ...(config.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: join(config.diretorioArtefatos, 'saidas') }),
      });
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
    if (resultado.estado !== 'ok') return resultado;
    const bruto: unknown = JSON.parse(await readFile(resultado.artefato, 'utf8'));
    if (!ehSaida(bruto)) return falhou('schema', 'Resposta fora do schema da leitura comentada.', Date.now() - inicio);
    saida = bruto;
    modelo = resultado.modelo;
    esforco = resultado.esforco ?? config.esforco;
  }
  const artefato: ArtefatoDaLeitura = { chave, saida, modelo, esforco };
  const texto = `${JSON.stringify(artefato, null, 2)}\n`;
  const pasta = join(config.diretorioArtefatos ?? join(homedir(), '.cache/margem/leituras-comentadas'), `comentada-${chave.secao_id}`);
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const caminho = join(pasta, `tentativa-${String(tarefa.job.attempt)}-${ulid()}.json`);
  await writeFile(caminho, texto, { mode: 0o600 });
  return { estado: 'ok', artefato: caminho, sha256: sha256(texto), duracao_ms: Date.now() - inicio, modelo, esforco };
}

// ---------------------------------------------------------------- publicação

const limpar = (texto: string): string => texto.replace(/\s+/gu, ' ').trim();

/** Junta o esboço e as falas do Codex: uma fala por pausa; o que falta ou sobra vira diagnóstico. */
export function pausasComFala(esboco: EsbocoDaLeitura, saida: SaidaDaLeituraComentada): { pausas: PausaDaLeituraV1[]; diagnosticos: Diagnostico[] } {
  const diagnosticos: Diagnostico[] = [];
  const falas = new Map<string, string>();
  const conhecidas = new Set(esboco.pausas.map((p) => p.alias));
  for (const { pausa, fala } of saida.falas) {
    if (!conhecidas.has(pausa)) { diagnosticos.push({ codigo: 'pausa_desconhecida', mensagem: `Veio uma fala para ${pausa}, que não existe; ficou de fora.` }); continue; }
    if (falas.has(pausa)) { diagnosticos.push({ codigo: 'fala_repetida', mensagem: `Duas falas para ${pausa}; ficou a primeira.` }); continue; }
    falas.set(pausa, limpar(fala));
  }
  const pausas = esboco.pausas.map((p, i): PausaDaLeituraV1 => {
    const texto = falas.get(p.alias) ?? '';
    if (texto === '') diagnosticos.push({ codigo: 'pausa_sem_fala', mensagem: `${p.alias} ficou sem fala; o leitor mostra só o foco.` });
    const falado = texto === '' ? '' : textoFalado(texto);
    return { id: `p${String(i + 1).padStart(3, '0')}`, depois_de: p.depois_de, fontes: p.fontes, foco: p.foco, pontas: p.pontas, texto: falado === '' ? '' : texto, falado };
  });
  return { pausas, diagnosticos };
}

export async function publicarLeituraComentada(config: ConfiguracaoDaLeituraComentada, cliente: Transacao, jobId: Id, execucaoOk: ExecucaoOk): Promise<LeituraComentadaV1> {
  const artefato = JSON.parse(await readFile(execucaoOk.artefato, 'utf8')) as ArtefatoDaLeitura;
  const contexto = await montarContexto(cliente, artefato.chave.execucao_id, artefato.chave.secao_id, artefato.chave.modelo_id);
  if (contexto.chave.fontes_hash !== artefato.chave.fontes_hash) throw new Error('Os grifos do capítulo mudaram durante a leitura; peça de novo.');
  const { pausas, diagnosticos } = pausasComFala(contexto.esboco, artefato.saida);
  const leitura: LeituraComentadaV1 = {
    versao: 1, id: (config.novoId ?? ulid)(), execucao_id: artefato.chave.execucao_id, versao_id: contexto.versaoId, secao_id: artefato.chave.secao_id,
    modelo_id: artefato.chave.modelo_id, fontes_hash: artefato.chave.fontes_hash, capitulo: contexto.capitulo,
    trechos: contexto.esboco.trechos, pausas, saltados: contexto.esboco.saltados, proxima_secao_id: contexto.proximaSecao,
    diagnosticos: [...contexto.esboco.diagnosticos, ...diagnosticos],
    execucao: { modelo: artefato.modelo, esforco: artefato.esforco, prompt: PROMPT_DA_LEITURA_COMENTADA },
    job_id: jobId, criado_em: (config.agora ?? (() => new Date()))().toISOString(),
  };
  const gravada = await repo.gravarLeitura(cliente, leitura);
  await registrarNaAuditoria('diagnosticos.json', leitura.diagnosticos);
  return gravada;
}

export function manipuladoresDaLeituraComentada(config: ConfiguracaoDaLeituraComentada): Record<string, Manipulador> {
  return {
    [TIPO_COMENTAR_LEITURA]: {
      executar: (tarefa) => executarLeituraComentada(config, tarefa),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
        const leitura = await publicarLeituraComentada(config, exigirTransacao(contexto), contexto.job.id, execucao);
        return {
          job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
          estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
          diagnosticos: leitura.diagnosticos.slice(0, 50).map((d) => ({ nivel: 'aviso' as const, codigo: d.codigo, mensagem: d.mensagem })),
        };
      },
    },
  };
}
