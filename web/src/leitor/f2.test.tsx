import { intervaloDoOffset, pontoDoNo } from './posicao';
import { escolherOpcao } from '../../tests/apoio-react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AnotacaoV1, ConversaV2, ModoDeLeituraV1 } from '@margem/contratos';
import dados from '../../tests/fixtures/j18.json';
import type { SnapshotCapitulo } from './tipos';
import { ChapterContent } from './ChapterContent';
import { ancoraDaSelecao } from './selecao';
import { ancoraDaFaixa } from './ancora';
import { CONVERSA_VAZIA, corDaFuncao, liberarPrimeiroEu, marcasVisiveis, pesoDaSaliencia, reduzirConversa } from './f2';
import { APARENCIA_PADRAO, reduzirPreferencias, validarPreferencias } from './preferencias';
import { FormularioDeAnotacao } from './FormularioDeAnotacao';
import { FioDeConversa } from './FioDeConversa';
import { ContextoDeAparencia } from './ContextoDeAparencia';
import { EstudoDoCapitulo } from './EstudoDoCapitulo';
import { conferirTextoAncora } from '@margem/contratos/regras';
const snapshot = dados.snapshot as SnapshotCapitulo;
const ancora = snapshot.marcas[0]!.ancora;
const anotacao: AnotacaoV1 = { versao: 1, revisao_edicao: 1, id: '00000000000000000000000201', versao_id: snapshot.versao_id, ancora, tipo: 'impressao', texto: 'O desejo não termina.', criada_em: '2026-09-24T12:00:00Z', atualizada_em: '2026-09-24T12:00:00Z' };
const conversa: ConversaV2 = { versao: 2, id: '00000000000000000000000301', versao_id: snapshot.versao_id, ancora, estado: 'aberta', criada_em: anotacao.criada_em, mensagens: [{ id: '00000000000000000000000302', autor: 'leitor', texto: 'Por que volta?', criada_em: anotacao.criada_em }] };
beforeEach(() => { vi.stubGlobal('innerWidth', 1440); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); window.getSelection()?.removeAllRanges(); });
function json(corpo: unknown, status = 200) { return new Response(JSON.stringify(corpo), { status }); }

/** O leitor pergunta ao abrir se o capítulo tem mídia (J71); o resto das chamadas é o que se quer contar. */
function semListasDeMidia(buscar: { mock: { calls: unknown[][] } }): unknown[][] {
  return buscar.mock.calls.filter((chamada) => !/\/(midias|audios|narracao)$/.test(String(chamada[0])));
}

