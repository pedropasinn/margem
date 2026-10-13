/**
 * Layout do esquema do capítulo: cada parte (grupo) vira uma faixa; dentro dela, o ELK (algoritmo em
 * camadas) arruma as caixas e as setas internas, da esquerda para a direita na tela larga e de cima
 * para baixo no telefone. As faixas se empilham de cima para baixo e as setas entre elas são nossas
 * (pelo vão entre faixas ou por uma raia à direita). O desenho é nosso (SVG em React, sem
 * `innerHTML`). O ELK já vem instalado como dependência do Mermaid e é carregado sob demanda, num
 * chunk próprio.
 *
 * Os rótulos são quebrados aqui, com a mesma fonte do desenho medida num canvas (ou uma estimativa
 * sem canvas, nos testes), para que a caixa tenha o tamanho do texto que ela vai mostrar.
 */
import type { EsquemaDoCapituloV1, NoDoEsquemaV1, TipoDoNoDoEsquema } from '@margem/contratos';

export interface Ponto { x: number; y: number }
export interface Medidas {
  /** Largura máxima do texto de um nó. */
  larguraDoTexto: number;
  fonte: number;
  linha: number;
}
export const MEDIDAS_LARGAS: Medidas = { larguraDoTexto: 176, fonte: 14, linha: 18 };
export const MEDIDAS_ESTREITAS: Medidas = { larguraDoTexto: 138, fonte: 13.5, linha: 17 };

/** Folga horizontal de cada forma além do texto (o ícone ocupa a primeira linha à esquerda). */
const FOLGA: Record<TipoDoNoDoEsquema, number> = { tese: 34, conclusao: 34, questao: 40, contraste: 28, conceito: 24, mecanismo: 34, exemplo: 24 };
export const ICONE = 16;
export const ESPACO_DO_ICONE = ICONE + 7;
const PADDING_V = 12;
const FAMILIA = '"Figtree Variable", Figtree, system-ui, sans-serif';

export interface NoPosicionado {
  no: NoDoEsquemaV1;
  x: number; y: number; largura: number; altura: number;
  linhas: string[];
  /** Largura do bloco ícone + texto, para centralizar na forma. */
  bloco: number;
}
export interface GrupoPosicionado { id: string; indice: number; titulo: string; resumo?: string; x: number; y: number; largura: number; altura: number }
export interface LigacaoPosicionada {
  id: string; de: string; para: string; rotulo?: string; forca: 'forte' | 'fraca';
  pontos: Ponto[];
  /** Seta que pula faixas pela raia da direita: o rótulo só aparece com o nó aceso. */
  raia?: boolean;
  etiqueta?: { x: number; y: number; largura: number; altura: number };
}
export interface LayoutDoEsquema { largura: number; altura: number; grupos: GrupoPosicionado[]; nos: NoPosicionado[]; ligacoes: LigacaoPosicionada[] }

// ---------------------------------------------------------------- texto

type Medidor = (texto: string, fonte: number, peso: number) => number;

let contexto: CanvasRenderingContext2D | null | undefined;
/** Mede com canvas quando há (navegador); senão estima (jsdom). */
export const medirTexto: Medidor = (texto, fonte, peso) => {
  if (contexto === undefined) {
    // No jsdom (testes) não há canvas: fica a estimativa.
    const semCanvas = typeof document === 'undefined' || (typeof navigator !== 'undefined' && /jsdom/iu.test(navigator.userAgent));
    try { contexto = semCanvas ? null : document.createElement('canvas').getContext('2d'); } catch { contexto = null; }
  }
  if (contexto) {
    contexto.font = `${String(peso)} ${String(fonte)}px ${FAMILIA}`;
    const largura = contexto.measureText(texto).width;
    if (largura > 0) return largura;
  }
  return texto.length * fonte * 0.54;
};

/** Quebra por palavras até a largura; uma palavra maior que a linha fica sozinha. */
export function quebrarLinhas(texto: string, largura: number, fonte: number, medir: Medidor = medirTexto, peso = 600): string[] {
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/u).filter(Boolean)) {
    const tentativa = atual === '' ? palavra : `${atual} ${palavra}`;
    if (atual !== '' && medir(tentativa, fonte, peso) > largura) { linhas.push(atual); atual = palavra; } else atual = tentativa;
  }
  if (atual !== '') linhas.push(atual);
  return linhas.length > 0 ? linhas : [''];
}

