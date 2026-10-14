/**
 * Descoberta dos exercícios de um livro: acha as seções de exercícios e cria um pedido de resolução
 * (`ResolucaoV2` sem job, estado `pendente`) para cada exercício, sem disparar o Codex. O disparo é
 * outro passo (`dispararPendentes`), em lotes pequenos, porque a cota é finita.
 *
 * PDF: `tools/exercicios-do-pdf.py` lê as palavras da página (camada de texto ou OCR do tesseract,
 * guardado na pasta do documento) e as linhas de tinta, e devolve cada exercício com a caixa em cada
 * página; o mesmo script recorta o PNG. Os outros formatos: o texto canônico, aqui (cada item
 * numerado depois de um título "Exercícios" vira um pedido de trecho).
 */
import { spawn } from 'node:child_process';
import { comandoDoMotor } from '../plataforma/executaveis.js';
import { opcoesDeProcesso } from '../plataforma/processos.js';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ulid } from 'ulid';
import { ancoraDeSelecao } from '@margem/core';
import type { AncoraV1, CanonicoV1, ExercicioDoLivroV1, Id, ResolucaoV2 } from '@margem/contratos';
import { pastaDoDocumento, raizDoRepositorio } from '../dados.js';
import type { Transacao } from '../db/transacao.js';
import * as jobsRepo from '../repos/jobs.js';
import * as repo from '../repos/resolucoes.js';
import { caminhoDaImagem, enfileirarResolucao } from '../resolucao/pipeline.js';

export interface ParteDoRecorte { pagina: number; x: number; y: number; largura: number; altura: number }
export interface ExercicioDescoberto extends ExercicioDoLivroV1 {
  texto: string;
  origem: { tipo: 'recorte'; partes: ParteDoRecorte[] } | { tipo: 'trecho'; ancora: AncoraV1 };
}
export interface Descoberta { fonte: 'texto' | 'ocr' | 'canonico'; exercicios: ExercicioDescoberto[] }

export const RE_TITULO_EXERCICIOS = /^\W{0,2}(\d{1,2}\s*[.,]?\s*)?Exerc[ií]cios\b/i;
const RE_SECAO = /^\W{0,2}Se[cç][aã]o\s*\d{1,2}\s*[:.]/i;
const RE_ITEM = /^\s*(\d{1,3})\s*[.)]\s+\S/;
const LIMITE_DO_TEXTO = 20_000;

/** Os exercícios de um texto canônico (Markdown, EPUB, texto): itens numerados depois de "Exercícios". */
export function descobrirNoCanonico(versaoId: Id, canonico: CanonicoV1): ExercicioDescoberto[] {
  const capitulos = canonico.secoes.filter((secao) => secao.nivel === 1);
  const ordem = new Map(canonico.blocos.map((bloco) => [bloco.id, bloco.ordem]));
  const capituloDe = (blocoOrdem: number) => capitulos.find((secao) => (ordem.get(secao.bloco_inicio) ?? Infinity) <= blocoOrdem
    && blocoOrdem <= (ordem.get(secao.bloco_fim) ?? -Infinity))?.titulo ?? null;
  const saida: ExercicioDescoberto[] = [];
  let dentro = false;
  let secao: string | null = null;
  let atual: ExercicioDescoberto | null = null;
  for (const bloco of canonico.blocos) {
    const titulo = bloco.tipo === 'capitulo' || bloco.tipo === 'secao';
    if (titulo) {
      if (RE_TITULO_EXERCICIOS.test(bloco.texto)) { dentro = true; secao = null; atual = null; continue; }
      if (dentro && bloco.tipo === 'secao' && RE_SECAO.test(bloco.texto)) { secao = bloco.texto.trim(); atual = null; continue; }
      dentro = false; atual = null;
      continue;
    }
    if (!dentro) continue;
    const item = RE_ITEM.exec(bloco.texto);
    if (item) {
      atual = {
        capitulo: capituloDe(bloco.ordem), secao, numero: item[1]!, ordem: saida.length, texto: bloco.texto,
        origem: { tipo: 'trecho', ancora: ancoraDeSelecao({ ...bloco, versao_id: versaoId }, 0, bloco.texto.length) },
      };
      saida.push(atual);
    } else if (atual && atual.texto.length < LIMITE_DO_TEXTO) {
      atual.texto = `${atual.texto}\n${bloco.texto}`.slice(0, LIMITE_DO_TEXTO);
    }
  }
  return saida;
}

