import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useSessaoDeMidia } from './useSessaoDeMidia';
import { sessaoFalsa, MetadadosFalsos } from './sessao-falsa';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const opcoes = { titulo: 'Livro', capitulo: 'Capítulo', tocando: false, tempo: 0, duracao: 0, velocidade: 1,
  tocar: () => undefined, pausar: () => undefined, buscar: () => undefined, instante: () => 0, anterior: () => undefined, proximo: () => undefined };

test('ausência da API e ações não suportadas não quebram a leitura', () => {
  vi.stubGlobal('navigator', {});
  const semApi = renderHook(() => useSessaoDeMidia(opcoes));
  semApi.unmount();
  const sessao = sessaoFalsa();
  const original = sessao.setActionHandler;
  sessao.setActionHandler = (acao, executar) => { if (acao === 'seekto') throw new Error('Não suportado'); original(acao, executar); };
  vi.stubGlobal('navigator', { mediaSession: sessao });
  vi.stubGlobal('MediaMetadata', MetadadosFalsos);
  const { rerender, unmount } = renderHook((ativa: boolean) => useSessaoDeMidia({ ...opcoes, ativa }), { initialProps: true });
  expect(sessao.acoes.get('play')).toBeTypeOf('function');
  expect(sessao.posicao).toBeUndefined();
  rerender(false);
  expect(sessao.metadata).toBeNull();
  unmount();
});
