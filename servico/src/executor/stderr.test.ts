/**
 * Resumo, redação e classificação do stderr do Codex (V-W2, auditoria B-03 e B-07). O caso
 * `login-quebrado.txt` é o stderr real do codex 0.160.0 desta máquina em 14/10/2026 (só o
 * diretório e o prompt trocados): avisos com 401 e cf-ray, e o desfecho na última linha `ERROR:`.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { classificarSaida, horarioDeVolta, trechoDecisivo } from './classificacao.js';
import { TETO_DO_RESUMO, causaDoStderr, linhasFatais, redigir, resumirStderr } from './stderr.js';

const LOGIN_QUEBRADO = readFileSync(new URL('./casos-stderr/login-quebrado.txt', import.meta.url), 'utf8');

/** Um stderr do jeito que a CLI escreve: cabeçalho, registros internos com hora, o desfecho no fim. */
function stderrCom(desfecho: string, ruido = ''): string {
  return [
    'OpenAI Codex v0.162.1', '--------', 'workdir: C:\\Users\\usuario\\AppData\\Local\\Temp\\margem-job-x', 'model: gpt-6.1-sol', '--------',
    '2026-10-14T12:33:00.100000Z ERROR codex_models_manager::manager: failed to refresh available models: unexpected status 401 Unauthorized: {"detail":"Unauthorized"}, cf-ray: a4a6d9cf187d429a-GIG, request id: req_4291',
    ruido,
    desfecho,
  ].join('\n');
}

test('linhas fatais: só `ERROR:` no começo da linha, sem os registros com hora nem as reconexões', () => {
  expect(linhasFatais(LOGIN_QUEBRADO)).toEqual(['plan type is required for chatgpt authentication', 'plan type is required for chatgpt authentication']);
  expect(linhasFatais('ERROR: Reconnecting... 2/5\nError: boom\nwarning: x')).toEqual(['boom']);
});

test('classificação por contexto: 401 e 429 soltos não decidem', () => {
  // O caso real: avisos com 401, desfecho de login.
  expect(classificarSaida(LOGIN_QUEBRADO, 1)).toBe('auth');
  // Aviso de modelos com 401 e falha por outro motivo: não é "sem sessão".
  expect(classificarSaida(stderrCom('ERROR: unexpected status 400 Bad Request: invalid_json_schema'), 1)).toBe('desconhecido');
  // `429` dentro de um cf-ray, de um id de requisição ou de um número qualquer: não é cota.
  expect(classificarSaida(stderrCom('ERROR: stream error: request id req_429abc, cf-ray 8f429e3b-GRU, 1429 tokens'), 1)).toBe('desconhecido');
  expect(classificarSaida('ERROR: wrote 401 bytes', 1)).toBe('desconhecido');
  // Os desfechos de verdade.
  expect(classificarSaida(stderrCom("ERROR: You've hit your usage limit. Try again at 7:27 AM."), 1)).toBe('cota');
  expect(classificarSaida(stderrCom('ERROR: unexpected status 429 Too Many Requests: rate_limit_exceeded'), 1)).toBe('cota');
  expect(classificarSaida(stderrCom('ERROR: usage_limit_reached'), 1)).toBe('cota');
  expect(classificarSaida(stderrCom('ERROR: unexpected status 401 Unauthorized: token expired'), 1)).toBe('auth');
  expect(classificarSaida(stderrCom('ERROR: Not logged in. Run `codex login`.'), 1)).toBe('auth');
  // Sem linha `ERROR:` (CLIs antigas), decide a última linha.
  expect(classificarSaida('Error: not logged in; run codex login', 1)).toBe('auth');
  expect(classificarSaida('You have hit your usage limit.', 1)).toBe('cota');
  expect(classificarSaida('boom', null)).toBe('processo');
});

test('horário de volta vem do desfecho, não da hora dos registros internos', () => {
  const agora = new Date('2026-10-14T12:00:00Z');
  const stderr = stderrCom('ERROR: You have hit your usage limit. Try again in 30 minutes.');
  expect(trechoDecisivo(stderr)).toBe('You have hit your usage limit. Try again in 30 minutes.');
  // Com o stderr inteiro, o carimbo "2026-10-14T12:33:00Z" do aviso viraria o horário de volta.
  expect(horarioDeVolta(trechoDecisivo(stderr), agora).toISOString()).toBe('2026-10-14T12:30:00.000Z');
});

