import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { AncoraV1, EtiquetaV1, Id, MarcaV2 } from '@margem/contratos';
import { ReaderController, type EdicaoDoLeitor } from './ReaderController';
import { EVENTO_DESFAZER_DO_MENU, ehDesfazerDoSistema, ligarDesfazerDoMenu, usePilhaDeDesfazer } from './desfazer';
import type { MarcaDoLeitor } from './f2';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import { blocosNavegaveis } from './teclado/comandos';

const DOCUMENTO = '0'.repeat(22) + 'D001';
beforeEach(() => { vi.stubGlobal('innerWidth', 1440); vi.stubGlobal('scrollBy', () => undefined); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); delete (window as { margemDesktop?: unknown }).margemDesktop; });

function grifoDe(ancora: AncoraV1, id: Id): MarcaDoLeitor {
  const marca: MarcaV2 = { id, ancora, subfaixas: [{ inicio_utf16: ancora.inicio_utf16, fim_utf16: ancora.fim_utf16 }], origem: 'manual', validade: 'resolvida', visivel: true,
    avaliacao: 'confirmada', criada_em: '2026-09-27T12:00:00Z', funcao: 'nenhuma', saliencia: 2, comentario: null, camada_id: 'C'.repeat(26), modo: { id: 'metodo-f1', revisao: 1 } };
  return marca;
}
function edicaoFalsa(): EdicaoDoLeitor & { criados: AncoraV1[]; apagados: Id[] } {
  const criados: AncoraV1[] = []; const apagados: Id[] = [];
  return {
    criados, apagados,
    criarGrifo: (ancora) => { criados.push(ancora); return Promise.resolve(grifoDe(ancora, `G${String(criados.length).padStart(25, '0')}`)); },
    apagarGrifo: (id) => { apagados.push(id); return Promise.resolve(); },
    trocarFuncao: (id) => Promise.resolve(grifoDe(criados[0]!, id)),
  };
}

test('U-06: a ação só sai da pilha depois do sucesso; uma falha deixa tentar de novo a mesma ação', async () => {
  const { result } = renderHook(() => usePilhaDeDesfazer());
  const desfazer = vi.fn().mockRejectedValueOnce(new Error('serviço reiniciando')).mockResolvedValueOnce(undefined);
  act(() => { result.current.registrar({ rotulo: 'Grifo apagado', desfazer }); });
  await act(async () => { await expect(result.current.desfazer()).rejects.toThrow('serviço reiniciando'); });
  expect(result.current.tamanho).toBe(1);
  expect(result.current.desfazendo).toBe(false);
  await act(async () => { expect(await result.current.desfazer()).toBe('Grifo apagado'); });
  expect(desfazer).toHaveBeenCalledTimes(2);
  expect(result.current.tamanho).toBe(0);
});

test('U-06: dois pedidos seguidos não desfazem duas vezes; o segundo espera o primeiro terminar', async () => {
  const { result } = renderHook(() => usePilhaDeDesfazer());
  let terminar: () => void = () => undefined;
  const lenta = vi.fn(() => new Promise<void>((resolver) => { terminar = resolver; }));
  const anterior = vi.fn();
  act(() => { result.current.registrar({ rotulo: 'Grifo criado', desfazer: anterior }); result.current.registrar({ rotulo: 'Grifo apagado', desfazer: lenta }); });
  let primeiro: Promise<string | null> = Promise.resolve(null);
  act(() => { primeiro = result.current.desfazer(); });
  expect(result.current.desfazendo).toBe(true);
  await act(async () => { expect(await result.current.desfazer()).toBeNull(); });
  expect(lenta).toHaveBeenCalledTimes(1);
  expect(anterior).not.toHaveBeenCalled();
  await act(async () => { terminar(); expect(await primeiro).toBe('Grifo apagado'); });
  expect(result.current.tamanho).toBe(1);
});

