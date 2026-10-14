/**
 * "Analisar" por tipo de documento (J142). Uma entrada só para o botão da página do documento:
 *
 *   POST /api/documentos/:id/analise  { todos?, itens? }  → texto: a preparação da leitura (J131);
 *                                                           vídeo: a análise própria do vídeo (abaixo)
 *   GET  /api/documentos/:id/analise                      → a situação da preparação + `video`
 *
 * (`POST /api/documentos/:id/preparacao` chama a mesma função: o botão de hoje já analisa vídeo do jeito certo.)
 *
 * A análise do vídeo, em ordem:
 *
 * 1. **Transcrição passada a limpo** (`revisar_transcricao`, `revisar-transcricao@3`), quando a fala veio da
 *    legenda automática do YouTube, do transcritor local ou de um arquivo, e a versão ainda não tem grifos nem
 *    notas. Ela vira versão nova (o `canonizar_revisao` do J90 realinha a mídia) e só então a análise segue,
 *    sobre o texto limpo. O pedido espera em `documento.analise_video` (etapa `transcricao`).
 * 2. **Grifos e relações** na transcrição, como nos textos: a mesma preparação (`prepararDocumentoNa`), com os
 *    itens que a pessoa marcou.
 * 3. **Partes e momentos do vídeo** (`conceitos_do_video`, `conceitos-do-video@3`): o índice por assunto e os
 *    popups que aparecem sobre o vídeo no instante certo. Parte padrão da análise de todo vídeo com fala
 *    sincronizada.
 *
 * Se a limpeza falhar, "Analisar" de novo segue sem ela (a transcrição original fica). Vídeo sem fala
 * sincronizada (sem áudio local ou sem legenda) recebe só os grifos, quando há texto.
 */
import type pg from 'pg';
import type { Id, MidiaV1, VideoYoutubeV1 } from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';
import type { ConfiguracaoDaCompreensao } from '../compreensao/pipeline.js';
import { prepararDocumentoNa, situacaoDaPreparacao, type PedidoDaPreparacao, type ResultadoDaPreparacao, type SituacaoDaPreparacao } from '../compreensao/preparacao.js';
import { estadoDosConceitos, midiaDeVideo, pedirConceitos, type EstadoDosConceitos } from './conceitos.js';
import { estadoDaLimpeza, MARCA_DA_LIMPEZA, pedirLimpeza, precisaPassarALimpo } from './limpeza-da-transcricao.js';
import { itensDaVersao } from './revisao.js';

export interface ResultadoDaAnalise extends ResultadoDaPreparacao {
  /** A análise espera a transcrição ser passada a limpo (o resto começa sozinho depois). */
  aguardando_transcricao: boolean;
}

interface AnaliseGuardada { pedido: PedidoDaPreparacao; etapa: 'transcricao' | 'leitura'; em: string }

/** Documento de vídeo (ou áudio): veio do YouTube ou tem mídia com fala. */
export async function ehDocumentoDeMidia(cliente: Transacao | pg.Pool, documentoId: Id): Promise<boolean> {
  const { rowCount } = await cliente.query(`SELECT 1 FROM documento d WHERE d.id=$1 AND (EXISTS (SELECT 1 FROM video_youtube y WHERE y.documento_id=d.id)
    OR EXISTS (SELECT 1 FROM midia m WHERE m.documento_id=d.id))`, [documentoId]);
  return (rowCount ?? 0) > 0;
}

async function ultimaVersao(cliente: Transacao, documentoId: Id): Promise<Id | null> {
  return (await cliente.query<{ id: Id }>('SELECT id FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1', [documentoId])).rows[0]?.id ?? null;
}
async function midiaDaVersao(cliente: Transacao, versaoId: Id): Promise<MidiaV1 | null> {
  return (await cliente.query<{ conteudo: MidiaV1 }>('SELECT conteudo FROM midia WHERE versao_id=$1 ORDER BY criado_em DESC, id DESC LIMIT 1', [versaoId])).rows[0]?.conteudo ?? null;
}
async function videoDoDocumento(cliente: Transacao, documentoId: Id): Promise<VideoYoutubeV1 | null> {
  return (await cliente.query<{ conteudo: VideoYoutubeV1 }>('SELECT conteudo FROM video_youtube WHERE documento_id=$1', [documentoId])).rows[0]?.conteudo ?? null;
}
async function guardar(cliente: Transacao, documentoId: Id, analise: AnaliseGuardada): Promise<void> {
  await cliente.query('UPDATE documento SET analise_video=$2 WHERE id=$1', [documentoId, JSON.stringify(analise)]);
}

