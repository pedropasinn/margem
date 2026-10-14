import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerArgumentos, linkExterno, mesmaOrigem } from '../src/principal/argumentos.js';
import { ambienteDoCodex, extrairCodigo, extrairLink } from '../src/nucleo/codex.js';
import { ITENS_DE_ADICIONAR, enderecoDeAdicionar } from '../src/nucleo/importar.js';
import { cortadorDeLinhas, nomeDoAntigo, Registro } from '../src/nucleo/registros.js';
import { renomearComRetentativa } from '../src/nucleo/disco.js';

describe('linha de comando e links', () => {
  it('lê --sem-janela e --biblioteca', () => {
    expect(lerArgumentos(['.', '--no-sandbox', '--sem-janela', '--biblioteca=/tmp/b'])).toEqual({ semJanela: true, biblioteca: '/tmp/b' });
    expect(lerArgumentos(['--biblioteca', '/x'])).toEqual({ semJanela: false, biblioteca: '/x' });
  });
  it('só http(s) e mailto saem para o navegador', () => {
    expect(linkExterno('https://margem.dev/docs')).toBe(true);
    expect(linkExterno('file:///etc/passwd')).toBe(false);
    expect(linkExterno('javascript:alert(1)')).toBe(false);
    expect(mesmaOrigem('http://127.0.0.1:8730/ler/x', 'http://127.0.0.1:8730')).toBe(true);
    expect(mesmaOrigem('http://127.0.0.1:8731/', 'http://127.0.0.1:8730')).toBe(false);
  });
});

describe('login do Codex', () => {
  it('acha o link e o código na saída da CLI', () => {
    const saida = '\u001b[1mFollow these steps\u001b[0m\n1. Open https://auth.openai.com/codex/device.\n2. Enter this one-time code: ABCD-12EF\n';
    expect(extrairLink(saida)).toBe('https://auth.openai.com/codex/device');
    expect(extrairCodigo(saida)).toBe('ABCD-12EF');
    expect(extrairLink('nada aqui')).toBeNull();
  });
  it('CODEX_HOME do app e nada do serviço no ambiente da CLI', () => {
    const ambiente = ambienteDoCodex('/u/codex', { PATH: '/x', ELECTRON_RUN_AS_NODE: '1', DATABASE_URL: 'pg', CODEX_HOME: '/outro' });
    expect(ambiente).toEqual({ PATH: '/x', CODEX_HOME: '/u/codex' });
  });
});

describe('Adicionar pelo menu (V-D5)', () => {
  it('cada item abre a aba certa da tela Adicionar; o documento fica no Ctrl+O', () => {
    expect(ITENS_DE_ADICIONAR.map((item) => [item.rotulo, item.aba])).toEqual([
      ['Adicionar documento…', 'documento'], ['Adicionar vídeo…', 'video'], ['Adicionar obra…', 'quadro'],
    ]);
    expect(ITENS_DE_ADICIONAR[0]?.atalho).toBe('CmdOrCtrl+O');
    expect(enderecoDeAdicionar('http://127.0.0.1:8730', 'video')).toBe('http://127.0.0.1:8730/adicionar/video');
    expect(enderecoDeAdicionar('http://127.0.0.1:8730/', 'quadro')).toBe('http://127.0.0.1:8730/adicionar/quadro');
  });
});

describe('registros', () => {
  it('gira por tamanho e guarda N antigos', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'margem-registro-'));
    try {
      const caminho = join(pasta, 'api.log');
      const registro = new Registro(caminho, { limiteBytes: 200, antigos: 2 });
      for (let i = 0; i < 40; i += 1) registro.escrever(`linha ${String(i)} ${'x'.repeat(20)}`);
      expect(existsSync(caminho)).toBe(true);
      expect(existsSync(nomeDoAntigo(caminho, 1))).toBe(true);
      expect(existsSync(nomeDoAntigo(caminho, 2))).toBe(true);
      expect(existsSync(nomeDoAntigo(caminho, 3))).toBe(false);
      expect(await readFile(caminho, 'utf8')).toContain('linha 39');
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  });
  it('corta pedaços em linhas inteiras', () => {
    const linhas: string[] = [];
    const cortador = cortadorDeLinhas((l) => linhas.push(l));
    cortador.empurrar('um\ndo');
    cortador.empurrar('is\r\n\ntr');
    cortador.terminar();
    cortador.empurrar('ês');
    cortador.terminar();
    expect(linhas).toEqual(['um', 'dois', 'tr', 'ês']);
  });
});

describe('rename no Windows (V-W8)', () => {
  it('tenta de novo em EPERM/EBUSY/EACCES só no Windows', async () => {
    const falhas = (codigos: string[]) => {
      const chamadas: number[] = [];
      return { chamadas, renomear: () => { chamadas.push(1); const c = codigos.shift(); return c === undefined ? Promise.resolve() : Promise.reject(Object.assign(new Error(c), { code: c })); } };
    };
    const w = falhas(['EPERM', 'EBUSY']);
    await renomearComRetentativa('a', 'b', { plataforma: 'win32', esperaMs: 1, renomear: w.renomear });
    expect(w.chamadas).toHaveLength(3);
    const l = falhas(['EPERM']);
    await expect(renomearComRetentativa('a', 'b', { plataforma: 'linux', renomear: l.renomear })).rejects.toThrow('EPERM');
    expect(l.chamadas).toHaveLength(1);
  });
});
