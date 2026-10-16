/**
 * "Fazer cópia de segurança…" (U-03, W-01, D-01): a cópia leva a biblioteca inteira e o banco, sem
 * segredos; e a restauração, seguindo o LEIA-ME ao pé da letra, devolve notas e arquivos — num computador
 * novo e no mesmo computador por cima de um banco local mais novo.
 */
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FORA_DA_COPIA, MARCA_DE_RESTAURACAO, migrarBancoParaLocal, RESTAURACAO_CONCLUIDA } from '../src/nucleo/banco-local.js';
import { CONFIGURACAO_PADRAO, pastasDaBiblioteca, pastasDoApp, prepararPastasDoApp, senhaDaBiblioteca } from '../src/nucleo/configuracao.js';
import { destinoProibido, fazerCopiaDeSeguranca, lerUltimasCopias, textoDoLeiaMe } from '../src/nucleo/copia-de-seguranca.js';
import { gravarMarcador, lerIdDaPasta } from '../src/nucleo/identidade.js';
import { plataformaAtual } from '../src/nucleo/plataforma.js';
import { urlDoBanco } from '../src/nucleo/postgres.js';
import type { BinariosDoPostgres, RecursosResolvidos } from '../src/nucleo/recursos.js';
import { Registro } from '../src/nucleo/registros.js';
import { ServicoDoMargem } from '../src/nucleo/servico.js';

let raiz = '';
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), 'margem-copia-')); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });

const DADOS = { versaoDoApp: '0.2.0', versaoPostgres: 18, migracoesAplicadas: ['0001_inicial.sql', '0002_notas.sql'] };

async function clusterFalso(pasta: string): Promise<void> {
  await mkdir(join(pasta, 'base', '1'), { recursive: true });
  await writeFile(join(pasta, 'PG_VERSION'), '18\n');
  await writeFile(join(pasta, 'base', '1', '1259'), Buffer.alloc(8192, 7));
  await writeFile(join(pasta, 'postmaster.pid'), '999\n');
}

async function bibliotecaFalsa(biblioteca: string): Promise<void> {
  await gravarMarcador(biblioteca, 'd'.repeat(24));
  await mkdir(join(biblioteca, 'originais', '01J'), { recursive: true });
  await writeFile(join(biblioteca, 'originais', '01J', 'livro.pdf'), Buffer.alloc(20_000, 1));
  await mkdir(join(biblioteca, 'midia'), { recursive: true });
  await writeFile(join(biblioteca, 'midia', 'abc123'), Buffer.alloc(5_000, 2));
  await mkdir(join(biblioteca, 'quadros', 'vazia'), { recursive: true });
  await mkdir(join(biblioteca, 'segredos'), { recursive: true });
  await writeFile(join(biblioteca, 'segredos', 'elevenlabs.chave'), 'sk_segredo-que-nao-viaja');
  await mkdir(join(biblioteca, '.margem', 'banco.migrado-20260101-000000'), { recursive: true });
  await writeFile(join(biblioteca, '.margem', 'banco.migrado-20260101-000000', 'PG_VERSION'), '18\n');
}

async function todos(pasta: string): Promise<string[]> {
  return (await readdir(pasta, { recursive: true })).map(String).sort();
}

