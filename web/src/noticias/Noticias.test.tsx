import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { HubDeNoticiasV1 } from '@margem/contratos';
import { Noticias } from './Noticias';
import { caminhoDaRota, rotaDoCaminho } from '../biblioteca/rotas';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const id = '0'.repeat(25) + '1';
const vazio: HubDeNoticiasV1 = { edicoes: [], agenda: { ativa: true, hora: 7, fuso: 'America/Sao_Paulo', foco: 'ia_aplicada' } };
const hub = (): HubDeNoticiasV1 => ({ ...vazio, edicoes: [{ id, dia: '2026-10-05', estado: 'ok', estado_audio: 'falhou', audio: null, capa: null, estado_capa: null, documento_id: null, diagnostico: null,
  conteudo: { versao: 1, foco: 'ia_aplicada', corte_em: '2026-10-05T10:00:00Z', titulo: 'Citações para conferir', abertura: 'Uma mudança para o leitor.', roteiro: 'O extrator localiza citações.',
    noticias: [{ titulo: 'Extrator com evidências', resumo: 'Localização documental.', importancia: 'Uma proposta para o Margem.', projeto: 'Margem', natureza: 'novidade', limite: 'Ainda não testado aqui.', evidencias: [{ fonte_url: 'https://example.org/fonte', citacao: 'Trecho literal.' }] }],
    fontes: [{ url: 'https://example.org/fonte', titulo: 'Fonte de teste', publicada_em: '2026-10-05T09:00:00Z', texto: 'Trecho literal.', sha256: 'a'.repeat(64), acesso: 'pagina' }],
    cobertura: [{ nome: 'Autor', url: 'https://example.org/feed', candidatos: 3, lidos: 1, estado: 'parcial', limite: 'Duas páginas não puderam ser lidas.' }],
  } }] });
function rede(valor: HubDeNoticiasV1) {
  const fetch = vi.fn((url: string, init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(init?.method === 'POST' ? url.endsWith('/ler') ? { documento_id: id } : { id } : valor))));
  vi.stubGlobal('fetch', fetch); return fetch;
}

test('rota permite entrar numa edição e voltar ao hub', () => {
  expect(rotaDoCaminho(`/noticias/${id}`)).toEqual({ nome: 'noticias', edicao_id: id });
  expect(caminhoDaRota({ nome: 'noticias', edicao_id: id })).toBe(`/noticias/${id}`);
  expect(rotaDoCaminho('/noticias')).toEqual({ nome: 'noticias' });
});
test('primeira edição é ação real e não mostra notícia fictícia', async () => {
  const fetch = rede(vazio), ir = vi.fn(); render(<Noticias ir={ir} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar minha primeira edição' }));
  await waitFor(() => expect(ir).toHaveBeenCalledWith({ nome: 'noticias', edicao_id: id }));
  expect(fetch.mock.calls.some(([url, init]) => url === '/api/noticias/gerar' && init?.method === 'POST')).toBe(true);
});
test('revista mantém leitura com áudio falhado, evidencia cobertura, filtra e abre leitor', async () => {
  rede(hub()); const ir = vi.fn(); render(<Noticias ir={ir} edicaoId={id} />);
  await screen.findByRole('heading', { name: 'Extrator com evidências' });
  expect(screen.getByText(/Duas páginas/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Preparar áudio' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Gibraltar' }));
  expect(screen.queryByRole('heading', { name: 'Extrator com evidências' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e abrir no leitor' }));
  await waitFor(() => expect(ir).toHaveBeenCalledWith({ nome: 'leitura', documento_id: id }));
});
test('áudio publicado usa endpoint da edição e oferece transcrição', async () => {
  const h = hub(); h.edicoes[0]!.audio = { duracao_s: 280, sha256_roteiro: 'a'.repeat(64) }; h.edicoes[0]!.estado_audio = 'ok'; rede(h);
  render(<Noticias ir={vi.fn()} edicaoId={id} />);
  const audio = await screen.findByLabelText('Áudio da edição');
  expect(audio.getAttribute('src')).toBe(`/api/noticias/${id}/audio`);
  expect(screen.getByText('4:40 · voz sintética')).toBeTruthy();
  expect(screen.getByText('Ler a transcrição')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Avançar 10 segundos' }));
  expect((audio as HTMLAudioElement).currentTime).toBe(10);
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Posição na edição' }), { key: 'Home' });
  expect((audio as HTMLAudioElement).currentTime).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Velocidade' }));
  expect((audio as HTMLAudioElement).playbackRate).toBe(1.25);
});

test('início lista duas edições por mês, abre a revista e oferece volta sem seletor', async () => {
  const h = hub();
  const anterior = structuredClone(h.edicoes[0]!);
  anterior.id = '0'.repeat(25) + '2'; anterior.dia = '2026-09-30'; anterior.conteudo!.titulo = 'Retrospectiva de setembro';
  h.edicoes.push(anterior); rede(h);
  const ir = vi.fn(); const tela = render(<Noticias ir={ir} />);
  const link = await screen.findByRole('link', { name: 'Retrospectiva de setembro' });
  expect(screen.getByRole('heading', { name: 'outubro de 2026' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'setembro de 2026' })).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByLabelText('Áudio da edição')).toBeNull();
  fireEvent.click(link);
  expect(ir).toHaveBeenCalledWith({ nome: 'noticias', edicao_id: anterior.id });
  tela.rerender(<Noticias ir={ir} edicaoId={anterior.id} />);
  expect(screen.getByRole('heading', { name: 'Retrospectiva de setembro' })).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: '← Todas as edições' }));
  expect(ir).toHaveBeenLastCalledWith({ nome: 'noticias' });
});

test('capa publicada aparece na lista e com descrição acessível na revista', async () => {
  const h = hub(); h.edicoes[0]!.capa = { sha256: 'a'.repeat(64), sha256_edicao: 'b'.repeat(64), largura: 1200, altura: 800, bytes: 1024, descricao: 'Papéis e uma lupa em ilustração editorial.' }; h.edicoes[0]!.estado_capa = 'ok'; rede(h);
  const ir = vi.fn(); const tela = render(<Noticias ir={ir} />);
  await screen.findByRole('link', { name: 'Abrir Citações para conferir' });
  tela.rerender(<Noticias ir={ir} edicaoId={id} />);
  expect(screen.getByRole('img', { name: h.edicoes[0]!.capa.descricao }).getAttribute('src')).toBe(`/api/noticias/${id}/capa`);
  expect(screen.getByText('Ilustração gerada por IA')).toBeTruthy();
});
