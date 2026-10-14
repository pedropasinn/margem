// Confere que as cópias do app em src/app/ continuam iguais à origem em web/ (o site não importa de web/).
// Uso: node scripts/conferir-copias.mjs   (sai com 1 se alguma cópia literal divergiu)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COPIAS = [['src/app/tracos.ts', '../web/src/ui/marcador/tracos.ts', 2]];
let falhou = false;
for (const [copia, origem, cabecalho] of COPIAS) {
  const caminho = resolve(raiz, origem);
  if (!existsSync(caminho)) { console.log(`sem ${origem}: nada a conferir`); continue; }
  const daCopia = readFileSync(resolve(raiz, copia), 'utf8').split('\n').slice(cabecalho).join('\n');
  if (daCopia !== readFileSync(caminho, 'utf8')) { console.error(`${copia} divergiu de ${origem}`); falhou = true; } else console.log(`${copia} = ${origem}`);
}
process.exitCode = falhou ? 1 : 0;
