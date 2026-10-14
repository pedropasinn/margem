import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plataformaAtual } from '../src/nucleo/plataforma.js';
import {
  argumentosDaParada, argumentosDaSubida, argumentosDoInitdb, ambienteDoPostgres, conferirEspaco, configuracaoDoCluster,
  ErroDoBanco, inicializarCluster, lerLock, lerVersaoPrincipal, mensagemDeVersaoDiferente, parar, pareceDiscoCheio, pareceSemPorta,
  HBA_GUARDADO, hbaDaRedefinicao, redefinirSenha, restaurarHbaSeFicou, subir, tratarLockVelho, urlDoBanco, versaoDoCluster, versaoDosBinarios, type Executar,
} from '../src/nucleo/postgres.js';
import type { BinariosDoPostgres } from '../src/nucleo/recursos.js';
import { portaDoSistema } from '../src/nucleo/porta.js';

const FALSOS: BinariosDoPostgres = { initdb: '/pg/bin/initdb', pgCtl: '/pg/bin/pg_ctl', postgres: '/pg/bin/postgres', origem: 'embutido' };

let pasta = '';
beforeAll(async () => { pasta = await mkdtemp(join(tmpdir(), 'margem-postgres-')); });
afterAll(async () => { await rm(pasta, { recursive: true, force: true }); });

