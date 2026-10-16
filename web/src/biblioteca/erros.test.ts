import { expect, test } from 'vitest';
import { ErroDaApi } from './api';
import { FALHA_DO_SERVICO, SEM_CONEXAO, mensagemDeErro } from './erros';

const PADRAO = 'Não foi possível carregar este texto.';

test('U-04: o código interno e o 500 sem detalhe viram uma frase em português', () => {
  expect(mensagemDeErro(new ErroDaApi(500, 'falha_interna'), PADRAO)).toBe(FALHA_DO_SERVICO);
  expect(mensagemDeErro(new ErroDaApi(502, 'Bad Gateway'), PADRAO)).toBe(FALHA_DO_SERVICO);
  expect(mensagemDeErro(new ErroDaApi(404, 'versao_inexistente'), PADRAO)).toMatch(/versão do texto não existe/);
  expect(mensagemDeErro(new ErroDaApi(418, 'codigo_desconhecido'), PADRAO)).toBe(PADRAO);
});

test('U-04: o detalhe em português do serviço é aproveitado; o técnico, não', () => {
  expect(mensagemDeErro(new ErroDaApi(422, 'importacao_recusada', 'O arquivo não é um PDF válido.'), PADRAO)).toBe('O arquivo não é um PDF válido.');
  expect(mensagemDeErro(new ErroDaApi(400, 'pedido_invalido', 'Unexpected token < in JSON'), PADRAO)).toBe(PADRAO);
  expect(mensagemDeErro(new ErroDaApi(500, 'falha_interna', 'O banco caiu.'), PADRAO)).toBe(FALHA_DO_SERVICO);
});

test('U-04: conexão recusada e falhas do navegador não aparecem em inglês', () => {
  expect(mensagemDeErro(new TypeError('Failed to fetch'), PADRAO)).toBe(SEM_CONEXAO);
  expect(mensagemDeErro(new TypeError('NetworkError when attempting to fetch resource.'), PADRAO)).toBe(SEM_CONEXAO);
  expect(mensagemDeErro(new TypeError("Cannot read properties of undefined (reading 'x')"), PADRAO)).toBe(PADRAO);
  expect(mensagemDeErro(new SyntaxError('Unexpected end of JSON input'), PADRAO)).toBe(PADRAO);
  expect(mensagemDeErro(new Error('falha_interna'), PADRAO)).toBe(PADRAO);
  expect(mensagemDeErro('qualquer coisa', PADRAO)).toBe(PADRAO);
});

test('as frases do próprio app continuam', () => {
  expect(mensagemDeErro(new Error('Este documento ainda não tem texto.'), PADRAO)).toBe('Este documento ainda não tem texto.');
  expect(mensagemDeErro(new Error('A página 12 não está em nenhum capítulo.'), PADRAO)).toBe('A página 12 não está em nenhum capítulo.');
});
