/**
 * Revisão da transcrição de um vídeo (J90). Os deslizes do reconhecimento de fala ("modelos de A",
 * "Antropic") são corrigidos fora do serviço (`tools/midia/revisar_transcricao.py`, com o Codex); aqui
 * chega o texto revisado com as palavras e os tempos. Versões de texto são imutáveis, então a revisão
 * vira uma versão NOVA do mesmo documento:
 *
 * 1. `registrarRevisao` (API): confere que a base é a última versão e tem mídia, que as palavras são os
 *    tokens do texto e que a versão base não tem notas, grifos ou marcas que sumiriam da leitura; grava o
 *    texto em `documentos/<id>/revisoes/<sha>.txt`, a linha imutável `revisao_transcricao` e o job.
 * 2. `canonizar_revisao` (worker): o motor canoniza o texto revisado; a publicação cria a versão e, na
 *    mesma transação, publica a mídia realinhada (o mesmo arquivo de vídeo, as palavras revisadas). Se o
 *    alinhamento não fechar, nada é publicado.
 *
 * A versão anterior continua lá, com a mídia e tudo o que estiver ligado a ela; "Comparar versões" (J65)
 * mostra os blocos que mudaram.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { AncoraV1, Id, JobResultV1, MidiaV1 } from '@margem/contratos';
import { validarCanonico } from '@margem/contratos';
import type { PalavraTranscrita } from '@margem/core';
import { pastaDaTentativaDeCanonizacao, pastaDoDocumento, raizDoRepositorio } from '../dados';
import { comTransacao, type Transacao } from '../db/transacao';
import { interpretarJson, lerTextoLimitado, ORCAMENTOS } from '../entrada-json';
import { sha256 } from '../executor/artefato';
import { falhou, type ExecucaoOk, type ResultadoExecutor } from '../executor/tipos';
import * as documentos from '../repos/documentos';
import * as jobsRepo from '../repos/jobs';
import * as progressoRepo from '../repos/progresso';
import { reconciliarCanonizacao } from '../worker/arquivos-canonizacao';
import { exigirTransacao, publicarCanonizacao, rodarMotor } from '../worker/canonizar';
import { entradaDoJob } from '../worker/fila-postgres';
import type { ContextoPublicacao } from '../worker/fila';
import type { Manipulador, Tarefa } from '../worker/worker';
import { publicarMidia } from './publicacao';

export const TIPO_CANONIZAR_REVISAO = 'canonizar_revisao';

export interface PedidoDeRevisao {
  documento_id: Id;
  versao_base_id: Id;
  paragrafos: string[];
  transcricao: { motor: string; idioma: string; palavras: PalavraTranscrita[] };
  resumo: Record<string, unknown>;
  /** Publicar mesmo com notas/grifos/marcas na versão base (elas ficam lá, mas a leitura abre a nova). */
  aceitar_anotacoes_na_versao_anterior: boolean;
}

export type CodigoDaRevisao = 'documento_inexistente' | 'nao_e_transcricao' | 'versao_base_desatualizada'
  | 'sem_mudanca' | 'versao_com_anotacoes' | 'palavras_fora_do_texto';

export class ErroDeRevisao extends Error {
  constructor(readonly codigo: CodigoDaRevisao, mensagem: string, readonly detalhe?: Record<string, unknown>) {
    super(mensagem);
  }
}

export interface ItensDaVersao { anotacoes: number; conexoes: number; marcas: number; etiquetas: number }

/** O texto do documento de vídeo: um parágrafo por linha, separados por linha em branco (como o J71). */
export function textoDaTranscricao(paragrafos: readonly string[]): string {
  return `${paragrafos.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n')}\n`;
}

/** O que o leitor (ou uma leitura) já pôs na versão e deixaria de aparecer se a leitura abrisse outra. */
export async function itensDaVersao(cliente: Transacao, versaoId: Id): Promise<ItensDaVersao> {
  const { rows: [linha] } = await cliente.query<ItensDaVersao>(`SELECT
    (SELECT count(*)::int FROM anotacao WHERE versao_id=$1) AS anotacoes,
    (SELECT count(*)::int FROM conexao WHERE versao_id=$1) AS conexoes,
    (SELECT count(*)::int FROM marca WHERE versao_id=$1) AS marcas,
    (SELECT count(*)::int FROM etiqueta WHERE versao_id=$1) AS etiquetas`, [versaoId]);
  return linha!;
}

