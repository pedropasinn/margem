/** Borda HTTP: teto real de upload, limite de requisições, cabeçalhos de segurança e checagem de PDF. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { Hono } from 'hono';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import { pastaDaVersao } from '../dados.js';
import type { ConfiguracaoDaLeitura } from '../leitura/manipuladores.js';
import { criarApi } from './app.js';
import { corpoDoErro, ErroDaApi, MENSAGEM_SEM_ESPACO } from './erros.js';
import { servirWeb } from './estatico.js';
import { criarLimiteDeTaxa, TETO_DE_EVENTOS_ABERTOS, TETOS_POR_MINUTO } from './limite-de-taxa.js';
import { CSP_DA_PAGINA, lerFormularioLimitado, pareceUmPdf } from './seguranca.js';

const temporarios: string[] = [];
const dadosOriginais = process.env.MARGEM_DADOS;
afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
  if (dadosOriginais === undefined) delete process.env.MARGEM_DADOS;
  else process.env.MARGEM_DADOS = dadosOriginais;
});

async function pastaTemporaria(prefixo: string): Promise<string> {
  const pasta = await mkdtemp(join(tmpdir(), prefixo));
  temporarios.push(pasta);
  return pasta;
}

const ESCRITA = { 'X-Margem': '1' };

// ---------------------------------------------------------------- teto real do upload

test('multipart sem Content-Length passa do teto: 413 e o envio é interrompido no fluxo', async () => {
  let enviados = 0;
  let cancelado = false;
  const pedaco = new Uint8Array(64 * 1024).fill(120);
  const fluxo = new ReadableStream<Uint8Array>({
    start(controle) { controle.enqueue(new TextEncoder().encode('--x\r\nContent-Disposition: form-data; name="arquivo"; filename="a.md"\r\n\r\n')); },
    pull(controle) { enviados += pedaco.byteLength; controle.enqueue(pedaco); },
    cancel() { cancelado = true; },
  });
  const pedido = new Request('http://localhost/api/documentos', {
    method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: fluxo, duplex: 'half',
  });
  const limite = 1024 * 1024;
  const erro = await lerFormularioLimitado(pedido, limite).catch((e: unknown) => e);
  expect(erro).toBeInstanceOf(ErroDaApi);
  expect(erro).toMatchObject({ status: 413, erro: 'corpo_grande_demais' });
  // O fluxo sem fim parou logo depois do teto (folga de alguns pedaços em trânsito), e foi cancelado.
  expect(enviados).toBeLessThan(limite + 8 * pedaco.byteLength);
  expect(cancelado).toBe(true);
});

test('multipart dentro do teto é lido normalmente; corpo que não é formulário é 400', async () => {
  const formulario = new FormData();
  formulario.set('titulo', 'Pequeno');
  formulario.set('arquivo', new File(['# oi'], 'a.md', { type: 'text/markdown' }));
  const lido = await lerFormularioLimitado(new Request('http://localhost/', { method: 'POST', body: formulario }), 1024);
  expect(lido.get('titulo')).toBe('Pequeno');
  expect(lido.get('arquivo')).toBeInstanceOf(File);
  await expect(lerFormularioLimitado(new Request('http://localhost/', { method: 'POST', body: 'nada' }), 1024))
    .rejects.toMatchObject({ status: 400, erro: 'formulario_invalido' });
});

test('assinatura do PDF: %PDF- no começo (ou depois de um pouco de lixo, até 1024 bytes)', () => {
  const codificar = (texto: string) => new TextEncoder().encode(texto);
  expect(pareceUmPdf(codificar('%PDF-1.7\n...'))).toBe(true);
  expect(pareceUmPdf(codificar(`${'\0'.repeat(100)}%PDF-1.4`))).toBe(true);
  expect(pareceUmPdf(codificar('<html><script>alert(1)</script>'))).toBe(false);
  expect(pareceUmPdf(codificar(`${' '.repeat(2000)}%PDF-1.4`))).toBe(false);
  expect(pareceUmPdf(new Uint8Array())).toBe(false);
});

// ---------------------------------------------------------------- limite de requisições

function appDeTaxa(agora: () => number): Hono {
  const taxa = criarLimiteDeTaxa(agora);
  const app = new Hono();
  app.onError((erro, c) => {
    const { status, corpo } = corpoDoErro(erro);
    if (erro instanceof ErroDaApi) for (const [nome, valor] of Object.entries(erro.cabecalhos ?? {})) c.header(nome, valor);
    return c.json(corpo, status);
  });
  app.use('/api/*', taxa.middleware);
  app.post('/api/documentos/:id/leituras', (c) => c.json({ ok: true }, 202));
  app.post('/api/documentos', (c) => c.json({ ok: true }, 202));
  app.put('/api/documentos/:id/progresso', (c) => c.json({ ok: true }));
  app.get('/api/eventos', (c) => {
    const liberar = taxa.abrirEventos(c);
    if (c.req.query('fechar') === '1') liberar();
    return c.text('ok');
  });
  return app;
}

test('janela fixa por IP e por grupo: 429 com Retry-After, e a janela seguinte libera', async () => {
  let instante = 1_000_000;
  const app = appDeTaxa(() => instante);
  const ia = (ip = '100.64.0.1') => app.request('/api/documentos/01J0000000000000000000000A/leituras',
    { method: 'POST', headers: { 'x-forwarded-for': ip } });
  for (let i = 0; i < TETOS_POR_MINUTO.ia; i += 1) expect((await ia()).status).toBe(202);
  instante += 20_000;
  const recusado = await ia();
  expect(recusado.status).toBe(429);
  expect(recusado.headers.get('retry-after')).toBe('40');
  expect(await recusado.json()).toMatchObject({ erro: 'muitas_requisicoes' });
  // Outro IP e outro grupo seguem livres; rota fora dos grupos não conta.
  expect((await ia('100.64.0.2')).status).toBe(202);
  expect((await app.request('/api/documentos', { method: 'POST', headers: { 'x-forwarded-for': '100.64.0.1' } })).status).toBe(202);
  for (let i = 0; i < 200; i += 1) {
    expect((await app.request('/api/documentos/x/progresso', { method: 'PUT', headers: { 'x-forwarded-for': '100.64.0.1' } })).status).toBe(200);
  }
  instante += 40_000;
  expect((await ia()).status).toBe(202);
});

test('o IP é o último X-Forwarded-For (o que o proxy acrescentou), não o que o cliente inventou', async () => {
  const app = appDeTaxa(() => 0);
  for (let i = 0; i < TETOS_POR_MINUTO.envio; i += 1) {
    const resposta = await app.request('/api/documentos', { method: 'POST', headers: { 'x-forwarded-for': `9.9.9.${String(i)}, 100.64.0.9` } });
    expect(resposta.status).toBe(202);
  }
  expect((await app.request('/api/documentos', { method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4, 100.64.0.9' } })).status).toBe(429);
});

test('SSE: teto de conexões abertas ao mesmo tempo, e a vaga volta quando uma fecha', async () => {
  const app = appDeTaxa(() => 0);
  for (let i = 0; i < TETO_DE_EVENTOS_ABERTOS; i += 1) expect((await app.request('/api/eventos')).status).toBe(200);
  const recusado = await app.request('/api/eventos');
  expect(recusado.status).toBe(429);
  expect(recusado.headers.get('retry-after')).toBe('5');
  // Num app novo, conexões que fecham devolvem a vaga.
  const outro = appDeTaxa(() => 0);
  for (let i = 0; i < TETO_DE_EVENTOS_ABERTOS + 5; i += 1) expect((await outro.request('/api/eventos?fechar=1')).status).toBe(200);
});

// ---------------------------------------------------------------- integração com a API

function configuracaoVazia(banco: import('pg').Pool): ConfiguracaoDaLeitura {
  return { banco } as unknown as ConfiguracaoDaLeitura;
}

test('API: PDF sem assinatura é 415; cabeçalhos de segurança no JSON, na página e no asset SVG', async () =>
  comBanco('api_seguranca_http', async (banco) => {
    process.env.MARGEM_DADOS = await pastaTemporaria('margem-seg-dados-');
    const api = criarApi({ banco, leitura: () => configuracaoVazia(banco), intervaloEventosMs: 20 });
    const web = await pastaTemporaria('margem-seg-web-');
    await writeFile(join(web, 'index.html'), '<!doctype html><title>Margem</title>');
    servirWeb(api, web);

    const formulario = new FormData();
    formulario.set('titulo', 'Falso PDF');
    formulario.set('formato', 'pdf');
    formulario.set('arquivo', new File(['<html><script>alert(1)</script></html>'], 'falso.pdf', { type: 'application/pdf' }));
    const falso = await api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario });
    expect(falso.status).toBe(415);
    expect(await falso.json()).toMatchObject({ erro: 'pdf_invalido' });

    const lista = await api.request('/api/documentos');
    expect(lista.status).toBe(200);
    expect(lista.headers.get('x-content-type-options')).toBe('nosniff');
    expect(lista.headers.get('x-frame-options')).toBe('DENY');
    expect(lista.headers.get('referrer-policy')).toBe('same-origin');
    expect(lista.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(lista.headers.get('strict-transport-security')).toBeNull();

    const pagina = await api.request('/ler/qualquer', { headers: { 'x-forwarded-proto': 'https' } });
    expect(pagina.status).toBe(200);
    expect(pagina.headers.get('content-security-policy')).toBe(CSP_DA_PAGINA);
    expect(pagina.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(pagina.headers.get('x-frame-options')).toBe('DENY');

    // Asset SVG: servido com CSP `sandbox` e `nosniff` (um script dentro dele não roda na origem do app).
    const base = canonicoDeTeste({ titulo: 'Com figura', blocos: [{ tipo: 'capitulo', texto: 'Um' }, { tipo: 'paragrafo', texto: 'Texto.' }], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
    const assetId = '01J00000000000000000000AS1';
    const canonico = { ...base, assets: [{ id: assetId, tipo: 'imagem' as const, caminho: 'assets/figura.svg', sha256: 'b'.repeat(64) }] };
    const versao = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });
    const pasta = join(pastaDaVersao(versao.documento_id, versao.id), 'assets');
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, 'figura.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const asset = await api.request(`/api/assets/${versao.id}/${assetId}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('image/svg+xml');
    expect(asset.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(asset.headers.get('x-content-type-options')).toBe('nosniff');

    // Mídia: o corpo já é lido em fluxo e contado; sem Content-Length, o teto vale do mesmo jeito.
    const limiteAnterior = process.env.MARGEM_LIMITE_MIDIA;
    process.env.MARGEM_LIMITE_MIDIA = String(256 * 1024);
    try {
      let cancelado = false;
      const fluxo = new ReadableStream<Uint8Array>({
        pull(controle) { controle.enqueue(new Uint8Array(64 * 1024)); },
        cancel() { cancelado = true; },
      });
      const midia = await api.request('/api/midia/arquivos', {
        method: 'PUT', headers: ESCRITA, body: fluxo, duplex: 'half',
      });
      expect(midia.status).toBe(413);
      expect(cancelado).toBe(true);
    } finally {
      if (limiteAnterior === undefined) delete process.env.MARGEM_LIMITE_MIDIA;
      else process.env.MARGEM_LIMITE_MIDIA = limiteAnterior;
    }
  }));

test('D-13: disco cheio (ENOSPC ou SQLSTATE 53100) vira mensagem em português, não falha interna', () => {
  for (const erro of [Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }), Object.assign(new Error('could not extend file'), { code: '53100' }),
    new Error('envolto', { cause: Object.assign(new Error('x'), { code: 'ENOSPC' }) })]) {
    expect(corpoDoErro(erro)).toEqual({ status: 507, corpo: { erro: 'sem_espaco', detalhe: MENSAGEM_SEM_ESPACO } });
  }
  expect(MENSAGEM_SEM_ESPACO).toMatch(/^Sem espaço no disco/);
  expect(corpoDoErro(new Error('outra'))).toEqual({ status: 500, corpo: { erro: 'falha_interna' } });
});

test('I-09: PDF com MIME octet-stream ou vazio é aceito; conteúdo falso continua recusado', async () =>
  comBanco('api_pdf_mime', async (banco) => {
    process.env.MARGEM_DADOS = await pastaTemporaria('margem-i09-dados-');
    const api = criarApi({ banco, leitura: () => configuracaoVazia(banco), intervaloEventosMs: 20 });
    const enviar = (conteudo: string, tipo: string, nome: string) => {
      const formulario = new FormData();
      formulario.set('formato', 'pdf');
      formulario.set('arquivo', new File([conteudo], nome, { type: tipo }));
      return api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario });
    };
    expect((await enviar('%PDF-1.7\num', 'application/octet-stream', 'um.pdf')).status).toBe(202);
    expect((await enviar('%PDF-1.7\ndois', '', 'dois.pdf')).status).toBe(202);
    expect((await enviar('%PDF-1.7\ntres', 'application/pdf', 'tres.pdf')).status).toBe(202);
    const falso = await enviar('<html></html>', 'application/octet-stream', 'falso.pdf');
    expect(falso.status).toBe(415);
    expect(await falso.json()).toMatchObject({ erro: 'pdf_invalido' });
    expect((await enviar('%PDF-1.7\nquatro', 'text/html', 'quatro.pdf')).status).toBe(415);
  }));
