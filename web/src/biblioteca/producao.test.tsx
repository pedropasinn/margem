// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { capituloExemplo } from '../leitor/fixtures/capitulo-exemplo';
import { ProducaoDoDocumento, type FontesDaProducao } from './ProducaoDoDocumento';
import { consumirIntencao, gravarIntencao } from './intencao';
import type { DetalheDoDocumento, SnapshotDoCapitulo } from './tipos';

afterEach(() => { cleanup(); sessionStorage.clear(); });

test('a intenção de leitura vale uma vez, para o documento e o capítulo dela', () => {
  gravarIntencao({ documento_id: 'D', secao_id: 'S', pagina: 17 });
  expect(consumirIntencao('D', 'outro')).toBeNull();
  expect(consumirIntencao('D', 'S')).toMatchObject({ pagina: 17 });
  expect(consumirIntencao('D', 'S')).toBeNull();
});

test('a página do documento junta o que o Margem produziu nos capítulos e leva cada item ao ponto certo', async () => {
  const snapshot = capituloExemplo as unknown as SnapshotDoCapitulo;
  const fontes: FontesDaProducao = {
    capitulo: vi.fn(() => Promise.resolve(snapshot)),
    relacoes: vi.fn(() => Promise.resolve({ relacoes: [] })),
    visuais: vi.fn(() => Promise.resolve({ visuais: [] })),
    resolucoes: vi.fn(() => Promise.resolve({ resolucoes: [] })),
    modos: vi.fn(() => Promise.resolve({ modos: [] })),
  };
  const ir = vi.fn();
  const documento = { id: 'D', versao_id: snapshot.versao_id } as unknown as DetalheDoDocumento;
  render(<ProducaoDoDocumento documento={documento} capitulos={[{ id: snapshot.secao.id, titulo: 'Um' }, { id: 'dois', titulo: 'Dois' }]} concluidos={new Set()} camadas={[]} ir={ir} fontes={fontes} />);
  const resumo = await screen.findByRole('region', { name: 'O que o Margem produziu' });
  const grifos = capituloExemplo.marcas.filter((m) => m.visivel && m.validade === 'resolvida' && m.avaliacao !== 'rejeitada' && m.funcao !== 'nenhuma').length * 2;
  await waitFor(() => expect(within(resumo).getByText('Grifos').nextElementSibling?.textContent).toBe(String(grifos)));
  expect(fontes.capitulo).toHaveBeenCalledTimes(2);
  // O resumo só lista o que existe; os capítulos vêm antes dos grifos.
  expect(within(resumo).queryByText('Fluxogramas')).toBeNull();
  const regioes = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
  expect(regioes.indexOf('Capítulos')).toBeLessThan(regioes.indexOf('Grifos'));
  // Só leitura: nenhuma escrita; tocar num grifo guarda a intenção e abre o leitor no capítulo dele.
  const secao = screen.getByRole('region', { name: 'Grifos' });
  fireEvent.click(within(secao).getAllByRole('button').find((b) => b.classList.contains('item-producao'))!);
  expect(ir).toHaveBeenCalledWith({ nome: 'leitura', documento_id: 'D', secao_id: snapshot.secao.id });
  expect(consumirIntencao('D', snapshot.secao.id)?.ancora).toBeDefined();
});
