import { escolherOpcao } from '../../tests/apoio-react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Id, MarcaV1 } from '@margem/contratos';
import { ContextoDeAparencia } from './ContextoDeAparencia';
import { ReaderController } from './ReaderController';
import { ATRASO_DO_CORREDOR_MS } from './useControlador';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import { FILTRO_PADRAO, marcasFiltradas } from './notas';

const DOCUMENTO = '0'.repeat(22) + 'D001';
const M01 = '0'.repeat(23) + 'M01';

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  window.localStorage.clear();
  vi.stubGlobal('scrollBy', () => { /* jsdom não tem rolagem; a retomada é exercida no Playwright. */ });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function trechoDe(container: HTMLElement, marcaId: Id): HTMLElement {
  const span = [...container.querySelectorAll<HTMLElement>('span[data-marcas]')]
    .find((candidato) => (candidato.dataset['marcas'] ?? '').split(' ').includes(marcaId));
  if (span === undefined) throw new Error(`Trecho ausente para ${marcaId}.`);
  return span;
}

function nota(container: HTMLElement, marcaId: Id): HTMLElement {
  const elemento = container.querySelector<HTMLElement>(`[data-nota="${marcaId}"]`);
  if (elemento === null) throw new Error(`Nota ausente para ${marcaId}.`);
  return elemento;
}

describe('ReaderController: trecho e nota com o mesmo estado', () => {
  test('o corredor entre o trecho e a nota não fecha a nota', () => {
    vi.useFakeTimers();
    const { container } = render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} />);
    const trecho = trechoDe(container, M01);

    fireEvent.pointerOver(trecho);
    expect(nota(container, M01).classList.contains('ativa')).toBe(true);

    // Sai do trecho e entra na nota antes de o atraso vencer: a nota continua ativa.
    fireEvent.pointerOut(trecho);
    act(() => { vi.advanceTimersByTime(ATRASO_DO_CORREDOR_MS - 50); });
    fireEvent.pointerOver(nota(container, M01));
    act(() => { vi.advanceTimersByTime(ATRASO_DO_CORREDOR_MS + 50); });
    expect(nota(container, M01).classList.contains('ativa')).toBe(true);

    // Sair da nota sem voltar fecha, depois do atraso.
    fireEvent.pointerOut(nota(container, M01));
    act(() => { vi.advanceTimersByTime(ATRASO_DO_CORREDOR_MS - 50); });
    expect(nota(container, M01).classList.contains('ativa')).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(nota(container, M01).classList.contains('ativa')).toBe(false);
  });

  test('a ativação muda o sublinhado do trecho, nunca o fundo nem o peso', () => {
    const { container } = render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} />);
    const trecho = trechoDe(container, M01);
    expect(trecho.classList.contains('ativa')).toBe(false);
    fireEvent.pointerOver(trecho);
    expect(trechoDe(container, M01).classList.contains('ativa')).toBe(true);
    expect(trechoDe(container, M01).style.backgroundColor).toBe('');
    expect(trechoDe(container, M01).style.fontWeight).toBe('');
  });

  test('Tab percorre um trecho por marca e Enter fixa', () => {
    const { container } = render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} />);
    const focaveis = container.querySelectorAll('span[data-marcas][tabindex="0"]');
    expect(focaveis).toHaveLength(marcasFiltradas(capituloExemplo.marcas, FILTRO_PADRAO).length);

    const trecho = trechoDe(container, M01);
    act(() => { trecho.focus(); });
    expect(nota(container, M01).classList.contains('ativa')).toBe(true);
    // Sem fixar, ainda não há ações na nota.
    expect(within(nota(container, M01)).queryByRole('button', { name: 'Confirmar' })).toBeNull();

    fireEvent.keyDown(trecho, { key: 'Enter' });
    expect(within(nota(container, M01)).getByRole('button', { name: 'Confirmar' })).toBeDefined();
  });

  test('Escape fecha a nota e devolve o foco ao trecho acionador', () => {
    const { container } = render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} />);
    const trecho = trechoDe(container, M01);
    fireEvent.click(trecho);
    expect(within(nota(container, M01)).getByRole('button', { name: 'Confirmar' })).toBeDefined();

    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    fireEvent.keyDown(nota(container, M01), { key: 'Escape' });
    expect(document.activeElement).toBe(trecho);
    expect(nota(container, M01).classList.contains('ativa')).toBe(false);
  });

  test('clicar duas vezes no mesmo trecho desfixa', () => {
    const { container } = render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} />);
    const trecho = trechoDe(container, M01);
    fireEvent.click(trecho);
    expect(within(nota(container, M01)).queryByRole('button', { name: 'Confirmar' })).not.toBeNull();
    fireEvent.click(trecho);
    expect(within(nota(container, M01)).queryByRole('button', { name: 'Confirmar' })).toBeNull();
  });
});

