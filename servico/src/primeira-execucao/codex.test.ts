import { expect, test } from 'vitest';
import type { ExecutarComando } from '../executor/capacidades.js';
import { CODIGO_AUSENTE, lerStatusDoLogin, verificarCodex } from './codex.js';
import { comMemoria } from './estado.js';

const AJUDA = ['--sandbox', '--skip-git-repo-check', '--dangerously-bypass-hook-trust', '--output-schema',
  '--output-last-message', '-C', '-c', '-m'].map((flag) => `  ${flag} <X>`).join('\n');

function cli(login: { codigo: number; saida: string }, ajuda = AJUDA): ExecutarComando & { chamadas: string[][] } {
  const chamadas: string[][] = [];
  const executar = (_arquivo: string, argumentos: readonly string[]) => {
    chamadas.push([...argumentos]);
    if (argumentos[0] === '--version') return Promise.resolve({ codigo: 0, saida: 'codex-cli 0.160.0\n' });
    if (argumentos[0] === 'login') return Promise.resolve(login);
    return Promise.resolve({ codigo: 0, saida: ajuda });
  };
  return Object.assign(executar, { chamadas });
}

test('lê as respostas reais de `codex login status`', () => {
  expect(lerStatusDoLogin(0, 'Logged in using ChatGPT\n')).toEqual({ logado: true, conta: 'chatgpt' });
  expect(lerStatusDoLogin(0, 'Logged in using an API key - sk-proj-***ABCD\n')).toEqual({ logado: true, conta: 'chave_api' });
  expect(lerStatusDoLogin(1, 'Not logged in\n')).toEqual({ logado: false, conta: null });
  expect(lerStatusDoLogin(2, 'Error: algo inesperado')).toEqual({ logado: null, conta: null });
});

test('codex presente, compatível e logado; a saída crua da CLI não volta', async () => {
  const executar = cli({ codigo: 0, saida: 'Logged in using an API key - sk-proj-***ABCD' });
  const estado = await verificarCodex({ executarComando: executar });
  expect(estado).toEqual({ encontrado: true, versao: 'codex-cli 0.160.0', compativel: true, logado: true, conta: 'chave_api' });
  expect(JSON.stringify(estado)).not.toContain('sk-');
  expect(executar.chamadas).toContainEqual(['login', 'status']);
  // Só comandos que não leem nada nem gastam cota.
  expect(executar.chamadas.every((args) => ['--version', 'login', 'exec'].includes(args[0]!) && (args[0] !== 'exec' || args[1] === '--help'))).toBe(true);
});

test('codex ausente do PATH, deslogado ou sem as flags do executor', async () => {
  const ausente: ExecutarComando = () => Promise.resolve({ codigo: CODIGO_AUSENTE, saida: '' });
  expect(await verificarCodex({ executarComando: ausente })).toEqual({ encontrado: false, versao: null, compativel: false, logado: null, conta: null });
  expect(await verificarCodex({ executarComando: cli({ codigo: 1, saida: 'Not logged in' }) })).toMatchObject({ encontrado: true, logado: false, compativel: true });
  expect(await verificarCodex({ executarComando: cli({ codigo: 0, saida: 'Logged in using ChatGPT' }, '  -m <X>') })).toMatchObject({ compativel: false, logado: true });
});

test('a memória curta guarda por um tempo e não guarda falha', async () => {
  let agora = 0;
  let chamadas = 0;
  let falhar = true;
  const verificar = comMemoria(() => { chamadas += 1; return falhar ? Promise.reject(new Error('x')) : Promise.resolve(chamadas); }, 1000, () => agora);
  await expect(verificar()).rejects.toThrow();
  falhar = false;
  expect(await verificar()).toBe(2);
  agora = 500; expect(await verificar()).toBe(2);
  expect(await verificar(true)).toBe(3);
  agora = 2000; expect(await verificar()).toBe(4);
});
