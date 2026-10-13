// Copia main.js e manifest.json para <cofre>/.obsidian/plugins/margem (rode `npm run build` antes).
//   npm run instalar -- ~/caminho/do/cofre
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const cofre = process.argv[2];
if (!cofre) {
  console.error('Use: npm run instalar -- <caminho do cofre>');
  process.exit(2);
}
const raiz = resolve(cofre.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
if (!(await stat(join(raiz, '.obsidian')).catch(() => null))?.isDirectory()) {
  console.error(`${raiz} não parece um cofre do Obsidian (falta a pasta .obsidian).`);
  process.exit(1);
}
const destino = join(raiz, '.obsidian', 'plugins', 'margem');
await mkdir(destino, { recursive: true });
for (const arquivo of ['main.js', 'manifest.json']) await copyFile(new URL(arquivo, import.meta.url), join(destino, arquivo));
console.log(`Instalado em ${destino}. No Obsidian: Configurações → Plugins da comunidade → ative "Margem".`);
