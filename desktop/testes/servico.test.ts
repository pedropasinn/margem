import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pastasDaBiblioteca, pastasDoApp } from '../src/nucleo/configuracao.js';
import type { RecursosResolvidos } from '../src/nucleo/recursos.js';
import { decidirConfinamento } from '../src/nucleo/confinamento.js';
import { ambienteDosFilhos, EXTENSAO_PADRAO, migrarSegredosDaBiblioteca } from '../src/nucleo/servico.js';

const RECURSOS: RecursosResolvidos = {
  postgres: null,
  codex: { caminho: '/r/bin/codex', origem: 'embutido' },
  motor: { caminho: '/r/motor/margem-motor', origem: 'embutido' },
  fonte: { caminho: '/r/fontes/DejaVuSans.ttf', origem: 'embutido' },
  ytDlp: { caminho: '/r/bin/yt-dlp', origem: 'embutido' },
  ffmpeg: { caminho: '/r/bin/ffmpeg', origem: 'embutido' },
  ffprobe: null,
  pastaBin: '/r/bin',
};

describe('ambiente da API e do worker (contrato com o J114)', () => {
  const entrada = {
    recursos: RECURSOS, pastasDoApp: pastasDoApp('/u'), biblioteca: pastasDaBiblioteca('/docs/Margem'),
    portaDaApi: 8730, urlDoBanco: 'postgres://margem:x@127.0.0.1:5999/margem', raiz: '/r/margem', sistema: 'linux' as const,
  };

  it('define as variáveis do contrato', () => {
    const ambiente = ambienteDosFilhos({ ...entrada, base: { PATH: '/usr/bin', HOME: '/h' } });
    expect(ambiente).toMatchObject({
      MARGEM_MODO: 'instalado', MARGEM_APP_DESKTOP: '1', MARGEM_ENDERECO: '127.0.0.1', MARGEM_PORTA: '8730',
      DATABASE_URL: entrada.urlDoBanco, MARGEM_DADOS: '/docs/Margem', CODEX_HOME: '/u/codex',
      MARGEM_CODEX_MOTOR: '/r/bin/codex', MARGEM_MOTOR: '/r/motor/margem-motor', MARGEM_YT_DLP: '/r/bin/yt-dlp',
      MARGEM_FFMPEG: '/r/bin/ffmpeg', MARGEM_FONTE: '/r/fontes/DejaVuSans.ttf', MARGEM_RAIZ: '/r/margem',
      MARGEM_MODELO: 'conta', MARGEM_SLOTS: '2', MARGEM_EXTENSOES: EXTENSAO_PADRAO, PATH: '/r/bin:/usr/bin', HOME: '/h',
    });
    expect('MARGEM_FFPROBE' in ambiente).toBe(false);
    expect('MARGEM_RECURSOS' in ambiente).toBe(false);
    expect('MARGEM_AVISOS' in ambiente).toBe(false);
    expect('MARGEM_ARTE_DIR' in ambiente).toBe(false);
  });

  it('L-06: o worker recebe o pg_ctl e a pasta do cluster para parar o banco se o app sumir', () => {
    const ambiente = ambienteDosFilhos({ ...entrada, base: { MARGEM_PG_CTL: '/velho' }, banco: { pgCtl: '/r/pg/bin/pg_ctl', pasta: '/docs/Margem/.margem/banco' } });
    expect(ambiente).toMatchObject({ MARGEM_PG_CTL: '/r/pg/bin/pg_ctl', MARGEM_PG_DADOS: '/docs/Margem/.margem/banco' });
    expect(ambienteDosFilhos({ ...entrada, base: { MARGEM_PG_CTL: '/velho' } }).MARGEM_PG_CTL).toBeUndefined();
  });

  it('acrescenta as variáveis do confinamento e os avisos', () => {
    const ambiente = ambienteDosFilhos({ ...entrada, base: { MARGEM_AVISOS: 'velho' }, extras: { MARGEM_CONFINAMENTO: 'nativo' }, avisos: ['um', 'dois'] });
    expect(ambiente.MARGEM_CONFINAMENTO).toBe('nativo');
    expect(ambiente.MARGEM_AVISOS).toBe('um\ndois');
  });

  it('a pessoa manda em modelo, slots, extensões e recursos; PG* e caminhos velhos saem', () => {
    const ambiente = ambienteDosFilhos({
      ...entrada,
      base: { Path: 'C:\\x', MARGEM_MODELO: 'gpt-x', MARGEM_SLOTS: '1', MARGEM_EXTENSOES: 'abc', MARGEM_RECURSOS: 'noticias', PGPASSWORD: 'p', MARGEM_FFPROBE: '/velho' },
      sistema: 'win32',
    });
    expect(ambiente).toMatchObject({ MARGEM_MODELO: 'gpt-x', MARGEM_SLOTS: '1', MARGEM_EXTENSOES: 'abc', MARGEM_RECURSOS: 'noticias', PATH: '/r/bin;C:\\x' });
    expect(ambiente.PGPASSWORD).toBeUndefined();
    expect(ambiente.Path).toBeUndefined();
    expect(ambiente.MARGEM_FFPROBE).toBeUndefined();
  });
});

