/**
 * Publicação de mídia com transcrição alinhada (J71). O cliente manda as palavras reconhecidas
 * (texto + tempo); o serviço resolve cada uma num bloco da versão de texto e grava offsets UTF-16.
 * Nenhum offset vem de fora. Publicar de novo o mesmo arquivo com a mesma transcrição é idempotente;
 * com outra transcrição, é recusado (a linha é imutável).
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ulid } from 'ulid';
import { validarMidia, type Id, type MidiaV1 } from '@margem/contratos';
import { alinharPalavras, conferirMidiaNoCanonico, frasesDasPalavras, type PalavraTranscrita } from '@margem/core';
import { arquivoNosDados } from '../geometria/arquivos';
import { obterVersao } from '../repos/documentos';
import type { Transacao } from '../db/transacao';
import { caminhoDaMidia, sondarMidia, type SondaDaMidia } from './arquivos';

export interface PedidoDeMidia {
  documento_id: Id;
  versao_id: Id;
  sha256: string;
  titulo: string;
  fonte: MidiaV1['fonte'];
  capitulos: MidiaV1['capitulos'];
  transcricao: { motor: string; idioma: string; palavras: PalavraTranscrita[] };
}

export interface DiagnosticoDoAlinhamento {
  transcritas: number;
  alinhadas: number;
  sem_par: number;
  texto_sem_tempo: number;
}

export class ErroDeMidia extends Error {
  constructor(readonly codigo: 'midia_ausente' | 'versao_de_outro_documento' | 'alinhamento_insuficiente' | 'midia_invalida' | 'outra_transcricao', mensagem: string) {
    super(mensagem);
  }
}

/** Abaixo disto a transcrição não é deste texto (ou o texto foi editado demais). */
export const COBERTURA_MINIMA = 0.9;

/** Os blocos que a fala cobre: títulos e epígrafes do documento não são falados. */
const BLOCOS_NAO_FALADOS = new Set(['capitulo', 'secao', 'epigrafe', 'figura', 'tabela', 'equacao', 'codigo', 'legenda']);

/** Hash da transcrição recebida (texto e tempos), para reconhecer a mesma publicação. */
export function hashDaTranscricao(transcricao: PedidoDeMidia['transcricao']): string {
  const normal = { motor: transcricao.motor, idioma: transcricao.idioma, palavras: transcricao.palavras.map((p) => [p.texto, p.inicio_s, p.fim_s]) };
  return createHash('sha256').update(JSON.stringify(normal), 'utf8').digest('hex');
}

/** Monta a MidiaV1 a partir do pedido, do canônico e da sonda do arquivo. Pura, exceto pelo id. */
export function montarMidia(pedido: PedidoDeMidia, canonico: { blocos: { id: Id; tipo: string; texto: string }[] }, sonda: SondaDaMidia, id: Id = ulid()): { midia: MidiaV1; diagnostico: DiagnosticoDoAlinhamento } {
  const blocos = canonico.blocos.filter((b) => !BLOCOS_NAO_FALADOS.has(b.tipo));
  const resultado = alinharPalavras(blocos, pedido.transcricao.palavras);
  const diagnostico = { transcritas: resultado.transcritas, alinhadas: resultado.palavras.length, sem_par: resultado.sem_par, texto_sem_tempo: resultado.texto_sem_tempo };
  if (resultado.transcritas === 0 || resultado.palavras.length < COBERTURA_MINIMA * resultado.transcritas) {
    throw new ErroDeMidia('alinhamento_insuficiente', `Só ${String(resultado.palavras.length)} de ${String(resultado.transcritas)} palavras acharam o texto da versão.`);
  }
  // O fim da última palavra pode passar alguns décimos do arquivo: fica no fim do arquivo.
  const palavras = resultado.palavras.map((p) => ({ ...p, inicio_s: Math.min(p.inicio_s, sonda.duracao_s), fim_s: Math.min(p.fim_s, sonda.duracao_s) }));
  const capitulos = pedido.capitulos.filter((c) => c.inicio_s < sonda.duracao_s);
  const midia: MidiaV1 = {
    versao: 1, id, documento_id: pedido.documento_id, versao_id: pedido.versao_id, tipo: sonda.tipo, titulo: pedido.titulo,
    sha256: pedido.sha256, mime: sonda.mime, bytes: sonda.bytes, duracao_s: sonda.duracao_s,
    ...(sonda.largura !== undefined && sonda.altura !== undefined ? { largura: sonda.largura, altura: sonda.altura } : {}),
    fonte: pedido.fonte,
    transcricao: { motor: pedido.transcricao.motor, idioma: pedido.transcricao.idioma, sha256: hashDaTranscricao(pedido.transcricao) },
    capitulos, palavras, frases: frasesDasPalavras(blocos, palavras),
  };
  if (!validarMidia(midia)) throw new ErroDeMidia('midia_invalida', `A mídia montada não passa no contrato: ${JSON.stringify(validarMidia.errors?.slice(0, 3))}`);
  if (!conferirMidiaNoCanonico(midia, pedido.versao_id, canonico as Parameters<typeof conferirMidiaNoCanonico>[2])) {
    throw new ErroDeMidia('midia_invalida', 'O alinhamento não confere com o texto da versão.');
  }
  return { midia, diagnostico };
}

/** Publica numa transação: confere versão e documento, sonda o arquivo, alinha e grava. */
export async function publicarMidia(cliente: Transacao, pedido: PedidoDeMidia): Promise<{ midia: MidiaV1; diagnostico: DiagnosticoDoAlinhamento; criada: boolean }> {
  const caminho = await arquivoNosDados(caminhoDaMidia(pedido.sha256));
  if (caminho === null) throw new ErroDeMidia('midia_ausente', 'Envie o arquivo antes (PUT /api/midia/arquivos).');
  const versao = await obterVersao(cliente, pedido.versao_id);
  if (versao.documento_id !== pedido.documento_id) throw new ErroDeMidia('versao_de_outro_documento', 'A versão não é deste documento.');
  const sonda = await sondarMidia(caminho);
  const { midia, diagnostico } = montarMidia(pedido, versao.canonico, sonda);
  const inserida = await cliente.query(`INSERT INTO midia (id, documento_id, versao_id, sha256, tipo, conteudo) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (versao_id, sha256) DO NOTHING`, [midia.id, midia.documento_id, midia.versao_id, midia.sha256, midia.tipo, JSON.stringify(midia)]);
  const { rows: [gravada] } = await cliente.query<{ conteudo: MidiaV1 }>('SELECT conteudo FROM midia WHERE versao_id=$1 AND sha256=$2', [midia.versao_id, midia.sha256]);
  if (!gravada) throw new Error('Mídia não gravada.');
  if (!isDeepStrictEqual({ ...gravada.conteudo, id: midia.id }, midia)) {
    throw new ErroDeMidia('outra_transcricao', 'Este arquivo já foi publicado nesta versão com outra transcrição ou outros metadados.');
  }
  return { midia: gravada.conteudo, diagnostico, criada: (inserida.rowCount ?? 0) > 0 };
}
