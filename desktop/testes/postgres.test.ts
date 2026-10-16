import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plataformaAtual } from '../src/nucleo/plataforma.js';
import {
  argumentosDaParada, argumentosDaSubida, argumentosDoInitdb, ambienteDoPostgres, conferirEspaco, configuracaoDoCluster,
  ErroDoBanco, inicializarCluster, lerLock, lerVersaoPrincipal, mensagemDeVersaoDiferente, parar, pareceDiscoCheio, pareceSemPorta,
  HBA_GUARDADO, argumentosDoModoUnico, concluirLock, pastaDaLinhaDeComando, hbaDaRedefinicao, redefinirSenha, redefinirSenhaPeloServidor, restaurarHbaSeFicou, subir, tratarLockVelho, urlDoBanco, versaoDoCluster, versaoDosBinarios, type Executar,
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
    const executar: Executar = async () => {
      await writeFile(log, 'LOG: could not bind IPv4 address "127.0.0.1": Address already in use\n');
      return { codigo: 1, saida: 'pg_ctl: could not start server' };
    };
    await expect(subir(FALSOS, join(pasta, 'x'), 5432, log, executar)).rejects.toMatchObject({ codigo: 'porta' });
  });

  it('versão dos binários ilegível vira binarios_ausentes', async () => {
    await expect(versaoDosBinarios(FALSOS, () => Promise.resolve({ codigo: 127, saida: 'not found' }))).rejects.toBeInstanceOf(ErroDoBanco);
  });

  it('S-03: senha redefinida no modo monousuário, com o cluster parado e sem porta nem pg_hba.conf trocado', async () => {
    const banco = join(pasta, 'redefinir');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'pg_hba.conf'), 'host all all 127.0.0.1/32 scram-sha-256\n');
    const chamadas: { arquivo: string; argumentos: string[]; entrada?: string; hba: string }[] = [];
    await redefinirSenha(FALSOS, banco, "abc'd", {
      porta: 55432, arquivoDeLog: join(pasta, 'redefinir.log'),
      executar: async (arquivo, argumentos, entrada) => {
        chamadas.push({ arquivo, argumentos: [...argumentos], ...(entrada === undefined ? {} : { entrada }), hba: await readFile(join(banco, 'pg_hba.conf'), 'utf8') });
        return { codigo: 0, saida: 'PostgreSQL stand-alone backend 18.6\nbackend> backend>' };
      },
      executarSubida: () => Promise.reject(new Error('não devia subir o servidor')),
      alterar: () => Promise.reject(new Error('não devia conectar')),
    });
    expect(chamadas).toEqual([{
      arquivo: FALSOS.postgres, argumentos: argumentosDoModoUnico(banco), entrada: "ALTER ROLE margem WITH PASSWORD 'abc''d';\n",
      hba: 'host all all 127.0.0.1/32 scram-sha-256\n',
    }]);
    expect(argumentosDoModoUnico(banco)).toEqual(['--single', '-D', banco, 'postgres']);
    expect(existsSync(join(banco, HBA_GUARDADO))).toBe(false);
  });

  it('S-03: erro no modo monousuário (que sai com 0) vira erro, sem a senha no diagnóstico', async () => {
    const banco = join(pasta, 'redefinir-erro');
    await mkdir(banco, { recursive: true });
    const senha = 'segredo-que-nao-pode-vazar';
    const falha = await redefinirSenha(FALSOS, banco, senha, {
      porta: 1, arquivoDeLog: join(pasta, 'e.log'), plataforma: 'linux',
      executar: () => Promise.resolve({ codigo: 0, saida: `backend> ERROR:  role "margem" does not exist\nSTATEMENT:  ALTER ROLE margem WITH PASSWORD '${senha}';` }),
    }).catch((erro: unknown) => erro as ErroDoBanco);
    expect(falha).toMatchObject({ codigo: 'senha' });
    expect(falha?.detalhe).toContain('PASSWORD \'***\'');
    expect(falha?.detalhe).not.toContain(senha);
    // Fora do Windows, a recusa de administrador não abre o caminho com porta.
    await expect(redefinirSenha(FALSOS, banco, senha, {
      porta: 1, arquivoDeLog: join(pasta, 'e.log'), plataforma: 'linux',
      executar: () => Promise.resolve({ codigo: 1, saida: 'Execution of PostgreSQL by a user with administrative permissions is not permitted.' }),
      executarSubida: () => Promise.reject(new Error('não devia subir o servidor')),
    })).rejects.toMatchObject({ codigo: 'senha' });
  });

  it('Windows como administrador: cai na subida curta pelo pg_ctl com pg_hba.conf temporário (V-W8)', async () => {
    const banco = join(pasta, 'redefinir-admin');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'pg_hba.conf'), 'host all all 127.0.0.1/32 scram-sha-256\n');
    const chamadas: string[][] = [];
    const hbaNaSubida: string[] = [];
    const alteradas: { porta: number; senha: string }[] = [];
    await redefinirSenha(FALSOS, banco, "abc'd", {
      porta: 55432, arquivoDeLog: join(pasta, 'redefinir.log'), plataforma: 'win32',
      executarSubida: async (_a, argumentos) => {
        chamadas.push([...argumentos]);
        hbaNaSubida.push(await readFile(join(banco, 'pg_hba.conf'), 'utf8'));
        await writeFile(join(banco, 'postmaster.pid'), '1\n');
        return { codigo: 0, saida: '' };
      },
      executar: async (_a, argumentos) => {
        chamadas.push([...argumentos]);
        if (argumentos[0] === '--single') return { codigo: 1, saida: 'Execution of PostgreSQL by a user with administrative permissions is not\npermitted.' };
        await rm(join(banco, 'postmaster.pid'), { force: true });
        return { codigo: 0, saida: '' };
      },
      alterar: (porta, senha) => { alteradas.push({ porta, senha }); return Promise.resolve(); },
    });
    expect(chamadas).toEqual([argumentosDoModoUnico(banco), argumentosDaSubida(banco, 55432, join(pasta, 'redefinir.log')), argumentosDaParada(banco)]);
    expect(hbaNaSubida[0]).toBe(hbaDaRedefinicao());
    expect(hbaDaRedefinicao().split('\n').filter((linha) => linha !== '' && !linha.startsWith('#'))).toEqual(['host postgres margem 127.0.0.1/32 trust']);
    expect(alteradas).toEqual([{ porta: 55432, senha: "abc'd" }]);
    expect(await readFile(join(banco, 'pg_hba.conf'), 'utf8')).toBe('host all all 127.0.0.1/32 scram-sha-256\n');
    expect(existsSync(join(banco, HBA_GUARDADO))).toBe(false);
  });

  it('caminho do administrador: falha no ALTER ainda para o servidor e devolve o pg_hba.conf; queda no meio é desfeita na próxima', async () => {
    const banco = join(pasta, 'redefinir-falha');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'pg_hba.conf'), 'original\n');
    const chamadas: string[] = [];
    await expect(redefinirSenhaPeloServidor(FALSOS, banco, 'x'.repeat(20), {
      porta: 1, arquivoDeLog: join(pasta, 'f.log'),
      executarSubida: () => Promise.resolve({ codigo: 0, saida: '' }),
      executar: (_a, argumentos) => { chamadas.push(argumentos[0] ?? ''); return Promise.resolve({ codigo: 0, saida: '' }); },
      alterar: () => Promise.reject(new Error('conexão recusada')),
    })).rejects.toMatchObject({ codigo: 'senha' });
    expect(chamadas).toEqual(['stop']);
    expect(await readFile(join(banco, 'pg_hba.conf'), 'utf8')).toBe('original\n');
    // Subida recusada: nada para parar, original de volta.
    await expect(redefinirSenhaPeloServidor(FALSOS, banco, 'x'.repeat(20), {
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
    expect(lerLock('4242\n/dados/banco\n1700000000\n5433\n\n127.0.0.1\n')).toEqual({ pid: 4242, pasta: '/dados/banco', inicio: 1700000000, porta: 5433 });
    expect(lerLock('')).toBeNull();
  });

  it('pid morto: o arquivo sai e nada é parado', async () => {
    const banco = join(pasta, 'lock-morto');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'postmaster.pid'), `999999\n${banco}\n1\n5433\n`);
    const chamadas: string[] = [];
    const decisao = await tratarLockVelho(FALSOS, banco, {
      identificar: () => Promise.resolve({ vivo: false, postgres: false, pasta: null, inicio: null }),
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
      identificar: (pid) => Promise.resolve({ vivo: true, postgres: pid === 1234, pasta: banco, inicio: null }),
      executar: async (_a, argumentos) => { chamadas.push(argumentos); await rm(join(banco, 'postmaster.pid')); return { codigo: 0, saida: '' }; },
    });
    expect(decisao).toBe('orfao_parado');
    expect(chamadas[0]).toEqual(argumentosDaParada(banco));
  });

  it('L-04: pid reaproveitado por outro Postgres (outra pasta ou outro início) não é parado; o lock velho sai', async () => {
    const banco = join(pasta, 'lock-reaproveitado');
    await mkdir(banco, { recursive: true });
    const nunca: Executar = () => Promise.reject(new Error('não devia parar ninguém'));
    for (const outro of [
      { vivo: true, postgres: true, pasta: '/var/lib/postgresql/16/main', inicio: null },
      { vivo: true, postgres: true, pasta: null, inicio: 1_800_000_000 },
      { vivo: true, deOutroUsuario: true, postgres: false, pasta: null, inicio: null },
    ]) {
      await writeFile(join(banco, 'postmaster.pid'), `1234\n${banco}\n1700000000\n5433\n`);
      expect(await tratarLockVelho(FALSOS, banco, { identificar: () => Promise.resolve(outro), executar: nunca })).toBe('lock_velho_removido');
      expect(existsSync(join(banco, 'postmaster.pid'))).toBe(false);
    }
  });

  it('L-04: o mesmo início sem a pasta é o órfão; sem pasta nem início, erro recuperável e nada é parado nem apagado', async () => {
    const banco = join(pasta, 'lock-incerto');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'postmaster.pid'), `1234\n${banco}\n1700000000\n5433\n`);
    const nunca: Executar = () => Promise.reject(new Error('não devia parar ninguém'));
    await expect(tratarLockVelho(FALSOS, banco, {
      identificar: () => Promise.resolve({ vivo: true, postgres: true, pasta: null, inicio: null }), executar: nunca,
    })).rejects.toMatchObject({ codigo: 'lock_incerto' });
    expect(existsSync(join(banco, 'postmaster.pid'))).toBe(true);
    const paradas: string[] = [];
    expect(await tratarLockVelho(FALSOS, banco, {
      identificar: () => Promise.resolve({ vivo: true, postgres: true, pasta: null, inicio: 1700000002 }),
      executar: async (_a, argumentos) => { paradas.push(argumentos[0] ?? ''); await rm(join(banco, 'postmaster.pid')); return { codigo: 0, saida: '' }; },
    })).toBe('orfao_parado');
    expect(paradas).toEqual(['stop']);
    // Caixa e barras não importam no Windows.
    expect(concluirLock({ pid: 1, pasta: null, inicio: null, porta: null }, { vivo: true, postgres: true, pasta: 'C:\\USERS\\ana\\Banco', inicio: null }, ['c:/Users/Ana/banco'], 'win32')).toBe('nosso');
    expect(pastaDaLinhaDeComando('"C:\\pg\\postgres.exe" -D "C:\\Users\\Ana\\banco" -p 5433')).toBe('C:\\Users\\Ana\\banco');
  });

  it('R-01: processo vivo que o sistema não identificou (PowerShell/CIM falhou) não vira lock velho: nada é parado nem apagado', async () => {
    const banco = join(pasta, 'lock-desconhecido');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'postmaster.pid'), `1234\n${banco}\n1700000000\n5433\n`);
    const nunca: Executar = () => Promise.reject(new Error('não devia parar ninguém'));
    const desconhecido = { vivo: true, desconhecido: true, postgres: false, pasta: null, inicio: null };
    expect(concluirLock({ pid: 1234, pasta: banco, inicio: 1700000000, porta: 5433 }, desconhecido, [banco], 'win32')).toBe('incerto');
    await expect(tratarLockVelho(FALSOS, banco, { identificar: () => Promise.resolve(desconhecido), executar: nunca }))
      .rejects.toMatchObject({ codigo: 'lock_incerto' });
    expect(existsSync(join(banco, 'postmaster.pid'))).toBe(true);
    // Não é Postgres (o sistema disse quem é): o lock é velho, como antes.
    expect(concluirLock({ pid: 1234, pasta: banco, inicio: null, porta: null }, { vivo: true, postgres: false, pasta: null, inicio: null }, [banco])).toBe('velho');
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
      // L-08: o coletor escreve em <cluster>/log/postgres-HH.log; girar à força não cria arquivo novo além das 24 horas.
      const outro = new pg.Client({ connectionString: urlDoBanco('senha-de-teste-123456', porta, 'postgres') });
      await outro.connect();
      await outro.query('SELECT pg_rotate_logfile()');
      await outro.end();
      const { readdirSync } = await import('node:fs');
      const registros = readdirSync(join(banco, 'log'));
      expect(registros.length).toBeGreaterThan(0);
      expect(registros.every((nome) => /^postgres-\d{2}\.log$/u.test(nome))).toBe(true);
    } finally {
      expect(await parar(REAIS, banco)).toBe(true);
    }
    expect(existsSync(join(banco, 'postmaster.pid'))).toBe(false);
    // Senha nova (biblioteca vinda de outro computador): modo monousuário com o cluster parado, depois sobe e aceita.
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

