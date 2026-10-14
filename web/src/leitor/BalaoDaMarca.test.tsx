import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DificuldadeV1, ModoDeLeituraV1, NotaDoGrifoV1 } from '@margem/contratos';
import { BalaoDaMarca, ESPERA_PARA_SALVAR, LinhaDaDificuldade, type FontesDoBalao } from './BalaoDaMarca';
import { ContextoDosModos, type Olhar } from './ContextoDosModos';
import type { MarcaDoLeitor } from './f2';
import type { SinalDeDificuldade } from './dificuldades';
import { capituloExemplo } from './fixtures/capitulo-exemplo';

const base = capituloExemplo.marcas[0] as MarcaDoLeitor;
const FILOSOFIA = { id: 'filosofica', revisao: 2 };
const POESIA = { id: 'literaria', revisao: 2 };
function modo(ref: { id: string; revisao: number }, nome: string, funcoes: [string, string, string][]): ModoDeLeituraV1 {
  return { versao: 1, ...ref, nome, descricao: '', funcoes: funcoes.map(([chave, rotulo, cor]) => ({ chave, rotulo, pergunta: '?', descricao: rotulo, cor: { claro: cor, escuro: cor } })), comentarios: [], saliencia: {} } as unknown as ModoDeLeituraV1;
}
const MODOS = [
  modo(FILOSOFIA, 'Filosofia', [['tese', 'Tese', '#f00'], ['distincao', 'Distinção', '#0f0'], ['objecao', 'Objeção', '#00f']]),
  modo(POESIA, 'Poesia', [['imagem', 'Imagem', '#ff0'], ['som_ritmo', 'Som e ritmo', '#0ff'], ['voz', 'Voz', '#f0f']]),
  modo({ id: 'ficcao_narrativa', revisao: 1 }, 'Narrativa', [['personagem', 'Personagem', '#888']]),
];
/** Um grifo da IA (com o comentário do Codex) no modo de filosofia. */
const daIa = { ...base, funcao: 'distincao', modo: FILOSOFIA, saliencia: 2, camada_id: 'C'.repeat(26) } as unknown as MarcaDoLeitor;
const doLeitor = { ...daIa, origem: 'manual', comentario: null, funcao: 'tese' } as unknown as MarcaDoLeitor;

