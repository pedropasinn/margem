/**
 * O instalador só leva o que `ARQUIVOS_DA_RAIZ` (scripts/construir.mjs) lista. Todo arquivo que o serviço
 * ou os contratos abrem por `new URL('../…', import.meta.url)` tem de estar lá dentro: o
 * `contratos/tipos-de-texto.json` ficou de fora na v0.1.1 e o `identificar_tipo` falhava com ENOENT.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function arquivosDaRaiz(): string[] {
  const fonte = readFileSync(join(REPO, 'desktop/scripts/construir.mjs'), 'utf8');
  const lista = /const ARQUIVOS_DA_RAIZ = \[([^\]]*)\]/u.exec(fonte)?.[1] ?? '';
  return [...lista.matchAll(/'([^']+)'/gu)].map((m) => m[1]!);
}

function fontes(pasta: string): string[] {
  return readdirSync(join(REPO, pasta), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.split(/[\\/]/u).includes('ferramentas'))
    .map((f) => join(pasta, f));
}

// Fora do app de desktop: as notícias rodam só na instalação com Docker (python3 do sistema).
const FORA_DO_DESKTOP = ['tools/noticias'];

test('todo arquivo lido por caminho relativo entra no instalador', () => {
  const raiz = arquivosDaRaiz();
  expect(raiz).toContain('contratos/tipos-de-texto.json');
  const faltando: string[] = [];
  for (const arquivo of [...fontes('servico/src'), ...fontes('contratos/src')]) {
    const texto = readFileSync(join(REPO, arquivo), 'utf8');
    for (const [, alvo] of texto.matchAll(/new URL\('(\.\.\/[^']*)', import\.meta\.url\)/gu)) {
      const caminho = relative(REPO, resolve(REPO, dirname(arquivo), alvo!)).replaceAll('\\', '/');
      if (caminho === '' || FORA_DO_DESKTOP.some((p) => caminho.startsWith(`${p}/`))) continue;
      if (!raiz.some((item) => caminho === item || caminho.startsWith(`${item}/`))) faltando.push(`${arquivo} → ${caminho}`);
    }
  }
  expect(faltando).toEqual([]);
});
