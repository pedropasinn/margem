/**
 * Transcrição passada a limpo pelo Codex (J142, auditoria B-14.3, decisão MV-P01). A legenda
 * automática do YouTube chega sem pontuação, sem maiúsculas e com nomes ouvidos errado; o transcritor local
 * também erra nomes. Na análise do vídeo, o job `revisar_transcricao` manda a transcrição em trechos ao
 * Codex (`revisar-transcricao@3`), recebe cada parágrafo limpo e:
 *
 * 1. confere parágrafo a parágrafo que é a mesma fala (as mesmas palavras, na mesma ordem, com poucas
 *    trocas); o que mudou demais, sumiu ou abriria uma lista fica como estava, com diagnóstico;
 * 2. leva o tempo de cada palavra para o texto novo (`transferirTempos`): palavra igual (sem contar
 *    pontuação e caixa) ou troca 1:1 mantém o tempo; troca de N por M palavras reparte o intervalo; a
 *    palavra acrescentada fica na pausa entre as vizinhas;
 * 3. publica pela revisão do J90 (`registrarRevisao`): versão nova do documento e mídia realinhada pelo job
 *    `canonizar_revisao`. A versão anterior fica, intacta.
 *
 * Se a versão já tem grifos, notas ou marcas, a revisão não é aplicada (eles ficariam na versão antiga): a
 * análise segue sobre a transcrição original e o diagnóstico diz por quê. Cada trecho respondido fica
 * guardado ao lado dos artefatos pelo hash do prompt, então uma nova tentativa só chama o que falta.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { Bloco, Id, JobResultV1, MidiaV1, VideoYoutubeV1 } from '@margem/contratos';
import { chaveDaPalavra, type PalavraTranscrita } from '@margem/core';
import type { Transacao } from '../db/transacao.js';
import { comTransacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { corpoDoModelo, lerPrompt, preencher, type SchemaJson } from '../leitura/v2/prompt.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { ErroDeRevisao, registrarRevisao } from './revisao.js';

export const TIPO_REVISAR_TRANSCRICAO = 'revisar_transcricao';
export const PROMPT_DA_LIMPEZA = 'revisar-transcricao@3';
/** Marca do motor da transcrição limpa: uma transcrição já limpa não passa de novo. */
export const MARCA_DA_LIMPEZA = 'passada a limpo pelo Codex';
/** Palavras por chamada: cabe folgado no contexto e a resposta (o trecho inteiro) não fica longa demais. */
export const PALAVRAS_POR_TRECHO = 700;
/** Prazo de cada chamada; o job inteiro tem o dos trechos somados. */
export const PRAZO_POR_TRECHO_MS = 300_000;
/** Abaixo disto o parágrafo devolvido não é a mesma fala. */
export const SEMELHANCA_MINIMA = 0.75;
/** O motor de TXT leria estes começos como lista, citação ou cerca. */
const COMECO_ESPECIAL = /^(?:[-+*]|\d+[.)]|>|`{3,}|~{3,}|#{1,6})(?:\s|$)/u;
/** Tipos de bloco que não são fala (os mesmos da publicação da mídia). */
const BLOCOS_NAO_FALADOS = new Set(['capitulo', 'secao', 'epigrafe', 'figura', 'tabela', 'equacao', 'codigo', 'legenda']);

/** Esforço da limpeza: `medium` por padrão (é revisão de texto, não leitura); `MARGEM_ESFORCO_LIMPEZA` troca. */
export function esforcoDaLimpeza(ambiente: NodeJS.ProcessEnv = process.env): string {
  const valor = ambiente.MARGEM_ESFORCO_LIMPEZA?.trim();
  return valor && ['low', 'medium', 'high'].includes(valor) ? valor : 'medium';
}

export interface ConfiguracaoDaLimpeza {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoPorTrechoMs?: number;
  diretorioArtefatos?: string;
  /**
   * Chamado na publicação quando a revisão NÃO vira versão nova (nada mudou, a versão tem anotações ou a
   * revisão foi recusada): a análise do vídeo segue sobre a transcrição atual.
   */
  aoSeguirSemRevisao?: (cliente: Transacao, documentoId: Id) => Promise<void>;
}

// ---------------------------------------------------------------- decisão (pura)

/**
 * A transcrição precisa ser passada a limpo? Legenda escrita pelo canal, não; já limpa, não; legenda
 * automática, transcritor local ou transcrição enviada com o vídeo, sim.
 */
export function precisaPassarALimpo(midia: Pick<MidiaV1, 'transcricao'>, video: Pick<VideoYoutubeV1, 'transcricao'> | null): boolean {
  if (midia.transcricao.motor.includes(MARCA_DA_LIMPEZA)) return false;
  return video?.transcricao.origem !== 'legendas';
}

// ---------------------------------------------------------------- tempos (puro)

/** Os parágrafos falados da versão: blocos de texto com palavras alinhadas, na ordem. */
export function paragrafosDaFala(blocos: readonly Pick<Bloco, 'id' | 'tipo' | 'texto'>[], midia: Pick<MidiaV1, 'palavras'>): Pick<Bloco, 'id' | 'texto'>[] {
  const comFala = new Set(midia.palavras.map((p) => p.bloco_id));
  return blocos.filter((b) => !BLOCOS_NAO_FALADOS.has(b.tipo) && comFala.has(b.id));
}

/**
 * As palavras (tokens do texto) de um parágrafo com o tempo da mídia; as que o alinhamento não cobriu
 * ganham o tempo interpolado entre as vizinhas.
 */
export function palavrasDoParagrafo(bloco: Pick<Bloco, 'id' | 'texto'>, midia: Pick<MidiaV1, 'palavras'>): PalavraTranscrita[] {
  const alinhadas = midia.palavras.filter((p) => p.bloco_id === bloco.id);
  const saida: (PalavraTranscrita | { texto: string; inicio_s: null; fim_s: null })[] = [];
  for (const achado of bloco.texto.matchAll(/\S+/gu)) {
    const inicio = achado.index, fim = achado.index + achado[0].length;
    const par = alinhadas.find((p) => p.inicio_utf16 < fim && p.fim_utf16 > inicio);
    saida.push(par ? { texto: achado[0], inicio_s: par.inicio_s, fim_s: par.fim_s } : { texto: achado[0], inicio_s: null, fim_s: null });
  }
  // Interpolação: entre o fim da anterior com tempo e o começo da próxima com tempo.
  for (let i = 0; i < saida.length; i++) {
    if (saida[i]!.inicio_s !== null) continue;
    let j = i;
    while (j < saida.length && saida[j]!.inicio_s === null) j++;
    const antes = i > 0 ? saida[i - 1]!.fim_s! : (j < saida.length ? saida[j]!.inicio_s! : 0);
    const depois = j < saida.length ? saida[j]!.inicio_s! : antes;
    const passo = (depois - antes) / (j - i + 1);
    for (let k = i; k < j; k++) {
      const a = antes + passo * (k - i + 1) - passo / 2;
      saida[k] = { texto: saida[k]!.texto, inicio_s: arredondar(Math.max(antes, a - passo / 2)), fim_s: arredondar(Math.max(antes, a + passo / 2)) };
    }
    i = j;
  }
  return saida as PalavraTranscrita[];
}

const arredondar = (s: number): number => Math.round(s * 1000) / 1000;

/** Divide [inicio, fim] entre as palavras, em proporção ao tamanho de cada uma. */
function repartir(textos: readonly string[], inicio: number, fim: number): PalavraTranscrita[] {
  const pesos = textos.map((t) => Math.max(t.length, 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  let acumulado = 0;
  return textos.map((texto, i) => {
    const a = inicio + ((fim - inicio) * acumulado) / total;
    acumulado += pesos[i]!;
    return { texto, inicio_s: arredondar(a), fim_s: arredondar(inicio + ((fim - inicio) * acumulado) / total) };
  });
}

type Operacao = { op: 'igual' | 'troca'; a: [number, number]; b: [number, number] };

/** Maior subsequência comum pelas chaves (sem pontuação nem caixa): as operações de a → b. */
function operacoes(a: readonly string[], b: readonly string[]): Operacao[] {
  const n = a.length, m = b.length;
  const tabela: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tabela[i]![j] = a[i] === b[j] && a[i] !== '' ? tabela[i + 1]![j + 1]! + 1 : Math.max(tabela[i + 1]![j]!, tabela[i]![j + 1]!);
    }
  }
  const saida: Operacao[] = [];
  let i = 0, j = 0, ia = 0, jb = 0;
  const fecharTroca = (): void => { if (i > ia || j > jb) saida.push({ op: 'troca', a: [ia, i], b: [jb, j] }); };
  while (i < n && j < m) {
    if (a[i] === b[j] && a[i] !== '') {
      fecharTroca();
      saida.push({ op: 'igual', a: [i, i + 1], b: [j, j + 1] });
      i++; j++; ia = i; jb = j;
    } else if (tabela[i + 1]![j]! >= tabela[i]![j + 1]!) i++;
    else j++;
  }
  i = n; j = m;
  fecharTroca();
  return saida;
}

/** Quanto da fala original sobrevive: subsequência comum sobre o maior dos dois. */
export function semelhanca(antigas: readonly string[], novas: readonly string[]): number {
  const a = antigas.map(chaveDaPalavra), b = novas.map(chaveDaPalavra);
  if (a.length === 0 && b.length === 0) return 1;
  const iguais = operacoes(a, b).filter((o) => o.op === 'igual').length;
  return iguais / Math.max(a.length, b.length);
}

/**
 * Leva os tempos das palavras antigas para as novas. Igual (pela chave) ou troca 1:1: o tempo da antiga.
 * Troca N→M: reparte o intervalo das antigas. Inserção pura: a pausa entre as vizinhas (ou divide a
 * anterior). Remoção: o tempo some com a palavra. Os tempos nunca voltam.
 */
export function transferirTempos(antigas: readonly PalavraTranscrita[], novos: readonly string[]): PalavraTranscrita[] {
  const ops = operacoes(antigas.map((p) => chaveDaPalavra(p.texto)), novos.map(chaveDaPalavra));
  const saida: PalavraTranscrita[] = [];
  for (const o of ops) {
    const velhas = antigas.slice(o.a[0], o.a[1]);
    const textos = novos.slice(o.b[0], o.b[1]);
    if (textos.length === 0) continue;
    if (velhas.length === textos.length) {
      velhas.forEach((v, k) => saida.push({ texto: textos[k]!, inicio_s: v.inicio_s, fim_s: v.fim_s }));
    } else if (velhas.length > 0) {
      saida.push(...repartir(textos, velhas[0]!.inicio_s, velhas.at(-1)!.fim_s));
    } else {
      const anterior = saida.at(-1) ?? (o.a[0] > 0 ? antigas[o.a[0] - 1] : undefined);
      const seguinte = antigas[o.a[1]];
      const inicio = anterior?.fim_s ?? seguinte?.inicio_s ?? 0;
      const fim = seguinte?.inicio_s ?? inicio;
      if (fim - inicio >= 0.06 || saida.length === 0) saida.push(...repartir(textos, inicio, Math.max(inicio, fim)));
      else {
        // Sem pausa: divide o tempo da palavra anterior com as novas.
        const ultima = saida.pop()!;
        saida.push(...repartir([ultima.texto, ...textos], ultima.inicio_s, ultima.fim_s));
      }
    }
  }
  let tempo = 0;
  for (const p of saida) {
    if (p.inicio_s < tempo) p.inicio_s = tempo;
    if (p.fim_s < p.inicio_s) p.fim_s = p.inicio_s;
    tempo = p.inicio_s;
  }
  return saida;
}

export type MotivoDaRecusa = 'ausente' | 'vazio' | 'mudou_demais' | 'abre_lista';

/** Confere o parágrafo devolvido: a mesma fala, sem virar lista. `null` quando pode entrar. */
export function recusaDoParagrafo(original: string, limpo: string | undefined): MotivoDaRecusa | null {
  if (limpo === undefined) return 'ausente';
  const texto = limpo.replace(/\s+/gu, ' ').trim();
  if (texto === '' || chaveDaPalavra(texto) === '') return 'vazio';
  if (COMECO_ESPECIAL.test(texto)) return 'abre_lista';
  if (semelhanca(original.split(/\s+/u).filter(Boolean), texto.split(' ')) < SEMELHANCA_MINIMA) return 'mudou_demais';
  return null;
}

// ---------------------------------------------------------------- trechos e prompt (puro)

/** Grupos de parágrafos consecutivos com até ~`palavras` palavras (nunca parte um parágrafo). */
export function dividirEmTrechos(paragrafos: readonly string[], palavras = PALAVRAS_POR_TRECHO): number[][] {
  const trechos: number[][] = [];
  let atual: number[] = [], contagem = 0;
  paragrafos.forEach((p, i) => {
    const n = p.split(/\s+/u).filter(Boolean).length;
    if (atual.length > 0 && contagem + n > palavras) { trechos.push(atual); atual = []; contagem = 0; }
    atual.push(i); contagem += n;
  });
  if (atual.length > 0) trechos.push(atual);
  return trechos;
}

const cauda = (texto: string, n: number): string => { const t = texto.split(/\s+/u); return (t.length > n ? '… ' : '') + t.slice(-n).join(' '); };
const cabeca = (texto: string, n: number): string => { const t = texto.split(/\s+/u); return t.slice(0, n).join(' ') + (t.length > n ? ' …' : ''); };

export function montarPromptDaLimpeza(dados: { titulo: string; canal: string | null; idioma: string }, paragrafos: readonly string[], trecho: readonly number[]): { prompt: string; schema: SchemaJson } {
  const primeiro = trecho[0]!, ultimo = trecho.at(-1)!;
  const prompt = preencher(corpoDoModelo(lerPrompt(`${PROMPT_DA_LIMPEZA}.md`)), {
    titulo: dados.titulo.replace(/\s+/gu, ' ').trim(),
    canal: dados.canal ?? 'desconhecido',
    idioma: /^pt/iu.test(dados.idioma) ? 'português' : dados.idioma,
    contexto_antes: primeiro > 0 ? cauda(paragrafos[primeiro - 1]!, 60) : '(início do vídeo)',
    contexto_depois: ultimo + 1 < paragrafos.length ? cabeca(paragrafos[ultimo + 1]!, 60) : '(fim do vídeo)',
    trecho: trecho.map((i) => `[${String(i + 1)}] ${paragrafos[i]!}`).join('\n\n'),
  });
  return { prompt, schema: JSON.parse(lerPrompt(`${PROMPT_DA_LIMPEZA}.schema.json`)) as SchemaJson };
}

interface RespostaDoTrecho { paragrafos: { numero: number; texto: string }[] }
function ehResposta(valor: unknown): valor is RespostaDoTrecho {
  const v = valor as Partial<RespostaDoTrecho> | null;
  return v !== null && typeof v === 'object' && Array.isArray(v.paragrafos)
    && v.paragrafos.every((p) => typeof p === 'object' && p !== null && Number.isInteger(p.numero) && typeof p.texto === 'string');
}

// ---------------------------------------------------------------- resultado (puro)

export interface Recusa { paragrafo: number; motivo: MotivoDaRecusa }
export interface TranscricaoLimpa {
  paragrafos: string[];
  palavras: PalavraTranscrita[];
  mudados: number;
  recusas: Recusa[];
}

/** Junta as respostas: parágrafo aceito entra limpo, com os tempos levados; recusado fica como estava. */
export function montarTranscricaoLimpa(originais: readonly PalavraTranscrita[][], limpos: ReadonlyMap<number, string>): TranscricaoLimpa {
  const paragrafos: string[] = [];
  const palavras: PalavraTranscrita[] = [];
  const recusas: Recusa[] = [];
  let mudados = 0;
  originais.forEach((antigas, i) => {
    const original = antigas.map((p) => p.texto).join(' ');
    const limpo = limpos.get(i + 1);
    const recusa = recusaDoParagrafo(original, limpo);
    if (recusa !== null) {
      recusas.push({ paragrafo: i + 1, motivo: recusa });
      paragrafos.push(original); palavras.push(...antigas.map((p) => ({ ...p })));
      return;
    }
    const tokens = limpo!.replace(/\s+/gu, ' ').trim().split(' ');
    const novas = transferirTempos(antigas, tokens);
    // O tempo do parágrafo não pode voltar antes do fim do anterior.
    const piso = palavras.at(-1)?.inicio_s ?? 0;
    for (const p of novas) { if (p.inicio_s < piso) p.inicio_s = piso; if (p.fim_s < p.inicio_s) p.fim_s = p.inicio_s; }
    const texto = tokens.join(' ');
    if (texto !== original) mudados++;
    paragrafos.push(texto); palavras.push(...novas);
  });
  return { paragrafos, palavras, mudados, recusas };
}

// ---------------------------------------------------------------- fila

export const chaveDaLimpeza = (versaoId: Id): string => `${TIPO_REVISAR_TRANSCRICAO}:${versaoId}`;

export async function pedirLimpeza(cliente: Transacao, documentoId: Id, versaoId: Id): Promise<void> {
  await jobsRepo.enfileirar(cliente, {
    tipo: TIPO_REVISAR_TRANSCRICAO, dedup_key: chaveDaLimpeza(versaoId), input_snapshot_hash: sha256(chaveDaLimpeza(versaoId)),
    documento_id: documentoId, versao_id: versaoId, prioridade: jobsRepo.PRIORIDADE.artefato_pedido,
  });
}

export type EstadoDaLimpeza = 'nao_pedida' | 'na_fila' | 'falhou' | 'pronta';
export async function estadoDaLimpeza(cliente: Transacao | pg.Pool, versaoId: Id): Promise<EstadoDaLimpeza> {
  const job = (await cliente.query<{ estado: string }>('SELECT estado FROM job WHERE dedup_key=$1', [chaveDaLimpeza(versaoId)])).rows[0];
  if (!job) return 'nao_pedida';
  if (job.estado === 'ok') return 'pronta';
  return job.estado === 'falhou' || job.estado === 'cancelado' ? 'falhou' : 'na_fila';
}

// ---------------------------------------------------------------- execução e publicação

interface Contexto { documentoId: Id; versaoId: Id; midia: MidiaV1; blocos: Pick<Bloco, 'id' | 'texto'>[]; video: VideoYoutubeV1 | null }

async function montarContexto(cliente: Transacao, versaoId: Id): Promise<Contexto> {
  const versao = await obterVersao(cliente, versaoId);
  const midia = (await cliente.query<{ conteudo: MidiaV1 }>('SELECT conteudo FROM midia WHERE versao_id=$1 ORDER BY criado_em DESC, id DESC LIMIT 1', [versaoId])).rows[0]?.conteudo;
  if (!midia) throw new Error('A versão não tem mídia: não há transcrição com tempo para passar a limpo.');
  const video = (await cliente.query<{ conteudo: VideoYoutubeV1 }>('SELECT conteudo FROM video_youtube WHERE documento_id=$1', [versao.documento_id])).rows[0]?.conteudo ?? null;
  return { documentoId: versao.documento_id, versaoId, midia, blocos: paragrafosDaFala(versao.canonico.blocos, midia), video };
}

interface ArtefatoDaLimpeza {
  versao_id: Id; midia_id: Id; modelo: string; esforco: string;
  limpos: Record<string, string>;
}

export async function executarLimpeza(config: ConfiguracaoDaLimpeza, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const versaoId = entradaDoJob(tarefa.job.entrada).versao_id;
  if (versaoId === null) return falhou('desconhecido', 'Job de limpeza sem versão.', 0);
  const contexto = await comTransacao(config.banco, (cliente) => montarContexto(cliente, versaoId));
  const originais = contexto.blocos.map((b) => palavrasDoParagrafo(b, contexto.midia).map((p) => p.texto).join(' '));
  const dados = { titulo: contexto.video?.titulo ?? contexto.midia.titulo, canal: contexto.video?.canal ?? contexto.midia.fonte?.canal ?? null, idioma: contexto.midia.transcricao.idioma };
  const pastaBase = config.diretorioArtefatos ?? join(homedir(), '.cache/margem/limpezas');
  const guardados = join(pastaBase, `limpeza-${versaoId}`);
  await mkdir(guardados, { recursive: true, mode: 0o700 });
  const limpos: Record<string, string> = {};
  let modelo = config.modelo, esforco = config.esforco;
  for (const trecho of dividirEmTrechos(originais)) {
    if (tarefa.sinal.aborted) return falhou('cancelado', 'Job cancelado.', Date.now() - inicio);
    const montado = montarPromptDaLimpeza(dados, originais, trecho);
    // Trecho já respondido numa tentativa anterior (mesmo prompt): não chama de novo.
    const guardado = join(guardados, `trecho-${createHash('sha256').update(montado.prompt).digest('hex').slice(0, 24)}.json`);
    let resposta: unknown = await readFile(guardado, 'utf8').then((t) => JSON.parse(t) as unknown, () => null);
    if (!ehResposta(resposta)) {
      const raiz = await mkdtemp(join(tmpdir(), 'margem-limpeza-'));
      let resultado: ResultadoExecutor;
      try {
        const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
        resultado = await config.executor({
          diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
          prazoMs: config.prazoPorTrechoMs ?? PRAZO_POR_TRECHO_MS, modelo: config.modelo, esforco: config.esforco, sinal: tarefa.sinal,
          ...(config.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: join(config.diretorioArtefatos, 'saidas') }),
        });
      } finally {
        await rm(raiz, { recursive: true, force: true });
      }
      if (resultado.estado !== 'ok') return resultado;
      modelo = resultado.modelo; esforco = resultado.esforco ?? esforco;
      resposta = JSON.parse(await readFile(resultado.artefato, 'utf8')) as unknown;
      if (!ehResposta(resposta)) return falhou('schema', 'Resposta fora do schema da transcrição limpa.', Date.now() - inicio);
      await writeFile(guardado, JSON.stringify(resposta), { mode: 0o600 });
    }
    const permitidos = new Set(trecho.map((i) => i + 1));
    for (const p of resposta.paragrafos) if (permitidos.has(p.numero)) limpos[String(p.numero)] = p.texto;
  }
  const artefato: ArtefatoDaLimpeza = { versao_id: versaoId, midia_id: contexto.midia.id, modelo, esforco, limpos };
  const texto = `${JSON.stringify(artefato)}\n`;
  const caminho = join(guardados, `resultado-${String(tarefa.job.attempt)}-${ulid()}.json`);
  await writeFile(caminho, texto, { mode: 0o600 });
  return { estado: 'ok', artefato: caminho, sha256: sha256(texto), duracao_ms: Date.now() - inicio, modelo, esforco };
}

export interface DesfechoDaLimpeza {
  desfecho: 'revisao_registrada' | 'sem_mudanca' | 'versao_com_anotacoes' | 'versao_desatualizada' | 'recusada';
  mudados: number;
  recusas: Recusa[];
  mensagem?: string;
}

export async function publicarLimpeza(config: ConfiguracaoDaLimpeza, cliente: Transacao, jobId: Id, execucao: ExecucaoOk): Promise<DesfechoDaLimpeza> {
  const artefato = JSON.parse(await readFile(execucao.artefato, 'utf8')) as ArtefatoDaLimpeza;
  const contexto = await montarContexto(cliente, artefato.versao_id);
  const originais = contexto.blocos.map((b) => palavrasDoParagrafo(b, contexto.midia));
  const limpa = montarTranscricaoLimpa(originais, new Map(Object.entries(artefato.limpos).map(([n, t]) => [Number(n), t])));
  const base = { mudados: limpa.mudados, recusas: limpa.recusas };
  const seguir = async (desfecho: DesfechoDaLimpeza): Promise<DesfechoDaLimpeza> => {
    await config.aoSeguirSemRevisao?.(cliente, contexto.documentoId);
    return desfecho;
  };
  if (limpa.mudados === 0) return seguir({ desfecho: 'sem_mudanca', ...base });
  const ultima = (await cliente.query<{ id: Id }>('SELECT id FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1', [contexto.documentoId])).rows[0];
  // Outra versão saiu enquanto o Codex trabalhava (outra revisão, por exemplo): a análise segue sobre ela.
  if (ultima?.id !== artefato.versao_id) return seguir({ desfecho: 'versao_desatualizada', ...base });
  try {
    await registrarRevisao(cliente, {
      documento_id: contexto.documentoId, versao_base_id: artefato.versao_id, paragrafos: limpa.paragrafos,
      transcricao: { motor: `${contexto.midia.transcricao.motor} + ${MARCA_DA_LIMPEZA} (${PROMPT_DA_LIMPEZA})`, idioma: contexto.midia.transcricao.idioma, palavras: limpa.palavras },
      resumo: { prompt: PROMPT_DA_LIMPEZA, job_id: jobId, modelo: artefato.modelo, esforco: artefato.esforco, mudados: limpa.mudados, recusas: limpa.recusas, origem: 'analise_do_video' },
      aceitar_anotacoes_na_versao_anterior: false,
    });
    return { desfecho: 'revisao_registrada', ...base };
  } catch (erro) {
    if (!(erro instanceof ErroDeRevisao)) throw erro;
    const desfecho = erro.codigo === 'versao_com_anotacoes' ? 'versao_com_anotacoes' : erro.codigo === 'sem_mudanca' ? 'sem_mudanca' : 'recusada';
    return seguir({ desfecho, ...base, mensagem: erro.message });
  }
}

const MENSAGEM_DA_RECUSA: Record<MotivoDaRecusa, string> = {
  ausente: 'o Codex não devolveu o parágrafo', vazio: 'o parágrafo voltou vazio', mudou_demais: 'o parágrafo mudou demais', abre_lista: 'o parágrafo viraria uma lista',
};

export function manipuladoresDaLimpeza(config: ConfiguracaoDaLimpeza): Record<string, Manipulador> {
  return {
    [TIPO_REVISAR_TRANSCRICAO]: {
      executar: (tarefa) => executarLimpeza(config, tarefa),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
        const cliente = exigirTransacao(contexto);
        const desfecho = await publicarLimpeza(config, cliente, contexto.job.id, execucao);
        await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [contexto.job.id, 'transcricao_limpa', JSON.stringify(desfecho)]);
        return {
          job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
          estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
          diagnosticos: [
            ...desfecho.recusas.map((r) => ({ nivel: 'aviso' as const, codigo: 'paragrafo_sem_limpeza', mensagem: `Parágrafo ${String(r.paragrafo)} ficou como estava: ${MENSAGEM_DA_RECUSA[r.motivo]}.` })),
            ...(desfecho.desfecho === 'revisao_registrada' || desfecho.desfecho === 'sem_mudanca' ? []
              : [{ nivel: 'aviso' as const, codigo: desfecho.desfecho, mensagem: desfecho.mensagem ?? 'A transcrição limpa não virou versão nova.' }]),
          ],
        };
      },
    },
  };
}
