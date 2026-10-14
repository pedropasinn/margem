/**
 * Encerramento de subprocessos e parada do serviço nos três sistemas (J114). Windows e macOS são
 * simulados (o `taskkill` e o `kill` são trocados); o grupo de processos do Linux é provado de verdade.
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  MENSAGEM_DE_PARADA, aoPedirParada, argumentosDoTaskkill, caminhoDoTaskkill, ehPontoDeEntrada, encerrarArvore, opcoesDeProcesso,
} from './processos.js';

function filhoFalso(pid: number | undefined = 4242) {
  const sinais: string[] = [];
  return {
    sinais,
    filho: { pid, exitCode: null, signalCode: null, kill: (sinal?: NodeJS.Signals | number) => { sinais.push(String(sinal)); return true; } },
  };
}

test('opções de spawn: sem shell, sem janela; grupo próprio só fora do Windows', () => {
  expect(opcoesDeProcesso('linux', true)).toEqual({ shell: false, windowsHide: true, detached: true });
  expect(opcoesDeProcesso('darwin', true)).toEqual({ shell: false, windowsHide: true, detached: true });
  expect(opcoesDeProcesso('win32', true)).toEqual({ shell: false, windowsHide: true });
  expect(opcoesDeProcesso('linux')).toEqual({ shell: false, windowsHide: true });
});

test('Windows: taskkill /T do System32 (nunca do PATH), /F só no forçado', async () => {
  expect(caminhoDoTaskkill({ SystemRoot: 'D:\\Win' })).toBe(join('D:\\Win', 'System32', 'taskkill.exe'));
  expect(argumentosDoTaskkill(7, 'forcado')).toEqual(['/PID', '7', '/T', '/F']);
  expect(argumentosDoTaskkill(7, 'suave')).toEqual(['/PID', '7', '/T']);
  const chamadas: string[][] = [];
  const { filho, sinais } = filhoFalso();
  await encerrarArvore(filho, 'forcado', {
    plataforma: 'win32', ambiente: { SystemRoot: 'C:\\Windows' },
    rodarTaskkill: (programa, argumentos) => { chamadas.push([programa, ...argumentos]); return Promise.resolve(true); },
  });
  expect(chamadas).toEqual([[join('C:\\Windows', 'System32', 'taskkill.exe'), '/PID', '4242', '/T', '/F']]);
  expect(sinais).toEqual([]);
  // Suave: o console escondido não recebe WM_CLOSE; depois do pedido, o Node termina o processo.
  await encerrarArvore(filho, 'suave', { plataforma: 'win32', rodarTaskkill: () => Promise.resolve(true) });
  expect(sinais).toEqual(['SIGTERM']);
  // taskkill falhou: cai no kill do Node.
  const outro = filhoFalso();
  await encerrarArvore(outro.filho, 'forcado', { plataforma: 'win32', rodarTaskkill: () => Promise.reject(new Error('sem taskkill')) });
  expect(outro.sinais).toEqual(['SIGKILL']);
});

test('Linux/macOS: sinal ao grupo; sem grupo, ao filho; processo já encerrado é ignorado', async () => {
  const mortos: [number, string][] = [];
  const { filho, sinais } = filhoFalso();
  await encerrarArvore(filho, 'forcado', { plataforma: 'darwin', grupo: true, matar: (pid, sinal) => { mortos.push([pid, sinal]); } });
  expect(mortos).toEqual([[-4242, 'SIGKILL']]);
  expect(sinais).toEqual([]);
  await encerrarArvore(filho, 'suave', { plataforma: 'linux', grupo: true, matar: () => { throw new Error('ESRCH'); } });
  expect(sinais).toEqual(['SIGTERM']);
  await encerrarArvore(filho, 'suave', { plataforma: 'linux' });
  expect(sinais).toEqual(['SIGTERM', 'SIGTERM']);
  const terminado = filhoFalso();
  await encerrarArvore({ ...terminado.filho, exitCode: 0 }, 'forcado', { plataforma: 'linux' });
  await encerrarArvore({ ...filhoFalso().filho, pid: undefined }, 'forcado', { plataforma: 'win32', rodarTaskkill: () => { throw new Error('não devia'); } });
  expect(terminado.sinais).toEqual([]);
});

test.skipIf(process.platform === 'win32')('Linux de verdade: o encerramento leva o neto junto', async () => {
  // O filho (sh) abre um neto (sleep) e imprime o pid dele; o grupo inteiro morre.
  const filho = spawn('sh', ['-c', 'sleep 30 & echo $!; wait'], { stdio: ['ignore', 'pipe', 'ignore'], ...opcoesDeProcesso(process.platform, true) });
  const neto = await new Promise<number>((resolver) => { filho.stdout.once('data', (dado: Buffer) => { resolver(Number(dado.toString().trim())); }); });
  const fim = new Promise<void>((resolver) => { filho.once('close', () => { resolver(); }); });
  await encerrarArvore(filho, 'forcado', { grupo: true });
  await fim;
  await new Promise((resolver) => setTimeout(resolver, 50));
  expect(() => process.kill(neto, 0)).toThrow();
});

test('ponto de entrada reconhece o caminho do Windows', () => {
  expect(ehPontoDeEntrada(['src/api.ts'], 'C:\\Program Files\\Margem\\resources\\app\\servico\\src\\api.ts')).toBe(true);
  expect(ehPontoDeEntrada(['src/api.ts', 'src/api.js'], '/app/servico/src/api.js')).toBe(true);
  expect(ehPontoDeEntrada(['src/api.ts'], '/app/servico/src/worker/main.ts')).toBe(false);
  expect(ehPontoDeEntrada(['src/api.ts'], undefined)).toBe(false);
});

test('parada pedida por sinal (Linux/macOS), SIGBREAK (Windows) ou mensagem IPC do app', () => {
  const montar = (plataforma: NodeJS.Platform, comIpc: boolean) => {
    const emissor = new EventEmitter() as EventEmitter & { platform: NodeJS.Platform; send?: () => boolean };
    emissor.platform = plataforma;
    if (comIpc) emissor.send = () => true;
    const origens: string[] = [];
    aoPedirParada((origem) => { origens.push(origem); }, emissor as unknown as NodeJS.Process);
    return { emissor, origens };
  };
  const linux = montar('linux', false);
  linux.emissor.emit('SIGTERM');
  linux.emissor.emit('message', MENSAGEM_DE_PARADA);
  expect(linux.origens).toEqual(['SIGTERM']);
  const windows = montar('win32', true);
  windows.emissor.emit('SIGBREAK');
  windows.emissor.emit('message', { tipo: MENSAGEM_DE_PARADA });
  windows.emissor.emit('message', { tipo: 'outra' });
  windows.emissor.emit('message', MENSAGEM_DE_PARADA);
  expect(windows.origens).toEqual(['SIGBREAK', 'ipc', 'ipc']);
});