describe('configuração do Postgres', () => {
  it('lê versões', () => {
    expect(lerVersaoPrincipal('postgres (PostgreSQL) 18.4')).toBe(18);
    expect(lerVersaoPrincipal('18\n')).toBe(18);
    expect(lerVersaoPrincipal('lixo')).toBeNull();
    expect(mensagemDeVersaoDiferente(17, 18)).toMatch(/PostgreSQL 17.*PostgreSQL 18/s);
    expect(mensagemDeVersaoDiferente(19, 18)).toMatch(/Atualize o Margem/);
  });

  it('só 127.0.0.1, sem soquete Unix, scram', () => {
    const conf = configuracaoDoCluster();
    expect(conf).toContain("listen_addresses = '127.0.0.1'");
    expect(conf).toContain("unix_socket_directories = ''");
    expect(conf).toContain("password_encryption = 'scram-sha-256'");
    expect(argumentosDoInitdb('/b', '/s/pw')).toEqual(expect.arrayContaining(['-D', '/b', '-U', 'margem', '--auth=scram-sha-256', '--pwfile=/s/pw', '--no-locale']));
    expect(argumentosDaSubida('/b', 5555, '/l/pg.log')).toEqual(['start', '-D', '/b', '-w', '-t', '90', '-l', '/l/pg.log', '-o', '-p 5555']);
    expect(argumentosDaParada('/b')).toEqual(['stop', '-D', '/b', '-m', 'fast', '-w', '-t', '300']);
  });

  it('URL com a senha codificada e só loopback', () => {
    expect(urlDoBanco('a/b+c', 5433)).toBe('postgres://margem:a%2Fb%2Bc@127.0.0.1:5433/margem');
  });

  it('o ambiente dos binários não leva PG* nem DATABASE_URL', () => {
    const ambiente = ambienteDoPostgres({ PATH: '/x', PGPORT: '1', PGDATA: '/y', DATABASE_URL: 'z', HOME: '/h' });
    expect(ambiente).toMatchObject({ PATH: '/x', HOME: '/h', LC_MESSAGES: 'C' });
    expect(ambiente.PGPORT).toBeUndefined();
    expect(ambiente.DATABASE_URL).toBeUndefined();
  });

  it('reconhece disco cheio e porta ocupada', () => {
    expect(pareceDiscoCheio('could not write: No space left on device')).toBe(true);
    expect(pareceSemPorta('LOG:  could not bind IPv4 address "127.0.0.1": Address already in use')).toBe(true);
    expect(pareceSemPorta('tudo certo')).toBe(false);
  });

  it('pouco espaço vira erro claro', async () => {
    await expect(conferirEspaco(pasta, Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({ codigo: 'disco_cheio' });
    await expect(conferirEspaco(pasta, 1)).resolves.toBeUndefined();
  });
});

describe('initdb, subida e parada (executor simulado)', () => {
  it('initdb recebe a senha por arquivo 0600, apagado depois, e o cluster ganha a configuração', async () => {
    const banco = join(pasta, 'banco-a');
    let visto: { modo: number; conteudo: string } | null = null;
    const executar: Executar = async (_arquivo, argumentos) => {
      const arquivo = argumentos.find((a) => a.startsWith('--pwfile='))?.slice('--pwfile='.length) ?? '';
      visto = { modo: (await stat(arquivo)).mode & 0o777, conteudo: await readFile(arquivo, 'utf8') };
      await mkdir(banco, { recursive: true });
      await writeFile(join(banco, 'postgresql.conf'), '# padrão\n');
      return { codigo: 0, saida: '' };
    };
    await inicializarCluster(FALSOS, banco, 'segredo-segredo-123', join(pasta, 'tmp'), executar);
    expect(visto).toEqual({ modo: process.platform === 'win32' ? expect.any(Number) as number : 0o600, conteudo: 'segredo-segredo-123\n' });
    expect(await readFile(join(banco, 'postgresql.conf'), 'utf8')).toContain("listen_addresses = '127.0.0.1'");
    const sobras = existsSync(join(pasta, 'tmp')) ? (await import('node:fs')).readdirSync(join(pasta, 'tmp')) : [];
    expect(sobras).toEqual([]);
  });

  it('initdb sem espaço vira disco_cheio', async () => {
    const executar: Executar = () => Promise.resolve({ codigo: 1, saida: 'initdb: error: could not write file: No space left on device' });
    await expect(inicializarCluster(FALSOS, join(pasta, 'banco-b'), 's', join(pasta, 'tmp'), executar)).rejects.toMatchObject({ codigo: 'disco_cheio' });
  });

  it('subida com porta ocupada vira erro "porta"', async () => {
    const log = join(pasta, 'pg.log');
    await writeFile(log, 'LOG: could not bind IPv4 address "127.0.0.1": Address already in use\n');
    const executar: Executar = () => Promise.resolve({ codigo: 1, saida: 'pg_ctl: could not start server' });
    await expect(subir(FALSOS, join(pasta, 'x'), 5432, log, executar)).rejects.toMatchObject({ codigo: 'porta' });
  });

  it('versão dos binários ilegível vira binarios_ausentes', async () => {
    await expect(versaoDosBinarios(FALSOS, () => Promise.resolve({ codigo: 127, saida: 'not found' }))).rejects.toBeInstanceOf(ErroDoBanco);
  });

  it('senha redefinida pelo pg_ctl com pg_hba.conf temporário, sem postgres --single (V-W8)', async () => {
    const banco = join(pasta, 'redefinir');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'pg_hba.conf'), 'host all all 127.0.0.1/32 scram-sha-256\n');
    const chamadas: string[][] = [];
    const hbaNaSubida: string[] = [];
    const alteradas: { porta: number; senha: string }[] = [];
    await redefinirSenha(FALSOS, banco, "abc'd", {
      porta: 55432, arquivoDeLog: join(pasta, 'redefinir.log'),
      executarSubida: async (_a, argumentos) => {
        chamadas.push([...argumentos]);
        hbaNaSubida.push(await readFile(join(banco, 'pg_hba.conf'), 'utf8'));
        await writeFile(join(banco, 'postmaster.pid'), '1\n');
        return { codigo: 0, saida: '' };
      },
      executar: async (_a, argumentos) => { chamadas.push([...argumentos]); await rm(join(banco, 'postmaster.pid'), { force: true }); return { codigo: 0, saida: '' }; },
      alterar: (porta, senha) => { alteradas.push({ porta, senha }); return Promise.resolve(); },
    });
    expect(chamadas).toEqual([argumentosDaSubida(banco, 55432, join(pasta, 'redefinir.log')), argumentosDaParada(banco)]);
    expect(chamadas.flat()).not.toContain('--single');
    // Na subida, só o usuário do app no banco postgres por 127.0.0.1 é confiável.
    expect(hbaNaSubida[0]).toBe(hbaDaRedefinicao());
    expect(hbaDaRedefinicao().split('\n').filter((linha) => linha !== '' && !linha.startsWith('#'))).toEqual(['host postgres margem 127.0.0.1/32 trust']);
    expect(alteradas).toEqual([{ porta: 55432, senha: "abc'd" }]);
    // Depois, o original de volta e nada do temporário.
    expect(await readFile(join(banco, 'pg_hba.conf'), 'utf8')).toBe('host all all 127.0.0.1/32 scram-sha-256\n');
    expect(existsSync(join(banco, HBA_GUARDADO))).toBe(false);
  });

  it('redefinição: falha no ALTER ainda para o servidor e devolve o pg_hba.conf; queda no meio é desfeita na próxima', async () => {
    const banco = join(pasta, 'redefinir-falha');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'pg_hba.conf'), 'original\n');
    const chamadas: string[] = [];
    await expect(redefinirSenha(FALSOS, banco, 'x'.repeat(20), {
      porta: 1, arquivoDeLog: join(pasta, 'f.log'),
      executarSubida: () => Promise.resolve({ codigo: 0, saida: '' }),
      executar: (_a, argumentos) => { chamadas.push(argumentos[0] ?? ''); return Promise.resolve({ codigo: 0, saida: '' }); },
      alterar: () => Promise.reject(new Error('conexão recusada')),
    })).rejects.toMatchObject({ codigo: 'senha' });
    expect(chamadas).toEqual(['stop']);
    expect(await readFile(join(banco, 'pg_hba.conf'), 'utf8')).toBe('original\n');
    // Subida recusada: nada para parar, original de volta.
    await expect(redefinirSenha(FALSOS, banco, 'x'.repeat(20), {
      porta: 1, arquivoDeLog: join(pasta, 'f.log'),
      executarSubida: () => Promise.resolve({ codigo: 1, saida: 'FATAL: could not start' }),
      alterar: () => Promise.reject(new Error('não devia chamar')),
    })).rejects.toMatchObject({ codigo: 'senha' });
    expect(await readFile(join(banco, 'pg_hba.conf'), 'utf8')).toBe('original\n');
    // Queda no meio: o temporário ficou e o original estava guardado.
    await writeFile(join(banco, HBA_GUARDADO), 'original\n');
    await writeFile(join(banco, 'pg_hba.conf'), hbaDaRedefinicao());
    expect(await restaurarHbaSeFicou(banco)).toBe(true);
    expect(await readFile(join(banco, 'pg_hba.conf'), 'utf8')).toBe('original\n');
    expect(await restaurarHbaSeFicou(banco)).toBe(false);
  });
});

