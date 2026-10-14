// CÓPIA LITERAL de web/src/ui/marcador/tracos.ts (o Marcador do app). O site é um projeto à parte e
// não importa de web/; ao mudar o traço no app, copie de novo. Conferido por scripts/conferir-copias.mjs.
/** Geometria pura: nenhuma medida de DOM ou aleatoriedade global entra aqui. */
export interface Retangulo { x: number; y: number; largura: number; altura: number }
export type Acao = 'marca_texto' | 'grifo' | 'sublinhado' | 'caixa' | 'circulo' | 'colchete' | 'riscado' | 'xis';
export interface OpcoesDoTraco {
  acao?: Acao;
  cor?: string;
  espessura?: number;
  iteracoes?: number;
  rugosidade?: number;
  recuo?: number;
  inclinacao?: number;
  semente?: string | number;
  lado?: 'esquerda' | 'direita';
  /** Linha em traços curtos, para o que é discreto (as dificuldades do texto). */
  tracejado?: boolean;
}
export interface Traco { d: string; cor: string; preenchido: boolean; espessura: number; tracejado?: boolean }

export function sementeDoId(id: string | number): number {
  let valor = 2166136261;
  for (const caractere of String(id)) valor = Math.imul(valor ^ caractere.charCodeAt(0), 16777619);
  return valor >>> 0;
}

function gerador(semente: string | number): () => number {
  let estado = sementeDoId(semente);
  return () => {
    estado += 0x6d2b79f5;
    let valor = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    valor ^= valor + Math.imul(valor ^ (valor >>> 7), 61 | valor);
    return ((valor ^ (valor >>> 14)) >>> 0) / 4294967296;
  };
}
const numero = (n: number): string => String(Math.round(n * 100) / 100);
const ponto = (x: number, y: number): string => `${numero(x)} ${numero(y)}`;

/**
 * Grifo: a faixa do marca-texto com uma linha firme na borda de baixo (a base do grifo). A faixa ocupa a
 * altura da linha inteira, sem cantos arredondados, para que linhas vizinhas formem um bloco contínuo.
 */
function grifo(retangulos: readonly Retangulo[], opcoes: OpcoesDoTraco): Traco[] {
  const cor = opcoes.cor ?? '#ffd926';
  const espessura = Math.max(.1, opcoes.espessura ?? 2);
  const rugosidade = Math.max(0, Math.min(1, opcoes.rugosidade ?? .55));
  if (rugosidade > 0) {
    // À mão: a faixa chanfrada do marca-texto e um sublinhado irregular sob ela.
    return [...tracos(retangulos, { ...opcoes, acao: 'marca_texto' }), ...tracos(retangulos, { ...opcoes, acao: 'sublinhado', espessura: espessura * .75, recuo: 0 })];
  }
  const caminhos: Traco[] = [];
  for (const caixa of retangulos.filter((r) => r.largura > 0 && r.altura > 0 && Object.values(r).every(Number.isFinite))) {
    const esquerda = caixa.x - 1;
    const direita = caixa.x + caixa.largura + 1;
    const cima = caixa.y + caixa.altura * .04;
    const base = caixa.y + caixa.altura * .98;
    caminhos.push({ d: `M${ponto(esquerda, cima)} L${ponto(direita, cima)} L${ponto(direita, base)} L${ponto(esquerda, base)} Z`, cor, preenchido: true, espessura });
    caminhos.push({ d: `M${ponto(esquerda, base)} L${ponto(direita, base)}`, cor, preenchido: false, espessura: espessura * .75 });
  }
  return caminhos;
}

