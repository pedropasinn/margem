// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ResolucaoV2 } from '@margem/contratos';
import type { SessaoDaApi } from '../../biblioteca/api';
import { SessaoDeResolucao, type FontesDaSessao } from './SessaoDeResolucao';
import { ListaDeResolucoes } from './ListaDeResolucoes';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const id = (n: number): string => String(n).padStart(26, '0');
const base: ResolucaoV2 = {
  versao: 2, id: id(1), documento_id: id(2), versao_id: id(3),
  origem: { tipo: 'recorte', pagina: 12, retangulo: { x: 0, y: 0, largura: 1, altura: 0.3 }, imagem_sha256: 'a'.repeat(64) },
  texto_extraido: 'Resolva 2x + 3 = 11.', resolucao: null, execucao: null, mensagens: [], criada_em: '2026-09-27T10:00:00Z',
};
const pronta: ResolucaoV2 = {
  ...base, execucao: { modelo: 'm', esforco: 'high' },
  resolucao: { enunciado: 'Resolva 2x + 3 = 11.', legibilidade: 'boa', conceitos: ['equação do 1º grau'], observacao: null,
    itens: [{ rotulo: '', enunciado: '2x + 3 = 11', estrategia: 'Isolar x.', resposta: 'x = 4', verificacao: '2·4 + 3 = 11',
      passos: [{ texto: 'Subtraia 3 dos dois lados.', calculo: '2x + 3 − 3 = 11 − 3\n2x = 8' }, { texto: 'Divida por 2.', calculo: 'x = 4' }] }] },
};

