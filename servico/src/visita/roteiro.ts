/**
 * Da saída do Codex ao roteiro publicado (J91), sem banco: aliases → ids, trecho de cada parada,
 * âncora do foco, ponta da relação e a lista de falas. Determinístico; o que não resolve vira
 * diagnóstico e cai só a referência (nunca a visita inteira, a não ser que não sobre parada nenhuma).
 */
import {
  MAXIMO_DE_PARADAS, type AncoraV1, type Bloco, type FalaDoRoteiroV1, type Id, type ModeloDoCapituloV1, type ParadaDoRoteiroV1,
  type PapelDaFalaV1, type VisualV1,
} from '@margem/contratos';
import type { AliasesDoPrompt, TabelaDeAliases } from '@margem/core';
import type { SaidaDaVisita } from './prompts.js';

export interface Diagnostico { codigo: string; mensagem: string }

export interface ContextoDaResolucao {
  versaoId: Id;
  blocos: readonly Pick<Bloco, 'id' | 'texto'>[];
  modelo: Pick<ModeloDoCapituloV1, 'elementos' | 'relacoes' | 'dificuldades'>;
  aliases: AliasesDoPrompt;
  notas: TabelaDeAliases;
  visuais: TabelaDeAliases;
  /** Âncora de cada nota do leitor (anotação ou grifo), pelo id. */
  ancorasDasNotas: ReadonlyMap<Id, AncoraV1>;
  visuaisPorId: ReadonlyMap<Id, Pick<VisualV1, 'alvo'>>;
  temProximo: boolean;
}

export interface RoteiroResolvido {
  paradas: ParadaDoRoteiroV1[];
  falas: FalaDoRoteiroV1[];
  perguntas_finais: string[];
  diagnosticos: Diagnostico[];
}

const limpar = (texto: string): string => texto.replace(/\s+/gu, ' ').trim();

/** O bloco inteiro como âncora (o foco quando a parada não aponta nada dentro do trecho). */
export function ancoraDoBlocoInteiro(versaoId: Id, bloco: Pick<Bloco, 'id' | 'texto'>): AncoraV1 {
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: bloco.texto.length, citacao: bloco.texto, prefixo: '', sufixo: '' };
}

