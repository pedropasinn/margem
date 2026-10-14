/**
 * Questão por imagem (J119): o documento de uma página que veio de um print guarda, na pasta dele,
 * `questao.json` com o hash do PNG da resolução. Quando a canonização publica a versão, a sessão de
 * resolução nasce sobre a página inteira — o mesmo pedido que a Ferramenta de área → Resolver faz
 * (`origem: recorte`, página 1, retângulo 0,0,1,1) — e o job `resolver_exercicio` entra na fila na
 * mesma transação. Sem formato novo: é um `ResolucaoV2` comum, com a imagem guardada pelo hash.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ulid } from 'ulid';
import type { Id, ResolucaoV2 } from '@margem/contratos';
import { pastaDoDocumento } from '../dados.js';
import type { Transacao } from '../db/transacao.js';
import * as repo from '../repos/resolucoes.js';
import { enfileirarResolucao } from '../resolucao/pipeline.js';

const ARQUIVO = 'questao.json';

export interface MarcaDaQuestao { versao: 1; imagem_sha256: string; largura: number; altura: number }

export async function gravarMarcaDaQuestao(documentoId: Id, marca: MarcaDaQuestao): Promise<void> {
  await writeFile(join(pastaDoDocumento(documentoId), ARQUIVO), JSON.stringify(marca), { mode: 0o600 });
}

export async function lerMarcaDaQuestao(documentoId: Id): Promise<MarcaDaQuestao | null> {
  let texto: string;
  try { texto = await readFile(join(pastaDoDocumento(documentoId), ARQUIVO), 'utf8'); } catch (erro) {
    if (erro instanceof Error && 'code' in erro && erro.code === 'ENOENT') return null;
    throw erro;
  }
  const marca = JSON.parse(texto) as Partial<MarcaDaQuestao>;
  if (marca.versao !== 1 || typeof marca.imagem_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(marca.imagem_sha256)) {
    throw new Error('questao.json inválido.');
  }
  return marca as MarcaDaQuestao;
}

/**
 * Chamado na publicação da versão: cria a sessão da questão e enfileira a resolução, uma vez só por
 * imagem (uma nova canonização do mesmo documento não pede outra resolução).
 */
export async function resolverQuestaoPublicada(cliente: Transacao, documentoId: Id, versaoId: Id, agora: () => Date = () => new Date()): Promise<ResolucaoV2 | null> {
  const marca = await lerMarcaDaQuestao(documentoId);
  if (marca === null) return null;
  const existentes = await repo.todasDoDocumento(cliente, documentoId);
  if (existentes.some((sessao) => sessao.origem.tipo === 'recorte' && sessao.origem.imagem_sha256 === marca.imagem_sha256)) return null;
  const sessao: ResolucaoV2 = {
    versao: 2, id: ulid(), documento_id: documentoId, versao_id: versaoId,
    origem: { tipo: 'recorte', pagina: 1, retangulo: { x: 0, y: 0, largura: 1, altura: 1 }, imagem_sha256: marca.imagem_sha256 },
    texto_extraido: '', resolucao: null, execucao: null, mensagens: [], criada_em: agora().toISOString(),
  };
  await repo.criar(cliente, sessao);
  await enfileirarResolucao(cliente, sessao);
  return sessao;
}
