/**
 * Traços à mão da demonstração. Versão reduzida de `web/src/ui/marcador/tracos.ts` (o Marcador do
 * app): mesma faixa chanfrada de marca-texto, mesmo sublinhado irregular, mesma semente
 * determinística. Geometria pura, sem DOM.
 */
export interface Retangulo { x: number; y: number; largura: number; altura: number }
export type Estilo = 'marca_texto' | 'sublinhado';
export interface Traco { d: string; preenchido: boolean }

function sementeDoId(id: string): number {
  let valor = 2166136261;
  for (const caractere of id) valor = Math.imul(valor ^ caractere.charCodeAt(0), 16777619);
  return valor >>> 0;
}

function gerador(semente: string): () => number {
  let estado = sementeDoId(semente);
  return () => {
    estado += 0x6d2b79f5;
    let valor = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    valor ^= valor + Math.imul(valor ^ (valor >>> 7), 61 | valor);
    return ((valor ^ (valor >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (valor: number): string => String(Math.round(valor * 100) / 100);
const p = (x: number, y: number): string => `${n(x)} ${n(y)}`;

export function tracos(retangulos: readonly Retangulo[], estilo: Estilo, semente: string): Traco[] {
  const aleatorio = gerador(semente);
  const rugosidade = .55;
  const desvio = (): number => (aleatorio() - .5) * rugosidade * 3;
  const recuo = 2;
  const espessura = 2;
  const saida: Traco[] = [];
  for (const caixa of retangulos) {
    if (caixa.largura <= 0 || caixa.altura <= 0) continue;
    const x = caixa.x - recuo + desvio();
    const direita = caixa.x + caixa.largura + recuo;
    const baixo = caixa.y + caixa.altura + recuo;
    if (estilo === 'marca_texto') {
      const subida = Math.min(3, caixa.largura * .015);
      const y = caixa.y - recuo + desvio();
      const topo = y + caixa.altura * .18 - espessura / 2;
      const base = baixo - caixa.altura * .08 + espessura / 2;
      const meio = (x + direita) / 2;
      saida.push({
        d: `M${p(x + 2, topo)} L${p(meio, topo + desvio() - subida / 2)} L${p(direita, topo - subida + desvio())} L${p(direita - 2, base - subida)} L${p(meio, base + desvio() - subida / 2)} L${p(x, base)} Z`,
        preenchido: true,
      });
    } else {
      const altura = baixo - caixa.altura * .1;
      saida.push({
        d: `M${p(x, altura + desvio())} Q${p((x + direita) / 2, altura + desvio())} ${p(direita, altura + desvio())}`,
        preenchido: false,
      });
    }
  }
  return saida;
}

/** Uma caixa por linha: junta os fragmentos de um trecho que caem na mesma linha. */
export function retangulosDoElemento(elemento: Element, base: DOMRect): Retangulo[] {
  const intervalo = document.createRange();
  intervalo.selectNodeContents(elemento);
  const caixas = [...intervalo.getClientRects()]
    .filter((r) => r.width > 0 && r.height > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const linhas: Retangulo[] = [];
  for (const r of caixas) {
    const atual = { x: r.left - base.left, y: r.top - base.top, largura: r.width, altura: r.height };
    const ultima = linhas.at(-1);
    if (ultima && Math.abs(ultima.y - atual.y) < 3 && atual.x <= ultima.x + ultima.largura + 1) {
      ultima.largura = Math.max(ultima.x + ultima.largura, atual.x + atual.largura) - ultima.x;
      ultima.altura = Math.max(ultima.altura, atual.altura);
    } else linhas.push(atual);
  }
  return linhas;
}