describe('confinamento do Codex no Linux', () => {
  it('bwrap funcionando: o padrão do serviço (nada a acrescentar)', async () => {
    const d = await decidirConfinamento({ sistema: 'linux', ambiente: {}, testar: () => Promise.resolve({ ok: true, detalhe: '' }) });
    expect(d).toMatchObject({ variaveis: {}, aviso: null });
  });
  it('bwrap ausente ou bloqueado: nativo, com aviso', async () => {
    const testadas: string[] = [];
    const d = await decidirConfinamento({
      sistema: 'linux', ambiente: { MARGEM_BWRAP: '/opt/bwrap' },
      testar: (b) => { testadas.push(b); return Promise.resolve({ ok: false, detalhe: 'setting up uid map: Permission denied' }); },
    });
    expect(testadas).toEqual(['/opt/bwrap']);
    expect(d.variaveis).toEqual({ MARGEM_CONFINAMENTO: 'nativo' });
    expect(d.aviso).toMatch(/bubblewrap/);
  });
  it('escolha da pessoa e fora do Linux: nada é testado', async () => {
    const nunca = () => Promise.reject(new Error('não devia testar'));
    expect((await decidirConfinamento({ sistema: 'linux', ambiente: { MARGEM_CONFINAMENTO: 'bwrap' }, testar: nunca })).variaveis).toEqual({});
    expect((await decidirConfinamento({ sistema: 'darwin', ambiente: {}, testar: nunca })).aviso).toBeNull();
  });
});