export function tracos(retangulos: readonly Retangulo[], opcoes: OpcoesDoTraco = {}): Traco[] {
  if (opcoes.acao === 'grifo') return grifo(retangulos, opcoes);
  const { acao = 'marca_texto', cor = '#ffd926', semente = 1, lado = 'esquerda' } = opcoes;
  const espessura = Math.max(.1, opcoes.espessura ?? 2);
  const iteracoes = Math.max(1, Math.min(3, Math.round(opcoes.iteracoes ?? 1)));
  const rugosidade = Math.max(0, Math.min(1, opcoes.rugosidade ?? .55));
  const recuo = opcoes.recuo ?? 2;
  const inclinacao = opcoes.inclinacao ?? .015;
  const aleatorio = gerador(semente);
  const desvio = (): number => (aleatorio() - .5) * rugosidade * 3;
  const linha = (x: number, y: number, fimX: number, fimY: number): string => rugosidade === 0
    ? `M${ponto(x, y)} L${ponto(fimX, fimY)}`
    : `M${ponto(x, y + desvio())} Q${ponto((x + fimX) / 2, (y + fimY) / 2 + desvio())} ${ponto(fimX, fimY + desvio())}`;
  let caixas = retangulos.filter((r) => r.largura > 0 && r.altura > 0 && Object.values(r).every(Number.isFinite));
  if (acao === 'colchete' && caixas.length > 0) {
    const x = Math.min(...caixas.map((r) => r.x));
    const y = Math.min(...caixas.map((r) => r.y));
    caixas = [{ x, y, largura: Math.max(...caixas.map((r) => r.x + r.largura)) - x,
      altura: Math.max(...caixas.map((r) => r.y + r.altura)) - y }];
  }
  const caminhos: Traco[] = [];
  for (const caixa of caixas) {
    for (let i = 0; i < iteracoes; i++) {
      const x = caixa.x - recuo + desvio();
      const y = caixa.y - recuo + desvio();
      const direita = caixa.x + caixa.largura + recuo;
      const baixo = caixa.y + caixa.altura + recuo;
      let d: string;
      switch (acao) {
        case 'marca_texto': {
          if (rugosidade === 0) {
            // Régua: uma faixa retangular por linha, com a mesma proporção em todas, cantos levemente arredondados.
            const esquerda = caixa.x - 1;
            const fim = caixa.x + caixa.largura + 1;
            const cima = caixa.y + caixa.altura * .1;
            const embaixo = caixa.y + caixa.altura * .94;
            const raio = Math.min(2, (fim - esquerda) / 2, (embaixo - cima) / 2);
            d = `M${ponto(esquerda + raio, cima)} L${ponto(fim - raio, cima)} Q${ponto(fim, cima)} ${ponto(fim, cima + raio)} L${ponto(fim, embaixo - raio)} Q${ponto(fim, embaixo)} ${ponto(fim - raio, embaixo)} L${ponto(esquerda + raio, embaixo)} Q${ponto(esquerda, embaixo)} ${ponto(esquerda, embaixo - raio)} L${ponto(esquerda, cima + raio)} Q${ponto(esquerda, cima)} ${ponto(esquerda + raio, cima)} Z`;
            break;
          }
          const subida = Math.min(3, caixa.largura * inclinacao);
          const topo = y + caixa.altura * .18 - espessura / 2;
          const base = baixo - caixa.altura * .08 + espessura / 2;
          const meio = (x + direita) / 2;
          // A ponta chanfrada e as bordas irregulares são parte do caminho preenchido.
          d = `M${ponto(x + 2, topo)} L${ponto(meio, topo + desvio() - subida / 2)} L${ponto(direita, topo - subida + desvio())} L${ponto(direita - 2, base - subida)} L${ponto(meio, base + desvio() - subida / 2)} L${ponto(x, base)} Z`;
          break;
        }
        case 'sublinhado': {
          if (rugosidade === 0) {
            // Régua: logo abaixo da linha de base, na mesma altura relativa em todas as linhas e sem passar das bordas do trecho.
            const altura = caixa.y + caixa.altura * .9;
            d = `M${ponto(caixa.x, altura)} L${ponto(caixa.x + caixa.largura, altura)}`;
          } else d = linha(x, baixo, direita, baixo);
          break;
        }
        case 'riscado': d = linha(x, (y + baixo) / 2, direita, (y + baixo) / 2); break;
        case 'xis': d = `${linha(x, y, direita, baixo)} ${linha(x, baixo, direita, y)}`; break;
        case 'caixa':
          d = `${linha(x, y, direita, y)} ${linha(direita, y, direita, baixo)} ${linha(direita, baixo, x, baixo)} ${linha(x, baixo, x, y)}`;
          break;
        case 'circulo': {
          const meioX = (x + direita) / 2;
          const meioY = (y + baixo) / 2;
          const raioX = (direita - x) / 2;
          const raioY = (baixo - y) / 2;
          d = `M${ponto(x, meioY)} C${ponto(x, meioY - raioY * 1.33 + desvio())} ${ponto(direita, meioY - raioY * 1.33 + desvio())} ${ponto(direita, meioY)} C${ponto(meioX + raioX, meioY + raioY * 1.33 + desvio())} ${ponto(x, meioY + raioY * 1.33 + desvio())} ${ponto(x, meioY)} Z`;
          break;
        }
        case 'colchete': {
          const borda = lado === 'esquerda' ? x : direita;
          const ponta = borda + (lado === 'esquerda' ? 6 : -6);
          d = `${linha(ponta, y, borda, y)} ${linha(borda, y, borda, baixo)} ${linha(borda, baixo, ponta, baixo)}`;
          break;
        }
      }
      caminhos.push({ d, cor, preenchido: acao === 'marca_texto', espessura, ...(opcoes.tracejado === true && acao !== 'marca_texto' ? { tracejado: true } : {}) });
    }
  }
  return caminhos;
}
