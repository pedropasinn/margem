/**
 * O pdf.js usa métodos recentes da linguagem (`Map.prototype.getOrInsertComputed`, `Math.sumPrecise`,
 * `Promise.try`) que navegadores de um ou dois anos atrás ainda não têm. Sem eles, o PDF não abre.
 * Carregado antes do pdf.js, na página e no worker; não faz nada onde o método já existe.
 */
function definir(alvo: object, nome: string, valor: unknown): void {
  if (nome in alvo) return;
  Object.defineProperty(alvo, nome, { value: valor, configurable: true, writable: true });
}

for (const Tipo of [Map, WeakMap] as const) {
  definir(Tipo.prototype, 'getOrInsert', function getOrInsert(this: Map<unknown, unknown>, chave: unknown, padrao: unknown): unknown {
    if (!this.has(chave)) this.set(chave, padrao);
    return this.get(chave);
  });
  definir(Tipo.prototype, 'getOrInsertComputed', function getOrInsertComputed(this: Map<unknown, unknown>, chave: unknown, calcular: (chave: unknown) => unknown): unknown {
    if (!this.has(chave)) this.set(chave, calcular(chave));
    return this.get(chave);
  });
}

// Soma compensada de Neumaier: precisa o bastante para as coordenadas das páginas.
definir(Math, 'sumPrecise', function sumPrecise(valores: Iterable<number>): number {
  let soma = 0;
  let compensacao = 0;
  for (const valor of valores) {
    const t = soma + valor;
    compensacao += Math.abs(soma) >= Math.abs(valor) ? (soma - t) + valor : (valor - t) + soma;
    soma = t;
  }
  return soma + compensacao;
});

definir(Promise, 'try', function tentar<T>(funcao: (...argumentos: unknown[]) => T, ...argumentos: unknown[]): Promise<Awaited<T>> {
  return new Promise<Awaited<T>>((resolver) => { resolver(funcao(...argumentos) as Awaited<T>); });
});

export {};
