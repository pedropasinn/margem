import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { GeometriaV1 } from '@margem/contratos';
import { idTeste } from '../../testes/apoio.js';
import { pastaDaVersao } from '../dados.js';
import { CacheDeGeometria, caminhoDaGeometria, pastaDosRecortes, PAGINAS_POR_RECORTE } from './arquivos.js';

const documentoId = idTeste('D', 163);
const versaoId = idTeste('V', 163);
const dadosAntes = process.env.MARGEM_DADOS;
let pasta = '';
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), 'margem-j163-'));
  process.env.MARGEM_DADOS = pasta;
  await mkdir(pastaDaVersao(documentoId, versaoId), { recursive: true });
});
afterEach(async () => {
  if (dadosAntes === undefined) delete process.env.MARGEM_DADOS;
  else process.env.MARGEM_DADOS = dadosAntes;
  await rm(pasta, { recursive: true, force: true });
});

/** `total` páginas com `porPagina` palavras cada, todas de um bloco só, em ordem. */
function geometria(total: number, porPagina = 3, motor = 'teste/1'): GeometriaV1 {
  const bloco = idTeste('B', 1);
  return { versao: 1, versao_id: versaoId, fonte: 'pdf_texto', motor,
    paginas: Array.from({ length: total }, (_, i) => ({ numero: i + 1, largura: 600, altura: 800, rotacao: 0 as const })),
    palavras: Array.from({ length: total * porPagina }, (_, i) => ({ bloco_id: bloco, inicio_utf16: i * 2, fim_utf16: i * 2 + 1,
      pagina: Math.floor(i / porPagina) + 1, quad: [0, 0, 20, 0, 20, 10, 0, 10] })),
  };
}

function faixa(inteira: GeometriaV1, inicio: number, fim: number): GeometriaV1 {
  const paginas = inteira.paginas.filter((p) => p.numero >= inicio && p.numero <= fim);
  return { ...inteira, paginas, palavras: inteira.palavras.filter((p) => p.pagina >= inicio && p.pagina <= fim) };
}

test('I-06: acima do teto, o arquivo inteiro é lido uma vez e as faixas vêm dos recortes', async () => {
  const inteira = geometria(200);
  await writeFile(caminhoDaGeometria(documentoId, versaoId), JSON.stringify(inteira));
  const cache = new CacheDeGeometria(4 * 1024);
  for (const [inicio, fim] of [[1, 60], [61, 120], [121, 180], [181, 200], [45, 104]] as const) {
    expect(await cache.paginas(documentoId, versaoId, inicio, fim)).toEqual(faixa(inteira, inicio, fim));
  }
  expect(await cache.totalDePaginas(documentoId, versaoId)).toBe(200);
  expect(cache.leiturasIntegrais).toBe(1);
  const arquivos = (await readdir(pastaDosRecortes(documentoId, versaoId))).sort();
  expect(arquivos).toHaveLength(Math.ceil(200 / PAGINAS_POR_RECORTE) + 1);
  expect(arquivos).toContain('indice.json');
  // Outro processo (a API reiniciada): os recortes do disco servem sem reler o arquivo inteiro.
  const reiniciada = new CacheDeGeometria(4 * 1024);
  expect(await reiniciada.paginas(documentoId, versaoId, 150, 152)).toEqual(faixa(inteira, 150, 152));
  expect(await reiniciada.totalDePaginas(documentoId, versaoId)).toBe(200);
  expect(reiniciada.leiturasIntegrais).toBe(0);
  // Faixa além do fim: vazia, com o cabeçalho da geometria.
  expect(await reiniciada.paginas(documentoId, versaoId, 900, 901)).toEqual(faixa(inteira, 900, 901));
});

test('I-06: o original mudou, os recortes são refeitos; pedidos simultâneos leem uma vez só', async () => {
  await writeFile(caminhoDaGeometria(documentoId, versaoId), JSON.stringify(geometria(90)));
  const cache = new CacheDeGeometria(2 * 1024);
  await Promise.all([cache.paginas(documentoId, versaoId, 1, 60), cache.paginas(documentoId, versaoId, 61, 90), cache.totalDePaginas(documentoId, versaoId)]);
  expect(cache.leiturasIntegrais).toBe(1);
  const nova = geometria(95, 4, 'teste/2');
  await writeFile(caminhoDaGeometria(documentoId, versaoId), JSON.stringify(nova));
  const outra = new CacheDeGeometria(2 * 1024);
  expect(await outra.paginas(documentoId, versaoId, 61, 95)).toEqual(faixa(nova, 61, 95));
  expect(await outra.totalDePaginas(documentoId, versaoId)).toBe(95);
  expect(outra.leiturasIntegrais).toBe(1);
});

test('dentro do teto, a geometria fica inteira na memória e não gera recortes', async () => {
  const inteira = geometria(70);
  await writeFile(caminhoDaGeometria(documentoId, versaoId), JSON.stringify(inteira));
  const cache = new CacheDeGeometria();
  expect(await cache.paginas(documentoId, versaoId, 1, 60)).toEqual(faixa(inteira, 1, 60));
  expect(await cache.paginas(documentoId, versaoId, 61, 70)).toEqual(faixa(inteira, 61, 70));
  expect(await cache.totalDePaginas(documentoId, versaoId)).toBe(70);
  expect(cache.leiturasIntegrais).toBe(1);
  await expect(readdir(pastaDosRecortes(documentoId, versaoId))).rejects.toThrow();
  expect(await cache.paginas(idTeste('D', 1), idTeste('V', 1), 1, 2)).toBeNull();
});

test('R3-3: sem espaço para os recortes, a geometria já lida serve e não ficam recortes pela metade', async () => {
  const inteira = geometria(200);
  await writeFile(caminhoDaGeometria(documentoId, versaoId), JSON.stringify(inteira));
  let gravados = 0;
  const discoCheio = async (caminho: string, texto: string) => {
    if (++gravados > 2) throw Object.assign(new Error('sem espaço'), { code: 'ENOSPC' });
    await writeFile(caminho, texto);
  };
  const cache = new CacheDeGeometria(4 * 1024, discoCheio);
  expect(await cache.totalDePaginas(documentoId, versaoId)).toBe(200);
  expect(await cache.paginas(documentoId, versaoId, 61, 120)).toEqual(faixa(inteira, 61, 120));
  await expect(readdir(pastaDosRecortes(documentoId, versaoId))).rejects.toThrow();
});