describe('U-03: a cópia de segurança', () => {
  it('leva a biblioteca inteira e o banco (de fora da pasta), sem segredos nem bancos antigos, com manifesto e LEIA-ME', async () => {
    const biblioteca = join(raiz, 'OneDrive', 'Margem');
    await bibliotecaFalsa(biblioteca);
    const pastas = pastasDaBiblioteca(biblioteca, { bancosLocais: join(raiz, 'app', 'bancos'), ambiente: {} });
    await clusterFalso(pastas.banco);
    const etapas: string[] = [];
    const { pasta, manifesto } = await fazerCopiaDeSeguranca(pastas, join(raiz, 'Externo'), DADOS, {
      agora: new Date(2026, 9, 16, 14, 5), aoProgresso: (e) => { etapas.push(e); },
    });
    expect(pasta).toBe(join(raiz, 'Externo', 'Cópia do Margem 2026-10-16 14h05'));
    expect(await todos(join(pasta, 'biblioteca'))).toEqual([
      '.margem', join('.margem', 'biblioteca.json'), 'midia', join('midia', 'abc123'),
      'originais', join('originais', '01J'), join('originais', '01J', 'livro.pdf'), 'quadros', join('quadros', 'vazia'),
    ].sort());
    expect(existsSync(join(pasta, 'banco', 'PG_VERSION'))).toBe(true);
    expect(existsSync(join(pasta, 'banco', 'postmaster.pid'))).toBe(false);
    expect(existsSync(join(pasta, 'banco', MARCA_DE_RESTAURACAO))).toBe(true);
    expect(manifesto).toMatchObject({
      formato: 1, versao_do_app: '0.2.0', biblioteca: { caminho: biblioteca, id: 'd'.repeat(24), sincronizada: 'OneDrive', arquivos: 3 },
      banco: { caminho: pastas.banco, versao_postgres: 18, migracoes_aplicadas: 2, ultima_migracao: '0002_notas.sql', arquivos: 2 },
    });
    expect(manifesto.fora_da_copia).toEqual(expect.arrayContaining(['.margem/banco.migrado-20260101-000000', 'segredos']));
    expect(JSON.parse(await readFile(join(pasta, 'manifesto.json'), 'utf8'))).toEqual(manifesto);
    const leiaMe = await readFile(join(pasta, 'LEIA-ME.txt'), 'utf8');
    expect(leiaMe).toBe(textoDoLeiaMe(manifesto));
    expect(leiaMe).toContain('Copie a pasta "banco" daqui para dentro da pasta ".margem"');
    for (const arquivo of await todos(pasta)) {
      const caminho = join(pasta, arquivo);
      if (!existsSync(caminho) || (await readdir(caminho).then(() => true, () => false))) continue;
      expect(await readFile(caminho, 'utf8')).not.toContain('sk_segredo');
    }
    expect(etapas.at(-1)).toBe('Concluindo a cópia');
    expect(etapas.some((e) => e.includes('100%'))).toBe(true);
    // A segunda do mesmo minuto não sobrescreve a primeira.
    const segunda = await fazerCopiaDeSeguranca(pastas, join(raiz, 'Externo'), DADOS, { agora: new Date(2026, 9, 16, 14, 5) });
    expect(segunda.pasta).toBe(`${pasta} (2)`);
  });

  it('recusa a pasta dentro da biblioteca ou do banco', async () => {
    const biblioteca = join(raiz, 'Margem');
    await bibliotecaFalsa(biblioteca);
    const pastas = pastasDaBiblioteca(biblioteca, { bancosLocais: join(raiz, 'app', 'bancos'), ambiente: {} });
    await clusterFalso(pastas.banco);
    await expect(fazerCopiaDeSeguranca(pastas, join(biblioteca, 'copias'), DADOS)).rejects.toMatchObject({ codigo: 'destino' });
    await expect(fazerCopiaDeSeguranca(pastas, biblioteca, DADOS)).rejects.toMatchObject({ codigo: 'destino' });
    expect(destinoProibido('C:\\Users\\Ana\\MARGEM\\x', { ...pastas, biblioteca: 'C:\\Users\\Ana\\Margem', banco: 'D:\\b' }, 'win32')).not.toBeNull();
    expect(destinoProibido('D:\\Copias', { ...pastas, biblioteca: 'C:\\Users\\Ana\\Margem', banco: 'C:\\b' }, 'win32')).toBeNull();
    expect(existsSync(join(biblioteca, 'copias'))).toBe(false);
  });

  it('sem espaço, ou com falha no meio: erro claro e nada fica pela metade', async () => {
    const biblioteca = join(raiz, 'Margem');
    await bibliotecaFalsa(biblioteca);
    const pastas = pastasDaBiblioteca(biblioteca, { bancosLocais: join(raiz, 'app', 'bancos'), ambiente: {} });
    await clusterFalso(pastas.banco);
    const destino = join(raiz, 'Externo');
    await expect(fazerCopiaDeSeguranca(pastas, destino, DADOS, { livres: () => Promise.resolve(1024) })).rejects.toMatchObject({ codigo: 'espaco' });
    let n = 0;
    const falha = (origem: string, alvo: string) => {
      n += 1;
      if (n === 3) return Promise.reject(Object.assign(new Error('sem espaço'), { code: 'ENOSPC' }));
      return cp(origem, alvo);
    };
    await expect(fazerCopiaDeSeguranca(pastas, destino, DADOS, { copiarArquivo: falha })).rejects.toMatchObject({ codigo: 'espaco' });
    expect(await readdir(destino)).toEqual([]);
    expect(existsSync(join(biblioteca, 'originais', '01J', 'livro.pdf'))).toBe(true);
    expect(existsSync(join(pastas.banco, 'postmaster.pid'))).toBe(true);
  });

  it('restaurada em .margem/banco de uma biblioteca sincronizada, ganha do banco local de antes (guardado ao lado)', async () => {
    const biblioteca = join(raiz, 'Dropbox', 'Margem');
    await gravarMarcador(biblioteca, 'e'.repeat(24));
    const pastas = pastasDaBiblioteca(biblioteca, { bancosLocais: join(raiz, 'app', 'bancos'), ambiente: {} });
    await clusterFalso(pastas.banco);
    await writeFile(join(pastas.banco, 'base', 'qual'), 'local mais novo');
    // Sem a marca: o banco local vale (como sempre).
    await clusterFalso(pastas.bancoNaBiblioteca);
    const falsos: BinariosDoPostgres = { initdb: '', pgCtl: '/pg/pg_ctl', postgres: '', origem: 'embutido' };
    const semMarca = await migrarBancoParaLocal(falsos, pastas, { identificar: () => Promise.resolve({ vivo: false, postgres: false, pasta: null, inicio: null }) });
    expect(semMarca.desfecho).toBe('local_ja_existe');
    // Com a marca (a cópia de segurança restaurada): ela vale; o local de antes fica guardado.
    await rm(join(pastas.bancoNaBiblioteca, 'postmaster.pid'));
    await writeFile(join(pastas.bancoNaBiblioteca, 'base', 'qual'), 'restaurado');
    await writeFile(join(pastas.bancoNaBiblioteca, MARCA_DE_RESTAURACAO), '{}');
    const restaurado = await migrarBancoParaLocal(falsos, pastas, { agora: new Date('2026-10-16T12:00:00Z') });
    expect(restaurado.desfecho).toBe('migrado');
    expect(restaurado.localAnterior).toBe(`${pastas.banco}.anterior-20261016-120000`);
    expect(await readFile(join(pastas.banco, 'base', 'qual'), 'utf8')).toBe('restaurado');
    expect(await readFile(join(restaurado.localAnterior ?? '', 'base', 'qual'), 'utf8')).toBe('local mais novo');
    expect(existsSync(join(pastas.banco, MARCA_DE_RESTAURACAO))).toBe(true);
  });

  it('R3-1: restaurar a mesma cópia de novo, deliberadamente, vale de novo', async () => {
    const biblioteca = join(raiz, 'Dropbox', 'Margem');
    await gravarMarcador(biblioteca, 'a'.repeat(24));
    const pastas = pastasDaBiblioteca(biblioteca, { bancosLocais: join(raiz, 'app', 'bancos'), ambiente: {} });
    await clusterFalso(pastas.banco);
    await rm(join(pastas.banco, 'postmaster.pid'));
    const falsos: BinariosDoPostgres = { initdb: '', pgCtl: '/pg/pg_ctl', postgres: '', origem: 'embutido' };
    const restaurar = async (agora: string) => {
      await clusterFalso(pastas.bancoNaBiblioteca);
      await rm(join(pastas.bancoNaBiblioteca, 'postmaster.pid'));
      await writeFile(join(pastas.bancoNaBiblioteca, 'base', 'qual'), 'backup A');
      await writeFile(join(pastas.bancoNaBiblioteca, MARCA_DE_RESTAURACAO), '{"criada_em":"2026-10-16T10:00:00Z"}\n');
      return migrarBancoParaLocal(falsos, pastas, { agora: new Date(agora) });
    };
    expect((await restaurar('2026-10-16T12:00:00Z')).desfecho).toBe('migrado');
    await rm(join(pastas.banco, MARCA_DE_RESTAURACAO));
    await writeFile(join(pastas.banco, 'base', 'qual'), 'notas depois');
    const segunda = await restaurar('2026-10-17T12:00:00Z');
    expect(segunda.desfecho).toBe('migrado');
    expect(await readFile(join(pastas.banco, 'base', 'qual'), 'utf8')).toBe('backup A');
    expect(await readFile(join(`${pastas.banco}.anterior-20261017-120000`, 'base', 'qual'), 'utf8')).toBe('notas depois');
  });

  it.skipIf(process.platform === 'win32')('R2-2: se a pasta antiga não sai do lugar (nem a marca), a restauração não se repete por cima das notas novas', async () => {
    const biblioteca = join(raiz, 'OneDrive', 'Margem');
    await gravarMarcador(biblioteca, 'f'.repeat(24));
    const pastas = pastasDaBiblioteca(biblioteca, { bancosLocais: join(raiz, 'app', 'bancos'), ambiente: {} });
    await clusterFalso(pastas.banco);
    await rm(join(pastas.banco, 'postmaster.pid'));
    await writeFile(join(pastas.banco, 'base', 'qual'), 'local de antes');
    await clusterFalso(pastas.bancoNaBiblioteca);
    await rm(join(pastas.bancoNaBiblioteca, 'postmaster.pid'));
    await writeFile(join(pastas.bancoNaBiblioteca, 'base', 'qual'), 'backup');
    await writeFile(join(pastas.bancoNaBiblioteca, MARCA_DE_RESTAURACAO), '{"criada_em":"2026-10-16T10:00:00Z"}\n');
    // O sincronizador segura a pasta antiga: nem o rename nem a remoção da marca passam.
    await chmod(pastas.bancoNaBiblioteca, 0o555);
    await chmod(pastas.interna, 0o555);
    const falsos: BinariosDoPostgres = { initdb: '', pgCtl: '/pg/pg_ctl', postgres: '', origem: 'embutido' };
    try {
      const primeira = await migrarBancoParaLocal(falsos, pastas, { agora: new Date('2026-10-16T12:00:00Z') });
      expect(primeira.desfecho).toBe('migrado');
      expect(primeira.antigoRenomeado).toBeUndefined();
      expect(existsSync(join(pastas.bancoNaBiblioteca, MARCA_DE_RESTAURACAO))).toBe(true);
      expect(await readFile(join(pastas.banco, 'base', 'qual'), 'utf8')).toBe('backup');
      // A abertura tira a marca do banco local; depois a pessoa faz notas novas.
      await rm(join(pastas.banco, MARCA_DE_RESTAURACAO));
      await writeFile(join(pastas.banco, 'base', 'qual'), 'notas novas');
      const segunda = await migrarBancoParaLocal(falsos, pastas, { agora: new Date('2026-10-17T12:00:00Z') });
      expect(segunda.desfecho).toBe('local_ja_existe');
      expect(await readFile(join(pastas.banco, 'base', 'qual'), 'utf8')).toBe('notas novas');
      expect(existsSync(`${pastas.banco}.anterior-20261017-120000`)).toBe(false);
    } finally {
      await chmod(pastas.interna, 0o755);
      await chmod(pastas.bancoNaBiblioteca, 0o755);
    }
    // Com a pasta liberada, a marca sai da origem; e o registro não vai numa cópia de segurança.
    expect((await migrarBancoParaLocal(falsos, pastas)).desfecho).toBe('local_ja_existe');
    expect(existsSync(join(pastas.bancoNaBiblioteca, MARCA_DE_RESTAURACAO))).toBe(false);
    expect(FORA_DA_COPIA.has(RESTAURACAO_CONCLUIDA)).toBe(true);
  });
});

