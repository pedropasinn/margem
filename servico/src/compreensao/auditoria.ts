/**
 * Auditoria da compreensão (J29, `docs/desenho/10-MODELO-DO-CAPITULO.md` §6 e §8): a história de um
 * elemento pelas revisões e o resumo de um capítulo. Texto puro, para o auditor de linha de comando.
 */
import type pg from 'pg';
import type { ElementoSemanticoV1, Id, LoteDoModeloV1, ModeloDoCapituloV1, OperacaoDoModeloV1 } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { estadoDoCapitulo } from './pipeline.js';

type Consultavel = Pick<pg.Pool, 'query'>;

const ROTULO_DO_ESTAGIO: Record<ModeloDoCapituloV1['estagio'], string> = {
  analise_local: 'ANÁLISE LOCAL', sintese: 'SÍNTESE DO CAPÍTULO', revisao: 'REVISÃO GLOBAL',
};

function descreverElemento(elemento: ElementoSemanticoV1): string {
  return `${elemento.nucleo} · papel ${elemento.papel ?? '—'} · centralidade ${String(elemento.centralidade)}`;
}

function tocaElemento(operacao: OperacaoDoModeloV1, elementoId: Id): boolean {
  if ('alvo_id' in operacao && operacao.alvo_id === elementoId) return true;
  if (operacao.op === 'criar_relacao' || operacao.op === 'remover_relacao') {
    const relacao = operacao.op === 'criar_relacao' ? operacao.depois : operacao.antes;
    return relacao.origem_id === elementoId || relacao.destino_id === elementoId;
  }
  if (operacao.op === 'fundir') return operacao.antes.absorvidos.some((item) => item.id === elementoId);
  return false;
}

function descreverOperacao(operacao: OperacaoDoModeloV1, nomes: ReadonlyMap<Id, string>): string {
  const nome = (id: Id): string => nomes.get(id) ?? id;
  switch (operacao.op) {
    case 'promover': case 'rebaixar':
      return `${operacao.op}: centralidade ${String(operacao.antes.centralidade)} → ${String(operacao.depois.centralidade)}`;
    case 'corrigir_papel':
      return `corrigir papel: ${operacao.antes.nucleo}/${operacao.antes.papel ?? '—'} → ${operacao.depois.nucleo}/${operacao.depois.papel ?? '—'}`;
    case 'reescrever_enunciado': return `reescrever enunciado: “${operacao.depois.enunciado}”`;
    case 'acrescentar_nota': return `nota [${operacao.depois.tipo}]: ${operacao.depois.texto}`;
    case 'fundir': return `fundir: absorveu ${operacao.antes.absorvidos.map((item) => nome(item.id)).join(', ')}`;
    case 'adicionar_elemento': return `adicionado: ${descreverElemento(operacao.depois)}`;
    case 'remover_elemento': return 'removido';
    case 'criar_relacao':
      return `relação: ${nome(operacao.depois.origem_id)} ${operacao.depois.tipo} ${nome(operacao.depois.destino_id)}${operacao.depois.retrospectiva ? ' (retrospectiva)' : ''}`;
    case 'remover_relacao': return `relação removida: ${nome(operacao.antes.origem_id)} ${operacao.antes.tipo} ${nome(operacao.antes.destino_id)}`;
    default: return operacao.op;
  }
}