export function resolverRoteiro(saida: SaidaDaVisita, contexto: ContextoDaResolucao): RoteiroResolvido {
  const diagnosticos: Diagnostico[] = [];
  const posicao = new Map(contexto.blocos.map((bloco, indice) => [bloco.id, indice]));
  const elementos = new Map(contexto.modelo.elementos.map((e) => [e.id, e]));
  const relacoes = new Map(contexto.modelo.relacoes.map((r) => [r.id, r]));
  const dificuldades = new Map(contexto.modelo.dificuldades.map((d) => [d.id, d]));
  const dentroDoCapitulo = (ancora: AncoraV1 | undefined): ancora is AncoraV1 => ancora !== undefined && ancora.versao_id === contexto.versaoId && posicao.has(ancora.bloco_id);

  function traduzir(lista: readonly string[], tabela: TabelaDeAliases, existe: (id: Id) => boolean, onde: string): Id[] {
    const ids: Id[] = [];
    for (const alias of lista) {
      const id = tabela.id(alias);
      if (id === undefined || !existe(id)) { diagnosticos.push({ codigo: 'alias_desconhecido', mensagem: `${onde}: ${alias} não foi enviado; ficou de fora.` }); continue; }
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  const candidatas = saida.paradas.flatMap((gerada, indice) => {
    const onde = `parada ${String(indice + 1)}`;
    const inicio = contexto.aliases.blocos.id(gerada.inicio);
    let fim = contexto.aliases.blocos.id(gerada.fim);
    if (inicio === undefined || !posicao.has(inicio)) {
      diagnosticos.push({ codigo: 'trecho_desconhecido', mensagem: `${onde}: o bloco ${gerada.inicio} não é do capítulo; a parada caiu.` });
      return [];
    }
    if (fim === undefined || !posicao.has(fim) || posicao.get(fim)! < posicao.get(inicio)!) {
      diagnosticos.push({ codigo: 'fim_corrigido', mensagem: `${onde}: o fim ${gerada.fim} não vem depois do início; o trecho ficou só com ${gerada.inicio}.` });
      fim = inicio;
    }
    return [{ gerada, indice, onde, inicio, fim }];
  });
  // Na ordem do texto (estável): a visita não volta para trás; o que volta é a ponta de uma relação.
  const ordenadas = [...candidatas].sort((a, b) => posicao.get(a.inicio)! - posicao.get(b.inicio)! || a.indice - b.indice);
  if (ordenadas.some((item, i) => item !== candidatas[i])) {
    diagnosticos.push({ codigo: 'paradas_reordenadas', mensagem: 'As paradas não vieram na ordem do texto; foram reordenadas.' });
  }
  if (ordenadas.length > MAXIMO_DE_PARADAS) {
    diagnosticos.push({ codigo: 'paradas_demais', mensagem: `${String(ordenadas.length)} paradas; ficaram as ${String(MAXIMO_DE_PARADAS)} primeiras.` });
    ordenadas.length = MAXIMO_DE_PARADAS;
  }

  const paradas: ParadaDoRoteiroV1[] = [];
  const falasDasParadas: { narracao: string; pergunta: string | null; transicao: string }[] = [];
  for (const { gerada, onde, inicio, fim } of ordenadas) {
    const idsElementos = traduzir(gerada.elementos, contexto.aliases.elementos, (id) => elementos.has(id), onde);
    const idsRelacoes = traduzir(gerada.relacoes, contexto.aliases.relacoes, (id) => relacoes.has(id), onde);
    const idsDificuldades = traduzir(gerada.dificuldades, contexto.aliases.dificuldades, (id) => dificuldades.has(id), onde);
    const idsNotas = traduzir(gerada.notas, contexto.notas, (id) => contexto.ancorasDasNotas.has(id), onde);
    const idsVisuais = traduzir(gerada.visuais, contexto.visuais, (id) => contexto.visuaisPorId.has(id), onde);
    const [a, b] = [posicao.get(inicio)!, posicao.get(fim)!];
    const noTrecho = (ancora: AncoraV1): boolean => { const p = posicao.get(ancora.bloco_id); return p !== undefined && p >= a && p <= b; };
    const ancoraDoVisual = (id: Id): AncoraV1 | undefined => { const alvo = contexto.visuaisPorId.get(id)?.alvo; return alvo && alvo.tipo !== 'capitulo' ? alvo.ancora : undefined; };
    // Candidatas ao foco, na ordem de preferência do tipo da parada.
    const doElemento = idsElementos.map((id) => elementos.get(id)!.ancoras[0]);
    const daDificuldade = idsDificuldades.map((id) => dificuldades.get(id)!.ancoras[0]);
    const daNota = idsNotas.map((id) => contexto.ancorasDasNotas.get(id));
    const doVisual = idsVisuais.map(ancoraDoVisual);
    const ordem = gerada.tipo === 'dificuldade' ? [daDificuldade, doElemento, daNota, doVisual]
      : gerada.tipo === 'nota' ? [daNota, doElemento, daDificuldade, doVisual]
        : gerada.tipo === 'visual' ? [doVisual, doElemento, daNota, daDificuldade]
          : [doElemento, daDificuldade, daNota, doVisual];
    const ancoras = ordem.flat().filter(dentroDoCapitulo);
    let foco = ancoras.find(noTrecho);
    if (!foco) {
      const primeiro = contexto.blocos[a]!;
      if (primeiro.texto.length === 0) { diagnosticos.push({ codigo: 'bloco_vazio', mensagem: `${onde}: o trecho começa num bloco vazio; a parada caiu.` }); continue; }
      foco = ancoraDoBlocoInteiro(contexto.versaoId, primeiro);
    }
    // A ponta: o outro lado da primeira relação que sai do trecho; senão, uma âncora citada fora dele.
    let ponta: AncoraV1 | null = null;
    for (const id of idsRelacoes) {
      const relacao = relacoes.get(id)!;
      const fora = [relacao.origem_id, relacao.destino_id].map((e) => elementos.get(e)?.ancoras[0]).find((ancora) => dentroDoCapitulo(ancora) && !noTrecho(ancora));
      if (fora) { ponta = fora; break; }
    }
    // Sem relação que saia do trecho, só uma parada de relação aponta outra âncora citada fora dele.
    if (ponta === null && (gerada.tipo === 'relacao' || gerada.tipo === 'retorno')) ponta = ancoras.find((ancora) => !noTrecho(ancora)) ?? null;
    const titulo = limpar(gerada.titulo).slice(0, 160) || 'Parada';
    paradas.push({
      ordem: paradas.length + 1, tipo: gerada.tipo, titulo, bloco_inicio: inicio, bloco_fim: fim, foco, ponta,
      elementos: idsElementos, relacoes: idsRelacoes, dificuldades: idsDificuldades, anotacoes: idsNotas, visuais: idsVisuais,
      pergunta: gerada.pergunta === null || limpar(gerada.pergunta) === '' ? null : limpar(gerada.pergunta).slice(0, 600),
    });
    falasDasParadas.push({ narracao: limpar(gerada.narracao), pergunta: gerada.pergunta === null ? null : limpar(gerada.pergunta), transicao: limpar(gerada.transicao) });
  }
  if (paradas.length === 0) throw new Error('O roteiro não tem nenhuma parada válida.');

  const falas: FalaDoRoteiroV1[] = [];
  const falar = (papel: PapelDaFalaV1, parada: number | null, texto: string): void => {
    const limpo = limpar(texto).slice(0, 1600);
    if (limpo === '') return;
    falas.push({ id: `f${String(falas.length + 1).padStart(3, '0')}`, papel, parada, texto: limpo });
  };
  falar('abertura', null, saida.abertura);
  if (falas.length === 0) falar('abertura', null, 'Vamos começar.');
  falasDasParadas.forEach((fala, i) => {
    const ordemDaParada = i + 1;
    falar('parada', ordemDaParada, fala.narracao || paradas[i]!.titulo);
    if (fala.pergunta) falar('pergunta', ordemDaParada, fala.pergunta);
    if (ordemDaParada < paradas.length) falar('transicao', ordemDaParada, fala.transicao);
  });
  falar('fechamento', null, saida.fechamento);
  if (contexto.temProximo) falar('ponte', null, saida.ponte);
  else if (limpar(saida.ponte) !== '') diagnosticos.push({ codigo: 'ponte_sem_proximo', mensagem: 'Veio uma ponte, mas este é o último capítulo; ficou de fora.' });
  const perguntas = saida.perguntas.map(limpar).filter((p) => p !== '').slice(0, 3).map((p) => p.slice(0, 600));
  return { paradas, falas, perguntas_finais: perguntas, diagnosticos };
}
