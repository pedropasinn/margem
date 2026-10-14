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
import type { DetalheDoQuadro, ManifestoDaNarracao, QuadroDaPessoaV1, ResumoDoQuadro } from './tipos';
import type { OperacoesDosQuadros } from './api';
import { FormularioDaObra, IdentificarObra, INTERVALO_DO_PREPARO_MS, LIMITE_DA_IMAGEM_BYTES, recusaDaImagem } from './NaBiblioteca';

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
    expect(screen.getByText('1 quadro')).toBeTruthy();
    fireEvent.click(linha);
    expect(ir).toHaveBeenCalledWith({ nome: 'quadro', slug: 'educacao' });
    expect(within(screen.getByRole('complementary', { name: 'Informações do quadro' })).getByText('Óleo sobre tela')).toBeTruthy();
  });
  test('na Biblioteca inteira, quadros e textos convivem; o Início mostra a fileira Quadros', async () => {
    const doc = { id: '0'.repeat(25) + '1', titulo: 'Livro de teste', autor: 'Machado de Assis', formato: 'md', criado_em: '2026-09-20T12:00:00.000Z', versao_id: null, texto_disponivel: false, estado: 'pronto' as const, detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 }, progresso: null, jobs_em_curso: 0 };
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca' }} carregar={() => Promise.resolve({ documentos: [doc] })} carregarQuadros={() => Promise.resolve({ obras: [resumo] })} />);
    expect(await screen.findByText('2 itens')).toBeTruthy();
    cleanup();
    render(<Inicio ir={vi.fn()} carregar={() => Promise.resolve({ documentos: [doc] })} carregarQuadros={() => Promise.resolve({ obras: [resumo] })} />);
    expect(await screen.findByRole('region', { name: 'Quadros' })).toBeTruthy();
  });
});

