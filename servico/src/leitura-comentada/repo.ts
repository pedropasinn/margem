/** Persistência da leitura comentada (J92): leituras e narrações, imutáveis (`0016_leitura_comentada.sql`). */
import {
  falasDaLeitura, validarLeituraComentada, validarNarracaoDaLeitura, type Id, type LeituraComentadaV1, type NarracaoDaLeituraV1,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

function exigirLeitura(valor: unknown): LeituraComentadaV1 {
  if (!validarLeituraComentada(valor)) throw new Error(`Leitura comentada inválida: ${JSON.stringify(validarLeituraComentada.errors)?.slice(0, 2000)}`);
  return valor;
}
function exigirNarracao(valor: unknown): NarracaoDaLeituraV1 {
  if (!validarNarracaoDaLeitura(valor)) throw new Error(`Narração da leitura inválida: ${JSON.stringify(validarNarracaoDaLeitura.errors)?.slice(0, 2000)}`);
  return valor;
}

export async function gravarLeitura(cliente: Transacao, leitura: LeituraComentadaV1): Promise<LeituraComentadaV1> {
  const valida = exigirLeitura(leitura);
  // Publicação repetida do mesmo job: fica a primeira.
  const { rows: [existente] } = await cliente.query<{ conteudo: LeituraComentadaV1 }>('SELECT conteudo FROM leitura_comentada WHERE job_id=$1', [valida.job_id]);
  if (existente) return existente.conteudo;
  await cliente.query(`INSERT INTO leitura_comentada(id,execucao_id,versao_id,secao_id,modelo_id,fontes_hash,job_id,conteudo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [valida.id, valida.execucao_id, valida.versao_id, valida.secao_id, valida.modelo_id, valida.fontes_hash, valida.job_id, JSON.stringify(valida)]);
  return valida;
}

/** A leitura mais recente do capítulo nesta execução. */
export async function leituraDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<LeituraComentadaV1 | null> {
  const { rows: [linha] } = await cliente.query<{ conteudo: unknown }>(
    'SELECT conteudo FROM leitura_comentada WHERE execucao_id=$1 AND secao_id=$2 ORDER BY criado_em DESC, id DESC LIMIT 1', [execucaoId, secaoId]);
  return linha ? exigirLeitura(linha.conteudo) : null;
}

export async function obterLeitura(cliente: Transacao, id: Id): Promise<LeituraComentadaV1 | null> {
  const { rows: [linha] } = await cliente.query<{ conteudo: unknown }>('SELECT conteudo FROM leitura_comentada WHERE id=$1', [id]);
  return linha ? exigirLeitura(linha.conteudo) : null;
}

export async function gravarNarracao(cliente: Transacao, narracao: NarracaoDaLeituraV1): Promise<NarracaoDaLeituraV1> {
  const valida = exigirNarracao(narracao);
  const leitura = await obterLeitura(cliente, valida.leitura_id);
  if (!leitura) throw new Error('Narração de uma leitura inexistente.');
  const ids = falasDaLeitura(leitura).map((fala) => fala.id);
  if (valida.falas.length !== ids.length || valida.falas.some((fala, i) => fala.fala_id !== ids[i])) throw new Error('A narração não cobre as falas da leitura, na ordem.');
  const blocos = new Set(leitura.trechos.map((t) => t.bloco_id));
  if (valida.palavras.some((p) => !blocos.has(p.bloco_id))) throw new Error('Palavra temporizada fora dos trechos lidos.');
  const { rows: [existente] } = await cliente.query<{ conteudo: NarracaoDaLeituraV1 }>(
    'SELECT conteudo FROM narracao_leitura WHERE leitura_id=$1 AND sha256_audio=$2', [valida.leitura_id, valida.sha256_audio]);
  if (existente) return existente.conteudo;
  await cliente.query('INSERT INTO narracao_leitura(id,leitura_id,sha256_audio,conteudo) VALUES ($1,$2,$3,$4)',
    [valida.id, valida.leitura_id, valida.sha256_audio, JSON.stringify(valida)]);
  return valida;
}

export async function narracaoDaLeitura(cliente: Transacao, leituraId: Id): Promise<NarracaoDaLeituraV1 | null> {
  const { rows: [linha] } = await cliente.query<{ conteudo: unknown }>(
    'SELECT conteudo FROM narracao_leitura WHERE leitura_id=$1 ORDER BY criado_em DESC, id DESC LIMIT 1', [leituraId]);
  return linha ? exigirNarracao(linha.conteudo) : null;
}

export async function obterNarracao(cliente: Transacao, id: Id): Promise<NarracaoDaLeituraV1 | null> {
  const { rows: [linha] } = await cliente.query<{ conteudo: unknown }>('SELECT conteudo FROM narracao_leitura WHERE id=$1', [id]);
  return linha ? exigirNarracao(linha.conteudo) : null;
}
