import { createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { avisoDaPorta, escolherPorta, FAIXA_DA_EXTENSAO, motivoDaPortaOcupada, portaDoSistema, portaLivre, PORTA_DA_EXTENSAO, situacaoDaPorta } from '../src/nucleo/porta.js';

describe('escolha de porta', () => {
  it('tenta a da extensão primeiro', async () => {
    const testadas: number[] = [];
    const porta = await escolherPorta({ preferidas: [PORTA_DA_EXTENSAO, 9000], testar: (p) => { testadas.push(p); return Promise.resolve(true); } });
    expect(porta).toBe(8730);
    expect(testadas).toEqual([8730]);
  });

  it('ocupada a 8730, vale a última usada; ocupadas as duas, uma do sistema', async () => {
    const livres = new Set([9001]);
    expect(await escolherPorta({ preferidas: [8730, 9001], testar: (p) => Promise.resolve(livres.has(p)) })).toBe(9001);
    expect(await escolherPorta({ preferidas: [8730, null, undefined, 70_000], testar: () => Promise.resolve(false), sortear: () => Promise.resolve(41234) })).toBe(41234);
  });

  it('nunca devolve uma porta da lista de evitar', async () => {
    const sorteios = [5555, 6666];
    const porta = await escolherPorta({ preferidas: [5555], evitar: [5555], testar: () => Promise.resolve(true), sortear: () => Promise.resolve(sorteios.shift() ?? 0) });
    expect(porta).toBe(6666);
  });

  it('enxerga uma porta ocupada de verdade em 127.0.0.1', async () => {
    const servidor = createServer();
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    const endereco = servidor.address();
    const ocupada = typeof endereco === 'object' && endereco !== null ? endereco.port : 0;
    try {
      expect(await portaLivre(ocupada)).toBe(false);
      const outra = await escolherPorta({ preferidas: [ocupada] });
      expect(outra).not.toBe(ocupada);
      expect(await portaLivre(outra)).toBe(true);
    } finally {
      await new Promise<void>((r) => servidor.close(() => { r(); }));
    }
    expect(await portaDoSistema()).toBeGreaterThan(0);
  });
});

describe('8730 ocupada (V-W9)', () => {
  it('a faixa da extensão vem antes da última porta usada', async () => {
    const livres = new Set([8732, 9001]);
    expect(FAIXA_DA_EXTENSAO).toEqual([8730, 8731, 8732, 8733, 8734, 8735, 8736, 8737, 8738, 8739]);
    expect(await escolherPorta({ preferidas: [...FAIXA_DA_EXTENSAO, 9001], testar: (p) => Promise.resolve(livres.has(p)) })).toBe(8732);
  });

  it('diz por que a 8730 não serviu: outro Margem, outro programa ou porta reservada', async () => {
    const ocupada = () => Promise.resolve('ocupada' as const);
    const margem = (() => Promise.resolve(new Response(JSON.stringify({ ok: true, servico: 'margem', instancia_id: 'ffff-0000' })))) as unknown as typeof fetch;
    expect(await motivoDaPortaOcupada(8730, { situacao: ocupada, buscar: margem })).toEqual({ motivo: 'outro_margem', instancia_id: 'ffff-0000' });
    const html = (() => Promise.resolve(new Response('<html>'))) as unknown as typeof fetch;
    expect(await motivoDaPortaOcupada(8730, { situacao: ocupada, buscar: html })).toEqual({ motivo: 'outro_programa' });
    expect(await motivoDaPortaOcupada(8730, { situacao: () => Promise.resolve('reservada' as const) })).toEqual({ motivo: 'reservada' });
  });

  it('o aviso explica se a extensão acha este Margem', () => {
    expect(avisoDaPorta(8730, { motivo: 'outro_programa' })).toBeNull();
    expect(avisoDaPorta(8731, { motivo: 'outro_margem', instancia_id: 'ffff-0000' })).toMatch(/outro Margem responde nela \(identificação ffff-0000\).*porta 8731.*o encontra\. Nas opções da extensão/);
    expect(avisoDaPorta(59380, { motivo: 'reservada' })).toMatch(/Hyper-V.*porta 59380, e a extensão do navegador não vai encontrá-lo/);
  });

  it('enxerga a 8730 ocupada de verdade por um servidor que não é o Margem', async () => {
    const conexoes = new Set<Socket>();
    const servidor = createServer((socket) => { conexoes.add(socket); socket.end('não é http\n'); });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    const endereco = servidor.address();
    const porta = typeof endereco === 'object' && endereco !== null ? endereco.port : 0;
    try {
      expect(await situacaoDaPorta(porta)).toBe('ocupada');
      expect(await motivoDaPortaOcupada(porta)).toEqual({ motivo: 'outro_programa' });
    } finally {
      for (const socket of conexoes) socket.destroy();
      await new Promise<void>((r) => servidor.close(() => { r(); }));
    }
  });
});