// ---------------------------------------------------------------- de ponta a ponta, com o Postgres de verdade

const pastaDosBinarios = resolve(import.meta.dirname, '..', 'recursos', (() => { try { return plataformaAtual(); } catch { return 'nenhuma'; } })(), 'postgres', 'bin');
const exe = (nome: string): string => join(pastaDosBinarios, process.platform === 'win32' ? `${nome}.exe` : nome);
const REAIS: BinariosDoPostgres = { initdb: exe('initdb'), pgCtl: exe('pg_ctl'), postgres: exe('postgres'), origem: 'embutido' };

/** API que só responde à saúde e sai quando pedem: o banco é o de verdade. */
const API_DE_SAUDE = `
  import http from 'node:http';
  const servidor = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  servidor.listen(Number(process.env.MARGEM_PORTA), '127.0.0.1');
  process.on('message', (m) => { if (m === 'margem:parar') servidor.close(() => process.exit(0)); });
`;
const PARADO = `process.on('message', (m) => { if (m === 'margem:parar') process.exit(0); }); setInterval(() => {}, 1000);`;

async function abrir(dadosDoApp: string, biblioteca: string) {
  const pastas = pastasDoApp(dadosDoApp);
  await prepararPastasDoApp(pastas);
  const raizApp = join(raiz, 'raiz-do-app');
  await mkdir(join(raizApp, 'servico'), { recursive: true });
  await writeFile(join(raizApp, 'servico', 'api.mjs'), API_DE_SAUDE);
  await writeFile(join(raizApp, 'servico', 'worker.mjs'), PARADO);
  await writeFile(join(raizApp, 'versao.json'), '{"versao":"0.2.0"}');
  const recursos: RecursosResolvidos = { postgres: REAIS, codex: null, motor: null, fonte: null, ytDlp: null, ffmpeg: null, ffprobe: null, pastaBin: null };
  const servico = new ServicoDoMargem({
    recursos, raizApp, pastasDoApp: pastas, biblioteca, configuracao: { ...CONFIGURACAO_PADRAO },
    registro: new Registro(join(pastas.registros, 'app.log')), executavel: process.execPath, ambiente: { PATH: process.env.PATH ?? '' },
    testarBwrap: () => Promise.resolve({ ok: true, detalhe: '' }),
  });
  const noAr = await servico.iniciar();
  const { senha } = await senhaDaBiblioteca(pastas.segredos, servico.biblioteca.biblioteca, servico.biblioteca.id);
  const cliente = new pg.Client({ connectionString: urlDoBanco(senha, noAr.portaDoBanco) });
  await cliente.connect();
  return { servico, cliente, pastas };
}

