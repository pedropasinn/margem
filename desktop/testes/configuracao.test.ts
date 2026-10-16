import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  arquivoDaSenha, CONFIGURACAO_PADRAO, idDaBiblioteca, pastaDosBancosLocais, pastaSincronizada, gravarConfiguracao, lerConfiguracao, pastasDaBiblioteca, pastasDoApp, prepararPastasDoApp, senhaDaBiblioteca,
} from '../src/nucleo/configuracao.js';

let pasta = '';
beforeAll(async () => { pasta = await mkdtemp(join(tmpdir(), 'margem-config-')); });
afterAll(async () => { await rm(pasta, { recursive: true, force: true }); });

describe('configuração do app', () => {
  it('banco e quadros dentro da biblioteca; segredos e CODEX_HOME no userData', () => {
    const b = pastasDaBiblioteca('/docs/Margem', { bancosLocais: '/home/x/.config/Margem/bancos', ambiente: {} });
    expect(b).toEqual({
      biblioteca: '/docs/Margem', id: idDaBiblioteca('/docs/Margem'), interna: '/docs/Margem/.margem', banco: '/docs/Margem/.margem/banco',
      bancoNaBiblioteca: '/docs/Margem/.margem/banco', sincronizada: null,
    });
    const a = pastasDoApp('/home/x/.config/Margem');
    expect(a.codexHome).toBe('/home/x/.config/Margem/codex');
    expect(a.segredos).toBe('/home/x/.config/Margem/segredos');
  });

  it('lê o padrão quando não há arquivo ou ele está estragado, e grava atômico', async () => {
    const caminho = join(pasta, 'config.json');
    expect(await lerConfiguracao(caminho)).toEqual(CONFIGURACAO_PADRAO);
    await writeFile(caminho, '{ estragado');
    expect(await lerConfiguracao(caminho)).toEqual(CONFIGURACAO_PADRAO);
    await gravarConfiguracao(caminho, { versao: 1, biblioteca: '/b', portaDaApi: 8731, portaDoBanco: 99999, bandeja: true, cofreDoObsidian: null });
    expect(await lerConfiguracao(caminho)).toEqual({ versao: 1, biblioteca: '/b', portaDaApi: 8731, portaDoBanco: null, bandeja: true, cofreDoObsidian: null });
  });

  it('senha por biblioteca, 0600, estável e diferente entre bibliotecas', async () => {
    const pastas = pastasDoApp(join(pasta, 'app'));
    await prepararPastasDoApp(pastas);
    if (process.platform !== 'win32') expect((await stat(pastas.segredos)).mode & 0o777).toBe(0o700);
    const primeira = await senhaDaBiblioteca(pastas.segredos, '/b1');
    expect(primeira.nova).toBe(true);
    expect(primeira.senha.length).toBeGreaterThanOrEqual(24);
    const segunda = await senhaDaBiblioteca(pastas.segredos, '/b1');
    expect(segunda).toEqual({ senha: primeira.senha, nova: false });
    expect((await senhaDaBiblioteca(pastas.segredos, '/b2')).senha).not.toBe(primeira.senha);
    const arquivo = arquivoDaSenha(pastas.segredos, '/b1');
    expect(arquivoDaSenha(pastas.segredos, '/Biblioteca Secreta')).not.toContain('Secreta');
    if (process.platform !== 'win32') expect((await stat(arquivo)).mode & 0o777).toBe(0o600);
    expect((await readFile(arquivo, 'utf8')).trim()).toBe(primeira.senha);
  });
});

