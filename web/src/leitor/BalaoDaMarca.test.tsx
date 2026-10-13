import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EtiquetaV1 } from '@margem/contratos';
import { ContextoDeDesfazer, type PilhaDeDesfazer } from './desfazer';
import { BalaoDaMarca, type FontesDasEtiquetas } from './BalaoDaMarca';
import type { MarcaDoLeitor } from './f2';
import { capituloExemplo } from './fixtures/capitulo-exemplo';

const marca = capituloExemplo.marcas[0] as MarcaDoLeitor;
// O desenho da marca na página, com uma caixa de verdade: é por ele que o balão se posiciona.
beforeEach(() => {
  document.body.insertAdjacentHTML('beforeend', `<svg id="desenho"><g data-desenho="${marca.id}"><path d="M0 0"></path></g></svg>`);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 300, 200, 20));
});
afterEach(() => { cleanup(); document.getElementById('desenho')?.remove(); vi.restoreAllMocks(); });

function fontes(inicial: EtiquetaV1[] = []): FontesDasEtiquetas & { criadas: string[]; apagadas: string[] } {
  const criadas: string[] = []; const apagadas: string[] = [];
  return {
    criadas, apagadas,
    listar: () => Promise.resolve({ etiquetas: inicial, sugestoes: [] }),
    criar: (versaoId, alvo, nome) => { criadas.push(nome); return Promise.resolve({ etiqueta: { versao: 1, id: `E${String(criadas.length).padStart(25, '0')}`, versao_id: versaoId, alvo, nome, criada_em: '2026-09-27T12:00:00.000Z' } }); },
    apagar: (id) => { apagadas.push(id); return Promise.resolve({}); },
  };
}

test('quatro botões: remover, anotar, etiquetas e mais; as ações de fora são chamadas', () => {
  const acoes = { remover: vi.fn(), anotar: vi.fn(), perguntar: vi.fn(), conectar: vi.fn(), verNota: vi.fn() };
  render(<BalaoDaMarca marca={marca} versaoId={capituloExemplo.versao_id} acoes={acoes} aoFechar={vi.fn()} fontes={fontes()} />);
  expect(screen.getAllByRole('button').map((botao) => botao.getAttribute('aria-label'))).toEqual(['Remover marca', 'Anotar', 'Etiquetas', 'Mais opções']);
  fireEvent.click(screen.getByRole('button', { name: 'Remover marca' }));
  expect(acoes.remover).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Copiar textoCtrl C', 'Perguntar sobre istoP', 'Conectar a outro trecho', 'Ver a nota da marca']);
  fireEvent.click(screen.getByRole('menuitem', { name: /Perguntar/ }));
  expect(acoes.perguntar).toHaveBeenCalledOnce();
  // Atalhos: N anota; Esc fecha.
  fireEvent.keyDown(window, { key: 'n' });
  expect(acoes.anotar).toHaveBeenCalledOnce();
});

test('sem as ações do estudo, só remover, etiquetas e mais', () => {
  render(<BalaoDaMarca marca={marca} versaoId={capituloExemplo.versao_id} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={fontes()} />);
  expect(screen.getAllByRole('button').map((botao) => botao.getAttribute('aria-label'))).toEqual(['Remover marca', 'Etiquetas', 'Mais opções']);
});

