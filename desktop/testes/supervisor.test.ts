import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { atrasoDoRecuo, Supervisor } from '../src/nucleo/supervisor.js';

let pasta = '';
beforeAll(async () => { pasta = await mkdtemp(join(tmpdir(), 'margem-supervisor-')); });
afterAll(async () => { await rm(pasta, { recursive: true, force: true }); });

async function script(nome: string, codigo: string): Promise<string> {
  const caminho = join(pasta, nome);
  await writeFile(caminho, codigo);
  return caminho;
}

const esperarAte = async (condicao: () => boolean, prazoMs = 10_000): Promise<void> => {
  const limite = Date.now() + prazoMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('prazo esgotado');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('recuo', () => {
  it('cresce exponencialmente até o teto', () => {
    const recuo = { inicialMs: 1000, maximoMs: 30_000, fator: 2 };
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((n) => atrasoDoRecuo(n, recuo))).toEqual([0, 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });
});

describe('supervisor', () => {
  it('reinicia quem cai, com recuo, e desiste depois do limite', async () => {
    const cai = await script('cai.mjs', 'console.log("subi"); process.exit(3);');
    const eventos: string[] = [];
    const linhas: string[] = [];
    let desistiu = false;
    const supervisor = new Supervisor({ nome: 'teste', script: cai, ambiente: process.env }, {
      recuo: { inicialMs: 20, maximoMs: 80, fator: 2 }, maximoDeFalhas: 3,
      anotar: (evento) => { eventos.push(evento); },
      aoLinha: (linha) => { linhas.push(linha); },
      aoDesistir: () => { desistiu = true; },
    });
    supervisor.iniciar();
    await esperarAte(() => desistiu);
    expect(supervisor.estado).toBe('desistiu');
    expect(eventos.filter((e) => e === 'processo_iniciado')).toHaveLength(4);
    expect(eventos.filter((e) => e === 'processo_reinicio_agendado')).toHaveLength(3);
    expect(linhas.filter((l) => l === 'subi')).toHaveLength(4);
  });

  it('para com educação pelo IPC e o filho sai limpo', async () => {
    const educado = await script('educado.mjs', `
      process.on('message', (m) => { if (m === 'margem:parar') { console.log('encerrando'); setTimeout(() => process.exit(0), 50); } });
      setInterval(() => {}, 1000);
      console.log('pronto');
    `);
    const linhas: string[] = [];
    const supervisor = new Supervisor({ nome: 'educado', script: educado, ambiente: process.env }, { aoLinha: (l) => { linhas.push(l); } });
    supervisor.iniciar();
    await esperarAte(() => linhas.includes('pronto'));
    expect(await supervisor.parar()).toBe('limpo');
    expect(linhas).toContain('encerrando');
    expect(supervisor.estado).toBe('parado');
    expect(await supervisor.parar()).toBe('ja_parado');
  });

  it('mata a árvore de quem não sai no prazo e não reinicia depois de parado', async () => {
    const teimoso = await script('teimoso.mjs', `
      import { spawn } from 'node:child_process';
      process.on('message', () => {}); process.on('SIGTERM', () => {});
      const neto = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      setInterval(() => {}, 1000); console.log('pronto ' + neto.pid);
    `);
    const linhas: string[] = [];
    const eventos: string[] = [];
    const supervisor = new Supervisor({ nome: 'teimoso', script: teimoso, ambiente: process.env }, {
      prazoDeParadaMs: 200, aoLinha: (l) => { linhas.push(l); }, anotar: (e) => { eventos.push(e); },
    });
    supervisor.iniciar();
    await esperarAte(() => linhas.some((l) => l.startsWith('pronto ')));
    const pid = supervisor.pid ?? 0;
    const neto = Number((linhas.find((l) => l.startsWith('pronto ')) ?? '').split(' ')[1]);
    expect(await supervisor.parar()).toBe('forcado');
    expect(() => process.kill(pid, 0)).toThrow();
    if (process.platform !== 'win32') {
      await esperarAte(() => { try { process.kill(neto, 0); return false; } catch { return true; } });
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(eventos).not.toContain('processo_reinicio_agendado');
  });

  it('roda com ELECTRON_RUN_AS_NODE e o ambiente pedido', async () => {
    const ambiente = await script('ambiente.mjs', 'console.log(process.env.ELECTRON_RUN_AS_NODE + "|" + process.env.MARGEM_PORTA);');
    const linhas: string[] = [];
    const supervisor = new Supervisor({ nome: 'ambiente', script: ambiente, ambiente: { ...process.env, MARGEM_PORTA: '8730' } }, {
      aoLinha: (l) => { linhas.push(l); }, recuo: { inicialMs: 10_000, maximoMs: 10_000, fator: 1 },
    });
    supervisor.iniciar();
    await esperarAte(() => linhas.length > 0);
    await supervisor.parar();
    expect(linhas[0]).toBe('1|8730');
  });
});
