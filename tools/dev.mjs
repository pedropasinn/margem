#!/usr/bin/env node
/**
 * `npm run dev` na raiz: sobe API, worker e Vite; encerra os três juntos.
 * O Vite repassa `/api` para a API (ver `web/vite.config.ts`), de modo que o
 * navegador continua falando com uma única origem.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const filhos = [];
// `@margem/core` e `@margem/contratos` declaram `exports`; o tsx resolve os dois
// pelos workspaces e `TSX_TSCONFIG_PATH` deixou de ser necessário (J10).
const portaApi = process.env.MARGEM_PORTA ?? '8730';
const portaWeb = process.env.MARGEM_PORTA_WEB ?? '5180';
for (const porta of [portaApi, portaWeb]) {
  if (!/^\d+$/.test(porta) || Number(porta) < 1 || Number(porta) > 65535) {
    throw new Error('MARGEM_PORTA e MARGEM_PORTA_WEB precisam ser portas válidas.');
  }
}
const origens = new Set([
  ...(process.env.MARGEM_ORIGENS?.split(',').map((item) => item.trim()).filter(Boolean) ?? []),
  ...[portaApi, portaWeb].flatMap((porta) => [`http://127.0.0.1:${porta}`, `http://localhost:${porta}`]),
  ...(process.env.MARGEM_TAILSCALE_HOST ? [`https://${process.env.MARGEM_TAILSCALE_HOST}`] : []),
]);
const ambiente = { ...process.env, MARGEM_PORTA: portaApi, MARGEM_ORIGENS: [...origens].join(',') };

function subir(nome, comando, argumentos, diretorio = raiz) {
  const filho = spawn(comando, argumentos, { cwd: diretorio, stdio: 'inherit', env: ambiente });
  filho.on('error', (erro) => {
    console.error(`[dev] ${nome}: ${erro.message}`);
    process.exitCode = 1;
    parar();
  });
  filho.on('exit', (codigo, sinal) => {
    if (sinal === null) console.error(`[dev] ${nome} terminou com código ${codigo}`);
    parar();
    if (codigo !== null && codigo !== 0) process.exitCode = codigo;
  });
  filhos.push(filho);
}

let parando = false;
function parar() {
  if (parando) return;
  parando = true;
  for (const filho of filhos) filho.kill('SIGTERM');
}

for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, parar);

const carregarWeb = createRequire(new URL('../web/package.json', import.meta.url));
const vite = join(dirname(carregarWeb.resolve('vite/package.json')), 'bin/vite.js');
subir('api', process.execPath, ['--import', 'tsx', 'servico/src/api.ts']);
subir('worker', process.execPath, ['--import', 'tsx', 'servico/src/worker/main.ts']);
subir('web', process.execPath, [vite, '--host', '127.0.0.1', '--port', portaWeb, '--strictPort'], join(raiz, 'web'));
