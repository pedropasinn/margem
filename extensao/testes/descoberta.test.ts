/**
 * V-W9 (B-11): com a 8730 ocupada, o app de computador abre noutra porta da faixa 8730–8739 e a
 * extensão o acha pela rota de saúde, conferindo a identificação.
 */
import { expect, test, vi } from 'vitest';
import { escolherMargem, procuraAutomatica, procurarMargem, resolverServidor, textoDaConexao } from '../src/servidor';

/** Um `fetch` de mentira: cada porta responde o que o mapa diz; as outras recusam a conexão. */
function portas(mapa: Record<number, { status: number; corpo: unknown }>): typeof fetch {
  return vi.fn((entrada: string | URL | Request) => {
    const url = new URL(String(entrada));
    const resposta = mapa[Number(url.port)];
    if (resposta === undefined) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response(JSON.stringify(resposta.corpo), { status: resposta.status }));
  }) as unknown as typeof fetch;
}

const APP = { servico: 'margem', ok: true, instancia_id: 'a1b2-c3d4', app_de_computador: true };
const DOCKER = { servico: 'margem', ok: true, instancia_id: 'ffff-0000', app_de_computador: false };

test('só o endereço padrão local procura pelas portas', () => {
  expect(procuraAutomatica('http://localhost:8730')).toBe(true);
  expect(procuraAutomatica('http://127.0.0.1:8735')).toBe(true);
  expect(procuraAutomatica('http://localhost:9000')).toBe(false);
  expect(procuraAutomatica('https://margem.exemplo.ts.net')).toBe(false);
  expect(procuraAutomatica('http://localhost:8730/prefixo')).toBe(false);
});

test('8730 com outro programa: acha o app na 8731', async () => {
  const buscar = portas({ 8730: { status: 200, corpo: '<html>' }, 8731: { status: 200, corpo: APP } });
  const achados = await procurarMargem('http://localhost:8730', buscar);
  expect(achados).toEqual([{ servidor: 'http://localhost:8731', porta: 8731, instancia_id: 'a1b2-c3d4', app_de_computador: true }]);
  const resolvido = await resolverServidor({ servidor: 'http://localhost:8730', token: '' }, null, buscar);
  expect(resolvido.configuracao.servidor).toBe('http://localhost:8731');
  expect(textoDaConexao({ versao: 1, servidor: resolvido.encontrado!.servidor, instancia_id: 'a1b2-c3d4', outros: 0 }))
    .toBe('Conectado ao Margem (importação web v1) em localhost:8731, identificação a1b2-c3d4.');
});

test('dois Margens: fica com a identificação conhecida; sem ela, com o app de computador', async () => {
  const buscar = portas({ 8730: { status: 200, corpo: DOCKER }, 8732: { status: 503, corpo: { ...APP, ok: false } } });
  const achados = await procurarMargem('http://localhost:8730', buscar);
  expect(achados.map((a) => a.porta)).toEqual([8730, 8732]);
  expect(escolherMargem(achados, null)?.porta).toBe(8732);
  expect(escolherMargem(achados, 'ffff-0000')?.porta).toBe(8730);
  // S-06: a conhecida sumiu; não troca sozinho para a outra biblioteca.
  expect(escolherMargem(achados, 'outra')).toBeNull();
  const resolvido = await resolverServidor({ servidor: 'http://localhost:8730', token: 't' }, 'ffff-0000', buscar);
  expect(resolvido).toMatchObject({ configuracao: { servidor: 'http://localhost:8730', token: 't' }, outros: 1 });
});

test('S-06: a biblioteca conhecida fechada e outra aberta: o envio para antes de qualquer POST', async () => {
  const buscar = portas({ 8731: { status: 200, corpo: APP } });
  await expect(resolverServidor({ servidor: 'http://localhost:8730', token: 't' }, 'ffff-0000', buscar)).rejects.toMatchObject({ codigo: 'margem_conhecido_ausente' });
  // Só a sondagem de saúde saiu: nenhum POST.
  const chamadas = (buscar as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
  expect(chamadas.every(([url, init]) => String(url).endsWith('/api/saude') && (init?.method ?? 'GET') === 'GET')).toBe(true);
  // Escolha explícita (Testar conexão): sem a conhecida, fica com o que respondeu.
  expect((await resolverServidor({ servidor: 'http://localhost:8730', token: 't' }, null, buscar)).configuracao.servidor).toBe('http://localhost:8731');
});

test('S-06: resposta genérica ou sem identificação não conta como Margem', async () => {
  const buscar = portas({
    8730: { status: 200, corpo: { ok: true } },
    8731: { status: 200, corpo: { servico: 'margem', ok: true } },
    8732: { status: 200, corpo: { servico: 'outro', instancia_id: 'x' } },
  });
  expect(await procurarMargem('http://localhost:8730', buscar)).toEqual([]);
});

test('Margem que não autorizou a extensão também conta como achado (sem identificação)', async () => {
  const achados = await procurarMargem('http://localhost:8730', portas({ 8733: { status: 403, corpo: { erro: 'origem_recusada' } } }));
  expect(achados).toEqual([{ servidor: 'http://localhost:8733', porta: 8733, instancia_id: null, app_de_computador: false }]);
});

test('nenhum Margem respondendo: fica o endereço configurado (o erro de rede explica)', async () => {
  const resolvido = await resolverServidor({ servidor: 'http://localhost:8730', token: '' }, null, portas({}));
  expect(resolvido).toEqual({ configuracao: { servidor: 'http://localhost:8730', token: '' }, encontrado: null, outros: 0 });
  const manual = await resolverServidor({ servidor: 'https://margem.exemplo.ts.net', token: '' }, null, portas({ 8731: { status: 200, corpo: APP } }));
  expect(manual.configuracao.servidor).toBe('https://margem.exemplo.ts.net');
});