describe('Quadros da pessoa (J118): sem acervo distribuído', () => {
  const vazio = () => Promise.resolve({ documentos: [] });
  const base: QuadroDaPessoaV1 = {
    versao: 1, id: '01JZ8X3T5K0000000000000001', slug: 'obra-8x3t5k', estado: 'na_fila', etapa: null, progresso: null, identificacao: null,
    imagem: { formato: 'jpeg', bytes: 2_400_000, nome: 'IMG_2041.jpg' }, enviado_em: '2026-10-13T12:00:00.000Z',
  };
  const operacoes = (): OperacoesDosQuadros => ({
    adicionar: vi.fn(() => Promise.resolve(base)), corrigir: vi.fn(() => Promise.resolve(base)),
    tentarDeNovo: vi.fn(() => Promise.resolve(base)), remover: vi.fn(() => Promise.resolve(null)),
  });

  test('sem nenhuma obra: explica em uma frase e convida a adicionar; nada de pacote nem comando', async () => {
    const ir = vi.fn();
    render(<Lista ir={ir} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={vazio} carregarQuadros={() => Promise.resolve({ obras: [], preparando: [] })} />);
    expect(await screen.findByText('Nenhum quadro ainda.')).toBeTruthy();
    expect(screen.getByText(/Adicione a imagem de uma obra que você quer estudar/u)).toBeTruthy();
    expect(screen.queryByText(/acervo/u)).toBeNull();
    expect(screen.queryByText(/arte instalar|Baixar/u)).toBeNull();
    expect(screen.queryByText('Nenhum item ainda.')).toBeNull();
    // O convite e o botão do cabeçalho levam à aba Quadro de Adicionar (V-D2).
    const botoes = screen.getAllByRole('button', { name: 'Adicionar obra' });
    expect(botoes).toHaveLength(2);
    for (const botao of botoes) fireEvent.click(botao);
    expect(ir.mock.calls).toEqual([[{ nome: 'adicionar', aba: 'quadro' }], [{ nome: 'adicionar', aba: 'quadro' }]]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('as obras de exemplo não contam: o convite fica, com elas abaixo; com uma obra da pessoa, some', async () => {
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={vazio} carregarQuadros={() => Promise.resolve({ obras: [{ ...resumo, exemplo: true }] })} />);
    expect(await screen.findByRole('link', { name: 'Educação Obrigatória' })).toBeTruthy();
    expect(screen.getByText('Nenhum quadro ainda.')).toBeTruthy();
    cleanup();
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={vazio} carregarQuadros={() => Promise.resolve({ obras: [{ ...resumo, removivel: true }] })} />);
    expect(await screen.findByRole('link', { name: 'Educação Obrigatória' })).toBeTruthy();
    expect(screen.queryByText('Nenhum quadro ainda.')).toBeNull();
  });

  test('enviar: HEIC e arquivo que não é imagem são recusados antes; a imagem vai com título, artista e ano', async () => {
    const ops = operacoes();
    const aoAdicionar = vi.fn();
    const { container } = render(<FormularioDaObra operacoes={ops} aoAdicionar={aoAdicionar} />);
    const dialogo = within(container);
    const entrada = dialogo.getByLabelText('Imagem da obra');
    const enviar = dialogo.getByRole<HTMLButtonElement>('button', { name: 'Adicionar' });
    expect(enviar.disabled).toBe(true);
    fireEvent.change(entrada, { target: { files: [new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' })] } });
    expect(dialogo.getByRole('alert').textContent).toMatch(/HEIC.*JPEG/u);
    expect(enviar.disabled).toBe(true);
    fireEvent.change(entrada, { target: { files: [new File(['x'], 'notas.pdf', { type: 'application/pdf' })] } });
    expect(dialogo.getByRole('alert').textContent).toBe('Escolha uma imagem JPEG, PNG ou WebP.');
    fireEvent.change(entrada, { target: { files: [new File([new Uint8Array([0xff, 0xd8, 0xff])], 'leiteira.jpg', { type: 'image/jpeg' })] } });
    expect(dialogo.queryByRole('alert')).toBeNull();
    fireEvent.change(dialogo.getByLabelText('Título'), { target: { value: ' A Leiteira ' } });
    fireEvent.change(dialogo.getByLabelText('Artista'), { target: { value: 'Johannes Vermeer' } });
    fireEvent.click(enviar);
    await waitFor(() => expect(ops.adicionar).toHaveBeenCalledTimes(1));
    const formulario = (ops.adicionar as ReturnType<typeof vi.fn>).mock.calls[0]![0] as FormData;
    expect((formulario.get('arquivo') as File).name).toBe('leiteira.jpg');
    expect(formulario.get('titulo')).toBe('A Leiteira');
    expect(formulario.get('artista')).toBe('Johannes Vermeer');
    expect(formulario.get('ano')).toBeNull();
    await waitFor(() => expect(aoAdicionar).toHaveBeenCalledWith(base));
  });

  test('preparando: aparece na hora com a etapa e o progresso; a lista se atualiza sozinha até ficar pronta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const preparando: QuadroDaPessoaV1 = { ...base, estado: 'preparando', etapa: 'analise', progresso: { feitas: 4, total: 7 }, identificacao: { titulo: 'A Leiteira', artista: 'Johannes Vermeer', ano: '1658', origem: 'codex', confianca: 'alta' } };
      const respostas = [{ obras: [], preparando: [preparando] }, { obras: [{ ...resumo, slug: base.slug, titulo: 'A Leiteira', removivel: true }], preparando: [] }];
      const carregar = vi.fn(() => Promise.resolve(respostas[Math.min(carregar.mock.calls.length - 1, 1)]!));
      render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={vazio} carregarQuadros={carregar} />);
      const linha = (await screen.findAllByText('Escrevendo a análise')).map((e) => e.closest('[data-quadro-em-preparo]')).find((e) => e !== null)!;
      expect(within(linha as HTMLElement).getByText('A Leiteira')).toBeTruthy();
      expect(within(linha as HTMLElement).getByText('4 de 7')).toBeTruthy();
      expect(within(linha as HTMLElement).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('57');
      expect(linha.querySelector('img')!.getAttribute('src')).toBe(`/api/arte/${base.slug}/miniatura`);
      expect(screen.queryByText('Nenhum quadro ainda.')).toBeNull();
      const painel = within(screen.getByRole('complementary', { name: 'Informações do quadro' }));
      expect(painel.getByText('Proposta pelo Codex (confiança alta)')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(INTERVALO_DO_PREPARO_MS + 50);
      expect(await screen.findByRole('link', { name: 'A Leiteira' })).toBeTruthy();
      expect(screen.queryByText('Escrevendo a análise')).toBeNull();
      await vi.advanceTimersByTimeAsync(INTERVALO_DO_PREPARO_MS * 2);
      expect(carregar).toHaveBeenCalledTimes(2); // pronta: para de perguntar
    } finally { vi.useRealTimers(); }
  });

  test('falhou: o motivo fica visível, com tentar de novo, informar título e artista e remover', async () => {
    const ops = operacoes();
    const falhou: QuadroDaPessoaV1 = { ...base, estado: 'falhou', etapa: 'identificacao', erro: { codigo: 'obra_nao_reconhecida', mensagem: 'Não reconheci esta obra pela imagem. Informe o título e o artista para continuar.' } };
    const carregar = vi.fn(() => Promise.resolve({ obras: [], preparando: [falhou] }));
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={vazio} carregarQuadros={carregar} operacoesDosQuadros={ops} />);
    const linha = within((await screen.findAllByText(/Não reconheci esta obra/u)).map((e) => e.closest('[data-quadro-em-preparo]')).find((e) => e !== null) as HTMLElement);
    expect(linha.getByText('Não ficou pronta')).toBeTruthy();
    expect(linha.getByText('IMG_2041')).toBeTruthy();
    fireEvent.click(linha.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(ops.tentarDeNovo).toHaveBeenCalledWith(base.slug));
    await waitFor(() => expect(carregar).toHaveBeenCalledTimes(2));

    fireEvent.click(linha.getByRole('button', { name: 'Informar título e artista' }));
    const dialogo = within(await screen.findByRole('dialog', { name: 'Identificar a obra' }));
    fireEvent.click(dialogo.getByRole('button', { name: 'Salvar e preparar de novo' }));
    expect(dialogo.getByRole('alert').textContent).toBe('Informe o título e o artista.');
    fireEvent.change(dialogo.getByLabelText('Título'), { target: { value: 'A Leiteira' } });
    fireEvent.change(dialogo.getByLabelText('Artista'), { target: { value: 'Vermeer' } });
    fireEvent.click(dialogo.getByRole('button', { name: 'Salvar e preparar de novo' }));
    await waitFor(() => expect(ops.corrigir).toHaveBeenCalledWith(base.slug, { titulo: 'A Leiteira', artista: 'Vermeer', ano: null }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Identificar a obra' })).toBeNull());

    fireEvent.click(linha.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(ops.remover).toHaveBeenCalledWith(base.slug));
    expect(confirmar).toHaveBeenCalledWith('Remover “IMG_2041”? A imagem e a análise saem da sua biblioteca.');
  });

  test('obra pronta da pessoa: o painel oferece corrigir e remover; as de exemplo, não', async () => {
    const ops = operacoes();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={vazio} carregarQuadros={() => Promise.resolve({ obras: [{ ...resumo, removivel: true }] })} operacoesDosQuadros={ops} />);
    await screen.findByRole('link', { name: 'Educação Obrigatória' });
    const painel = within(screen.getByRole('complementary', { name: 'Informações do quadro' }));
    fireEvent.click(painel.getByRole('button', { name: 'Remover' }));
    expect(ops.remover).not.toHaveBeenCalled(); // a pessoa desistiu na confirmação
    fireEvent.click(painel.getByRole('button', { name: 'Corrigir' }));
    expect(within(await screen.findByRole('dialog', { name: 'Identificar a obra' })).getByLabelText<HTMLInputElement>('Artista').value).toBe(modelo.identidade.artista);
    cleanup();
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={vazio} carregarQuadros={() => Promise.resolve({ obras: [{ ...resumo, exemplo: true }] })} />);
    await screen.findByRole('link', { name: 'Educação Obrigatória' });
    expect(within(screen.getByRole('complementary', { name: 'Informações do quadro' })).queryByRole('button', { name: 'Remover' })).toBeNull();
  });

  test('recusa local: limite de 40 MB e formatos', () => {
    expect(recusaDaImagem(new File(['x'], 'a.webp', { type: 'image/webp' }))).toBeNull();
    expect(recusaDaImagem(new File(['x'], 'a.PNG', { type: '' }))).toBeNull();
    const grande = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    Object.defineProperty(grande, 'size', { value: LIMITE_DA_IMAGEM_BYTES + 1 });
    expect(recusaDaImagem(grande)).toMatch(/40 MB/u);
    expect(recusaDaImagem(new File(['x'], 'foto.avif', { type: 'image/avif' }))).toMatch(/HEIC/u);
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
  test('quadro que não existe (ou ainda em preparo): aviso, sem quebrar', async () => {
    servir();
    render(<LeitorDeQuadro slug="nao-existe" ir={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/não está na sua biblioteca/);
  });
});

describe('obra não identificada (V-W5): análise só pela imagem', () => {
  const PALPITE = { texto: 'A pintura lembra cenas sentimentais britânicas do final do século XIX.', titulo: null, artista: null, ano: null, confianca: 'baixa' as const };
  const fonte = { id: '01AUT0IMAGEMENVIADA0000000', titulo: 'A imagem enviada', url: 'margem:quadros/obra-8x3t5k/imagem.jpg', categoria: 'imagem_enviada' as const, consultado_em: '2026-10-14' };
  const vistas = modelo.afirmacoes.filter((a) => a.tipo === 'observacao' || a.tipo === 'inferencia_ia').map((a) => ({ ...a, fontes: [] }));
  const soImagem: ModeloDaObraV1 = {
    ...modelo, identidade: { titulo: 'Obra não identificada', titulo_original: 'Obra não identificada', artista: 'Artista não identificado', data: 'Data não identificada', tecnica: 'Técnica não identificada', afirmacoes: [] },
    imagem: { ...modelo.imagem, fonte_id: fonte.id }, fontes: [fonte], afirmacoes: vistas, limites: ['Obra não identificada: análise só pela imagem, sem fontes históricas.'],
  };
  const detalheSo: DetalheDoQuadro = {
    ...detalhe, slug: 'obra-8x3t5k', imagem: { ...detalhe.imagem, info: null }, analises: [resumo.analises[0]!], removivel: true, nao_identificada: true, palpite: PALPITE,
    analise: { ...detalhe.analise, modelo: soImagem },
  };

  test('no leitor: "Analisada só pela imagem", o palpite como palpite, a imagem enviada sem link e informar título e artista', async () => {
    try { localStorage.setItem('margem:quadro:aba', 'info'); } catch { /* sem storage */ }
    const pedidos: { url: string; metodo: string; corpo: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, inicio?: RequestInit) => {
      pedidos.push({ url, metodo: inicio?.method ?? 'GET', corpo: typeof inicio?.body === 'string' ? inicio.body : null });
      const corpo = inicio?.method === 'PUT' ? { versao: 1, slug: 'obra-8x3t5k', estado: 'na_fila' } : detalheSo;
      return Promise.resolve(new Response(JSON.stringify(corpo), { status: inicio?.method === 'PUT' ? 202 : 200 }));
    }));
    const ir = vi.fn();
    render(<LeitorDeQuadro slug="obra-8x3t5k" ir={ir} />);
    const painel = within(await screen.findByRole('complementary', { name: 'Painel do quadro' }));
    expect(painel.getByRole('heading', { name: 'Obra não identificada' })).toBeTruthy();
    expect(painel.getByText('Analisada só pela imagem')).toBeTruthy();
    expect(painel.getByText('Palpite do Codex · confiança baixa')).toBeTruthy();
    expect(painel.getByText(PALPITE.texto)).toBeTruthy();
    expect(painel.queryByText('Localização')).toBeNull();
    // A imagem enviada é a única fonte, e não vira link.
    expect(painel.getByText('A imagem enviada').tagName).toBe('SPAN');
    fireEvent.click(painel.getByRole('tab', { name: /Análise/ }));
    expect(painel.getByText(/Só pela imagem: o que se vê/)).toBeTruthy();
    expect(painel.queryByText(/Fato documentado/)).toBeNull();
    fireEvent.click(painel.getByRole('tab', { name: /Info/ }));
    fireEvent.click(painel.getByRole('button', { name: 'Informar título e artista' }));
    const dialogo = within(await screen.findByRole('dialog', { name: 'Identificar a obra' }));
    expect(dialogo.getByLabelText<HTMLInputElement>('Título').value).toBe('');
    expect(dialogo.queryByRole('button', { name: 'Usar o palpite' })).toBeNull(); // o palpite não arriscou um nome
    fireEvent.change(dialogo.getByLabelText('Título'), { target: { value: 'Educação Obrigatória' } });
    fireEvent.change(dialogo.getByLabelText('Artista'), { target: { value: 'Briton Rivière' } });
    fireEvent.click(dialogo.getByRole('button', { name: 'Salvar e preparar de novo' }));
    await waitFor(() => expect(ir).toHaveBeenCalledWith({ nome: 'biblioteca', tipo: 'quadros' }));
    expect(pedidos.find((p) => p.metodo === 'PUT')).toMatchObject({ url: '/api/arte/obra-8x3t5k/identificacao', corpo: JSON.stringify({ titulo: 'Educação Obrigatória', artista: 'Briton Rivière', ano: null }) });
  });

  test('na Biblioteca: em preparo diz que segue só pela imagem; pronta, o painel oferece informar título e artista (campos vazios) e "Usar o palpite"', async () => {
    const vazio = () => Promise.resolve({ documentos: [] });
    const emPreparo: QuadroDaPessoaV1 = {
      versao: 1, id: '01JZ8X3T5K0000000000000002', slug: 'obra-9x3t5k', estado: 'preparando', etapa: 'analise', progresso: { feitas: 3, total: 7 }, identificacao: null, palpite: PALPITE,
      imagem: { formato: 'jpeg', bytes: 2_400_000, nome: 'Educação obrigatório.jpg' }, enviado_em: '2026-10-14T12:00:00.000Z',
    };
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={vazio} carregarQuadros={() => Promise.resolve({ obras: [], preparando: [emPreparo] })} />);
    expect((await screen.findAllByText('Analisando só pela imagem')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Não reconhecida: a análise segue só pela imagem/)).toBeTruthy();
    const painelPreparo = within(screen.getByRole('complementary', { name: 'Informações do quadro' }));
    expect(painelPreparo.getByText('Sendo analisada só pela imagem')).toBeTruthy();
    expect(painelPreparo.getByText(PALPITE.texto)).toBeTruthy();
    cleanup();

    const pronta: ResumoDoQuadro = { ...resumo, slug: 'obra-8x3t5k', titulo: 'Obra não identificada', titulo_original: 'Obra não identificada', artista: 'Artista não identificado', removivel: true, nao_identificada: true,
      palpite: { ...PALPITE, titulo: 'Educação Obrigatória', artista: 'Briton Rivière', ano: '1887', confianca: 'media' } };
    render(<Lista ir={vi.fn()} rota={{ nome: 'biblioteca', tipo: 'quadros' }} carregar={vazio} carregarQuadros={() => Promise.resolve({ obras: [pronta] })} />);
    await screen.findByRole('link', { name: 'Obra não identificada' });
    const painel = within(screen.getByRole('complementary', { name: 'Informações do quadro' }));
    expect(painel.getByText('Analisada só pela imagem')).toBeTruthy();
    expect(painel.getByText('Talvez «Educação Obrigatória», de Briton Rivière (1887).')).toBeTruthy();
    expect(painel.queryByText('Técnica')).toBeNull();
    fireEvent.click(painel.getByRole('button', { name: 'Informar título e artista' }));
    const dialogo = within(await screen.findByRole('dialog', { name: 'Identificar a obra' }));
    expect(dialogo.getByLabelText<HTMLInputElement>('Título').value).toBe('');
    expect(dialogo.getByLabelText<HTMLInputElement>('Artista').value).toBe('');
  });
});

test('"Usar o palpite" preenche título, artista e ano com o que o Codex arriscou', () => {
  render(<IdentificarObra quadro={{ slug: 'obra-8x3t5k', titulo: 'Obra não identificada', artista: 'Artista não identificado', ano: null }}
    palpite={{ texto: 'Menina com cão.', titulo: 'Educação Obrigatória', artista: 'Briton Rivière', ano: '1887', confianca: 'media' }} aoFechar={vi.fn()} aoSalvar={vi.fn()} />);
  const dialogo = within(screen.getByRole('dialog', { name: 'Identificar a obra' }));
  expect(dialogo.getByLabelText<HTMLInputElement>('Título').value).toBe('');
  expect(dialogo.getByText('Palpite do Codex · confiança média')).toBeTruthy();
  fireEvent.click(dialogo.getByRole('button', { name: 'Usar o palpite' }));
  expect(dialogo.getByLabelText<HTMLInputElement>('Título').value).toBe('Educação Obrigatória');
  expect(dialogo.getByLabelText<HTMLInputElement>('Artista').value).toBe('Briton Rivière');
  expect(dialogo.getByLabelText<HTMLInputElement>('Ano').value).toBe('1887');
});
