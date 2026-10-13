/**
 * Job `narrar_audio` (J106): narração de um capítulo (ou de um trecho dele) pelo provedor de voz
 * configurado pela pessoa — hoje a ElevenLabs com a chave dela.
 *
 * - Pedido: a API monta o roteiro (uma cena por frase, como o Colab), mostra a estimativa e só
 *   enfileira quando a pessoa confirma os mesmos caracteres. O pedido (voz, modelo, trecho; nunca a
 *   chave) vai para `<MARGEM_DADOS>/narracoes/<pedido>/pedido.json`; o job leva
 *   `dedup_key = narracao:<versão>:<seção>:<pedido>`.
 * - Execução (fora de transação): lê a chave do arquivo de segredos, refaz o roteiro da versão
 *   (imutável), chama o provedor, guarda o MP3 por hash e grava o `AudioV2` conferido como artefato.
 *   O progresso (pedaços feitos/total) vai para `progresso.json` ao lado do pedido.
 * - Publicação: `publicarAudio` na transação da fila — o mesmo caminho do áudio do Colab.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type pg from 'pg';
import { ulid } from 'ulid';
import {
  contratoAudioV2, validarAncora, type AncoraV1, type AudioV2, type Bloco, type CanonicoV1, type Id, type JobResultV1,
} from '@margem/contratos';
import { conferirTextoAncora } from '@margem/contratos/texto';
import { ancoraDeSelecao, conferirAudioNoCanonico } from '@margem/core';
import { frasesDoTexto } from '@margem/core/leitura-comentada';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { ehUlid, raizDeDados } from '../dados.js';
import { sha256 } from '../executor/artefato.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { falhou, type CodigoFalha, type ExecucaoOk, type ResultadoExecutor } from '../executor/tipos.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { lerChave, lerPreferencias } from './configuracao.js';
import { prepararArquivoAudio, publicarAudio } from './publicacao.js';
import { MODELOS_ELEVENLABS, PEDACO_MAXIMO, provedorElevenLabs } from './voz/elevenlabs.js';
import { provedorFalso } from './voz/falso.js';
import { ErroDoProvedor, MENSAGENS_DO_PROVEDOR, estimar, redigir, type CenaParaNarrar, type Estimativa, type ProvedorDeVoz } from './voz/provedor.js';

export const TIPO_NARRAR_AUDIO = 'narrar_audio';

export interface ConfiguracaoDaNarracao {
  banco: pg.Pool;
  /** Provedor com a chave da pessoa; os testes passam um falso. */
  criarProvedor?: (chave: string) => ProvedorDeVoz;
}

export const provedorPadrao = (chave: string): ProvedorDeVoz => provedorElevenLabs({ chave });

/**
 * `MARGEM_VOZ=falso` troca a ElevenLabs pelo provedor falso (MP3 silencioso, sem rede, sem custo):
 * para ensaiar telas e o worker numa instalação sem chave real. Sem a variável, a ElevenLabs.
 */
export function escolherProvedorDeVoz(ambiente: NodeJS.ProcessEnv = process.env): (chave: string) => ProvedorDeVoz {
  const escolha = ambiente.MARGEM_VOZ;
  if (escolha === 'falso') return () => provedorFalso();
  if (escolha !== undefined && escolha !== '' && escolha !== 'elevenlabs') throw new Error(`MARGEM_VOZ aceita falso ou elevenlabs, não ${escolha}.`);
  return provedorPadrao;
}

// ---------------------------------------------------------------- roteiro

/** Blocos que não se leem em voz alta (os mesmos da voz do sistema). */
const NAO_SE_LEEM = new Set(['figura', 'equacao', 'codigo', 'tabela', 'nota_rodape']);

export interface Roteiro { cenas: CenaParaNarrar[]; ancoras: Map<string, AncoraV1> }

function blocosDaSecao(canonico: CanonicoV1, secaoId: Id): Bloco[] | null {
  const secao = canonico.secoes.find((s) => s.id === secaoId);
  if (!secao) return null;
  const inicio = canonico.blocos.findIndex((b) => b.id === secao.bloco_inicio);
  const fim = canonico.blocos.findIndex((b) => b.id === secao.bloco_fim);
  return inicio < 0 || fim < inicio ? null : canonico.blocos.slice(inicio, fim + 1);
}