describe('âncora da seleção', () => {
  const unicode: SnapshotCapitulo = { ...snapshot, marcas: [], blocos: [{ ...snapshot.blocos[1]!, texto: '  Ação 🧭 e café; ação.', inline: [{ inicio: 2, fim: 6, estilo: 'italico' }] }, { ...snapshot.blocos[2]!, texto: 'Outro bloco.' }] };
  test('acentos, combinantes, emoji e inline preservam os offsets UTF-16', () => {
    const { container } = render(<ChapterContent snapshot={unicode} />);
    const bloco = container.querySelector('[data-bloco]')!;
    const range = document.createRange();
    const spans = bloco.querySelectorAll('span[data-inicio]');
    range.setStart(spans[1]!.querySelector('em')!.firstChild!, 0);
    range.setEnd(spans[2]!.firstChild!, 15);
    const selecao = window.getSelection()!; selecao.addRange(range);
    const capturada = ancoraDaSelecao(selecao, container, unicode)!;
    expect(capturada.ancora.inicio_utf16).toBe(2);
    expect(capturada.ancora.citacao).toBe('Ação 🧭 e café; aç');
    expect(conferirTextoAncora(unicode.blocos[0]!, capturada.ancora)).toBe(true);
  });
  test('seleção inversa cruzada é aparada ao primeiro bloco na ordem do texto', () => {
    const { container } = render(<ChapterContent snapshot={unicode} />);
    const blocos = container.querySelectorAll('[data-bloco]');
    const selecao = window.getSelection()!;
    selecao.setBaseAndExtent(blocos[1]!.querySelector('.segmento')!.firstChild!, 5, blocos[0]!.querySelector('.segmento')!.firstChild!, 1);
    const capturada = ancoraDaSelecao(selecao, container, unicode)!;
    expect(capturada.aparada).toBe(true);
    expect(capturada.ancora.citacao).toBe(unicode.blocos[0]!.texto.slice(1));
  });
  test('limites em elementos e escolha do bloco inteiro são aceitos', () => {
    const { container } = render(<ChapterContent snapshot={unicode} />);
    const range = document.createRange(); range.selectNodeContents(container.querySelector('[data-bloco]')!);
    const selecao = window.getSelection()!; selecao.addRange(range);
    expect(ancoraDaSelecao(selecao, container, unicode)?.ancora.citacao).toBe(unicode.blocos[0]!.texto);
    selecao.removeAllRanges(); expect(ancoraDaSelecao(selecao, container, unicode)).toBeNull();
  });
  test('recusa intervalo inválido e expande um limite no meio do emoji', () => {
    const bloco = unicode.blocos[0]!;
    expect(ancoraDaFaixa(bloco, snapshot.versao_id, -1, 5)).toBeNull();
    expect(ancoraDaFaixa(bloco, snapshot.versao_id, 8, 9)?.citacao).toBe('🧭');
  });
});
describe('marcas à vista e primeiro eu', () => {
  test('sem níveis de atenção: todas as marcas (qualquer saliência) ou nenhuma; a preferência decide como o leitor abre', () => {
    expect(marcasVisiveis(snapshot.marcas, true)).toHaveLength(snapshot.marcas.length);
    expect(marcasVisiveis(snapshot.marcas, false)).toEqual([]);
    expect(APARENCIA_PADRAO.marcasAoAbrir).toBe(true);
    const p = reduzirPreferencias(APARENCIA_PADRAO, { tipo: 'alterar', valores: { marcasAoAbrir: false } });
    expect(p.marcasAoAbrir).toBe(false);
    expect(reduzirPreferencias(p, { tipo: 'restaurar' }).marcasAoAbrir).toBe(true);
    // O nível antigo guardado no navegador não vale mais: abre com todas as marcas.
    expect(validarPreferencias({ nivelDeAtencao: 0 }).marcasAoAbrir).toBe(true);
    expect('nivelDeAtencao' in validarPreferencias({ nivelDeAtencao: 0 })).toBe(false);
  });
  test('a saliência não muda mais o desenho: todas as marcas pesam igual', () => {
    const base = snapshot.marcas[0]!;
    const com = (saliencia: 1 | 2 | 3) => pesoDaSaliencia({ ...base, saliencia });
    expect(com(3)).toEqual(com(1));
    expect(com(2)).toEqual(com(1));
    expect(com(1)).toMatchObject({ fator: 1, soSublinhado: false });
  });
  test('só a anotação deste capítulo libera; apagar a última volta a esconder', () => {
    expect(liberarPrimeiroEu(true, [], snapshot.blocos)).toBe(false);
    expect(liberarPrimeiroEu(true, [{ ...anotacao, ancora: { ...ancora, bloco_id: 'outro' } }], snapshot.blocos)).toBe(false);
    expect(liberarPrimeiroEu(true, [anotacao], snapshot.blocos)).toBe(true);
    expect(liberarPrimeiroEu(false, [], snapshot.blocos)).toBe(true);
    // A nota agora é do grifo: um grifo do leitor no capítulo também libera; o da IA, não.
    const marca = snapshot.marcas[0]!;
    expect(liberarPrimeiroEu(true, [], snapshot.blocos, [{ ...marca, origem: 'manual' }])).toBe(true);
    expect(liberarPrimeiroEu(true, [], snapshot.blocos, [{ ...marca, origem: 'manual', ancora: { ...marca.ancora, bloco_id: 'outro' } }])).toBe(false);
    expect(liberarPrimeiroEu(true, [], snapshot.blocos, [{ ...marca, origem: 'parte' }])).toBe(false);
  });
  test('primeira anotação libera no mesmo componente e "Marcas" tira marcas e notas', () => {
    const props = { documento_id: dados.snapshot.documento_id, aoAtualizar: async () => {} };
    const { container, rerender } = render(<ContextoDeAparencia><EstudoDoCapitulo {...props} snapshot={{ ...snapshot, primeiro_eu: { ativo: true, liberado: false } }} /></ContextoDeAparencia>);
    expect(container.querySelector('[data-marcas]')).toBeNull();
    expect(screen.getByText(/As marcas da IA aparecem/)).toBeDefined();
    rerender(<ContextoDeAparencia><EstudoDoCapitulo {...props} snapshot={{ ...snapshot, anotacoes: [anotacao], primeiro_eu: { ativo: true, liberado: true } }} /></ContextoDeAparencia>);
    expect(container.querySelector('[data-marcas]')).not.toBeNull();
    expect(screen.queryByText(/As marcas da IA aparecem/)).toBeNull();
    // "Marcas" na barra esconde todas (as do leitor também) e mostra de novo.
    const botao = screen.getByRole('button', { name: 'Marcas' });
    expect(botao.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(botao);
    expect(container.querySelector('[data-marcas]')).toBeNull();
    expect(container.querySelector('[data-pessoal]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Marcas' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Marcas' }));
    expect(container.querySelector('[data-marcas]')).not.toBeNull();
  });
});
test('estrofes preservam todos os versos e espaços, inclusive com marca atravessando linhas', () => {
  const bloco = { ...snapshot.blocos[1]!, texto: '  Ação 🧭\n    outra linha\nFim' };
  const a = ancoraDaFaixa(bloco, snapshot.versao_id, 2, 21)!;
  const { container } = render(<ChapterContent snapshot={{ ...snapshot, blocos: [bloco], marcas: [{ ...snapshot.marcas[0]!, ancora: a }] }} />);
  expect(container.querySelector('.bloco-estrofe')?.textContent).toBe(bloco.texto);
  expect([...container.querySelectorAll('.segmento')].map((s) => s.textContent).join('')).toBe(bloco.texto);
  expect([...container.querySelectorAll('.verso')].map((v) => v.textContent)).toEqual(['  Ação 🧭\n', '    outra linha\n', 'Fim']);
  expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  const capitulo = { ...snapshot, blocos: [bloco] };
  for (const offset of [0, 2, 7, 10, 14, 22, bloco.texto.length]) {
    const intervalo = intervaloDoOffset(container, bloco.id, offset)!;
    expect(pontoDoNo(intervalo.startContainer, intervalo.startOffset, capitulo)).toEqual({ bloco_id: bloco.id, offset_utf16: offset });
  }
});
test('cores do modo acompanham tema e a sobreposição da aparência vence', () => {
  const modos = structuredClone(dados.modos) as ModoDeLeituraV1[];
  modos[0]!.funcoes[0]!.cor.escuro = '#112233';
  const modo = { id: 'literaria', revisao: 1 };
  expect(corDaFuncao('imagem', modo, modos, APARENCIA_PADRAO, false)).toBe('#FFD926');
  expect(corDaFuncao('imagem', modo, modos, APARENCIA_PADRAO, true)).toBe('#112233');
  expect(corDaFuncao('imagem', modo, modos, { ...APARENCIA_PADRAO, coresPersonalizadas: { imagem: '#abcdef' } }, true)).toBe('#abcdef');
});
describe('conversa', () => {
  test('redutor ignora resposta atrasada de outro fio', () => {
    const aberta = reduzirConversa(CONVERSA_VAZIA, { tipo: 'abrir', id: conversa.id });
    expect(reduzirConversa(aberta, { tipo: 'receber', id: 'outro', conversa, pendentes: [] })).toBe(aberta);
    expect(reduzirConversa(aberta, { tipo: 'receber', id: conversa.id, conversa, pendentes: [] }).conversa).toBe(conversa);
    expect(reduzirConversa(aberta, { tipo: 'fechar' })).toEqual(CONVERSA_VAZIA);
  });
  test('SSE relê o fio, renderiza texto literal e citações operáveis, fecha conexão ao sair', async () => {
    const eventos: EventTarget[] = [];
    const fechar = vi.fn();
    class EventosFalsos extends EventTarget { close = fechar; constructor() { super(); eventos.push(this); } }
    vi.stubGlobal('EventSource', EventosFalsos);
    let respondeu = false;
    const buscar = vi.fn(() => Promise.resolve(json({ conversa: respondeu ? { ...conversa, mensagens: [...conversa.mensagens, { id: 'resposta', autor: 'ia', texto: '<script>literal</script>', citacoes: [ancora], criada_em: anotacao.criada_em }] } : conversa, pendentes: respondeu ? [] : [{ mensagem_id: 'pergunta', job_id: 'job', estado: 'fila' }] })));
    vi.stubGlobal('fetch', buscar);
    const aoCitar = vi.fn();
    const { container, unmount } = render(<FioDeConversa id={conversa.id} ancora={ancora} documentoId={dados.snapshot.documento_id} conexoes={[]} aoCriar={() => {}} aoMudar={() => {}} aoCitar={aoCitar} />);
    await screen.findByText('lendo o capítulo…');
    respondeu = true;
    eventos[0]!.dispatchEvent(new MessageEvent('resposta_publicada', { data: JSON.stringify({ documento_id: dados.snapshot.documento_id, job_tipo: 'responder' }) }));
    await screen.findByText('<script>literal</script>');
    expect(container.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `“${ancora.citacao}”` }));
    expect(aoCitar).toHaveBeenCalledWith(ancora);
    expect(buscar).toHaveBeenCalledTimes(2);
    unmount(); expect(fechar).toHaveBeenCalledOnce();
  });
});
test('anotação fonte só grava no envio explícito e PATCH remove fonte ao mudar de tipo', async () => {
  const fetch = vi.fn(() => Promise.resolve(json({ anotacao })));
  vi.stubGlobal('fetch', fetch);
  const fonte: AnotacaoV1 = { ...anotacao, tipo: 'fonte', fonte: { titulo: 'Estudo', pagina: 'xii', url: 'https://exemplo.test' } };
  render(<FormularioDeAnotacao ancora={ancora} anotacao={fonte} aoSalvar={() => {}} aoFechar={() => {}} />);
  expect(fetch).not.toHaveBeenCalled();
  escolherOpcao('Tipo de anotação', 'Observação');
  fireEvent.submit(screen.getByRole('form', { name: 'Editar anotação' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const opcoes = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(opcoes.method).toBe('PATCH');
  expect(JSON.parse(typeof opcoes.body === 'string' ? opcoes.body : '{}')).toMatchObject({ tipo: 'observacao', fonte: null });
  expect(opcoes.headers).toMatchObject({ 'X-Margem': '1' });
});

/** Chamadas à API além da leitura dos visuais do capítulo (J70), que o leitor faz ao abrir. */
function semLeituraDosVisuais(buscar: { mock: { calls: unknown[][] } }): unknown[][] {
  return buscar.mock.calls.filter((chamada) => !(typeof chamada[0] === 'string' && chamada[0].endsWith('/visuais')));
}

/** Tira as leituras de fundo do estudo (mídias, áudios, narração gerada e visuais), que não são escritas. */
function semLeiturasDeFundo(buscar: { mock: { calls: unknown[][] } }): unknown[][] {
  return semLeituraDosVisuais({ mock: { calls: semListasDeMidia(buscar) } });
}

test('seleção só abre ações, sem Anotar; a tecla a não faz nada, p pergunta e Esc cancela sem escrever', async () => {
  const buscar = vi.fn(); vi.stubGlobal('fetch', buscar);
  const { container } = render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={snapshot} aoAtualizar={async () => {}} />);
  const range = document.createRange();
  range.selectNodeContents(container.querySelector('.bloco-estrofe .segmento')!);
  const selecao = window.getSelection()!; selecao.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  const barra = await screen.findByRole('toolbar', { name: 'Ações da seleção' });
  expect(barra.classList.contains('barra-selecao')).toBe(true);
  const acoes = within(barra).getAllByRole('button').map((botao) => botao.getAttribute('aria-label') ?? botao.textContent);
  expect(acoes).toEqual(['Grifar como Tese', 'Grifar como Conceito', 'Grifar como Justificativa', 'Grifar', 'Perguntar', 'Conectar', 'Mais ações', 'Fechar seleção']);
  fireEvent.click(within(barra).getByRole('button', { name: 'Mais ações' }));
  expect(within(barra).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Grifar com outro olhar…', 'Criar flashcard', 'Criar imagem', 'Fluxograma', 'Resolver exercício', 'Copiar texto']);
  expect(semLeiturasDeFundo(buscar)).toEqual([]);
  fireEvent.keyDown(window, { key: 'a' });
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.getByRole('toolbar', { name: 'Ações da seleção' })).toBeDefined();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('toolbar', { name: 'Ações da seleção' })).toBeNull();
  expect(semLeiturasDeFundo(buscar)).toEqual([]);
});

test('conexão externa envia caminho e título sem criar id, e recusa explícita envia rejeitada', async () => {
  const { FormularioDeConexao, ListaDeConexoes } = await import('./Conexoes');
  const corpos: unknown[] = [];
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, opcoes: RequestInit) => {
    urls.push(url); corpos.push(JSON.parse(typeof opcoes.body === 'string' ? opcoes.body : '{}'));
    return Promise.resolve(json({ conexao: {} }));
  }));
  const { unmount } = render(<FormularioDeConexao origem={ancora} aoSalvar={() => {}} aoFechar={() => {}} />);
  escolherOpcao('Tipo de destino', 'Nota externa');
  fireEvent.change(screen.getByLabelText('Caminho da nota'), { target: { value: 'poemas/desejo.md' } });
  fireEvent.change(screen.getByLabelText('Título da nota'), { target: { value: 'Desejo' } });
  fireEvent.change(screen.getByLabelText('O que conecta os dois?'), { target: { value: 'O desejo se renova.' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Conectar trecho' }));
  await waitFor(() => expect(corpos).toHaveLength(1));
  expect(corpos[0]).toEqual({ origem: ancora, destino: { tipo: 'nota_externa', caminho: 'poemas/desejo.md', titulo: 'Desejo' }, relacao: 'semelhanca', justificativa: 'O desejo se renova.' });
  unmount();
  render(<ListaDeConexoes conexoes={[{ versao: 2, id: 'sugestao', origem: ancora, destino: { tipo: 'trecho', ancora: snapshot.marcas[3]!.ancora }, relacao: 'contraste', justificativa: 'Volta ao começo.', autor: 'ia', estado: 'sugerida', criada_em: anotacao.criada_em }]} aoMudar={() => {}} aoCitar={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rejeitar' }));
  await waitFor(() => expect(corpos).toHaveLength(2));
  expect(corpos[1]).toEqual({ estado: 'rejeitada' });
  expect(urls).toEqual(['/api/conexoes', '/api/conexoes/sugestao/decidir']);
});


test('perguntar abre o painel do trecho (não a margem), com a citação uma vez; trocar de aba guarda a pergunta não enviada', async () => {
  const buscar = vi.fn(); vi.stubGlobal('fetch', buscar);
  const { container } = render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={snapshot} aoAtualizar={async () => {}} />);
  const intervalo = document.createRange(); intervalo.selectNodeContents(container.querySelector('.bloco-estrofe .segmento')!);
  window.getSelection()!.addRange(intervalo);
  fireEvent(document, new Event('selectionchange'));
  await screen.findByRole('toolbar', { name: 'Ações da seleção' });
  fireEvent.keyDown(window, { key: 'p' });
  const painel = screen.getByRole('complementary', { name: 'Perguntar' });
  expect(painel.classList.contains('painel-do-leitor')).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(painel.querySelectorAll('blockquote')).toHaveLength(1);
  fireEvent.change(screen.getByRole('textbox', { name: 'Sua pergunta' }), { target: { value: 'Por que este verso volta?' } });
  fireEvent.click(within(painel).getByRole('radio', { name: 'Nota' }));
  expect(screen.getByRole('complementary', { name: 'Nota do trecho' })).toBeDefined();
  // O trecho já é um grifo do fixture: a aba Nota mostra a nota dele (uma só, sem tipo).
  expect(screen.getByRole('region', { name: 'Nota do grifo' })).toBeDefined();
  fireEvent.click(screen.getByRole('radio', { name: 'Perguntar' }));
  expect(screen.getByRole('textbox', { name: 'Sua pergunta' })).toHaveProperty('value', 'Por que este verso volta?');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('complementary', { name: 'Perguntar' })).toBeNull();
  expect(semLeiturasDeFundo(buscar)).toEqual([]);
});

test('J71: capítulo com vídeo abre o player parado, com o karaokê no próprio texto; sem mídia, nada aparece', async () => {
  const bloco = snapshot.blocos[0]!;
  const midia = {
    versao: 1, id: '0000000000000000000000M001', documento_id: dados.snapshot.documento_id, versao_id: snapshot.versao_id, tipo: 'video', titulo: 'Vídeo',
    sha256: 'a'.repeat(64), mime: 'video/mp4', bytes: 10, duracao_s: 10, largura: 640, altura: 360, fonte: null,
    transcricao: { motor: 'teste', idioma: 'pt', sha256: 'b'.repeat(64) }, capitulos: [{ inicio_s: 0, titulo: 'Abertura' }],
    palavras: [{ bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: 3, inicio_s: 0, fim_s: 1 }],
    frases: [{ bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: 3, inicio_s: 0, fim_s: 1 }],
  };
  const buscar = vi.fn((url: string) => Promise.resolve(json(url.endsWith('/midias') ? { midias: [midia] } : url.endsWith('/audios') ? { audios: [] } : url.endsWith('/visuais') ? { visuais: [] } : {})));
  vi.stubGlobal('fetch', buscar);
  const { unmount } = render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={snapshot} aoAtualizar={async () => {}} />);
  await screen.findByRole('region', { name: 'Reprodução' });
  const video = document.querySelector('video')!;
  expect(video.getAttribute('src')).toBe(`/api/midias/${midia.id}/arquivo`);
  expect(video.autoplay).toBe(false);
  expect(screen.getByRole('button', { name: 'Tocar' })).toBeDefined();
  expect(document.documentElement.classList.contains('com-player')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Fechar o player' }));
  expect(screen.queryByRole('region', { name: 'Reprodução' })).toBeNull();
  expect(document.documentElement.classList.contains('com-player')).toBe(false);
  unmount();
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(json(url.endsWith('/midias') ? { midias: [] } : url.endsWith('/visuais') ? { visuais: [] } : { audios: [] }))));
  render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={snapshot} aoAtualizar={async () => {}} />);
  // Mídias, áudios, visuais e a situação da narração gerada (J106).
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4));
  expect(screen.queryByRole('region', { name: 'Reprodução' })).toBeNull();
});

