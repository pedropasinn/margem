/** Igualdade de valores JSON, independente da ordem de chaves retornada pelo JSONB. */
export function conteudosIguais(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = Object.entries(a), bb = Object.entries(b);
  return aa.length === bb.length && aa.every(([k, v]) => Object.hasOwn(b, k) && conteudosIguais(v, (b as Record<string, unknown>)[k]));
}
