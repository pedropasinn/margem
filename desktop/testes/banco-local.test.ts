/**
 * Banco de biblioteca em pasta sincronizada vai para a pasta local do app (V-W8, auditoria B-10).
 * Cluster falso (só arquivos): a cópia, a conferência e a ordem dos renames são o que importa aqui; a
 * subida de verdade fica para a fumaça.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { avisoDaPastaSincronizada, migrarBancoParaLocal } from '../src/nucleo/banco-local.js';
import { pastasDaBiblioteca } from '../src/nucleo/configuracao.js';
import { plataformaAtual } from '../src/nucleo/plataforma.js';
import { portaDoSistema } from '../src/nucleo/porta.js';
import { inicializarCluster, parar, redefinirSenha, subir, urlDoBanco, versaoDoCluster } from '../src/nucleo/postgres.js';
import type { BinariosDoPostgres } from '../src/nucleo/recursos.js';

const FALSOS: BinariosDoPostgres = { initdb: '/pg/bin/initdb', pgCtl: '/pg/bin/pg_ctl', postgres: '/pg/bin/postgres', origem: 'embutido' };
const AGORA = new Date('2026-10-14T15:30:00Z');

let raiz = '';
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), 'margem-banco-local-')); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });

async function clusterFalso(pasta: string): Promise<void> {
  await mkdir(join(pasta, 'base', '1'), { recursive: true });
  await mkdir(join(pasta, 'pg_wal'), { recursive: true });
  await writeFile(join(pasta, 'PG_VERSION'), '18\n');
  await writeFile(join(pasta, 'base', '1', '1259'), Buffer.alloc(8192, 7));
  await writeFile(join(pasta, 'pg_wal', '000000010000000000000001'), Buffer.alloc(16_384, 1));
  await writeFile(join(pasta, 'pg_hba.conf'), 'host all all 127.0.0.1/32 scram-sha-256\n');
}

function pastasNoDropbox() {
  return pastasDaBiblioteca(join(raiz, 'Dropbox', 'Minha Biblioteca'), { bancosLocais: join(raiz, 'app', 'bancos'), ambiente: {} });
}

describe('migração do banco para a pasta local', () => {
  it('copia, confere, troca de lugar e deixa o antigo renomeado com um LEIA-ME', async () => {
    const pastas = pastasNoDropbox();
    expect(pastas.sincronizada).toBe('Dropbox');
    await clusterFalso(pastas.bancoNaBiblioteca);
    const resultado = await migrarBancoParaLocal(FALSOS, pastas, { agora: AGORA, ehPostgres: () => Promise.resolve(false) });
    expect(resultado.desfecho).toBe('migrado');
    expect(resultado.antigoRenomeado).toBe(join(pastas.interna, 'banco.migrado-20261014-153000'));
    expect(await readFile(join(pastas.banco, 'PG_VERSION'), 'utf8')).toBe('18\n');
    expect((await readFile(join(pastas.banco, 'base', '1', '1259'))).length).toBe(8192);
    expect(existsSync(pastas.bancoNaBiblioteca)).toBe(false);
    expect(await readFile(join(resultado.antigoRenomeado!, 'LEIA-ME.txt'), 'utf8')).toMatch(/pode apagar esta pasta/u);
    // Nenhum temporário sobrando ao lado do destino.
    expect((await readdir(join(raiz, 'app', 'bancos'))).filter((nome) => nome.includes('migrando'))).toEqual([]);
    // Segunda abertura: o local já existe, nada muda.
    expect((await migrarBancoParaLocal(FALSOS, pastas)).desfecho).toBe('local_ja_existe');
  });

  it('postmaster.pid velho não viaja; Postgres órfão vivo na pasta antiga é parado antes da cópia', async () => {
    const pastas = pastasNoDropbox();
    await clusterFalso(pastas.bancoNaBiblioteca);
    await writeFile(join(pastas.bancoNaBiblioteca, 'postmaster.pid'), `4242\n${pastas.bancoNaBiblioteca}\n1\n5433\n`);
    const paradas: string[][] = [];
    const resultado = await migrarBancoParaLocal(FALSOS, pastas, {
      agora: AGORA,
      ehPostgres: () => Promise.resolve(true),
      executar: async (_a, argumentos) => { paradas.push([...argumentos]); await rm(join(pastas.bancoNaBiblioteca, 'postmaster.pid')); return { codigo: 0, saida: '' }; },
    });
    expect(resultado.desfecho).toBe('migrado');
    expect(paradas[0]?.slice(0, 3)).toEqual(['stop', '-D', pastas.bancoNaBiblioteca]);
    expect(existsSync(join(pastas.banco, 'postmaster.pid'))).toBe(false);
  });

  it('fora de pasta sincronizada, ou sem banco antigo, não faz nada', async () => {
    const local = pastasDaBiblioteca(join(raiz, 'Documentos', 'Margem'), { bancosLocais: join(raiz, 'app', 'bancos'), ambiente: {} });
    await clusterFalso(local.bancoNaBiblioteca);
    expect(await migrarBancoParaLocal(FALSOS, local)).toEqual({ desfecho: 'nada' });
    expect(local.banco).toBe(local.bancoNaBiblioteca);
    expect(avisoDaPastaSincronizada(local)).toBeNull();
    const vazia = pastasNoDropbox();
    expect(await migrarBancoParaLocal(FALSOS, vazia)).toEqual({ desfecho: 'nada' });
    expect(existsSync(vazia.banco)).toBe(false);
  });

  it('aviso claro para a tela de estado', () => {
    const aviso = avisoDaPastaSincronizada(pastasNoDropbox());
    expect(aviso).toMatch(/^A biblioteca está numa pasta do Dropbox\./u);
    expect(aviso).toContain('fica neste computador');
    expect(aviso).toContain('os livros continuam na pasta');
  });
});

// Com os binários de verdade (desktop/recursos/<plataforma>/postgres), quando existirem: sem rede.
const pastaDosBinarios = resolve(import.meta.dirname, '..', 'recursos', (() => { try { return plataformaAtual(); } catch { return 'nenhuma'; } })(), 'postgres', 'bin');
const exe = (nome: string): string => join(pastaDosBinarios, process.platform === 'win32' ? `${nome}.exe` : nome);
const REAIS: BinariosDoPostgres = { initdb: exe('initdb'), pgCtl: exe('pg_ctl'), postgres: exe('postgres'), origem: 'embutido' };

describe.skipIf(!existsSync(REAIS.postgres))('migração com o Postgres de verdade', () => {
  it('banco criado na biblioteca do Dropbox sobe da pasta local depois da migração, com os dados e a senha nova', { timeout: 120_000 }, async () => {
    const pastas = pastasNoDropbox();
    const log = join(raiz, 'pg.log');
    await inicializarCluster(REAIS, pastas.bancoNaBiblioteca, 'senha-antiga-123456', join(raiz, 'tmp'));
    const pg = (await import('pg')).default;
    const porta = await portaDoSistema();
    await subir(REAIS, pastas.bancoNaBiblioteca, porta, log);
    try {
      const cliente = new pg.Client({ connectionString: urlDoBanco('senha-antiga-123456', porta, 'postgres') });
      await cliente.connect();
      await cliente.query('CREATE TABLE marca (texto text)');
      await cliente.query("INSERT INTO marca VALUES ('sublinhado')");
      await cliente.end();
    } finally {
      await parar(REAIS, pastas.bancoNaBiblioteca);
    }
    const resultado = await migrarBancoParaLocal(REAIS, pastas);
    expect(resultado.desfecho).toBe('migrado');
    expect(await versaoDoCluster(pastas.banco)).not.toBeNull();
    // Outro computador, ou arquivo de senha perdido: senha nova pelo pg_ctl, no banco já local.
    await redefinirSenha(REAIS, pastas.banco, 'senha-nova-abcdef12', { porta: await portaDoSistema(), arquivoDeLog: log });
    const porta2 = await portaDoSistema();
    await subir(REAIS, pastas.banco, porta2, log);
    try {
      const cliente = new pg.Client({ connectionString: urlDoBanco('senha-nova-abcdef12', porta2, 'postgres') });
      await cliente.connect();
      const { rows } = await cliente.query<{ texto: string }>('SELECT texto FROM marca');
      expect(rows).toEqual([{ texto: 'sublinhado' }]);
      const { rows: [dados] } = await cliente.query<{ pasta: string }>("SELECT current_setting('data_directory') AS pasta");
      expect(dados!.pasta).toBe(pastas.banco);
      await cliente.end();
    } finally {
      expect(await parar(REAIS, pastas.banco)).toBe(true);
    }
  });
});
