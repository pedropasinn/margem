/**
 * Medidas de texto determinísticas do algoritmo v2 de quadros: normalização, palavras de conteúdo,
 * semelhança e procura de trechos citados. São réguas grosseiras (sem lematizador), usadas para
 * detectar repetição e casar afirmações; não substituem a leitura humana.
 */

const VAZIAS = new Set(`a à às ao aos as o os um uma uns umas de da das do dos d em na nas no nos num numa por pela pelas pelo pelos para pra com sem sob sobre entre até após ante contra desde e é ou mas nem que se já não sim como mais menos muito muita muitos muitas pouco quando onde quem qual quais cujo cuja isso isto aquilo esse essa esses essas este esta estes estas aquele aquela aqueles aquelas ele ela eles elas seu sua seus suas lhe lhes me te nos vos meu minha teu tua nosso nossa dele dela deles delas também ainda só mesmo mesma outro outra outros outras cada todo toda todos todas há ser são foi era eram está estão estava ter tem têm tinha faz fazer pode podem parece aqui ali lá então assim agora depois antes porque pois the of and in to is on for with by an at from`.split(/\s+/u));

/** Minúsculas, sem acentos, só letras/dígitos separados por um espaço. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Radical grosseiro: as primeiras cinco letras (olhar/olhares, pintura/pintor ficam juntos). */
export function radical(palavra: string): string { return palavra.length <= 5 ? palavra : palavra.slice(0, 5); }

/** Palavras de conteúdo (sem as vazias e sem as de uma ou duas letras), como radicais. */
export function conteudo(texto: string): string[] {
  return normalizar(texto).split(' ').filter((p) => p.length > 2 && !VAZIAS.has(p)).map(radical);
}

export function contarPalavras(texto: string): number { return texto.split(/\s+/u).filter(Boolean).length; }

/** Jaccard dos conjuntos de radicais de conteúdo. */
export function jaccard(a: string, b: string): number {
  const x = new Set(conteudo(a)), y = new Set(conteudo(b));
  if (!x.size || !y.size) return 0;
  let comum = 0; for (const p of x) if (y.has(p)) comum += 1;
  return comum / (x.size + y.size - comum);
}

/** Dice dos conjuntos de radicais de conteúdo. */
export function dice(a: string, b: string): number {
  const x = new Set(conteudo(a)), y = new Set(conteudo(b));
  if (!x.size || !y.size) return 0;
  let comum = 0; for (const p of x) if (y.has(p)) comum += 1;
  return (2 * comum) / (x.size + y.size);
}

/**
 * Se o trecho citado aparece no corpus (normalizado: caixa, acentos, pontuação e espaços não contam).
 * Trechos curtos demais (menos de quatro palavras) não provam nada e são recusados.
 */
export function trechoPresente(trecho: string, corpus: string): boolean {
  const t = normalizar(trecho);
  if (t.split(' ').length < 4) return false;
  return normalizar(corpus).includes(t);
}
