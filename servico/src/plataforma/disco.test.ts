/**
 * Sincronização portátil (V-W1, auditoria B-02). O Windows é simulado: o `open` falso imita o
 * `FlushFileBuffers`, que recusa handle sem escrita (EPERM) e não existe para pasta.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { renomearComRetentativa, sincronizarArquivo, sincronizarPasta } from './disco.js';
import type { OpcoesDoDisco } from './disco.js';

function erroComCodigo(codigo: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${codigo}: operation not permitted, fsync`), { code: codigo });
}

type Abrir = NonNullable<OpcoesDoDisco['abrir']>;
type Handle = Awaited<ReturnType<Abrir>>;

/** Handle falso: `sync` passa ou falha com o código dado. */
function handle(falha?: string): Handle {
  return {
    sync: () => (falha === undefined ? Promise.resolve() : Promise.reject(erroComCodigo(falha))),
    close: () => Promise.resolve(),
  };
}

/** `open` que imita o Windows: `sync` só vale em handle aberto com escrita. */
function abrirComoWindows(chamadas: string[]): Abrir {
  return (caminho, modo) => {
    chamadas.push(`${modo} ${caminho}`);
    return Promise.resolve(handle(modo.includes('+') || modo.includes('w') ? undefined : 'EPERM'));
  };
}

/** `open` que registra a chamada e devolve um handle que falha (ou não) no `sync`. */
function abrirQue(falha?: string, chamadas: string[] = []): Abrir {
  return (caminho, modo) => { chamadas.push(`${modo} ${caminho}`); return Promise.resolve(handle(falha)); };
}

const temporarios: string[] = [];
afterEach(async () => { for (const pasta of temporarios.splice(0)) await rm(pasta, { recursive: true, force: true }); });

test('Windows: o arquivo é aberto com escrita (r+), e o flush passa', async () => {
  const chamadas: string[] = [];
  await sincronizarArquivo('C:\\dados\\visuais\\.tentativa-1', { plataforma: 'win32', abrir: abrirComoWindows(chamadas) });
  expect(chamadas).toEqual(['r+ C:\\dados\\visuais\\.tentativa-1']);
});

test('Windows: EPERM/EACCES/EBUSY do flush viram melhor esforço; outro erro sobe', async () => {
  for (const codigo of ['EPERM', 'EACCES', 'EBUSY', 'EINVAL', 'EISDIR']) {
    await expect(sincronizarArquivo('x', { plataforma: 'win32', abrir: abrirQue(codigo) })).resolves.toBeUndefined();
  }
  await expect(sincronizarArquivo('x', { plataforma: 'win32', abrir: abrirQue('EIO') })).rejects.toMatchObject({ code: 'EIO' });
  // Arquivo que nem existe continua sendo erro: não é "flush recusado".
  await expect(sincronizarArquivo('x', {
    plataforma: 'win32', abrir: () => Promise.reject(erroComCodigo('ENOENT')),
  })).rejects.toMatchObject({ code: 'ENOENT' });
});

test('Windows: pasta não tem fsync; nada é aberto', async () => {
  const chamadas: string[] = [];
  await sincronizarPasta('C:\\dados\\visuais', { plataforma: 'win32', abrir: abrirComoWindows(chamadas) });
  expect(chamadas).toEqual([]);
});

test('Linux/macOS: arquivo e pasta por descritor só de leitura, e erro de disco sobe', async () => {
  for (const plataforma of ['linux', 'darwin'] as const) {
    const chamadas: string[] = [];
    const abrir = abrirQue(undefined, chamadas);
    await sincronizarArquivo('/d/a', { plataforma, abrir });
    await sincronizarPasta('/d', { plataforma, abrir });
    expect(chamadas).toEqual(['r /d/a', 'r /d']);
  }
  const falhando = (codigo: string) => abrirQue(codigo);
  await expect(sincronizarArquivo('/d/a', { plataforma: 'linux', abrir: falhando('EPERM') })).rejects.toMatchObject({ code: 'EPERM' });
  await expect(sincronizarPasta('/d', { plataforma: 'linux', abrir: falhando('EIO') })).rejects.toMatchObject({ code: 'EIO' });
  // Sistema de arquivos sem fsync de pasta (alguns de rede): tolerado.
  await expect(sincronizarPasta('/d', { plataforma: 'linux', abrir: falhando('EINVAL') })).resolves.toBeUndefined();
});

test('de verdade neste sistema: arquivo e pasta sincronizam', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-disco-'));
  temporarios.push(pasta);
  const arquivo = join(pasta, 'a.bin');
  await writeFile(arquivo, 'conteúdo');
  await expect(sincronizarArquivo(arquivo)).resolves.toBeUndefined();
  await expect(sincronizarPasta(pasta)).resolves.toBeUndefined();
});

test('rename: no Windows tenta de novo em EPERM/EBUSY/EACCES; fora dele, e em outro erro, a 1ª falha sobe (V-W8)', async () => {
  const renomeadorQueFalha = (codigos: string[]) => {
    const chamadas: string[] = [];
    return {
      chamadas,
      renomear: (origem: string, destino: string) => {
        chamadas.push(`${origem}>${destino}`);
        const codigo = codigos.shift();
        return codigo === undefined ? Promise.resolve() : Promise.reject(erroComCodigo(codigo));
      },
    };
  };
  const windows = renomeadorQueFalha(['EPERM', 'EBUSY', 'EACCES']);
  await renomearComRetentativa('a.tmp', 'a.json', { plataforma: 'win32', esperaMs: 1, renomear: windows.renomear });
  expect(windows.chamadas).toHaveLength(4);
  const desistiu = renomeadorQueFalha(['EPERM', 'EPERM', 'EPERM']);
  await expect(renomearComRetentativa('a', 'b', { plataforma: 'win32', esperaMs: 1, tentativas: 3, renomear: desistiu.renomear })).rejects.toMatchObject({ code: 'EPERM' });
  expect(desistiu.chamadas).toHaveLength(3);
  const outroErro = renomeadorQueFalha(['ENOENT']);
  await expect(renomearComRetentativa('a', 'b', { plataforma: 'win32', esperaMs: 1, renomear: outroErro.renomear })).rejects.toMatchObject({ code: 'ENOENT' });
  expect(outroErro.chamadas).toHaveLength(1);
  const linux = renomeadorQueFalha(['EBUSY']);
  await expect(renomearComRetentativa('a', 'b', { plataforma: 'linux', renomear: linux.renomear })).rejects.toMatchObject({ code: 'EBUSY' });
  expect(linux.chamadas).toHaveLength(1);
});
