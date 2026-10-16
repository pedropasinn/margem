/**
 * Importação de vídeo do YouTube por link (J109).
 *
 * O vídeo toca pelo player oficial embutido (cada reprodução conta para o canal): o serviço **não baixa
 * o vídeo**. Baixa no máximo o áudio, para a sincronia palavra→tempo e para tocar como alternativa
 * quando o dono do vídeo não permite incorporar.
 *
 * 1. `registrarImportacaoYoutube` (API, `POST /api/importacoes/youtube`): recusa vídeo já na biblioteca
 *    (por `video_youtube` ou por uma mídia com `fonte.url` desse vídeo, como as do J71), cria o
 *    documento (TXT), a linha `video_youtube` (`pendente`) e o job `importar_youtube`.
 * 2. `importar_youtube` (worker): metadados pelo yt-dlp; texto das legendas do próprio vídeo (as do
 *    canal; senão as automáticas da língua original); sem legenda, o transcritor local, se houver;
 *    sem nenhum dos dois, o documento diz "Sem transcrição" e o vídeo toca assim mesmo. O motor
 *    canoniza o texto; a publicação cria a versão e, na mesma transação, a mídia com o áudio
 *    (`fonte.url` no YouTube) e o estado final do vídeo.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type pg from 'pg';
import { validarCanonico, validarVideoYoutube, type Id, type JobResultV1, type VideoYoutubeV1 } from '@margem/contratos';
import type { PalavraTranscrita } from '@margem/core';
import { idDoVideoDoYoutube, urlDeAssistirNoYoutube } from '@margem/core/youtube';
import { caminhoDoOriginal, originalDoDocumento, pastaDaTentativaDeCanonizacao, pastaDoDocumento, raizDoRepositorio } from '../dados';
import { comTransacao, type Transacao } from '../db/transacao';
import { interpretarJson, lerTextoLimitado, ORCAMENTOS } from '../entrada-json';
import { sha256 } from '../executor/artefato';
import { falhou, type ExecucaoOk, type ResultadoExecutor } from '../executor/tipos';
import * as documentosRepo from '../repos/documentos';
import * as jobsRepo from '../repos/jobs';
import { reconciliarCanonizacao } from '../worker/arquivos-canonizacao';
import { exigirTransacao, publicarCanonizacao, rodarMotor } from '../worker/canonizar';
import { entradaDoJob } from '../worker/fila-postgres';
import type { ContextoPublicacao } from '../worker/fila';
import type { Manipulador, Tarefa } from '../worker/worker';
import { caminhoDaMidia, receberMidia, sondarMidia } from './arquivos';
import { FerramentaAusente, fonteYtDlp, transcritorDoAmbiente, type FonteDoYoutube, type Transcritor } from './fontes-do-youtube';
import { ErroDeMidia, publicarMidia } from './publicacao';
import { textoDaTranscricao } from './revisao';
import { escolherLegenda, paragrafosDoTexto, palavrasDaLegendaJson3, textoSemTranscricao, tituloProvisorio, videoComEstadoDoJob, type MetadadosDoYoutube } from './youtube';

export const TIPO_IMPORTAR_YOUTUBE = 'importar_youtube';

const chaveDoVideo = (videoId: string): string => `youtube:${videoId}`;

/** O documento (não arquivado) que já tem este vídeo: importado por link ou com mídia dele (J71). */
export async function documentoDoVideo(cliente: Transacao | pg.Pool, videoId: string): Promise<Id | null> {
  const porLink = (await cliente.query<{ documento_id: Id }>(`SELECT v.documento_id FROM video_youtube v JOIN documento d ON d.id=v.documento_id
    WHERE v.video_id=$1 AND d.arquivado_em IS NULL ORDER BY v.criado_em LIMIT 1`, [videoId])).rows[0];
  if (porLink) return porLink.documento_id;
  // O id aparece na URL; o filtro fino (o id é mesmo o do vídeo, não parte de outro texto) é o do núcleo.
  const { rows } = await cliente.query<{ documento_id: Id; url: string }>(`SELECT m.documento_id, m.conteudo->'fonte'->>'url' AS url
    FROM midia m JOIN documento d ON d.id=m.documento_id
    WHERE d.arquivado_em IS NULL AND strpos(m.conteudo->'fonte'->>'url', $1) > 0 ORDER BY m.criado_em`, [videoId]);
  return rows.find((linha) => idDoVideoDoYoutube(linha.url) === videoId)?.documento_id ?? null;
}

