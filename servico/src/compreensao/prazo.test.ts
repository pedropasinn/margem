import { expect, test } from 'vitest';
import type { PedidoExecucao, ResultadoExecutor } from '../executor/tipos.js';
import { falhou } from '../executor/tipos.js';
import { executarComNovaTentativa, PRAZO_MINIMO_MS, PRAZO_TETO_PADRAO_MS, prazoDaChamada } from './pipeline.js';

const pedido: PedidoExecucao = { diretorioEntrada: '/tmp/x', prompt: 'p', schema: '/tmp/s.json', prazoMs: 1_000 };
const ok: ResultadoExecutor = { estado: 'ok', artefato: '/tmp/a.json', sha256: 'a'.repeat(64), duracao_ms: 5, modelo: 'falso' };

function roteiro(...resultados: ResultadoExecutor[]) {
  const chamadas: PedidoExecucao[] = [];
  const executor = (recebido: PedidoExecucao): Promise<ResultadoExecutor> => {
    chamadas.push(recebido);
    return Promise.resolve(resultados[chamadas.length - 1] ?? ok);
  };
  return { executor, chamadas };
}

test('prazo proporcional: 10 min para prompts pequenos, +10 min a cada ~30 mil tokens, nunca acima do teto', () => {
  expect(prazoDaChamada(24_000)).toBe(PRAZO_MINIMO_MS);
  expect(prazoDaChamada(89_000)).toBe(PRAZO_MINIMO_MS);
  expect(prazoDaChamada(90_000)).toBe(2 * PRAZO_MINIMO_MS);
  expect(prazoDaChamada(200_000)).toBe(PRAZO_TETO_PADRAO_MS);
  expect(prazoDaChamada(10_000_000)).toBe(PRAZO_TETO_PADRAO_MS);
  // Um teto configurado menor (testes, ambiente) sempre vence.
  expect(prazoDaChamada(24_000, 5_000)).toBe(5_000);
});

test('timeout ganha uma nova tentativa; a segunda resposta vale', async () => {
  const { executor, chamadas } = roteiro(falhou('timeout', 'prazo', 1_000), ok);
  expect(await executarComNovaTentativa(executor, pedido, 1)).toEqual(ok);
  expect(chamadas).toHaveLength(2);
});

test('só uma nova tentativa: dois timeouts seguidos devolvem o timeout', async () => {
  const { executor, chamadas } = roteiro(falhou('timeout', 'prazo', 1_000), falhou('timeout', 'prazo', 1_000), ok);
  expect(await executarComNovaTentativa(executor, pedido, 1)).toMatchObject({ estado: 'falhou', codigo: 'timeout' });
  expect(chamadas).toHaveLength(2);
});

test('sem novas tentativas (análise, plano), outras falhas e cancelamento não repetem', async () => {
  const semRepetir = roteiro(falhou('timeout', 'prazo', 1_000), ok);
  expect(await executarComNovaTentativa(semRepetir.executor, pedido, 0)).toMatchObject({ codigo: 'timeout' });
  expect(semRepetir.chamadas).toHaveLength(1);
  const schema = roteiro(falhou('schema', 'fora do schema', 10), ok);
  expect(await executarComNovaTentativa(schema.executor, pedido, 1)).toMatchObject({ codigo: 'schema' });
  expect(schema.chamadas).toHaveLength(1);
  const controlador = new AbortController();
  controlador.abort();
  const cancelado = roteiro(falhou('timeout', 'prazo', 1_000), ok);
  expect(await executarComNovaTentativa(cancelado.executor, { ...pedido, sinal: controlador.signal }, 1)).toMatchObject({ codigo: 'timeout' });
  expect(cancelado.chamadas).toHaveLength(1);
});
