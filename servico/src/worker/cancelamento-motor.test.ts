import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PRAZO_ENCERRAMENTO_MOTOR_MS, rodarMotor } from './canonizar.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
function processoDeTeste() {
  return Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn(() => true) });
}
let processo: ReturnType<typeof processoDeTeste>;
beforeEach(() => {
  vi.useFakeTimers();
  processo = processoDeTeste();
  vi.mocked(spawn).mockReturnValue(processo as unknown as ChildProcessWithoutNullStreams);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); });
const rodar = (sinal: AbortSignal) => rodarMotor('/motor-de-teste', '/entrada.md', 'md', '/saida', { sinal });

test('sinal previamente cancelado não inicia subprocesso', async () => {
  const controlador = new AbortController(); controlador.abort();
  expect(await rodar(controlador.signal)).toMatchObject({ estado: 'falhou', cancelado: true });
  expect(spawn).not.toHaveBeenCalled();
});

test('cancelamento entre spawn e instalação do listener é observado', async () => {
  const controlador = new AbortController();
  vi.mocked(spawn).mockImplementation(() => {
    controlador.abort();
    return processo as unknown as ChildProcessWithoutNullStreams;
  });
  const resultado = rodar(controlador.signal);
  expect(processo.kill).toHaveBeenCalledWith('SIGTERM');
  processo.emit('close', 0);
  expect(await resultado).toMatchObject({ estado: 'falhou', cancelado: true });
  expect(vi.getTimerCount()).toBe(0);
});

test('cancelamento durante execução prevalece sobre saída zero e limpa recursos', async () => {
  const controlador = new AbortController();
  const resultado = rodar(controlador.signal);
  controlador.abort();
  expect(processo.kill).toHaveBeenCalledWith('SIGTERM');
  processo.emit('close', 0);
  expect(await resultado).toMatchObject({ estado: 'falhou', cancelado: true });
  expect(vi.getTimerCount()).toBe(0);
});

test('subprocesso que ignora SIGTERM recebe SIGKILL após prazo de encerramento', async () => {
  const controlador = new AbortController();
  const resultado = rodar(controlador.signal);
  controlador.abort();
  await vi.advanceTimersByTimeAsync(PRAZO_ENCERRAMENTO_MOTOR_MS);
  expect(processo.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  processo.emit('close', null);
  expect(await resultado).toMatchObject({ estado: 'falhou', cancelado: true });
  expect(vi.getTimerCount()).toBe(0);
});

test('conclusão normal remove o listener de cancelamento', async () => {
  const controlador = new AbortController();
  const resultado = rodar(controlador.signal);
  processo.emit('close', 0);
  expect(await resultado).toMatchObject({ estado: 'ok' });
  controlador.abort();
  expect(processo.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
