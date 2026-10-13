/**
 * Grava em `integracoes/obsidian/exemplo/` a nota que a exportação gera para a entrada de exemplo
 * (`servico/src/obsidian/fixture-de-exemplo.ts`). Sem banco e sem rede.
 *
 *   npm run exemplo-obsidian
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { raizDoRepositorio } from '../dados.js';
import { exportarParaObsidian } from '../obsidian/exportar.js';
import { entradaDeExemplo } from '../obsidian/fixture-de-exemplo.js';

const pasta = join(raizDoRepositorio(), 'integracoes/obsidian/exemplo');
const nota = exportarParaObsidian(entradaDeExemplo());
await mkdir(pasta, { recursive: true });
await writeFile(join(pasta, nota.arquivo), nota.conteudo, 'utf8');
console.log(JSON.stringify({ arquivo: join(pasta, nota.arquivo), itens: nota.itens, bytes: Buffer.byteLength(nota.conteudo) }));
