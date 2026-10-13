import type { ExecucaoCompreensaoV1, PlanoPedagogicoV1 } from '@margem/contratos';
import { conferirPlanoNoModelo } from '@margem/core';
import type { Transacao } from '../db/transacao.js';
import { ErroDaApi } from '../http/erros.js';
import * as repo from '../repos/compreensao.js';
import { obterVersao } from '../repos/documentos.js';
import { capituloDe } from './pipeline.js';

/** Revisões são imutáveis: carregar pelo ID do plano evita misturar rN com rN+1. */
export async function carregarContextoDoPlano(cliente: Transacao, plano: PlanoPedagogicoV1,
  esperada?: Pick<ExecucaoCompreensaoV1, 'id' | 'versao_id'>) {
  const execucao = await repo.obterExecucao(cliente, plano.execucao_id);
  const modelo = await repo.obterModelo(cliente, plano.modelo_id);
  if (!execucao || !modelo || modelo.versao_id !== execucao.versao_id ||
    (esperada && (execucao.id !== esperada.id || execucao.versao_id !== esperada.versao_id))) {
    throw new ErroDaApi(409, 'plano_incompativel', 'O plano não corresponde à versão desta leitura.');
  }
  const versao = await obterVersao(cliente, execucao.versao_id);
  if (!versao.canonico.secoes.some(s => s.id === plano.secao_id && s.nivel === 1)) {
    throw new ErroDaApi(409, 'plano_incompativel', 'O capítulo do plano não pertence a esta versão.');
  }
  const capitulo = capituloDe(versao.canonico, plano.secao_id);
  const conferido = conferirPlanoNoModelo(plano, modelo, capitulo.blocos);
  if (!conferido.ok) throw new ErroDaApi(409, 'plano_incompativel', conferido.erros[0]!.mensagem);
  return { modelo: conferido.valor, versao, capitulo };
}
