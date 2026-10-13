/** Persistência da visita guiada (J91): roteiros e narrações, imutáveis (`0015_visita.sql`). */
import {
  validarNarracaoDaVisita, validarRoteiroGuiado, type Id, type NarracaoDaVisitaV1, type RoteiroGuiadoV1,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

function exigirRoteiro(valor: unknown): RoteiroGuiadoV1 {
  if (!validarRoteiroGuiado(valor)) throw new Error(`Roteiro da visita inválido: ${JSON.stringify(validarRoteiroGuiado.errors)}`);
  return valor;
}
function exigirNarracao(valor: unknown): NarracaoDaVisitaV1 {
  if (!validarNarracaoDaVisita(valor)) throw new Error(`Narração da visita inválida: ${JSON.stringify(validarNarracaoDaVisita.errors)}`);
  return valor;
}

export async function gravarRoteiro(cliente: Transacao, roteiro: RoteiroGuiadoV1): Promise<RoteiroGuiadoV1> {
  const valido = exigirRoteiro(roteiro);
  // Publicação repetida do mesmo job: fica a primeira (o job é a unidade de publicação).
  const { rows: [existente] } = await cliente.query<{ conteudo: RoteiroGuiadoV1 }>('SELECT conteudo FROM roteiro_visita WHERE job_id=$1', [valido.job_id]);
  if (existente) return existente.conteudo;
  await cliente.query(`INSERT INTO roteiro_visita(id,execucao_id,versao_id,secao_id,modelo_id,perfil_hash,job_id,conteudo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [valido.id, valido.execucao_id, valido.versao_id, valido.secao_id, valido.modelo_id, valido.perfil_hash, valido.job_id, JSON.stringify(valido)]);
  return valido;
}

/** O roteiro mais recente do capítulo nesta execução (de qualquer revisão ou perfil). */
export async function roteiroDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<RoteiroGuiadoV1 | null> {
  const { rows: [linha] } = await cliente.query<{ conteudo: unknown }>(
    'SELECT conteudo FROM roteiro_visita WHERE execucao_id=$1 AND secao_id=$2 ORDER BY criado_em DESC, id DESC LIMIT 1', [execucaoId, secaoId]);
  return linha ? exigirRoteiro(linha.conteudo) : null;
}

export async function obterRoteiro(cliente: Transacao, id: Id): Promise<RoteiroGuiadoV1 | null> {
  const { rows: [linha] } = await cliente.query<{ conteudo: unknown }>('SELECT conteudo FROM roteiro_visita WHERE id=$1', [id]);
  return linha ? exigirRoteiro(linha.conteudo) : null;
}

/** Capítulos da execução que já têm roteiro (para a visita saber onde pode seguir). */
export async function capitulosComRoteiro(cliente: Transacao, execucaoId: Id): Promise<Id[]> {
  const { rows } = await cliente.query<{ secao_id: Id }>('SELECT DISTINCT secao_id FROM roteiro_visita WHERE execucao_id=$1', [execucaoId]);
  return rows.map((linha) => linha.secao_id);
}

export async function gravarNarracao(cliente: Transacao, narracao: NarracaoDaVisitaV1): Promise<NarracaoDaVisitaV1> {
  const valida = exigirNarracao(narracao);
  const roteiro = await obterRoteiro(cliente, valida.roteiro_id);
  if (!roteiro) throw new Error('Narração de um roteiro inexistente.');
  const ids = roteiro.falas.map((fala) => fala.id);
  if (valida.falas.length !== ids.length || valida.falas.some((fala, i) => fala.fala_id !== ids[i])) throw new Error('A narração não cobre as falas do roteiro, na ordem.');
  const { rows: [existente] } = await cliente.query<{ conteudo: NarracaoDaVisitaV1 }>(
    'SELECT conteudo FROM narracao_visita WHERE roteiro_id=$1 AND sha256_audio=$2', [valida.roteiro_id, valida.sha256_audio]);
  if (existente) return existente.conteudo;
  await cliente.query('INSERT INTO narracao_visita(id,roteiro_id,sha256_audio,job_colab,conteudo) VALUES ($1,$2,$3,$4,$5)',
    [valida.id, valida.roteiro_id, valida.sha256_audio, valida.job_colab, JSON.stringify(valida)]);
  return valida;
}

export async function narracaoDoRoteiro(cliente: Transacao, roteiroId: Id): Promise<NarracaoDaVisitaV1 | null> {
  const { rows: [linha] } = await cliente.query<{ conteudo: unknown }>(
    'SELECT conteudo FROM narracao_visita WHERE roteiro_id=$1 ORDER BY criado_em DESC, id DESC LIMIT 1', [roteiroId]);
  return linha ? exigirNarracao(linha.conteudo) : null;
}

export async function obterNarracao(cliente: Transacao, id: Id): Promise<NarracaoDaVisitaV1 | null> {
  const { rows: [linha] } = await cliente.query<{ conteudo: unknown }>('SELECT conteudo FROM narracao_visita WHERE id=$1', [id]);
  return linha ? exigirNarracao(linha.conteudo) : null;
}