describe('lock velho', () => {
  it('lê o postmaster.pid', () => {
    expect(lerLock('4242\n/dados/banco\n1700000000\n5433\n\n127.0.0.1\n')).toEqual({ pid: 4242, pasta: '/dados/banco', porta: 5433 });
    expect(lerLock('')).toBeNull();
  });

  it('pid morto: o arquivo sai e nada é parado', async () => {
    const banco = join(pasta, 'lock-morto');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'postmaster.pid'), `999999\n${banco}\n1\n5433\n`);
    const chamadas: string[] = [];
    const decisao = await tratarLockVelho(FALSOS, banco, {
      ehPostgres: () => Promise.resolve(false),
      executar: (a) => { chamadas.push(a); return Promise.resolve({ codigo: 0, saida: '' }); },
    });
    expect(decisao).toBe('lock_velho_removido');
    expect(existsSync(join(banco, 'postmaster.pid'))).toBe(false);
    expect(chamadas).toEqual([]);
  });

  it('Postgres órfão vivo: pg_ctl stop -m fast', async () => {
    const banco = join(pasta, 'lock-vivo');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'postmaster.pid'), `1234\n${banco}\n1\n5433\n`);
    const chamadas: (readonly string[])[] = [];
    const decisao = await tratarLockVelho(FALSOS, banco, {
      ehPostgres: (pid) => Promise.resolve(pid === 1234),
      executar: async (_a, argumentos) => { chamadas.push(argumentos); await rm(join(banco, 'postmaster.pid')); return { codigo: 0, saida: '' }; },
    });
    expect(decisao).toBe('orfao_parado');
    expect(chamadas[0]).toEqual(argumentosDaParada(banco));
  });

  it('sem lock, nada a fazer; parar sem lock é sucesso', async () => {
    expect(await tratarLockVelho(FALSOS, join(pasta, 'nada'))).toBe('sem_lock');
    expect(await parar(FALSOS, join(pasta, 'nada'), () => Promise.reject(new Error('não devia chamar')))).toBe(true);
  });
});

