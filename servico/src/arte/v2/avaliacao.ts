/**
 * Avaliação determinística de uma geração contra a referência ("esperado") da obra: contrato e regras,
 * casamento de regiões por IoU, cobertura das afirmações de referência por tipo, ritmo e repetição do
 * roteiro, câmera e fontes. São réguas, não juízo: a qualidade narrativa e factual é lida por uma pessoa
 * no relatório markdown que acompanha cada geração.
 */
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1, RetanguloDaObra } from '@margem/contratos';
import { validarAnaliseCurtaDaObra, validarModeloDaObra } from '../../../../contratos/src/validadores.js';
import { conferirAnaliseCurta, conferirModeloDaObra, contemRetangulo, iouDeRetangulos, limitesDaRegiao } from '../../../../core/src/arte.js';
import { CLICHES, IMPRONUNCIAVEL, META, RESSALVAS } from './conferencias.js';
import type { RegistroV2 } from './pipeline.js';
import { conteudo, contarPalavras, dice, jaccard } from './texto.js';

export interface EntradaDaAvaliacao {
  /** `null` numa obra sem referência: só as réguas da própria geração. */
  esperado: { modelo: ModeloDaObraV1; curta: AnaliseCurtaDaObraV1 | null } | null;
  gerado: { modelo: ModeloDaObraV1; curta: AnaliseCurtaDaObraV1 | null };
  registro: RegistroV2 | null;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const media = (xs: number[]): number => (xs.length ? r3(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);

export function medirCurta(c: AnaliseCurtaDaObraV1, m: ModeloDaObraV1) {
  const b = c.batidas;
  const palavras = b.map((x) => contarPalavras(x.narracao));
  const duracao = b.at(-1)?.fim_s ?? 0;
  const pares: { a: number; b: number; jaccard: number }[] = [];
  for (let i = 0; i < b.length; i += 1) for (let j = i + 1; j < b.length; j += 1) pares.push({ a: i, b: j, jaccard: r3(jaccard(b[i]!.narracao, b[j]!.narracao)) });
  const porRadical = new Map<string, Set<number>>();
  b.forEach((x, i) => { for (const p of conteudo(x.narracao)) porRadical.set(p, (porRadical.get(p) ?? new Set()).add(i)); });
  const repetidos = [...porRadical].filter(([, s]) => s.size >= 3).map(([p, s]) => `${p} (${String(s.size)})`);
  const contar = (re: RegExp) => b.reduce((s, x) => s + (x.narracao.match(new RegExp(re.source, 'giu'))?.length ?? 0), 0);
  const comRegiao = b.filter((x) => x.regiao_id);
  const camerasQueContem = comRegiao.filter((x) => {
    const r = m.regioes.find((y) => y.id === x.regiao_id);
    return r ? contemRetangulo(x.camera.para, limitesDaRegiao(r.forma)) : false;
  }).length;
  const fecho = b.at(-1)?.narracao ?? '';
  return {
    batidas: b.length,
    papeis: b.map((x) => x.papel),
    duracao_s: duracao,
    palavras: palavras.reduce((s, x) => s + x, 0),
    palavras_por_s: duracao ? r3(palavras.reduce((s, x) => s + x, 0) / duracao) : 0,
    palavras_por_batida: { min: Math.min(...palavras), max: Math.max(...palavras), media: media(palavras) },
    repeticao: { jaccard_max: Math.max(0, ...pares.map((p) => p.jaccard)), jaccard_medio: media(pares.map((p) => p.jaccard)), pares_acima_0_34: pares.filter((p) => p.jaccard >= 0.34), radicais_em_3_ou_mais_batidas: repetidos },
    fechamento: { jaccard_com_tese: r3(jaccard(fecho, c.tese)), jaccard_com_abertura: r3(jaccard(fecho, b[0]?.narracao ?? '')) },
    ressalvas: contar(RESSALVAS), metalinguagem: contar(META), cliches: contar(CLICHES), dificil_de_falar: b.filter((x) => IMPRONUNCIAVEL.test(x.narracao)).length,
    regioes_distintas: new Set(comRegiao.map((x) => x.regiao_id)).size,
    camera_contem_regiao: comRegiao.length ? r3(camerasQueContem / comRegiao.length) : null,
    tese_palavras: contarPalavras(c.tese),
  };
}

function casarRegioes(esperado: ModeloDaObraV1, gerado: ModeloDaObraV1) {
  const E = esperado.regioes.map((r) => ({ rotulo: r.rotulo, ret: limitesDaRegiao(r.forma) }));
  const G = gerado.regioes.map((r) => ({ rotulo: r.rotulo, ret: limitesDaRegiao(r.forma) }));
  const melhor = (a: RetanguloDaObra, lista: { ret: RetanguloDaObra }[]) => Math.max(0, ...lista.map((x) => iouDeRetangulos(a, x.ret)));
  // Casamento um a um, guloso pelo maior IoU.
  const pares: { esperado: string; gerado: string; iou: number }[] = [];
  const candidatos = E.flatMap((e, i) => G.map((g, j) => ({ i, j, iou: iouDeRetangulos(e.ret, g.ret) }))).filter((p) => p.iou > 0).sort((a, b) => b.iou - a.iou);
  const usadosE = new Set<number>(), usadosG = new Set<number>();
  for (const p of candidatos) { if (usadosE.has(p.i) || usadosG.has(p.j)) continue; usadosE.add(p.i); usadosG.add(p.j); pares.push({ esperado: E[p.i]!.rotulo, gerado: G[p.j]!.rotulo, iou: r3(p.iou) }); }
  const area = (l: { ret: RetanguloDaObra }[]) => media(l.map((x) => x.ret.largura * x.ret.altura));
  return {
    esperadas: E.length, geradas: G.length,
    pares,
    sem_par_esperadas: E.filter((_, i) => !usadosE.has(i)).map((e) => e.rotulo),
    iou_medio_casado: media(pares.map((p) => p.iou)),
    melhor_iou_por_esperada: E.map((e) => ({ rotulo: e.rotulo, iou: r3(melhor(e.ret, G)) })),
    recall_iou_0_5: E.filter((e) => melhor(e.ret, G) >= 0.5).length,
    recall_iou_0_3: E.filter((e) => melhor(e.ret, G) >= 0.3).length,
    precisao_iou_0_3: G.filter((g) => melhor(g.ret, E) >= 0.3).length,
    area_media: { esperada: area(E), gerada: area(G) },
  };
}

function cobrirAfirmacoes(esperado: ModeloDaObraV1, gerado: ModeloDaObraV1) {
  const identidadeE = new Set(esperado.identidade.afirmacoes), identidadeG = new Set(gerado.identidade.afirmacoes);
  // Só o que a geração escreveu: identidade e pesquisa curada transportada não contam como acerto.
  const G = gerado.afirmacoes.filter((a) => !identidadeG.has(a.id) && a.proveniencia.autor === 'ia');
  const regiaoDe = (m: ModeloDaObraV1, ids: string[]) => ids.map((id) => m.regioes.find((r) => r.id === id)).flatMap((r) => (r ? [limitesDaRegiao(r.forma)] : []));
  const itens = esperado.afirmacoes.filter((a) => !identidadeE.has(a.id)).map((e) => {
    const ancorasE = regiaoDe(esperado, e.regioes);
    const pontuados = G.map((g) => {
      const ancorasG = regiaoDe(gerado, g.regioes);
      const iou = Math.max(0, ...ancorasE.flatMap((a) => ancorasG.map((b) => iouDeRetangulos(a, b))));
      return { g, sim: dice(e.texto, g.texto), iou };
    }).sort((a, b) => b.sim - a.sim);
    const melhor = pontuados[0];
    const coberta = pontuados.some((p) => p.sim >= 0.3 || (e.tipo === 'observacao' && p.sim >= 0.2 && p.iou >= 0.3));
    return { tipo: e.tipo, esperado: e.texto, melhor: melhor?.g.texto ?? null, tipo_do_melhor: melhor?.g.tipo ?? null, semelhanca: r3(melhor?.sim ?? 0), coberta };
  });
  const tipos = [...new Set(itens.map((i) => i.tipo))];
  const contagem = (lista: { tipo: string }[]) => Object.fromEntries([...new Set(lista.map((a) => a.tipo))].map((t) => [t, lista.filter((a) => a.tipo === t).length]));
  return {
    por_tipo: Object.fromEntries(tipos.map((t) => [t, { cobertas: itens.filter((i) => i.tipo === t && i.coberta).length, total: itens.filter((i) => i.tipo === t).length }])),
    cobertas: itens.filter((i) => i.coberta).length, total: itens.length,
    itens,
    tipos_gerados: contagem(G), tipos_esperados: contagem(esperado.afirmacoes.filter((a) => !identidadeE.has(a.id))),
  };
}

function fontesCitadas(m: ModeloDaObraV1) {
  const ids = new Set(m.afirmacoes.filter((a) => !m.identidade.afirmacoes.includes(a.id)).flatMap((a) => a.fontes));
  const lista = m.fontes.filter((f) => ids.has(f.id));
  return { distintas: lista.length, categorias: lista.map((f) => f.categoria), titulos: lista.map((f) => f.titulo) };
}

export function avaliarGeracao(e: EntradaDaAvaliacao) {
  const { modelo: gm, curta: gc } = e.gerado;
  const contrato = {
    modelo_valido: validarModeloDaObra(gm),
    curta_valida: gc ? validarAnaliseCurtaDaObra(gc) : null,
    falhas_modelo: conferirModeloDaObra(gm),
    falhas_curta: gc ? conferirAnaliseCurta(gc, gm) : null,
  };
  return {
    versao: 1,
    contrato,
    regioes: e.esperado ? casarRegioes(e.esperado.modelo, gm) : null,
    afirmacoes: e.esperado ? cobrirAfirmacoes(e.esperado.modelo, gm) : null,
    curta: { gerada: gc ? medirCurta(gc, gm) : null, esperada: e.esperado?.curta ? medirCurta(e.esperado.curta, e.esperado.modelo) : null },
    fontes: { gerado: fontesCitadas(gm), esperado: e.esperado ? fontesCitadas(e.esperado.modelo) : null },
    custo: e.registro ? { chamadas: e.registro.chamadas, duracao_chamadas_s: r3(e.registro.duracao_chamadas_ms / 1000), etapas: e.registro.etapas.map((x) => ({ etapa: x.etapa, estado: x.estado, duracao_s: r3(x.duracao_ms / 1000) })) } : null,
    conferencias: e.registro ? { cortes: e.registro.diagnosticos.cortes.length, graves_no_roteiro: e.registro.diagnosticos.roteiro.filter((d) => d.gravidade === 'grave').length, graves_no_reparo: e.registro.diagnosticos.roteiro_reparo?.filter((d) => d.gravidade === 'grave').length ?? null, roteiro_escolhido: e.registro.diagnosticos.roteiro_escolhido } : null,
  };
}

export type Avaliacao = ReturnType<typeof avaliarGeracao>;

const tabela = (cab: string[], linhas: (string | number | null)[][]): string =>
  [`| ${cab.join(' | ')} |`, `|${cab.map(() => '---').join('|')}|`, ...linhas.map((l) => `| ${l.map((c) => String(c ?? '—').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')).join(' | ')} |`)].join('\n');

export function relatorioMarkdown(slug: string, rotulo: string, a: Avaliacao, gerado: { modelo: ModeloDaObraV1; curta: AnaliseCurtaDaObraV1 | null }, esperado: AnaliseCurtaDaObraV1 | null = null, registro: RegistroV2 | null = null): string {
  const g = a.curta.gerada, e = a.curta.esperada;
  const linha = (nome: string, f: (m: NonNullable<typeof g>) => string | number | null) => [nome, g ? f(g) : null, e ? f(e) : null];
  const partes = [
    `# Avaliação — ${slug} · ${rotulo}`,
    '',
    'Réguas determinísticas contra a referência (`esperado.*`). Semelhança de texto é grosseira (radicais de cinco letras); a leitura humana decide.',
    '',
    '## Contrato e regras',
    '',
    `- Modelo no contrato: ${a.contrato.modelo_valido ? 'sim' : '**não**'}; falhas de regra: ${a.contrato.falhas_modelo.join(', ') || 'nenhuma'}`,
    `- Curta no contrato: ${a.contrato.curta_valida === null ? '—' : a.contrato.curta_valida ? 'sim' : '**não**'}; falhas de regra: ${a.contrato.falhas_curta?.join(', ') || 'nenhuma'}`,
    a.conferencias ? `- Conferências do serviço: ${String(a.conferencias.cortes)} cortes no modelo; ${String(a.conferencias.graves_no_roteiro)} problemas graves no roteiro${a.conferencias.graves_no_reparo === null ? '' : `, ${String(a.conferencias.graves_no_reparo)} depois do reparo`} (usado: ${a.conferencias.roteiro_escolhido})` : '',
    a.custo ? `- Custo: ${String(a.custo.chamadas)} chamadas, ${a.custo.duracao_chamadas_s.toFixed(0)} s de Codex (${a.custo.etapas.map((x) => `${x.etapa} ${x.duracao_s.toFixed(0)} s${x.estado === 'retomada' ? ' (retomada)' : ''}`).join(', ')})` : '',
    '',
    '## Roteiro: gerado × esperado',
    '',
    tabela(['medida', 'gerado', 'esperado'], [
      linha('batidas', (m) => m.batidas), linha('duração (s)', (m) => m.duracao_s), linha('palavras', (m) => m.palavras), linha('palavras/s', (m) => m.palavras_por_s),
      linha('palavras por batida (mín–máx)', (m) => `${String(m.palavras_por_batida.min)}–${String(m.palavras_por_batida.max)}`),
      linha('Jaccard máx. entre batidas', (m) => m.repeticao.jaccard_max), linha('Jaccard médio', (m) => m.repeticao.jaccard_medio),
      linha('radicais em ≥3 batidas', (m) => m.repeticao.radicais_em_3_ou_mais_batidas.join(', ') || 'nenhum'),
      linha('fechamento × tese (Jaccard)', (m) => m.fechamento.jaccard_com_tese), linha('ressalvas', (m) => m.ressalvas),
      linha('metalinguagem / clichês', (m) => `${String(m.metalinguagem)} / ${String(m.cliches)}`), linha('regiões distintas', (m) => m.regioes_distintas),
      linha('câmera contém a região inteira', (m) => m.camera_contem_regiao), linha('palavras da tese', (m) => m.tese_palavras),
    ]),
    '',
    `**Tese gerada:** ${gerado.curta?.tese ?? '—'}`,
    '',
    ...(gerado.curta?.batidas.map((b, i) => `${String(i + 1)}. *${b.papel}* (${b.inicio_s.toFixed(1)}–${b.fim_s.toFixed(1)} s${b.regiao_id ? `, ${gerado.modelo.regioes.find((r) => r.id === b.regiao_id)?.rotulo ?? '?'}` : ''}) — ${b.narracao}`) ?? []),
    '',
    ...(esperado ? [`**Tese esperada:** ${esperado.tese}`, '', ...esperado.batidas.map((b, i) => `${String(i + 1)}. *${b.papel}* — ${b.narracao}`), ''] : []),
    ...(a.regioes && a.afirmacoes ? ((R, F) => [
    '## Regiões',
    '',
    `${String(R.geradas)} geradas, ${String(R.esperadas)} esperadas. Esperadas com alguma gerada de IoU ≥ 0,5: ${String(R.recall_iou_0_5)}; ≥ 0,3: ${String(R.recall_iou_0_3)}. Geradas que casam com alguma esperada (≥ 0,3): ${String(R.precisao_iou_0_3)}. Área média: gerada ${String(R.area_media.gerada)}, esperada ${String(R.area_media.esperada)}.`,
    '',
    tabela(['esperada', 'melhor IoU'], R.melhor_iou_por_esperada.map((x) => [x.rotulo, x.iou])),
    '',
    tabela(['par esperada', 'par gerada', 'IoU'], R.pares.map((p) => [p.esperado, p.gerado, p.iou])),
    '',
    '## Afirmações de referência cobertas',
    '',
    `${String(F.cobertas)} de ${String(F.total)}. ` + Object.entries(F.por_tipo).map(([t, v]) => `${t}: ${String(v.cobertas)}/${String(v.total)}`).join('; ') + '.',
    `Tipos gerados: ${Object.entries(F.tipos_gerados).map(([t, n]) => `${t} ${String(n)}`).join(', ')}.`,
    '',
    tabela(['tipo', 'esperada', 'gerada mais parecida', 'sim.', 'coberta'], F.itens.map((i) => [i.tipo, i.esperado, i.melhor, i.semelhanca, i.coberta ? 'sim' : 'não'])),
    '',
    ])(a.regioes, a.afirmacoes) : ['## Referência', '', 'Obra sem referência curada: só as réguas da própria geração.', '']),
    '## Afirmações geradas',
    '',
    ...gerado.modelo.afirmacoes.filter((x) => !gerado.modelo.identidade.afirmacoes.includes(x.id)).map((x) => `- **${x.tipo}** (${x.confianca}${x.regioes.length ? `; ${x.regioes.map((id) => gerado.modelo.regioes.find((r) => r.id === id)?.rotulo ?? '?').join(', ')}` : ''}) ${x.texto}`),
    '',
    ...(registro ? ['## Cortes e diagnósticos', '', ...registro.diagnosticos.cortes.map((c) => `- corte de ${c.tipo} ${String(c.indice)} (${c.motivo}): ${c.texto}`),
      ...[...registro.diagnosticos.roteiro.map((d) => ({ ...d, fase: 'roteiro' })), ...(registro.diagnosticos.roteiro_reparo ?? []).map((d) => ({ ...d, fase: 'reparo' }))].map((d) => `- ${d.fase}: ${d.gravidade} ${d.codigo} — ${d.detalhe}`), ''] : []),
    `## Fontes citadas\n\nGerado: ${String(a.fontes.gerado.distintas)} (${a.fontes.gerado.titulos.join('; ') || 'nenhuma'}). ${a.fontes.esperado ? `Esperado: ${String(a.fontes.esperado.distintas)} (${a.fontes.esperado.titulos.join('; ') || 'nenhuma'}).` : ''}`,
    '',
  ];
  return partes.filter((p, i) => p !== '' || partes[i - 1] !== '').join('\n');
}
