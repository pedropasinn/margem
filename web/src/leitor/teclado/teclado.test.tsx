import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AncoraV1, AnotacaoV1, Id, MarcaV2 } from '@margem/contratos';
import { ReaderController, type EdicaoDoLeitor } from '../ReaderController';
import { ContextoDeAparencia } from '../ContextoDeAparencia';
import { NotasDoGrifo, type FontesDasNotas } from '../NotasDoGrifo';
import type { MarcaDoLeitor } from '../f2';
import { capituloExemplo } from '../fixtures/capitulo-exemplo';
import { blocosNavegaveis, filtrarComandos, vizinho, type Comando } from './comandos';

const DOCUMENTO = '0'.repeat(22) + 'D001';
beforeEach(() => { vi.stubGlobal('innerWidth', 1440); vi.stubGlobal('scrollBy', () => undefined); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

function grifoDe(ancora: AncoraV1, id: Id, funcao = 'nenhuma'): MarcaV2 {
  return { id, ancora, subfaixas: [{ inicio_utf16: ancora.inicio_utf16, fim_utf16: ancora.fim_utf16 }], origem: 'manual', validade: 'resolvida', visivel: true,
    avaliacao: 'confirmada', criada_em: '2026-09-27T12:00:00Z', funcao, saliencia: 2, comentario: null, camada_id: 'C'.repeat(26), modo: { id: 'metodo-f1', revisao: 1 } };
}
function edicaoFalsa(): EdicaoDoLeitor & { criados: AncoraV1[]; apagados: Id[]; funcoes: string[] } {
  const criados: AncoraV1[] = []; const apagados: Id[] = []; const funcoes: string[] = [];
  return {
    criados, apagados, funcoes,
    criarGrifo: (ancora, funcao) => { criados.push(ancora); return Promise.resolve(grifoDe(ancora, `G${String(criados.length).padStart(25, '0')}`, funcao) as MarcaDoLeitor); },
    apagarGrifo: (id) => { apagados.push(id); return Promise.resolve(); },
    trocarFuncao: (id, funcao) => { funcoes.push(funcao); return Promise.resolve({ ...grifoDe(criados[0]!, id), funcao } as MarcaDoLeitor); },
  };
}

test('comandos: busca sem acento por todas as palavras; vizinho e blocos navegáveis', () => {
  const comandos: Comando[] = [
    { id: 'a', grupo: 'Visual', rotulo: 'Tema: Sépia', palavras: 'aparência', executar: vi.fn() },
    { id: 'b', grupo: 'Marcas', rotulo: 'Grifar o parágrafo', executar: vi.fn() },
  ];
  expect(filtrarComandos(comandos, 'sepia').map((c) => c.id)).toEqual(['a']);
  expect(filtrarComandos(comandos, 'aparencia tema').map((c) => c.id)).toEqual(['a']);
  expect(filtrarComandos(comandos, 'paragrafo marcas').map((c) => c.id)).toEqual(['b']);
  expect(filtrarComandos(comandos, '  ')).toHaveLength(2);
  expect(vizinho(['x', 'y', 'z'], null, 1)).toBe('x');
  expect(vizinho(['x', 'y', 'z'], null, -1)).toBe('z');
  expect(vizinho(['x', 'y', 'z'], 'y', 1)).toBe('z');
  expect(vizinho(['x', 'y', 'z'], 'z', 1)).toBeNull();
  expect(blocosNavegaveis(capituloExemplo.blocos).every((bloco) => bloco.tipo !== 'capitulo' && bloco.tipo !== 'secao')).toBe(true);
});

test('↓ foca o primeiro parágrafo; H grifa e abre o balão com as cores, H de novo apaga; Z desfaz em sequência', async () => {
  const edicao = edicaoFalsa();
  const mudou = vi.fn();
  const { container } = render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} edicao={edicao} aoMudarMarcas={mudou} />);
  const [primeiro, segundo] = blocosNavegaveis(capituloExemplo.blocos);
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  fireEvent.keyDown(window, { key: 'h' });
  await waitFor(() => expect(edicao.criados).toHaveLength(1));
  expect(edicao.criados[0]).toMatchObject({ bloco_id: primeiro!.id, inicio_utf16: 0, fim_utf16: primeiro!.texto.length, citacao: primeiro!.texto });
  expect(segundo).toBeDefined();
  // O grifo novo do H abre o balão, sem abrir as etiquetas sozinho.
  // (Sem geometria no jsdom o balão fica invisível; a busca é pelo DOM.)
  await waitFor(() => expect(document.querySelector('.balao-da-marca')).not.toBeNull());
  expect(screen.queryByText(/Etiqueta livre/)).toBeNull();
  expect(screen.getByText(/Grifo criado/)).toBeDefined();
  expect(container.querySelector('span[data-marcas~="G0000000000000000000000001"]')).not.toBeNull();
  // Esc fecha o balão (não há painel aberto); H de novo no mesmo parágrafo apaga o grifo.
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.keyDown(window, { key: 'h' });
  await waitFor(() => expect(edicao.apagados).toEqual(['G0000000000000000000000001']));
  expect(await screen.findByText('Grifo apagado')).toBeDefined();
  // Z desfaz o apagar (recria) e, de novo, o criar (apaga o recriado, pelo id novo).
  fireEvent.keyDown(window, { key: 'z' });
  await waitFor(() => expect(edicao.criados).toHaveLength(2));
  fireEvent.keyDown(window, { key: 'z' });
  await waitFor(() => expect(edicao.apagados).toEqual(['G0000000000000000000000001', 'G0000000000000000000000002']));
  expect(await screen.findByText(/Desfeito: grifo criado/)).toBeDefined();
  expect(screen.queryByRole('button', { name: /Desfazer/ })).toBeNull();
  expect(mudou).toHaveBeenCalled();
});

