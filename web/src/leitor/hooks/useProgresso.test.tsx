import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ProgressoV1 } from '@margem/contratos';
import {
  ATRASO_DO_PROGRESSO_MS, AVISO_DE_CONFLITO, chaveLocal, useProgresso,
  type FontesDoProgresso, type ProgressoGravado, type RespostaDoProgresso,
} from './useProgresso';
import { ancoraDoPonto } from '../ancora';
import { capituloExemplo } from '../fixtures/capitulo-exemplo';
import type { ApiDoLeitor, PontoDeTexto } from '../tipos';

const DOCUMENTO = '0'.repeat(22) + 'D001';
const BLOCO = capituloExemplo.blocos[2];

function caixa(topo: number): DOMRect {
  return { top: topo, bottom: topo + 20, height: 20, left: 0, right: 0, width: 0, x: 0, y: topo, toJSON: () => ({}) };
}

const localizar = vi.fn<(bloco: string, offset: number) => DOMRect | null>(() => caixa(400));
let ponto: PontoDeTexto = { bloco_id: BLOCO?.id ?? '', offset_utf16: 7 };

const leitor: { current: ApiDoLeitor | null } = {
  current: { localizar: (bloco, offset) => localizar(bloco, offset), ancoraVisivel: () => ponto },
};

function gravado(revisao: number, capitulos: string[] = []): ProgressoGravado {
  const ancora = ancoraDoPonto(capituloExemplo.blocos, capituloExemplo.versao_id, ponto);
  if (ancora === null) throw new Error('fixture sem âncora');
  return {
    documento_id: DOCUMENTO, versao_id: capituloExemplo.versao_id, ancora,
    capitulos_concluidos: capitulos, atualizado_em: '2026-09-20T12:00:00.000Z', revisao,
  };
}

function montar(fontes?: FontesDoProgresso) {
  return renderHook(() => useProgresso({
    documento_id: DOCUMENTO, snapshot: capituloExemplo, leitor, fontes,
    agora: () => '2026-09-20T12:00:00.000Z',
  }));
}