const pedidoLimpo = (pedido: PedidoDaPreparacao): PedidoDaPreparacao => ({
  ...(pedido.todos === undefined ? {} : { todos: pedido.todos }), ...(pedido.itens === undefined ? {} : { itens: pedido.itens }),
});

/** Grifos e relações + partes e momentos, sobre a versão atual. */
async function seguirNa(config: ConfiguracaoDaCompreensao, cliente: Transacao, documentoId: Id, pedido: PedidoDaPreparacao): Promise<ResultadoDaAnalise> {
  await guardar(cliente, documentoId, { pedido: pedidoLimpo(pedido), etapa: 'leitura', em: new Date().toISOString() });
  const resultado = await prepararDocumentoNa(config, cliente, documentoId, pedido);
  const versaoId = await ultimaVersao(cliente, documentoId);
  const midia = versaoId === null ? null : await midiaDaVersao(cliente, versaoId);
  if (midia && midiaDeVideo({ tipo: midia.tipo, url: midia.fonte?.url ?? null })) await pedirConceitos(cliente, midia.id);
  return { ...resultado, aguardando_transcricao: false };
}

/** A análise do vídeo, numa transação aberta. */
export async function analisarVideoNa(config: ConfiguracaoDaCompreensao, cliente: Transacao, documentoId: Id, pedido: PedidoDaPreparacao = {}): Promise<ResultadoDaAnalise> {
  await cliente.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 3131))', [documentoId]);
  const versaoId = await ultimaVersao(cliente, documentoId);
  const midia = versaoId === null ? null : await midiaDaVersao(cliente, versaoId);
  if (versaoId !== null && midia !== null && precisaPassarALimpo(midia, await videoDoDocumento(cliente, documentoId))) {
    const limpeza = await estadoDaLimpeza(cliente, versaoId);
    const anotada = Object.values(await itensDaVersao(cliente, versaoId)).some((n) => n > 0);
    // Na fila, ou ainda não pedida numa versão sem anotações: a análise espera a transcrição limpa.
    if (limpeza === 'na_fila' || (limpeza === 'nao_pedida' && !anotada)) {
      await guardar(cliente, documentoId, { pedido: pedidoLimpo(pedido), etapa: 'transcricao', em: new Date().toISOString() });
      if (limpeza === 'nao_pedida') await pedirLimpeza(cliente, documentoId, versaoId);
      return { compreensao_id: null, criada: false, enfileirados: limpeza === 'nao_pedida' ? 1 : 0, devolvidos: 0, aguardando_tipo: false, aguardando_transcricao: true };
    }
    // Limpa a versão seguinte já está a caminho (`canonizar_revisao` na fila): também espera.
    if (limpeza === 'pronta' && await revisaoACaminho(cliente, documentoId)) {
      await guardar(cliente, documentoId, { pedido: pedidoLimpo(pedido), etapa: 'transcricao', em: new Date().toISOString() });
      return { compreensao_id: null, criada: false, enfileirados: 0, devolvidos: 0, aguardando_tipo: false, aguardando_transcricao: true };
    }
  }
  return seguirNa(config, cliente, documentoId, pedido);
}

async function revisaoACaminho(cliente: Transacao, documentoId: Id): Promise<boolean> {
  const { rowCount } = await cliente.query(`SELECT 1 FROM job WHERE tipo='canonizar_revisao' AND documento_id=$1 AND estado IN ('fila','reservado','adiado')`, [documentoId]);
  return (rowCount ?? 0) > 0;
}

/**
 * Chamada quando a transcrição limpa foi publicada (versão nova com a mídia realinhada) ou quando a limpeza
 * terminou sem versão nova: a análise que esperava segue. Sem análise esperando, nada acontece.
 */
export async function seguirAnaliseDoVideo(config: ConfiguracaoDaCompreensao, cliente: Transacao, documentoId: Id): Promise<void> {
  const guardada = (await cliente.query<{ analise_video: AnaliseGuardada | null }>('SELECT analise_video FROM documento WHERE id=$1', [documentoId])).rows[0]?.analise_video;
  if (guardada?.etapa !== 'transcricao') return;
  await seguirNa(config, cliente, documentoId, guardada.pedido);
}

