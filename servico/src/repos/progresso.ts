import { conferirProgresso, validarProgresso, type ProgressoV1 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { obterVersao } from './documentos.js';

export class ProgressoObsoleto extends Error {
  constructor(public readonly revisao_atual: number) {
    super(`Progresso obsoleto; revisão atual: ${revisao_atual}.`); this.name = 'ProgressoObsoleto';
  }
}
export interface ProgressoPersistido extends Omit<ProgressoV1, 'revisao_esperada'> { revisao: number }
export async function ler(cliente: Transacao, documentoId: string): Promise<ProgressoPersistido | null> {
  const resultado = await cliente.query<{ progresso: ProgressoPersistido }>(`SELECT jsonb_build_object(
    'documento_id',documento_id,'versao_id',versao_id,'ancora',jsonb_build_object(
      'versao_id',versao_id,'bloco_id',bloco_id,'inicio_utf16',inicio_utf16,'fim_utf16',fim_utf16,
      'citacao',citacao,'prefixo',prefixo,'sufixo',sufixo),'revisao',revisao,
    'capitulos_concluidos',capitulos_concluidos,'atualizado_em',atualizado_em) AS progresso
    FROM progresso WHERE documento_id=$1`, [documentoId]);
  return resultado.rows[0]?.progresso ?? null;
}
export async function gravar(cliente: Transacao, progresso: ProgressoV1): Promise<ProgressoPersistido> {
  if (!validarProgresso(progresso)) throw new Error('Progresso inválido.');
  // Trava o documento também na primeira gravação, quando ainda não há linha de progresso.
  await cliente.query('SELECT id FROM documento WHERE id=$1 FOR UPDATE', [progresso.documento_id]);
  const versao = await obterVersao(cliente, progresso.versao_id);
  if (!conferirProgresso(versao.canonico, versao.documento_id, versao.id, progresso)) throw new Error('Progresso incompatível com o texto ou documento.');
  const atual = await ler(cliente, progresso.documento_id);
  const revisao = atual?.revisao ?? 0;
  if (progresso.revisao_esperada !== revisao) throw new ProgressoObsoleto(revisao);
  const a = progresso.ancora;
  await cliente.query(`INSERT INTO progresso
    (documento_id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,revisao,capitulos_concluidos,atualizado_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(documento_id) DO UPDATE SET
      versao_id=excluded.versao_id,bloco_id=excluded.bloco_id,inicio_utf16=excluded.inicio_utf16,fim_utf16=excluded.fim_utf16,
      citacao=excluded.citacao,prefixo=excluded.prefixo,sufixo=excluded.sufixo,revisao=excluded.revisao,
      capitulos_concluidos=excluded.capitulos_concluidos,atualizado_em=excluded.atualizado_em`,
  [progresso.documento_id, versao.id, a.bloco_id, a.inicio_utf16, a.fim_utf16, a.citacao, a.prefixo, a.sufixo,
    revisao + 1, JSON.stringify(progresso.capitulos_concluidos), progresso.atualizado_em]);
  return (await ler(cliente, progresso.documento_id))!;
}