/** Empurra o relógio até o atraso de 2 s vencer e deixa as promessas assentarem. */
async function assentar(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ATRASO_DO_PROGRESSO_MS + 10);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  localizar.mockClear();
  ponto = { bloco_id: BLOCO?.id ?? '', offset_utf16: 7 };
  vi.stubGlobal('scrollBy', () => { /* jsdom não rola. */ });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('useProgresso', () => {
  test('salva com atraso de 2 s e guarda cópia local com carimbo', async () => {
    const gravar = vi.fn<(id: string, p: ProgressoV1) => Promise<RespostaDoProgresso>>(
      () => Promise.resolve({ estado: 'gravado', progresso: gravado(1) }),
    );
    const { result } = montar({ ler: () => Promise.resolve(null), gravar });

    act(() => { result.current.registrarLeitura(); });
    act(() => { vi.advanceTimersByTime(ATRASO_DO_PROGRESSO_MS - 100); });
    expect(gravar).not.toHaveBeenCalled();

    await assentar();
    expect(gravar).toHaveBeenCalledTimes(1);
    const enviado = gravar.mock.calls[0]?.[1];
    expect(enviado?.revisao_esperada).toBe(0);
    expect(enviado?.ancora.bloco_id).toBe(BLOCO?.id);
    expect(result.current.revisao).toBe(1);

    const copia = window.localStorage.getItem(chaveLocal(DOCUMENTO));
    expect(copia).not.toBeNull();
    expect(JSON.parse(copia ?? '{}')).toMatchObject({ carimbo: '2026-09-20T12:00:00.000Z' });
  });

  test('409 adota a revisão do servidor, avisa e não regrava por cima', async () => {
    const gravar = vi.fn<(id: string, p: ProgressoV1) => Promise<RespostaDoProgresso>>(
      () => Promise.resolve({ estado: 'obsoleto', progresso: gravado(9, [capituloExemplo.secao.id]) }),
    );
    const { result } = montar({ ler: () => Promise.resolve(null), gravar });

    act(() => { result.current.registrarLeitura(); });
    await assentar();

    expect(gravar).toHaveBeenCalledTimes(1);
    expect(result.current.revisao).toBe(9);
    expect(result.current.capitulos_concluidos).toEqual([capituloExemplo.secao.id]);
    expect(result.current.aviso).toBe(AVISO_DE_CONFLITO);

    // Nada de reenviar: quem salvou por último foi o outro aparelho.
    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve(); });
    expect(gravar).toHaveBeenCalledTimes(1);
  });

  test('resposta fora de ordem com revisão menor não faz o progresso retroceder', async () => {
    const pendentes: ((resposta: RespostaDoProgresso) => void)[] = [];
    const gravar = vi.fn<(id: string, p: ProgressoV1) => Promise<RespostaDoProgresso>>(
      () => new Promise<RespostaDoProgresso>((resolver) => pendentes.push(resolver)),
    );
    const { result } = montar({ ler: () => Promise.resolve(null), gravar });

    act(() => { result.current.registrarLeitura(); });
    await assentar();
    act(() => { result.current.registrarLeitura(); });
    await assentar();
    expect(gravar).toHaveBeenCalledTimes(2);

    // A segunda resposta chega primeiro; a primeira, atrasada, traz revisão menor.
    await act(async () => { pendentes[1]?.({ estado: 'gravado', progresso: gravado(4) }); await Promise.resolve(); });
    expect(result.current.revisao).toBe(4);
    await act(async () => { pendentes[0]?.({ estado: 'gravado', progresso: gravado(2) }); await Promise.resolve(); });
    expect(result.current.revisao).toBe(4);
  });

  test('reabre sem servidor pela cópia local e retoma pela âncora', async () => {
    const copia = gravado(3, [capituloExemplo.secao.id]);
    window.localStorage.setItem(chaveLocal(DOCUMENTO), JSON.stringify({ progresso: copia, carimbo: copia.atualizado_em }));

    const { result } = montar();
    await act(async () => { await Promise.resolve(); });

    expect(result.current.revisao).toBe(3);
    expect(result.current.concluido(capituloExemplo.secao.id)).toBe(true);
    expect(localizar).toHaveBeenCalledWith(copia.ancora.bloco_id, copia.ancora.inicio_utf16);
  });

  test('a do servidor vence quando tem revisão maior', async () => {
    const local = gravado(1);
    window.localStorage.setItem(chaveLocal(DOCUMENTO), JSON.stringify({ progresso: local, carimbo: local.atualizado_em }));
    const doServidor = gravado(5, [capituloExemplo.secao.id]);
    const { result } = montar({ ler: () => Promise.resolve(doServidor), gravar: () => Promise.resolve({ estado: 'erro' }) });

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.revisao).toBe(5);
    expect(result.current.capitulos_concluidos).toEqual([capituloExemplo.secao.id]);
  });

  test('mudar a largura preserva a âncora: ela é relocalizada depois do relayout', async () => {
    const copia = gravado(2);
    window.localStorage.setItem(chaveLocal(DOCUMENTO), JSON.stringify({ progresso: copia, carimbo: copia.atualizado_em }));
    montar();
    await act(async () => { await Promise.resolve(); });
    localizar.mockClear();

    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 412 });
      window.dispatchEvent(new Event('resize'));
    });
    expect(localizar).toHaveBeenCalledWith(copia.ancora.bloco_id, copia.ancora.inicio_utf16);
  });

  test('marcar capítulo como lido grava na hora, sem esperar o atraso', async () => {
    const gravar = vi.fn<(id: string, p: ProgressoV1) => Promise<RespostaDoProgresso>>(
      () => Promise.resolve({ estado: 'gravado', progresso: gravado(1, [capituloExemplo.secao.id]) }),
    );
    const { result } = montar({ ler: () => Promise.resolve(null), gravar });

    await act(async () => {
      result.current.marcarCapituloLido(capituloExemplo.secao.id);
      await Promise.resolve();
    });
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(gravar.mock.calls[0]?.[1].capitulos_concluidos).toEqual([capituloExemplo.secao.id]);
  });
});

test('retoma quando a geometria assíncrona do PDF fica disponível', () => {
  const salvo = gravado(2);
  localStorage.setItem(chaveLocal(DOCUMENTO), JSON.stringify({ progresso: salvo, carimbo: salvo.atualizado_em }));
  localizar.mockReturnValueOnce(null);
  const rolar = vi.fn(); vi.stubGlobal('scrollBy', rolar);
  montar();
  expect(rolar).not.toHaveBeenCalled();
  act(() => { window.dispatchEvent(new Event('margem:geometria')); });
  expect(rolar).toHaveBeenCalledTimes(1);
  act(() => { window.dispatchEvent(new Event('margem:geometria')); });
  expect(rolar).toHaveBeenCalledTimes(1);
});
