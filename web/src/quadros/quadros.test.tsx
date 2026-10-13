import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1 } from '@margem/contratos';
import { caminhoDaRota, rotaDoCaminho } from '../biblioteca/rotas';
import { Lista } from '../biblioteca/Lista';
import { Inicio } from '../biblioteca/Inicio';
import { arrastar, enquadrar, limitarCamera, nivelDeZoom, QUADRO_INTEIRO, zoomEm } from './camera';
import { batidaNoInstante, cameraDaLinha, casarPalavras, montarLinhaDoTempo, palavraNoInstante, saltarBatida } from './linha-do-tempo';
import { afirmacoesEmOrdem, agruparAfirmacoes } from './rotulos';
import { LegendaComKaraoke } from './PlayerDoQuadro';
import { LeitorDeQuadro } from './LeitorDeQuadro';
import type { DetalheDoQuadro, ManifestoDaNarracao, ResumoDoQuadro } from './tipos';

const ler = <T,>(caminho: string): T => JSON.parse(readFileSync(`${import.meta.dirname}/../../../fixtures/arte/${caminho}`, 'utf8')) as T;
const modelo = ler<ModeloDaObraV1>('educacao.modelo.json');
const curta = ler<AnaliseCurtaDaObraV1>('educacao.curta.json');

/** Manifesto falso (só para teste): a voz fala mais devagar que o estimado e o alinhador perdeu uma palavra. */
function manifestoFalso(): ManifestoDaNarracao {
  let cursor = 0.2;
  const batidas = curta.batidas.map((b, indice) => {
    const palavras = b.narracao.split(/\s+/).map((texto) => { const p = { texto: texto.replace(/[.,;:!?]+$/u, ''), inicio_s: cursor, fim_s: cursor + 0.35 }; cursor += 0.5; return p; });
    if (indice === 1) palavras.splice(2, 1);
    const inicio_s = palavras[0]!.inicio_s; const fim_s = cursor; cursor += 0.6;
    return { indice, inicio_s, fim_s, texto: b.narracao, palavras };
  });
  return { versao: 1, analise: 'esperado', curta_sha256: 'x', voz: { perfil: 'omnivoice-seed123', modelo: 'k2-fsa/OmniVoice', seed: 123 }, arquivo: 'narracao.mp3', duracao_s: cursor, batidas };
}

const resumo: ResumoDoQuadro = {
  slug: 'educacao', titulo: modelo.identidade.titulo, titulo_original: modelo.identidade.titulo_original, artista: modelo.identidade.artista,
  data: modelo.identidade.data, ano: '1887', tecnica: modelo.identidade.tecnica, largura: modelo.imagem.largura, altura: modelo.imagem.altura,
  imagem: '/api/arte/educacao/imagem', miniatura: '/api/arte/educacao/miniatura', adicionado_em: '2026-09-30T12:00:00.000Z',
  analises: [{ rotulo: 'esperado', titulo: 'Referência', origem: 'esperado', publicada: true, audio: false, atualizada_em: '2026-09-30T12:00:00.000Z' }],
};
const detalhe: DetalheDoQuadro = {
  slug: 'educacao', origem: 'acervo', adicionado_em: resumo.adicionado_em,
  imagem: { url: '/api/arte/educacao/imagem', miniatura: '/api/arte/educacao/miniatura', info: { origem_url: 'https://commons.wikimedia.org/wiki/File:x.jpg', arquivo_url: null, licenca: 'Domínio público', credito: 'Wikimedia Commons', sha256: null, largura: null, altura: null, baixado_em: null } },
  analises: [...resumo.analises, { rotulo: 'codex-v2', titulo: 'Codex v2', origem: 'geracao', publicada: false, audio: false, atualizada_em: resumo.adicionado_em }],
  analise: { rotulo: 'esperado', titulo: 'Referência', origem: 'esperado', audio: false, imagem: '/api/arte/educacao/imagem', modelo, curta },
};

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); try { localStorage.clear(); } catch { /* sem storage */ } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('rotas dos quadros', () => {
  test('/quadros/<slug> abre o quadro; /quadros e o antigo /arte vão para o filtro Quadros', () => {
    expect(rotaDoCaminho('/quadros/educacao')).toEqual({ nome: 'quadro', slug: 'educacao' });
    expect(caminhoDaRota({ nome: 'quadro', slug: 'tolo' })).toBe('/quadros/tolo');
    expect(rotaDoCaminho('/arte/tolo')).toEqual({ nome: 'quadro', slug: 'tolo' });
    expect(rotaDoCaminho('/quadros')).toEqual({ nome: 'biblioteca', tipo: 'quadros' });
    expect(rotaDoCaminho(caminhoDaRota({ nome: 'biblioteca', tipo: 'quadros', aba: 'novos' }))).toEqual({ nome: 'biblioteca', tipo: 'quadros', aba: 'novos' });
    expect(rotaDoCaminho('/quadros/../etc')).toEqual({ nome: 'biblioteca', tipo: 'quadros' });
  });
});