describe.skipIf(!existsSync(REAIS.postgres))('U-03 de ponta a ponta (Postgres de verdade)', () => {
  it('cópia de uma biblioteca no OneDrive, restaurada pelo LEIA-ME num computador novo e no mesmo computador', { timeout: 240_000 }, async () => {
    const biblioteca = join(raiz, 'OneDrive', 'Margem');
    const app1 = join(raiz, 'computador-1');
    // 1. Uso: uma nota, a tabela de migrações, um original e uma mídia.
    const primeiro = await abrir(app1, biblioteca);
    try {
      expect(primeiro.servico.biblioteca.banco.startsWith(join(app1, 'bancos'))).toBe(true);
      await primeiro.cliente.query("CREATE TABLE migracao (nome text); INSERT INTO migracao VALUES ('0001_inicial.sql'), ('0002_notas.sql')");
      await primeiro.cliente.query("CREATE TABLE nota (texto text); INSERT INTO nota VALUES ('antes da cópia')");
    } finally {
      await primeiro.cliente.end();
    }
    await mkdir(join(biblioteca, 'originais', '01J'), { recursive: true });
    await writeFile(join(biblioteca, 'originais', '01J', 'livro.pdf'), '%PDF-1.7 de mentira');
    await mkdir(join(biblioteca, 'audio'), { recursive: true });
    await writeFile(join(biblioteca, 'audio', 'narracao.mp3'), Buffer.alloc(3000, 9));

    // 2. "Fazer cópia de segurança…": para tudo e copia.
    const etapas: string[] = [];
    const { pasta, manifesto } = await primeiro.servico.fazerCopiaDeSeguranca(join(raiz, 'Disco externo'), (e) => { etapas.push(e); });
    expect(primeiro.servico.pids).toEqual({});
    expect(etapas[0]).toBe('Fechando a biblioteca para copiar');
    expect(manifesto.banco).toMatchObject({ migracoes_aplicadas: 2, ultima_migracao: '0002_notas.sql' });
    expect(manifesto.versao_do_app).toBe('0.2.0');
    expect((await lerUltimasCopias(primeiro.pastas.copiasDeSeguranca))[primeiro.servico.biblioteca.id]?.pasta).toBe(pasta);

    // 3. Mais uso depois da cópia (no mesmo computador).
    const segundo = await abrir(app1, biblioteca);
    await segundo.cliente.query("INSERT INTO nota VALUES ('depois da cópia')");
    await segundo.cliente.end();
    await segundo.servico.parar();

    // 4. Computador novo: o LEIA-ME, passo a passo (copiar "biblioteca" para onde quiser, "banco" para dentro de ".margem").
    const novo = join(raiz, 'OneDrive-novo', 'Biblioteca restaurada');
    await mkdir(join(raiz, 'OneDrive-novo'), { recursive: true });
    await cp(join(pasta, 'biblioteca'), novo, { recursive: true });
    await cp(join(pasta, 'banco'), join(novo, '.margem', 'banco'), { recursive: true });
    const restaurada = await abrir(join(raiz, 'computador-2'), novo);
    try {
      expect(restaurada.servico.biblioteca.sincronizada).toBe('OneDrive');
      expect(restaurada.servico.biblioteca.banco.startsWith(join(raiz, 'computador-2', 'bancos'))).toBe(true);
      expect((await restaurada.cliente.query<{ texto: string }>('SELECT texto FROM nota ORDER BY texto')).rows).toEqual([{ texto: 'antes da cópia' }]);
    } finally {
      await restaurada.cliente.end();
      await restaurada.servico.parar();
    }
    expect(await readFile(join(novo, 'originais', '01J', 'livro.pdf'), 'utf8')).toBe('%PDF-1.7 de mentira');
    expect(existsSync(join(novo, 'audio', 'narracao.mp3'))).toBe(true);
    expect(lerIdDaPasta(novo)).toBe(manifesto.biblioteca.id);
    expect(existsSync(join(restaurada.servico.biblioteca.banco, MARCA_DE_RESTAURACAO))).toBe(false);

    // 5. Mesmo computador, biblioteca estragada: tira do caminho, restaura no mesmo lugar. O banco local mais novo fica guardado.
    await rename(biblioteca, join(raiz, 'OneDrive', 'Margem (estragada)'));
    await cp(join(pasta, 'biblioteca'), biblioteca, { recursive: true });
    await cp(join(pasta, 'banco'), join(biblioteca, '.margem', 'banco'), { recursive: true });
    const mesma = await abrir(app1, biblioteca);
    try {
      expect((await mesma.cliente.query<{ texto: string }>('SELECT texto FROM nota ORDER BY texto')).rows).toEqual([{ texto: 'antes da cópia' }]);
    } finally {
      await mesma.cliente.end();
      await mesma.servico.parar();
    }
    const bancos = await readdir(join(app1, 'bancos'));
    expect(bancos.some((nome) => nome.startsWith(`${manifesto.biblioteca.id}.anterior-`))).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('R2-3: restaurada numa pasta local comum (fora de sincronizador), abre com os dados', { timeout: 240_000 }, async () => {
    const biblioteca = join(raiz, 'Documentos', 'Margem');
    const primeiro = await abrir(join(raiz, 'computador-1'), biblioteca);
    try {
      expect(primeiro.servico.biblioteca.sincronizada).toBeNull();
      expect(primeiro.servico.biblioteca.banco).toBe(join(biblioteca, '.margem', 'banco'));
      await primeiro.cliente.query("CREATE TABLE nota (texto text); INSERT INTO nota VALUES ('na pasta local')");
    } finally {
      await primeiro.cliente.end();
    }
    const { pasta } = await primeiro.servico.fazerCopiaDeSeguranca(join(raiz, 'Disco externo'));
    // A pasta do banco na cópia já sai só do dono.
    expect((await stat(join(pasta, 'banco'))).mode & 0o777).toBe(0o700);

    // O LEIA-ME num computador novo, numa pasta local comum. A cópia à mão (pendrive, zip) perde o modo da pasta.
    const novo = join(raiz, 'Livros', 'Biblioteca restaurada');
    await mkdir(join(raiz, 'Livros'), { recursive: true });
    await cp(join(pasta, 'biblioteca'), novo, { recursive: true });
    await cp(join(pasta, 'banco'), join(novo, '.margem', 'banco'), { recursive: true });
    await chmod(join(novo, '.margem', 'banco'), 0o755);
    const restaurada = await abrir(join(raiz, 'computador-2'), novo);
    try {
      expect(restaurada.servico.biblioteca.banco).toBe(join(novo, '.margem', 'banco'));
      expect((await restaurada.cliente.query<{ texto: string }>('SELECT texto FROM nota')).rows).toEqual([{ texto: 'na pasta local' }]);
    } finally {
      await restaurada.cliente.end();
      await restaurada.servico.parar();
    }
    expect((await stat(join(novo, '.margem', 'banco'))).mode & 0o777).toBe(0o700);
    expect(existsSync(join(novo, '.margem', 'banco', MARCA_DE_RESTAURACAO))).toBe(false);
  });
});
