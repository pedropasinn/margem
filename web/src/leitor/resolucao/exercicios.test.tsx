// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ResolucaoV2 } from '@margem/contratos';
import type { SessaoDaApi } from '../../biblioteca/api';
import { ExerciciosNaPagina, type FontesDosExercicios } from './ExerciciosNaPagina';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });
const id = (n: number): string => String(n).padStart(26, '0');
const base: ResolucaoV2 = {
  versao: 2, id: id(1), documento_id: id(2), versao_id: id(3),
  origem: { tipo: 'recorte', pagina: 17, retangulo: { x: .1, y: .1, largura: .8, altura: .1 }, imagem_sha256: 'a'.repeat(64) },
  texto_extraido: '', resolucao: null, execucao: null, mensagens: [], criada_em: '2026-09-27T10:00:00Z',
};
const pronta: ResolucaoV2 = { ...base, id: id(4), resolucao: { enunciado: 'Prove $1+2+\\cdots+n=\\frac{n(n+1)}{2}$.', legibilidade: 'boa', conceitos: [], observacao: null,
  itens: [{ rotulo: 'a', enunciado: 'a', estrategia: 'Indução em $n$.', passos: [{ texto: 'p', calculo: null }], resposta: 'r', verificacao: null }] } };

function folha(numero: number): HTMLElement {
  const elemento = document.createElement('div');
  elemento.className = 'pdf-pagina'; elemento.dataset['pagina'] = String(numero);
  Object.defineProperty(elemento, 'clientWidth', { value: 800 });
  Object.defineProperty(elemento, 'clientHeight', { value: 1100 });
  document.body.append(elemento);
  return elemento;
}

test('cada recorte do documento fica marcado na sua página: caixa sem fundo, nota com prévia; o clique abre; a que falhou tenta de novo ou sai', async () => {
  const pagina = folha(17);
  const sessoes: SessaoDaApi[] = [
    { resolucao: pronta, estado: 'pronta' },
    { resolucao: { ...base, id: id(5) }, estado: 'falhou' },
    { resolucao: { ...base, id: id(6), versao_id: id(99) }, estado: 'pronta' },
    { resolucao: { ...base, id: id(7), origem: { tipo: 'trecho', ancora: { versao_id: id(3), bloco_id: id(8), inicio_utf16: 0, fim_utf16: 1, citacao: 'x', prefixo: '', sufixo: '' } } }, estado: 'pronta' },
  ];
  const fontes: FontesDosExercicios = {
    listar: vi.fn(() => Promise.resolve({ resolucoes: sessoes })),
    obter: vi.fn(() => Promise.resolve({ ...sessoes[1]!, jobs: [{ id: id(50), tipo: 'resolver_exercicio', estado: 'falhou' }] })),
    remover: vi.fn(() => Promise.resolve(null)), tentarDeNovo: vi.fn(() => Promise.resolve({})),
  };
  const aoAbrir = vi.fn();
  render(<ExerciciosNaPagina documentoId={id(2)} versaoId={id(3)} aberta={null} aoAbrir={aoAbrir} fontes={fontes} />);
  // Só as da versão lida e com recorte: a de outra versão e a de trecho não entram.
  await waitFor(() => expect(pagina.querySelectorAll('.caixa-do-exercicio')).toHaveLength(2));
  expect(pagina.querySelector('.caixa-do-exercicio path')?.getAttribute('fill')).toBe('none');
  const notas = pagina.querySelectorAll<HTMLElement>('.nota-do-exercicio');
  expect(notas).toHaveLength(2);
  // Sem margem à vista, a nota fica no canto do retângulo, na folha; a de baixo não cobre a de cima.
  expect(notas[0]!.dataset['lugar']).toBe('pagina');
  expect(notas[0]!.style.left).toBe('720px');
  expect(parseFloat(notas[1]!.style.top)).toBeGreaterThan(parseFloat(notas[0]!.style.top));
  // A prévia traz só a ideia do primeiro item (com a fórmula pelo KaTeX): o enunciado já está na página.
  await waitFor(() => expect(notas[0]!.querySelector('.previa-do-exercicio .katex')).not.toBeNull());
  expect(notas[0]!.querySelector('.linha-da-previa')?.textContent).toContain('Indução em');
  expect(notas[0]!.querySelector('.previa-do-exercicio')?.textContent).not.toContain('Prove');
  fireEvent.click(screen.getByRole('button', { name: /Exercício resolvido: abrir/ }));
  expect(aoAbrir).toHaveBeenCalledWith(id(4));
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
  await waitFor(() => expect(fontes.tentarDeNovo).toHaveBeenCalledWith(id(50)));
  fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
  await waitFor(() => expect(fontes.remover).toHaveBeenCalledWith(id(5)));
});

test('com a margem à vista, a nota vai para a margem, na altura do exercício', async () => {
  const leitor = document.createElement('div'); leitor.className = 'leitor-pdf';
  const margem = document.createElement('div'); margem.className = 'margem';
  leitor.append(margem); document.body.append(leitor);
  folha(17);
  const fontes: FontesDosExercicios = { listar: () => Promise.resolve({ resolucoes: [{ resolucao: { ...base, id: id(9) }, estado: 'resolvendo' }] }), obter: vi.fn(), remover: vi.fn(), tentarDeNovo: vi.fn() };
  render(<ExerciciosNaPagina documentoId={id(2)} versaoId={id(3)} aberta={id(9)} aoAbrir={() => undefined} fontes={fontes} />);
  await waitFor(() => expect(margem.querySelector('.nota-do-exercicio')).not.toBeNull());
  const nota = margem.querySelector<HTMLElement>('.nota-do-exercicio')!;
  expect(nota.dataset['lugar']).toBe('margem');
  expect(nota.style.top).toBe('110px');
  expect(nota.textContent).toContain('Resolvendo…');
  expect(document.querySelector('.caixa-do-exercicio')?.hasAttribute('data-aceso')).toBe(true);
});

test('questão por imagem (a página inteira): a nota entra no canto, por dentro da folha (J119)', async () => {
  const pagina = folha(1);
  const inteira: ResolucaoV2 = { ...pronta, id: id(10), origem: { tipo: 'recorte', pagina: 1, retangulo: { x: 0, y: 0, largura: 1, altura: 1 }, imagem_sha256: 'b'.repeat(64) } };
  const fontes: FontesDosExercicios = { listar: () => Promise.resolve({ resolucoes: [{ resolucao: inteira, estado: 'pronta' }, { resolucao: { ...pronta, origem: { ...pronta.origem as Extract<ResolucaoV2['origem'], { tipo: 'recorte' }>, pagina: 1 } }, estado: 'pronta' }] }), obter: vi.fn(), remover: vi.fn(), tentarDeNovo: vi.fn() };
  render(<ExerciciosNaPagina documentoId={id(2)} versaoId={id(3)} aberta={null} aoAbrir={() => undefined} fontes={fontes} />);
  await waitFor(() => expect(pagina.querySelectorAll('.nota-do-exercicio')).toHaveLength(2));
  const [daPagina, doRecorte] = [...pagina.querySelectorAll<HTMLElement>('.nota-do-exercicio')];
  expect(daPagina!.style.left).toBe('800px');
  expect(daPagina!.hasAttribute('data-dentro')).toBe(true);
  // Um recorte com folga à direita continua com a nota do lado de fora, como antes.
  expect(doRecorte!.hasAttribute('data-dentro')).toBe(false);
});