describe('câmera', () => {
  test('zoom em torno de um ponto, arrasto e limites', () => {
    const perto = zoomEm(QUADRO_INTEIRO, 2, 0.25, 0.25);
    expect(perto.largura).toBeCloseTo(0.5);
    expect(perto.x).toBeCloseTo(0.125);
    expect(nivelDeZoom(perto)).toBeCloseTo(2);
    expect(zoomEm(perto, 0.1)).toEqual(QUADRO_INTEIRO);
    expect(zoomEm(QUADRO_INTEIRO, 1000).largura).toBeCloseTo(0.04);
    expect(arrastar(perto, -1, -1)).toMatchObject({ x: 0, y: 0 });
    expect(arrastar(perto, 1, 1)).toMatchObject({ x: 0.5, y: 0.5 });
    expect(limitarCamera({ x: 0.9, y: -1, largura: 0.5, altura: 2 })).toEqual({ x: 0.5, y: 0, largura: 0.5, altura: 1 });
  });
  test('enquadrar contém a região, com folga', () => {
    const forma = { tipo: 'bbox' as const, x: 0.4, y: 0.4, largura: 0.2, altura: 0.2 };
    const c = enquadrar([forma]);
    expect(c.x).toBeLessThan(0.4); expect(c.x + c.largura).toBeGreaterThan(0.6);
    expect(enquadrar([])).toEqual(QUADRO_INTEIRO);
  });
});

describe('linha do tempo da análise curta', () => {
  test('sem voz: os tempos estimados da curta e as palavras distribuídas dentro da fala', () => {
    const linha = montarLinhaDoTempo(curta, null);
    expect(linha.narrada).toBe(false);
    expect(linha.duracao_s).toBe(curta.batidas.at(-1)!.fim_s);
    const b = linha.batidas[1]!;
    expect(b.inicio_s).toBe(curta.batidas[1]!.inicio_s);
    expect(b.palavras.length).toBeGreaterThan(3);
    expect(b.palavras[0]!.inicio_s).toBeCloseTo(b.inicio_s);
    expect(b.palavras.at(-1)!.fim_s).toBeLessThanOrEqual(b.fim_s);
    expect(batidaNoInstante(linha, b.inicio_s + 0.01)).toBe(1);
    expect(palavraNoInstante(b, b.inicio_s - 0.1)).toBe(-1);
    expect(cameraDaLinha(linha, b.inicio_s)).toEqual(b.batida.camera.de);
    expect(cameraDaLinha(linha, b.fim_s - 0.001).largura).toBeCloseTo(b.batida.camera.para.largura, 2);
  });
  test('com voz: os tempos reais de batida e palavra; a palavra perdida pelo alinhador é interpolada', () => {
    const manifesto = manifestoFalso();
    const linha = montarLinhaDoTempo(curta, manifesto);
    expect(linha.narrada).toBe(true);
    expect(linha.duracao_s).toBeCloseTo(manifesto.duracao_s);
    const b = linha.batidas[1]!;
    expect(b.inicio_s).toBe(manifesto.batidas[1]!.inicio_s);
    expect(b.palavras[0]!.inicio_s).toBe(manifesto.batidas[1]!.palavras[0]!.inicio_s);
    const palavrasDaNarracao = curta.batidas[1]!.narracao.split(/\s+/).length;
    expect(b.palavras.length).toBe(palavrasDaNarracao);
    expect(b.palavras[2]!.inicio_s).toBeGreaterThanOrEqual(b.palavras[1]!.fim_s - 1e-9);
    expect(b.palavras[2]!.fim_s).toBeLessThanOrEqual(b.palavras[3]!.inicio_s + 1e-9);
    // No silêncio entre duas batidas, vale a anterior.
    expect(batidaNoInstante(linha, b.fim_s + 0.3)).toBe(1);
  });
  test('manifesto com outra contagem de batidas é ignorado (ritmo estimado)', () => {
    const manifesto = manifestoFalso();
    expect(montarLinhaDoTempo(curta, { ...manifesto, batidas: manifesto.batidas.slice(1) }).narrada).toBe(false);
  });
  test('casar palavras ignora acento, caixa e pontuação', () => {
    const casadas = casarPalavras('Olhe a Menina, agora.', [{ texto: 'olhe', inicio_s: 0, fim_s: 1 }, { texto: 'MENINA', inicio_s: 2, fim_s: 3 }, { texto: 'agora', inicio_s: 4, fim_s: 5 }]);
    expect(casadas.map((c) => c.inicio_utf16)).toEqual([0, 7, 15]);
  });
  test('← volta ao começo da batida ou à anterior; → vai à próxima', () => {
    const linha = montarLinhaDoTempo(curta, null);
    const b2 = linha.batidas[2]!;
    expect(saltarBatida(linha, b2.inicio_s + 2, -1)).toBe(b2.inicio_s);
    expect(saltarBatida(linha, b2.inicio_s + 0.2, -1)).toBe(linha.batidas[1]!.inicio_s);
    expect(saltarBatida(linha, b2.inicio_s, 1)).toBe(linha.batidas[3]?.inicio_s ?? linha.duracao_s);
  });
});

