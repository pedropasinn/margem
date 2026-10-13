/** Orçamentos de entrada do serviço; não alteram a validade dos contratos publicados. */
import { open } from 'node:fs/promises';
export interface OrcamentoJson { bytes: number; profundidade: number; itens: number; nos: number }
const MiB = 1024 * 1024;
// Máximos medidos e margem registrados em docs/jobs/J52-RESULTADO e J55-RESULTADO.
export const ORCAMENTOS = {
  resposta: { bytes: 512 * 1024, profundidade: 16, itens: 8192, nos: 16384 },
  canonico: { bytes: 32 * MiB, profundidade: 16, itens: 32768, nos: 1048576 },
  // J62: 52.285.222 bytes, profundidade 7, 27.548 itens, 1.716.134 nós no Mixtape.
  proveniencia: { bytes: 128 * MiB, profundidade: 16, itens: 65536, nos: 4194304 },
  geometria: { bytes: 256 * MiB, profundidade: 16, itens: 1048576, nos: 16777216 },
  modelo: { bytes: MiB, profundidade: 16, itens: 512, nos: 16384 },
  lote: { bytes: 256 * 1024, profundidade: 16, itens: 128, nos: 8192 },
  plano: { bytes: 512 * 1024, profundidade: 16, itens: 512, nos: 8192 },
} as const satisfies Record<string, OrcamentoJson>;
export class LimiteDeEntrada extends Error {
  constructor(public readonly recurso: keyof OrcamentoJson | 'formato') {
    super(`Entrada JSON excede o orçamento de ${recurso} ou não é uma árvore JSON válida.`);
    this.name = 'LimiteDeEntrada';
  }
}
/** Percurso iterativo, antes de Ajv, clones, hashes ou recursão de regras. */
export function conferirOrcamento(valor: unknown, limite: OrcamentoJson): void {
  const pilha = [{ valor, nivel: 1 }];
  const vistos = new WeakSet<object>();
  let nos = 0;
  while (pilha.length) {
    const atual = pilha.pop()!;
    if (++nos > limite.nos) throw new LimiteDeEntrada('nos');
    if (atual.nivel > limite.profundidade) throw new LimiteDeEntrada('profundidade');
    const v = atual.valor;
    if (typeof v === 'string' && Buffer.byteLength(v) > limite.bytes) throw new LimiteDeEntrada('bytes');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new LimiteDeEntrada('formato'); continue; }
    if (typeof v !== 'object' || vistos.has(v)) throw new LimiteDeEntrada('formato');
    vistos.add(v);
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new LimiteDeEntrada('formato');
    if (Array.isArray(v) && v.length > limite.itens) throw new LimiteDeEntrada('itens');
    const descritores = Object.getOwnPropertyDescriptors(v);
    for (const [chave, d] of Object.entries(descritores)) {
      if (Array.isArray(v) && chave === 'length') continue;
      if (!('value' in d)) throw new LimiteDeEntrada('formato');
      if (nos + pilha.length >= limite.nos) throw new LimiteDeEntrada('nos');
      pilha.push({ valor: d.value as unknown, nivel: atual.nivel + 1 });
    }
  }
  if (Buffer.byteLength(JSON.stringify(valor)) > limite.bytes) throw new LimiteDeEntrada('bytes');
}
/** A profundidade é limitada antes de construir a árvore. Strings escapadas não contam. */
export function interpretarJson(texto: string, limite: OrcamentoJson): unknown {
  if (Buffer.byteLength(texto) > limite.bytes) throw new LimiteDeEntrada('bytes');
  let nivel = 0, string = false, escape = false;
  for (const c of texto) {
    if (string) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') string = false;
    } else if (c === '"') string = true;
    else if (c === '{' || c === '[') { if (++nivel > limite.profundidade) throw new LimiteDeEntrada('profundidade'); }
    else if (c === '}' || c === ']') nivel--;
  }
  let valor: unknown;
  try { valor = JSON.parse(texto); } catch { throw new Error('Entrada não é JSON válido.'); }
  conferirOrcamento(valor, limite);
  return valor;
}
/** Leitura limitada no descritor aberto, inclusive se o arquivo crescer depois do stat. */
export async function lerTextoLimitado(caminho: string, limite: OrcamentoJson): Promise<string> {
  const arquivo = await open(caminho, 'r');
  try {
    const info = await arquivo.stat();
    if (!info.isFile()) throw new LimiteDeEntrada('formato');
    if (info.size > limite.bytes) throw new LimiteDeEntrada('bytes');
    const partes: Buffer[] = []; let total = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, limite.bytes - total + 1));
      const { bytesRead } = await arquivo.read(buffer);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limite.bytes) throw new LimiteDeEntrada('bytes');
      partes.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(partes).toString('utf8');
  } finally { await arquivo.close(); }
}
export async function lerJsonLimitado(caminho: string, limite: OrcamentoJson): Promise<unknown> {
  return interpretarJson(await lerTextoLimitado(caminho, limite), limite);
}
