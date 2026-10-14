/**
 * J119 · Questão por imagem: o print entra pela API, vira um PDF de uma página (motor de verdade),
 * a canonização publica a versão e a resolução da página inteira entra na fila sozinha; o executor
 * falso a resolve e ela fica pronta, como uma resolução da Ferramenta de área.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Id, ResolucaoGeradaV1, ResolucaoV2 } from '@margem/contratos';
import { comBanco } from '../../testes/apoio.js';
import { caminhoDoOriginal, pastaDoDocumento, raizDoRepositorio } from '../dados.js';
import { criarApi } from '../http/app.js';
import { CABECALHO_MARGEM } from '../http/ambiente.js';
import { criarExecutorFalso } from '../executor/fake.js';
import type { PedidoExecucao } from '../executor/tipos.js';
import { manipuladoresDaResolucao, caminhoDaImagem } from '../resolucao/pipeline.js';
import { manipuladorCanonizar, TIPO_CANONIZAR } from '../worker/canonizar.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { lerCabecalhoDaImagem, tituloDaQuestao } from './imagem.js';

const executar = promisify(execFile);
const PYTHON = join(raizDoRepositorio(), 'motor/.venv/bin/python');
const ESCRITA = { [CABECALHO_MARGEM]: '1' };

/** Imagens de teste feitas pelo PyMuPDF do motor (sem Pillow): um "print" PNG e uma "foto" JPEG. */
async function imagem(formato: 'png' | 'jpg', largura = 320, altura = 140): Promise<Buffer> {
  const { stdout } = await executar(PYTHON, ['-c', [
    'import sys, base64, pymupdf',
    `p = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, ${String(largura)}, ${String(altura)}), 0)`,
    'p.clear_with(255); p.set_rect(pymupdf.IRect(12, 12, 60, 40), (30, 30, 30))',
    `sys.stdout.write(base64.b64encode(p.tobytes(output="${formato}")).decode())`,
  ].join('\n')]);
  return Buffer.from(stdout, 'base64');
}

function formulario(conteudo: Uint8Array, nome: string, tipo: string, extras: Record<string, string> = {}): FormData {
  const dados = new FormData();
  dados.set('arquivo', new File([conteudo], nome, { type: tipo }));
  for (const [chave, valor] of Object.entries(extras)) dados.set(chave, valor);
  return dados;
}

const RESOLUCAO: ResolucaoGeradaV1 = {
  enunciado: 'Calcule 2 + 2.', legibilidade: 'boa',
  itens: [{ rotulo: '', enunciado: '2 + 2', estrategia: 'Somar.', passos: [{ texto: 'Some as unidades.', calculo: '2 + 2 = 4' }], resposta: '4', verificacao: '4 − 2 = 2' }],
  conceitos: ['adição'], observacao: null,
};

