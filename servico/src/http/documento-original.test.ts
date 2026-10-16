import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type pg from 'pg';
import type { CanonicoV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco, idTeste } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { pastaDaVersao } from '../dados.js';
import { CacheDeGeometria } from '../geometria/arquivos.js';
import type { GeometriaV1 } from '@margem/contratos';
import * as documentos from '../repos/documentos.js';
import { prepararManifestoDaVersao } from '../worker/canonizar.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
const dadosAntes = process.env.MARGEM_DADOS;
afterEach(async () => {
  if (dadosAntes === undefined) delete process.env.MARGEM_DADOS;
  else process.env.MARGEM_DADOS = dadosAntes;
  for (const pasta of temporarios.splice(0)) await rm(pasta, { recursive: true, force: true });
});
async function temporario(): Promise<string> {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-j23-'));
  temporarios.push(pasta);
  return pasta;
}
const bytes = '%PDF-1.7\n0123456789abcdef';
async function criar(banco: pg.Pool, formato: 'pdf' | 'md' = 'pdf') {
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'capitulo', texto: 'Título' }, { tipo: 'paragrafo', texto: 'Uma frase.' }], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
  canonico.documento.formato = formato;
  canonico.documento.sha256_original = createHash('sha256').update(bytes).digest('hex');
  if (formato === 'pdf') canonico.blocos.forEach((bloco, i) => {
    bloco.origens = [{ tipo: 'pdf', pagina: i + 2, bbox: [0, 0, 100, 20], inicio: 0, fim: bloco.texto.length }];
  });
  const caminho = join(process.env.MARGEM_DADOS!, `original-${formato}.pdf`);
  await writeFile(caminho, bytes);
  const versao = await comTransacao(banco, async (cliente) => {
    const doc = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: caminho });
    return documentos.criarVersao(cliente, doc.id, canonico);
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); } });
  return { api, versao, canonico, caminho };
}
function geometria(versaoId: string, canonico: CanonicoV1, total = 3): GeometriaV1 {
  return { versao: 1, versao_id: versaoId, fonte: 'pdf_texto', motor: 'teste/1',
    paginas: Array.from({ length: total }, (_, i) => ({ numero: i + 1, largura: 600, altura: 800, rotacao: 0 })),
    palavras: canonico.blocos.map((bloco, i) => ({ bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: 3, pagina: i + 2, quad: [0, 0, 20, 0, 20, 10, 0, 10] })),
  };
}

test('original: Range início, meio, fim, sufixo, 416; ETag, 304 e If-Range', async () => comBanco('j23_original', async (banco) => {
  process.env.MARGEM_DADOS = await temporario();
  const { api, versao, canonico } = await criar(banco);
  const url = `/api/documentos/${versao.documento_id}/original`;
  const inteiro = await api.request(url, { headers: { 'Accept-Encoding': 'br, gzip' } });
  expect(inteiro.headers.has('content-encoding')).toBe(false);
  expect(await inteiro.text()).toBe(bytes);
  expect(inteiro.headers.get('etag')).toBe(`"${canonico.documento.sha256_original}"`);
  expect(inteiro.headers.get('cache-control')).toBe('private, no-cache');
  expect(inteiro.headers.get('content-type')).toBe('application/pdf');
  expect(inteiro.headers.get('accept-ranges')).toBe('bytes');
  for (const [range, inicio, fim] of [['bytes=0-3', 0, 3], ['bytes=5-9', 5, 9], ['bytes=20-', 20, bytes.length - 1], ['bytes=-4', bytes.length - 4, bytes.length - 1], ['bytes=20-999', 20, bytes.length - 1]] as const) {
    const resposta = await api.request(url, { headers: { Range: range, 'Accept-Encoding': 'br, gzip' } });
    expect(resposta.status).toBe(206);
    expect(resposta.headers.has('content-encoding')).toBe(false);
    expect(resposta.headers.get('content-range')).toBe(`bytes ${String(inicio)}-${String(fim)}/${String(bytes.length)}`);
    expect(await resposta.text()).toBe(bytes.slice(inicio, fim + 1));
  }
  for (const range of ['bytes=99-', 'bytes=8-2', 'bytes=-0', 'bytes=1-2,4-5', 'bytes=x-y']) {
    const resposta = await api.request(url, { headers: { Range: range, 'Accept-Encoding': 'br, gzip' } });
    expect(resposta.status).toBe(416);
    expect(resposta.headers.get('content-range')).toBe(`bytes */${String(bytes.length)}`);
  }
  const condicional = await api.request(url, { headers: { 'If-None-Match': `W/${inteiro.headers.get('etag')!}` } });
  expect(condicional.status).toBe(304);
  expect(await condicional.text()).toBe('');
  const mudou = await api.request(url, { headers: { Range: 'bytes=0-3', 'If-Range': '"outro"' } });
  expect(mudou.status).toBe(200);
  expect(await mudou.text()).toBe(bytes);
}));

