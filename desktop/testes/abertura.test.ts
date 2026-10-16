/**
 * Abertura da biblioteca com operações do banco falsas (como em ciclo.test.ts): a cópia de uma biblioteca
 * ganha banco próprio (W-02), o banco de versão mais nova (R-06, D-07) e o banco que não sobe (D-14).
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIGURACAO_PADRAO, pastasDoApp, prepararPastasDoApp } from '../src/nucleo/configuracao.js';
import { caminhoDoMarcador, gravarMarcador, idLegadoDaBiblioteca, lerIdDaPasta } from '../src/nucleo/identidade.js';
import { ErroDoBanco } from '../src/nucleo/postgres.js';
import type { RecursosResolvidos } from '../src/nucleo/recursos.js';
import { Registro } from '../src/nucleo/registros.js';
import { LINK_DA_RESTAURACAO, LINK_DO_DOWNLOAD, ServicoDoMargem, type OperacoesDoBanco } from '../src/nucleo/servico.js';

let raiz = '';
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), 'margem-abertura-')); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });

const API_MUDA = `
  process.on('message', (m) => { if (m === 'margem:parar') process.exit(0); });
  setInterval(() => {}, 1000);
`;

async function clusterFalso(pasta: string): Promise<void> {
  await mkdir(join(pasta, 'base'), { recursive: true });
  await writeFile(join(pasta, 'PG_VERSION'), '18\n');
  await writeFile(join(pasta, 'base', '1259'), Buffer.alloc(4096, 3));
}

const RECURSOS: RecursosResolvidos = {
  postgres: { initdb: '/pg/initdb', pgCtl: '/pg/pg_ctl', postgres: '/pg/postgres', origem: 'embutido' },
  codex: null, motor: null, fonte: null, ytDlp: null, ffmpeg: null, ffprobe: null, pastaBin: null,
};

async function montar(opcoes: { biblioteca: string; api?: string; operacoes?: Partial<OperacoesDoBanco>; prazoDaApiMs?: number; ambiente?: NodeJS.ProcessEnv }) {
  const pastas = pastasDoApp(join(raiz, 'app'));
  await prepararPastasDoApp(pastas);
  const raizApp = join(raiz, 'raiz');
  await mkdir(join(raizApp, 'servico'), { recursive: true });
  await writeFile(join(raizApp, 'servico', 'api.mjs'), opcoes.api ?? API_MUDA);
  await writeFile(join(raizApp, 'servico', 'worker.mjs'), API_MUDA);
  const eventos: string[] = [];
  const registro = new Registro(join(pastas.registros, 'app.log'));
  const evento = registro.evento.bind(registro);
  registro.evento = (nome, detalhe) => { eventos.push(nome); evento(nome, detalhe); };
  const servico = new ServicoDoMargem({
    recursos: RECURSOS, raizApp, pastasDoApp: pastas, biblioteca: opcoes.biblioteca, configuracao: { ...CONFIGURACAO_PADRAO }, registro,
    executavel: process.execPath, prazoDaApiMs: opcoes.prazoDaApiMs ?? 60_000, ambiente: { PATH: process.env.PATH ?? '', ...opcoes.ambiente },
    testarBwrap: () => Promise.resolve({ ok: true, detalhe: '' }),
    operacoes: {
      versaoDosBinarios: () => Promise.resolve(18),
      tratarLockVelho: () => Promise.resolve('sem_lock'),
      redefinirSenha: () => Promise.resolve(),
      inicializarCluster: (_b, pasta) => clusterFalso(pasta),
      subir: () => Promise.resolve(),
      parar: () => Promise.resolve(true),
      conferirSenha: () => Promise.resolve(true),
      garantirBanco: () => Promise.resolve(),
      migracoesAplicadas: () => Promise.resolve(null),
      ...opcoes.operacoes,
    },
  });
  return { servico, eventos, pastas };
}

describe('W-02 na abertura', () => {
  it('a cópia de uma biblioteca sincronizada ganha id novo e um banco local próprio, copiado da original', { timeout: 30_000 }, async () => {
    const original = join(raiz, 'Dropbox', 'Margem');
    const { servico: primeiro, pastas } = await montar({ biblioteca: original, prazoDaApiMs: 300 });
    await expect(primeiro.iniciar()).rejects.toMatchObject({ codigo: 'api' });
    await primeiro.parar();
    const id = lerIdDaPasta(original) ?? '';
    expect(existsSync(join(pastas.bancosLocais, id, 'PG_VERSION'))).toBe(true);
    await writeFile(join(pastas.bancosLocais, id, 'base', 'nota'), 'da original');

    const copia = join(raiz, 'Dropbox', 'Margem (cópia)');
    await gravarMarcador(copia, id);
    const { servico, eventos } = await montar({ biblioteca: copia, prazoDaApiMs: 300 });
    await expect(servico.iniciar()).rejects.toMatchObject({ codigo: 'api' });
    await servico.parar();
    const novo = lerIdDaPasta(copia) ?? '';
    expect(novo).not.toBe(id);
    expect(servico.biblioteca.banco).toBe(join(pastas.bancosLocais, novo));
    expect(await readFile(join(pastas.bancosLocais, novo, 'base', 'nota'), 'utf8')).toBe('da original');
    expect(eventos).toContain('banco_copiado_da_original');
    // A original não foi tocada.
    expect(lerIdDaPasta(original)).toBe(id);
    expect(existsSync(caminhoDoMarcador(original))).toBe(true);
  });

  it('R2-5: se a cópia do banco da original falha, a cópia não ganha id novo e a próxima abertura copia de novo', { timeout: 30_000 }, async () => {
    const original = join(raiz, 'Dropbox', 'Margem');
    const { servico: primeiro, pastas } = await montar({ biblioteca: original, prazoDaApiMs: 300 });
    await expect(primeiro.iniciar()).rejects.toMatchObject({ codigo: 'api' });
    await primeiro.parar();
    const id = lerIdDaPasta(original) ?? '';
    await writeFile(join(pastas.bancosLocais, id, 'base', 'nota'), 'da original');
    const copia = join(raiz, 'Dropbox', 'Margem (cópia)');
    await gravarMarcador(copia, id);

    const { servico: falha } = await montar({
      biblioteca: copia, prazoDaApiMs: 300,
      operacoes: { copiarCluster: () => Promise.reject(new ErroDoBanco('migracao', 'Não foi possível copiar o banco da biblioteca original para a cópia.')) },
    });
    await expect(falha.iniciar()).rejects.toMatchObject({ codigo: 'migracao' });
    await falha.parar();
    expect(lerIdDaPasta(copia)).toBe(id);

    const { servico, eventos } = await montar({ biblioteca: copia, prazoDaApiMs: 300, operacoes: { inicializarCluster: () => Promise.reject(new Error('não devia criar banco vazio')) } });
    await expect(servico.iniciar()).rejects.toMatchObject({ codigo: 'api' });
    await servico.parar();
    const novo = lerIdDaPasta(copia) ?? '';
    expect(novo).not.toBe(id);
    expect(await readFile(join(pastas.bancosLocais, novo, 'base', 'nota'), 'utf8')).toBe('da original');
    expect(eventos).toContain('banco_copiado_da_original');
  });

  it('com a pergunta respondida "cancelar", nada abre', async () => {
    const original = join(raiz, 'Margem');
    await gravarMarcador(original, 'a'.repeat(24));
    const outra = join(raiz, 'Margem 2');
    await gravarMarcador(outra, 'a'.repeat(24));
    const { servico: primeiro } = await montar({ biblioteca: original, prazoDaApiMs: 300 });
    await expect(primeiro.iniciar()).rejects.toMatchObject({ codigo: 'api' });
    await primeiro.parar();
    const { servico } = await montar({ biblioteca: outra });
    (servico as unknown as { opcoes: { perguntarSeCopiou: () => Promise<string> } }).opcoes.perguntarSeCopiou = () => Promise.resolve('cancelar');
    await expect(servico.iniciar()).rejects.toMatchObject({ codigo: 'identidade_cancelada' });
    expect(servico.pids).toEqual({});
    await servico.parar();
  });
});

describe('R2-1: marcador sincronizado chegando a outro computador', () => {
  it('o banco local que este computador já tinha (pelo hash do caminho) é adotado, não um banco vazio', { timeout: 30_000 }, async () => {
    // Computador 2: biblioteca no OneDrive com banco local pelo hash do SEU caminho (versão de antes do marcador).
    const biblioteca = join(raiz, 'OneDrive', 'Margem');
    const pastas = pastasDoApp(join(raiz, 'app'));
    const legado = idLegadoDaBiblioteca(biblioteca);
    await clusterFalso(join(pastas.bancosLocais, legado));
    await writeFile(join(pastas.bancosLocais, legado, 'base', 'nota'), 'notas do computador 2');
    await mkdir(pastas.segredos, { recursive: true });
    await writeFile(join(pastas.segredos, `banco-${legado}.senha`), 'senha-do-computador-2-xyz\n');
    // O computador 1 atualizou primeiro: o marcador dele (hash do caminho de lá) chegou pela sincronização.
    const doOutro = 'd'.repeat(24);
    await gravarMarcador(biblioteca, doOutro);

    let lockTratadoEm = '';
    const { servico, eventos } = await montar({
      biblioteca, prazoDaApiMs: 300, ambiente: { OneDrive: join(raiz, 'OneDrive') },
      operacoes: {
        tratarLockVelho: (_b, pasta) => { lockTratadoEm ||= pasta; return Promise.resolve('sem_lock'); },
        inicializarCluster: () => Promise.reject(new Error('não devia criar banco vazio')),
      },
    });
    await expect(servico.iniciar()).rejects.toMatchObject({ codigo: 'api' });
    await servico.parar();
    expect(lerIdDaPasta(biblioteca)).toBe(doOutro);
    expect(servico.biblioteca.banco).toBe(join(pastas.bancosLocais, doOutro));
    expect(await readFile(join(pastas.bancosLocais, doOutro, 'base', 'nota'), 'utf8')).toBe('notas do computador 2');
    expect(existsSync(join(pastas.bancosLocais, legado))).toBe(false);
    expect(await readFile(join(pastas.segredos, `banco-${doOutro}.senha`), 'utf8')).toBe('senha-do-computador-2-xyz\n');
    expect(lockTratadoEm).toBe(join(pastas.bancosLocais, legado));
    expect(eventos).not.toContain('banco_criado');
  });
});

describe('R-06: banco aberto por uma versão mais nova', () => {
  const API_RECUSA = `
    console.error(JSON.stringify({ evento: 'banco_mais_novo', migracoes: ['0099_futuro.sql'] }));
    console.error('Error: Esta biblioteca foi aberta por uma versão mais nova do Margem');
    setTimeout(() => process.exit(1), 30);
  `;

  it('a API não é reiniciada e a abertura falha já, com a orientação e o link da versão nova', { timeout: 30_000 }, async () => {
    const biblioteca = join(raiz, 'Margem');
    await clusterFalso(join(biblioteca, '.margem', 'banco'));
    const { servico, eventos } = await montar({ biblioteca, api: API_RECUSA });
    const inicio = Date.now();
    const erro = await servico.iniciar().catch((e: unknown) => e) as { codigo?: string; message: string; acao?: { url: string } };
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect(erro.codigo).toBe('banco_mais_novo');
    expect(erro.message).toContain('versão mais nova do Margem');
    expect(erro.message).toContain('margem.dev/download');
    expect(erro.acao?.url).toBe(LINK_DO_DOWNLOAD);
    expect(eventos.filter((e) => e === 'processo_iniciado')).toHaveLength(1);
    expect(eventos).not.toContain('processo_reinicio_agendado');
    expect(eventos).toContain('banco_mais_novo');
    expect(servico.pids.worker).toBeUndefined();
    await servico.parar();
  });

  it('com a cópia de antes da atualização (D-06), a mensagem diz onde ela está', { timeout: 30_000 }, async () => {
    const biblioteca = join(raiz, 'Margem');
    await clusterFalso(join(biblioteca, '.margem', 'banco'));
    const { servico, pastas } = await montar({ biblioteca, api: API_RECUSA });
    const id = lerIdDaPasta(biblioteca);
    // A identidade é gravada na abertura; a cópia do D-06 fica em <copias>/<id>.
    const erro = await servico.iniciar().catch((e: unknown) => e) as { message: string };
    expect(erro.message).not.toContain(pastas.copias);
    await servico.parar();
    const idGravado = lerIdDaPasta(biblioteca) ?? id ?? '';
    await mkdir(join(pastas.copias, idGravado, 'banco'), { recursive: true });
    await writeFile(join(pastas.copias, idGravado, 'manifesto.json'), '{}');
    const { servico: outra } = await montar({ biblioteca, api: API_RECUSA });
    const erro2 = await outra.iniciar().catch((e: unknown) => e) as { message: string };
    expect(erro2.message).toContain(join(pastas.copias, idGravado, 'banco'));
    await outra.parar();
  });
});

describe('D-14: o banco que não sobe', () => {
  it('orienta preservar a pasta e restaurar a última cópia, sem reparo; o botão leva à restauração', async () => {
    const biblioteca = join(raiz, 'Margem');
    await clusterFalso(join(biblioteca, '.margem', 'banco'));
    const { servico } = await montar({
      biblioteca,
      operacoes: { subir: () => Promise.reject(new ErroDoBanco('subida', 'O banco da biblioteca não subiu.', 'PANIC: could not locate a valid checkpoint record')) },
    });
    const erro = await servico.iniciar().catch((e: unknown) => e) as { codigo?: string; message: string; detalhe?: string; acao?: { url: string } };
    expect(erro.codigo).toBe('subida');
    expect(erro.message).toContain('Não apague nem mexa na pasta do banco');
    expect(erro.message).toContain(join(biblioteca, '.margem', 'banco'));
    expect(erro.message).toContain('restaure a última cópia de segurança');
    expect(erro.message).not.toMatch(/recri|reparar|apagar o banco/iu);
    expect(erro.detalhe).toContain('checkpoint');
    expect(erro.acao?.url).toBe(LINK_DA_RESTAURACAO);
    // A pasta do banco fica como estava.
    expect(existsSync(join(biblioteca, '.margem', 'banco', 'base', '1259'))).toBe(true);
    await servico.parar();
  });
});