// Com os binários de verdade (desktop/recursos/<plataforma>/postgres), quando existirem: sem rede.
const pastaDosBinarios = resolve(import.meta.dirname, '..', 'recursos', (() => { try { return plataformaAtual(); } catch { return 'nenhuma'; } })(), 'postgres', 'bin');
const exe = (nome: string): string => join(pastaDosBinarios, process.platform === 'win32' ? `${nome}.exe` : nome);
const REAIS: BinariosDoPostgres = { initdb: exe('initdb'), pgCtl: exe('pg_ctl'), postgres: exe('postgres'), origem: 'embutido' };

describe.skipIf(!existsSync(REAIS.postgres))('Postgres embutido de verdade', () => {
  it('cria, sobe só em 127.0.0.1, recusa senha errada, para e reaproveita', { timeout: 120_000 }, async () => {
    const banco = join(pasta, 'real', 'banco');
    const log = join(pasta, 'real', 'pg.log');
    await mkdir(join(pasta, 'real'), { recursive: true });
    const versao = await versaoDosBinarios(REAIS);
    await inicializarCluster(REAIS, banco, 'senha-de-teste-123456', join(pasta, 'real', 'tmp'));
    expect(await versaoDoCluster(banco)).toBe(versao);
    const porta = await portaDoSistema();
    await subir(REAIS, banco, porta, log);
    try {
      const pg = (await import('pg')).default;
      const certo = new pg.Client({ connectionString: urlDoBanco('senha-de-teste-123456', porta, 'postgres') });
      await certo.connect();
      const { rows } = await certo.query<{ endereco: string }>("SELECT current_setting('listen_addresses') AS endereco");
      expect(rows[0]?.endereco).toBe('127.0.0.1');
      await certo.end();
      const errado = new pg.Client({ connectionString: urlDoBanco('outra', porta, 'postgres') });
      await expect(errado.connect()).rejects.toMatchObject({ code: '28P01' });
      await errado.end().catch(() => undefined);
    } finally {
      expect(await parar(REAIS, banco)).toBe(true);
    }
    expect(existsSync(join(banco, 'postmaster.pid'))).toBe(false);
    // Senha nova (biblioteca vinda de outro computador): pg_ctl com pg_hba.conf temporário, depois sobe e aceita.
    const hbaAntes = await readFile(join(banco, 'pg_hba.conf'), 'utf8');
    await redefinirSenha(REAIS, banco, 'senha-nova-abcdef', { porta: await portaDoSistema(), arquivoDeLog: log });
    expect(await readFile(join(banco, 'pg_hba.conf'), 'utf8')).toBe(hbaAntes);
    expect(existsSync(join(banco, 'postmaster.pid'))).toBe(false);
    const porta2 = await portaDoSistema();
    await subir(REAIS, banco, porta2, log);
    try {
      const pg = (await import('pg')).default;
      const cliente = new pg.Client({ connectionString: urlDoBanco('senha-nova-abcdef', porta2, 'postgres') });
      await cliente.connect();
      await cliente.end();
    } finally {
      await parar(REAIS, banco);
    }
  });
});
