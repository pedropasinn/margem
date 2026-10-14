/**
 * Grava em `integracoes/obsidian/exemplo/` o que a exportação gera para a entrada de exemplo
 * (`servico/src/obsidian/fixture-de-exemplo.ts`): a nota única da V1 e, em `Margem/`, a árvore do
 * formato 2 (uma pasta por documento, uma nota por item). Sem banco e sem rede.
 *
 *   npm run exemplo-obsidian
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { raizDoRepositorio } from '../dados.js';
import { exportarParaObsidian } from '../obsidian/exportar.js';
import { exportarParaObsidianV2 } from '../obsidian/exportar-v2.js';
import { entradaDeExemplo, entradaDeExemploV2 } from '../obsidian/fixture-de-exemplo.js';

const pasta = join(raizDoRepositorio(), 'integracoes/obsidian/exemplo');
const nota = exportarParaObsidian(entradaDeExemplo());
await mkdir(pasta, { recursive: true });
await writeFile(join(pasta, nota.arquivo), nota.conteudo, 'utf8');

const v2 = exportarParaObsidianV2(entradaDeExemploV2());
const raizV2 = join(pasta, 'Margem');
await rm(raizV2, { recursive: true, force: true });
for (const item of v2.notas) {
  const destino = join(raizV2, ...item.caminho.split('/'));
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, item.conteudo, 'utf8');
}
console.log(JSON.stringify({ v1: join(pasta, nota.arquivo), v2: raizV2, notas_v2: v2.notas.length }));
