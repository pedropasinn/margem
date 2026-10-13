/**
 * Preparar em segundo plano basta? (`docs/desenho/09-VISAO.md` §6.) Uma simulação pura: o leitor abre o
 * capítulo 1, espera ele ficar pronto (se não estiver), lê pelo tempo de leitura e abre o seguinte. Ao
 * abrir cada capítulo, pede-se ele (na frente da fila) e os `profundidade` seguintes (atrás). Cada
 * trabalhador (vaga do Codex) prepara um capítulo por vez, do começo ao fim (mais pessimista que a fila
 * real, que troca de capítulo entre jobs). A pergunta é quanto o leitor espera em cada capítulo aberto.
 *
 * Com um só trabalhador, se preparar um capítulo leva mais que lê-lo, preparar mais adiante não ajuda:
 * a fila só cresce. Aí o que ajuda é paralelo (mais vagas), preparar antes de começar, ou preparar mais
 * depressa (menos esforço, partes menores).
 */
export interface CapituloNoTempo { leitura_s: number; preparo_s: number }
export interface ResultadoDaSimulacao {
  profundidade: number;
  trabalhadores: number;
  /** Espera ao abrir cada capítulo, em segundos. */
  esperas_s: number[];
  /** Espera total fora do primeiro capítulo (o primeiro sempre espera, se nada foi preparado antes). */
  espera_depois_do_primeiro_s: number;
  /** Tempo que o trabalhador passa preparando capítulos que o leitor não chega a abrir (no fim do livro). */
  preparo_s: number;
}

/** Leitura de estudo, mais lenta que a corrida: 180 palavras por minuto. */
export const PALAVRAS_POR_MINUTO = 180;
export function tempoDeLeitura(textos: readonly string[], palavrasPorMinuto = PALAVRAS_POR_MINUTO): number {
  const palavras = textos.reduce((total, texto) => total + (texto.match(/\S+/g)?.length ?? 0), 0);
  return Math.round((palavras / palavrasPorMinuto) * 60);
}

export function simularPreparacao(
  capitulos: readonly CapituloNoTempo[], profundidade: number, jaProntos: ReadonlySet<number> = new Set(), trabalhadores = 1,
): ResultadoDaSimulacao {
  const pronto = new Map<number, number>();
  for (const indice of jaProntos) pronto.set(indice, 0);
  const fila: number[] = [];
  const livres = Array.from({ length: Math.max(1, trabalhadores) }, () => 0);
  let trabalho = 0;
  const maisCedo = () => livres.indexOf(Math.min(...livres));
  // Os trabalhadores começam, em ordem, o que puderem começar antes de `ate`.
  const processarAte = (ate: number) => {
    while (fila.length > 0 && (livres[maisCedo()] ?? 0) <= ate) {
      const quem = maisCedo();
      const capitulo = fila.shift() as number;
      const custo = capitulos[capitulo]?.preparo_s ?? 0;
      pronto.set(capitulo, (livres[quem] ?? 0) + custo);
      livres[quem] = (livres[quem] ?? 0) + custo;
      trabalho += custo;
    }
    if (fila.length === 0) for (let quem = 0; quem < livres.length; quem++) livres[quem] = Math.max(livres[quem] ?? 0, ate);
  };
  const pedir = (capitulo: number, naFrente: boolean) => {
    if (capitulo >= capitulos.length || pronto.has(capitulo)) return;
    const onde = fila.indexOf(capitulo);
    if (onde >= 0) { if (!naFrente) return; fila.splice(onde, 1); }
    if (naFrente) fila.unshift(capitulo); else fila.push(capitulo);
  };
  const esperas: number[] = [];
  let abertura = 0;
  capitulos.forEach((capitulo, indice) => {
    processarAte(abertura);
    pedir(indice, true);
    for (let seguinte = indice + 1; seguinte <= indice + profundidade; seguinte++) pedir(seguinte, false);
    // Se ainda não está pronto, o trabalhador (ao terminar o que tem em mãos) passa a ele.
    if (!pronto.has(indice)) {
      const quem = maisCedo();
      const inicio = Math.max(livres[quem] ?? 0, abertura);
      fila.splice(fila.indexOf(indice), 1);
      pronto.set(indice, inicio + capitulo.preparo_s);
      livres[quem] = inicio + capitulo.preparo_s;
      trabalho += capitulo.preparo_s;
    }
    const espera = Math.max(0, (pronto.get(indice) ?? abertura) - abertura);
    esperas.push(Math.round(espera));
    abertura += espera + capitulo.leitura_s;
  });
  return { profundidade, trabalhadores: livres.length, esperas_s: esperas, espera_depois_do_primeiro_s: esperas.slice(1).reduce((a, b) => a + b, 0), preparo_s: Math.round(trabalho) };
}

/** A menor profundidade (até `maxima`) em que o leitor não espera depois do primeiro capítulo; senão, a de menor espera. */
export function profundidadeRecomendada(capitulos: readonly CapituloNoTempo[], maxima = 3, trabalhadores = 1): ResultadoDaSimulacao {
  const resultados = Array.from({ length: maxima + 1 }, (_nada, profundidade) => simularPreparacao(capitulos, profundidade, new Set(), trabalhadores));
  return resultados.find((resultado) => resultado.espera_depois_do_primeiro_s === 0)
    ?? resultados.reduce((melhor, resultado) => resultado.espera_depois_do_primeiro_s < melhor.espera_depois_do_primeiro_s ? resultado : melhor);
}