describe('ReaderController: ações da marca e filtros', () => {
  test('Ocultar some com o sublinhado na hora e volta atrás quando a API recusa', async () => {
    let recusar: ((erro: Error) => void) | null = null;
    const atualizarMarca = vi.fn(
      () => new Promise<MarcaV1 | null>((_, rejeitar) => { recusar = rejeitar; }),
    );
    const { container } = render(
      <ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} atualizarMarca={atualizarMarca} />,
    );
    fireEvent.click(trechoDe(container, M01));
    fireEvent.click(within(nota(container, M01)).getByRole('button', { name: 'Ocultar' }));

    // Atualização otimista: o trecho perde o sublinhado antes de o servidor responder.
    expect(container.querySelector(`[data-marcas~="${M01}"]`)).toBeNull();
    expect(atualizarMarca).toHaveBeenCalledWith(M01, { visivel: false });
    // A nota continua na margem: aberta enquanto fixada, e só com o número depois de fechada.
    expect(within(nota(container, M01)).getByRole('button', { name: 'Mostrar' })).toBeDefined();
    fireEvent.keyDown(nota(container, M01), { key: 'Escape' });
    expect(nota(container, M01).classList.contains('oculta')).toBe(true);
    expect(within(nota(container, M01)).getByRole('button', { name: /Nota 1 \(oculta\)/ })).toBeDefined();

    await act(async () => {
      recusar?.(new Error('sem rede'));
      await Promise.resolve();
    });
    expect(container.querySelector(`[data-marcas~="${M01}"]`)).not.toBeNull();
    expect(screen.getByText('não foi possível registrar a decisão')).toBeDefined();
  });

  test('Confirmar usa o PATCH e aceita a marca que o servidor devolve', async () => {
    const confirmada = { ...capituloExemplo.marcas[0], avaliacao: 'confirmada' } as MarcaV1;
    const atualizarMarca = vi.fn().mockResolvedValue(confirmada);
    const { container } = render(
      <ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} atualizarMarca={atualizarMarca} />,
    );
    fireEvent.click(trechoDe(container, M01));
    fireEvent.click(within(nota(container, M01)).getByRole('button', { name: 'Confirmar' }));
    expect(atualizarMarca).toHaveBeenCalledWith(M01, { avaliacao: 'confirmada' });

    await act(async () => { await Promise.resolve(); });
    // Os filtros moraram no Caderno (Player v2): o chip "Confirmadas" recorta o texto e a margem.
    fireEvent.click(screen.getByRole('button', { name: 'Painel do documento' }));
    fireEvent.click(screen.getByRole('tab', { name: /Caderno/ }));
    escolherOpcao('Mostrar no caderno', 'Confirmadas');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel do documento' }));
    expect(container.querySelectorAll('.nota')).toHaveLength(1);
  });

  test('o filtro recorta o texto e a margem juntos', () => {
    const { container } = render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} />);
    const comentadas = container.querySelectorAll('.nota').length;
    expect(comentadas).toBeGreaterThan(0);

    const caderno = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Painel do documento' }));
      fireEvent.click(screen.getByRole('tab', { name: /Caderno/ }));
    };
    const fecharPainel = () => fireEvent.click(screen.getByRole('button', { name: 'Fechar painel do documento' }));
    caderno();
    // Uma linha de filtro (J132): um seletor só, que recorta o Caderno e o texto.
    escolherOpcao('Mostrar no caderno', 'Confirmadas');
    expect(screen.getByRole('combobox', { name: 'Mostrar no caderno' }).textContent).toContain('Confirmadas');
    // O texto também é recortado, com o painel aberto.
    expect(container.querySelectorAll('span[data-marcas]')).toHaveLength(0);
    fecharPainel();
    expect(container.querySelectorAll('.nota')).toHaveLength(0);

    caderno();
    fireEvent.click(screen.getByRole('combobox', { name: 'Mostrar no caderno' }));
    fireEvent.click(screen.getByRole('option', { name: /^Tudo/ }));
    fecharPainel();
    expect(container.querySelectorAll('.nota')).toHaveLength(comentadas);
    // As funções entram no seletor com a contagem; a interna "nenhuma" não. Escolher uma deixa só ela no texto.
    caderno();
    fireEvent.click(screen.getByRole('combobox', { name: 'Mostrar no caderno' }));
    const opcoes = screen.getAllByRole('option').map((opcao) => opcao.textContent ?? '');
    expect(opcoes.some((opcao) => /nenhuma/i.test(opcao))).toBe(false);
    const tese = screen.getByRole('option', { name: /^tese/i });
    fireEvent.click(tese);
    fecharPainel();
    expect(container.querySelectorAll('.nota')).toHaveLength(capituloExemplo.marcas.filter((m) => m.funcao === 'tese' && m.comentario !== null && m.visivel && m.validade === 'resolvida' && m.avaliacao !== 'rejeitada').length);
  });
});