describe('afirmações por dimensão', () => {
  test('grupos na ordem dos temas e o Percorrer sem repetição', () => {
    const grupos = agruparAfirmacoes(modelo);
    expect(grupos.length).toBeGreaterThan(0);
    const ordem = afirmacoesEmOrdem(modelo);
    expect(new Set(ordem.map((a) => a.id)).size).toBe(ordem.length);
    expect(ordem.length).toBe(modelo.afirmacoes.length);
  });
});

describe('legenda em karaokê', () => {
  test('a palavra em curso muda só a tinta (classe), o texto continua inteiro', () => {
    const linha = montarLinhaDoTempo(curta, null);
    const { container } = render(<LegendaComKaraoke batida={linha.batidas[0]!} palavra={2} />);
    const legenda = container.querySelector('.legenda-do-quadro')!;
    expect(legenda.textContent).toBe(curta.batidas[0]!.narracao);
    expect(legenda.querySelectorAll('.dita')).toHaveLength(2);
    expect(legenda.querySelector('.atual')?.getAttribute('data-palavra')).toBe('2');
  });
});

describe('quadros na Biblioteca', () => {
  test('o filtro Quadros lista os quadros com a pintura como capa e abre /quadros/<slug>', async () => {
    const ir = vi.fn();
    render(<Lista ir={ir} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={() => Promise.resolve({ documentos: [] })} carregarQuadros={() => Promise.resolve({ obras: [resumo] })} />);
    const linha = await screen.findByRole('link', { name: 'Educação Obrigatória' });
    const capa = linha.closest('.linha-documento')!.querySelector('img')!;
    expect(capa.getAttribute('src')).toBe('/api/arte/educacao/miniatura');
    expect(screen.getByText('1 quadros')).toBeTruthy();
    fireEvent.click(linha);
    expect(ir).toHaveBeenCalledWith({ nome: 'quadro', slug: 'educacao' });
    expect(within(screen.getByRole('complementary', { name: 'Informações do quadro' })).getByText('Óleo sobre tela')).toBeTruthy();
  });
  test('na Biblioteca inteira, quadros e textos convivem; o Início mostra a fileira Quadros', async () => {
    const doc = { id: '0'.repeat(25) + '1', titulo: 'Livro de teste', autor: 'Machado de Assis', formato: 'md', criado_em: '2026-09-20T12:00:00.000Z', versao_id: null, texto_disponivel: false, estado: 'pronto' as const, detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 }, progresso: null, jobs_em_curso: 0 };
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca' }} carregar={() => Promise.resolve({ documentos: [doc] })} carregarQuadros={() => Promise.resolve({ obras: [resumo] })} />);
    expect(await screen.findByText('1 textos · 1 quadros')).toBeTruthy();
    cleanup();
    render(<Inicio ir={vi.fn()} carregar={() => Promise.resolve({ documentos: [doc] })} carregarQuadros={() => Promise.resolve({ obras: [resumo] })} />);
    expect(await screen.findByRole('region', { name: 'Quadros' })).toBeTruthy();
  });
});

