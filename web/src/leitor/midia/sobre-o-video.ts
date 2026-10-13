/**
 * O que aparece sobre o vídeo (noite2/video-popups), em funções puras:
 *
 * - as legendas dos grifos: cada marca do texto que a fala cobre vira uma ou mais linhas de legenda,
 *   com o tempo das próprias palavras (as do alinhamento da transcrição);
 * - o relógio dos cartões de conceito: qual cartão entra no instante e quanto falta para ele fechar;
 * - a pílula do conceito: o rótulo curto, a cor (a do grifo que contém o trecho), o setor do
 *   timer-pizza e a região do quadro onde ela aparece (a menos ocupada do rodapé, medida num
 *   quadro reduzido do próprio vídeo).
 */
import type { ConceitoDoVideoV1, Id, TrechoTemporizado } from '@margem/contratos';

export interface LinhaDeLegenda {
  marca_id: Id;
  palavras: { texto: string; inicio_s: number }[];
  inicio_s: number;
  fim_s: number;
}

interface MarcaComAncora { id: Id; visivel?: boolean; ancora: { bloco_id: Id; inicio_utf16: number; fim_utf16: number } }

/** Uma linha de legenda não passa disto; quebra antes na pontuação, se a linha já tiver corpo. */
export const PALAVRAS_POR_LINHA = 12;
const FIM_DE_FRASE = /[.!?;:…]["'”’»)\]]*$/u;
const VIRGULA = /,["'”’»)\]]*$/u;
const quebraDepois = (pedaco: string, n: number): boolean => n >= PALAVRAS_POR_LINHA || (n >= 5 && FIM_DE_FRASE.test(pedaco)) || (n >= 8 && VIRGULA.test(pedaco));
/** A linha aparece um pouco antes da primeira palavra e fica um pouco depois da última. */
export const ANTECIPA_S = 0.15;
export const SEGURA_S = 0.9;

export function linhasDosGrifos(marcas: readonly MarcaComAncora[], blocos: readonly { id: Id; texto: string }[], palavras: readonly TrechoTemporizado[]): LinhaDeLegenda[] {
  const textos = new Map(blocos.map((b) => [b.id, b.texto]));
  const porBloco = new Map<Id, TrechoTemporizado[]>();
  for (const p of palavras) {
    const lista = porBloco.get(p.bloco_id);
    if (lista) lista.push(p); else porBloco.set(p.bloco_id, [p]);
  }
  const linhas: LinhaDeLegenda[] = [];
  for (const marca of marcas) {
    if (marca.visivel === false) continue;
    const { bloco_id, inicio_utf16: inicio, fim_utf16: fim } = marca.ancora;
    const texto = textos.get(bloco_id);
    const faladas = (porBloco.get(bloco_id) ?? []).filter((p) => p.inicio_utf16 < fim && p.fim_utf16 > inicio);
    if (texto === undefined || faladas.length === 0) continue;
    let atual = null as LinhaDeLegenda | null;
    faladas.forEach((p, i) => {
      // Só o pedaço que o grifo cobre (ele pode começar ou terminar no meio da palavra), com a
      // pontuação colada à palavra (a palavra com tempo pode ter vindo sem ela).
      const teto = Math.min(fim, faladas[i + 1]?.inicio_utf16 ?? fim);
      let ponta = Math.min(teto, p.fim_utf16);
      while (ponta < teto && !/\s/u.test(texto[ponta]!)) ponta++;
      const pedaco = texto.slice(Math.max(inicio, p.inicio_utf16), ponta).trim();
      if (pedaco === '') return;
      atual ??= { marca_id: marca.id, palavras: [], inicio_s: p.inicio_s, fim_s: p.fim_s };
      atual.palavras.push({ texto: pedaco, inicio_s: p.inicio_s });
      atual.fim_s = Math.max(atual.fim_s, p.fim_s);
      if (quebraDepois(pedaco, atual.palavras.length)) { linhas.push(atual); atual = null; }
    });
    if (atual) linhas.push(atual);
  }
  return linhas.sort((a, b) => a.inicio_s - b.inicio_s);
}

/** A linha do instante: entre as que valem agora, a que começou por último (a fala mais recente). */
export function linhaNoInstante(linhas: readonly LinhaDeLegenda[], t: number): LinhaDeLegenda | null {
  let escolhida: LinhaDeLegenda | null = null;
  for (const linha of linhas) {
    if (linha.inicio_s - ANTECIPA_S > t) break;
    if (t <= linha.fim_s + SEGURA_S) escolhida = linha;
  }
  return escolhida;
}

// ---------------------------------------------------------------- cartões de conceito

/** Quanto o cartão fica na tela (com o relógio correndo) antes de voltar a ser bolinha. */
export const DURACAO_DO_CARTAO_MS = 15_000;
/** Até quanto depois do instante o cartão ainda entra (quem chega pulando no meio também vê). */
export const JANELA_DE_ENTRADA_S = 4;

/** O próximo cartão a entrar no instante `t`, dos que ainda não foram vistos. */
export function conceitoQueEntra(conceitos: readonly ConceitoDoVideoV1[], t: number, vistos: ReadonlySet<Id>): ConceitoDoVideoV1 | null {
  return conceitos.find((c) => !vistos.has(c.id) && t >= c.instante_s && t < c.instante_s + JANELA_DE_ENTRADA_S) ?? null;
}

/** Voltar o vídeo para antes de um cartão faz ele valer de novo. */
export function esquecerOsAdiante(vistos: ReadonlySet<Id>, conceitos: readonly ConceitoDoVideoV1[], t: number): Set<Id> {
  const restantes = new Set(vistos);
  for (const c of conceitos) if (t < c.instante_s - 0.5) restantes.delete(c.id);
  return restantes;
}

// ---------------------------------------------------------------- pílula: rótulo e cor

/** O rótulo da pílula não passa disto (o mesmo teto que o serviço confere em `curto`). */
export const MAXIMO_DO_CURTO = 20;
const PERGUNTA = /^(?:o\s+que\s+(?:é|são|foi|foram|era|eram|significa)|o\s+que|como\s+funcionam?|quem\s+(?:é|são|foi|foram|era)|para\s+que\s+servem?|por\s+que|qual\s+(?:é|era)|quais\s+(?:são|eram))\s+/iu;
const ARTIGO = /^(?:o|a|os|as|um|uma|uns|umas)\s+/iu;

/**
 * O rótulo curto derivado do título, para os conceitos antigos (sem `curto`): tira a pergunta
 * ("O que é um", "Como funciona o"…), o parêntese e a pontuação final, e fica com até 3 palavras
 * que caibam em 20 caracteres.
 */
export function derivarCurto(titulo: string): string {
  let t = titulo.replace(/\s+/gu, ' ').trim().replace(/\s*\([^)]*\)\s*/gu, ' ').trim();
  t = t.replace(PERGUNTA, '').replace(ARTIGO, '').replace(/[?!.:;,…]+$/u, '').trim();
  if (t === '') return titulo.trim().slice(0, MAXIMO_DO_CURTO);
  const palavras = t.split(' ');
  let curto = palavras[0]!;
  for (const p of palavras.slice(1, 3)) {
    if (`${curto} ${p}`.length > MAXIMO_DO_CURTO) break;
    curto = `${curto} ${p}`;
  }
  // Uma palavra só, comprida demais: corta com reticências.
  if (curto.length > MAXIMO_DO_CURTO) curto = `${curto.slice(0, MAXIMO_DO_CURTO - 1)}…`;
  // Tira uma preposição que tenha sobrado na ponta ("Teto de" → "Teto").
  curto = curto.replace(/\s+(?:de|da|do|das|dos|e|em|para|por|com)$/iu, '');
  return curto.charAt(0).toLocaleUpperCase('pt-BR') + curto.slice(1);
}

export function rotuloCurto(conceito: Pick<ConceitoDoVideoV1, 'titulo' | 'curto'>): string {
  const curto = conceito.curto?.trim();
  return curto ? curto : derivarCurto(conceito.titulo);
}

/** A marca do leitor que cobre o trecho do conceito (a de maior sobreposição), ou nenhuma. */
export function marcaDoConceito<M extends MarcaComAncora>(conceito: Pick<ConceitoDoVideoV1, 'ancora'>, marcas: readonly M[]): M | null {
  const { bloco_id, inicio_utf16: inicio, fim_utf16: fim } = conceito.ancora;
  let melhor: M | null = null;
  let maior = 0;
  for (const m of marcas) {
    if (m.visivel === false || m.ancora.bloco_id !== bloco_id) continue;
    const sobreposicao = Math.min(fim, m.ancora.fim_utf16) - Math.max(inicio, m.ancora.inicio_utf16);
    if (sobreposicao > maior) { maior = sobreposicao; melhor = m; }
  }
  return melhor;
}

/** Até quanto antes ou depois do conceito um grifo ainda empresta a cor à pílula. */
export const VIZINHANCA_DA_COR_S = 30;

/**
 * A marca que dá a cor à pílula: a que cobre o trecho do conceito; senão, a do grifo falado mais
 * perto no tempo (pela distância do instante ao intervalo da linha de legenda), dentro de ±30 s.
 * Nenhuma: a pílula fica na cor de destaque.
 */
export function marcaDaCor<M extends MarcaComAncora>(conceito: Pick<ConceitoDoVideoV1, 'ancora' | 'instante_s'>, marcas: readonly M[], linhas: readonly Pick<LinhaDeLegenda, 'marca_id' | 'inicio_s' | 'fim_s'>[]): M | null {
  const dentro = marcaDoConceito(conceito, marcas);
  if (dentro) return dentro;
  const porId = new Map(marcas.filter((m) => m.visivel !== false).map((m) => [m.id, m]));
  let melhor: M | null = null;
  let menor = Infinity;
  for (const l of linhas) {
    const marca = porId.get(l.marca_id);
    if (!marca) continue;
    const distancia = Math.max(0, l.inicio_s - conceito.instante_s, conceito.instante_s - l.fim_s);
    if (distancia <= VIZINHANCA_DA_COR_S && distancia < menor) { menor = distancia; melhor = marca; }
  }
  return melhor;
}

/**
 * O setor do timer-pizza: a fatia que já passou, a partir do meio-dia em sentido horário, num
 * círculo de centro (12, 12) e raio `r` (viewBox 24 × 24). Vazia no início; no fim, o círculo inteiro.
 */
export function setorDaPizza(passou: number, r = 10): string {
  const f = Math.min(1, Math.max(0, passou));
  if (f <= 0) return '';
  const n = (v: number): string => String(Math.round(v * 1000) / 1000);
  if (f >= 1) return `M12 ${n(12 - r)}A${n(r)} ${n(r)} 0 1 1 11.999 ${n(12 - r)}Z`;
  const angulo = f * 2 * Math.PI;
  const x = 12 + r * Math.sin(angulo);
  const y = 12 - r * Math.cos(angulo);
  return `M12 12L12 ${n(12 - r)}A${n(r)} ${n(r)} 0 ${f > 0.5 ? 1 : 0} 1 ${n(x)} ${n(y)}Z`;
}

// ---------------------------------------------------------------- pílula: onde no quadro

export type RegiaoDaPilula = 'baixo-esquerda' | 'baixo-centro' | 'baixo-direita' | 'cima';
export type OcupacaoDoQuadro = Record<RegiaoDaPilula, number>;
/** Ordem de preferência em empate: os cantos antes do centro (onde costuma estar o rosto). */
const RODAPE: readonly RegiaoDaPilula[] = ['baixo-esquerda', 'baixo-direita', 'baixo-centro'];
export const REGIAO_PADRAO: RegiaoDaPilula = 'baixo-esquerda';
/** O centro do rodapé pesa mais: é onde costuma estar o rosto ou o assunto. */
export const PESO_DO_CENTRO = 1.35;
/**
 * Acima disto, o rodapé está "ocupado" (medido em quadros dos vídeos do Ulrich: rodapé com pessoa ou
 * cenário fica em 0,13–0,23; com faixa de anúncio, acima). Só então a pílula sobe, e só se o alto
 * estiver bem mais livre (menos de 40% da ocupação do melhor lugar do rodapé).
 */
export const LIMIAR_DE_OCUPADO = 0.15;
const ALTO_BEM_MAIS_LIVRE = 0.4;

/**
 * Quanto cada região do quadro está "ocupada": a média do gradiente da luminância (bordas) mais a
 * metade do desvio-padrão (contraste), de 0 a ~1. `pixels` é RGBA (`ImageData.data`), de um quadro
 * reduzido (64 × 36). O rodapé é o terço de baixo, em três colunas; "cima" é o canto de cima à
 * esquerda, onde a pílula iria.
 */
export function ocupacaoDoQuadro(pixels: ArrayLike<number>, largura: number, altura: number): OcupacaoDoQuadro {
  const lum = new Float32Array(largura * altura);
  for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * pixels[i * 4]! + 0.7152 * pixels[i * 4 + 1]! + 0.0722 * pixels[i * 4 + 2]!) / 255;
  const medir = (x0: number, x1: number, y0: number, y1: number): number => {
    let soma = 0, quadrados = 0, bordas = 0, n = 0, vizinhos = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = lum[y * largura + x]!;
      soma += v; quadrados += v * v; n++;
      if (x + 1 < largura) { bordas += Math.abs(lum[y * largura + x + 1]! - v); vizinhos++; }
      if (y + 1 < altura) { bordas += Math.abs(lum[(y + 1) * largura + x]! - v); vizinhos++; }
    }
    if (n === 0) return 0;
    const media = soma / n;
    return (vizinhos === 0 ? 0 : (2 * bordas) / vizinhos) + 0.5 * Math.sqrt(Math.max(0, quadrados / n - media * media));
  };
  const terco = Math.round(largura / 3);
  const topoDoRodape = Math.round(altura * 0.66);
  const fundoDoTopo = Math.round(altura * 0.3);
  return {
    'baixo-esquerda': medir(0, terco, topoDoRodape, altura),
    'baixo-centro': medir(terco, largura - terco, topoDoRodape, altura) * PESO_DO_CENTRO,
    'baixo-direita': medir(largura - terco, largura, topoDoRodape, altura),
    cima: medir(0, terco, 0, fundoDoTopo),
  };
}