/** Uma cena por frase, com a âncora exata de cada uma; `trecho` limita ao intervalo selecionado. */
export function roteiroDoCapitulo(canonico: CanonicoV1, versaoId: Id, secaoId: Id, trecho: AncoraV1 | null): Roteiro {
  const blocos = blocosDaSecao(canonico, secaoId);
  if (!blocos) throw new ErroDeNarracao('capitulo_inexistente', 'O capítulo não existe nesta versão.');
  if (trecho !== null) {
    const bloco = blocos.find((b) => b.id === trecho.bloco_id);
    if (!bloco || trecho.versao_id !== versaoId || !conferirTextoAncora(bloco, trecho)) {
      throw new ErroDeNarracao('trecho_invalido', 'O trecho selecionado não é deste capítulo.');
    }
  }
  const cenas: CenaParaNarrar[] = [];
  const ancoras = new Map<string, AncoraV1>();
  for (const bloco of blocos) {
    if (NAO_SE_LEEM.has(bloco.tipo)) continue;
    if (trecho !== null && bloco.id !== trecho.bloco_id) continue;
    let primeiraDoBloco = true;
    for (const frase of frasesDoTexto(bloco.texto)) {
      const inicio = trecho === null ? frase.inicio : Math.max(frase.inicio, trecho.inicio_utf16);
      let fim = trecho === null ? frase.fim : Math.min(frase.fim, trecho.fim_utf16);
      while (fim > inicio && /\s/u.test(bloco.texto[fim - 1]!)) fim -= 1;
      let comeco = inicio;
      while (comeco < fim && /\s/u.test(bloco.texto[comeco]!)) comeco += 1;
      if (comeco >= fim) continue;
      const cena = `c${String(cenas.length + 1).padStart(3, '0')}`;
      const ancora = ancoraDeSelecao({ ...bloco, versao_id: versaoId }, comeco, fim);
      cenas.push({ cena, texto: ancora.citacao, novoBloco: primeiraDoBloco && cenas.length > 0 });
      ancoras.set(cena, ancora);
      primeiraDoBloco = false;
    }
  }
  if (cenas.length === 0) throw new ErroDeNarracao('sem_texto', 'Não há texto para narrar aqui.');
  return { cenas, ancoras };
}

export class ErroDeNarracao extends Error {
  constructor(readonly codigo: string, mensagem: string) { super(mensagem); this.name = 'ErroDeNarracao'; }
}

// ---------------------------------------------------------------- pedido em disco

export interface PedidoDeNarracaoGuardado {
  versao: 1; pedido_id: Id; versao_id: Id; secao_id: Id; trecho: AncoraV1 | null;
  voz_id: string; voz_nome: string; modelo_id: string; titulo: string; caracteres: number;
}

const pastaDoPedido = (pedidoId: Id): string => {
  if (!ehUlid(pedidoId)) throw new Error('Identificador de pedido inválido.');
  return join(raizDeDados(), 'narracoes', pedidoId);
};

async function gravarJson(caminho: string, pasta: string, valor: unknown): Promise<void> {
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  await writeFile(caminho, `${JSON.stringify(valor, null, 2)}\n`, { mode: 0o600 });
}

async function lerPedido(pedidoId: Id): Promise<PedidoDeNarracaoGuardado> {
  const bruto = JSON.parse(await readFile(join(pastaDoPedido(pedidoId), 'pedido.json'), 'utf8')) as PedidoDeNarracaoGuardado;
  if (bruto.versao !== 1 || bruto.pedido_id !== pedidoId || (bruto.trecho !== null && !validarAncora(bruto.trecho))) throw new Error('Pedido de narração ilegível.');
  return bruto;
}