function rodarPython(argumentos: string[], entrada?: string): Promise<string> {
  const raiz = raizDoRepositorio();
  return new Promise((resolver, rejeitar) => {
    const comando = comandoDoMotor('exercicios', argumentos, { raiz });
    const processo = spawn(comando.programa, comando.argumentos, { cwd: comando.cwd, stdio: ['pipe', 'pipe', 'pipe'], ...opcoesDeProcesso() });
    const saida: Buffer[] = [];
    let erro = '';
    processo.stdout.on('data', (pedaco: Buffer) => saida.push(pedaco));
    processo.stderr.on('data', (pedaco: Buffer) => { erro = (erro + pedaco.toString()).slice(-4000); });
    processo.on('error', rejeitar);
    processo.on('close', (codigo) => {
      if (codigo === 0) resolver(Buffer.concat(saida).toString('utf8'));
      else rejeitar(new Error(`exercicios-do-pdf.py saiu com ${String(codigo)}: ${erro.trim()}`));
    });
    processo.stdin.end(entrada ?? '');
  });
}

interface SaidaDoPdf { fonte: 'texto' | 'ocr'; exercicios: (ExercicioDoLivroV1 & { partes: ParteDoRecorte[]; texto: string })[] }

/** Os exercícios de um PDF, pelo script (o OCR fica em `<pasta do documento>/exercicios-ocr/`). */
export async function descobrirNoPdf(documentoId: Id, original: string): Promise<Descoberta> {
  const bruto = JSON.parse(await rodarPython(['descobrir', original, join(pastaDoDocumento(documentoId), 'exercicios-ocr')])) as SaidaDoPdf;
  return {
    fonte: bruto.fonte,
    exercicios: bruto.exercicios.filter((ex) => ex.partes.length > 0).map(({ partes, texto, capitulo, secao, numero, ordem }) => ({
      capitulo, secao, numero, ordem, texto: texto.slice(0, LIMITE_DO_TEXTO), origem: { tipo: 'recorte', partes },
    })),
  };
}

/** PNG de cada recorte (as partes empilhadas), pela ordem dos exercícios. */
export async function recortarNoPdf(original: string, exercicios: readonly ExercicioDescoberto[]): Promise<Map<number, Buffer>> {
  const pedido = exercicios.flatMap((ex) => ex.origem.tipo === 'recorte' ? [{ chave: `e${String(ex.ordem)}`, partes: ex.origem.partes }] : []);
  const pasta = await mkdtemp(join(tmpdir(), 'margem-exercicios-'));
  try {
    if (pedido.length > 0) await rodarPython(['recortar', original, pasta], JSON.stringify(pedido));
    const imagens = new Map<number, Buffer>();
    for (const ex of exercicios) if (ex.origem.tipo === 'recorte') imagens.set(ex.ordem, await readFile(join(pasta, `e${String(ex.ordem)}.png`)));
    return imagens;
  } finally { await rm(pasta, { recursive: true, force: true }); }
}

function sobrepoe(a: { x: number; y: number; largura: number; altura: number }, b: typeof a): boolean {
  const largura = Math.min(a.x + a.largura, b.x + b.largura) - Math.max(a.x, b.x);
  const altura = Math.min(a.y + a.altura, b.y + b.altura) - Math.max(a.y, b.y);
  if (largura <= 0 || altura <= 0) return false;
  return largura * altura > 0.5 * Math.min(a.largura * a.altura, b.largura * b.altura);
}

/** A sessão que já cobre este exercício: mesmo capítulo/seção/número, mesmo retângulo na página ou mesmo bloco. */
export function sessaoQueCobre(sessoes: readonly ResolucaoV2[], ex: ExercicioDescoberto): ResolucaoV2 | undefined {
  return sessoes.find((sessao) => {
    const meta = sessao.exercicio;
    if (meta && meta.capitulo === ex.capitulo && meta.secao === ex.secao && meta.numero === ex.numero) return true;
    const origem = sessao.origem;
    if (ex.origem.tipo === 'recorte' && origem.tipo === 'recorte') {
      const primeira = ex.origem.partes[0]!;
      return origem.pagina === primeira.pagina && sobrepoe(origem.retangulo, primeira);
    }
    return ex.origem.tipo === 'trecho' && origem.tipo === 'trecho' && origem.ancora.bloco_id === ex.origem.ancora.bloco_id;
  });
}

