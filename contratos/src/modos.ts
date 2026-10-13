import { readFileSync, readdirSync } from 'node:fs';
import type { ModoDeLeituraV1, ReferenciaModo } from './tipos';
import { validarModoDeLeitura } from './validadores';

/** O modo de F1: toda marca V1 é lida como `argumentativa@1`. */
export const MODO_F1: Readonly<ReferenciaModo> = Object.freeze({ id: 'argumentativa', revisao: 1 });
/** Opacidade do traço de marca-texto usada na régua de legibilidade. */
export const OPACIDADE_MARCA_TEXTO = 0.35;
export const CONTRASTE_MINIMO = 4.5;
/** Superfície do leitor em cada tema (`web/src/ui/tokens.css`: `--bg` e `--texto-1`). */
export const TEMAS_DE_REFERENCIA = Object.freeze({
  claro: Object.freeze({ fundo: '#FFFFFF', texto: '#000000' }),
  escuro: Object.freeze({ fundo: '#141414', texto: '#FFFFFF' }),
});
export type Tema = keyof typeof TEMAS_DE_REFERENCIA;
type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  if (!/^#[0-9A-Fa-f]{6}$/u.test(hex)) throw new Error(`Cor inválida: ${hex}`);
  return [1, 3, 5].map((inicio) => parseInt(hex.slice(inicio, inicio + 2), 16)) as Rgb;
}
function linear(canal: number): number {
  const c = canal / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
/** Luminância relativa WCAG 2.x. */
export function luminancia([r, g, b]: Rgb): number { return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b); }
export function razaoDeContraste(a: Rgb, b: Rgb): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
}
/** Composição da cor sobre o fundo em sRGB, como o navegador faz com `opacity`. */
export function compor(cor: string, fundo: string, opacidade = OPACIDADE_MARCA_TEXTO): Rgb {
  const frente = rgb(cor); const base = rgb(fundo);
  return frente.map((canal, i) => opacidade * canal + (1 - opacidade) * (base[i] ?? 0)) as Rgb;
}
/** Contraste do texto sobre o traço de marca-texto (cor a 35% sobre o fundo do tema). */
export function contrasteDoMarcaTexto(cor: string, tema: Tema, opacidade = OPACIDADE_MARCA_TEXTO): number {
  const { fundo, texto } = TEMAS_DE_REFERENCIA[tema];
  return razaoDeContraste(compor(cor, fundo, opacidade), rgb(texto));
}
/** Régua de legibilidade: toda função do modo, nos dois temas, com contraste ≥ 4,5:1. */
export function conferirLegibilidadeModo(modo: ModoDeLeituraV1, opacidade = OPACIDADE_MARCA_TEXTO): boolean {
  return modo.funcoes.every((funcao) => (['claro', 'escuro'] as const).every((tema) =>
    contrasteDoMarcaTexto(funcao.cor[tema], tema, opacidade) >= CONTRASTE_MINIMO));
}

const PASTA_MODOS = new URL('../modos/', import.meta.url);
/** Lê e valida `contratos/modos/<id>@<revisao>.json`; nome de arquivo e conteúdo precisam concordar. */
export function lerModosDeLeitura(): ModoDeLeituraV1[] {
  return readdirSync(PASTA_MODOS).filter((arquivo) => arquivo.endsWith('.json')).sort().map((arquivo) => {
    const modo: unknown = JSON.parse(readFileSync(new URL(arquivo, PASTA_MODOS), 'utf8'));
    if (!validarModoDeLeitura(modo) || arquivo !== `${modo.id}@${modo.revisao}.json` || !conferirLegibilidadeModo(modo)) {
      throw new Error(`Modo de leitura inválido: ${arquivo}`);
    }
    return modo;
  });
}
export function obterModo(referencia: ReferenciaModo): ModoDeLeituraV1 {
  const modo = lerModosDeLeitura().find((item) => item.id === referencia.id && item.revisao === referencia.revisao);
  if (!modo) throw new Error(`Modo ausente: ${referencia.id}@${referencia.revisao}`);
  return modo;
}
export function mesmoModo(a: ReferenciaModo, b: ReferenciaModo): boolean { return a.id === b.id && a.revisao === b.revisao; }