export interface Progresso { feitos: number; total: number }
async function gravarProgresso(pedidoId: Id, progresso: Progresso): Promise<void> {
  try { await gravarJson(join(pastaDoPedido(pedidoId), 'progresso.json'), pastaDoPedido(pedidoId), progresso); }
  catch { /* progresso é só informativo */ }
}
async function lerProgresso(pedidoId: Id): Promise<Progresso | null> {
  try {
    const p = JSON.parse(await readFile(join(pastaDoPedido(pedidoId), 'progresso.json'), 'utf8')) as Partial<Progresso>;
    return typeof p.feitos === 'number' && typeof p.total === 'number' ? { feitos: p.feitos, total: p.total } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- fila e situação

export interface ChaveDaNarracao { versaoId: Id; secaoId: Id; pedidoId: Id }
export const prefixoDaNarracao = (versaoId: Id, secaoId: Id): string => `narracao:${versaoId}:${secaoId}:`;
export const chaveDaNarracao = (c: ChaveDaNarracao): string => `${prefixoDaNarracao(c.versaoId, c.secaoId)}${c.pedidoId}`;
export function lerChaveDaNarracao(dedupKey: string): ChaveDaNarracao {
  const [prefixo, versaoId, secaoId, pedidoId, ...resto] = dedupKey.split(':');
  if (prefixo !== 'narracao' || !versaoId || !secaoId || !pedidoId || resto.length > 0) throw new Error(`Chave de narração malformada: ${dedupKey}`);
  return { versaoId, secaoId, pedidoId };
}

export type EstadoDaNarracao = 'nenhum' | 'pendente' | 'executando' | 'pronto' | 'falhou';
export interface SituacaoDaNarracao {
  estado: EstadoDaNarracao;
  pedido_id: Id | null;
  progresso: Progresso | null;
  /** Código do erro (`sem_creditos`, `chave_invalida`, …) e a frase para a pessoa. */
  codigo?: string;
  motivo?: string;
}

interface LinhaDoJob { dedup_key: string; estado: jobsRepo.EstadoJob; diagnosticos: JobResultV1['diagnosticos']; error_code: string | null }

export async function situacaoDaNarracao(cliente: Transacao, versaoId: Id, secaoId: Id): Promise<SituacaoDaNarracao> {
  const ultimo = (await cliente.query<LinhaDoJob>(`SELECT dedup_key, estado, diagnosticos, error_code FROM job
    WHERE tipo=$1 AND starts_with(dedup_key, $2) ORDER BY criado_em DESC, id DESC LIMIT 1`, [TIPO_NARRAR_AUDIO, prefixoDaNarracao(versaoId, secaoId)])).rows[0];
  if (!ultimo) return { estado: 'nenhum', pedido_id: null, progresso: null };
  const { pedidoId } = lerChaveDaNarracao(ultimo.dedup_key);
  switch (ultimo.estado) {
    case 'ok': return { estado: 'pronto', pedido_id: pedidoId, progresso: null };
    case 'fila': case 'adiado': return { estado: 'pendente', pedido_id: pedidoId, progresso: null };
    case 'reservado': return { estado: 'executando', pedido_id: pedidoId, progresso: await lerProgresso(pedidoId) };
    default: {
      const diagnostico = ultimo.diagnosticos.find((d) => d.nivel === 'erro') ?? ultimo.diagnosticos[0];
      const codigo = ultimo.error_code ?? diagnostico?.codigo ?? 'desconhecido';
      const motivo = diagnostico?.mensagem ?? (ultimo.estado === 'cancelado' ? MENSAGENS_DO_PROVEDOR.cancelado : 'A narração não pôde ser gerada.');
      return { estado: 'falhou', pedido_id: pedidoId, progresso: null, codigo, motivo: motivo.slice(0, 400) };
    }
  }
}

export interface PedidoNovo { versaoId: Id; secaoId: Id; trecho: AncoraV1 | null }
export interface Previa extends Estimativa {
  cenas: number; modelo_id: string; modelo_nome: string; voz_id: string | null; voz_nome: string | null; titulo: string;
}

/** O que custaria: roteiro, caracteres, créditos e a referência em dólares para o modelo escolhido. */
export async function previaDaNarracao(cliente: Transacao, pedido: PedidoNovo): Promise<Previa> {
  const versao = await obterVersao(cliente, pedido.versaoId);
  const roteiro = roteiroDoCapitulo(versao.canonico, versao.id, pedido.secaoId, pedido.trecho);
  const preferencias = await lerPreferencias();
  const modelo = MODELOS_ELEVENLABS.find((m) => m.id === preferencias.modelo_id) ?? MODELOS_ELEVENLABS[0]!;
  const secao = versao.canonico.secoes.find((s) => s.id === pedido.secaoId);
  const nomeDoCapitulo = secao?.titulo.trim() || 'Capítulo';
  return {
    ...estimar(roteiro.cenas, { ...modelo, limite: Math.min(modelo.limite, PEDACO_MAXIMO) }),
    cenas: roteiro.cenas.length, modelo_id: modelo.id, modelo_nome: modelo.nome,
    voz_id: preferencias.voz_id, voz_nome: preferencias.voz_nome,
    titulo: pedido.trecho === null ? `Narração · ${nomeDoCapitulo}` : `Narração do trecho · ${nomeDoCapitulo}`,
  };
}

export class NarracaoEmCurso extends Error {
  constructor() { super('Já há uma narração sendo gerada para este capítulo.'); this.name = 'NarracaoEmCurso'; }
}

/** Enfileira depois da confirmação: os caracteres confirmados precisam ser os da prévia atual. */
export async function pedirNarracao(cliente: Transacao, pedido: PedidoNovo, caracteresConfirmados: number): Promise<{ pedido_id: Id; previa: Previa }> {
  await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [prefixoDaNarracao(pedido.versaoId, pedido.secaoId)]);
  const situacao = await situacaoDaNarracao(cliente, pedido.versaoId, pedido.secaoId);
  if (situacao.estado === 'pendente' || situacao.estado === 'executando') throw new NarracaoEmCurso();
  const previa = await previaDaNarracao(cliente, pedido);
  if (previa.voz_id === null || previa.voz_nome === null) throw new ErroDeNarracao('sem_voz', 'Escolha uma voz em Configurações → Áudio.');
  if (previa.caracteres !== caracteresConfirmados) throw new ErroDeNarracao('estimativa_mudou', 'A estimativa mudou; confira de novo antes de gerar.');
  const pedidoId = ulid();
  const guardado: PedidoDeNarracaoGuardado = {
    versao: 1, pedido_id: pedidoId, versao_id: pedido.versaoId, secao_id: pedido.secaoId, trecho: pedido.trecho,
    voz_id: previa.voz_id, voz_nome: previa.voz_nome, modelo_id: previa.modelo_id, titulo: previa.titulo, caracteres: previa.caracteres,
  };
  await gravarJson(join(pastaDoPedido(pedidoId), 'pedido.json'), pastaDoPedido(pedidoId), guardado);
  const dedup_key = chaveDaNarracao({ versaoId: pedido.versaoId, secaoId: pedido.secaoId, pedidoId });
  await jobsRepo.enfileirar(cliente, {
    tipo: TIPO_NARRAR_AUDIO, dedup_key, input_snapshot_hash: sha256(JSON.stringify(guardado)), versao_id: pedido.versaoId,
    prioridade: jobsRepo.PRIORIDADE.artefato_pedido,
  });
  return { pedido_id: pedidoId, previa };
}

// ---------------------------------------------------------------- execução

const CODIGOS_DO_PROVEDOR: ReadonlySet<string> = new Set(['sem_chave', 'chave_invalida', 'sem_creditos', 'limite', 'permissao', 'voz_inexistente',
  'pedido_recusado', 'indisponivel', 'resposta_invalida', 'cancelado']);

export async function executarNarracao(config: ConfiguracaoDaNarracao, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const decorrido = (): number => Date.now() - inicio;
  const chave = lerChaveDaNarracao(entradaDoJob(tarefa.job.entrada).dedup_key);
  let segredo: string | null = null;
  try {
    const pedido = await lerPedido(chave.pedidoId);
    segredo = await lerChave();
    if (segredo === null) return falhou('sem_chave', MENSAGENS_DO_PROVEDOR.sem_chave, decorrido());
    const versao = await comTransacao(config.banco, (cliente) => obterVersao(cliente, pedido.versao_id));
    const roteiro = roteiroDoCapitulo(versao.canonico, versao.id, pedido.secao_id, pedido.trecho);
    const provedor = (config.criarProvedor ?? provedorPadrao)(segredo);
    const narracao = await provedor.narrar({
      cenas: roteiro.cenas, voz_id: pedido.voz_id, modelo_id: pedido.modelo_id, sinal: tarefa.sinal,
      aoProgredir: (feitos, total) => { void gravarProgresso(chave.pedidoId, { feitos, total }); },
    });
    const temporario = join(tmpdir(), `margem-narracao-${chave.pedidoId}-${ulid()}.mp3`);
    let sha: string;
    try {
      await writeFile(temporario, narracao.mp3, { mode: 0o600 });
      sha = await prepararArquivoAudio(temporario);
    } finally { await rm(temporario, { force: true }); }
    const trechos = narracao.cenas.flatMap((cena) => {
      const ancora = roteiro.ancoras.get(cena.cena);
      return ancora ? [{ inicio_s: cena.inicio_s, fim_s: cena.fim_s, ancora }] : [];
    });
    const audio: AudioV2 = {
      versao: 2, id: ulid(), versao_id: versao.id, secao_id: pedido.secao_id, titulo: pedido.titulo,
      sha256_audio: sha, duracao_s: Math.round(narracao.total_s * 1000) / 1000,
      origem: { provedor: provedor.nome, voz_id: pedido.voz_id, voz_nome: pedido.voz_nome, modelo_id: pedido.modelo_id, caracteres: narracao.caracteres },
      trechos,
    };
    const local = contratoAudioV2.validarLocal(audio);
    if (!local.ok || !conferirAudioNoCanonico(audio, versao.id, versao.canonico)) {
      return falhou('resposta_invalida', 'A narração gerada não fechou com o texto do capítulo.', decorrido());
    }
    const conteudo = `${JSON.stringify({ audio, avisos: narracao.avisos }, null, 2)}\n`;
    const caminho = join(pastaDoPedido(chave.pedidoId), `audio-${String(tarefa.job.attempt)}.json`);
    await writeFile(caminho, conteudo, { mode: 0o600 });
    return { estado: 'ok', artefato: caminho, sha256: sha256(conteudo), duracao_ms: decorrido(), modelo: `${provedor.nome}:${pedido.modelo_id}` };
  } catch (erro) {
    if (erro instanceof ErroDoProvedor) {
      const codigo = (CODIGOS_DO_PROVEDOR.has(erro.tipo) ? erro.tipo : 'desconhecido') as CodigoFalha;
      return falhou(codigo, redigir(erro.message, segredo), decorrido());
    }
    if (erro instanceof ErroDeNarracao) return falhou('desconhecido', erro.message, decorrido());
    // Mensagem genérica: nada de texto de exceção desconhecida (poderia carregar caminho ou segredo).
    return falhou('desconhecido', redigir('A narração falhou por um erro interno.', segredo), decorrido());
  }
}

export async function publicarNarracao(cliente: Transacao, execucao: ExecucaoOk): Promise<{ audio: AudioV2; avisos: string[] }> {
  const artefato = JSON.parse(await readFile(execucao.artefato, 'utf8')) as { audio?: AudioV2; avisos?: unknown };
  const audio = artefato.audio;
  if (!audio || audio.versao !== 2) throw new Error('Artefato da narração inválido.');
  const publicado = await publicarAudio(cliente, audio) as AudioV2;
  await registrarNaAuditoria('narracao.publicada.json', publicado);
  const avisos = Array.isArray(artefato.avisos) ? artefato.avisos.filter((a): a is string => typeof a === 'string') : [];
  return { audio: publicado, avisos };
}

export function manipuladoresDaNarracao(config: ConfiguracaoDaNarracao): Record<string, Manipulador> {
  return {
    [TIPO_NARRAR_AUDIO]: {
      executar: (tarefa) => executarNarracao(config, tarefa),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
        const { avisos } = await publicarNarracao(exigirTransacao(contexto), execucao);
        return {
          job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
          estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
          diagnosticos: avisos.map((mensagem) => ({ nivel: 'aviso' as const, codigo: 'alinhamento_aproximado', mensagem })),
        };
      },
    },
  };
}