export function tamanhoDoNo(no: Pick<NoDoEsquemaV1, 'rotulo' | 'tipo'>, medidas: Medidas, medir: Medidor = medirTexto): { largura: number; altura: number; linhas: string[]; bloco: number } {
  const linhas = quebrarLinhas(no.rotulo, medidas.larguraDoTexto - ESPACO_DO_ICONE, medidas.fonte, medir);
  const texto = Math.max(...linhas.map((linha) => medir(linha, medidas.fonte, 600)));
  const largura = Math.ceil(Math.max(128, texto + ESPACO_DO_ICONE + FOLGA[no.tipo]));
  const altura = Math.ceil(Math.max(44, linhas.length * medidas.linha + PADDING_V * 2));
  return { largura, altura, linhas, bloco: Math.ceil(texto + ESPACO_DO_ICONE) };
}

// ---------------------------------------------------------------- ELK

interface NoElk { id: string; x?: number; y?: number; width?: number; height?: number; children?: NoElk[]; layoutOptions?: Record<string, string>; edges?: ArestaElk[] }
interface ArestaElk {
  id: string; sources: string[]; targets: string[]; container?: string;
  labels?: { text: string; width: number; height: number; x?: number; y?: number }[];
  sections?: { startPoint: Ponto; endPoint: Ponto; bendPoints?: Ponto[] }[];
}
export interface MotorDeLayout { layout: (grafo: NoElk) => Promise<NoElk> }

/** O ELK, carregado uma vez e sob demanda. */
let motor: Promise<MotorDeLayout> | null = null;
export function carregarElk(): Promise<MotorDeLayout> {
  motor ??= import('elkjs/lib/elk.bundled.js').then((modulo) => new modulo.default() as unknown as MotorDeLayout);
  return motor;
}

const ETIQUETA = { fonte: 11.5, altura: 20, folga: 14 };
/** Faixa: espaço do título em cima, margens, e o vão entre faixas. */
const FAIXA = { topo: 54, lado: 28, base: 26, vao: 44, porLigacao: 16, raia: 16 };

export type Direcao = 'RIGHT' | 'DOWN';
interface Texto { linhas: string[]; bloco: number }

/** Um grafo por grupo (só as ligações internas): cada faixa é arrumada sozinha, na direção pedida. */
export function grafosDosGrupos(esquema: EsquemaDoCapituloV1, medidas: Medidas, direcao: Direcao, medir: Medidor = medirTexto): { grafos: NoElk[]; textos: Map<string, Texto> } {
  const textos = new Map<string, Texto>();
  const grupoDo = new Map(esquema.nos.map((no) => [no.id, no.grupo_id]));
  const grafos = esquema.grupos.map((grupo): NoElk => {
    const children = esquema.nos.filter((no) => no.grupo_id === grupo.id).map((no) => {
      const tamanho = tamanhoDoNo(no, medidas, medir);
      textos.set(no.id, { linhas: tamanho.linhas, bloco: tamanho.bloco });
      return { id: no.id, width: tamanho.largura, height: tamanho.altura };
    });
    const edges: ArestaElk[] = esquema.ligacoes.flatMap((ligacao, i) => grupoDo.get(ligacao.de) === grupo.id && grupoDo.get(ligacao.para) === grupo.id
      ? [{ id: `l${String(i)}`, sources: [ligacao.de], targets: [ligacao.para],
        ...(ligacao.rotulo ? { labels: [{ text: ligacao.rotulo, width: Math.ceil(medir(ligacao.rotulo, ETIQUETA.fonte, 500)) + ETIQUETA.folga, height: ETIQUETA.altura }] } : {}) }]
      : []);
    return {
      id: grupo.id, children, edges,
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': direcao, 'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': direcao === 'RIGHT' ? '40' : '36', 'elk.spacing.nodeNode': '28',
        'elk.spacing.edgeNode': '14', 'elk.spacing.edgeEdge': '10', 'elk.layered.spacing.edgeNodeBetweenLayers': '14', 'elk.spacing.edgeLabel': '4',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.edgeLabels.placement': 'CENTER', 'elk.padding': '[top=0,left=0,bottom=0,right=0]', 'elk.spacing.componentComponent': '28',
      },
    };
  });
  return { grafos, textos };
}