test('U-05: Ctrl Z e ⌘ Z, sem Shift nem Alt, são o desfazer', () => {
  const base = { key: 'z', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  expect(ehDesfazerDoSistema({ ...base, ctrlKey: true })).toBe(true);
  expect(ehDesfazerDoSistema({ ...base, metaKey: true, key: 'Z' })).toBe(true);
  expect(ehDesfazerDoSistema({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
  expect(ehDesfazerDoSistema({ ...base, ctrlKey: true, altKey: true })).toBe(false);
  expect(ehDesfazerDoSistema(base)).toBe(false);
});

test('U-05: Ctrl Z fora dos campos desfaz o grifo; num campo fica o desfazer do campo', async () => {
  const edicao = edicaoFalsa();
  render(<><textarea aria-label="nota" /><ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} edicao={edicao} /></>);
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'h' });
  await waitFor(() => expect(edicao.criados).toHaveLength(1));
  // No campo: o leitor não mexe (nem impede o desfazer nativo).
  const campo = screen.getByLabelText('nota');
  const noCampo = fireEvent.keyDown(campo, { key: 'z', ctrlKey: true });
  expect(noCampo).toBe(true);
  expect(edicao.apagados).toHaveLength(0);
  // Fora: Ctrl Z (e ⌘ Z no Mac) é a pilha do leitor.
  const fora = fireEvent.keyDown(window, { key: 'z', metaKey: true });
  expect(fora).toBe(false);
  await waitFor(() => expect(edicao.apagados).toEqual(['G0000000000000000000000001']));
  expect(await screen.findByText(/Desfeito: grifo criado/)).toBeDefined();
});

test('U-05: com os atalhos de uma tecla desligados, Ctrl Z continua desfazendo (e Z não)', async () => {
  const edicao = edicaoFalsa();
  render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} edicao={edicao} />);
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'h' });
  await waitFor(() => expect(edicao.criados).toHaveLength(1));
  document.documentElement.dataset['atalhos'] = 'desligados';
  try {
    fireEvent.keyDown(window, { key: 'z' });
    expect(edicao.apagados).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(edicao.apagados).toHaveLength(1));
  } finally { delete document.documentElement.dataset['atalhos']; }
});

test('U-06/I-10: restauração que falhou no meio não recria o grifo na nova tentativa', async () => {
  const [bloco] = blocosNavegaveis(capituloExemplo.blocos);
  const ancora: AncoraV1 = { versao_id: capituloExemplo.versao_id, bloco_id: bloco!.id, inicio_utf16: 0, fim_utf16: bloco!.texto.length, citacao: bloco!.texto, prefixo: '', sufixo: '' };
  const meu = grifoDe(ancora, 'G'.repeat(26));
  const etiqueta: EtiquetaV1 = { versao: 1, id: 'E'.repeat(26), versao_id: capituloExemplo.versao_id, alvo: { tipo: 'marca', id: meu.id }, nome: 'rever', criada_em: '2026-09-27T12:00:00Z' };
  const edicao = edicaoFalsa();
  const etiquetar = vi.fn().mockRejectedValueOnce(new Error('O serviço não respondeu.')).mockResolvedValue(undefined);
  edicao.etiquetar = etiquetar;
  render(<ReaderController snapshot={{ ...capituloExemplo, marcas: [...capituloExemplo.marcas, meu], etiquetas: [etiqueta] }} documento_id={DOCUMENTO} edicao={edicao} />);
  // H no parágrafo do grifo apaga o grifo (sem nota, sem confirmação).
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'h' });
  await waitFor(() => expect(edicao.apagados).toEqual([meu.id]));
  await screen.findByText('Grifo apagado');
  // 1ª tentativa: o grifo volta, a etiqueta falha; a ação continua na pilha.
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  expect(await screen.findByText('O serviço não respondeu.')).toBeDefined();
  expect(edicao.criados).toHaveLength(1);
  // 2ª tentativa: só a etiqueta que faltava; nenhum grifo novo.
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  await waitFor(() => expect(etiquetar).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(/Desfeito: grifo apagado/)).toBeDefined();
  expect(edicao.criados).toHaveLength(1);
  expect(etiquetar).toHaveBeenLastCalledWith('G0000000000000000000000001', 'rever');
});

test('U-05: Editar → Desfazer do app chega ao leitor fora dos campos e desfaz a digitação num campo', () => {
  let ouvir: () => void = () => undefined;
  const parar = vi.fn();
  (window as { margemDesktop?: unknown }).margemDesktop = { janela: { aoDesfazer: (funcao: () => void) => { ouvir = funcao; return parar; } } };
  const execCommand = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
  const aoEvento = vi.fn();
  window.addEventListener(EVENTO_DESFAZER_DO_MENU, aoEvento);
  const desligar = ligarDesfazerDoMenu();
  try {
    ouvir();
    expect(aoEvento).toHaveBeenCalledTimes(1);
    expect(execCommand).not.toHaveBeenCalled();
    const campo = document.createElement('input');
    document.body.append(campo); campo.focus();
    ouvir();
    expect(execCommand).toHaveBeenCalledWith('undo');
    expect(aoEvento).toHaveBeenCalledTimes(1);
    campo.remove();
  } finally {
    window.removeEventListener(EVENTO_DESFAZER_DO_MENU, aoEvento);
    desligar();
  }
  expect(parar).toHaveBeenCalled();
  // No navegador (sem a ponte), nada a ligar.
  delete (window as { margemDesktop?: unknown }).margemDesktop;
  expect(ligarDesfazerDoMenu()).toBeTypeOf('function');
});

test('U-05: o evento do menu desfaz pela pilha do leitor aberto', async () => {
  const edicao = edicaoFalsa();
  render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} edicao={edicao} />);
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'h' });
  await waitFor(() => expect(edicao.criados).toHaveLength(1));
  act(() => { window.dispatchEvent(new Event(EVENTO_DESFAZER_DO_MENU)); });
  await waitFor(() => expect(edicao.apagados).toHaveLength(1));
});