beforeEach(() => {
  document.body.insertAdjacentHTML('beforeend', `<svg id="desenho"><g data-desenho="${base.id}"><path d="M0 0"></path></g></svg>`);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 600, 200, 20));
});
afterEach(() => { cleanup(); document.getElementById('desenho')?.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

function fontes(): FontesDoBalao & { notas: { texto: string; revisao?: number | undefined }[]; apagadas: number[] } {
  const notas: { texto: string; revisao?: number | undefined }[] = []; const apagadas: number[] = [];
  let revisao = 0;
  return {
    notas, apagadas,
    gravarNota: (marcaId, texto, rev) => {
      notas.push({ texto, revisao: rev }); revisao += 1;
      return Promise.resolve({ nota: { versao: 1, id: 'N'.repeat(26), marca_id: marcaId, versao_id: capituloExemplo.versao_id, texto, criada_em: '2026-10-14T12:00:00Z', atualizada_em: '2026-10-14T12:00:00Z', revisao_edicao: revisao } satisfies NotaDoGrifoV1 });
    },
    apagarNota: (_marcaId, rev) => { apagadas.push(rev); return Promise.resolve({}); },
    marcarDificuldade: vi.fn(() => Promise.resolve({ dificuldade: {} as DificuldadeV1 })),
    decidirDoCodex: vi.fn(() => Promise.resolve({ dificuldade: {} as DificuldadeV1 })),
    mudarDificuldade: vi.fn(() => Promise.resolve({ dificuldade: {} as DificuldadeV1 })),
  };
}
function comModos(filho: ReactNode, recentes: Olhar[] = [], lembrar = vi.fn()): ReactNode {
  return <ContextoDosModos modos={MODOS} principais={[FILOSOFIA]} recentes={recentes} lembrarOlhar={lembrar}>{filho}</ContextoDosModos>;
}

test('as funções do modo do grifo em chips (a atual marcada), "sem função" discreto; um toque ou 1–9 troca', () => {
  const trocar = vi.fn(() => Promise.resolve());
  render(comModos(<BalaoDaMarca marca={daIa} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={fontes()} funcao={{ trocar }} />));
  const radios = within(screen.getByRole('radiogroup')).getAllByRole('radio');
  expect(radios.map((r) => r.textContent)).toEqual(['Tese', 'Distinção', 'Objeção', 'Sem função']);
  expect(screen.getByRole('radio', { name: 'Distinção' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('radio', { name: 'Objeção' }));
  expect(trocar).toHaveBeenLastCalledWith('objecao', undefined);
  fireEvent.keyDown(window, { key: '1' });
  expect(trocar).toHaveBeenLastCalledWith('tese', undefined);
  fireEvent.click(screen.getByRole('radio', { name: 'Sem função' }));
  expect(trocar).toHaveBeenLastCalledWith('nenhuma', undefined);
  // Nada de etiquetas, dificuldade em lista de botões nem tipo de anotação.
  expect(screen.queryByText(/Etiqueta livre/)).toBeNull();
  expect(screen.queryByText(/Impressão|Hipótese|Observação/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Salto no argumento' })).toBeNull();
});

test('outros olhares: as funções de todos os modos, agrupadas e pesquisáveis; escolher leva o grifo para aquele modo e lembra o olhar', async () => {
  const trocar = vi.fn(() => Promise.resolve());
  const lembrar = vi.fn();
  render(comModos(<BalaoDaMarca marca={doLeitor} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={fontes()} funcao={{ trocar }} />, [], lembrar));
  fireEvent.click(screen.getByRole('button', { name: /Outros olhares/ }));
  const lista = screen.getByRole('listbox', { name: 'Outros olhares' });
  // O modo do grifo fica nos chips; os outros, em grupos.
  expect(within(lista).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Narrativa', 'Poesia']);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Procurar entre outros olhares' }), { target: { value: 'ritmo' } });
  expect(within(lista).getAllByRole('option').map((o) => o.textContent)).toEqual(['Som e ritmoPoesia']);
  fireEvent.click(within(lista).getByRole('option'));
  expect(trocar).toHaveBeenLastCalledWith('som_ritmo', POESIA);
  await waitFor(() => expect(lembrar).toHaveBeenCalledWith({ modo: POESIA, funcao: 'som_ritmo' }));
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('os olhares usados há pouco no documento sobem para a fileira, com o nome do modo', () => {
  const trocar = vi.fn(() => Promise.resolve());
  render(comModos(<BalaoDaMarca marca={doLeitor} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={fontes()} funcao={{ trocar }} />, [{ modo: POESIA, funcao: 'imagem' }]));
  fireEvent.click(screen.getByRole('radio', { name: 'Imagem · Poesia' }));
  expect(trocar).toHaveBeenLastCalledWith('imagem', POESIA);
});

test('a nota do grifo: texto simples, salva sozinha depois de uma pausa (com "Salvo"), troca com a revisão e sai quando apagada', async () => {
  vi.useFakeTimers();
  const f = fontes();
  const mudou = vi.fn();
  render(comModos(<BalaoDaMarca marca={doLeitor} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={f} aoMudar={mudou} focarNota />));
  const campo = screen.getByRole('textbox', { name: 'Sua anotação' });
  expect(document.activeElement).toBe(campo);
  fireEvent.change(campo, { target: { value: 'Aqui o autor muda de assunto.' } });
  expect(f.notas).toEqual([]);
  await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_PARA_SALVAR + 10); });
  expect(f.notas).toEqual([{ texto: 'Aqui o autor muda de assunto.', revisao: undefined }]);
  expect(screen.getByRole('status').textContent).toBe('Salvo');
  expect(mudou).toHaveBeenCalledOnce();
  fireEvent.change(campo, { target: { value: 'Aqui o autor muda de assunto sem avisar.' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_PARA_SALVAR + 10); });
  expect(f.notas.at(-1)).toEqual({ texto: 'Aqui o autor muda de assunto sem avisar.', revisao: 1 });
  // Apagar o texto inteiro tira a nota; o grifo fica.
  fireEvent.change(campo, { target: { value: '   ' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_PARA_SALVAR + 10); });
  expect(f.apagadas).toEqual([2]);
});

test('o comentário do Codex aparece abaixo da nota, na voz do Assistente; o grifo do leitor não tem', () => {
  const { unmount } = render(comModos(<BalaoDaMarca marca={daIa} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={fontes()} nota={{ id: 'N'.repeat(26), texto: 'Minha nota.', revisao_edicao: 3 }} />));
  const assistente = screen.getByRole('region', { name: 'Comentário do Codex' });
  expect(assistente.textContent).toContain('Assistente · Tese do trecho');
  expect(screen.getByRole('textbox', { name: 'Sua anotação' })).toHaveProperty('value', 'Minha nota.');
  // A nota vem antes do comentário.
  expect(screen.getByRole('textbox', { name: 'Sua anotação' }).compareDocumentPosition(assistente) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  unmount();
  render(comModos(<BalaoDaMarca marca={doLeitor} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={fontes()} />));
  expect(screen.queryByRole('region', { name: 'Comentário do Codex' })).toBeNull();
});

test('a dificuldade é um sinal à parte: a do Codex se confirma ou descarta; a do leitor ganha a categoria depois; marcar é uma ação do ⋯', async () => {
  const f = fontes();
  const sugerida: SinalDeDificuldade = { chave: 'codex-1', ancora: base.ancora, origem: 'codex', estado: 'sugerida', tipo: 'salto_argumentativo', descricao: 'O passo do meio falta.', codex: { modelo_id: 'M'.repeat(26), dificuldade_id: 'D'.repeat(26) } };
  const minha: SinalDeDificuldade = { chave: 'gravada-2', ancora: base.ancora, origem: 'leitor', estado: 'confirmada', gravada: { id: 'G'.repeat(26) } as DificuldadeV1 };
  const { unmount } = render(comModos(<BalaoDaMarca marca={daIa} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={f} dificuldades={[sugerida, minha]} />));
  const doCodex = screen.getByRole('region', { name: 'Dificuldade: Salto no argumento' });
  expect(doCodex.textContent).toContain('sugerida pelo Codex');
  fireEvent.click(within(doCodex).getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(f.decidirDoCodex).toHaveBeenCalledWith('M'.repeat(26), 'D'.repeat(26), 'confirmada'));
  const daPessoa = screen.getByRole('region', { name: 'Dificuldade: Dificuldade' });
  fireEvent.click(within(daPessoa).getByRole('combobox', { name: 'Categoria da dificuldade (opcional)' }));
  fireEvent.click(screen.getByRole('option', { name: 'Ambiguidade' }));
  await waitFor(() => expect(f.mudarDificuldade).toHaveBeenCalledWith('G'.repeat(26), { tipo: 'ambiguidade' }));
  // Com uma dificuldade sua no trecho, o ⋯ não oferece outra.
  fireEvent.click(screen.getByRole('button', { name: 'Mais ações do grifo' }));
  expect(screen.queryByRole('menuitem', { name: 'Marcar dificuldade' })).toBeNull();
  unmount();
  render(comModos(<BalaoDaMarca marca={daIa} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={f} />));
  fireEvent.click(screen.getByRole('button', { name: 'Mais ações do grifo' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Marcar dificuldade' }));
  await waitFor(() => expect(f.marcarDificuldade).toHaveBeenCalledWith(daIa.ancora, daIa.id));
});

test('remover: o balão entrega a quem chama (que confirma), do leitor e do Codex, com ou sem nota', () => {
  const remover = vi.fn();
  const { unmount } = render(comModos(<BalaoDaMarca marca={doLeitor} acoes={{ remover }} aoFechar={vi.fn()} fontes={fontes()} nota={{ id: 'N'.repeat(26), texto: 'Guardar.', revisao_edicao: 1 }} />));
  fireEvent.click(screen.getByRole('button', { name: 'Mais ações do grifo' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remover grifo' }));
  expect(remover).toHaveBeenCalledOnce();
  unmount();
  render(comModos(<BalaoDaMarca marca={daIa} acoes={{ remover }} aoFechar={vi.fn()} fontes={fontes()} />));
  fireEvent.click(screen.getByRole('button', { name: 'Mais ações do grifo' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remover grifo' }));
  expect(remover).toHaveBeenCalledTimes(2);
});

test('dificuldade do Codex na análise: Remover pede confirmação e apaga o item', async () => {
  const f = { ...fontes(), apagarDaAnalise: vi.fn(() => Promise.resolve({})) };
  const aoMudar = vi.fn();
  const sinal = { chave: 'codex-D', ancora: doLeitor.ancora, origem: 'codex' as const, estado: 'sugerida' as const, descricao: 'Salto.',
    codex: { modelo_id: 'M'.repeat(26), dificuldade_id: 'D'.repeat(26) }, analise: { execucao_id: 'E'.repeat(26), secao_id: 'S'.repeat(26) } };
  render(<LinhaDaDificuldade sinal={sinal} fontes={f} aoMudar={aoMudar} aoErro={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
  expect(screen.getByRole('alertdialog').textContent).toContain('Remover esta dificuldade?');
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover' }));
  await waitFor(() => expect(f.apagarDaAnalise).toHaveBeenCalledWith('E'.repeat(26), 'S'.repeat(26), 'D'.repeat(26)));
  await waitFor(() => expect(aoMudar).toHaveBeenCalled());
});

test('rodapé: as conexões do trecho, Perguntar e Esc fecha', () => {
  const acoes = { remover: vi.fn(), perguntar: vi.fn(), conexoes: vi.fn(), conectar: vi.fn() };
  const fechar = vi.fn();
  render(comModos(<BalaoDaMarca marca={daIa} acoes={acoes} aoFechar={fechar} fontes={fontes()} conexoes={2} />));
  fireEvent.click(screen.getByRole('button', { name: /2 conexões/ }));
  expect(acoes.conexoes).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }));
  expect(acoes.perguntar).toHaveBeenCalledOnce();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(fechar).toHaveBeenCalledOnce();
});

test('posiciona-se acima do grifo quando cabe', () => {
  render(comModos(<BalaoDaMarca marca={daIa} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={fontes()} />));
  const balao = screen.getByRole('dialog');
  expect(balao.style.left).toBe('120px');
  expect(Number.parseFloat(balao.style.top)).toBeLessThan(600);
});
