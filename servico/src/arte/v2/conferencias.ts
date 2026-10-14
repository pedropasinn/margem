/**
 * Conferências determinísticas do algoritmo v2: o que o serviço verifica sozinho, sem modelo, entre uma
 * etapa e outra. Citações são conferidas letra por letra contra o texto da fonte; regiões, quanto ao
 * tamanho e à sobreposição; afirmações, quanto a tipo, apoio e repetição; o roteiro, quanto à gramática,
 * à repetição entre batidas e ao que se consegue dizer em voz alta.
 */
import type { FormaDaRegiao } from '@margem/contratos';
import { iouDeRetangulos, limitesDaRegiao } from '../../../../core/src/arte.js';
import { duracaoEstimada } from '../../../../core/src/visita.js';
import type { DossieDaObra } from './acervo.js';
import { contarPalavras, dice, jaccard, trechoPresente } from './texto.js';
import type { AfirmacaoCandidata, Diagnostico, LeituraVisual, ModeloCandidato, RevisaoDoModelo, RoteiroCandidato } from './tipos.js';

const arred = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

/** Prende a forma dentro da obra; devolve null se não sobra área (polígono degenerado, caixa vazia). */
export function normalizarForma(forma: FormaDaRegiao): FormaDaRegiao | null {
  if (forma.tipo === 'ponto') return { tipo: 'ponto', x: arred(forma.x), y: arred(forma.y) };
  if (forma.tipo === 'bbox') {
    const x = arred(forma.x), y = arred(forma.y);
    const largura = arred(Math.min(forma.largura, 1 - x)), altura = arred(Math.min(forma.altura, 1 - y));
    return largura > 0.002 && altura > 0.002 ? { tipo: 'bbox', x, y, largura, altura } : null;
  }
  const pontos = forma.pontos.map((p) => ({ x: arred(p.x), y: arred(p.y) }));
  const area = Math.abs(pontos.reduce((s, a, i) => { const b = pontos[(i + 1) % pontos.length]!; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
  return pontos.length >= 3 && area > 1e-5 ? { tipo: 'poligono', pontos } : null;
}

export function areaDaForma(forma: FormaDaRegiao): number { const l = limitesDaRegiao(forma); return l.largura * l.altura; }

const TETO_AREA = 0.45, PISO_AREA = 0.0005;

export function citacoesValidas(a: AfirmacaoCandidata, corpus: Map<string, string>): { validas: AfirmacaoCandidata['citacoes']; invalidas: AfirmacaoCandidata['citacoes'] } {
  const validas: AfirmacaoCandidata['citacoes'] = [], invalidas: AfirmacaoCandidata['citacoes'] = [];
  for (const c of a.citacoes) (corpus.has(c.fonte) && trechoPresente(c.trecho, corpus.get(c.fonte) ?? '') ? validas : invalidas).push(c);
  return { validas, invalidas };
}

const documentada = (a: AfirmacaoCandidata): boolean => a.tipo === 'fato' || a.tipo === 'interpretacao_documentada';

/** Alertas sobre o candidato da etapa 2, que vão para a revisão (etapa 3) e para o registro. */
export function conferirCandidato(c: ModeloCandidato, dossie: DossieDaObra, corpus: Map<string, string>, leitura: LeituraVisual | null): Diagnostico[] {
  const d: Diagnostico[] = [];
  const add = (codigo: string, gravidade: Diagnostico['gravidade'], detalhe: string) => d.push({ codigo, gravidade, detalhe });
  c.regioes.forEach((r, i) => {
    const forma = normalizarForma(r.forma);
    if (!forma) { add('regiao_degenerada', 'grave', `R${String(i)}`); return; }
    const area = areaDaForma(forma);
    if (area > TETO_AREA) add('regiao_grande', 'aviso', `R${String(i)} "${r.rotulo}" cobre ${(area * 100).toFixed(0)}% da obra`);
    if (area < PISO_AREA) add('regiao_minuscula', 'aviso', `R${String(i)} "${r.rotulo}"`);
    const objeto = r.objeto === null ? undefined : leitura?.objetos[r.objeto];
    if (objeto) {
      const iou = iouDeRetangulos(limitesDaRegiao(forma), objeto);
      if (iou < 0.3) add('regiao_longe_do_objeto', 'aviso', `R${String(i)} "${r.rotulo}" tem IoU ${iou.toFixed(2)} com o objeto ${String(r.objeto)} do inventário`);
    }
    c.regioes.forEach((s, j) => {
      const outra = j > i ? normalizarForma(s.forma) : null;
      if (outra && iouDeRetangulos(limitesDaRegiao(forma), limitesDaRegiao(outra)) > 0.7) add('regioes_sobrepostas', 'aviso', `R${String(i)} e R${String(j)}`);
    });
  });
  const fontes = new Set(dossie.fontes.map((f) => f.id));
  c.afirmacoes.forEach((a, i) => {
    const rot = `A${String(i)}`;
    if (a.regioes.some((r) => r >= c.regioes.length) || a.apoios.some((p) => p >= c.afirmacoes.length || p === i)) add('indice_invalido', 'grave', rot);
    if (a.fontes.some((f) => !fontes.has(f))) add('fonte_inexistente', 'grave', `${rot}: ${a.fontes.filter((f) => !fontes.has(f)).join(', ')}`);
    if (a.tipo === 'observacao' && !a.regioes.length) add('observacao_sem_regiao', 'grave', rot);
    if (a.tipo === 'inferencia_ia' && !a.apoios.length) add('inferencia_sem_apoio', 'grave', rot);
    if (documentada(a)) {
      const { validas, invalidas } = citacoesValidas(a, corpus);
      for (const c2 of invalidas) add('citacao_nao_encontrada', validas.length ? 'aviso' : 'grave', `${rot}: "${c2.trecho.slice(0, 120)}" não está no texto da fonte ${c2.fonte}`);
      if (!a.citacoes.length) add('documentada_sem_citacao', 'grave', rot);
    }
    if (dice(a.texto, dossie.identidade.afirmacao) >= 0.6) add('repete_identidade', 'grave', rot);
    if (contarPalavras(a.texto) > 35) add('afirmacao_longa', 'aviso', `${rot}: ${String(contarPalavras(a.texto))} palavras`);
    c.afirmacoes.forEach((b, j) => { if (j > i && dice(a.texto, b.texto) >= 0.75) add('quase_repetida', 'aviso', `A${String(i)} e A${String(j)}`); });
  });
  return d;
}

/** Índices antigos → novos depois de filtrar uma lista. */
function reindexar(manter: boolean[]): Map<number, number> {
  const mapa = new Map<number, number>(); let n = 0;
  manter.forEach((m, i) => { if (m) mapa.set(i, n++); });
  return mapa;
}

export interface CandidatoRevisado extends ModeloCandidato { tese: { texto: string; afirmacoes: number[] } }

export interface Corte { tipo: 'regiao' | 'afirmacao'; indice: number; motivo: string; texto: string }

/**
 * Aplica os vereditos da revisão (etapa 3) ao candidato; o que a revisão não citou fica como está.
 * Cortados ficam marcados (rótulo/texto vazio) para `filtrarFinal` reindexar tudo de uma vez.
 */
export function aplicarRevisao(c: ModeloCandidato, r: RevisaoDoModelo): { candidato: CandidatoRevisado; cortes: Corte[] } {
  const cortes: Corte[] = [];
  const regioes = c.regioes.map((reg, i) => {
    const v = r.regioes.find((x) => x.indice === i);
    if (v?.veredito === 'cortar') { cortes.push({ tipo: 'regiao', indice: i, motivo: `revisao: ${v.motivo}`, texto: reg.rotulo }); return { ...reg, rotulo: '' }; }
    return v?.veredito === 'ajustar' && v.forma ? { ...reg, forma: v.forma } : reg;
  });
  const afirmacoes = c.afirmacoes.map((a, i): AfirmacaoCandidata => {
    const v = r.afirmacoes.find((x) => x.indice === i);
    if (v?.veredito === 'cortar') { cortes.push({ tipo: 'afirmacao', indice: i, motivo: `revisao: ${v.motivo}`, texto: a.texto }); return { ...a, texto: '' }; }
    if (v?.veredito !== 'corrigir') return a;
    const tipo = v.tipo ?? a.tipo;
    return { ...a, texto: v.texto ?? a.texto, tipo, confianca: tipo === 'intencao_desconhecida' ? 'nao_aplicavel' : v.confianca ?? a.confianca, evidencia: v.evidencia ?? a.evidencia };
  });
  const escolhida = c.teses[r.tese.indice] ?? c.teses[0];
  return { candidato: { ...c, regioes, afirmacoes, tese: { texto: r.tese.texto || (escolhida?.texto ?? ''), afirmacoes: escolhida?.afirmacoes ?? [] } }, cortes };
}

/** Sem revisão (ou para os testes): a primeira tese candidata, nada cortado. */
export function semRevisao(c: ModeloCandidato): CandidatoRevisado {
  return { ...c, tese: { texto: c.teses[0]?.texto ?? '', afirmacoes: c.teses[0]?.afirmacoes ?? [] } };
}

/**
 * Portão final do modelo: corta, em cascata, o que não se sustenta (citação não achada, observação sem
 * região válida, inferência sem apoio, repetição da identidade, ciclos), solta regiões sem uso e devolve
 * o candidato reindexado com a lista de cortes.
 */
export function filtrarFinal(c: CandidatoRevisado, dossie: DossieDaObra, corpus: Map<string, string>, opcoes: { soImagem?: boolean } = {}): { candidato: CandidatoRevisado; cortes: Corte[] } {
  const cortes: Corte[] = [];
  const fontes = new Set(dossie.fontes.map((f) => f.id));
  const regioes = c.regioes.map((r) => (r.rotulo ? { ...r, forma: normalizarForma(r.forma) } : null));
  regioes.forEach((r, i) => { if (c.regioes[i]!.rotulo && !r?.forma) cortes.push({ tipo: 'regiao', indice: i, motivo: 'forma_degenerada', texto: c.regioes[i]!.rotulo }); });
  const viva = regioes.map((r) => Boolean(r?.forma));
  const afirmacoes = c.afirmacoes.map((a) => (a.texto ? { ...a, regioes: a.regioes.filter((i) => viva[i]), fontes: [...new Set([...a.fontes, ...a.citacoes.map((x) => x.fonte)])].filter((f) => fontes.has(f)) } : null));
  const cortar = (i: number, motivo: string) => { cortes.push({ tipo: 'afirmacao', indice: i, motivo, texto: afirmacoes[i]!.texto }); afirmacoes[i] = null; };
  afirmacoes.forEach((a, i) => {
    if (!a) return;
    // Obra não identificada (V-W5): só o que se vê e o que se infere disso; nada se documenta.
    if (opcoes.soImagem && a.tipo !== 'observacao' && a.tipo !== 'inferencia_ia') { cortar(i, 'so_pela_imagem'); return; }
    if (opcoes.soImagem && (a.fontes.length || a.citacoes.length)) afirmacoes[i] = { ...a, fontes: [], citacoes: [] };
    if (documentada(a)) {
      const { validas } = citacoesValidas(a, corpus);
      if (!validas.length) { cortar(i, 'citacao_nao_encontrada'); return; }
      afirmacoes[i] = { ...a, citacoes: validas, fontes: [...new Set([...a.fontes, ...validas.map((v) => v.fonte)])] };
    }
    if (a.tipo === 'observacao' && !a.regioes.length) { cortar(i, 'observacao_sem_regiao'); return; }
    if (dice(a.texto, dossie.identidade.afirmacao) >= 0.6) { cortar(i, 'repete_identidade'); return; }
    const anterior = afirmacoes.slice(0, i).findIndex((b) => b !== null && dice(a.texto, b.texto) >= 0.8);
    if (anterior >= 0) cortar(i, `repete_A${String(anterior)}`);
  });
  // Apoios: só para afirmações vivas, sem ciclos (a aresta que fecha um ciclo cai); inferência sem apoio cai, em cascata.
  for (let mudou = true; mudou;) {
    mudou = false;
    afirmacoes.forEach((a, i) => {
      if (!a) return;
      const apoios = a.apoios.filter((p) => p !== i && afirmacoes[p]);
      if (apoios.length !== a.apoios.length) { afirmacoes[i] = { ...a, apoios }; mudou = true; }
      if (a.tipo === 'inferencia_ia' && !apoios.length) { cortar(i, 'inferencia_sem_apoio'); mudou = true; }
    });
    const estado = new Map<number, 'visitando' | 'feito'>();
    const visitar = (i: number): void => {
      estado.set(i, 'visitando');
      const a = afirmacoes[i];
      for (const p of a?.apoios ?? []) {
        if (estado.get(p) === 'visitando') { afirmacoes[i] = { ...a!, apoios: a!.apoios.filter((x) => x !== p) }; mudou = true; continue; }
        if (!estado.has(p)) visitar(p);
      }
      estado.set(i, 'feito');
    };
    afirmacoes.forEach((a, i) => { if (a && !estado.has(i)) visitar(i); });
  }
  afirmacoes.forEach((a, i) => { if (a?.tipo === 'intencao_desconhecida' && a.confianca !== 'nao_aplicavel') afirmacoes[i] = { ...a, confianca: 'nao_aplicavel' }; });
  // Regiões que nenhuma afirmação viva usa saem.
  const usadas = new Set(afirmacoes.flatMap((a) => a?.regioes ?? []));
  regioes.forEach((r, i) => { if (r?.forma && !usadas.has(i)) { cortes.push({ tipo: 'regiao', indice: i, motivo: 'sem_uso', texto: r.rotulo }); viva[i] = false; } });
  const mapaR = reindexar(viva), mapaA = reindexar(afirmacoes.map(Boolean));
  const candidato: CandidatoRevisado = {
    regioes: regioes.flatMap((r, i) => (viva[i] && r?.forma ? [{ rotulo: r.rotulo, objeto: r.objeto, forma: r.forma }] : [])),
    afirmacoes: afirmacoes.flatMap((a) => (a ? [{ ...a, regioes: a.regioes.flatMap((x) => (mapaR.has(x) ? [mapaR.get(x)!] : [])), apoios: a.apoios.map((x) => mapaA.get(x)!) }] : [])),
    teses: c.teses.map((t) => ({ ...t, afirmacoes: t.afirmacoes.flatMap((x) => (mapaA.has(x) ? [mapaA.get(x)!] : [])) })).filter((t) => t.afirmacoes.length),
    limites: c.limites,
    tese: { texto: c.tese.texto, afirmacoes: c.tese.afirmacoes.flatMap((x) => (mapaA.has(x) ? [mapaA.get(x)!] : [])) },
  };
  return { candidato, cortes };
}

export const META = /\b(a ia|pela ia|da ia|intelig[eê]ncia artificial|dossi[eê]|neste modelo|no modelo|proposta pela|leitura proposta)\b/iu;
export const CLICHES = /\b(volte ao conjunto|observe novamente|olhe de novo para o conjunto|em resumo|em suma|você já reparou|neste quadro|esta pintura|nesta pintura)\b/iu;
export const RESSALVAS = /\b(n[aã]o comprova|n[aã]o demonstra|n[aã]o [eé] poss[ií]vel|n[aã]o sabemos|n[aã]o h[aá] (declara|document|prova)|n[aã]o se pode afirmar|sem comprova|é uma interpreta[cç][aã]o|nao comprovad|não comprovad)/giu;
export const IMPRONUNCIAVEL = /[()[\];/]|\bc\.\s?\d|\bs[eé]c\.|\bca\.\s|\betc\b|—.*—/u;

/** Conferência do roteiro (etapa 4) contra a gramática pedida e o modelo final. */
export function conferirRoteiro(r: RoteiroCandidato, c: CandidatoRevisado): Diagnostico[] {
  const d: Diagnostico[] = [];
  const add = (codigo: string, gravidade: Diagnostico['gravidade'], detalhe: string) => d.push({ codigo, gravidade, detalhe });
  const b = r.batidas;
  if (b.length < 5 || b.length > 7) add('numero_de_batidas', 'grave', `${String(b.length)} batidas (pedido: 5 a 7)`);
  if (b[0]?.papel !== 'abertura') add('sem_abertura', 'grave', 'a primeira batida não é abertura');
  if (b.at(-1)?.papel !== 'fechamento') add('sem_fechamento', 'grave', 'a última batida não é fechamento');
  if (b.filter((x) => x.papel === 'abertura').length > 1 || b.filter((x) => x.papel === 'fechamento').length > 1) add('papel_repetido', 'grave', 'mais de uma abertura ou fechamento');
  const evidencias = b.filter((x) => x.papel === 'evidencia_visual');
  if (evidencias.length < 2 || evidencias.length > 4) add('evidencias', 'grave', `${String(evidencias.length)} evidências visuais (pedido: 2 a 4)`);
  const regioesDasEvid = evidencias.map((x) => x.regiao);
  if (new Set(regioesDasEvid).size !== regioesDasEvid.length) add('evidencia_na_mesma_regiao', 'grave', 'duas evidências apontam para a mesma região');
  if (b.filter((x) => x.papel === 'contexto').length > 1 || b.filter((x) => x.papel === 'interpretacao').length > 1) add('papel_repetido', 'aviso', 'mais de um contexto ou interpretação');
  b.forEach((x, i) => {
    const rot = `B${String(i)}`;
    if (x.afirmacoes.some((a) => a >= c.afirmacoes.length)) add('indice_invalido', 'grave', `${rot}: afirmação inexistente`);
    if (x.regiao !== null && x.regiao >= c.regioes.length) add('indice_invalido', 'grave', `${rot}: região inexistente`);
    if (x.papel === 'evidencia_visual') {
      if (x.regiao === null) add('evidencia_sem_regiao', 'grave', rot);
      else if (!x.afirmacoes.some((a) => c.afirmacoes[a]?.regioes.includes(x.regiao!))) add('regiao_sem_apoio', 'aviso', `${rot}: R${String(x.regiao)} não está nas afirmações da batida`);
    }
    const n = contarPalavras(x.narracao);
    if (n > 32) add('batida_longa', 'grave', `${rot}: ${String(n)} palavras`); else if (n > 26) add('batida_longa', 'aviso', `${rot}: ${String(n)} palavras`);
    if (n < 5) add('batida_curta', 'aviso', `${rot}: ${String(n)} palavras`);
    if (META.test(x.narracao)) add('metalinguagem', 'grave', `${rot}: "${META.exec(x.narracao)?.[0] ?? ''}"`);
    if (CLICHES.test(x.narracao)) add('cliche', 'grave', `${rot}: "${CLICHES.exec(x.narracao)?.[0] ?? ''}"`);
    if (IMPRONUNCIAVEL.test(x.narracao)) add('dificil_de_falar', 'grave', `${rot}: parênteses, ponto e vírgula, barra ou abreviação`);
  });
  const ressalvas = b.reduce((s, x) => s + (x.narracao.match(RESSALVAS)?.length ?? 0), 0);
  if (ressalvas > 1) add('ressalvas', ressalvas > 2 ? 'grave' : 'aviso', `${String(ressalvas)} ressalvas no roteiro`);
  for (let i = 0; i < b.length; i += 1) for (let j = i + 1; j < b.length; j += 1) {
    const s = jaccard(b[i]!.narracao, b[j]!.narracao);
    if (s >= 0.5) add('repeticao', 'grave', `B${String(i)} e B${String(j)} (Jaccard ${s.toFixed(2)})`);
    else if (s >= 0.34) add('repeticao', 'aviso', `B${String(i)} e B${String(j)} (Jaccard ${s.toFixed(2)})`);
  }
  const fecho = b.at(-1);
  if (fecho && (jaccard(fecho.narracao, r.tese) >= 0.5 || jaccard(fecho.narracao, b[0]!.narracao) >= 0.5)) add('fechamento_repete', 'grave', 'o fechamento repete a tese ou a abertura');
  const duracao = b.reduce((s, x) => s + duracaoEstimada(x.narracao) + 0.35, 0);
  if (duracao < 20 || duracao > 60) add('duracao', 'grave', `${duracao.toFixed(1)} s estimados (pedido: 20 a 60)`);
  else if (duracao < 28 || duracao > 52) add('duracao', 'aviso', `${duracao.toFixed(1)} s estimados (alvo: 30 a 50)`);
  if (contarPalavras(r.tese) > 30) add('tese_longa', 'aviso', `${String(contarPalavras(r.tese))} palavras`);
  return d;
}

export const graves = (d: Diagnostico[]): Diagnostico[] => d.filter((x) => x.gravidade === 'grave');

/** Reparo determinístico, sem modelo: evidência cuja região não está nas suas afirmações herda a região da primeira delas. */
export function repararRoteiro(r: RoteiroCandidato, c: CandidatoRevisado): RoteiroCandidato {
  return { ...r, batidas: r.batidas.map((x) => {
    if (x.papel !== 'evidencia_visual') return x;
    const das = x.afirmacoes.flatMap((a) => c.afirmacoes[a]?.regioes ?? []);
    return das[0] !== undefined && (x.regiao === null || !das.includes(x.regiao)) ? { ...x, regiao: das[0] } : x;
  }) };
}

/**
 * Acrescenta ao modelo final as afirmações da pesquisa curada (já verificadas, com fonte) que o Codex
 * não reproduziu, para que o estudo não perca fatos documentados. Não contam como acerto da geração.
 */
export function transportarPesquisa(c: CandidatoRevisado, dossie: DossieDaObra): CandidatoRevisado {
  const novas: AfirmacaoCandidata[] = dossie.pesquisa
    .filter((p) => !c.afirmacoes.some((a) => dice(a.texto, p.texto) >= 0.6))
    .map((p) => ({ texto: p.texto, tipo: p.tipo === 'fato' ? 'fato' : 'interpretacao_documentada', dimensao: p.tipo === 'fato' ? 'historia' : 'interpretacoes', confianca: 'alta', evidencia: p.evidencia, fontes: p.fontes, citacoes: [], regioes: [], apoios: [], origem: 'curadoria' }));
  return { ...c, afirmacoes: [...c.afirmacoes, ...novas] };
}
