/**
 * O desenho das marcas como o leitor faz no padrão, copiado do app para o site (que não importa de
 * web/). Cada constante diz de onde veio; mudou lá, mude aqui.
 *
 * - `APARENCIA_PADRAO` (web/src/leitor/preferencias.ts): estilo grifo, traço régua, intensidade .3.
 * - `pesoDaSaliencia` (web/src/leitor/f2.ts).
 * - `acaoDoEstilo` e a opacidade (web/src/ui/marcador/CamadaDeMarcas.tsx).
 * - `NOMES_DOS_NIVEIS` (web/src/leitor/f2.ts).
 * - `ROTULO_DA_RELACAO` (web/src/leitor/compreensao/rotulos.ts) e `CORES_DAS_RELACOES` (…/cores.ts).
 * - `posicaoDoCard` e as medidas das braquetes (web/src/leitor/compreensao/Braquetes.tsx).
 */
import { tracos, type Retangulo, type Traco } from './tracos';

export type Estilo = 'grifo' | 'marca_texto' | 'sublinhado';
export const APARENCIA_PADRAO = { estilo: 'grifo' as Estilo, intensidade: .3, traco: 'regua' as 'regua' | 'mao', rugosidade: .55, nivelDeAtencao: 2 as 0 | 1 | 2 | 3 };
export const NOMES_DOS_NIVEIS = ['Texto puro', 'Esqueleto', 'Estudo', 'Aprofundar'] as const;
export const ROTULOS_DOS_ESTILOS: Record<Estilo, string> = { grifo: 'Grifo', marca_texto: 'Marca-texto', sublinhado: 'Sublinhado' };

export function pesoDaSaliencia(saliencia: 1 | 2 | 3): { fator: number; soSublinhado: boolean; espessura: number } {
  if (saliencia === 3) return { fator: .8, soSublinhado: true, espessura: 1 };
  if (saliencia === 2) return { fator: .55, soSublinhado: false, espessura: 1.5 };
  return { fator: 1, soSublinhado: false, espessura: 1.5 };
}

export function acaoDoEstilo(estilo: Estilo, soSublinhado: boolean): 'grifo' | 'marca_texto' | 'sublinhado' {
  if (soSublinhado || estilo === 'sublinhado') return 'sublinhado';
  return estilo === 'marca_texto' ? 'marca_texto' : 'grifo';
}

/** Os traços de uma marca, como `CamadaDeMarcas`: a ativa fica mais grossa. */
export function tracosDaMarca(linhas: readonly Retangulo[], opcoes: { id: string; cor: string; saliencia: 1 | 2 | 3; estilo: Estilo; ativa: boolean; rugosidade?: number }): Traco[] {
  const peso = pesoDaSaliencia(opcoes.saliencia);
  return tracos(linhas, {
    cor: opcoes.cor, semente: opcoes.id, rugosidade: opcoes.rugosidade ?? 0,
    acao: acaoDoEstilo(opcoes.estilo, peso.soSublinhado), espessura: opcoes.ativa ? peso.espessura * 1.6 : peso.espessura,
  });
}

/** A opacidade da faixa, como `CamadaDeMarcas` (a linha usa esta + .5, como `Desenho`). */
export function opacidadeDaMarca(saliencia: 1 | 2 | 3, ativa: string | null, id: string, escuro: boolean, intensidadeBase = APARENCIA_PADRAO.intensidade): number {
  const peso = pesoDaSaliencia(saliencia);
  const intensidade = intensidadeBase + (ativa === id ? .12 : ativa ? -.08 : 0);
  return Math.max(0, Math.min(escuro ? .4 : 1, intensidade * (escuro ? .6 : 1) * peso.fator));
}

