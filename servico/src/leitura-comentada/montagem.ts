/**
 * Montagem determinística da leitura comentada (J92), sem banco: o capítulo em frases, os grifos e as
 * relações ancorados, e as pausas (uma por frase onde algo termina), cada uma com a descrição do que ela
 * comenta para o prompt. O Codex só escreve a fala de cada pausa; onde parar e o que comentar é daqui.
 *
 * Todos os grifos e todas as relações entram (decisão de produto): nenhum filtro por saliência, tipo ou
 * frequência. O que não se ancora no capítulo vira diagnóstico.
 */
import { createHash } from 'node:crypto';
import type { AncoraV1, Bloco, ElementoSemanticoV1, FonteDoComentarioV1, Id, MarcaV2, ModeloDoCapituloV1, TrechoLidoV1 } from '@margem/contratos';
import { focoDaRelacao, pausasDasFontes, trechosDoCapitulo, type FonteAncorada } from '@margem/core';

export interface Diagnostico { codigo: string; mensagem: string }

/** Uma pausa pronta para o prompt: o alias (`P001`), o trecho depois do qual entra e as fontes. */
export interface PausaDoEsboco {
  alias: string;
  depois_de: string;
  fontes: FonteDoComentarioV1[];
  foco: AncoraV1[];
  pontas: AncoraV1[];
  /** O que o prompt mostra desta pausa (as fontes, na ordem, com o que o dado diz). */
  descricao: string;
}

export interface EsbocoDaLeitura {
  trechos: TrechoLidoV1[];
  saltados: { bloco_id: Id; tipo: string }[];
  pausas: PausaDoEsboco[];
  fontes_hash: string;
  diagnosticos: Diagnostico[];
}

export interface EntradaDaMontagem {
  blocos: readonly Pick<Bloco, 'id' | 'tipo' | 'texto'>[];
  /** Grifos do capítulo: as marcas visíveis da camada da compreensão e os grifos do leitor. */
  grifos: readonly MarcaV2[];
  modelo: Pick<ModeloDoCapituloV1, 'elementos' | 'relacoes'>;
  /** Rótulo legível da função do grifo ("Conceito", "Tese"…), pelo modo. */
  rotuloDaFuncao?: (funcao: string) => string;
}

