/**
 * Encerramento do lado dos filhos (L-06, L-07): o `encerramento.ts` de verdade, empacotado pelo esbuild
 * num script pequeno que faz o papel do worker ou da API. O app "some" pelo `disconnect` do canal IPC,
 * que é o que o filho vê quando o Electron cai ou é encerrado pelo gerenciador de tarefas.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plataformaAtual } from '../src/nucleo/plataforma.js';
import { inicializarCluster, parar, subir } from '../src/nucleo/postgres.js';
import { portaDoSistema } from '../src/nucleo/porta.js';
import type { BinariosDoPostgres } from '../src/nucleo/recursos.js';

const ENCERRAMENTO = resolve(import.meta.dirname, '..', 'servico', 'encerramento.ts');
let pasta = '';
beforeAll(async () => { pasta = await mkdtemp(join(tmpdir(), 'margem-encerramento-')); });
afterAll(async () => { await rm(pasta, { recursive: true, force: true }); });

async function empacotar(nome: string, codigo: string): Promise<string> {
  const entrada = join(pasta, `${nome}.ts`);
  await writeFile(entrada, codigo.replaceAll('ENCERRAMENTO', JSON.stringify(ENCERRAMENTO)));
  const saida = join(pasta, `${nome}.cjs`);
  await build({ entryPoints: [entrada], bundle: true, platform: 'node', format: 'cjs', outfile: saida, external: ['pg-native'], logLevel: 'silent' });
  return saida;
}

function iniciar(script: string, ambiente: NodeJS.ProcessEnv = {}): { filho: ChildProcess; linhas: string[]; saiu: Promise<number | null> } {
  const filho = fork(script, [], { env: { ...process.env, ...ambiente }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const linhas: string[] = [];
  filho.stdout?.on('data', (pedaco: Buffer) => { linhas.push(...pedaco.toString().split('\n').filter((l) => l !== '')); });
  const saiu = new Promise<number | null>((r) => { filho.on('exit', (codigo) => { r(codigo); }); });
  return { filho, linhas, saiu };
}

const esperarAte = async (condicao: () => boolean, prazoMs = 10_000): Promise<void> => {
  const limite = Date.now() + prazoMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('prazo esgotado');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('L-07: prazo de encerramento dentro da API', () => {
  it('um SSE pendurado não segura o processo depois que o app some', { timeout: 20_000 }, async () => {
    const script = await empacotar('api-sse', `
      import http from 'node:http';
      import { encerrarPorMensagem } from ENCERRAMENTO;
      encerrarPorMensagem({ prazoMs: 800 });
      const servidor = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(':\\n\\n'); });
      // Como a API: no SIGTERM, close() e só então sai; com o SSE aberto, o callback nunca vem.
      process.on('SIGTERM', () => { servidor.close(() => process.exit(0)); });
      servidor.listen(0, '127.0.0.1', () => { console.log('porta ' + servidor.address().port); });
    `);
    const { filho, linhas, saiu } = iniciar(script);
    await esperarAte(() => linhas.some((l) => l.startsWith('porta ')));
    const porta = Number((linhas.find((l) => l.startsWith('porta ')) ?? '').split(' ')[1]);
    const cliente = http.get({ host: '127.0.0.1', port: porta, path: '/sse' });
    await new Promise<void>((r) => { cliente.on('response', () => { r(); }); });
    const inicio = Date.now();
    filho.disconnect();
    expect(await saiu).toBe(0);
    expect(Date.now() - inicio).toBeLessThan(5_000);
    expect(linhas.some((l) => l.includes('encerramento_estourou'))).toBe(true);
    cliente.destroy();
  });
});

const pastaDosBinarios = resolve(import.meta.dirname, '..', 'recursos', (() => { try { return plataformaAtual(); } catch { return 'nenhuma'; } })(), 'postgres', 'bin');
const exe = (nome: string): string => join(pastaDosBinarios, process.platform === 'win32' ? `${nome}.exe` : nome);
const REAIS: BinariosDoPostgres = { initdb: exe('initdb'), pgCtl: exe('pg_ctl'), postgres: exe('postgres'), origem: 'embutido' };

describe.skipIf(!existsSync(REAIS.postgres))('L-06: o Postgres para quando o app some', () => {
  it('o worker devolve a tarefa, para o banco e sai; sem precisar reabrir o app', { timeout: 120_000 }, async () => {
    const banco = join(pasta, 'l06', 'banco');
    await mkdir(join(pasta, 'l06'), { recursive: true });
    await inicializarCluster(REAIS, banco, 'senha-de-teste-123456', join(pasta, 'l06', 'tmp'));
    await subir(REAIS, banco, await portaDoSistema(), join(pasta, 'l06', 'pg.log'));
    try {
      const script = await empacotar('worker', `
        import { encerrarPorMensagem, pararBancoSemDono } from ENCERRAMENTO;
        const encerramento = encerrarPorMensagem({ prazoMs: 30_000, aoPerderOPai: () => pararBancoSemDono() });
        // Como o worker: no SIGTERM, termina a tarefa (um instante) e o laço acaba.
        const laco = setInterval(() => {}, 1000);
        process.on('SIGTERM', () => { console.log('devolvendo a tarefa'); setTimeout(() => { clearInterval(laco); void encerramento.limparSemPai(); }, 200); });
        console.log('pronto');
      `);
      const { filho, linhas, saiu } = iniciar(script, { MARGEM_PG_CTL: REAIS.pgCtl, MARGEM_PG_DADOS: banco });
      await esperarAte(() => linhas.includes('pronto'));
      expect(existsSync(join(banco, 'postmaster.pid'))).toBe(true);
      filho.disconnect();
      expect(await saiu).toBe(0);
      expect(linhas).toContain('devolvendo a tarefa');
      expect(linhas.some((l) => l.includes('"banco_parado_sem_app"') && l.includes('"ok":true'))).toBe(true);
      expect(existsSync(join(banco, 'postmaster.pid'))).toBe(false);
    } finally {
      await parar(REAIS, banco);
    }
  });

  it('R-02: o worker antigo não derruba o Postgres que o app reabriu na mesma pasta', { timeout: 120_000 }, async () => {
    const banco = join(pasta, 'r02', 'banco');
    const log = join(pasta, 'r02', 'pg.log');
    await mkdir(join(pasta, 'r02'), { recursive: true });
    await inicializarCluster(REAIS, banco, 'senha-de-teste-123456', join(pasta, 'r02', 'tmp'));
    await subir(REAIS, banco, await portaDoSistema(), log);
    try {
      const sinal = join(pasta, 'r02', 'seguir');
      const script = await empacotar('worker-r02', `
        import { existsSync } from 'node:fs';
        import { bancoNoAr, encerrarPorMensagem, pararBancoSemDono } from ENCERRAMENTO;
        const banco = bancoNoAr();
        const encerramento = encerrarPorMensagem({ prazoMs: 60_000, aoPerderOPai: () => pararBancoSemDono(process.env, banco) });
        const laco = setInterval(() => {}, 1000);
        // Demora para devolver a tarefa: o tempo de o app reabrir e subir outro Postgres na mesma pasta.
        process.on('SIGTERM', () => {
          console.log('devolvendo a tarefa');
          const espera = setInterval(() => { if (existsSync(process.env.SINAL)) { clearInterval(espera); clearInterval(laco); void encerramento.limparSemPai(); } }, 50);
        });
        console.log('pronto');
      `);
      const { filho, linhas, saiu } = iniciar(script, { MARGEM_PG_CTL: REAIS.pgCtl, MARGEM_PG_DADOS: banco, SINAL: sinal });
      await esperarAte(() => linhas.includes('pronto'));
      const lerPid = () => readFileSync(join(banco, 'postmaster.pid'), 'utf8').split('\n')[0];
      const antes = lerPid();
      // O app "cai" (o canal some) e reabre: para o Postgres órfão e sobe outro na mesma pasta.
      filho.disconnect();
      await esperarAte(() => linhas.includes('devolvendo a tarefa'));
      expect(await parar(REAIS, banco)).toBe(true);
      await subir(REAIS, banco, await portaDoSistema(), log);
      expect(lerPid()).not.toBe(antes);
      // O worker antigo termina a tarefa agora e tenta parar "o banco sem dono".
      await writeFile(sinal, '');
      expect(await saiu).toBe(0);
      expect(linhas.some((l) => l.includes('banco_de_outra_sessao'))).toBe(true);
      expect(existsSync(join(banco, 'postmaster.pid'))).toBe(true);
    } finally {
      await parar(REAIS, banco);
    }
  });
});