/** Junta a medida nova às anteriores (média móvel), para um quadro só não decidir sozinho. */
export function suavizarOcupacao(anterior: OcupacaoDoQuadro | null, nova: OcupacaoDoQuadro, peso = 0.5): OcupacaoDoQuadro {
  if (!anterior) return nova;
  const r = { ...nova };
  for (const k of Object.keys(r) as RegiaoDaPilula[]) r[k] = anterior[k] * (1 - peso) + nova[k] * peso;
  return r;
}

/** A região menos ocupada do rodapé; se o rodapé inteiro está ocupado e o alto está livre, em cima. Sem medida: embaixo à esquerda. */
export function escolherRegiao(ocupacao: OcupacaoDoQuadro | null): RegiaoDaPilula {
  if (!ocupacao) return REGIAO_PADRAO;
  let melhor = RODAPE[0]!;
  for (const r of RODAPE) if (ocupacao[r] < ocupacao[melhor] - 1e-6) melhor = r;
  if (ocupacao[melhor] > LIMIAR_DE_OCUPADO && ocupacao.cima < ocupacao[melhor] * ALTO_BEM_MAIS_LIVRE) return 'cima';
  return melhor;
}

/** As faixas pretas do `object-fit: contain`: quanto a imagem fica para dentro da caixa do vídeo, de cada lado. */
export function folgasDoConteudo(caixa: { largura: number; altura: number }, natural: { largura: number; altura: number }): { x: number; y: number } {
  if (caixa.largura <= 0 || caixa.altura <= 0 || natural.largura <= 0 || natural.altura <= 0) return { x: 0, y: 0 };
  const escala = Math.min(caixa.largura / natural.largura, caixa.altura / natural.altura);
  return { x: Math.max(0, (caixa.largura - natural.largura * escala) / 2), y: Math.max(0, (caixa.altura - natural.altura * escala) / 2) };
}