describe('registros do Postgres (L-08)', () => {
  it('cauda lida por posição, sem carregar o arquivo inteiro, e só o que veio depois do marco', async () => {
    const { lerCauda, caudaDosRegistros, marcoDosRegistros } = await import('../src/nucleo/postgres.js');
    const grande = join(pasta, 'grande.log');
    await writeFile(grande, `${'x'.repeat(20 * 1024 * 1024)}\nFIM`);
    const cauda = await lerCauda(grande, 100);
    expect(cauda.length).toBe(100);
    expect(cauda.endsWith('\nFIM')).toBe(true);
    // Mensagem velha (outra sessão) antes do marco não entra no diagnóstico.
    const log = join(pasta, 'marco.log');
    await writeFile(log, 'LOG: could not bind IPv4 address\n');
    const marco = await marcoDosRegistros(log);
    await writeFile(log, 'LOG: could not bind IPv4 address\nFATAL: outra coisa\n');
    expect(await caudaDosRegistros(join(pasta, 'sem-cluster'), log, 4_000, marco)).toBe('FATAL: outra coisa\n');
  });

  it('rotação nativa no cluster; clusters antigos ganham o bloco uma vez', async () => {
    const { garantirConfiguracaoDosRegistros, MARCA_DOS_REGISTROS } = await import('../src/nucleo/postgres.js');
    expect(configuracaoDoCluster()).toContain('logging_collector = on');
    expect(configuracaoDoCluster()).toContain("log_filename = 'postgres-%H.log'");
    expect(configuracaoDoCluster()).toContain('log_truncate_on_rotation = on');
    const banco = join(pasta, 'conf-antigo');
    await mkdir(banco, { recursive: true });
    await writeFile(join(banco, 'postgresql.conf'), "# padrão\nlogging_collector = off\n");
    expect(await garantirConfiguracaoDosRegistros(banco)).toBe(true);
    expect(await garantirConfiguracaoDosRegistros(banco)).toBe(false);
    const conf = await readFile(join(banco, 'postgresql.conf'), 'utf8');
    expect(conf.split(MARCA_DOS_REGISTROS)).toHaveLength(2);
    expect(conf.lastIndexOf('logging_collector = on')).toBeGreaterThan(conf.indexOf('logging_collector = off'));
  });
});