test('N grifa e abre o balão do grifo com o cursor na nota; a seleção vem antes do parágrafo', async () => {
  const edicao = edicaoFalsa();
  const [bloco] = blocosNavegaveis(capituloExemplo.blocos);
  const selecionada: AncoraV1 = { versao_id: capituloExemplo.versao_id, bloco_id: bloco!.id, inicio_utf16: 0, fim_utf16: 5, citacao: bloco!.texto.slice(0, 5), prefixo: '', sufixo: bloco!.texto.slice(5) };
  render(<ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} edicao={edicao} selecaoAtual={() => selecionada}
    acoesDoBalao={{ perguntar: vi.fn(), conectar: vi.fn() }} />);
  fireEvent.keyDown(window, { key: 'n' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Sua anotação' })));
  expect(edicao.criados).toEqual([selecionada]);
});

test('sem parágrafo em foco nem seleção, H explica; digitando num campo, as letras não são atalhos', async () => {
  const edicao = edicaoFalsa();
  render(<><input aria-label="campo" /><ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO} edicao={edicao} /></>);
  fireEvent.keyDown(screen.getByLabelText('campo'), { key: 'h' });
  expect(edicao.criados).toHaveLength(0);
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.keyDown(window, { key: 'h' });
  expect(await screen.findByText(/Escolha um parágrafo/)).toBeDefined();
});

test('[ esconde as braquetes (sem sumário), ] abre o painel do documento, M recolhe a margem; ? lista os atalhos; Ctrl+K abre a paleta e executa', async () => {
  const extra = vi.fn();
  const { container } = render(<ContextoDeAparencia><ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO}
    comandos={[{ id: 'mapa', grupo: 'Estudo', rotulo: 'Mapa do capítulo', executar: extra }]} /></ContextoDeAparencia>);
  const raiz = container.querySelector<HTMLElement>('.leitor-controlado')!;
  fireEvent.keyDown(window, { key: '[' });
  expect(raiz.dataset['lateralEsquerda']).toBe('oculta');
  fireEvent.keyDown(window, { key: '[' });
  expect(raiz.dataset['lateralEsquerda']).toBeUndefined();
  const margem = raiz.dataset['margem'];
  fireEvent.keyDown(window, { key: ']' });
  expect(screen.getByRole('complementary', { name: 'Painel do documento' })).toBeTruthy();
  expect(raiz.dataset['margem']).toBe(margem);
  fireEvent.keyDown(window, { key: ']' });
  expect(screen.queryByRole('complementary', { name: 'Painel do documento' })).toBeNull();
  // A margem de notas ficou com M (o `]` é do painel).
  fireEvent.keyDown(window, { key: 'm' });
  await waitFor(() => expect(raiz.dataset['margem']).not.toBe(margem));
  fireEvent.keyDown(window, { key: 'm' });
  await waitFor(() => expect(raiz.dataset['margem']).toBe(margem));
  // E continua disponível na paleta.
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: margem === 'mostrar' ? 'Recolher as notas' : 'Abrir as notas' } });
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  await waitFor(() => expect(raiz.dataset['margem']).not.toBe(margem));

  fireEvent.keyDown(window, { key: '?' });
  expect(screen.getByRole('dialog', { name: 'Atalhos de teclado' }).textContent).toContain('Grifar com nota (abre a nota do grifo)');
  const ajuda = screen.getByRole('dialog', { name: 'Atalhos de teclado' });
  expect(ajuda.querySelectorAll('.grupo-de-atalhos h3').length).toBe(8);
  expect(screen.getByText('Painel do documento (Info, Caderno, Estudo, Conversas)').nextElementSibling?.textContent).toBe(']');
  expect(screen.getByText('Recolher as notas em números na margem, ou abri-las').nextElementSibling?.textContent).toBe('M');
  expect(screen.getByText('Sumário (painel esquerdo); sem sumário, esconde ou mostra as braquetes').nextElementSibling?.textContent).toBe('[');
  expect(screen.getByText('Ir para a página (PDF) ou o capítulo').nextElementSibling?.textContent).toBe('ShiftJ');
  // Com a lista aberta, as teclas são dela.
  fireEvent.keyDown(window, { key: '[' });
  expect(raiz.dataset['lateralEsquerda']).toBeUndefined();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const busca = screen.getByRole('combobox');
  fireEvent.change(busca, { target: { value: 'mapa' } });
  expect(screen.getAllByRole('option').map((opcao) => opcao.textContent)).toEqual(['Mapa do capítulo']);
  vi.useFakeTimers();
  fireEvent.keyDown(busca, { key: 'Enter' });
  act(() => { vi.runAllTimers(); });
  vi.useRealTimers();
  expect(extra).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
  // A paleta também tem os comandos do próprio leitor.
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tema escuro' } });
  expect(screen.getAllByRole('option').map((opcao) => opcao.textContent)).toEqual(['Tema: Escuro']);
});