export const ROTULO_DA_RELACAO = {
  suporta: 'sustenta', desenvolve: 'desenvolve', pressupoe: 'pressupõe', contrasta: 'contrasta com', exemplifica: 'exemplifica',
  retoma: 'retoma', responde: 'responde a', tensiona: 'tensiona', ecoa: 'ecoa',
} as const;
export type TipoDeRelacao = keyof typeof ROTULO_DA_RELACAO;
export const CORES_DAS_RELACOES = ['#d4524a', '#e08a26', '#2f9e8f', '#7c63cc', '#3a82c4'] as const;

/** Braquetes: espinha a 30 px da coluna, 14 px por pista; colchete a 12 px, aba de 6 px. */
export const LARGURA_DA_PISTA = 14;
export const xDaEspinha = (esquerdaDaColuna: number, pista: number): number => esquerdaDaColuna - 30 - pista * LARGURA_DA_PISTA;
export const DISTANCIA_DO_COLCHETE = 12;

const LARGURA_DO_CARD = 340;
const LARGURA_MINIMA_DO_CARD = 160;
const FRACAO_DO_CIRCULO = 3 / 4;
/**
 * O card toma o lugar do círculo, com o círculo a 3/4 da largura; nunca passa de `limite`. Igual ao
 * app, com `minimo` no lugar da borda da janela (aqui, a borda da janela da demonstração).
 */
export function posicaoDoCard(xDoCirculo: number, yDoCirculo: number, limite: number, minimo: number): { left: number; top: number; width: number } {
  const largura = Math.max(LARGURA_MINIMA_DO_CARD, Math.min(LARGURA_DO_CARD, (xDoCirculo - minimo - 12) / FRACAO_DO_CIRCULO, limite - minimo - 12));
  let left = xDoCirculo - largura * FRACAO_DO_CIRCULO;
  if (left + largura > limite) left = limite - largura;
  left = Math.max(minimo + 12, Math.min(left, xDoCirculo - 12));
  return { left, top: yDoCirculo, width: largura };
}

/** Uma caixa por linha (de `web/src/ui/marcador/geometria.ts`, `retangulosDosTrechos`, sem o filtro de caixas ocultas). */
export function retangulosDosTrechos(elementos: readonly Element[], base: DOMRect): Retangulo[] {
  const retangulos: Retangulo[] = [];
  for (const elemento of elementos) {
    const intervalo = document.createRange();
    intervalo.selectNodeContents(elemento);
    for (const r of intervalo.getClientRects()) {
      if (r.width <= 0 || r.height <= 0) continue;
      retangulos.push({ x: r.left - base.left, y: r.top - base.top, largura: r.width, altura: r.height });
    }
  }
  retangulos.sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas: Retangulo[] = [];
  for (const r of retangulos) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && Math.abs(ultima.y - r.y) < 3 && r.x <= ultima.x + ultima.largura + 1) {
      ultima.largura = Math.max(ultima.x + ultima.largura, r.x + r.largura) - ultima.x;
      ultima.altura = Math.max(ultima.altura, r.altura);
    } else linhas.push({ ...r });
  }
  return linhas;
}

/** Funções e cores do modo filosófico (`contratos/modos/filosofica@1.json`), iguais no claro e no escuro. */
export const FUNCOES_FILOSOFICAS = {
  tese: { rotulo: 'Tese', cor: '#FFD926' },
  conceito: { rotulo: 'Conceito', cor: '#59D675' },
  distincao: { rotulo: 'Distinção', cor: '#2EC4B6' },
  argumento: { rotulo: 'Argumento', cor: '#52ABFF' },
  objecao: { rotulo: 'Objeção', cor: '#FF8A3D' },
  consequencia: { rotulo: 'Consequência', cor: '#B98CFF' },
} as const;
export type Funcao = keyof typeof FUNCOES_FILOSOFICAS;

/** O número da nota: o anel na cor da função; o algarismo, a cor misturada ao texto (`estiloDoNumero`, f2.ts). */
export const estiloDoNumero = (cor: string): { borderColor: string; color: string } =>
  ({ borderColor: cor, color: `color-mix(in srgb, ${cor} var(--mistura-do-numero, 50%), var(--texto-1, #000))` });