const uma = (texto: string, limite = 400): string => {
  const limpo = texto.replace(/\s+/gu, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
};
const VERBO_DA_RELACAO: Record<string, string> = {
  suporta: 'suporta', desenvolve: 'desenvolve', pressupoe: 'pressupõe', contrasta: 'contrasta com', exemplifica: 'exemplifica',
  retoma: 'retoma', responde: 'responde a', tensiona: 'tensiona', ecoa: 'ecoa',
};
/** "este trecho responde ao trecho anterior": o verbo da relação entre os dois lados, com a contração. */
function frase(sujeito: string, tipo: string, objeto: string): string {
  const verbo = VERBO_DA_RELACAO[tipo] ?? tipo;
  return verbo.endsWith(' a') && objeto.startsWith('o ') ? `${sujeito} ${verbo}o ${objeto.slice(2)}` : `${sujeito} ${verbo} ${objeto}`;
}

/** Só as marcas que o leitor mostra: visíveis e resolvidas, num bloco do capítulo. */
export function grifosDoCapitulo(marcas: readonly MarcaV2[], blocos: readonly Pick<Bloco, 'id'>[]): MarcaV2[] {
  const doCapitulo = new Set(blocos.map((bloco) => bloco.id));
  return marcas.filter((marca) => marca.visivel && marca.validade === 'resolvida' && doCapitulo.has(marca.ancora.bloco_id));
}

/** O hash das fontes: o mesmo conjunto de grifos e relações (e âncoras) dá a mesma leitura. */
export function hashDasFontes(grifos: readonly MarcaV2[], modelo: Pick<ModeloDoCapituloV1, 'id'>): string {
  const chaves = grifos.map((g) => [g.id, g.ancora.bloco_id, g.ancora.inicio_utf16, g.ancora.fim_utf16, g.funcao, g.comentario?.texto ?? ''].join('|')).sort();
  return createHash('sha256').update(JSON.stringify({ modelo: modelo.id, grifos: chaves })).digest('hex');
}

export function montarEsboco(entrada: EntradaDaMontagem, fontesHash: string): EsbocoDaLeitura {
  const diagnosticos: Diagnostico[] = [];
  const { trechos, saltados } = trechosDoCapitulo(entrada.blocos);
  if (trechos.length === 0) throw new Error('O capítulo não tem texto para ler.');
  const ordemDosBlocos = new Map(entrada.blocos.map((bloco, i) => [bloco.id, i]));
  const elementos = new Map(entrada.modelo.elementos.map((e) => [e.id, e]));
  const grifos = new Map(entrada.grifos.map((g) => [g.id, g]));
  const rotulo = entrada.rotuloDaFuncao ?? ((funcao: string) => funcao);

  const fontes: FonteAncorada[] = entrada.grifos.map((g) => ({ tipo: 'grifo', id: g.id, foco: g.ancora, ponta: null }));
  const relacoes = new Map(entrada.modelo.relacoes.map((r) => [r.id, r]));
  for (const relacao of entrada.modelo.relacoes) {
    const [a, b] = [elementos.get(relacao.origem_id)?.ancoras[0], elementos.get(relacao.destino_id)?.ancoras[0]];
    if (!a || !b) { diagnosticos.push({ codigo: 'relacao_sem_ponta', mensagem: `A relação ${relacao.id} aponta um elemento sem âncora; ficou de fora.` }); continue; }
    const lados = focoDaRelacao(ordemDosBlocos, a, b);
    if (!lados) { diagnosticos.push({ codigo: 'relacao_fora_do_capitulo', mensagem: `A relação ${relacao.id} não tem ponta neste capítulo; ficou de fora.` }); continue; }
    fontes.push({ tipo: 'relacao', id: relacao.id, foco: lados.foco, ponta: lados.ponta });
  }
  const { pausas, fora } = pausasDasFontes(trechos, entrada.blocos, fontes);
  for (const fonte of fora) diagnosticos.push({ codigo: 'fonte_fora_do_capitulo', mensagem: `${fonte.tipo} ${fonte.id} está ancorado fora do capítulo; ficou de fora.` });

  const textoDoTrecho = new Map(trechos.map((trecho, i) => [trecho.id, { trecho, i }]));
  const elementoDaAncora = (ancora: AncoraV1): ElementoSemanticoV1 | undefined => entrada.modelo.elementos.find((e) => e.ancoras[0] === ancora);
  const chaveDa = (a: AncoraV1): string => `${a.bloco_id}:${String(a.inicio_utf16)}:${String(a.fim_utf16)}`;
  /** Descreve a fonte; um trecho já mostrado nesta pausa é citado pela letra, não repetido. */
  const descrever = (fonte: FonteAncorada, letra: string, mostrados: Map<string, string>): string => {
    const jaMostrado = mostrados.get(chaveDa(fonte.foco));
    if (!jaMostrado) mostrados.set(chaveDa(fonte.foco), letra);
    if (fonte.tipo === 'grifo') {
      const g = grifos.get(fonte.id)!;
      const comentario = g.comentario ? `\n    Comentário (${g.comentario.rotulo || g.comentario.tipo}): “${uma(g.comentario.texto, 700)}”` : '\n    Sem comentário (grifo do leitor).';
      const trecho = jaMostrado ? `o mesmo de ${jaMostrado}` : `“${uma(g.ancora.citacao, 500)}”`;
      return `  - ${letra} · grifo · função: ${rotulo(g.funcao)}${g.comentario ? '' : ' · do leitor'}\n    Trecho grifado: ${trecho}${comentario}`;
    }
    const r = relacoes.get(fonte.id)!;
    const aqui = elementoDaAncora(fonte.foco);
    const la = fonte.ponta ? elementoDaAncora(fonte.ponta) : undefined;
    // O verbo da relação vai da origem ao destino; diz-se de que lado está cada um.
    const origemAqui = r.origem_id === aqui?.id;
    const distancia = fonte.ponta ? distanciaEmTrechos(fonte.ponta, fonte.foco) : null;
    const esteTrecho = jaMostrado ? `o mesmo de ${jaMostrado}` : `“${uma(fonte.foco.citacao, 300)}”${aqui ? ` — ${uma(aqui.enunciado, 300)}` : ''}`;
    return [
      `  - ${letra} · relação · ${frase(origemAqui ? 'este trecho' : 'o trecho anterior', r.tipo, origemAqui ? 'o trecho anterior' : 'este trecho')}${r.retrospectiva ? ' (só se vê com o capítulo inteiro)' : ''}`,
      `    Explicação: “${uma(r.explicacao, 600)}”`,
      `    Este trecho: ${esteTrecho}`,
      `    O trecho anterior${distancia ?? ''}: “${uma(fonte.ponta?.citacao ?? '', 300)}”${la ? ` — ${uma(la.enunciado, 300)}` : ''}`,
    ].join('\n');
  };
  function distanciaEmTrechos(de: AncoraV1, ate: AncoraV1): string {
    const [pa, pb] = [ordemDosBlocos.get(de.bloco_id), ordemDosBlocos.get(ate.bloco_id)];
    if (pa === undefined || pb === undefined) return '';
    const blocos = pb - pa;
    if (blocos <= 0) return ' (na mesma passagem)';
    if (blocos <= 2) return ' (logo antes)';
    return ` (${String(blocos)} blocos antes)`;
  }

  const esboco: PausaDoEsboco[] = pausas.map((pausa, i) => {
    const alias = `P${String(i + 1).padStart(3, '0')}`;
    const { trecho, i: indice } = textoDoTrecho.get(pausa.depois_de)!;
    const anterior = indice > 0 ? trechos[indice - 1]! : null;
    const linhas = [`### ${alias}`, `A leitura para depois de: “${uma(trecho.texto, 600)}”`];
    if (anterior && anterior.bloco_id === trecho.bloco_id) linhas.push(`(Logo antes: “${uma(anterior.texto, 300)}”)`);
    linhas.push('Comenta:');
    const mostrados = new Map<string, string>();
    pausa.fontes.forEach((fonte, j) => linhas.push(descrever(fonte, String.fromCharCode(97 + (j % 26)), mostrados)));
    const pontas = pausa.fontes.flatMap((f) => (f.ponta ? [f.ponta] : []));
    return {
      alias, depois_de: pausa.depois_de, fontes: pausa.fontes.map((f) => ({ tipo: f.tipo, id: f.id })),
      foco: unicas(pausa.fontes.map((f) => f.foco)), pontas: unicas(pontas), descricao: linhas.join('\n'),
    };
  });
  return { trechos, saltados, pausas: esboco, fontes_hash: fontesHash, diagnosticos };
}

function unicas(ancoras: readonly AncoraV1[]): AncoraV1[] {
  const vistas = new Set<string>();
  return ancoras.filter((a) => {
    const chave = `${a.bloco_id}:${String(a.inicio_utf16)}:${String(a.fim_utf16)}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}
