import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerArgumentos, linkExterno, mesmaOrigem } from '../src/principal/argumentos.js';
import { ambienteDoCodex, extrairCodigo, extrairLink, iniciarLogin, loginDoApp } from '../src/nucleo/codex.js';
import { pastasDaBiblioteca, pastasDoApp } from '../src/nucleo/configuracao.js';
import { ambienteDosFilhos } from '../src/nucleo/servico.js';
import type { RecursosResolvidos } from '../src/nucleo/recursos.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
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
  it('U-01/W-05: conectar depois (Configurações) usa o Codex embutido e o mesmo CODEX_HOME do serviço', () => {
    const recursos = { postgres: null, codex: { caminho: '/r/bin/codex', origem: 'embutido' }, motor: null, fonte: null, ytDlp: null, ffmpeg: null, ffprobe: null, pastaBin: '/r/bin' } satisfies RecursosResolvidos;
    const pastas = pastasDoApp('/u');
    const login = loginDoApp(recursos, pastas);
    expect(login).toEqual({ codex: '/r/bin/codex', codexHome: '/u/codex' });
    const servico = ambienteDosFilhos({
      base: { PATH: '/usr/bin' }, recursos, pastasDoApp: pastas, biblioteca: pastasDaBiblioteca('/docs/Margem'),
      portaDaApi: 8730, urlDoBanco: 'postgres://x', raiz: '/r/margem', sistema: 'linux',
    });
    expect(servico.CODEX_HOME).toBe(login?.codexHome);
    expect(servico.MARGEM_CODEX_MOTOR).toBe(login?.codex);
    // O login roda esse executável com esse CODEX_HOME (o falso no lugar do processo).
    const chamadas: { arquivo: string; argumentos: string[]; home: string | undefined }[] = [];
    const filho = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true }) as unknown as ChildProcess;
    iniciarLogin(login!.codex, login!.codexHome, true, () => undefined, (arquivo, argumentos, ambiente) => {
      chamadas.push({ arquivo, argumentos, home: ambiente.CODEX_HOME }); return filho;
    });
    expect(chamadas).toEqual([{ arquivo: '/r/bin/codex', argumentos: ['login', '--device-auth'], home: '/u/codex' }]);
    // Sem o Codex embutido não há login: a interface pede para reinstalar.
    expect(loginDoApp({ ...recursos, codex: null }, pastas)).toBeNull();
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

describe('"Abrir com" o Margem (U-08)', () => {
  it('pega PDFs e EPUBs posicionais, absolutos e sem repetir; ignora opções, o "." do Electron e a biblioteca', async () => {
    const { arquivosDosArgumentos } = await import('../src/principal/argumentos.js');
    const { posix } = await import('node:path');
    const argv = ['.', '--biblioteca', '/livros/x.pdf', '--allow-file-access-from-files', 'Meus Livros/Dom Casmurro – edição.EPUB', '/tmp/artigo.pdf', '/tmp/artigo.pdf', 'notas.txt', '--sem-janela'];
    expect(arquivosDosArgumentos(argv, '/home/ana', (pasta, caminho) => posix.resolve(pasta, caminho))).toEqual([
      '/home/ana/Meus Livros/Dom Casmurro – edição.EPUB', '/tmp/artigo.pdf',
    ]);
    expect(arquivosDosArgumentos([], '/', (pasta, caminho) => posix.resolve(pasta, caminho))).toEqual([]);
  });

  it('R2-7: URIs file:// do lançador do Linux (%U) viram caminhos; outros esquemas são recusados', async () => {
    const { arquivosDosArgumentos } = await import('../src/principal/argumentos.js');
    const { posix } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const resolver = (pasta: string, caminho: string) => posix.resolve(pasta, caminho);
    const deUri = (uri: string) => fileURLToPath(uri, { windows: false });
    const argv = [
      'file:///home/ana/Livro%20com%20acentua%C3%A7%C3%A3o.pdf', 'FILE:///tmp/a.epub', 'file://servidor/compartilhado/x.pdf',
      'https://exemplo.com/livro.pdf', 'smb://nas/livros/y.pdf', 'file:///home/ana/notas.txt', 'relativo.pdf',
    ];
    expect(arquivosDosArgumentos(argv, '/home/ana', resolver, deUri)).toEqual([
      '/home/ana/Livro com acentuação.pdf', '/tmp/a.epub', '/home/ana/relativo.pdf',
    ]);
    // Caminho do Windows com letra de unidade não é esquema.
    expect(arquivosDosArgumentos(['C:\\Livros\\a.pdf'], 'C:\\', (_p, c) => c, deUri)).toEqual(['C:\\Livros\\a.pdf']);
  });
});