test('etiquetas: a função é uma só (trocar guarda a da IA), as dificuldades "?" são várias; tudo entra na pilha de desfazer', async () => {
  const existente: EtiquetaV1 = { versao: 1, id: 'X'.repeat(26), versao_id: capituloExemplo.versao_id, alvo: { tipo: 'marca', id: marca.id }, nome: 'ambiguidade', criada_em: '2026-09-27T12:00:00.000Z' };
  const outra: EtiquetaV1 = { ...existente, id: 'Y'.repeat(26), alvo: { tipo: 'marca', id: 'outra' }, nome: 'sintaxe_complexa' };
  const f = fontes([existente, outra]);
  const fechar = vi.fn();
  const trocar = vi.fn(() => Promise.resolve());
  const registradas: string[] = [];
  const pilha: PilhaDeDesfazer = { registrar: (acao) => registradas.push(acao.rotulo), desfazer: () => Promise.resolve(null), aviso: null, desfazivel: false, avisar: vi.fn(), dispensar: vi.fn(), tamanho: 0 };
  render(<ContextoDeDesfazer.Provider value={pilha}>
    <BalaoDaMarca marca={{ ...marca, funcao: 'conceito' }} versaoId={capituloExemplo.versao_id} acoes={{ remover: vi.fn() }} aoFechar={fechar} fontes={f} funcao={{ trocar, daIa: 'tese' }} />
  </ContextoDeDesfazer.Provider>);
  fireEvent.keyDown(window, { key: 't' });
  // Função: as três do método e "Nenhuma"; a atual marcada; a da IA lembrada, com volta.
  const radios = screen.getAllByRole('radio');
  expect(radios.map((radio) => radio.textContent)).toEqual(['Tese', 'Conceito', 'Justificativa', 'Nenhuma']);
  expect(screen.getByRole('radio', { name: 'Conceito' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText(/A IA marcou como tese/)).toBeDefined();
  fireEvent.click(screen.getByRole('radio', { name: 'Justificativa' }));
  expect(trocar).toHaveBeenLastCalledWith('justificativa');
  fireEvent.keyDown(window, { key: '4' });
  expect(trocar).toHaveBeenLastCalledWith('nenhuma');
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
  expect(trocar).toHaveBeenLastCalledWith('tese');
  // Dificuldades: as sete; só a desta marca vem ligada.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ambiguidade' }).getAttribute('aria-pressed')).toBe('true'));
  expect(screen.getAllByRole('button', { pressed: false }).map((botao) => botao.textContent)).toContain('Sintaxe complexa');
  fireEvent.click(screen.getByRole('button', { name: 'Salto no argumento' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Salto no argumento' }).getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: 'Ambiguidade' }));
  await waitFor(() => expect(f.apagadas).toEqual([existente.id]));
  expect(f.criadas).toEqual(['salto_argumentativo']);
  expect(registradas).toEqual(['Etiqueta “Salto no argumento”', 'Etiqueta “Ambiguidade” retirada']);
  // Esc fecha primeiro o painel, depois o balão.
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('radiogroup')).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(fechar).toHaveBeenCalledOnce();
});

test('o grifo do leitor: apagar em vez de remover; sem edição, a função não se troca', () => {
  render(<BalaoDaMarca marca={{ ...marca, origem: 'manual' }} versaoId={capituloExemplo.versao_id} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={fontes()} painelInicial="etiquetas" />);
  expect(screen.getByRole('button', { name: 'Apagar grifo' })).toBeDefined();
  expect(screen.getByRole('radio', { name: 'Tese' }).hasAttribute('disabled')).toBe(true);
});

test('posiciona-se logo acima da primeira linha do grifo', () => {
  render(<BalaoDaMarca marca={marca} versaoId={capituloExemplo.versao_id} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={fontes()} />);
  const balao = screen.getByRole('toolbar', { name: 'Ações da marca' });
  expect(balao.style.left).toBe('120px');
  expect(balao.style.top).toBe(`${String(300 - 40 - 8)}px`);
});

test('etiqueta livre: sugestões, trim, duplicata sem maiúsculas e remoção', async () => {
  const f = fontes();
  f.listar = () => Promise.resolve({ etiquetas: [], sugestoes: ['Revisar depois'] });
  render(<BalaoDaMarca marca={marca} versaoId={capituloExemplo.versao_id} acoes={{ remover: vi.fn() }} aoFechar={vi.fn()} fontes={f} painelInicial="etiquetas" />);
  const entrada = screen.getByRole('combobox', { name: 'Etiqueta livre' });
  await waitFor(() => expect(entrada.hasAttribute('disabled')).toBe(false));
  expect(document.querySelector('datalist option')?.getAttribute('value')).toBe('Revisar depois');
  fireEvent.change(entrada, { target: { value: '  Revisar depois  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
  await screen.findByRole('button', { name: 'Remover etiqueta Revisar depois' });
  expect(f.criadas).toEqual(['Revisar depois']);
  fireEvent.change(entrada, { target: { value: 'REVISAR DEPOIS' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
  expect(f.criadas).toHaveLength(1);
  fireEvent.change(entrada, { target: { value: 'a'.repeat(41) } });
  expect(screen.getByRole('button', { name: 'Adicionar' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remover etiqueta Revisar depois' }));
  await waitFor(() => expect(f.apagadas).toHaveLength(1));
  expect(screen.queryByRole('button', { name: 'Remover etiqueta Revisar depois' })).toBeNull();
});