test('causa legível por tabela; desconhecida fica nula', () => {
  expect(causaDoStderr(stderrCom("ERROR: unexpected status 400 Bad Request: {\"error\":{\"code\":\"invalid_json_schema\",\"message\":\"Invalid schema for response_format 'codex_output_schema'\"}}")))
    .toBe('O Codex recusou o formato de resposta pedido pelo Margem. É um defeito do Margem; avise o suporte.');
  expect(causaDoStderr(stderrCom("ERROR: The 'gpt-9' model is not supported when using Codex with a ChatGPT account."))).toBe('Sua conta do ChatGPT não oferece o modelo pedido.');
  expect(causaDoStderr(stderrCom('ERROR: windows sandbox: CreateRestrictedToken failed: 5'))).toBe('O isolamento do Codex não iniciou neste computador.');
  expect(causaDoStderr(stderrCom('ERROR: stream disconnected before completion: error sending request'))).toMatch(/^O Codex não conseguiu falar com o servidor/);
  expect(causaDoStderr(stderrCom('ERROR: context_length_exceeded'))).toBe('O texto enviado ao Codex passou do tamanho que o modelo aceita.');
  expect(causaDoStderr(stderrCom('ERROR: algo novo'))).toBeNull();
  // Palavra da tabela fora do desfecho (num aviso) não conta.
  expect(causaDoStderr('warning: sandbox is read-only\nERROR: algo novo')).toBeNull();
  expect(causaDoStderr('')).toBeNull();
});

test('redação: tokens, cookies, e-mail e a casa do usuário', () => {
  const sujo = [
    'Authorization: Bearer abc.def-ghi',
    'set-cookie: __cf_bm=segredo; path=/; HttpOnly',
    'cookie: oai-did=outro-segredo',
    'key sk-proj-ABCDEFGHIJKLMNOP',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJh',
    '{"access_token":"aaa","refresh_token": "bbb","id_token":"ccc"}',
    'https://auth.openai.com/callback?code=xyz&state=1',
    'conta ana.souza@exemplo.com.br',
    'arquivo /home/usuario/.codex/auth.json',
  ].join('\n');
  const limpo = `${redigir(sujo, '/home/usuario')}\n${redigir('casa C:\\Users\\usuario\\.codex e C:/Users/usuario/.codex', 'C:\\Users\\usuario')}`;
  for (const segredo of ['abc.def-ghi', '__cf_bm', 'outro-segredo', 'ABCDEFGHIJKLMNOP', 'eyJhbGci', '"aaa"', '"bbb"', '"ccc"', 'code=xyz', 'ana.souza', '/home/usuario', 'Users\\usuario']) {
    expect(limpo).not.toContain(segredo);
  }
  expect(limpo).toContain('~/.codex/auth.json');
  expect(limpo).toContain('casa ~\\.codex e ~/.codex');
  expect(limpo).toContain('[e-mail]');
});

test('resumo: linhas de erro e aviso, depois as vinte finais; redigido e com teto de 4 KB', () => {
  const resumo = resumirStderr(LOGIN_QUEBRADO, '/home/usuario');
  expect(resumo.split('\n').at(-1)).toBe('ERROR: plan type is required for chatgpt authentication');
  expect(resumo).toContain('401 Unauthorized');
  expect(resumo.length).toBeLessThanOrEqual(TETO_DO_RESUMO);

  const longo = [
    'Authorization: Bearer segredo-do-inicio',
    ...Array.from({ length: 500 }, (_, i) => `linha comum ${String(i)} ${'x'.repeat(40)}`),
    'ERROR: o desfecho',
  ].join('\n');
  const cortado = resumirStderr(longo, '/home/usuario');
  expect(cortado.length).toBeLessThanOrEqual(TETO_DO_RESUMO);
  expect(cortado.endsWith('ERROR: o desfecho')).toBe(true);
  expect(cortado).not.toContain('segredo-do-inicio');
  // Do meio só ficam as linhas relevantes: as comuns antigas saem.
  expect(cortado).not.toContain('linha comum 10 ');
  expect(resumirStderr('', '/home/usuario')).toBe('');
});
