/** U-02: sair de Adicionar com envio ou vinculação pendente pede confirmação. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Adicionar, frasesDaSaida, pendentesDaImportacao } from './Adicionar';
import { usarRota } from './rotas';
import type { ServicosDaImportacao } from './importacao';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); localStorage.clear(); });

const escolher = (arquivos: File[]) => fireEvent.change(screen.getByLabelText('Arquivo'), { target: { files: arquivos } });
const preparando = () => Promise.resolve({ id: 'x', versao_id: null, estado: 'canonizando' as const, detalhe: null, formato: 'txt', texto_disponivel: false });

/** A casca mínima: a rota do endereço, Adicionar nela e um botão que sai para a Biblioteca. */
function Casca({ servicos }: { servicos: Partial<ServicosDaImportacao> }) {
  const { rota, ir } = usarRota();
  return <>
    <button type="button" onClick={() => ir({ nome: 'biblioteca' })}>Ir para a biblioteca</button>
    <button type="button" onClick={() => ir({ nome: 'adicionar', aba: 'video' })}>Aba de vídeo</button>
    {rota.nome === 'adicionar' ? <Adicionar ir={ir} aba={rota.aba ?? 'documento'} servicos={servicos} /> : <p>Página da biblioteca</p>}
  </>;
}

/** Três arquivos; o primeiro envio fica preso até `soltar`. */
function montarComEnvioPreso() {
  window.history.replaceState(null, '', '/adicionar/documento');
  const soltares: ((valor: { documento_id: string; job_id: string }) => void)[] = [];
  const enviarDocumento = vi.fn(() => new Promise<{ documento_id: string; job_id: string }>((resolver) => { soltares.push(resolver); }));
  render(<Casca servicos={{ enviarDocumento, obterDocumento: preparando, intervalo: 60_000 }} />);
  escolher([new File(['a'], 'um.txt'), new File(['b'], 'dois.txt'), new File(['c'], 'tres.txt')]);
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar 3 arquivos' }));
  return { enviarDocumento, soltar: async (indice: number) => { await act(async () => { soltares[indice]?.({ documento_id: `doc${String(indice)}`, job_id: 'j' }); await Promise.resolve(); }); } };
}

describe('confirmação ao sair', () => {
  test('com envio em curso, sair pergunta; Continuar importando fica e o envio segue', async () => {
    const { enviarDocumento, soltar } = montarComEnvioPreso();
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a biblioteca' }));
    const dialogo = screen.getByRole('alertdialog');
    expect(dialogo.textContent).toContain('3 arquivos ainda não foram enviados.');
    expect(dialogo.textContent).toContain('Se sair agora, eles não terminam de entrar na biblioteca.');
    expect(document.activeElement?.textContent).toBe('Continuar importando');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar importando' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.location.pathname).toBe('/adicionar/documento');
    await soltar(0);
    await waitFor(() => expect(enviarDocumento).toHaveBeenCalledTimes(2));
  });

  test('"Sair mesmo assim" vai para onde a pessoa pediu, e o resto do lote não é enviado', async () => {
    const { enviarDocumento, soltar } = montarComEnvioPreso();
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a biblioteca' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sair mesmo assim' }));
    expect(screen.getByText('Página da biblioteca')).toBeDefined();
    expect(window.location.pathname).toBe('/biblioteca');
    await soltar(0);
    expect(enviarDocumento).toHaveBeenCalledTimes(1);
  });

  test('Esc é continuar; trocar de aba dentro de Adicionar não pergunta', () => {
    montarComEnvioPreso();
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a biblioteca' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aba de vídeo' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.location.pathname).toBe('/adicionar/video');
  });

  test('voltar do navegador também pergunta, e o endereço fica no de Adicionar', () => {
    window.history.replaceState(null, '', '/biblioteca');
    window.history.pushState(null, '', '/adicionar/documento');
    montarComEnvioPreso();
    act(() => { window.history.replaceState(null, '', '/biblioteca'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(window.location.pathname).toBe('/adicionar/documento');
    fireEvent.click(screen.getByRole('button', { name: 'Sair mesmo assim' }));
    expect(window.location.pathname).toBe('/biblioteca');
    expect(screen.getByText('Página da biblioteca')).toBeDefined();
  });

  test('fechar ou recarregar a página com envio pendente pede confirmação; terminado, não', async () => {
    const { soltar } = montarComEnvioPreso();
    const evento = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(evento()).toBe(true);
    await soltar(0); await soltar(1); await soltar(2);
    await waitFor(() => expect(evento()).toBe(false));
  });

  test('sem nada pendente, sai direto', () => {
    window.history.replaceState(null, '', '/adicionar/documento');
    render(<Casca servicos={{ obterDocumento: preparando, intervalo: 60_000 }} />);
    escolher([new File(['a'], 'um.txt')]);
    // Na fila, mas sem pedir o envio: nada se perde ao sair.
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a biblioteca' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Página da biblioteca')).toBeDefined();
  });
});

describe('o que conta como pendente', () => {
  const dados = { versao: 1 as const, motor: 'whisper', capitulos: [], paragrafos: [], palavras: [] };
  test('envios em curso e mídias ainda não ligadas ao texto; recusados e prontos, não', () => {
    const midia = (fase: 'esperando_texto' | 'publicando' | 'pronta' | 'falhou') => ({ fase: 'enviado' as const, documento_id: 'd', texto: 'preparando' as const, tentativas: 0, midia: { sha256: 'a', tipo: 'video' as const, dados, fase } });
    expect(pendentesDaImportacao([
      { estado: { fase: 'aguardando' } }, { estado: { fase: 'enviando', passo: 'x' } }, { estado: { fase: 'na_fila' } },
      { estado: { fase: 'recusado', motivo: 'x' } }, { estado: midia('esperando_texto') }, { estado: midia('publicando') }, { estado: midia('pronta') },
      { estado: { ...midia('esperando_texto'), texto: 'falhou' as const } },
    ])).toEqual({ envios: 2, midias: 2 });
    expect(frasesDaSaida({ envios: 1, midias: 1 })).toEqual(['1 arquivo ainda não foi enviado.', '1 vídeo ou áudio ainda está sendo ligado à transcrição.']);
  });

  test('vídeo entre a criação do texto e a publicação: sair pergunta', async () => {
    window.history.replaceState(null, '', '/adicionar/video');
    const transcricao = JSON.stringify({ versao: 1, titulo: 'Aula', motor: 'whisper', idioma: 'pt', capitulos: [], paragrafos: ['Oi.'], palavras: [{ texto: 'Oi.', inicio_s: 0, fim_s: 0.3 }] });
    render(<Casca servicos={{
      enviarMidia: () => Promise.resolve({ sha256: 'a'.repeat(64), tipo: 'video' as const }),
      enviarDocumento: () => Promise.resolve({ documento_id: 'video1', job_id: 'j' }), obterDocumento: preparando, intervalo: 60_000,
    }} />);
    fireEvent.click(screen.getByRole('button', { name: /Tenho o arquivo do vídeo/ }));
    escolher([new File(['mp4'], 'aula.mp4', { type: 'video/mp4' }), new File([transcricao], 'aula.json', { type: 'application/json' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
    await screen.findByText(/Preparando o texto/);
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a biblioteca' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('1 vídeo ou áudio ainda está sendo ligado à transcrição.');
  });
});
