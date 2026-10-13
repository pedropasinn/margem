import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ResolucaoV2 } from '@margem/contratos';
import { Exercicios } from './Exercicios';
import { caminhoDaRota, rotaDoCaminho } from './rotas';
import type { ExercicioDaLista, ExerciciosDoDocumento } from './api';

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

const DOC = '01M3S8K9DC29QMXKCDJWX3DTMP';
const SECAO = '7AM4GN4H43341H0D55HBQXJ7VJ';
const id = (n: number) => `01M3S8K9DC29QMXKCDJWX3DT${String(n).padStart(2, '0')}`;
function exercicio(n: number, parcial: Partial<ExercicioDaLista> & { resolvida?: boolean } = {}): ExercicioDaLista {
  const { resolvida = false, ...resto } = parcial;
  const resolucao: ResolucaoV2 = {
    versao: 2, id: id(n), documento_id: DOC, versao_id: '01M3S8KV4D2NMVRWE8D6ADMT8K',
    origem: { tipo: 'recorte', pagina: 17, retangulo: { x: 0.1, y: n / 10, largura: 0.8, altura: 0.05 }, imagem_sha256: 'a'.repeat(64) },
    texto_extraido: `${String(n)}. Usando indução, prove…`, resolucao: resolvida ? {
      enunciado: 'Prove que $1 + 2 + \\cdots + n = \\frac{n(n+1)}{2}$.', legibilidade: 'boa', conceitos: [], observacao: null,
      itens: [{ rotulo: '', enunciado: 'x', estrategia: 'Indução em $n$.', passos: [{ texto: 'Base.', calculo: '$$1 = 1$$' }], resposta: 'Vale.', verificacao: null }],
    } : null, execucao: null, mensagens: [], criada_em: '2026-10-02T00:00:00Z',
  };
  return { resolucao, estado: resolvida ? 'pronta' : 'pendente', secao_id: SECAO, capitulo: 'Capítulo 1 · Conjuntos Finitos e Infinitos', secao: 'Seção 1: Números naturais', numero: String(n), ...resto };
}

function escolher(caixa: string, opcao: string | RegExp): void {
  fireEvent.click(screen.getByRole('combobox', { name: caixa }));
  fireEvent.click(screen.getByRole('option', { name: opcao }));
}
const doLivro = () => [...document.querySelectorAll<HTMLElement>('.exercicio-da-lista')];

test('rota da página de exercícios', () => {
  expect(rotaDoCaminho(`/documentos/${DOC}/exercicios`)).toEqual({ nome: 'exercicios', documento_id: DOC });
  expect(caminhoDaRota({ nome: 'exercicios', documento_id: DOC })).toBe(`/documentos/${DOC}/exercicios`);
});

test('lista por capítulo e seção, filtra, pede a resolução, exporta e leva ao exercício no leitor', async () => {
  const dados: ExerciciosDoDocumento = { documento: { id: DOC, titulo: 'Análise Real', autor: 'Elon Lages Lima', formato: 'pdf' }, exercicios: [
    exercicio(1, { resolvida: true }),
    exercicio(2),
    exercicio(3, { estado: 'falhou' }),
    exercicio(1, { capitulo: 'Capítulo 2 · Números Reais', secao: 'Seção 1: ℝ é um corpo', resolucao: { ...exercicio(4).resolucao, id: id(4) } }),
  ] };
  const listar = vi.fn(() => Promise.resolve(dados));
  const resolver = vi.fn(() => Promise.resolve({ resolucao: dados.exercicios[1]!.resolucao, estado: 'resolvendo' as const, job_id: id(9) }));
  const ir = vi.fn();
  render(<Exercicios documento_id={DOC} ir={ir} fontes={{ listar, resolver }} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Análise Real' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('1 de 4 resolvidos');
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Capítulo 1 · Conjuntos Finitos e Infinitos', 'Capítulo 2 · Números Reais']);
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Seção 1: Números naturais', 'Seção 1: ℝ é um corpo']);

  // O resolvido mostra o enunciado com a fórmula (KaTeX) e a resolução recolhida; o pendente, o recorte.
  const capitulo1 = screen.getByRole('region', { name: 'Capítulo 1 · Conjuntos Finitos e Infinitos' });
  const itens = [...capitulo1.querySelectorAll<HTMLElement>('.exercicio-da-lista')];
  expect(itens[0]!.querySelector('[data-tex]')?.getAttribute('data-tex')).toBe('1 + 2 + \\cdots + n = \\frac{n(n+1)}{2}');
  expect(within(itens[0]!).getByText(/Ver a resolução/)).toBeTruthy();
  expect(within(itens[1]!).getByRole('img').getAttribute('src')).toBe(`/api/resolucoes/${id(2)}/imagem`);
  expect(within(itens[2]!).getByText('Falhou')).toBeTruthy();

  // Exportar: PDF e LaTeX, do capítulo escolhido.
  expect(screen.getByRole('link', { name: /PDF/ }).getAttribute('href')).toBe(`/api/documentos/${DOC}/exercicios.pdf`);
  escolher('Capítulo', 'Capítulo 2 · Números Reais');
  await waitFor(() => expect(screen.getByRole('link', { name: /LaTeX/ }).getAttribute('href')).toBe(`/api/documentos/${DOC}/exercicios.tex?capitulo=Cap%C3%ADtulo+2+%C2%B7+N%C3%BAmeros+Reais`));
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Capítulo 2 · Números Reais']);
  escolher('Capítulo', 'Todos os capítulos');

  // Filtro por estado.
  escolher('Estado', /^A resolver/);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1 de 4 resolvidos · 2 com esse filtro'));
  escolher('Estado', /^Todos/);

  // Resolver um pendente: chama a API e lista de novo.
  fireEvent.click(within(doLivro()[1]!).getByRole('button', { name: 'Resolver' }));
  await waitFor(() => expect(resolver).toHaveBeenCalledWith(id(2)));
  await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));

  // Ir ao exercício: grava a intenção (página e resolução) e abre o capítulo no leitor.
  fireEvent.click(within(doLivro()[0]!).getByRole('button', { name: /Ir ao exercício/ }));
  expect(ir).toHaveBeenCalledWith({ nome: 'leitura', documento_id: DOC, secao_id: SECAO });
  expect(JSON.parse(sessionStorage.getItem('margem:ao-abrir') ?? '{}')).toEqual({ documento_id: DOC, secao_id: SECAO, resolucao: id(1), pagina: 17 });
});

test('sem exercícios: o caminho para recortar no leitor', async () => {
  render(<Exercicios documento_id={DOC} ir={vi.fn()} fontes={{ listar: () => Promise.resolve({ documento: { id: DOC, titulo: 'X', autor: null, formato: 'pdf' }, exercicios: [] }), resolver: vi.fn() }} />);
  expect(await screen.findByText(/Nenhum exercício ainda/)).toBeTruthy();
});
