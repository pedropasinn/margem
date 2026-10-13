// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { agruparPontas, PONTAS_POR_LEQUE, posicoesDoLeque, PontasAgrupadas, type PontoDeRelacao } from './PontasAgrupadas';
afterEach(cleanup);
const ponto = (n: number, y = 200): PontoDeRelacao => ({ tipo: 'suporta', chave: `${n}:saida`, id: String(n), y, cor: n % 5, lado: n % 2 ? 'chegada' : 'saida', descricao: `Relação ${n}` });
test('agrupar não encadeia linhas distantes e conserva as duas direções', () => {
  const grupos = agruparPontas([ponto(3, 252), ponto(2, 226), ponto(1, 200)]);
  expect(grupos.map((g) => g.pontos.length)).toEqual([2, 1]);
  expect(grupos[0]?.pontos.map((p) => p.lado)).toEqual(['chegada', 'saida']);
});
test('leque grande pagina todas as pontas e mantém os alvos quando a página dobra', async () => {
  const ativar = vi.fn(); const fixar = vi.fn();
  const pontos = Array.from({ length: 80 }, (_, i) => ponto(i));
  const props = { pontos, x: 160, ativa: null, aoAtivar: ativar, aoFixar: fixar, aoSair: vi.fn() };
  const { rerender } = render(<PontasAgrupadas {...props} />);
  const pilha = screen.getByRole('button', { name: '80 pontas de relações nesta linha' });
  fireEvent.pointerEnter(pilha);
  const grupo = screen.getByRole('group', { name: 'Pontas desta linha' });
  expect(within(grupo).getAllByRole('button')).toHaveLength(PONTAS_POR_LEQUE + 3);
  expect(Number.parseFloat(grupo.style.left)).toBeGreaterThanOrEqual(4);
  const alvo = within(grupo).getByRole('button', { name: 'Saída: Relação 0' });
  fireEvent.pointerEnter(alvo); expect(ativar).toHaveBeenLastCalledWith('0');
  fireEvent.click(alvo); expect(fixar).toHaveBeenLastCalledWith('0');
  const topo = grupo.style.top;
  rerender(<PontasAgrupadas {...props} pontos={pontos.map((p) => ({ ...p, y: p.y - 400 }))} ativa="0" />);
  expect(screen.getByRole('group', { name: 'Pontas desta linha' }).style.top).toBe(topo);
  expect(screen.getByRole('button', { name: 'Saída: Relação 0' }).getAttribute('aria-pressed')).toBe('true');
  const vistos = new Set<string>();
  for (let pagina = 0; pagina < 80 / PONTAS_POR_LEQUE; pagina++) {
    for (const botao of grupo.querySelectorAll('.ponta-agrupada')) vistos.add(botao.getAttribute('aria-label') ?? '');
    if (pagina + 1 < 80 / PONTAS_POR_LEQUE) fireEvent.click(screen.getByRole('button', { name: 'Próximas pontas' }));
  }
  expect(vistos.size).toBe(80);
  expect(screen.getByRole('button', { name: 'Próximas pontas' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Recolher bolinhas' }));
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Pontas desta linha' })).toBeNull());
});


test('leques compactos abrem à esquerda sem colisões nem saída do palco', () => {
  for (let n = 1; n <= PONTAS_POR_LEQUE; n++) {
    const pontos = posicoesDoLeque(n);
    for (const [i, p] of pontos.entries()) {
      expect(p.x).toBeLessThan(0);
      expect(Math.hypot(p.x, p.y)).toBeLessThan(68);
      expect(p.x + 64).toBeGreaterThanOrEqual(0);
      expect(p.x + 100).toBeLessThanOrEqual(112);
      expect(p.y + 60).toBeGreaterThanOrEqual(0);
      expect(p.y + 96).toBeLessThan(160);
      for (const outra of pontos.slice(i + 1)) expect(Math.hypot(p.x - outra.x, p.y - outra.y)).toBeGreaterThan(36);
    }
  }
});

test('ponta isolada ativa e fixa diretamente, mantendo o alvo durante a dobra', () => {
  const ativar = vi.fn(); const fixar = vi.fn();
  const props = { pontos: [ponto(0)], x: 160, ativa: null, aoAtivar: ativar, aoFixar: fixar, aoSair: vi.fn() };
  const { rerender } = render(<PontasAgrupadas {...props} />);
  const bolinha = screen.getByRole('button', { name: 'Saída: Relação 0' });
  fireEvent.pointerEnter(bolinha);
  expect(ativar).toHaveBeenLastCalledWith('0');
  expect(screen.queryByRole('group')).toBeNull();
  expect(screen.queryByText('Escolha uma relação')).toBeNull();
  const topo = bolinha.style.top;
  rerender(<PontasAgrupadas {...props} pontos={[ponto(0, 500), ponto(1, 510)]} ativa="0" />);
  expect(screen.getByRole('button', { name: 'Saída: Relação 0' })).toBe(bolinha);
  expect(bolinha.style.top).toBe(topo);
  fireEvent.click(bolinha);
  expect(fixar).toHaveBeenLastCalledWith('0');
});
