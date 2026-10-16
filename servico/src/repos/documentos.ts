import { conferirOrcamento, ORCAMENTOS } from '../entrada-json.js';
import { ulid } from 'ulid';
import { validarCanonico, type CanonicoV1 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

export interface Documento {
  id: string; titulo: string; autor: string | null; formato: CanonicoV1['documento']['formato'];
  sha256_original: string; origem_caminho: string; criado_em: Date; arquivado_em: Date | null;
  /** Faixa de páginas pedida na ingestão de um PDF (0003); nulas = documento inteiro. */
  paginas_inicio: number | null; paginas_fim: number | null;
  /** Ingestão com `--poesia` (0005, J19): só md, txt e colado. */
  poesia: boolean;
}
export interface VersaoTexto {
  id: string; documento_id: string; numero: number; canonico: CanonicoV1;
  hash_estrutural: string; motor: string; config: NonNullable<CanonicoV1['canonizacao']['config']>; criado_em: Date;
}
export async function criar(cliente: Transacao, entrada: CanonicoV1['documento'] & { origem_caminho: string }): Promise<Documento> {
  const resultado = await cliente.query<Documento>(`INSERT INTO documento
    (id,titulo,autor,formato,sha256_original,origem_caminho) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
  [ulid(), entrada.titulo, entrada.autor ?? null, entrada.formato, entrada.sha256_original, entrada.origem_caminho]);
  return resultado.rows[0]!;
}
export async function listar(cliente: Transacao): Promise<(Documento & {
  ultima_versao_id: string | null; marcas_visiveis: number; job_em_curso: string | null; estado_texto: 'disponivel' | 'ausente';
})[]> {
  return (await cliente.query<Documento & {
    ultima_versao_id: string | null; marcas_visiveis: number; job_em_curso: string | null; estado_texto: 'disponivel' | 'ausente';
  }>(`SELECT d.*, v.id AS ultima_versao_id,
    CASE WHEN v.id IS NULL THEN 'ausente' ELSE 'disponivel' END AS estado_texto,
    (SELECT count(*)::int FROM marca m WHERE m.versao_id=v.id AND m.visivel) AS marcas_visiveis,
    (SELECT j.id FROM job j WHERE (j.documento_id=d.id OR j.versao_id IN (SELECT id FROM versao_texto WHERE documento_id=d.id))
      AND j.estado IN ('fila','adiado','reservado') ORDER BY j.criado_em,j.id LIMIT 1) AS job_em_curso
    FROM documento d LEFT JOIN LATERAL (SELECT id FROM versao_texto WHERE documento_id=d.id ORDER BY numero DESC LIMIT 1) v ON true
    WHERE d.arquivado_em IS NULL ORDER BY d.criado_em,d.id`)).rows;
}
export async function obterVersao(cliente: Transacao, versaoId: string): Promise<VersaoTexto> {
  const versao = (await cliente.query<VersaoTexto>('SELECT * FROM versao_texto WHERE id=$1', [versaoId])).rows[0];
  if (!versao) throw new Error('Versão inexistente.');
  return versao;
}
export async function bloquearVersao(cliente: Transacao, versaoId: string): Promise<VersaoTexto> {
  // Serializa snapshots/editorial sem modificar a versão imutável.
  await cliente.query('SELECT id FROM versao_texto WHERE id=$1 FOR UPDATE', [versaoId]);
  return obterVersao(cliente, versaoId);
}
/** Blocos por consulta na publicação de uma versão: cada uma bem abaixo do prazo de 5 s do pool. */
export const BLOCOS_POR_LOTE = 500;
/**
 * `fonteDerivada`: hash de um arquivo derivado do original que o chamador conferiu em disco (o PDF com
 * a camada de texto da transcrição de um escaneado); o canônico dele também é do documento.
 */
export async function criarVersao(cliente: Transacao, documentoId: string, entrada: unknown, opcoes: { fonteDerivada?: string } = {}): Promise<VersaoTexto> {
  conferirOrcamento(entrada, ORCAMENTOS.canonico);
  if (!validarCanonico(entrada)) throw new Error('Canônico inválido ou hash estrutural divergente.');
  const canonico = entrada;
  const documento = (await cliente.query<Documento>('SELECT * FROM documento WHERE id=$1 FOR UPDATE', [documentoId])).rows[0];
  if (!documento) throw new Error('Documento inexistente.');
  // A fonte é o original do documento, ou, num vídeo, uma revisão registrada da transcrição (J90),
  // ou o PDF com a camada da transcrição de um escaneado (`fonteDerivada`).
  const revisaoRegistrada = documento.sha256_original !== canonico.documento.sha256_original
    && (opcoes.fonteDerivada === canonico.documento.sha256_original || ((await cliente.query('SELECT 1 FROM revisao_transcricao WHERE documento_id=$1 AND sha256_texto=$2',
      [documentoId, canonico.documento.sha256_original])).rowCount ?? 0) > 0);
  if ((documento.sha256_original !== canonico.documento.sha256_original && !revisaoRegistrada) || documento.formato !== canonico.documento.formato) {
    throw new Error('Canônico não pertence à fonte do documento.');
  }
  const id = ulid();
  await cliente.query(`INSERT INTO versao_texto (id,documento_id,numero,hash_estrutural,canonico,motor,config)
    SELECT $1,$2::ulid,coalesce(max(numero),0)+1,$3,$4,$5,$6 FROM versao_texto WHERE documento_id=$2::ulid`,
  [id, documentoId, canonico.hash_estrutural, JSON.stringify(canonico), canonico.canonizacao.motor, JSON.stringify(canonico.canonizacao.config ?? {})]);
  const idioma = canonico.documento.idioma.toLowerCase().split(/[-_]/)[0];
  const busca = idioma === 'pt' || idioma === 'portuguese' ? 'portuguese'
    : idioma === 'en' || idioma === 'english' ? 'english' : 'simple';
  // Em lotes (D-05): um PDF de milhares de páginas eram milhares de consultas dentro da publicação.
  for (let inicio = 0; inicio < canonico.blocos.length; inicio += BLOCOS_POR_LOTE) {
    const lote = canonico.blocos.slice(inicio, inicio + BLOCOS_POR_LOTE).map((bloco) => ({
      id: bloco.id, ordem: bloco.ordem, tipo: bloco.tipo, texto: bloco.texto,
      inline: bloco.inline, origens: bloco.origens, asset_id: bloco.asset_id ?? null,
    }));
    await cliente.query(`INSERT INTO bloco (versao_id,id,ordem,tipo,texto,inline,origens,asset_id,idioma_busca)
      SELECT $1, b.id, b.ordem, b.tipo, b.texto, b.inline, b.origens, b.asset_id, $2::regconfig
      FROM jsonb_to_recordset($3::jsonb) AS b(id ulid, ordem bigint, tipo text, texto text, inline jsonb, origens jsonb, asset_id ulid)`,
    [id, busca, JSON.stringify(lote)]);
  }
  for (const secao of canonico.secoes) {
    await cliente.query('INSERT INTO secao VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, secao.id, secao.nivel, secao.titulo, secao.ordem, secao.bloco_inicio, secao.bloco_fim]);
  }
  for (const asset of canonico.assets) {
    await cliente.query('INSERT INTO asset VALUES ($1,$2,$3,$4,$5,$6)',
      [id, asset.id, asset.tipo, asset.caminho, asset.sha256, asset.bloco_id ?? null]);
  }
  return obterVersao(cliente, id);
}

/** Arquiva (idempotente). Nada é apagado: só some da biblioteca padrão. `null` se não existe. */
export async function arquivar(cliente: Transacao, documentoId: string): Promise<Documento | null> {
  await cliente.query('UPDATE documento SET arquivado_em=clock_timestamp() WHERE id=$1 AND arquivado_em IS NULL', [documentoId]);
  return (await cliente.query<Documento>('SELECT * FROM documento WHERE id=$1', [documentoId])).rows[0] ?? null;
}

/** Desfaz o arquivamento (idempotente). `null` se o documento não existe. */
export async function desarquivar(cliente: Transacao, documentoId: string): Promise<Documento | null> {
  await cliente.query('UPDATE documento SET arquivado_em=NULL WHERE id=$1 AND arquivado_em IS NOT NULL', [documentoId]);
  return (await cliente.query<Documento>('SELECT * FROM documento WHERE id=$1', [documentoId])).rows[0] ?? null;
}