test('confinamento do caminho do banco, inclusive symlink; documento ausente e Markdown', async () => comBanco('j23_caminho', async (banco) => {
  process.env.MARGEM_DADOS = await temporario();
  const fora = join(await temporario(), 'privado.pdf');
  await writeFile(fora, 'privado');
  const { api, versao } = await criar(banco);
  const link = join(process.env.MARGEM_DADOS, 'link.pdf');
  await symlink(fora, link);
  for (const caminho of [fora, join(process.env.MARGEM_DADOS, '../privado.pdf'), link]) {
    await banco.query('UPDATE documento SET origem_caminho=$1 WHERE id=$2', [caminho, versao.documento_id]);
    expect((await api.request(`/api/documentos/${versao.documento_id}/original`)).status).toBe(404);
  }
  expect((await api.request(`/api/documentos/${idTeste('D', 90)}/original`)).status).toBe(404);
  const md = await criar(banco, 'md');
  expect((await api.request(`/api/documentos/${md.versao.documento_id}/original`)).status).toBe(404);
  const snapshot = await api.request(`/api/versoes/${md.versao.id}/capitulos/${md.canonico.secoes[0]!.id}`);
  expect(await snapshot.json()).toMatchObject({ formato: 'md', paginas: null, geometria_disponivel: false });
}));

test('geometria: faixa, limite 60, snapshot, ausência e manifesto com hash final', async () => comBanco('j23_geometria', async (banco) => {
  process.env.MARGEM_DADOS = await temporario();
  const { api, versao, canonico } = await criar(banco);
  const url = `/api/versoes/${versao.id}/geometria`;
  expect(await (await api.request(url)).json()).toEqual({ erro: 'geometria_indisponivel' });
  const snapshot = `/api/versoes/${versao.id}/capitulos/${canonico.secoes[0]!.id}`;
  expect(await (await api.request(snapshot)).json()).toMatchObject({ formato: 'pdf', paginas: { inicio: 2, fim: 3 }, geometria_disponivel: false });
  const pasta = pastaDaVersao(versao.documento_id, versao.id);
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, 'canonico.json'), JSON.stringify(canonico));
  await writeFile(join(pasta, 'geometria.json'), JSON.stringify(geometria(idTeste('V', 0), canonico, 61)));
  await prepararManifestoDaVersao(pasta, versao.id);
  const texto = await readFile(join(pasta, 'geometria.json'), 'utf8');
  expect(JSON.parse(texto)).toMatchObject({ versao_id: versao.id });
  const manifesto = JSON.parse(await readFile(join(pasta, 'manifesto.json'), 'utf8')) as { versao_id: string; arquivos: { caminho: string; sha256: string }[] };
  expect(manifesto.versao_id).toBe(versao.id);
  expect(manifesto.arquivos).toContainEqual({ caminho: 'geometria.json', sha256: createHash('sha256').update(texto).digest('hex') });
  expect((await api.request(url)).status).toBe(400);
  for (const faixa of ['1-61', '0-2', '2-1', 'a', '']) expect((await api.request(`${url}?paginas=${faixa}`)).status).toBe(400);
  const recorte = await (await api.request(`${url}?paginas=2-3`)).json() as GeometriaV1;
  expect(recorte.paginas.map((p) => p.numero)).toEqual([2, 3]);
  expect(recorte.palavras.map((p) => p.pagina)).toEqual([2, 3]);
  expect((await api.request(`${url}?paginas=1-60`)).status).toBe(200);
  expect(await (await api.request(snapshot)).json()).toMatchObject({ geometria_disponivel: true });
  const semCache = new CacheDeGeometria(1);
  expect((await semCache.ler(versao.documento_id, versao.id))?.paginas).toHaveLength(61);
}));

test('manifesto tolera motor sem geometria', async () => {
  const pasta = await temporario();
  await writeFile(join(pasta, 'canonico.json'), '{}');
  await prepararManifestoDaVersao(pasta, idTeste('V', 1));
  expect(JSON.parse(await readFile(join(pasta, 'manifesto.json'), 'utf8'))).toMatchObject({ arquivos: [{ caminho: 'canonico.json', sha256: createHash('sha256').update('{}').digest('hex') }] });
});

