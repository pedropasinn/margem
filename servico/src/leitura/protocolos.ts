import { existsSync, readFileSync } from 'node:fs';
import type { ModoDeLeituraV1 } from '@margem/contratos';

const raiz = new URL('../../../prompts/', import.meta.url);
const cache = new Map<string, string>();
function ler(nome: string): string {
  let texto = cache.get(nome);
  if (texto === undefined) { texto = readFileSync(new URL(nome, raiz), 'utf8'); cache.set(nome, texto); }
  return texto;
}
/** Arquivos da distribuição, nunca caminhos recebidos do texto analisado. */
export function protocoloDoModo(modo: ModoDeLeituraV1): string {
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u.test(modo.id) || !Number.isSafeInteger(modo.revisao) || modo.revisao < 1) throw new Error('Referência de modo inválida.');
  const nome = `generos/${modo.id}@${modo.revisao}.md`;
  return [ler('generos/comum@1.md'), ler('generos/verso@1.md'), existsSync(new URL(nome, raiz)) ? ler(nome) : ''].filter(Boolean).join('\n');
}
/** O mesmo modelo materializado entra no prompt enviado e no hash da entrada. */
export function modeloDoPrompt(nome: string, modo: ModoDeLeituraV1): string {
  if (!/^[a-z-]+@[1-9][0-9]*$/u.test(nome)) throw new Error('Versão de prompt inválida.');
  const texto = ler(`${nome}.md`);
  return texto.includes('<!-- protocolo-do-modo -->') ? texto.replace('<!-- protocolo-do-modo -->', protocoloDoModo(modo)) : texto;
}