describe('ReaderController: folha inferior', () => {
  test('o balão abre e fecha sem mexer no scrollTop do documento', () => {
    const rolagem = document.scrollingElement ?? document.documentElement;
    let posicao = 240;
    Object.defineProperty(rolagem, 'scrollTop', {
      configurable: true,
      get: () => posicao,
      set: (valor: number) => { posicao = valor; },
    });

    const { container } = render(
      <ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} limiarDaMargem={4000} />,
    );
    // Em tela estreita não existe margem: quem responde é a folha.
    expect(container.querySelector('.margem')).toBeNull();

    // Tocar no grifo abre o balão sobre ele, com o comentário do Codex (J138); a folha da nota abre pelo número.
    fireEvent.click(trechoDe(container, M01));
    expect(container.querySelector('.folha')).toBeNull();
    expect(document.querySelector('.balao-da-marca')?.textContent).toContain('Duas grafias de “café”');
    fireEvent.click(within(document.querySelector<HTMLElement>('.balao-da-marca')!).getByRole('button', { name: 'Fechar' }));
    expect(document.querySelector('.balao-da-marca')).toBeNull();
    expect(container.querySelector('.folha')).toBeNull();
    expect(posicao).toBe(240);
  });

  test('"Remover grifo" no balão confirma e apaga de vez, também o grifo do Codex (V-T8)', async () => {
    const apagados: Id[] = [];
    const mudou = vi.fn();
    const edicao = {
      criarGrifo: vi.fn(), apagarGrifo: vi.fn(), trocarFuncao: vi.fn(),
      apagarDeVez: (id: Id) => { apagados.push(id); return Promise.resolve(); },
    };
    const { container } = render(
      <ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} limiarDaMargem={4000} edicao={edicao} aoMudarMarcas={mudou} />,
    );
    fireEvent.click(trechoDe(container, M01));
    fireEvent.click(within(document.querySelector<HTMLElement>('.balao-da-marca')!).getByRole('button', { name: 'Mais ações do grifo' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remover grifo' }));
    const dialogo = screen.getByRole('alertdialog');
    expect(dialogo.textContent).toContain('Remover este grifo?');
    expect(dialogo.textContent).toContain('o comentário do Codex');
    expect(dialogo.textContent).toContain('Isto não pode ser desfeito.');
    expect(apagados).toEqual([]);
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover' }));
    await act(() => Promise.resolve());
    expect(apagados).toEqual([M01]);
    expect(mudou).toHaveBeenCalled();
    expect(edicao.apagarGrifo).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(container.querySelector(`span[data-marcas~="${M01}"]`)).toBeNull();
  });

  test('em tela estreita o ponteiro não ativa nada: o gate é o toque', () => {
    const { container } = render(
      <ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} limiarDaMargem={4000} />,
    );
    fireEvent.pointerOver(trechoDe(container, M01));
    expect(container.querySelector('.folha')).toBeNull();
  });
});

describe('ReaderController: capítulo concluído', () => {
  test('chegar ao fim não marca sozinho; avançar pelo próximo capítulo marca e avisa a biblioteca', () => {
    const registro: Id[][] = [];
    render(
      <ReaderController
        snapshot={capituloExemplo}
        documento_id={DOCUMENTO}
        aoMudarCapitulos={(lista) => registro.push([...lista])}
        navegacao={<a href="#seguinte" data-avancar="" onClick={(evento) => { evento.preventDefault(); }}>Próximo capítulo</a>}
      />,
    );
    expect(registro.at(-1)).toEqual([]);
    expect(screen.queryByText('Marcar capítulo como lido')).toBeNull();
    fireEvent.click(screen.getByText('Próximo capítulo'));
    expect(registro.at(-1)).toEqual([capituloExemplo.secao.id]);
  });
});