test('resolvendo: consulta de novo até a resolução chegar; os passos aparecem um de cada vez e a resposta por último', async () => {
  const respostas: SessaoDaApi[] = [{ resolucao: base, estado: 'resolvendo' }, { resolucao: pronta, estado: 'pronta' }];
  const fontes: FontesDaSessao = {
    obter: vi.fn(() => Promise.resolve(respostas.length > 1 ? respostas.shift()! : respostas[0]!)),
    perguntar: vi.fn(() => Promise.resolve({ resolucao: { ...pronta, mensagens: [{ id: id(9), autor: 'leitor' as const, texto: 'Por quê?', criada_em: '2026-09-27T10:01:00Z' }] }, estado: 'respondendo' as const })),
    tentarDeNovo: vi.fn(() => Promise.resolve({})),
  };
  render(<SessaoDeResolucao id={id(1)} aoFechar={() => undefined} fontes={fontes} intervaloMs={10} />);
  expect((await screen.findAllByText(/Resolvendo o exercício…/)).length).toBeGreaterThan(0);
  await screen.findByText('Isolar x.');
  expect(screen.queryByText('Subtraia 3 dos dois lados.')).toBeNull();
  // Nada de conceitos em etiquetas, nem de enunciado repetido: só a foto e a ideia.
  expect(screen.queryByText('equação do 1º grau')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar o primeiro passo' }));
  expect(screen.getByText('Subtraia 3 dos dois lados.')).toBeDefined();
  // A conta de várias linhas vira uma linha por igualdade (texto, nunca HTML).
  expect(screen.getByText('2x = 8')).toBeDefined();
  expect(screen.queryByText('Divida por 2.')).toBeNull();
  expect(screen.queryByText('2·4 + 3 = 11')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Próximo passo (2 de 2)' }));
  // O último passo já é a resposta: não há um "ver a resposta" à parte.
  expect(screen.getByRole('listitem', { name: 'Resposta' }).textContent).toContain('Divida por 2.');
  expect(screen.queryByRole('button', { name: /Ver a resposta/ })).toBeNull();
  expect(screen.getByText('2·4 + 3 = 11')).toBeDefined();
  // A caixa da pergunta só aparece quando o leitor a abre.
  expect(screen.queryByRole('textbox', { name: 'Pergunta sobre a resolução' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Perguntar sobre um passo' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Pergunta sobre a resolução' }), { target: { value: 'Por quê?' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Perguntar' })); await Promise.resolve(); });
  await waitFor(() => expect(fontes.perguntar).toHaveBeenCalledWith(id(1), 'Por quê?'));
});

test('falhou: oferece tentar de novo o job que falhou', async () => {
  const fontes: FontesDaSessao = {
    obter: vi.fn(() => Promise.resolve({ resolucao: base, estado: 'falhou' as const, jobs: [{ id: id(50), tipo: 'resolver_exercicio', estado: 'falhou' }] })),
    perguntar: vi.fn(), tentarDeNovo: vi.fn(() => Promise.resolve({})),
  };
  render(<SessaoDeResolucao id={id(1)} aoFechar={() => undefined} fontes={fontes} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
  expect(fontes.tentarDeNovo).toHaveBeenCalledWith(id(50));
});

test('lista: remove as que falharam de uma vez; a que está resolvendo não pode ser removida', async () => {
  const sessoes: SessaoDaApi[] = [
    { resolucao: { ...base, id: id(11) }, estado: 'resolvendo' },
    { resolucao: { ...pronta, id: id(12) }, estado: 'pronta' },
    { resolucao: { ...base, id: id(13) }, estado: 'falhou' },
    { resolucao: { ...base, id: id(14) }, estado: 'falhou' },
  ];
  const remover = vi.fn<(alvo: string) => Promise<null>>(() => Promise.resolve(null));
  const fontes = { listar: () => Promise.resolve({ resolucoes: sessoes }), remover };
  render(<ListaDeResolucoes documentoId={id(2)} aoAbrir={() => {}} fontes={fontes} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remover as 2 que falharam' }));
  await waitFor(() => expect(remover.mock.calls.map((chamada) => chamada[0])).toEqual([id(13), id(14)]));
  await waitFor(() => expect(screen.queryByText(/falhou/)).toBeNull());
  expect(screen.getAllByRole('button', { name: /^Remover:/ })).toHaveLength(1);
});

test('itens: o item a inteiro primeiro, depois o b; → e Espaço avançam, ← recua; o botão é sempre o mesmo', async () => {
  const doisItens: ResolucaoV2 = {
    ...pronta, resolucao: { ...pronta.resolucao!, itens: [
      { rotulo: 'a', enunciado: 'Item a', estrategia: 'Ideia a.', resposta: 'Resposta a', verificacao: null, passos: [{ texto: 'Passo a1', calculo: null }, { texto: 'Passo a2', calculo: '$$x = 1$$' }] },
      { rotulo: 'b', enunciado: 'Item b', estrategia: 'Ideia b.', resposta: 'Resposta b', verificacao: null, passos: [{ texto: 'Passo b1', calculo: null }] },
    ] },
  };
  const fontes: FontesDaSessao = { obter: vi.fn(() => Promise.resolve({ resolucao: doisItens, estado: 'pronta' as const })), perguntar: vi.fn(), tentarDeNovo: vi.fn() };
  render(<SessaoDeResolucao id={id(1)} aoFechar={() => undefined} fontes={fontes} />);
  await screen.findByText('Ideia a.');
  expect(screen.queryByText('Ideia b.')).toBeNull();
  expect(screen.getByText('Depois: item b')).toBeDefined();
  const botao = screen.getByRole('button', { name: 'Mostrar o primeiro passo' });
  const anterior = screen.getByRole('button', { name: 'Passo anterior' });
  expect(anterior.hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Item a · passo 0 de 2')).toBeDefined();
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(screen.getByText('Passo a1')).toBeDefined();
  expect(botao.getAttribute('aria-label')).toBe('Próximo passo (2 de 2)');
  expect(anterior.hasAttribute('disabled')).toBe(false);
  fireEvent.keyDown(document.body, { key: ' ' });
  expect(screen.getByText('Passo a2')).toBeDefined();
  // O cálculo em LaTeX passa pelo KaTeX.
  await waitFor(() => expect(document.querySelector('.calculo .katex')).not.toBeNull());
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
  expect(screen.queryByText('Passo a2')).toBeNull();
  fireEvent.click(anterior);
  expect(screen.queryByText('Passo a1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos os passos' }));
  expect(screen.getByText('Passo a2')).toBeDefined();
  // A resposta é o último passo; o texto de resposta à parte não aparece quando há passos.
  expect(screen.queryByText('Resposta a')).toBeNull();
  expect(screen.queryByText('Ideia b.')).toBeNull();
  expect(botao.getAttribute('aria-label')).toBe('Ir para o item b');
  expect(screen.getByText('Item a completo')).toBeDefined();
  // Num campo de texto, as teclas são do campo.
  fireEvent.click(screen.getByRole('button', { name: 'Perguntar sobre um passo' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Pergunta sobre a resolução' }), { key: 'ArrowRight' });
  expect(screen.queryByText('Ideia b.')).toBeNull();
  fireEvent.click(botao);
  expect(screen.getByText('Ideia b.')).toBeDefined();
  expect(screen.getByText('Passo a2')).toBeDefined();
  fireEvent.click(botao);
  expect(screen.getByText('Passo b1')).toBeDefined();
  expect(botao.getAttribute('aria-label')).toBe('Resolução completa');
  expect((botao as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Completo')).toBeDefined();
});

test('item sem passos: a resposta é o único passo', async () => {
  const semPassos: ResolucaoV2 = { ...pronta, resolucao: { ...pronta.resolucao!, itens: [
    { rotulo: '', enunciado: '', estrategia: 'Direto.', resposta: 'Vale 7.', verificacao: null, passos: [] },
  ] } };
  const fontes: FontesDaSessao = { obter: vi.fn(() => Promise.resolve({ resolucao: semPassos, estado: 'pronta' as const })), perguntar: vi.fn(), tentarDeNovo: vi.fn() };
  render(<SessaoDeResolucao id={id(1)} aoFechar={() => undefined} fontes={fontes} />);
  await screen.findByText('Direto.');
  expect(screen.queryByText('Vale 7.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar o primeiro passo' }));
  expect(screen.getByRole('listitem', { name: 'Resposta' }).textContent).toContain('Vale 7.');
});

test('forma da janela: lateral, flutuante ou tela cheia; a escolha fica guardada', async () => {
  localStorage.removeItem('margem:resolucao:janela');
  const fontes: FontesDaSessao = { obter: vi.fn(() => Promise.resolve({ resolucao: pronta, estado: 'pronta' as const })), perguntar: vi.fn(), tentarDeNovo: vi.fn() };
  const { unmount } = render(<SessaoDeResolucao id={id(1)} aoFechar={() => undefined} fontes={fontes} />);
  await screen.findByText('Isolar x.');
  const janela = screen.getByRole('dialog', { name: 'Resolução do exercício' });
  expect(janela.dataset['janela']).toBe('lateral');
  fireEvent.click(screen.getByRole('radio', { name: 'Tela cheia' }));
  expect(janela.dataset['janela']).toBe('tela-cheia');
  expect(localStorage.getItem('margem:resolucao:janela')).toBe('tela-cheia');
  unmount();
  render(<SessaoDeResolucao id={id(1)} aoFechar={() => undefined} fontes={fontes} />);
  await screen.findByText('Isolar x.');
  expect(screen.getByRole('dialog', { name: 'Resolução do exercício' }).dataset['janela']).toBe('tela-cheia');
  localStorage.removeItem('margem:resolucao:janela');
});
