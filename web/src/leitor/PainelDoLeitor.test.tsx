import { createRef } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ReaderController } from './ReaderController';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import type { ApiDoLeitor } from './tipos';

const documento = '0'.repeat(22) + 'D001';
const nomePainel = { name: 'Painel do documento' };
const rolar = vi.fn();
beforeEach(() => {
  rolar.mockReset();
  localStorage.clear();
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('scrollBy', rolar);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

test('botão e ] alternam o painel; Esc fecha e devolve foco; persiste entre montagens', () => {
  const { unmount } = render(<ReaderController snapshot={capituloExemplo} documento_id={documento} />);
  const botao = screen.getByRole('button', nomePainel);
  fireEvent.click(botao);
  expect(screen.getByRole('complementary', nomePainel)).toBeTruthy();
  expect(localStorage.getItem('margem:painel-leitor')).toBe('aberto');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('complementary', nomePainel)).toBeNull();
  expect(document.activeElement).toBe(botao);
  fireEvent.keyDown(window, { key: ']' });
  expect(screen.getByRole('complementary', nomePainel)).toBeTruthy();
  unmount();
  // Em 1440 px o painel cobriria o texto: a preferência fica guardada, mas não reabre sozinha.
  const semEspaco = render(<ReaderController snapshot={capituloExemplo} documento_id={documento} />);
  expect(screen.queryByRole('complementary', nomePainel)).toBeNull();
  expect(localStorage.getItem('margem:painel-leitor')).toBe('aberto');
  semEspaco.unmount();
  vi.stubGlobal('innerWidth', 1720);
  render(<ReaderController snapshot={capituloExemplo} documento_id={documento} />);
  expect(screen.getByRole('complementary', nomePainel)).toBeTruthy();
  fireEvent.keyDown(window, { key: ']' });
  expect(screen.queryByRole('complementary', nomePainel)).toBeNull();
  expect(localStorage.getItem('margem:painel-leitor')).toBe('fechado');
});

test('atalho ignora campos e editor; storage indisponível não impede abertura', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('indisponível'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('indisponível'); });
  render(<><input aria-label="Rascunho" /><div contentEditable aria-label="Editor" /><ReaderController snapshot={capituloExemplo} documento_id={documento} /></>);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: ']' });
  fireEvent.keyDown(screen.getByLabelText('Editor'), { key: ']' });
  expect(screen.queryByRole('complementary', nomePainel)).toBeNull();
  fireEvent.click(screen.getByRole('button', nomePainel));
  expect(screen.getByRole('complementary', nomePainel)).toBeTruthy();
});