test('nota do grifo no painel do trecho: uma só, sem tipo; o comentário do Codex editável e com volta; o pedido de revisão e o motivo dele', async () => {
  const ancora: AncoraV1 = { versao_id: capituloExemplo.versao_id, bloco_id: 'B'.repeat(26), inicio_utf16: 0, fim_utf16: 4, citacao: 'Tudo', prefixo: '', sufixo: '' };
  const marca = { ...grifoDe(ancora, 'M'.repeat(26), 'tese'), origem: 'modelo', comentario: { tipo: 'LEITURA', rotulo: 'Tese', texto: 'Texto que eu reescrevi.' } } as unknown as MarcaDoLeitor;
  const minha: AnotacaoV1 = { versao: 1, revisao_edicao: 1, id: 'A'.repeat(26), versao_id: ancora.versao_id, ancora, tipo: 'nota', texto: 'Isto vale sempre?', marca_id: marca.id,
    criada_em: '2026-09-27T12:00:00.000Z', atualizada_em: '2026-09-27T12:05:00.000Z',
    revisao: { autor: 'codex', texto_anterior: 'vale sempre?', motivo: 'Formulei a pergunta inteira.', em: '2026-09-27T12:05:00.000Z' } };
  const chamadas: string[] = [];
  const fontes: FontesDasNotas = {
    gravarNota: () => Promise.reject(new Error('não usado')), apagarNota: () => Promise.resolve({}),
    editarNotaDaMarca: (id, texto) => { chamadas.push(`nota ${id.slice(0, 1)} ${String(texto)}`); return Promise.resolve({}); },
    editarAnotacao: (_id, mudanca) => { chamadas.push(`anotacao ${mudanca.texto}`); return Promise.resolve({}); },
    pedirRevisao: (_id, instrucao) => { chamadas.push(`revisar ${String(instrucao)}`); return Promise.resolve({}); },
  };
  const mudou = vi.fn();
  render(<NotasDoGrifo marca={marca} nota={minha} pendente={false} aoMudar={mudou} fontes={fontes}
    comentarioDaIa={{ tipo: 'LEITURA', rotulo: 'Tese', texto: 'O que a IA escreveu.' }} />);
  expect(screen.getByRole('textbox', { name: 'Sua anotação' })).toHaveProperty('value', 'Isto vale sempre?');
  expect(screen.queryByText(/Dúvida/)).toBeNull();
  expect(screen.getByText(/Assistente · Tese/)).toBeDefined();
  expect(screen.getByText(/editado por você/)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar ao original' }));
  await waitFor(() => expect(chamadas).toEqual(['nota M null']));
  expect(screen.getByText('Formulei a pergunta inteira.')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar ao meu texto' }));
  await waitFor(() => expect(chamadas).toContain('anotacao vale sempre?'));
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ao Codex que revise' }));
  fireEvent.change(screen.getByLabelText(/O que pedir ao Codex/), { target: { value: 'mais curta' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pedir revisão' }));
  await waitFor(() => expect(chamadas).toContain('revisar mais curta'));
  expect(mudou).toHaveBeenCalledTimes(3);
  cleanup();
  // Pendente: avisa e não deixa pedir de novo.
  render(<NotasDoGrifo marca={marca} nota={minha} pendente aoMudar={mudou} fontes={fontes} />);
  expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('O Codex está revisando'))).toBe(true);
  expect(screen.getByRole('button', { name: 'Pedir ao Codex que revise' }).hasAttribute('disabled')).toBe(true);
});