test('geometria inválida não entra no cache nem na publicação; cache respeita seu teto', async () => {
  process.env.MARGEM_DADOS = await temporario();
  const documentoId = idTeste('D', 1);
  const versaoId = idTeste('V', 1);
  const pasta = pastaDaVersao(documentoId, versaoId);
  await mkdir(pasta, { recursive: true });
  const caminho = join(pasta, 'geometria.json');
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Uma frase.' }] });
  const valida: GeometriaV1 = { versao: 1, versao_id: versaoId, fonte: 'pdf_texto', motor: 'teste/1', paginas: [], palavras: [] };
  await writeFile(caminho, JSON.stringify({ ...valida, extra: true }));
  const cache = new CacheDeGeometria();
  await expect(cache.ler(documentoId, versaoId)).rejects.toThrow('Geometria inválida');
  await writeFile(join(pasta, 'canonico.json'), JSON.stringify(canonico));
  await expect(prepararManifestoDaVersao(pasta, versaoId)).rejects.toThrow('Geometria inválida');
  await writeFile(caminho, JSON.stringify({ ...valida,
    paginas: [{ numero: 1, largura: 600, altura: 800, rotacao: 0 }],
    palavras: [{ bloco_id: canonico.blocos[0]!.id, inicio_utf16: 0, fim_utf16: 3, pagina: 1, quad: [0, 0, 20, 0, 20, 10, 0, 10] }],
  }));
  await expect(prepararManifestoDaVersao(pasta, versaoId)).rejects.toThrow('não corresponde ao canônico');
  await writeFile(caminho, JSON.stringify(valida));
  const primeira = await cache.ler(documentoId, versaoId);
  expect(await cache.ler(documentoId, versaoId)).toBe(primeira);
  const semRetencao = new CacheDeGeometria(0);
  const semCache = await semRetencao.ler(documentoId, versaoId);
  expect(await semRetencao.ler(documentoId, versaoId)).not.toBe(semCache);
});

test('capa publicada: JPEG, cache condicional, manifesto, ausência e confinamento', async () => comBanco('noite_capa', async (banco) => {
  process.env.MARGEM_DADOS = await temporario();
  const { api, versao, canonico } = await criar(banco);
  const url = `/api/versoes/${versao.id}/capa`;
  expect((await api.request(url)).status).toBe(404);
  expect((await api.request('/api/versoes/invalida/capa')).status).toBe(400);
  expect((await api.request(`/api/versoes/${idTeste('V', 99)}/capa`)).status).toBe(404);
  const pasta = pastaDaVersao(versao.documento_id, versao.id);
  await mkdir(pasta, { recursive: true });
  const bytesCapa = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await writeFile(join(pasta, 'capa.jpg'), bytesCapa);
  await writeFile(join(pasta, 'canonico.json'), JSON.stringify(canonico));
  await prepararManifestoDaVersao(pasta, versao.id);
  const hash = createHash('sha256').update(bytesCapa).digest('hex');
  const manifesto = JSON.parse(await readFile(join(pasta, 'manifesto.json'), 'utf8')) as { arquivos: unknown[] };
  expect(manifesto.arquivos).toContainEqual({ caminho: 'capa.jpg', sha256: hash });
  const resposta = await api.request(url);
  expect(resposta.status).toBe(200);
  expect(resposta.headers.get('content-type')).toBe('image/jpeg');
  expect(resposta.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  expect(Buffer.from(await resposta.arrayBuffer())).toEqual(bytesCapa);
  expect((await api.request(url, { headers: { 'If-None-Match': `W/"${hash}"` } })).status).toBe(304);
  const fora = join(await temporario(), 'fora.jpg');
  await writeFile(fora, bytesCapa);
  await rm(join(pasta, 'capa.jpg'));
  await symlink(fora, join(pasta, 'capa.jpg'));
  expect((await api.request(url)).status).toBe(404);
}));

test('D-04: biblioteca movida: o original gerenciado é achado pelo id na raiz atual, sem afrouxar a raiz', async () => comBanco('d04_original', async (banco) => {
  process.env.MARGEM_DADOS = await temporario();
  const { api, versao } = await criar(banco);
  const id = versao.documento_id;
  // O original no lugar do app, e o registro com o caminho absoluto da biblioteca antiga (outro disco).
  await mkdir(join(process.env.MARGEM_DADOS, id), { recursive: true });
  await writeFile(join(process.env.MARGEM_DADOS, id, 'original.pdf'), bytes);
  await banco.query('UPDATE documento SET origem_caminho=$2 WHERE id=$1', [id, `/media/disco-antigo/Margem/${id}/original.pdf`]);
  const movido = await api.request(`/api/documentos/${id}/original`);
  expect(movido.status).toBe(200);
  expect(await movido.text()).toBe(bytes);
  // Caminho do Windows de antes da restauração: o mesmo.
  await banco.query('UPDATE documento SET origem_caminho=$2 WHERE id=$1', [id, `C:\\Users\\outra\\Margem\\${id}\\original.pdf`]);
  expect((await api.request(`/api/documentos/${id}/original`)).status).toBe(200);
  // Fora do padrão do app (outro id na pasta, outro nome, fora da raiz): continua recusado.
  for (const fora of [`/media/disco-antigo/Margem/01ARZ3NDEKTSV4RRFFQ69G5FAV/original.pdf`, `/media/disco-antigo/Margem/${id}/outro.pdf`, '/etc/passwd']) {
    await banco.query('UPDATE documento SET origem_caminho=$2 WHERE id=$1', [id, fora]);
    expect((await api.request(`/api/documentos/${id}/original`)).status).toBe(404);
  }
}));
