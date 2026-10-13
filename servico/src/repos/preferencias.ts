/** Preferências por documento (migração 0004): "primeiro eu" e a camada padrão. */
import type { Id } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { DadoRecusado } from './anotacoes.js';

export interface PreferenciaDocumento {
  documento_id: Id;
  primeiro_eu: boolean;
  camada_padrao: Id | null;
}

export async function ler(cliente: Transacao, documentoId: Id): Promise<PreferenciaDocumento> {
  const linha = (await cliente.query<PreferenciaDocumento>(
    'SELECT documento_id, primeiro_eu, camada_padrao FROM preferencia_documento WHERE documento_id=$1', [documentoId])).rows[0];
  return linha ?? { documento_id: documentoId, primeiro_eu: false, camada_padrao: null };
}

/** Grava só os campos informados. A camada padrão precisa ser de uma versão do documento. */
export async function gravar(cliente: Transacao, documentoId: Id,
  mudanca: { primeiro_eu?: boolean; camada_padrao?: Id | null }): Promise<PreferenciaDocumento> {
  await cliente.query('SELECT id FROM documento WHERE id=$1 FOR UPDATE', [documentoId]);
  if (mudanca.camada_padrao !== undefined && mudanca.camada_padrao !== null) {
    const daVersao = (await cliente.query(`SELECT 1 FROM camada c JOIN versao_texto v ON v.id=c.versao_id
      WHERE c.id=$1 AND v.documento_id=$2`, [mudanca.camada_padrao, documentoId])).rowCount;
    if (!daVersao) throw new DadoRecusado('camada_inexistente', 'A camada não pertence a uma versão deste documento.');
  }
  const atual = await ler(cliente, documentoId);
  const nova: PreferenciaDocumento = {
    documento_id: documentoId,
    primeiro_eu: mudanca.primeiro_eu ?? atual.primeiro_eu,
    camada_padrao: mudanca.camada_padrao === undefined ? atual.camada_padrao : mudanca.camada_padrao,
  };
  await cliente.query(`INSERT INTO preferencia_documento (documento_id, primeiro_eu, camada_padrao) VALUES ($1,$2,$3)
    ON CONFLICT (documento_id) DO UPDATE SET primeiro_eu=excluded.primeiro_eu, camada_padrao=excluded.camada_padrao,
      atualizada_em=clock_timestamp()`, [documentoId, nova.primeiro_eu, nova.camada_padrao]);
  return nova;
}