/** Do texto à projeção: como o elemento nasceu e o que cada revisão fez com ele. */
export async function historicoDoElemento(banco: Consultavel, elementoId: Id, modeloId: Id): Promise<string> {
  const modelo = (await banco.query<{ conteudo: ModeloDoCapituloV1 }>('SELECT conteudo FROM modelo_capitulo WHERE id=$1', [modeloId])).rows[0]?.conteudo;
  if (!modelo) return `Revisão ${modeloId} não encontrada.`;
  const revisoes = (await banco.query<{ conteudo: ModeloDoCapituloV1 }>(
    'SELECT conteudo FROM modelo_capitulo WHERE execucao_id=$1 AND secao_id=$2 ORDER BY revisao', [modelo.execucao_id, modelo.secao_id])).rows.map((linha) => linha.conteudo);
  const lotes = new Map((await banco.query<{ conteudo: LoteDoModeloV1 }>(
    'SELECT conteudo FROM lote_modelo WHERE execucao_id=$1 AND secao_id=$2', [modelo.execucao_id, modelo.secao_id])).rows.map((linha) => [linha.conteudo.resultado_id, linha.conteudo]));
  const nomes = new Map<Id, string>();
  for (const revisao of revisoes) for (const elemento of revisao.elementos) nomes.set(elemento.id, `“${(elemento.ancoras[0]?.citacao ?? elemento.id).slice(0, 50)}”`);
  const linhas: string[] = [];
  for (const revisao of revisoes) {
    const elemento = revisao.elementos.find((item) => item.id === elementoId);
    const lote = lotes.get(revisao.id);
    const operacoes = lote?.operacoes.filter((operacao) => tocaElemento(operacao, elementoId)) ?? [];
    if (!elemento && operacoes.length === 0) continue;
    linhas.push(`${ROTULO_DO_ESTAGIO[revisao.estagio]} (r${String(revisao.revisao)})`);
    if (revisao.revisao === 0 && elemento) {
      linhas.push(`  ${descreverElemento(elemento)}`, `  “${elemento.ancoras[0]?.citacao ?? ''}”`, `  enunciado: ${elemento.enunciado}`,
        `  criado pelo job ${elemento.origem.job_id}`);
    }
    for (const operacao of operacoes) {
      linhas.push(`  ${descreverOperacao(operacao, nomes)}`, `    motivo: ${operacao.motivo}`);
      if (operacao.evidencia.length > 0) linhas.push(`    evidência: ${operacao.evidencia.map((ancora) => `“${ancora.citacao.slice(0, 60)}”`).join('; ')}`);
    }
    if (revisao.revisao > 0 && operacoes.length === 0 && elemento) linhas.push('  sem mudança');
    if (!elemento) linhas.push('  (não existe mais nesta revisão)');
    linhas.push('        ↓');
  }
  const final = modelo.elementos.find((item) => item.id === elementoId);
  linhas.push(`PROJEÇÃO (r${String(modelo.revisao)})`, final ? `  ${descreverElemento(final)}` : '  elemento ausente da revisão projetada');
  return linhas.join('\n');
}

/** Estado, revisões e lotes do capítulo, com a contagem por operação. */
export async function resumoDoCapitulo(banco: pg.Pool, execucaoId: Id, secaoId: Id): Promise<string> {
  const estado = await comTransacao(banco, (cliente) => estadoDoCapitulo(cliente, execucaoId, secaoId));
  const linhas = [`Capítulo ${secaoId} da execução ${execucaoId}: ${estado.estado} (${estado.visivel})`, '', 'Jobs:'];
  for (const job of estado.jobs) linhas.push(`  ${job.id} · ${job.tipo} · ${job.estado}`);
  const revisoes = (await banco.query<{ conteudo: ModeloDoCapituloV1 }>(
    'SELECT conteudo FROM modelo_capitulo WHERE execucao_id=$1 AND secao_id=$2 ORDER BY revisao', [execucaoId, secaoId])).rows.map((linha) => linha.conteudo);
  linhas.push('', 'Revisões:');
  for (const revisao of revisoes) {
    const centrais = revisao.elementos.filter((item) => item.centralidade === 1).length;
    linhas.push(`  r${String(revisao.revisao)} · ${revisao.estagio} · ${String(revisao.elementos.length)} elementos (${String(centrais)} estruturais) · `
      + `${String(revisao.relacoes.length)} relações · ${String(revisao.dificuldades.length)} dificuldades · ${String(revisao.unidades.length)} unidades`);
  }
  const lotes = (await banco.query<{ conteudo: LoteDoModeloV1 }>(
    'SELECT conteudo FROM lote_modelo WHERE execucao_id=$1 AND secao_id=$2 ORDER BY criado_em, id', [execucaoId, secaoId])).rows.map((linha) => linha.conteudo);
  linhas.push('', 'Lotes:');
  for (const lote of lotes) {
    const contagem = new Map<string, number>();
    for (const operacao of lote.operacoes) contagem.set(operacao.op, (contagem.get(operacao.op) ?? 0) + 1);
    linhas.push(`  ${lote.estagio} · ${[...contagem].map(([op, n]) => `${op} ×${String(n)}`).join(', ') || 'nenhuma operação'} · jobs ${lote.job_ids.join(', ')}`);
  }
  if (estado.plano_id) linhas.push('', `Plano pedagógico: ${estado.plano_id}`);
  return linhas.join('\n');
}
