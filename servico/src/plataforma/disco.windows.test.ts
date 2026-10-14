/**
 * Os quatro fluxos que perdiam o resultado no Windows (V-W1, auditoria B-02 e B-14.1), com o
 * Windows simulado: `process.platform` vira `win32` e o `open` do Node passa a recusar o flush
 * de handle sem escrita e de pasta (EPERM), como o `FlushFileBuffers` faz. Antes da correção,
 * imagem, narração e mídia falhavam aqui; depois, os três guardam o arquivo inteiro.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  const open: typeof real.open = async (caminho, modo, permissao) => {
    const handle = await real.open(caminho, modo, permissao);
    const comEscrita = typeof modo === 'string' && /[wa+]/u.test(modo);
    if (process.platform === 'win32' && !comEscrita) {
      const sync = () => Promise.reject(Object.assign(new Error('EPERM: operation not permitted, fsync'), { code: 'EPERM' }));
      return Object.assign(handle, { sync, datasync: sync });
    }
    return handle;
  };
  return { ...real, default: { ...real, open }, open };
});

const plataformaReal = process.platform;
let dados: string;

beforeAll(async () => {
  dados = await mkdtemp(join(tmpdir(), 'margem-win32-'));
  vi.stubEnv('MARGEM_DADOS', dados);
  Object.defineProperty(process, 'platform', { value: 'win32' });
});

afterAll(async () => {
  Object.defineProperty(process, 'platform', { value: plataformaReal });
  vi.unstubAllEnvs();
  await rm(dados, { recursive: true, force: true });
});

/** PNG mínimo válido o bastante para o cabeçalho IHDR (1×1). */
function png(): Buffer {
  const cabecalho = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const ihdr = Buffer.alloc(17);
  ihdr.write('IHDR', 0, 'ascii');
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt32BE(1, 8);
  return Buffer.concat([cabecalho, ihdr, Buffer.alloc(16)]);
}

test('o simulador recusa o flush de handle só de leitura, como o Windows', async () => {
  const { open } = await import('node:fs/promises');
  const caminho = join(dados, 'sonda');
  await writeFile(caminho, 'x');
  const handle = await open(caminho, 'r');
  try { await expect(handle.sync()).rejects.toMatchObject({ code: 'EPERM' }); } finally { await handle.close(); }
});

test('imagem gerada (visuais e capas) é guardada no Windows', async () => {
  const { guardarImagem, caminhoDaImagem } = await import('../visuais/arquivos.js');
  const origem = join(dados, 'gerada.png');
  await writeFile(origem, png());
  const guardada = await guardarImagem(origem);
  expect(guardada).toMatchObject({ largura: 1, altura: 1 });
  expect(await readFile(caminhoDaImagem(guardada.sha256))).toEqual(png());
});

test('narração e áudio do Colab são guardados no Windows', async () => {
  const { prepararArquivoAudio, caminhoDoAudio } = await import('../audio/publicacao.js');
  const origem = join(dados, 'narracao.mp3');
  await writeFile(origem, 'ID3 áudio de teste');
  const hash = await prepararArquivoAudio(origem);
  expect(await readFile(caminhoDoAudio(hash), 'utf8')).toBe('ID3 áudio de teste');
});

test('mídia enviada e áudio do YouTube são aceitos no Windows', async () => {
  const { receberMidia, caminhoDaMidia } = await import('../midia/arquivos.js');
  const bytes = new TextEncoder().encode('mídia de teste');
  const fluxo = new ReadableStream<Uint8Array>({ start(controle) { controle.enqueue(bytes); controle.close(); } });
  const { sha256, bytes: tamanho } = await receberMidia(fluxo);
  expect(tamanho).toBe(bytes.byteLength);
  expect(await readFile(caminhoDaMidia(sha256), 'utf8')).toBe('mídia de teste');
});