describe('Quadros sem acervo instalado (J110)', () => {
  const acervo = { instalado: false, comando: 'margem arte instalar', pacote: { versao: '2026.10.12', url: 'https://exemplo.org/acervo.tar.gz', obras: 137, bytes: 488_466_574 } };
  test('explica em uma frase e oferece o pacote e o comando, em vez de uma lista vazia', async () => {
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={() => Promise.resolve({ documentos: [] })} carregarQuadros={() => Promise.resolve({ obras: [], acervo })} />);
    const baixar = await screen.findByRole('link', { name: 'Baixar o acervo de quadros (137 obras, 488 MB)' });
    expect(baixar.getAttribute('href')).toBe('https://exemplo.org/acervo.tar.gz');
    expect(screen.getByText(/pinturas em domínio público com uma leitura guiada/u)).toBeTruthy();
    expect(screen.getByText('margem arte instalar').tagName).toBe('CODE');
    expect(screen.queryByText('Nenhum quadro no acervo.')).toBeNull();
    expect(screen.queryByText('Nenhum texto ainda.')).toBeNull();
  });
  test('sem URL de release: botão indisponível e o comando pede o arquivo', async () => {
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={() => Promise.resolve({ documentos: [] })} carregarQuadros={() => Promise.resolve({ obras: [], acervo: { ...acervo, pacote: { ...acervo.pacote, url: null } } })} />);
    const botao = await screen.findByRole('button', { name: /Baixar o acervo de quadros/u });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Download em preparação.')).toBeTruthy();
    expect(screen.getByText('margem arte instalar <arquivo do acervo>')).toBeTruthy();
  });
  test('as obras de demonstração continuam listadas abaixo; com acervo instalado, nada muda', async () => {
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={() => Promise.resolve({ documentos: [] })} carregarQuadros={() => Promise.resolve({ obras: [resumo], acervo })} />);
    expect(await screen.findByRole('link', { name: 'Educação Obrigatória' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Baixar o acervo/u })).toBeTruthy();
    cleanup();
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={() => Promise.resolve({ documentos: [] })} carregarQuadros={() => Promise.resolve({ obras: [resumo], acervo: { ...acervo, instalado: true } })} />);
    expect(await screen.findByRole('link', { name: 'Educação Obrigatória' })).toBeTruthy();
    expect(screen.queryByText(/Baixar o acervo/u)).toBeNull();
  });
});

describe('leitor de quadro', () => {
  function servir() {
    const pedidos: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      pedidos.push(url);
      const corpo = url.endsWith('/analises/codex-v2') ? { ...detalhe.analise, rotulo: 'codex-v2', titulo: 'Codex v2', origem: 'geracao' } : url === '/api/arte/educacao' ? detalhe : { erro: 'obra_inexistente' };
      return Promise.resolve(new Response(JSON.stringify(corpo), { status: 'erro' in corpo ? 404 : 200 }));
    }));
    return pedidos;
  }
  test('abre com a casca do leitor: barra, pintura, regiões e o painel com a análise', async () => {
    servir();
    render(<LeitorDeQuadro slug="educacao" ir={vi.fn()} />);
    expect(await screen.findByRole('navigation', { name: 'Barra do quadro' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar à biblioteca' })).toBeTruthy();
    expect(document.querySelectorAll('.regiao-do-quadro')).toHaveLength(modelo.regioes.length);
    const painel = screen.getByRole('complementary', { name: 'Painel do quadro' });
    expect(within(painel).getByText(curta.tese)).toBeTruthy();
    // Clicar numa afirmação ancorada acende a região dela.
    const ancorada = modelo.afirmacoes.find((a) => a.regioes.length > 0)!;
    fireEvent.click(within(painel).getByText(ancorada.texto));
    expect(document.querySelector(`[data-regiao="${ancorada.regioes[0]!}"]`)?.classList.contains('acesa')).toBe(true);
  });
  test('Espaço abre o player da análise curta; Esc fecha; P percorre; a troca de análise pede a geração', async () => {
    const pedidos = servir();
    render(<LeitorDeQuadro slug="educacao" ir={vi.fn()} />);
    await screen.findByRole('navigation', { name: 'Barra do quadro' });
    fireEvent.keyDown(window, { key: ' ' });
    expect(await screen.findByRole('region', { name: 'Análise curta' })).toBeTruthy();
    expect(screen.getByText(/sem voz · ritmo de leitura/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Análise curta' })).toBeNull());
    fireEvent.keyDown(window, { key: 'p' });
    expect(await screen.findByRole('region', { name: 'Percorrer as afirmações' })).toBeTruthy();
    expect(document.querySelector('.contagem-do-percorrer')?.textContent).toMatch(/^1 \//);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.querySelector('.contagem-do-percorrer')?.textContent).toMatch(/^2 \//);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Análise' }));
    fireEvent.click(await screen.findByRole('option', { name: /Codex v2/ }));
    await waitFor(() => expect(pedidos).toContain('/api/arte/educacao/analises/codex-v2'));
  });
  test('quadro fora do acervo: aviso, sem quebrar', async () => {
    servir();
    render(<LeitorDeQuadro slug="nao-existe" ir={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/não está no acervo/);
  });
});