export interface ResultadoDoLote { criados: number; reconhecidos: number; ja_existiam: number }

/**
 * Cria um pedido por exercício que ainda não tem sessão; à sessão avulsa que já cobria um exercício
 * (um recorte feito à mão) só acrescenta onde ele está no livro. Nada é enfileirado.
 */
export async function criarPedidos(cliente: Transacao, documentoId: Id, versaoId: Id, exercicios: readonly ExercicioDescoberto[],
  imagens: ReadonlyMap<number, Buffer>, agora: () => string): Promise<ResultadoDoLote> {
  const existentes = await repo.todasDoDocumento(cliente, documentoId);
  const resultado: ResultadoDoLote = { criados: 0, reconhecidos: 0, ja_existiam: 0 };
  for (const ex of exercicios) {
    const meta: ExercicioDoLivroV1 = { capitulo: ex.capitulo, secao: ex.secao, numero: ex.numero, ordem: ex.ordem };
    const coberta = sessaoQueCobre(existentes, ex);
    if (coberta) {
      if (coberta.exercicio) { resultado.ja_existiam += 1; continue; }
      const atualizada = { ...coberta, exercicio: meta };
      await repo.gravar(cliente, atualizada);
      existentes.splice(existentes.indexOf(coberta), 1, atualizada);
      resultado.reconhecidos += 1;
      continue;
    }
    let origem: ResolucaoV2['origem'];
    if (ex.origem.tipo === 'recorte') {
      const bytes = imagens.get(ex.ordem);
      if (!bytes) throw new Error(`Sem o recorte do exercício ${String(ex.ordem)}.`);
      const sha = createHash('sha256').update(bytes).digest('hex');
      const caminho = caminhoDaImagem(documentoId, sha);
      await mkdir(dirname(caminho), { recursive: true, mode: 0o700 });
      await writeFile(caminho, bytes, { mode: 0o600 });
      const { pagina, x, y, largura, altura } = ex.origem.partes[0]!;
      origem = { tipo: 'recorte', pagina, retangulo: { x, y, largura, altura }, imagem_sha256: sha };
    } else {
      origem = { tipo: 'trecho', ancora: ex.origem.ancora };
    }
    const sessao: ResolucaoV2 = {
      versao: 2, id: ulid(), documento_id: documentoId, versao_id: versaoId, origem, texto_extraido: ex.texto, exercicio: meta,
      resolucao: null, execucao: null, mensagens: [], criada_em: agora(),
    };
    await repo.criar(cliente, sessao);
    existentes.push(sessao);
    resultado.criados += 1;
  }
  return resultado;
}

/** Enfileira até `limite` pedidos pendentes, na ordem do livro; devolve as sessões disparadas. */
export async function dispararPendentes(cliente: Transacao, documentoId: Id, limite: number, filtro: { capitulo?: string } = {}): Promise<Id[]> {
  const sessoes = await repo.todasDoDocumento(cliente, documentoId);
  const comJob = new Set((await cliente.query<{ dedup_key: string }>(
    `SELECT dedup_key FROM job WHERE documento_id=$1 AND tipo='resolver_exercicio'`, [documentoId])).rows.map((linha) => linha.dedup_key));
  const pendentes = sessoes.filter((sessao) => sessao.resolucao === null && !comJob.has(`resolver:${sessao.id}`)
    && (filtro.capitulo === undefined || sessao.exercicio?.capitulo === filtro.capitulo))
    .sort((a, b) => (a.exercicio?.ordem ?? Infinity) - (b.exercicio?.ordem ?? Infinity) || a.criada_em.localeCompare(b.criada_em));
  const escolhidas = pendentes.slice(0, limite);
  for (const sessao of escolhidas) await enfileirarResolucao(cliente, sessao, jobsRepo.PRIORIDADE.padrao);
  return escolhidas.map((sessao) => sessao.id);
}