export type ImportacaoRegistrada = { documento_id: Id; job_id: Id } | { erro: 'documento_duplicado'; documento_id: Id };

/** Cria documento, vídeo e job numa transação; o mesmo vídeo duas vezes ao mesmo tempo vira um só. */
export async function registrarImportacaoYoutube(banco: pg.Pool, pedido: { video_id: string; titulo?: string; autor?: string }): Promise<ImportacaoRegistrada> {
  const videoId = pedido.video_id;
  return comTransacao(banco, async (cliente) => {
    await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [chaveDoVideo(videoId)]);
    const existente = await documentoDoVideo(cliente, videoId);
    if (existente !== null) return { erro: 'documento_duplicado' as const, documento_id: existente };
    const titulo = pedido.titulo?.trim() || tituloProvisorio(videoId);
    const marca = createHash('sha256').update(chaveDoVideo(videoId), 'utf8').digest('hex');
    const documento = await documentosRepo.criar(cliente, {
      titulo, formato: 'txt', idioma: 'pt-BR', sha256_original: marca,
      ...(pedido.autor?.trim() ? { autor: pedido.autor.trim() } : {}),
      origem_caminho: caminhoDoOriginal('0'.repeat(26), 'txt'),
    });
    await mkdir(pastaDoDocumento(documento.id), { recursive: true, mode: 0o700 });
    await cliente.query('UPDATE documento SET origem_caminho=$2 WHERE id=$1', [documento.id, caminhoDoOriginal(documento.id, 'txt')]);
    const video: VideoYoutubeV1 = {
      versao: 1, documento_id: documento.id, video_id: videoId, url: urlDeAssistirNoYoutube(videoId), titulo,
      capitulos: [], transcricao: { estado: 'pendente' },
    };
    if (!validarVideoYoutube(video)) throw new Error('VideoYoutubeV1 inválido na criação.');
    await cliente.query('INSERT INTO video_youtube (documento_id, video_id, conteudo) VALUES ($1,$2,$3)', [documento.id, videoId, JSON.stringify(video)]);
    const job = await jobsRepo.enfileirar(cliente, {
      tipo: TIPO_IMPORTAR_YOUTUBE, dedup_key: `${TIPO_IMPORTAR_YOUTUBE}:${documento.id}`, input_snapshot_hash: marca,
      documento_id: documento.id, prioridade: jobsRepo.PRIORIDADE.artefato_pedido,
    });
    return { documento_id: documento.id, job_id: job.id };
  });
}

/** O vídeo do documento como o leitor o recebe (com o estado do job, se a importação desistiu). */
export async function videoDoDocumento(cliente: Transacao | pg.Pool, documentoId: Id): Promise<VideoYoutubeV1 | null> {
  const linha = (await cliente.query<{ conteudo: VideoYoutubeV1; estado: string | null; error_code: string | null }>(`SELECT v.conteudo, j.estado, j.error_code
    FROM video_youtube v LEFT JOIN job j ON j.dedup_key=($2::text || v.documento_id) WHERE v.documento_id=$1`, [documentoId, `${TIPO_IMPORTAR_YOUTUBE}:`])).rows[0];
  if (!linha) return null;
  return videoComEstadoDoJob(linha.conteudo, linha.estado === null ? null : { estado: linha.estado, error_code: linha.error_code });
}

/** O que `executar` deixa para `publicar`, ao lado da tentativa. */
interface ResultadoDaImportacao {
  sha_texto: string;
  titulo: string;
  autor: string | null;
  meta: Omit<MetadadosDoYoutube, 'descricao' | 'legendas' | 'automaticas'>;
  transcricao: { origem: NonNullable<VideoYoutubeV1['transcricao']['origem']>; idioma: string; motor: string; palavras: PalavraTranscrita[] } | null;
  audio_sha256: string | null;
  detalhe: string | null;
}

const pastaDaImportacao = (documentoId: Id, lease: Id): string => join(pastaDoDocumento(documentoId), 'youtube', `tentativa-${lease}`);
const mensagem = (erro: unknown): string => (erro instanceof Error ? erro.message : String(erro)).replace(/\s+/g, ' ').slice(0, 300);