/**
 * Junta as faixas de cima para baixo, na ordem dos grupos, todas da mesma largura, e desenha as
 * setas entre faixas: da base do nó de origem ao topo do nó de destino, pelo vão entre elas (faixas
 * vizinhas) ou por uma raia à direita (saltos e voltas), sem atravessar caixas.
 */
export function montarFaixas(esquema: EsquemaDoCapituloV1, resultados: readonly NoElk[], textos: ReadonlyMap<string, Texto>, medir: Medidor = medirTexto): LayoutDoEsquema {
  const indiceDo = new Map(esquema.grupos.map((grupo, i) => [grupo.id, i]));
  const noPorId = new Map(esquema.nos.map((no) => [no.id, no]));
  const cruzadas = esquema.ligacoes.map((ligacao, i) => ({ ligacao, i, de: indiceDo.get(noPorId.get(ligacao.de)?.grupo_id ?? '') ?? -1, para: indiceDo.get(noPorId.get(ligacao.para)?.grupo_id ?? '') ?? -1 }))
    .filter((item) => item.de !== item.para && item.de >= 0 && item.para >= 0);
  const conteudo = resultados.map((r) => ({ largura: r.width ?? 0, altura: r.height ?? 0 }));
  const titulo = (i: number) => medir(esquema.grupos[i]?.titulo ?? '', 14, 700) + 60;
  const largura = Math.ceil(Math.max(...conteudo.map((c, i) => Math.max(c.largura + FAIXA.lado * 2, titulo(i)))));
  const grupos: GrupoPosicionado[] = [];
  const nos: NoPosicionado[] = [];
  const ligacoes: LigacaoPosicionada[] = [];
  const posicao = new Map<string, NoPosicionado>();
  const etiquetaEm = (rotulo: string | undefined, cx: number, cy: number) => {
    if (!rotulo) return {};
    const l = Math.ceil(medir(rotulo, ETIQUETA.fonte, 500)) + ETIQUETA.folga;
    return { etiqueta: { x: cx - l / 2, y: cy - ETIQUETA.altura / 2, largura: l, altura: ETIQUETA.altura } };
  };
  let y = 0;
  resultados.forEach((resultado, indice) => {
    const dados = esquema.grupos[indice]!;
    const altura = FAIXA.topo + conteudo[indice]!.altura + FAIXA.base;
    grupos.push({ id: dados.id, indice, titulo: dados.titulo, ...(dados.resumo ? { resumo: dados.resumo } : {}), x: 0, y, largura, altura });
    const ox = (largura - conteudo[indice]!.largura) / 2;
    const oy = y + FAIXA.topo;
    for (const filho of resultado.children ?? []) {
      const no = noPorId.get(filho.id);
      if (!no) continue;
      const texto = textos.get(no.id);
      const item = { no, x: ox + (filho.x ?? 0), y: oy + (filho.y ?? 0), largura: filho.width ?? 0, altura: filho.height ?? 0,
        linhas: texto?.linhas ?? [no.rotulo], bloco: texto?.bloco ?? (filho.width ?? 0) - 24 };
      nos.push(item); posicao.set(no.id, item);
    }
    for (const aresta of resultado.edges ?? []) {
      const ligacao = esquema.ligacoes[Number(aresta.id.slice(1))];
      const secao = aresta.sections?.[0];
      if (!ligacao || !secao) continue;
      const mover = (ponto: Ponto): Ponto => ({ x: ox + ponto.x, y: oy + ponto.y });
      const pontos = [secao.startPoint, ...(secao.bendPoints ?? []), secao.endPoint].map(mover);
      // O ELK reserva o espaço do rótulo; o rótulo vai no meio do trecho mais longo, sobre a linha.
      const meio = meioDoTrechoMaisLongo(pontos);
      ligacoes.push({
        id: aresta.id, de: ligacao.de, para: ligacao.para, forca: ligacao.forca ?? 'forte', ...(ligacao.rotulo ? { rotulo: ligacao.rotulo } : {}),
        pontos, ...etiquetaEm(ligacao.rotulo, meio.x, meio.y),
      });
    }
    y += altura + FAIXA.vao + Math.max(0, cruzadas.filter((item) => item.de === indice && item.para === indice + 1).length - 1) * FAIXA.porLigacao;
  });
  // Quem tem caixa abaixo (ou acima, ou à direita) na mesma faixa não pode sair (ou entrar) por ali.
  const naMesmaFaixa = (item: NoPosicionado) => nos.filter((outro) => outro !== item && outro.no.grupo_id === item.no.grupo_id);
  const cruzaX = (a: NoPosicionado, b: NoPosicionado) => a.x < b.x + b.largura && b.x < a.x + a.largura;
  const cruzaY = (a: NoPosicionado, b: NoPosicionado) => a.y < b.y + b.altura && b.y < a.y + a.altura;
  const livreAbaixo = (item: NoPosicionado) => naMesmaFaixa(item).every((outro) => !(outro.y > item.y && cruzaX(item, outro)));
  const livreAcima = (item: NoPosicionado) => naMesmaFaixa(item).every((outro) => !(outro.y < item.y && cruzaX(item, outro)));
  const livreADireita = (item: NoPosicionado) => naMesmaFaixa(item).every((outro) => !(outro.x > item.x && cruzaY(item, outro)));
  const diretas = cruzadas.filter((item) => {
    const origem = posicao.get(item.ligacao.de); const destino = posicao.get(item.ligacao.para);
    return item.para === item.de + 1 && origem !== undefined && destino !== undefined && livreAbaixo(origem) && livreAcima(destino);
  });
  // Vãos entre faixas vizinhas: cada seta desce, anda na horizontal num nível próprio e desce ao destino.
  esquema.grupos.forEach((_grupo, vao) => {
    const setas = diretas.filter((item) => item.de === vao);
    const cima = grupos[vao]; const baixo = grupos[vao + 1];
    if (!cima || !baixo) return;
    const topoDoVao = cima.y + cima.altura; const altura = baixo.y - topoDoVao;
    setas.forEach((item, k) => {
      const origem = posicao.get(item.ligacao.de)!; const destino = posicao.get(item.ligacao.para)!;
      const sx = origem.x + origem.largura / 2; const sy = origem.y + origem.altura;
      const tx = destino.x + destino.largura / 2; const ty = destino.y;
      const nivel = topoDoVao + altura * (k + 1) / (setas.length + 1);
      const pontos = Math.abs(sx - tx) < 1 ? [{ x: sx, y: sy }, { x: tx, y: ty }] : [{ x: sx, y: sy }, { x: sx, y: nivel }, { x: tx, y: nivel }, { x: tx, y: ty }];
      ligacoes.push({ id: `l${String(item.i)}`, de: item.ligacao.de, para: item.ligacao.para, forca: item.ligacao.forca ?? 'forte',
        ...(item.ligacao.rotulo ? { rotulo: item.ligacao.rotulo } : {}), pontos, ...etiquetaEm(item.ligacao.rotulo, (sx + tx) / 2, nivel) });
    });
  });
  // As outras (saltos, voltas, e quem tem caixa no caminho) vão por uma raia à direita das faixas: saem pela
  // base (ou pelo lado direito, numa coluna) e entram pelo alto do destino (ou pelo lado direito).
  const saltos = cruzadas.filter((item) => !diretas.includes(item));
  saltos.forEach((item, k) => {
    const origem = posicao.get(item.ligacao.de); const destino = posicao.get(item.ligacao.para);
    const faixaDe = grupos[item.de]; const faixaPara = grupos[item.para];
    if (!origem || !destino || !faixaDe || !faixaPara) return;
    const raia = largura + FAIXA.raia * (k + 1);
    const sx = origem.x + origem.largura / 2; const tx = destino.x + destino.largura / 2;
    const saida: Ponto[] = livreAbaixo(origem) || !livreADireita(origem)
      ? (() => { const base = faixaDe.y + faixaDe.altura - 9 - (k % 3) * 4; return [{ x: sx, y: origem.y + origem.altura }, { x: sx, y: base }, { x: raia, y: base }]; })()
      : [{ x: origem.x + origem.largura, y: origem.y + origem.altura / 2 }, { x: raia, y: origem.y + origem.altura / 2 }];
    const entrada: Ponto[] = livreAcima(destino) || !livreADireita(destino)
      ? (() => { const alto = faixaPara.y + FAIXA.topo - 12 + (k % 3) * 3; return [{ x: raia, y: alto }, { x: tx, y: alto }, { x: tx, y: destino.y }]; })()
      : [{ x: raia, y: destino.y + destino.altura / 2 }, { x: destino.x + destino.largura, y: destino.y + destino.altura / 2 }];
    ligacoes.push({ id: `l${String(item.i)}`, de: item.ligacao.de, para: item.ligacao.para, forca: item.ligacao.forca ?? 'fraca', raia: true,
      ...(item.ligacao.rotulo ? { rotulo: item.ligacao.rotulo } : {}), pontos: [...saida, ...entrada],
      ...etiquetaEm(item.ligacao.rotulo, raia, (saida.at(-1)!.y + entrada[0]!.y) / 2) });
  });
  return { largura: largura + (saltos.length > 0 ? FAIXA.raia * (saltos.length + 1) : 0), altura: y - FAIXA.vao, grupos, nos, ligacoes };
}