describe.skipIf(!existsSync(REAIS.postgres) || process.platform === 'win32')('L-04 com dois clusters de verdade', () => {
  it('recuperar o lock de um não interrompe o outro; o órfão do próprio cluster é parado', { timeout: 120_000 }, async () => {
    const raiz = join(pasta, 'dois');
    const a = join(raiz, 'a');
    const b = join(raiz, 'b');
    const log = join(raiz, 'pg.log');
    await mkdir(raiz, { recursive: true });
    await inicializarCluster(REAIS, a, 'senha-de-teste-aaaaaa', join(raiz, 'tmp'));
    await inicializarCluster(REAIS, b, 'senha-de-teste-bbbbbb', join(raiz, 'tmp'));
    await subir(REAIS, a, await portaDoSistema(), log);
    try {
      const pidDeA = Number((await readFile(join(a, 'postmaster.pid'), 'utf8')).split('\n')[0]);
      // O lock velho de B aponta para o pid que agora é o servidor de A (pid reaproveitado).
      await writeFile(join(b, 'postmaster.pid'), `${String(pidDeA)}\n${b}\n1600000000\n5999\n`);
      expect(await tratarLockVelho(REAIS, b)).toBe('lock_velho_removido');
      expect(() => process.kill(pidDeA, 0)).not.toThrow();
      expect(existsSync(join(a, 'postmaster.pid'))).toBe(true);
      // A ainda no ar (o app caiu e o deixou): é o órfão do próprio cluster.
      expect(await tratarLockVelho(REAIS, a)).toBe('orfao_parado');
      expect(existsSync(join(a, 'postmaster.pid'))).toBe(false);
    } finally {
      await parar(REAIS, a);
    }
  });
});