test('sem níveis de atenção: "Marcas" na barra esconde e mostra todas, em qualquer largura; as notas voltam à margem em 1440 px', () => {
  vi.stubGlobal('innerWidth', 1366);
  const { container } = render(<ContextoDeAparencia><ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} /></ContextoDeAparencia>);
  expect(container.querySelector('.margem')).toBeNull();
  expect(screen.queryByRole('radiogroup', { name: 'Nível de atenção' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Atenção/u })).toBeNull();
  const marcas = screen.getByRole('button', { name: 'Marcas' });
  expect(marcas.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelectorAll('[data-marcas]').length).toBeGreaterThan(0);
  fireEvent.click(marcas);
  expect(container.querySelectorAll('[data-marcas]')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Marcas' }));
  vi.stubGlobal('innerWidth', 1440);
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(container.querySelector('.margem')).not.toBeNull();
});

test('com "Mostrar todas as marcas ao abrir" desligado, o leitor abre sem marcas e o botão as mostra', () => {
  try { localStorage.setItem('margem:aparencia', JSON.stringify({ marcasAoAbrir: false, versao: 3 })); } catch { /* sem storage */ }
  try {
    const { container } = render(<ContextoDeAparencia><ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} /></ContextoDeAparencia>);
    expect(container.querySelectorAll('[data-marcas]')).toHaveLength(0);
    const marcas = screen.getByRole('button', { name: 'Marcas' });
    expect(marcas.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(marcas);
    expect(container.querySelectorAll('[data-marcas]').length).toBeGreaterThan(0);
  } finally {
    try { localStorage.removeItem('margem:aparencia'); } catch { /* sem storage */ }
  }
});

const percorrer = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Painel do documento' }));
  fireEvent.click(screen.getByRole('tab', { name: /Caderno/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Percorrer grifos e relações' }));
};

test('Percorrer (Player v2): do Caderno, o player central salta de grifo em grifo na ordem do texto, mantém o destaque sem hover e fecha com Esc', () => {
  const { container } = render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} />);
  percorrer();
  // O painel fecha e o player aparece embaixo; a margem continua (a nota do grifo abre nela).
  expect(screen.queryByRole('complementary', { name: 'Painel do documento' })).toBeNull();
  const player = screen.getByRole('region', { name: 'Percorrer grifos e relações' });
  expect(trechoDe(container, M01).classList.contains('ativa')).toBe(true);
  expect(within(player).getByRole('status').textContent).toMatch(/^1 \/ \d+ · grifo/);
  fireEvent.click(within(player).getByRole('button', { name: 'Próximo destaque' }));
  expect(trechoDe(container, M01).classList.contains('ativa')).toBe(false);
  expect(trechoDe(container, '0'.repeat(23) + 'M02').classList.contains('ativa')).toBe(true);
  fireEvent.pointerOut(trechoDe(container, '0'.repeat(23) + 'M02'));
  expect(trechoDe(container, '0'.repeat(23) + 'M02').classList.contains('ativa')).toBe(true);
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  expect(trechoDe(container, M01).classList.contains('ativa')).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Percorrer grifos e relações' })).toBeNull();
  expect(container.querySelector('.margem')).not.toBeNull();
});

test('Percorrer mistura grifos e relações na ordem do texto e se desfaz ao trocar de capítulo', () => {
  const navegar = vi.fn();
  const relacoes = [{ id: 'relacao-1', tipo: 'braquete' as const, ancora: capituloExemplo.marcas[1]!.ancora, destino: capituloExemplo.marcas[2]!.ancora, titulo: 'sustenta', texto: 'Uma relação.' }];
  const { rerender } = render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} relacoesParaNavegar={relacoes} aoNavegarDestaques={navegar} />);
  percorrer();
  const player = screen.getByRole('region', { name: 'Percorrer grifos e relações' });
  // Passa pelos destaques até a relação, que vem logo depois do grifo em que ela começa.
  for (let i = 0; i < 12 && !navegar.mock.calls.some(([estado]) => (estado as { relacaoId: string | null }).relacaoId === 'relacao-1'); i++) {
    fireEvent.click(within(player).getByRole('button', { name: 'Próximo destaque' }));
  }
  expect(navegar).toHaveBeenLastCalledWith({ aberta: true, relacaoId: 'relacao-1', cartao: true });
  expect(within(player).getByRole('status').textContent).toContain('relação');
  expect(within(player).getByText('sustenta')).toBeTruthy();
  rerender(<ReaderController snapshot={{ ...capituloExemplo, secao: { ...capituloExemplo.secao, id: 'outro-capitulo' } }} documento_id={DOCUMENTO} relacoesParaNavegar={[]} aoNavegarDestaques={navegar} />);
  expect(navegar).toHaveBeenLastCalledWith({ aberta: false, relacaoId: null, cartao: true });
  expect(screen.queryByRole('region', { name: 'Percorrer grifos e relações' })).toBeNull();
});