export async function calcularLayout(esquema: EsquemaDoCapituloV1, medidas: Medidas, elk: MotorDeLayout, direcao: Direcao = 'RIGHT', medir: Medidor = medirTexto): Promise<LayoutDoEsquema> {
  const { grafos, textos } = grafosDosGrupos(esquema, medidas, direcao, medir);
  const resultados = await Promise.all(grafos.map((grafo) => elk.layout(grafo)));
  return montarFaixas(esquema, resultados, textos, medir);
}

/** O meio do trecho mais longo de uma poligonal. */
export function meioDoTrechoMaisLongo(pontos: readonly Ponto[]): Ponto {
  let melhor = { x: pontos[0]?.x ?? 0, y: pontos[0]?.y ?? 0 };
  let maior = -1;
  for (let i = 1; i < pontos.length; i += 1) {
    const a = pontos[i - 1]!; const b = pontos[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > maior) { maior = d; melhor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  }
  return melhor;
}

/** Caminho com cantos arredondados pelos pontos da seta. */
export function caminhoArredondado(pontos: readonly Ponto[], raio = 10): string {
  if (pontos.length === 0) return '';
  const partes = [`M ${fmt(pontos[0]!.x)} ${fmt(pontos[0]!.y)}`];
  for (let i = 1; i < pontos.length; i += 1) {
    const atual = pontos[i]!;
    const proximo = pontos[i + 1];
    if (!proximo) { partes.push(`L ${fmt(atual.x)} ${fmt(atual.y)}`); break; }
    const anterior = pontos[i - 1]!;
    const r = Math.min(raio, distancia(anterior, atual) / 2, distancia(atual, proximo) / 2);
    const entrada = rumo(atual, anterior, r);
    const saida = rumo(atual, proximo, r);
    partes.push(`L ${fmt(entrada.x)} ${fmt(entrada.y)}`, `Q ${fmt(atual.x)} ${fmt(atual.y)} ${fmt(saida.x)} ${fmt(saida.y)}`);
  }
  return partes.join(' ');
}
const distancia = (a: Ponto, b: Ponto): number => Math.hypot(b.x - a.x, b.y - a.y);
function rumo(de: Ponto, para: Ponto, r: number): Ponto {
  const d = distancia(de, para) || 1;
  return { x: de.x + (para.x - de.x) * r / d, y: de.y + (para.y - de.y) * r / d };
}
const fmt = (valor: number): string => String(Math.round(valor * 10) / 10);

/** Contorno da forma de cada tipo, no retângulo (0,0)–(l,a). */
export function formaDoNo(tipo: TipoDoNoDoEsquema, l: number, a: number): { tipo: 'rect'; rx: number } | { tipo: 'polygon'; pontos: string } {
  if (tipo === 'tese' || tipo === 'conclusao') return { tipo: 'rect', rx: a / 2 };
  if (tipo === 'questao') {
    const ponta = Math.min(18, a / 2);
    return { tipo: 'polygon', pontos: [[ponta, 0], [l - ponta, 0], [l, a / 2], [l - ponta, a], [ponta, a], [0, a / 2]].map(([x, y]) => `${fmt(x!)},${fmt(y!)}`).join(' ') };
  }
  if (tipo === 'mecanismo') return { tipo: 'rect', rx: 4 };
  return { tipo: 'rect', rx: 12 };
}