describe('biblioteca em pasta sincronizada (V-W8)', () => {
  it('reconhece OneDrive, Dropbox, Google Drive e iCloud pelo caminho e pelas variáveis do OneDrive', () => {
    const w = (caminho: string, ambiente: NodeJS.ProcessEnv = {}) => pastaSincronizada(caminho, ambiente, 'win32');
    expect(w('C:\\Users\\usuario\\OneDrive\\Arquivos\\Margem')).toBe('OneDrive');
    expect(w('C:\\Users\\usuario\\OneDrive - Empresa\\Margem')).toBe('OneDrive');
    // Pasta do OneDrive com outro nome (redirecionada), achada pela variável.
    expect(w('D:\\Nuvem\\Margem', { OneDrive: 'D:\\Nuvem' })).toBe('OneDrive');
    expect(w('d:\\nuvem\\margem', { OneDriveConsumer: 'D:\\Nuvem\\' })).toBe('OneDrive');
    expect(w('D:\\NuvemOutra\\Margem', { OneDrive: 'D:\\Nuvem' })).toBeNull();
    expect(w('C:\\Users\\usuario\\Dropbox\\Margem')).toBe('Dropbox');
    expect(w('C:\\Users\\usuario\\Dropbox (Pessoal)\\Margem')).toBe('Dropbox');
    expect(w('G:\\Meu Drive\\Margem')).toBe('Google Drive');
    expect(w('G:\\My Drive\\Margem')).toBe('Google Drive');
    expect(w('C:\\Users\\usuario\\iCloudDrive\\Margem')).toBe('iCloud');
    expect(w('C:\\Users\\usuario\\Documents\\Margem')).toBeNull();
    const m = (caminho: string) => pastaSincronizada(caminho, {}, 'darwin');
    expect(m('/Users/usuario/Library/CloudStorage/OneDrive-Pessoal/Margem')).toBe('OneDrive');
    expect(m('/Users/usuario/Library/CloudStorage/GoogleDrive-pessoa@exemplo.com/Meu Drive/Margem')).toBe('Google Drive');
    expect(m('/Users/usuario/Library/CloudStorage/Dropbox/Margem')).toBe('Dropbox');
    expect(m('/Users/usuario/Library/Mobile Documents/com~apple~CloudDocs/Margem')).toBe('iCloud');
    expect(m('/Users/usuario/Documents/Margem')).toBeNull();
    expect(pastaSincronizada('/home/usuario/Dropbox/Margem', {}, 'linux')).toBe('Dropbox');
    expect(pastaSincronizada('/home/usuario/Documentos/Margem', {}, 'linux')).toBeNull();
  });

  it('banco sai da biblioteca para a pasta local do app; no Windows em %LOCALAPPDATA%', () => {
    expect(pastaDosBancosLocais('C:\\Users\\usuario\\AppData\\Roaming\\Margem', { LOCALAPPDATA: 'C:\\Users\\usuario\\AppData\\Local' }, 'win32'))
      .toBe('C:\\Users\\usuario\\AppData\\Local\\Margem\\bancos');
    expect(pastaDosBancosLocais('C:\\x', { USERPROFILE: 'C:\\Users\\ana' }, 'win32')).toBe('C:\\Users\\ana\\AppData\\Local\\Margem\\bancos');
    expect(pastaDosBancosLocais('/home/x/.config/Margem', {}, 'linux')).toBe('/home/x/.config/Margem/bancos');
    expect(pastasDoApp('/home/x/.config/Margem', {}, 'linux').bancosLocais).toBe('/home/x/.config/Margem/bancos');
    // D-06: as cópias ficam no armazenamento local, ao lado dos bancos.
    expect(pastasDoApp('/home/x/.config/Margem', {}, 'linux').copias).toBe('/home/x/.config/Margem/copias');
    expect(pastasDoApp('C:\\Users\\ana\\AppData\\Roaming\\Margem', { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' }, 'win32').copias)
      .toBe('C:\\Users\\ana\\AppData\\Local\\Margem\\copias');

    const b = pastasDaBiblioteca('/home/x/Dropbox/Margem', { bancosLocais: '/home/x/.config/Margem/bancos', ambiente: {} });
    expect(b.sincronizada).toBe('Dropbox');
    expect(b.bancoNaBiblioteca).toBe('/home/x/Dropbox/Margem/.margem/banco');
    expect(b.banco).toBe(`/home/x/.config/Margem/bancos/${idDaBiblioteca('/home/x/Dropbox/Margem')}`);
    // O id é o mesmo do arquivo da senha e não revela o caminho.
    expect(arquivoDaSenha('/s', '/home/x/Dropbox/Margem')).toBe(`/s/banco-${idDaBiblioteca('/home/x/Dropbox/Margem')}.senha`);
    expect(idDaBiblioteca('/home/x/Dropbox/Margem')).toMatch(/^[0-9a-f]{24}$/u);
  });
});