export interface OpcoesDaImportacaoYoutube {
  banco: pg.Pool;
  raiz?: string;
  prazoMs?: number;
  fonte?: FonteDoYoutube;
  /** `null` desliga; sem a opção, vale `MARGEM_TRANSCRITOR`. */
  transcritor?: Transcritor | null;
}

/** Job `importar_youtube`: legendas (ou transcrição local) → texto → versão + mídia com o áudio. */
export function manipuladorImportarYoutube(opcoes: OpcoesDaImportacaoYoutube): Manipulador {
  const raiz = opcoes.raiz ?? raizDoRepositorio();
  const fonte = opcoes.fonte ?? fonteYtDlp();
  const transcritor = opcoes.transcritor === undefined ? transcritorDoAmbiente() : opcoes.transcritor;
  return {
    async executar(tarefa: Tarefa): Promise<ResultadoExecutor> {
      const inicio = Date.now();
      const cancelado = (): ResultadoExecutor => falhou('cancelado', 'Importação cancelada.', Date.now() - inicio);
      if (tarefa.sinal.aborted) return cancelado();
      const entrada = entradaDoJob(tarefa.job.entrada);
      if (entrada.documento_id === null) return falhou('desconhecido', 'Job de importação sem documento.', 0);
      const documento = (await opcoes.banco.query<documentosRepo.Documento>('SELECT * FROM documento WHERE id=$1', [entrada.documento_id])).rows[0];
      const linha = (await opcoes.banco.query<{ video_id: string }>('SELECT video_id FROM video_youtube WHERE documento_id=$1', [entrada.documento_id])).rows[0];
      if (!documento || !linha) return falhou('desconhecido', 'Vídeo do YouTube não registrado para este documento.', 0);
      const videoId = linha.video_id;
      const pasta = pastaDaImportacao(documento.id, tarefa.lease_token);
      await rm(pasta, { recursive: true, force: true });
      await mkdir(pasta, { recursive: true, mode: 0o700 });

      // 1. Metadados. Sem yt-dlp (ou depois da última tentativa), segue com o mínimo: o vídeo toca igual.
      const avisos: string[] = [];
      let meta: MetadadosDoYoutube;
      let semYtDlp = false;
      try { meta = await fonte.metadados(videoId, tarefa.sinal); }
      catch (erro) {
        if (tarefa.sinal.aborted) return cancelado();
        semYtDlp = erro instanceof FerramentaAusente;
        if (!semYtDlp && tarefa.job.attempt < jobsRepo.MAXIMO_TENTATIVAS) return falhou('processo', `Metadados do YouTube: ${mensagem(erro)}`, Date.now() - inicio);
        avisos.push(semYtDlp ? 'O yt-dlp não está instalado, então o Margem não buscou legendas.' : `O YouTube não respondeu (${mensagem(erro)}).`);
        meta = { id: videoId, titulo: null, canal: null, publicado_em: null, duracao_s: null, idioma: null, descricao: null, capitulos: [], legendas: [], automaticas: [] };
      }

      // 1b. A miniatura do vídeo, para a capa na biblioteca (J133); sem rede, a capa fica com o título.
      if (!semYtDlp) await fonte.miniatura?.(documento.id, videoId, tarefa.sinal).catch(() => null);

      // 2. Texto com tempo: legendas do próprio vídeo.
      let transcricao: ResultadoDaImportacao['transcricao'] = null;
      const escolha = escolherLegenda(meta);
      if (escolha !== null) {
        try {
          const palavras = palavrasDaLegendaJson3(await fonte.legenda(videoId, escolha, pasta, tarefa.sinal));
          const idioma = escolha.idioma.replace(/-orig$/i, '');
          if (palavras.length > 0) transcricao = {
            origem: escolha.automatica ? 'legendas_automaticas' : 'legendas', idioma, palavras,
            motor: `legendas do YouTube (${escolha.automatica ? 'automáticas' : 'do canal'}, ${idioma})`,
          };
          else avisos.push('A legenda do vídeo veio vazia.');
        } catch (erro) {
          if (tarefa.sinal.aborted) return cancelado();
          avisos.push(`A legenda não pôde ser baixada (${mensagem(erro)}).`);
        }
      }

      // 3. Só o áudio: para a sincronia (a mídia precisa de um arquivo) e para o transcritor local.
      let audio: string | null = null;
      if (!semYtDlp && (transcricao !== null || transcritor !== null)) {
        try {
          const baixado = await fonte.audio(videoId, pasta, tarefa.sinal);
          const recebido = await receberMidia(Readable.toWeb(createReadStream(baixado)) as ReadableStream<Uint8Array>);
          await sondarMidia(caminhoDaMidia(recebido.sha256));
          audio = recebido.sha256;
          await rm(baixado, { force: true });
        } catch (erro) {
          if (tarefa.sinal.aborted) return cancelado();
          avisos.push(`O áudio não pôde ser baixado (${mensagem(erro)}).`);
        }
      }
      if (transcricao === null && transcritor !== null && audio !== null) {
        try {
          const local = await transcritor.transcrever(caminhoDaMidia(audio), pasta, tarefa.sinal);
          if (local.palavras.length > 0) transcricao = { origem: 'transcritor_local', idioma: local.idioma, motor: local.motor, palavras: local.palavras };
        } catch (erro) {
          if (tarefa.sinal.aborted) return cancelado();
          avisos.push(`O transcritor local falhou (${mensagem(erro)}).`);
        }
      }

      // 4. O texto do documento: a transcrição em parágrafos, ou o aviso de que não há transcrição.
      let motivo = avisos.join(' ');
      if (transcricao === null && motivo === '') motivo = escolha === null
        ? `O YouTube não oferece legendas para este vídeo${transcritor === null ? ' e não há transcritor local configurado' : ''}.`
        : 'A transcrição não pôde ser obtida.';
      const texto = transcricao !== null ? textoDaTranscricao(paragrafosDoTexto(transcricao.palavras, meta.capitulos)) : textoSemTranscricao(meta, motivo);
      const shaTexto = createHash('sha256').update(texto, 'utf8').digest('hex');
      await writeFile(originalDoDocumento(documento), texto, { mode: 0o600 });
      const titulo = documento.titulo === tituloProvisorio(videoId) && meta.titulo !== null ? meta.titulo : documento.titulo;
      const autor = documento.autor ?? meta.canal;

      // 5. Canonização (o mesmo motor dos TXT), como na revisão de transcrição do J90.
      await comTransacao(opcoes.banco, (cliente) => reconciliarCanonizacao(cliente, documento.id));
      const saida = pastaDaTentativaDeCanonizacao(documento.id, tarefa.job.id, tarefa.lease_token);
      await rm(saida, { recursive: true, force: true });
      const motor = await rodarMotor(raiz, originalDoDocumento(documento), 'txt', saida, {
        titulo, autor, poesia: false, sinal: tarefa.sinal, ...(opcoes.prazoMs === undefined ? {} : { prazoMs: opcoes.prazoMs }),
      });
      if (motor.estado !== 'ok' || motor.caminho === undefined) {
        return falhou(tarefa.sinal.aborted ? 'cancelado' : 'processo', motor.mensagem ?? 'O motor não produziu canônico.', Date.now() - inicio);
      }
      const conteudo = await lerTextoLimitado(motor.caminho, ORCAMENTOS.canonico);
      const canonico: unknown = interpretarJson(conteudo, ORCAMENTOS.canonico);
      if (!validarCanonico(canonico)) return falhou('schema', 'Canônico inválido produzido pelo motor.', Date.now() - inicio);
      if (canonico.documento.sha256_original !== shaTexto) return falhou('schema', 'O canônico não é do texto da importação.', Date.now() - inicio);
      const essenciais: ResultadoDaImportacao['meta'] = {
        id: meta.id, titulo: meta.titulo, canal: meta.canal, publicado_em: meta.publicado_em, duracao_s: meta.duracao_s, idioma: meta.idioma, capitulos: meta.capitulos,
      };
      const resultado: ResultadoDaImportacao = {
        sha_texto: shaTexto, titulo, autor, meta: essenciais, transcricao, audio_sha256: audio,
        detalhe: transcricao !== null && audio === null ? motivo : transcricao === null ? motivo : null,
      };
      await writeFile(join(pasta, 'resultado.json'), JSON.stringify(resultado), { mode: 0o600 });
      return { estado: 'ok', artefato: motor.caminho, sha256: sha256(conteudo), duracao_ms: Date.now() - inicio, modelo: canonico.canonizacao.motor };
    },

    async publicar(tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> {
      const cliente = exigirTransacao(contexto);
      const entrada = entradaDoJob(tarefa.job.entrada);
      if (entrada.documento_id === null) throw new Error('Job de importação sem documento.');
      const documentoId = entrada.documento_id;
      const pasta = pastaDaImportacao(documentoId, tarefa.lease_token);
      const r = JSON.parse(await readFile(join(pasta, 'resultado.json'), 'utf8')) as ResultadoDaImportacao;
      const resultado = await publicarCanonizacao(tarefa, execucao, contexto, { fonteDerivada: r.sha_texto });
      await cliente.query('UPDATE documento SET titulo=$2, autor=coalesce(autor,$3) WHERE id=$1', [documentoId, r.titulo, r.autor]);
      const versao = (await cliente.query<{ id: Id }>('SELECT id FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1', [documentoId])).rows[0]!;
      const atual = (await cliente.query<{ conteudo: VideoYoutubeV1 }>('SELECT conteudo FROM video_youtube WHERE documento_id=$1 FOR UPDATE', [documentoId])).rows[0];
      if (!atual) throw new Error('Vídeo do YouTube não registrado.');
      const url = urlDeAssistirNoYoutube(atual.conteudo.video_id);

      let transcricao: VideoYoutubeV1['transcricao'];
      let diagnostico: Record<string, unknown> = {};
      if (r.transcricao === null) {
        transcricao = { estado: 'sem_transcricao', ...(r.detalhe ? { detalhe: r.detalhe.slice(0, 500) } : {}) };
      } else if (r.audio_sha256 === null) {
        transcricao = { estado: 'sem_sincronia', origem: r.transcricao.origem, idioma: r.transcricao.idioma, detalhe: (r.detalhe || 'Sem áudio local para a sincronia.').slice(0, 500) };
      } else {
        try {
          const publicada = await publicarMidia(cliente, {
            documento_id: documentoId, versao_id: versao.id, sha256: r.audio_sha256, titulo: r.titulo,
            fonte: { url, ...(r.meta.canal ? { canal: r.meta.canal } : {}), ...(r.meta.publicado_em ? { publicado_em: r.meta.publicado_em } : {}) },
            capitulos: r.meta.capitulos,
            transcricao: { motor: r.transcricao.motor, idioma: r.transcricao.idioma, palavras: r.transcricao.palavras },
          });
          transcricao = { estado: 'pronta', origem: r.transcricao.origem, idioma: r.transcricao.idioma, midia_id: publicada.midia.id };
          diagnostico = { ...publicada.diagnostico };
        } catch (erro) {
          if (!(erro instanceof ErroDeMidia)) throw erro;
          transcricao = { estado: 'sem_sincronia', origem: r.transcricao.origem, idioma: r.transcricao.idioma, detalhe: `A sincronia não fechou: ${erro.message}`.slice(0, 500) };
        }
      }
      const video: VideoYoutubeV1 = {
        versao: 1, documento_id: documentoId, video_id: atual.conteudo.video_id, url, titulo: r.titulo,
        ...(r.meta.canal ? { canal: r.meta.canal } : {}), ...(r.meta.publicado_em ? { publicado_em: r.meta.publicado_em } : {}),
        ...(r.meta.duracao_s ? { duracao_s: r.meta.duracao_s } : {}),
        capitulos: r.meta.capitulos, transcricao,
      };
      if (!validarVideoYoutube(video)) throw new Error(`VideoYoutubeV1 inválido: ${JSON.stringify(validarVideoYoutube.errors?.slice(0, 3))}`);
      await cliente.query('UPDATE video_youtube SET conteudo=$2, atualizado_em=clock_timestamp() WHERE documento_id=$1', [documentoId, JSON.stringify(video)]);
      await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [tarefa.job.id, 'youtube_importado', JSON.stringify({
        documento_id: documentoId, versao_id: versao.id, video_id: video.video_id, estado: transcricao.estado,
        origem: transcricao.origem ?? null, palavras: r.transcricao?.palavras.length ?? 0, audio: r.audio_sha256 !== null, ...diagnostico,
      })]);
      await rm(pasta, { recursive: true, force: true });
      return resultado;
    },
  };
}