/** "Analisar": decide pelo tipo do documento. */
export async function analisarDocumento(config: ConfiguracaoDaCompreensao, documentoId: Id, pedido: PedidoDaPreparacao = {}): Promise<ResultadoDaAnalise> {
  return comTransacao(config.banco, async (cliente) => {
    if (await ehDocumentoDeMidia(cliente, documentoId)) return analisarVideoNa(config, cliente, documentoId, pedido);
    return { ...await prepararDocumentoNa(config, cliente, documentoId, pedido), aguardando_transcricao: false };
  });
}

// ---------------------------------------------------------------- situação

export type EstadoDaTranscricao = 'sem_transcricao' | 'sem_sincronia' | 'original' | 'passando_a_limpo' | 'limpa' | 'falhou' | 'sem_limpeza';

export interface SituacaoDoVideo {
  midia_id: Id | null;
  /** O que aconteceu com a transcrição: limpa, sendo passada a limpo, original (legenda do canal) etc. */
  transcricao: { estado: EstadoDaTranscricao; detalhe: string | null };
  /** Partes e momentos sobre o vídeo. */
  momentos: { estado: EstadoDosConceitos | 'sem_fala'; quantidade: number; partes: number };
  /** A análise espera a transcrição limpa para seguir. */
  aguardando_transcricao: boolean;
}

export interface SituacaoDaAnalise extends SituacaoDaPreparacao {
  /** Só nos documentos de vídeo (ou áudio). */
  video: SituacaoDoVideo | null;
}

export async function situacaoDoVideo(cliente: Transacao, documentoId: Id): Promise<SituacaoDoVideo> {
  const versaoId = await ultimaVersao(cliente, documentoId);
  const midia = versaoId === null ? null : await midiaDaVersao(cliente, versaoId);
  const video = await videoDoDocumento(cliente, documentoId);
  const guardada = (await cliente.query<{ analise_video: AnaliseGuardada | null }>('SELECT analise_video FROM documento WHERE id=$1', [documentoId])).rows[0]?.analise_video ?? null;
  const aguardando = guardada?.etapa === 'transcricao';
  if (midia === null) {
    const semFala = video?.transcricao.estado === 'sem_transcricao' || video === null;
    return {
      midia_id: null, aguardando_transcricao: false, momentos: { estado: 'sem_fala', quantidade: 0, partes: 0 },
      transcricao: { estado: semFala ? 'sem_transcricao' : 'sem_sincronia', detalhe: video?.transcricao.detalhe ?? null },
    };
  }
  let transcricao: SituacaoDoVideo['transcricao'];
  if (midia.transcricao.motor.includes(MARCA_DA_LIMPEZA)) transcricao = { estado: 'limpa', detalhe: null };
  else if (!precisaPassarALimpo(midia, video)) transcricao = { estado: 'original', detalhe: 'Legenda escrita pelo canal.' };
  else {
    const limpeza = versaoId === null ? 'nao_pedida' : await estadoDaLimpeza(cliente, versaoId);
    transcricao = limpeza === 'na_fila' || (limpeza === 'pronta' && aguardando) ? { estado: 'passando_a_limpo', detalhe: null }
      : limpeza === 'falhou' ? { estado: 'falhou', detalhe: 'A transcrição não pôde ser passada a limpo; Analisar de novo segue com a original.' }
        : limpeza === 'pronta' ? { estado: 'sem_limpeza', detalhe: 'A transcrição já tinha grifos ou notas e ficou como estava.' }
          : { estado: 'original', detalhe: null };
  }
  const conceitos = midiaDeVideo({ tipo: midia.tipo, url: midia.fonte?.url ?? null }) ? await estadoDosConceitos(cliente, midia.id) : null;
  return {
    midia_id: midia.id, transcricao, aguardando_transcricao: aguardando,
    momentos: conceitos === null ? { estado: 'sem_fala', quantidade: 0, partes: 0 }
      : { estado: conceitos.estado, quantidade: conceitos.conceitos?.conceitos.length ?? 0, partes: conceitos.conceitos?.partes?.length ?? 0 },
  };
}

export async function situacaoDaAnalise(cliente: Transacao, documentoId: Id): Promise<SituacaoDaAnalise> {
  const preparacao = await situacaoDaPreparacao(cliente, documentoId);
  if (!(await ehDocumentoDeMidia(cliente, documentoId))) return { ...preparacao, video: null };
  const video = await situacaoDoVideo(cliente, documentoId);
  // Enquanto a transcrição é passada a limpo, a leitura ainda não começou: "preparando", não "não preparada".
  return { ...preparacao, ...(video.aguardando_transcricao && preparacao.estado === 'nao_preparada' ? { estado: 'preparando' as const } : {}), video };
}