export function caminhoDaRevisao(documentoId: Id, sha: string): string {
  return join(pastaDoDocumento(documentoId), 'revisoes', `${sha}.txt`);
}

export interface RevisaoRegistrada { revisao_id: Id; job_id: Id; sha256_texto: string; criada: boolean }

/** Registra a revisão e enfileira a canonização. Idempotente pelo texto: o mesmo texto devolve o mesmo job. */
export async function registrarRevisao(cliente: Transacao, pedido: PedidoDeRevisao): Promise<RevisaoRegistrada> {
  const documento = (await cliente.query<documentos.Documento>('SELECT * FROM documento WHERE id=$1 FOR UPDATE', [pedido.documento_id])).rows[0];
  if (!documento) throw new ErroDeRevisao('documento_inexistente', 'Documento inexistente.');
  if (documento.formato !== 'txt') throw new ErroDeRevisao('nao_e_transcricao', 'Só documentos de vídeo (TXT com mídia) têm transcrição revisável.');
  const tokens = pedido.paragrafos.join(' ').split(/\s+/).filter(Boolean);
  if (tokens.length !== pedido.transcricao.palavras.length || tokens.some((token, i) => token !== pedido.transcricao.palavras[i]!.texto)) {
    throw new ErroDeRevisao('palavras_fora_do_texto', 'As palavras não são os tokens dos parágrafos revisados.');
  }
  const texto = textoDaTranscricao(pedido.paragrafos);
  const sha = createHash('sha256').update(texto, 'utf8').digest('hex');

  const existente = (await cliente.query<{ id: Id }>('SELECT id FROM revisao_transcricao WHERE documento_id=$1 AND sha256_texto=$2', [documento.id, sha])).rows[0];
  if (existente) {
    const job = await jobsRepo.enfileirar(cliente, dadosDoJob(documento.id, pedido.versao_base_id, sha));
    return { revisao_id: existente.id, job_id: job.id, sha256_texto: sha, criada: false };
  }
  const ultima = (await cliente.query<{ id: Id; fonte: string }>(`SELECT id, canonico->'documento'->>'sha256_original' AS fonte
    FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1`, [documento.id])).rows[0];
  if (!ultima || ultima.id !== pedido.versao_base_id) {
    throw new ErroDeRevisao('versao_base_desatualizada', 'A versão base não é a última versão do documento.', { ultima_versao_id: ultima?.id ?? null });
  }
  if (ultima.fonte === sha) throw new ErroDeRevisao('sem_mudanca', 'O texto revisado é o texto da versão atual.');
  const midia = (await cliente.query<{ id: Id }>('SELECT id FROM midia WHERE versao_id=$1 ORDER BY criado_em DESC, id DESC LIMIT 1', [ultima.id])).rows[0];
  if (!midia) throw new ErroDeRevisao('nao_e_transcricao', 'A versão base não tem mídia: não é uma transcrição.');
  const itens = await itensDaVersao(cliente, ultima.id);
  if (!pedido.aceitar_anotacoes_na_versao_anterior && Object.values(itens).some((n) => n > 0)) {
    throw new ErroDeRevisao('versao_com_anotacoes', 'A versão atual tem notas, grifos, marcas ou etiquetas; a leitura passaria a abrir a versão nova sem elas.', { ...itens });
  }
  const caminho = caminhoDaRevisao(documento.id, sha);
  await mkdir(join(pastaDoDocumento(documento.id), 'revisoes'), { recursive: true, mode: 0o700 });
  // Endereçado pelo conteúdo: regravar o mesmo texto é inofensivo; nunca há outro conteúdo com este nome.
  await writeFile(caminho, texto, { mode: 0o600 });
  const id = ulid();
  await cliente.query(`INSERT INTO revisao_transcricao (id,documento_id,versao_base_id,midia_base_id,sha256_texto,caminho_texto,transcricao,resumo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, documento.id, ultima.id, midia.id, sha, caminho, JSON.stringify(pedido.transcricao), JSON.stringify(pedido.resumo)]);
  const job = await jobsRepo.enfileirar(cliente, dadosDoJob(documento.id, ultima.id, sha));
  return { revisao_id: id, job_id: job.id, sha256_texto: sha, criada: true };
}

function dadosDoJob(documentoId: Id, versaoBaseId: Id, sha: string): jobsRepo.EntradaJob {
  return { tipo: TIPO_CANONIZAR_REVISAO, dedup_key: `canonizar_revisao:${documentoId}:${sha}`, input_snapshot_hash: sha,
    documento_id: documentoId, versao_id: versaoBaseId };
}

interface LinhaDaRevisao {
  id: Id; documento_id: Id; versao_base_id: Id; midia_base_id: Id; sha256_texto: string; caminho_texto: string;
  transcricao: PedidoDeRevisao['transcricao'];
}

async function revisaoDoJob(cliente: Transacao | pg.Pool, tarefa: Tarefa): Promise<LinhaDaRevisao> {
  const entrada = entradaDoJob(tarefa.job.entrada);
  const linha = (await cliente.query<LinhaDaRevisao>('SELECT * FROM revisao_transcricao WHERE documento_id=$1 AND sha256_texto=$2',
    [entrada.documento_id, tarefa.job.input_snapshot_hash])).rows[0];
  if (!linha) throw new Error('Revisão de transcrição não registrada para este job.');
  return linha;
}

const CONTEXTO = 32;
const baixo = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const alto = (c: number) => c >= 0xd800 && c <= 0xdbff;

/** Âncora da citação no bloco se ela aparece uma vez só; senão, o começo do bloco (o parágrafo certo basta). */
export function ancoraNoBloco(versaoId: Id, bloco: { id: Id; texto: string }, citacao: string): AncoraV1 {
  const texto = bloco.texto;
  const primeira = citacao === '' ? -1 : texto.indexOf(citacao);
  const unica = primeira >= 0 && texto.indexOf(citacao, primeira + 1) < 0;
  let inicio = unica ? primeira : 0;
  let fim = unica ? primeira + citacao.length : Math.min(texto.length, 48);
  if (fim < texto.length && baixo(texto.charCodeAt(fim))) fim++;
  if (inicio > 0 && baixo(texto.charCodeAt(inicio))) inicio--;
  let p0 = Math.max(0, inicio - CONTEXTO);
  if (p0 > 0 && baixo(texto.charCodeAt(p0))) p0--;
  let s1 = Math.min(texto.length, fim + CONTEXTO);
  if (s1 < texto.length && alto(texto.charCodeAt(s1 - 1))) s1++;
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: fim,
    citacao: texto.slice(inicio, fim), prefixo: texto.slice(p0, inicio), sufixo: texto.slice(fim, s1) };
}

export type DestinoDoProgresso = 'levado' | 'sem_progresso' | 'de_outra_versao' | 'sem_correspondencia';

/**
 * O ponto de leitura do leitor (tabela `progresso`, uma linha por documento) passa para a versão revisada:
 * a revisão nunca muda a divisão em parágrafos, então o bloco de mesma ordem é o mesmo parágrafo, e a
 * citação é procurada nele. Sem esse passo, o leitor abriria a versão nova do começo.
 */
export async function levarProgresso(cliente: Transacao, documentoId: Id, base: documentos.VersaoTexto, nova: documentos.VersaoTexto): Promise<DestinoDoProgresso> {
  const atual = await progressoRepo.ler(cliente, documentoId);
  if (!atual) return 'sem_progresso';
  if (atual.versao_id !== base.id) return 'de_outra_versao';
  const velhos = base.canonico.blocos, novos = nova.canonico.blocos;
  const indice = velhos.findIndex((b) => b.id === atual.ancora.bloco_id);
  if (velhos.length !== novos.length || velhos.some((b, i) => b.tipo !== novos[i]!.tipo) || indice < 0) return 'sem_correspondencia';
  const secoes = new Map(base.canonico.secoes.map((secao, i) => [secao.id, nova.canonico.secoes[i]?.id]));
  const capitulos = atual.capitulos_concluidos.map((id) => secoes.get(id)).filter((id): id is Id => id !== undefined);
  await progressoRepo.gravar(cliente, {
    documento_id: documentoId, versao_id: nova.id, ancora: ancoraNoBloco(nova.id, novos[indice]!, atual.ancora.citacao),
    revisao_esperada: atual.revisao, capitulos_concluidos: capitulos, atualizado_em: new Date(atual.atualizado_em).toISOString(),
  });
  return 'levado';
}

export interface OpcoesDaRevisao { banco: pg.Pool; raiz?: string; prazoMs?: number }

/** Job `canonizar_revisao`: canoniza o texto revisado e publica versão + mídia realinhada numa transação. */
export function manipuladorCanonizarRevisao(opcoes: OpcoesDaRevisao): Manipulador {
  const raiz = opcoes.raiz ?? raizDoRepositorio();
  return {
    async executar(tarefa: Tarefa): Promise<ResultadoExecutor> {
      if (tarefa.sinal.aborted) return falhou('cancelado', 'Canonização cancelada.', 0);
      const revisao = await revisaoDoJob(opcoes.banco, tarefa);
      const documento = (await opcoes.banco.query<documentos.Documento>('SELECT * FROM documento WHERE id=$1', [revisao.documento_id])).rows[0]!;
      // O texto em disco tem de ser o registrado (o nome é o hash, mas o disco não é confiável).
      if (sha256(await readFile(revisao.caminho_texto, 'utf8')) !== revisao.sha256_texto) {
        return falhou('schema', 'O texto revisado em disco não confere com o hash registrado.', 0);
      }
      await comTransacao(opcoes.banco, (cliente) => reconciliarCanonizacao(cliente, documento.id));
      const saida = pastaDaTentativaDeCanonizacao(documento.id, tarefa.job.id, tarefa.lease_token);
      await rm(saida, { recursive: true, force: true });
      const motor = await rodarMotor(raiz, revisao.caminho_texto, 'txt', saida, {
        titulo: documento.titulo, autor: documento.autor, poesia: documento.poesia, sinal: tarefa.sinal,
        ...(opcoes.prazoMs === undefined ? {} : { prazoMs: opcoes.prazoMs }),
      });
      if (motor.estado !== 'ok' || motor.caminho === undefined) {
        return falhou(tarefa.sinal.aborted ? 'cancelado' : 'processo', motor.mensagem ?? 'O motor não produziu canônico.', motor.duracao_ms);
      }
      const conteudo = await lerTextoLimitado(motor.caminho, ORCAMENTOS.canonico);
      const canonico: unknown = interpretarJson(conteudo, ORCAMENTOS.canonico);
      if (!validarCanonico(canonico)) return falhou('schema', 'Canônico inválido produzido pelo motor.', motor.duracao_ms);
      if (canonico.documento.sha256_original !== revisao.sha256_texto) return falhou('schema', 'O canônico não é do texto revisado.', motor.duracao_ms);
      return { estado: 'ok', artefato: motor.caminho, sha256: sha256(conteudo), duracao_ms: motor.duracao_ms, modelo: canonico.canonizacao.motor };
    },
    async publicar(tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> {
      const cliente = exigirTransacao(contexto);
      const revisao = await revisaoDoJob(cliente, tarefa);
      const resultado = await publicarCanonizacao(tarefa, execucao, contexto);
      const nova = (await cliente.query<{ id: Id; numero: number }>('SELECT id, numero FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1', [revisao.documento_id])).rows[0]!;
      const base = (await cliente.query<{ conteudo: MidiaV1 }>('SELECT conteudo FROM midia WHERE id=$1', [revisao.midia_base_id])).rows[0]!.conteudo;
      const { midia, diagnostico } = await publicarMidia(cliente, {
        documento_id: revisao.documento_id, versao_id: nova.id, sha256: base.sha256, titulo: base.titulo,
        fonte: base.fonte, capitulos: base.capitulos, transcricao: revisao.transcricao,
      });
      const progresso = await levarProgresso(cliente, revisao.documento_id,
        await documentos.obterVersao(cliente, revisao.versao_base_id), await documentos.obterVersao(cliente, nova.id));
      await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [tarefa.job.id, 'midia_realinhada', JSON.stringify({
        revisao_id: revisao.id, versao_base_id: revisao.versao_base_id, versao_id: nova.id, numero: nova.numero, midia_id: midia.id, progresso, ...diagnostico,
      })]);
      return resultado;
    },
  };
}
