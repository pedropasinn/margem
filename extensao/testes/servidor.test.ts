import { afterEach, expect, test, vi } from 'vitest';
import {
  SERVIDOR_PADRAO, cabecalhosDeEscrita, definirVerificadorDeAcesso, enviarTexto, importacaoDaCaptura, normalizarServidor,
  padraoDeHost, permissaoDeHost, testarConexao,
} from '../src/servidor';
import type { CapturaDeTexto } from '../src/tipos';

const CAPTURA: CapturaDeTexto = {
  tipo: 'selecao', titulo: 'Página (trecho)', site: 'exemplo.com', url: 'https://exemplo.com/a',
  markdown: 'Texto.', palavras: 1, previa: 'Texto.',
};
const CONFIG = { servidor: 'http://127.0.0.1:8753', token: '' };

/** O erro com que a promessa falha (o teste quebra se ela der certo). */
async function falha(promessa: Promise<unknown>): Promise<Error> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof Error) return erro;
  }
  throw new Error('a promessa deveria falhar');
}

afterEach(() => { vi.unstubAllGlobals(); definirVerificadorDeAcesso(undefined); });

test('normalizarServidor aceita http(s) e tira a barra final', () => {
  expect(normalizarServidor(' https://margem.exemplo.ts.net/ ')).toBe('https://margem.exemplo.ts.net');
  expect(normalizarServidor(SERVIDOR_PADRAO)).toBe('http://localhost:8730');
  expect(normalizarServidor('http://127.0.0.1:8730')).toBe('http://127.0.0.1:8730');
  expect(normalizarServidor('ftp://x')).toBeNull();
  expect(normalizarServidor('https://u:s@x.com')).toBeNull();
  expect(normalizarServidor('não é url')).toBeNull();
});

test('cabeçalhos: X-Margem sempre; Bearer só com token', () => {
  expect(cabecalhosDeEscrita(CONFIG)).toEqual({ 'X-Margem': 'extensao' });
  expect(cabecalhosDeEscrita({ ...CONFIG, token: ' abc ' })).toEqual({ 'X-Margem': 'abc', Authorization: 'Bearer abc' });
});

test('importacaoDaCaptura segue o ImportacaoWebV1 (sem campos extras)', () => {
  expect(importacaoDaCaptura(CAPTURA, new Date('2026-10-01T12:00:00Z'))).toEqual({
    markdown: 'Texto.', titulo: 'Página (trecho)', site: 'exemplo.com', url_origem: 'https://exemplo.com/a',
    capturado_em: '2026-10-01T12:00:00.000Z', trecho: true,
  });
});

test('envio devolve o endereço do documento no leitor', async () => {
  const chamada = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ documento_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', job_id: 'x' }), { status: 202 })));
  vi.stubGlobal('fetch', chamada);
  expect(await enviarTexto(CONFIG, CAPTURA)).toEqual({
    documento_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', endereco: 'http://127.0.0.1:8753/documentos/01ARZ3NDEKTSV4RRFFQ69G5FAV',
  });
  expect(chamada).toHaveBeenCalledWith('http://127.0.0.1:8753/api/importacoes/web', expect.objectContaining({ method: 'POST', credentials: 'omit' }));
});

test('erros do servidor e da rede viram mensagens em português', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ erro: 'importacao_invalida', detalhe: '/url_origem inválido' }), { status: 422 }))));
  await expect(enviarTexto(CONFIG, CAPTURA)).rejects.toThrow('O servidor recusou a página capturada: /url_origem inválido');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
  await expect(testarConexao(CONFIG)).rejects.toThrow(/MARGEM_EXTENSOES/);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ erro: 'origem_recusada' }), { status: 403 }))));
  await expect(testarConexao(CONFIG)).rejects.toThrow(/não autorizou esta extensão.*MARGEM_EXTENSOES/);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('não encontrado', { status: 404 }))));
  await expect(testarConexao(CONFIG)).rejects.toThrow(/atualize o Margem/);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ servico: 'margem', importacao_web: 1, formatos: ['md', 'pdf'] })))));
  expect(await testarConexao(CONFIG)).toEqual({ versao: 1 });
});

test('sem permissão de host, falha de rede explica as duas causas', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
  const erro = await falha(testarConexao(CONFIG));
  expect(erro.message).toMatch(/^Não foi possível falar com http:\/\/127\.0\.0\.1:8753\./);
  expect(erro.message).toContain('`margem iniciar`');
  expect(erro.message).toContain('`docker compose up -d`');
  expect(erro.message).toContain('MARGEM_EXTENSOES');
});

test('com permissão de host, falha de rede é Margem fechado: só o comando de abrir', async () => {
  definirVerificadorDeAcesso((servidor) => Promise.resolve(servidor === CONFIG.servidor));
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
  const erro = await falha(testarConexao(CONFIG));
  expect(erro.message).toContain('Abra o Margem: rode `margem iniciar` (ou `docker compose up -d`');
  expect(erro.message).not.toContain('MARGEM_EXTENSOES');
});

test('verificador que falha conta como sem permissão', async () => {
  definirVerificadorDeAcesso(() => Promise.reject(new Error('sem API')));
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
  await expect(testarConexao(CONFIG)).rejects.toThrow(/MARGEM_EXTENSOES/);
});

test('host recusado aponta o endereço padrão', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ erro: 'host_recusado' }), { status: 403 }))));
  await expect(testarConexao(CONFIG)).rejects.toThrow(/http:\/\/localhost:8730/);
});

test('permissão de host: locais já estão no manifesto; outro host pede só ele, sem porta', () => {
  expect(padraoDeHost('http://localhost:8730')).toBe('http://localhost/*');
  expect(permissaoDeHost('http://localhost:8730')).toBeNull();
  expect(permissaoDeHost('http://127.0.0.1:9000')).toBeNull();
  expect(permissaoDeHost('https://margem.exemplo.ts.net')).toBe('https://margem.exemplo.ts.net/*');
  expect(permissaoDeHost('http://192.168.0.10:8730')).toBe('http://192.168.0.10/*');
  expect(permissaoDeHost('não é url')).toBeNull();
});