test('painel do documento lista conversas e abre o fio existente sem empilhar a lateral', async () => {
  vi.stubGlobal('innerWidth', 390);
  // As leituras de fundo do estudo (mídias, áudios, visuais) respondem vazias; o resto é o fio.
  const buscar = vi.fn((url: string) => Promise.resolve(json(url.endsWith('/midias') ? { midias: [] } : url.endsWith('/audios') ? { audios: [] } : url.endsWith('/visuais') ? { visuais: [] } : { conversa, pendentes: [] })));
  vi.stubGlobal('fetch', buscar);
  render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} aoAtualizar={async () => {}}
    snapshot={{ ...snapshot, conversas: [{ id: conversa.id, ancora, estado: conversa.estado, criada_em: conversa.criada_em, mensagens: 1, ultima: conversa.mensagens[0]! }] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Painel do documento' }));
  fireEvent.click(screen.getByRole('tab', { name: /Conversas 1/ }));
  expect(screen.getByText('Selecione um trecho e use Perguntar (p) para conversar ancorado no texto.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: new RegExp('aberta · 1 mensagens') }));
  expect(screen.queryByRole('complementary', { name: 'Painel do documento' })).toBeNull();
  expect(screen.getByRole('complementary', { name: 'Perguntar' })).toBeTruthy();
  await waitFor(() => expect(screen.getByText('Por que volta?')).toBeTruthy());
  expect(semLeiturasDeFundo(buscar).length).toBeGreaterThan(0);
});

test('aba Conversas sem fios mostra convite sem inventar entrada de pergunta livre', () => {
  render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} aoAtualizar={async () => {}} snapshot={{ ...snapshot, conversas: [] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Painel do documento' }));
  fireEvent.click(screen.getByRole('tab', { name: /Conversas 0/ }));
  expect(screen.getByText('Pronto quando você estiver')).toBeTruthy();
  expect(screen.queryByPlaceholderText('Pergunte sobre o capítulo…')).toBeNull();
});

test('notas-sync: duplo envio fica bloqueado e tentativa após falha conserva a chave de criação', async () => {
  let falhar: (erro: Error) => void = () => {};
  const buscar = vi.fn().mockImplementationOnce(() => new Promise<Response>((_resolver, rejeitar) => { falhar = rejeitar; }))
    .mockResolvedValue(json({ anotacao }));
  vi.stubGlobal('fetch', buscar);
  const salvar = vi.fn();
  render(<FormularioDeAnotacao ancora={ancora} aoSalvar={salvar} aoFechar={() => {}} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Sua nota' }), { target: { value: 'Minha nota' } });
  const formulario = screen.getByRole('form', { name: 'Nota do grifo' });
  fireEvent.submit(formulario); fireEvent.submit(formulario);
  expect(buscar).toHaveBeenCalledTimes(1);
  falhar(new Error('Rede indisponível'));
  await screen.findByRole('alert');
  fireEvent.submit(formulario);
  await waitFor(() => expect(salvar).toHaveBeenCalledOnce());
  const corpos = buscar.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string) as { chave_cliente: string });
  expect(corpos[0]!.chave_cliente).toMatch(/^[0-9a-f-]{36}$/);
  expect(corpos[1]!.chave_cliente).toBe(corpos[0]!.chave_cliente);
});

test('notas-sync: edição obsoleta avisa, carrega texto atual e só reenvia por decisão do leitor', async () => {
  const atual = { ...anotacao, texto: 'Texto do outro aparelho', revisao_edicao: 2 };
  const buscar = vi.fn().mockResolvedValueOnce(json({ erro: 'anotacao_obsoleta', anotacao: atual, revisao_atual: 2 }, 409))
    .mockResolvedValue(json({ anotacao: { ...atual, revisao_edicao: 3 } }));
  vi.stubGlobal('fetch', buscar);
  const recarregar = vi.fn();
  const salvar = vi.fn();
  render(<FormularioDeAnotacao ancora={ancora} anotacao={anotacao} aoSalvar={salvar} aoConflito={recarregar} aoFechar={() => {}} />);
  fireEvent.submit(screen.getByRole('form', { name: 'Editar anotação' }));
  expect((await screen.findByRole('alert')).textContent).toContain('mudou em outro lugar');
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Sua anotação' }).value).toBe(atual.texto);
  expect(salvar).not.toHaveBeenCalled();
  expect(recarregar).toHaveBeenCalledOnce();
  expect(buscar).toHaveBeenCalledOnce();
  fireEvent.submit(screen.getByRole('form', { name: 'Editar anotação' }));
  await waitFor(() => expect(salvar).toHaveBeenCalledOnce());
  expect(JSON.parse((buscar.mock.calls[1]![1] as RequestInit).body as string)).toMatchObject({ texto: atual.texto, revisao: 2 });
});

test('nota do grifo: na margem é uma linha ✎ ligada ao grifo (sem card de tipo), que abre o balão; apagar o texto tira a nota com a revisão', async () => {
  const marca = { ...snapshot.marcas[0]!, origem: 'manual', comentario: null } as typeof snapshot.marcas[number];
  const nota: AnotacaoV1 = { ...anotacao, tipo: 'nota', marca_id: marca.id };
  const buscar = vi.fn((url: string, opcoes?: RequestInit) => Promise.resolve(url.includes('/nota-do-leitor')
    ? json(opcoes?.method === 'DELETE' ? { marca_id: marca.id, apagada: true } : {})
    : json({ visuais: [], midias: [], audios: [] })));
  vi.stubGlobal('fetch', buscar);
  render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={{ ...snapshot, marcas: [marca, ...snapshot.marcas.slice(1)], anotacoes: [nota] }} aoAtualizar={() => Promise.resolve()} />);
  expect(screen.queryByText(/IMPRESSÃO|Impressão/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Sua anotação: O desejo não termina/ }));
  const campo = await screen.findByRole('textbox', { name: 'Sua anotação' });
  expect(campo).toHaveProperty('value', 'O desejo não termina.');
  fireEvent.change(campo, { target: { value: '' } });
  fireEvent.blur(campo);
  await waitFor(() => expect(buscar.mock.calls.some((c) => c[0].includes('/nota-do-leitor'))).toBe(true));
  const escrita = buscar.mock.calls.find((c) => c[0].includes('/nota-do-leitor')) as unknown as [string, RequestInit];
  expect(escrita[1].method).toBe('DELETE');
  expect(JSON.parse(escrita[1].body as string)).toEqual({ revisao: 1 });
});

test('PDF anotado: só documento PDF com geometria tem o botão; baixar avisa as marcas sem posição', async () => {
  const buscar = vi.fn((url: string) => Promise.resolve(url.endsWith('/pdf-anotado')
    ? new Response(new Blob(['%PDF']), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': "attachment; filename=\"anotado.pdf\"; filename*=UTF-8''Livro%20(anotado).pdf", 'X-Margem-Sem-Geometria': '2' } })
    : json(url.endsWith('/midias') ? { midias: [] } : url.endsWith('/visuais') ? { visuais: [] } : { audios: [] })));
  vi.stubGlobal('fetch', buscar);
  // O jsdom não tem URL de blob.
  Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
  const { unmount } = render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={snapshot} aoAtualizar={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mais opções do leitor' }));
  expect(screen.queryByRole('button', { name: /Baixar PDF anotado/ })).toBeNull();
  unmount();
  render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={{ ...snapshot, formato: 'pdf', geometria_disponivel: true }} aoAtualizar={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mais opções do leitor' }));
  const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  fireEvent.click(screen.getByRole('button', { name: /Baixar PDF anotado/ }));
  expect(await screen.findByText(/2 marcas ou notas ficaram fora do PDF anotado/)).toBeDefined();
  expect(buscar).toHaveBeenCalledWith(`/api/versoes/${snapshot.versao_id}/pdf-anotado`);
  expect(clique).toHaveBeenCalledOnce();
  expect((clique.mock.contexts[0] as HTMLAnchorElement).download).toBe('Livro (anotado).pdf');
  clique.mockRestore();
});

test('conectar: o primeiro trecho fica marcado, escolhe-se o segundo (sem grifo) e um diálogo pequeno pede só a relação; flashcard no painel do trecho', async () => {
  const { ContextoDeConexao } = await import('./ContextoDeConexao');
  const corpos: { url: string; corpo: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, opcoes?: RequestInit) => {
    if (opcoes?.method === 'POST') corpos.push({ url, corpo: JSON.parse(typeof opcoes.body === 'string' ? opcoes.body : '{}') });
    return Promise.resolve(json(url === '/api/conexoes' ? { conexao: {} } : { midias: [], audios: [], visuais: [] }));
  }));
  const { container } = render(<ContextoDeConexao><EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={snapshot} aoAtualizar={async () => {}} /></ContextoDeConexao>);
  const selecionar = async (seletor: string) => {
    const intervalo = document.createRange(); intervalo.selectNodeContents(container.querySelectorAll(seletor)[0]!);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(intervalo);
    fireEvent(document, new Event('selectionchange'));
    return screen.findByRole('toolbar', { name: 'Ações da seleção' });
  };
  expect(container.querySelectorAll('.bloco-estrofe').length).toBeGreaterThan(1);
  fireEvent.click(within(await selecionar('.bloco-estrofe .segmento')).getByRole('button', { name: 'Conectar' }));
  expect(document.querySelector('.painel-trecho')).toBeNull();
  expect(screen.getByText(/Selecione o outro trecho/)).toBeDefined();
  // O segundo trecho: outra estrofe.
  const intervalo = document.createRange(); intervalo.selectNodeContents(container.querySelectorAll('.bloco-estrofe')[1]!.querySelector('.segmento')!);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(intervalo);
  fireEvent(document, new Event('selectionchange'));
  const barra = await screen.findByRole('toolbar', { name: 'Ações da seleção' });
  fireEvent.click(within(barra).getByRole('button', { name: /Conectar estes dois/ }));
  const dialogo = screen.getByRole('dialog', { name: 'Conectar estes dois trechos' });
  expect(dialogo.querySelectorAll('.ui-primario')).toHaveLength(1);
  fireEvent.submit(within(dialogo).getByRole('button', { name: 'Conectar' }).closest('form')!);
  await waitFor(() => expect(corpos.some((c) => c.url === '/api/conexoes')).toBe(true));
  expect(corpos.find((c) => c.url === '/api/conexoes')!.corpo).toMatchObject({ relacao: 'desenvolve', justificativa: 'Desenvolve', destino: { tipo: 'trecho' } });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const nova = await selecionar('.bloco-estrofe .segmento');
  fireEvent.click(within(nova).getByRole('button', { name: 'Mais ações' }));
  fireEvent.click(within(nova).getByRole('menuitem', { name: 'Criar flashcard' }));
  const flashcard = screen.getByRole('complementary', { name: 'Novo flashcard' });
  expect(flashcard.querySelectorAll('blockquote')).toHaveLength(1);
  expect(flashcard.querySelectorAll('.ui-primario')).toHaveLength(1);
});