test('Caderno segue a ordem da margem, inclui pessoais e fixa a nota ao rolar até a âncora', () => {
  const leitor = createRef<ApiDoLeitor>();
  const snapshot = { ...capituloExemplo, marcas: [...capituloExemplo.marcas].reverse() };
  const { container } = render(<ReaderController snapshot={snapshot} documento_id={documento} leitorRef={leitor}
    pessoais={[{ id: 'pessoal', ancora: snapshot.marcas[0]!.ancora, conteudo: <p>Minha hipótese.</p> }]} />);
  const esperadas = [...container.querySelectorAll<HTMLElement>('[data-nota]')].map((nota) => nota.dataset['nota']);
  vi.spyOn(leitor.current!, 'localizar').mockReturnValue(new DOMRect(300, 400, 500, 30));
  fireEvent.click(screen.getByRole('button', nomePainel));
  fireEvent.click(screen.getByRole('tab', { name: /Caderno/ }));
  const caderno = screen.getByRole('tabpanel');
  // O Caderno traz todos os grifos na ordem do texto; os que têm nota levam o número da margem, na mesma ordem.
  const notas = [...caderno.querySelectorAll<HTMLElement>('li[data-tipo="grifo"] .painel-leitor-trecho')].filter((botao) => botao.querySelector('.painel-leitor-rotulo > span') !== null);
  expect(notas.map((botao) => botao.querySelector('.painel-leitor-citacao')?.textContent)).toEqual(esperadas.map((id) => snapshot.marcas.find((marca) => marca.id === id)!.ancora.citacao));
  expect(within(caderno).getByText('Minha hipótese.')).toBeTruthy();
  expect(within(caderno).getByText('P')).toBeTruthy();
  fireEvent.click(notas[0]!);
  expect(notas[0]!.getAttribute('aria-pressed')).toBe('true');
  expect(rolar).toHaveBeenLastCalledWith({ top: 328, behavior: 'smooth' });
  expect(container.querySelector(`[data-marcas~="${esperadas[0]}"]`)?.classList.contains('ativa')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Fechar painel do documento' }));
  expect(container.querySelector(`[data-nota="${esperadas[0]}"] .acoes-nota`) ?? screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy();
});

test.each([1440, 1366, 390])('em %i px o painel sai do fluxo e a margem não se empilha', (largura) => {
  vi.stubGlobal('innerWidth', largura);
  const { container } = render(<ReaderController snapshot={capituloExemplo} documento_id={documento} />);
  const texto = container.querySelector('.capitulo')!;
  const estilo = texto.getAttribute('style');
  fireEvent.click(screen.getByRole('button', nomePainel));
  expect(screen.getByRole('complementary', nomePainel).style.position).toBe('fixed');
  expect(container.querySelector('.capitulo')).toBe(texto);
  expect(texto.getAttribute('style')).toBe(estilo);
  expect(container.querySelector('.margem')).toBeNull();
  expect(container.querySelector('.folha')).toBeNull();
});

test('Info apresenta documento, autor, capítulo e tempo; abas respondem às setas', () => {
  render(<ReaderController snapshot={capituloExemplo} documento_id={documento} tituloDocumento="Um livro" autor="Uma autora" />);
  fireEvent.click(screen.getByRole('button', nomePainel));
  const info = screen.getByRole('tabpanel');
  expect(within(info).getByRole('heading', { name: 'Um livro' })).toBeTruthy();
  expect(within(info).getByText('Uma autora')).toBeTruthy();
  expect(within(info).getByText(capituloExemplo.secao.titulo)).toBeTruthy();
  expect(within(info).getByText(/\d+ min/)).toBeTruthy();
  expect(screen.queryByRole('tab', { name: /Conversas/ })).toBeNull();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Info' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: /Caderno/ }).getAttribute('aria-selected')).toBe('true');
});

test('abrir estudo fecha o painel e impede empilhamento com o drawer', () => {
  const { rerender } = render(<ReaderController snapshot={capituloExemplo} documento_id={documento} />);
  fireEvent.click(screen.getByRole('button', nomePainel));
  rerender(<ReaderController snapshot={capituloExemplo} documento_id={documento} estudoAberto painel={<aside aria-label="Conversa no trecho">Conversa</aside>} />);
  expect(screen.queryByRole('complementary', nomePainel)).toBeNull();
  expect(screen.getByRole('complementary', { name: 'Conversa no trecho' })).toBeTruthy();
  fireEvent.keyDown(window, { key: ']' });
  expect(screen.queryByRole('complementary', nomePainel)).toBeNull();
  expect(localStorage.getItem('margem:painel-leitor')).toBe('fechado');
});

test('J107: Info conta só o que o texto desenha — sem oculta, ambígua, rejeitada nem a IA sem função', () => {
  vi.stubGlobal('innerWidth', 1720);
  // M01 (tese) rejeitada; M05 (IA sem função), M08 (oculta) e M09 (ambígua) também ficam de fora.
  const snapshot = { ...capituloExemplo, marcas: capituloExemplo.marcas.map((marca, indice) => indice === 0 ? { ...marca, avaliacao: 'rejeitada' as const } : marca) };
  render(<ReaderController snapshot={snapshot} documento_id={documento} />);
  fireEvent.click(screen.getByRole('button', nomePainel));
  const info = screen.getByRole('tabpanel');
  expect(within(info).getByText('Marcas').nextElementSibling?.textContent).toBe('5');
  expect([...info.querySelectorAll('.painel-leitor-funcoes li')].map((li) => li.textContent)).toEqual(['conceito2', 'justificativa2', 'tese1']);
});
