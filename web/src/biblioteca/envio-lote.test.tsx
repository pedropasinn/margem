import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Adicionar } from './Adicionar';
import { App } from './App';
import { escolherOpcao } from '../../tests/apoio-react';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
const arquivo = (nome: string) => new File(['conteúdo'], nome);
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
const fila = () => within(screen.getByRole('list', { name: 'Fila' }));
const preparando = () => Promise.resolve({ id: 'x', versao_id: null, estado: 'canonizando' as const, detalhe: null, formato: 'txt', texto_disponivel: false });

test('lote envia um por vez, continua após recusas da API e não repete', async () => {
  let concluir!: (resposta: Response) => void;
  const pedidos: FormData[] = [];
  const fetch = vi.fn((url: string, inicio?: RequestInit) => {
    if (inicio?.method !== 'POST') return Promise.resolve(json({ id: 'x', versao_id: null, estado: 'canonizando' }));
    pedidos.push(inicio.body as FormData);
    if (pedidos.length === 1) return new Promise<Response>((resolver) => { concluir = resolver; });
    if (pedidos.length === 2) return Promise.resolve(json({ erro: 'duplicado', detalhe: 'Documento já existe.' }, 409));
    if (pedidos.length === 3) return Promise.resolve(json({ erro: 'formato_nao_suportado', detalhe: 'Formato não aceito.' }, 400));
    return Promise.resolve(json({ documento_id: 'ultimo', job_id: 'job' }));
  });
  vi.stubGlobal('fetch', fetch);
  render(<Adicionar ir={vi.fn()} />);
  const seletor = screen.getByLabelText('Arquivo');
  expect(seletor.hasAttribute('multiple')).toBe(true);
  fireEvent.change(seletor, { target: { files: [arquivo('um_livro.pdf'), arquivo('dois.md'), arquivo('tres.epub'), arquivo('quatro.MARKDOWN')] } });
  fireEvent.click(screen.getByRole('button', { name: /Mais opções.*quatro.MARKDOWN/ }));
  escolherOpcao('Tipo do texto', 'Poesia');
  fireEvent.change(screen.getByLabelText('Autor'), { target: { value: 'Autora' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 4 arquivos' }));
  const postados = () => fetch.mock.calls.filter(([, inicio]) => inicio?.method === 'POST').length;
  expect(postados()).toBe(1);
  expect(fila().getByText('Enviando…')).toBeDefined();
  expect(fila().getAllByText('Aguardando')).toHaveLength(3);
  // Um arquivo novo no meio do envio entra na fila, mas só vai quando a pessoa pedir.
  fireEvent.drop(document.querySelector('.dropzone')!, { dataTransfer: { files: [arquivo('intruso.txt')] } });
  await act(async () => { concluir(json({ documento_id: 'primeiro', job_id: 'job' })); await Promise.resolve(); });
  await waitFor(() => expect(postados()).toBe(4));
  expect(fila().getByText('Recusado: Documento já existe.')).toBeDefined();
  expect(fila().getByText('Recusado: Formato não aceito.')).toBeDefined();
  expect(fila().getAllByText('Preparando o texto…')).toHaveLength(2);
  expect(fila().getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/documentos/primeiro', '/documentos/ultimo']);
  // PDF e EPUB vão sem título, e o serviço usa o dos metadados (ou o nome do arquivo).
  expect(pedidos.map((dados) => dados.get('titulo'))).toEqual(['', 'dois', '', 'quatro']);
  expect(pedidos.map((dados) => dados.get('formato'))).toEqual(['pdf', 'md', 'epub', 'md']);
  expect(pedidos.map((dados) => (dados.get('arquivo') as File).name)).toEqual(['um_livro.pdf', 'dois.md', 'tres.epub', 'quatro.MARKDOWN']);
  expect(pedidos.map((dados) => dados.get('autor'))).toEqual([null, null, null, 'Autora']);
  expect(pedidos.map((dados) => dados.has('poesia'))).toEqual([false, false, false, true]);
  expect(fila().getByText('intruso.txt')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Adicionar 1 arquivo' })).toBeDefined();
});

test('uma falha de rede não para a fila', async () => {
  const enviar = vi.fn().mockRejectedValueOnce(new Error('Sem conexão')).mockResolvedValue({ documento_id: 'doc', job_id: 'job' });
  render(<Adicionar ir={vi.fn()} enviar={enviar} servicos={{ obterDocumento: preparando, intervalo: 60_000 }} />);
  fireEvent.drop(document.querySelector('.dropzone')!, { dataTransfer: { files: [arquivo('um.txt'), arquivo('dois.txt')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 2 arquivos' }));
  expect(await screen.findByText('Recusado: Sem conexão')).toBeDefined();
  expect(await screen.findByRole('link', { name: /Abrir.*dois.txt/ })).toBeDefined();
  expect(enviar).toHaveBeenCalledTimes(2);
});

test.each(['/', '/biblioteca'])('soltar na casca em %s abre a fila com todos os arquivos, sem enviar', async (caminho) => {
  window.history.replaceState(null, '', caminho);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ documentos: [] }))));
  const { container } = render(<App />);
  await screen.findByText('Nenhum texto ainda.');
  const casca = container.querySelector('.app-shell')!;
  expect(fireEvent.dragOver(casca, { dataTransfer: { types: ['Files'] } })).toBe(false);
  fireEvent.drop(casca, { dataTransfer: { files: [arquivo('um.pdf'), arquivo('dois.md')] } });
  expect(window.location.pathname).toBe('/adicionar');
  expect(screen.getByRole('heading', { name: 'Adicionar à biblioteca' })).toBeDefined();
  expect(fila().getByText('um.pdf')).toBeDefined();
  expect(fila().getByText('dois.md')).toBeDefined();
  expect(vi.mocked(fetch).mock.calls.every(([, inicio]) => inicio?.method !== 'POST')).toBe(true);
});

test('sair da tela no meio encerra o lote e o anúncio acompanha o progresso', async () => {
  let concluir!: (valor: { documento_id: string; job_id: string }) => void;
  const enviar = vi.fn(() => new Promise<{ documento_id: string; job_id: string }>((resolver) => { concluir = resolver; }));
  const { unmount } = render(<Adicionar ir={vi.fn()} enviar={enviar} />);
  fireEvent.drop(document.querySelector('.dropzone')!, { dataTransfer: { files: [arquivo('um.txt'), arquivo('dois.txt'), arquivo('tres.txt')] } });
  expect(screen.getByRole('status').textContent).toBe('3 itens entraram na fila.');
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 3 arquivos' }));
  expect(screen.getByRole('status').textContent).toBe('Enviando um.txt (2 depois deste).');
  unmount();
  await act(async () => { concluir({ documento_id: 'doc', job_id: 'job' }); await Promise.resolve(); });
  expect(enviar).toHaveBeenCalledTimes(1);
});

test('413 do proxy em HTML vira recusa legível', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>grande</html>', { status: 413, statusText: 'Payload Too Large' }))));
  render(<Adicionar ir={vi.fn()} />);
  fireEvent.drop(document.querySelector('.dropzone')!, { dataTransfer: { files: [arquivo('um.pdf'), arquivo('dois.pdf')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 2 arquivos' }));
  await waitFor(() => expect(screen.getAllByText('Recusado: Grande demais para esta instalação.')).toHaveLength(2));
  expect(screen.getByRole('status').textContent).toBe('Envio concluído: 0 enviados, 2 recusados.');
});

test('soltar fora da área em Adicionar não deixa o navegador abrir o arquivo', () => {
  window.history.replaceState(null, '', '/adicionar');
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ documentos: [] }))));
  const { container } = render(<App />);
  expect(fireEvent.drop(container.querySelector('.app-shell')!, { dataTransfer: { files: [arquivo('um.pdf')] } })).toBe(false);
  expect(screen.queryByRole('list', { name: 'Fila' })).toBeNull();
});