describe('S-02: segredos fora da biblioteca', () => {
  it('o serviço grava os segredos na pasta do app', () => {
    const ambiente = ambienteDosFilhos({
      recursos: RECURSOS, pastasDoApp: pastasDoApp('/u'), biblioteca: pastasDaBiblioteca('/Dropbox/Margem'), base: { MARGEM_SEGREDOS: '/Dropbox/Margem/segredos' },
      portaDaApi: 8730, urlDoBanco: 'postgres://margem:x@127.0.0.1:5999/margem', raiz: '/r/margem', sistema: 'linux',
    });
    expect(ambiente.MARGEM_SEGREDOS?.startsWith(pastasDoApp('/u').segredos)).toBe(true);
    expect(ambiente.MARGEM_SEGREDOS?.startsWith('/Dropbox')).toBe(false);
  });

  it('R-04: cada biblioteca tem a sua pasta de segredos: a chave de A não toma o lugar da de B', async () => {
    const raiz = await mkdtemp(join(tmpdir(), 'margem-segredos-'));
    try {
      const app = pastasDoApp(join(raiz, 'app'));
      const chaves: Record<string, string> = { A: 'sk_chave-da-a-111111111111', B: 'sk_chave-da-b-222222222222' };
      const destinos: string[] = [];
      for (const nome of ['A', 'B']) {
        const biblioteca = join(raiz, 'Dropbox', nome);
        await mkdir(join(biblioteca, 'segredos'), { recursive: true });
        await writeFile(join(biblioteca, 'segredos', 'elevenlabs.chave'), chaves[nome] ?? '');
        const pastas = pastasDaBiblioteca(biblioteca, { id: nome === 'A' ? 'a'.repeat(24) : 'b'.repeat(24) });
        const destino = ambienteDosFilhos({
          recursos: RECURSOS, pastasDoApp: app, biblioteca: pastas, base: {},
          portaDaApi: 8730, urlDoBanco: 'postgres://margem:x@127.0.0.1:5999/margem', raiz: '/r/margem', sistema: 'linux',
        }).MARGEM_SEGREDOS ?? '';
        destinos.push(destino);
        expect(await migrarSegredosDaBiblioteca(biblioteca, destino)).toEqual([{ arquivo: 'elevenlabs.chave', desfecho: 'migrado' }]);
      }
      expect(destinos[0]).not.toBe(destinos[1]);
      expect(await readFile(join(destinos[0] ?? '', 'elevenlabs.chave'), 'utf8')).toBe(chaves.A);
      expect(await readFile(join(destinos[1] ?? '', 'elevenlabs.chave'), 'utf8')).toBe(chaves.B);
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });

  it('a chave antiga da biblioteca é copiada, conferida e apagada; nada dela fica na biblioteca', async () => {
    const raiz = await mkdtemp(join(tmpdir(), 'margem-segredos-'));
    try {
      const biblioteca = join(raiz, 'Dropbox', 'Margem');
      const segredos = join(raiz, 'app', 'segredos');
      await mkdir(join(biblioteca, 'segredos'), { recursive: true });
      await writeFile(join(biblioteca, 'segredos', 'elevenlabs.chave'), 'sk_chave-ficticia-1234567890');
      expect(await migrarSegredosDaBiblioteca(biblioteca, segredos)).toEqual([{ arquivo: 'elevenlabs.chave', desfecho: 'migrado' }]);
      expect(await readFile(join(segredos, 'elevenlabs.chave'), 'utf8')).toBe('sk_chave-ficticia-1234567890');
      expect(existsSync(join(biblioteca, 'segredos'))).toBe(false);
      const restos = await readdir(biblioteca, { recursive: true });
      for (const arquivo of restos) {
        const caminho = join(biblioteca, String(arquivo));
        if (existsSync(caminho) && !statSync(caminho).isDirectory()) expect(await readFile(caminho, 'utf8')).not.toContain('sk_chave');
      }
      // A mesma chave voltou (o sincronizador): a cópia da biblioteca sai.
      await mkdir(join(biblioteca, 'segredos'), { recursive: true });
      await writeFile(join(biblioteca, 'segredos', 'elevenlabs.chave'), 'sk_chave-ficticia-1234567890');
      expect(await migrarSegredosDaBiblioteca(biblioteca, segredos)).toEqual([{ arquivo: 'elevenlabs.chave', desfecho: 'ja_havia' }]);
      expect(existsSync(join(biblioteca, 'segredos'))).toBe(false);
      // R-04: outra chave na biblioteca: nada é apagado; a do app vale e a da biblioteca fica.
      await mkdir(join(biblioteca, 'segredos'), { recursive: true });
      await writeFile(join(biblioteca, 'segredos', 'elevenlabs.chave'), 'sk_outra-mais-antiga-0000000');
      expect(await migrarSegredosDaBiblioteca(biblioteca, segredos)).toEqual([{ arquivo: 'elevenlabs.chave', desfecho: 'conflito' }]);
      expect(await readFile(join(segredos, 'elevenlabs.chave'), 'utf8')).toBe('sk_chave-ficticia-1234567890');
      expect(await readFile(join(biblioteca, 'segredos', 'elevenlabs.chave'), 'utf8')).toBe('sk_outra-mais-antiga-0000000');
      await rm(join(biblioteca, 'segredos'), { recursive: true });
      // Sem nada a migrar, nada acontece.
      expect(await migrarSegredosDaBiblioteca(biblioteca, segredos)).toEqual([]);
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});
