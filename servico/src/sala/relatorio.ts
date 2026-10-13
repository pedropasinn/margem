/**
 * O que o dono vê de uma sala: testadores com as respostas, médias das escalas (só das respostas
 * enviadas), contagem das escolhas e os comentários nos trechos com o capítulo de cada um (para o
 * link `/ler/<documento>/<capítulo>?bloco=<bloco>`).
 */
import type { ComentarioDaSalaV1, Id, PerguntaDaSalaV1, SalaDeTesteV1, ValorDaRespostaDaSala } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { capitulos } from '../http/consultas.js';
import * as documentosRepo from '../repos/documentos.js';
import * as salasRepo from '../repos/salas.js';

export interface MediaDaPergunta { media: number | null; respostas: number }
export interface ComentarioNoRelatorio extends ComentarioDaSalaV1 { testador: string; documento_titulo: string; secao_id: Id | null }

export interface RelatorioDaSala {
  sala: SalaDeTesteV1;
  documentos: { id: Id; titulo: string }[];
  testadores: salasRepo.TestadorComResposta[];
  medias: { geral: Record<string, MediaDaPergunta>; por_documento: Record<Id, Record<string, MediaDaPergunta>> };
  escolhas: { geral: Record<string, Record<string, number>>; por_documento: Record<Id, Record<string, Record<string, number>>> };
  comentarios: ComentarioNoRelatorio[];
}

function agregar(perguntas: readonly PerguntaDaSalaV1[], grupos: readonly Record<string, ValorDaRespostaDaSala>[]): {
  medias: Record<string, MediaDaPergunta>; escolhas: Record<string, Record<string, number>>;
} {
  const medias: Record<string, MediaDaPergunta> = {};
  const escolhas: Record<string, Record<string, number>> = {};
  for (const pergunta of perguntas) {
    if (pergunta.tipo === 'escala') {
      const valores = grupos.map((grupo) => grupo[pergunta.id]).filter((valor): valor is number => typeof valor === 'number');
      medias[pergunta.id] = { respostas: valores.length,
        media: valores.length === 0 ? null : Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 100) / 100 };
    }
    if (pergunta.tipo === 'escolha') {
      const contagem: Record<string, number> = Object.fromEntries((pergunta.opcoes ?? []).map((opcao) => [opcao, 0]));
      for (const grupo of grupos) { const valor = grupo[pergunta.id]; if (typeof valor === 'string' && valor in contagem) contagem[valor] = (contagem[valor] ?? 0) + 1; }
      escolhas[pergunta.id] = contagem;
    }
  }
  return { medias, escolhas };
}

export async function relatorioDaSala(cliente: Transacao, salaId: Id): Promise<RelatorioDaSala | null> {
  const guardada = await salasRepo.obter(cliente, salaId);
  if (!guardada) return null;
  const { sala } = guardada;
  const titulos = new Map((await cliente.query<{ id: Id; titulo: string }>('SELECT id, titulo FROM documento WHERE id = ANY($1::text[])',
    [sala.documentos])).rows.map((linha) => [linha.id, linha.titulo]));
  const documentos = sala.documentos.map((id) => ({ id, titulo: titulos.get(id) ?? '(documento removido)' }));
  const testadores = await salasRepo.testadoresDaSala(cliente, salaId);
  const enviadas = testadores.map((testador) => testador.resposta).filter((resposta) => resposta?.estado === 'enviada');
  const geral = agregar(sala.formulario.geral, enviadas.map((resposta) => resposta?.geral ?? {}));
  const medias: RelatorioDaSala['medias'] = { geral: geral.medias, por_documento: {} };
  const escolhas: RelatorioDaSala['escolhas'] = { geral: geral.escolhas, por_documento: {} };
  for (const documento of sala.documentos) {
    const doDocumento = agregar(sala.formulario.por_documento, enviadas.map((resposta) => resposta?.por_documento[documento] ?? {}));
    medias.por_documento[documento] = doDocumento.medias;
    escolhas.por_documento[documento] = doDocumento.escolhas;
  }
  const nomes = new Map(testadores.map((testador) => [testador.id, testador.nome]));
  const brutos = await salasRepo.listarComentarios(cliente, salaId);
  // O capítulo de cada bloco, por versão (cada versão lida uma vez).
  const capituloDoBloco = new Map<Id, Map<Id, Id>>();
  for (const versaoId of new Set(brutos.map((comentario) => comentario.versao_id))) {
    const versao = await documentosRepo.obterVersao(cliente, versaoId);
    const ordem = new Map(versao.canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
    const mapa = new Map<Id, Id>();
    for (const secao of capitulos(versao.canonico)) {
      const inicio = ordem.get(secao.bloco_inicio) ?? -1;
      const fim = ordem.get(secao.bloco_fim) ?? -1;
      for (let i = inicio; i >= 0 && i <= fim; i++) { const bloco = versao.canonico.blocos[i]; if (bloco) mapa.set(bloco.id, secao.id); }
    }
    capituloDoBloco.set(versaoId, mapa);
  }
  const comentarios = brutos.map((comentario) => ({
    ...comentario, testador: nomes.get(comentario.testador_id) ?? '?', documento_titulo: titulos.get(comentario.documento_id) ?? '?',
    secao_id: capituloDoBloco.get(comentario.versao_id)?.get(comentario.bloco_id) ?? null,
  }));
  return { sala, documentos, testadores, medias, escolhas, comentarios };
}
