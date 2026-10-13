import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Adicionar } from './Adicionar';
import { ErroDaApi } from './api';
import { lerTextoDoArquivo, type ServicosDaImportacao } from './importacao';
import { escolherOpcao } from '../../tests/apoio-react';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const criado = (documento_id = 'novo') => Promise.resolve({ documento_id, job_id: 'job' });
const pronto = (extra: object = {}) => ({ id: 'doc', versao_id: 'versao', estado: 'pronto' as const, detalhe: null, formato: 'pdf', texto_disponivel: true, ...extra });
const fila = () => within(screen.getByRole('list', { name: 'Fila' }));
const escolher = (arquivos: File[]) => fireEvent.change(screen.getByLabelText('Arquivo'), { target: { files: arquivos } });

function servicos(parciais: Partial<ServicosDaImportacao> = {}): Partial<ServicosDaImportacao> {
  return { intervalo: 0, obterDocumento: vi.fn(() => Promise.resolve(pronto())), ...parciais };
}

test('EPUB entra na fila sem título, vai com formato e MIME, e o texto pronto oferece abrir', async () => {
  const enviarDocumento = vi.fn<ServicosDaImportacao['enviarDocumento']>(() => criado());
  const ir = vi.fn();
  render(<Adicionar ir={ir} servicos={servicos({ enviarDocumento, obterDocumento: vi.fn(() => Promise.resolve(pronto({ formato: 'epub' }))) })} />);
  expect(screen.getByLabelText('Arquivo').getAttribute('accept')).toContain('.epub');
  escolher([new File(['epub'], 'Livro.epub', { type: 'application/epub+zip' })]);
  expect(fila().getByText('Pronto para enviar')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
  await waitFor(() => expect(enviarDocumento).toHaveBeenCalledTimes(1));
  const formulario = enviarDocumento.mock.calls[0]![0];
  expect(formulario.get('formato')).toBe('epub');
  expect(formulario.get('titulo')).toBe('');
  expect((formulario.get('arquivo') as File).type).toBe('application/epub+zip');
  expect(await fila().findByText('Texto pronto. As marcas chegam depois.')).toBeDefined();
  expect(ir).not.toHaveBeenCalled();
  fireEvent.click(fila().getByRole('link', { name: /^Abrir/ }));
  expect(ir).toHaveBeenCalledWith({ nome: 'documento', documento_id: 'novo' });
});

test('duplicado (409) oferece abrir o existente', async () => {
  const enviarDocumento = vi.fn(() => Promise.reject(new ErroDaApi(409, 'documento_duplicado', 'Este texto já está na biblioteca.', { documento_id: 'existente' })));
  const ir = vi.fn();
  render(<Adicionar ir={ir} servicos={servicos({ enviarDocumento })} />);
  escolher([new File(['x'], 'Livro.md')]);
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
  expect(await fila().findByText('Recusado: Já está na biblioteca.')).toBeDefined();
  expect(fila().queryByRole('button', { name: /Tentar de novo/ })).toBeNull();
  fireEvent.click(fila().getByRole('link', { name: /Abrir o existente/ }));
  expect(ir).toHaveBeenCalledWith({ nome: 'documento', documento_id: 'existente' });
});

test('opções do PDF ficam atrás de "Mais opções"; faixa inválida volta com motivo e dá para corrigir', async () => {
  const enviarDocumento = vi.fn<ServicosDaImportacao['enviarDocumento']>(() => criado());
  render(<Adicionar ir={vi.fn()} servicos={servicos({ enviarDocumento })} />);
  escolher([new File(['%PDF-'], 'artigo.pdf', { type: 'application/pdf' })]);
  expect(screen.queryByLabelText('Páginas')).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Tipo do texto' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Mais opções.*artigo.pdf/ }));
  expect(screen.queryByRole('combobox', { name: 'Tipo do texto' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Páginas'), { target: { value: '12 a 25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
  expect(await fila().findByText('Recusado: Páginas: use um intervalo como 12-25.')).toBeDefined();
  expect(enviarDocumento).not.toHaveBeenCalled();
  fireEvent.click(fila().getByRole('button', { name: /Tentar de novo/ }));
  fireEvent.change(screen.getByLabelText('Páginas'), { target: { value: '12-25' } });
  fireEvent.change(fila().getByLabelText('Título'), { target: { value: 'Título escolhido' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
  await waitFor(() => expect(enviarDocumento).toHaveBeenCalledTimes(1));
  const formulario = enviarDocumento.mock.calls[0]![0];
  expect(formulario.get('paginas')).toBe('12-25');
  expect(formulario.get('titulo')).toBe('Título escolhido');
  expect(formulario.has('poesia')).toBe(false);
});

test('PDF escaneado: oferece transcrever as páginas sem texto logo na fila', async () => {
  const transcrever = vi.fn(() => Promise.resolve({ job_id: 'j', paginas: 3 }));
  render(<Adicionar ir={vi.fn()} servicos={servicos({ enviarDocumento: () => criado('pdf1'), transcrever, obterDocumento: vi.fn(() => Promise.resolve(pronto({ paginas_sem_texto: 3 }))) })} />);
  escolher([new File(['%PDF-'], 'escaneado.pdf', { type: 'application/pdf' })]);
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
  expect(await fila().findByText(/3 páginas não têm camada de texto/)).toBeDefined();
  fireEvent.click(fila().getByRole('button', { name: 'Transcrever as páginas' }));
  expect(await fila().findByText(/Transcrevendo 3 páginas por visão/)).toBeDefined();
  expect(transcrever).toHaveBeenCalledWith('pdf1');
});

test('texto que ainda está preparando mostra o estado; falha mostra o motivo', async () => {
  const obterDocumento = vi.fn()
    .mockResolvedValueOnce({ ...pronto(), versao_id: null, estado: 'canonizando' })
    .mockResolvedValue({ ...pronto(), versao_id: null, estado: 'falhou', detalhe: 'motor_falhou' });
  render(<Adicionar ir={vi.fn()} servicos={servicos({ enviarDocumento: () => criado(), obterDocumento })} />);
  escolher([new File(['texto'], 'notas.txt')]);
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
  expect(await fila().findByText('Não foi possível preparar o texto: motor_falhou')).toBeDefined();
  expect(obterDocumento).toHaveBeenCalledTimes(2);
});

const transcricao = JSON.stringify({ versao: 1, titulo: 'Aula 1', canal: 'Canal', url: 'https://exemplo.com/v', motor: 'whisper', idioma: 'pt', capitulos: [{ inicio_s: 0, titulo: 'Início' }],
  paragrafos: ['Bom dia.'], palavras: [{ texto: 'Bom', inicio_s: 0, fim_s: 0.3 }, { texto: 'dia.', inicio_s: 0.3, fim_s: 0.8 }] });

test('vídeo sem transcrição pede o JSON; com ele, envia a mídia, cria o texto e liga os dois', async () => {
  const enviarMidia = vi.fn(() => Promise.resolve({ sha256: 'a'.repeat(64), tipo: 'video' as const }));
  const enviarDocumento = vi.fn<ServicosDaImportacao['enviarDocumento']>(() => criado('video1'));
  const publicarMidia = vi.fn(() => Promise.resolve({}));
  render(<Adicionar ir={vi.fn()} servicos={servicos({ enviarMidia, enviarDocumento, publicarMidia })} />);
  escolher([new File(['mp4'], 'aula.mp4', { type: 'video/mp4' })]);
  expect(fila().getByText('Falta a transcrição')).toBeDefined();
  expect(screen.queryByRole('button', { name: /Adicionar 1 arquivo/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Transcrição de aula.mp4'), { target: { files: [new File([transcricao], 'aula.json', { type: 'application/json' })] } });
  expect(fila().getByText('Pronto para enviar, com aula.json')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
  expect(await fila().findByText('Pronto: texto e vídeo alinhados. As marcas chegam depois.')).toBeDefined();
  expect(enviarMidia).toHaveBeenCalledTimes(1);
  const formulario = enviarDocumento.mock.calls[0]![0];
  expect(formulario.get('formato')).toBe('txt');
  expect(formulario.get('titulo')).toBe('Aula 1');
  expect(formulario.get('autor')).toBe('Canal');
  expect(await lerTextoDoArquivo(formulario.get('arquivo') as File)).toBe('Bom dia.\n');
  expect(publicarMidia).toHaveBeenCalledWith('video1', expect.objectContaining({
    versao_id: 'versao', sha256: 'a'.repeat(64), titulo: 'Aula 1', fonte: { url: 'https://exemplo.com/v', canal: 'Canal' },
    transcricao: { motor: 'whisper', idioma: 'pt', palavras: [{ texto: 'Bom', inicio_s: 0, fim_s: 0.3 }, { texto: 'dia.', inicio_s: 0.3, fim_s: 0.8 }] },
  }));
});

test('soltar vídeo e transcrição juntos já forma o par; transcrição sozinha é recusada com motivo', () => {
  render(<Adicionar ir={vi.fn()} servicos={servicos()} />);
  escolher([new File(['a'], 'palestra.m4a'), new File([transcricao], 'palestra.json'), new File(['b'], 'aula.mp4'), new File(['c'], 'entrevista.mp3'), new File(['{}'], 'solta.json')]);
  expect(fila().getByText('Pronto para enviar, com palestra.json')).toBeDefined();
  expect(fila().getAllByText('Falta a transcrição')).toHaveLength(2);
  expect(fila().getByText(/Recusado: Transcrição sem vídeo ou áudio/)).toBeDefined();
});

test('link do YouTube vai ao serviço; rota ausente (404) explica que ainda não há importação de vídeo', async () => {
  const importarYoutube = vi.fn(() => Promise.reject(new ErroDaApi(404, 'Not Found')));
  render(<Adicionar ir={vi.fn()} servicos={servicos({ importarYoutube })} />);
  fireEvent.change(screen.getByLabelText('Endereço'), { target: { value: 'https://youtu.be/abc' } });
  fireEvent.click(screen.getByRole('button', { name: 'Trazer' }));
  expect(await fila().findByText(/ainda não está disponível nesta versão/)).toBeDefined();
  expect(importarYoutube).toHaveBeenCalledWith({ url: 'https://youtu.be/abc' });
});

test('outra página web aponta para a extensão; texto que não é link avisa', () => {
  const ir = vi.fn();
  render(<Adicionar ir={ir} servicos={servicos()} />);
  fireEvent.change(screen.getByLabelText('Endereço'), { target: { value: 'https://exemplo.com/artigo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Trazer' }));
  expect(screen.getByRole('alert').textContent).toMatch(/não busca páginas da internet sozinho/);
  fireEvent.click(screen.getByRole('link', { name: /Como instalar a extensão/ }));
  expect(ir).toHaveBeenCalledWith({ nome: 'ajuda', pagina: 'extensao' });
  fireEvent.change(screen.getByLabelText('Endereço'), { target: { value: 'qualquer coisa' } });
  fireEvent.click(screen.getByRole('button', { name: 'Trazer' }));
  expect(screen.getByRole('alert').textContent).toMatch(/não parece um endereço/);
});

test('texto colado: título da primeira linha, poesia em "Mais opções", envio imediato', async () => {
  const enviarDocumento = vi.fn<ServicosDaImportacao['enviarDocumento']>(() => criado());
  render(<Adicionar ir={vi.fn()} entradaInicial="colado" servicos={servicos({ enviarDocumento })} />);
  const texto = screen.getByLabelText('Texto');
  expect(document.activeElement).toBe(texto);
  fireEvent.change(texto, { target: { value: 'Soneto\n\nVerso um' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Mais opções' }).at(-1)!);
  escolherOpcao('Tipo do texto', 'Poesia');
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar texto' }));
  await waitFor(() => expect(enviarDocumento).toHaveBeenCalledTimes(1));
  const formulario = enviarDocumento.mock.calls[0]![0];
  expect(formulario.get('formato')).toBe('colado');
  expect(formulario.get('titulo')).toBe('Soneto');
  expect(formulario.get('texto')).toBe('Soneto\n\nVerso um');
  expect(formulario.get('poesia')).toBe('1');
  expect((texto as HTMLTextAreaElement).value).toBe('');
});

test('avançado: importa marcas de outro arquivo para um documento preparado', async () => {
  const importarMarcas = vi.fn(() => Promise.resolve({ contagem: { total: 3, resolvidas: 1, reconciliadas: 1 } }));
  const listarDocumentos = vi.fn(() => Promise.resolve({ documentos: [{ id: 'D1', titulo: 'Pronto', versao_id: 'V' }, { id: 'D2', titulo: 'Sem texto', versao_id: null }] }));
  render(<Adicionar ir={vi.fn()} servicos={servicos({ importarMarcas, listarDocumentos })} />);
  expect(screen.queryByText('Marcas de outro arquivo')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Avançado' }));
  await screen.findByRole('combobox', { name: 'Documento' });
  fireEvent.click(screen.getByRole('combobox', { name: 'Documento' }));
  expect(screen.queryByRole('option', { name: 'Sem texto' })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: 'Pronto' }));
  fireEvent.change(screen.getByLabelText('Arquivo de marcas'), { target: { files: [new File(['{"marcas":[]}'], 'marcas.json')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Importar marcas' }));
  expect(await screen.findByText('2 de 3 marcas entraram no documento. As outras não foram localizadas no texto.')).toBeDefined();
  expect(importarMarcas).toHaveBeenCalledWith('D1', { marcas: [] });
});

test('não há entrada do Horarium na página', () => {
  render(<Adicionar ir={vi.fn()} servicos={servicos()} />);
  expect(screen.queryByText(/Horarium/i)).toBeNull();
});