const temporarios: string[] = [];
let dadosAntes: string | undefined;
beforeEach(async () => {
  dadosAntes = process.env.MARGEM_DADOS;
  const dados = await mkdtemp(join(tmpdir(), 'margem-questao-dados-'));
  temporarios.push(dados);
  process.env.MARGEM_DADOS = dados;
});
afterEach(async () => {
  if (dadosAntes === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = dadosAntes;
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});

describe('cabeçalho da imagem', () => {
  test('PNG e JPEG pela assinatura, com as dimensões do cabeçalho; os outros recusados com nome', async () => {
    expect(lerCabecalhoDaImagem(await imagem('png', 320, 140))).toEqual({ formato: 'png', largura: 320, altura: 140 });
    expect(lerCabecalhoDaImagem(await imagem('jpg', 333, 77))).toEqual({ formato: 'jpeg', largura: 333, altura: 77 });
    expect(lerCabecalhoDaImagem(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'))).toEqual({ recusa: 'outro_formato', nome: 'WebP' });
    expect(lerCabecalhoDaImagem(Buffer.from('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00', 'latin1'))).toEqual({ recusa: 'outro_formato', nome: 'HEIC' });
    expect(lerCabecalhoDaImagem(Buffer.from('GIF89a', 'latin1'))).toEqual({ recusa: 'outro_formato', nome: 'GIF' });
    expect(lerCabecalhoDaImagem(Buffer.from('%PDF-1.7', 'latin1'))).toEqual({ recusa: 'desconhecido' });
    expect(lerCabecalhoDaImagem(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toEqual({ recusa: 'ilegivel' });
    expect(lerCabecalhoDaImagem(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toEqual({ recusa: 'ilegivel' });
  });

  test('título padrão na data local', () => {
    expect(tituloDaQuestao(new Date(2026, 9, 3, 23, 59))).toBe('Questão de 03/10/2026');
  });
});

test('upload: tipos recusados, limite, assinatura e campos', async () => comBanco('questao_recusas', async (banco) => {
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
  const enviar = (dados: FormData) => api.request('/api/importacoes/questao', { method: 'POST', headers: ESCRITA, body: dados });
  const codigo = async (resposta: Response) => ({ status: resposta.status, erro: (await resposta.json() as { erro: string }).erro });

  expect(await codigo(await enviar(formulario(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'), 'q.webp', 'image/webp')))).toEqual({ status: 415, erro: 'formato_de_imagem' });
  expect(await codigo(await enviar(formulario(Buffer.from('GIF89a......', 'latin1'), 'q.gif', 'image/gif')))).toEqual({ status: 415, erro: 'formato_de_imagem' });
  // Extensão e MIME mentem: quem decide é a assinatura.
  expect(await codigo(await enviar(formulario(Buffer.from('%PDF-1.7 não é imagem'), 'q.png', 'image/png')))).toEqual({ status: 415, erro: 'imagem_invalida' });
  expect(await codigo(await enviar(formulario(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'q.png', 'image/png')))).toEqual({ status: 422, erro: 'imagem_ilegivel' });
  expect(await codigo(await enviar(formulario(new Uint8Array(0), 'q.png', 'image/png')))).toEqual({ status: 400, erro: 'sem_imagem' });
  expect(await codigo(await enviar(formulario(await imagem('png'), 'q.png', 'image/png', { formato: 'pdf' })))).toEqual({ status: 400, erro: 'campo_desconhecido' });
  expect(await codigo(await enviar(formulario(await imagem('png'), 'q.png', 'image/png', { titulo: 'a\nb' })))).toEqual({ status: 400, erro: 'titulo_invalido' });
  // Cabeçalho de PNG de 10 000 × 10 000: recusado pelo tamanho antes de qualquer decodificação.
  const gigante = Buffer.from(await imagem('png'));
  gigante.writeUInt32BE(10_000, 16); gigante.writeUInt32BE(10_000, 20);
  expect(await codigo(await enviar(formulario(gigante, 'q.png', 'image/png')))).toEqual({ status: 413, erro: 'imagem_grande_demais' });
  // Mais de 25 MB: recusado pelo tamanho do corpo.
  const grande = Buffer.alloc(25 * 1024 * 1024 + 200 * 1024);
  Buffer.from(await imagem('png')).copy(grande);
  expect((await enviar(formulario(grande, 'q.png', 'image/png'))).status).toBe(413);
  // Nada entrou na biblioteca.
  expect((await banco.query('SELECT count(*)::int AS n FROM documento')).rows[0]).toEqual({ n: 0 });
}));

async function rodarWorker(banco: pg.Pool, pasta: string, executor: (pedido: PedidoExecucao) => ReturnType<ReturnType<typeof criarExecutorFalso>>, ciclos: number): Promise<void> {
  await new Worker({
    fila: new FilaPostgres(banco),
    manipuladores: {
      [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }),
      ...manipuladoresDaResolucao({ banco, executor, modelo: 'modelo-de-teste', esforco: 'alto', prazoMs: 10_000 }),
    },
    diretorioSlots: join(pasta, 'vagas'), slots: 1, intervaloMs: 5, maximoCiclos: ciclos, heartbeatMs: 60_000,
  }).rodar();
}

test('print → PDF de uma página → resolução disparada sozinha e publicada com o executor falso', async () => comBanco('questao_fluxo', async (banco) => {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-questao-'));
  temporarios.push(pasta);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
  const print = await imagem('png', 320, 140);
  const resposta = await api.request('/api/importacoes/questao', { method: 'POST', headers: ESCRITA, body: formulario(print, 'image.png', 'image/png') });
  expect(resposta.status).toBe(202);
  const { documento_id: documentoId } = await resposta.json() as { documento_id: Id; job_id: Id };

  // O original é um PDF de uma página com a imagem em tamanho natural (320 px = 240 pt).
  const original = caminhoDoOriginal(documentoId, 'pdf');
  expect((await readFile(original)).subarray(0, 5).toString()).toBe('%PDF-');
  const { stdout } = await executar(PYTHON, ['-c', 'import sys, pymupdf\nd = pymupdf.open(sys.argv[1]); p = d[0]\nprint(d.page_count, round(p.rect.width), round(p.rect.height), len(p.get_images()), repr(p.get_text().strip()))', original]);
  expect(stdout.trim()).toBe("1 240 105 1 ''");
  // O PNG da resolução é o print, byte a byte; o título é o padrão.
  const marca = JSON.parse(await readFile(join(pastaDoDocumento(documentoId), 'questao.json'), 'utf8')) as { imagem_sha256: string };
  expect(await readFile(caminhoDaImagem(documentoId, marca.imagem_sha256))).toEqual(print);
  const detalhe = await (await api.request(`/api/documentos/${documentoId}`)).json() as { titulo: string; formato: string };
  expect(detalhe).toMatchObject({ titulo: tituloDaQuestao(new Date()), formato: 'pdf' });

  const pedidos: { pedido: PedidoExecucao; imagem: Buffer | null }[] = [];
  const falso = criarExecutorFalso({ versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: RESOLUCAO }] });
  const executor = async (pedido: PedidoExecucao) => {
    const caminho = join(pedido.diretorioEntrada, 'recorte.png');
    pedidos.push({ pedido, imagem: existsSync(caminho) ? await readFile(caminho) : null });
    return falso({ ...pedido, diretorioArtefatos: pasta });
  };
  await rodarWorker(banco, pasta, executor, 3);

  const { resolucoes } = await (await api.request(`/api/documentos/${documentoId}/resolucoes`)).json() as { resolucoes: { resolucao: ResolucaoV2; estado: string }[] };
  expect(resolucoes).toHaveLength(1);
  const [{ resolucao, estado }] = resolucoes as [{ resolucao: ResolucaoV2; estado: string }];
  expect(estado).toBe('pronta');
  expect(resolucao.origem).toEqual({ tipo: 'recorte', pagina: 1, retangulo: { x: 0, y: 0, largura: 1, altura: 1 }, imagem_sha256: marca.imagem_sha256 });
  expect(resolucao.texto_extraido).toBe('');
  expect(resolucao.resolucao).toEqual(RESOLUCAO);
  const versao = (await banco.query<{ id: Id }>('SELECT id FROM versao_texto WHERE documento_id=$1', [documentoId])).rows;
  expect(versao).toHaveLength(1);
  expect(resolucao.versao_id).toBe(versao[0]!.id);
  // A imagem foi junto para o modelo, e é a do print.
  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]!.pedido.imagens).toEqual(['recorte.png']);
  expect(pedidos[0]!.imagem).toEqual(print);
  // A imagem da sessão é servida como a de qualquer recorte.
  const servida = await api.request(`/api/resolucoes/${resolucao.id}/imagem`);
  expect(servida.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await servida.arrayBuffer())).toEqual(print);

  // O mesmo print de novo: já está na biblioteca, nada de documento nem resolução novos.
  const repetido = await api.request('/api/importacoes/questao', { method: 'POST', headers: ESCRITA, body: formulario(print, 'outro.png', 'image/png', { titulo: 'Lista 3, questão 2' }) });
  expect(repetido.status).toBe(409);
  expect(await repetido.json()).toMatchObject({ erro: 'documento_duplicado', documento_id: documentoId });
  expect((await banco.query('SELECT count(*)::int AS n FROM resolucao')).rows[0]).toEqual({ n: 1 });
}));

test('foto JPEG com título digitado: o PNG da resolução é gerado pelo motor', async () => comBanco('questao_jpeg', async (banco) => {
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
  const foto = await imagem('jpg', 400, 300);
  const resposta = await api.request('/api/importacoes/questao', { method: 'POST', headers: ESCRITA, body: formulario(foto, 'foto.jpg', 'image/jpeg', { titulo: '  Lista 3, questão 2 ' }) });
  expect(resposta.status).toBe(202);
  const { documento_id: documentoId } = await resposta.json() as { documento_id: Id };
  const detalhe = await (await api.request(`/api/documentos/${documentoId}`)).json() as { titulo: string };
  expect(detalhe.titulo).toBe('Lista 3, questão 2');
  const marca = JSON.parse(await readFile(join(pastaDoDocumento(documentoId), 'questao.json'), 'utf8')) as { imagem_sha256: string; largura: number; altura: number };
  expect(marca).toMatchObject({ largura: 400, altura: 300 });
  expect((await readFile(caminhoDaImagem(documentoId, marca.imagem_sha256))).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}));
