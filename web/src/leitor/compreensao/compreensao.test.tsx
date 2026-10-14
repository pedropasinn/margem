// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ModeloDoCapituloV1, PlanoPedagogicoV1 } from '@margem/contratos';
import type { ApiDoLeitor } from '../tipos';
import { AdotarRelacao, Braquetes, ESPERA_PARA_ACENDER_MS, type FontesDosBraquetes } from './Braquetes';
import { distribuirEmPistas } from './geometria';
import { PerfilDoLeitor, type FontesDoPerfil } from './PerfilDoLeitor';
import { compreensaoDaCamada, useCompreensao, type FontesDaCompreensao } from './useCompreensao';

afterEach(() => { cleanup(); vi.useRealTimers(); try { localStorage.clear(); } catch { /* sem storage */ } });

const id = (n: number): string => String(n).padStart(26, '0');
const V = id(20);
const blocos = [{ id: id(1), texto: 'Admitamos inicialmente que os preços são rígidos.' }, { id: id(2), texto: 'Logo, o produto cai.' }];

function retangulo(topo: number, altura: number): DOMRect {
  return { top: topo, bottom: topo + altura, left: 400, right: 1100, width: 700, height: altura, x: 400, y: topo, toJSON: () => ({}) };
}
/** Leitor falso: o bloco 1 ocupa 100–160 px, o bloco 2, 400–430 px. */
function leitorFalso(): { current: ApiDoLeitor } {
  const posicao: Record<string, [number, number]> = { [id(1)]: [100, 60], [id(2)]: [400, 30] };
  return {
    current: {
      localizar: () => null, ancoraVisivel: () => null,
      retangulosDaAncora: (ancora) => { const [topo, altura] = posicao[ancora.bloco_id] ?? [0, 0]; return [retangulo(topo, altura)]; },
    },
  };
}

function modelo(): ModeloDoCapituloV1 {
  const ancora = (bloco: number, citacao: string) => ({ versao_id: V, bloco_id: id(bloco), inicio_utf16: 0, fim_utf16: citacao.length, citacao, prefixo: '', sufixo: '' });
  const origem = { estagio: 'revisao' as const, job_id: id(90) };
  return {
    versao: 1, id: id(503), execucao_id: id(40), versao_id: V, secao_id: id(60), modo: { id: 'argumentativa', revisao: 1 }, revisao: 2, estagio: 'revisao',
    base_id: id(502), lote_id: id(601), movimento: null, unidades: [],
    elementos: [
      { id: id(101), nucleo: 'hipotese', papel: 'conceito', ancoras: [ancora(1, 'Admitamos inicialmente')], enunciado: 'h', qualificadores: [], centralidade: 1, notas: [], origem },
      { id: id(102), nucleo: 'afirmacao', papel: 'tese', ancoras: [ancora(2, 'Logo, o produto cai.')], enunciado: 't', qualificadores: [], centralidade: 1, notas: [], origem },
    ],
    relacoes: [{ id: id(201), tipo: 'pressupoe', origem_id: id(102), destino_id: id(101), explicacao: 'A conclusão usa a rigidez.', confianca: 'alta', retrospectiva: true, origem }],
    dificuldades: [], criada_em: '2026-09-25T12:00:00Z',
  };
}
function plano(): PlanoPedagogicoV1 {
  return {
    versao: 1, id: id(701), execucao_id: id(40), secao_id: id(60), modelo_id: id(503), perfil_hash: 'a'.repeat(64), job_id: id(93), criado_em: '2026-09-25T12:00:00Z',
    passos: [
      { ordem: 0, bloco_inicio: id(1), bloco_fim: id(1), foco: [id(101)], observar: 'Repare no “inicialmente”.', explicacao: { curta: 'c', longa: 'A hipótese é provisória.' },
        relacoes: [], parada: { tipo: 'pergunta', texto: 'E se os preços fossem flexíveis?' } },
      { ordem: 1, bloco_inicio: id(2), bloco_fim: id(2), foco: [id(102)], observar: 'A conclusão.', explicacao: { curta: 'c', longa: 'Sai da hipótese.' }, relacoes: [id(201)], parada: null },
    ],
    apoios: [{ alvo_id: id(101), tipo: 'exemplo', texto: 'Pense num cardápio impresso.' }],
  };
}

test('só a camada de uma compreensão ativa a compreensão', () => {
  const camadas = [{ id: 'A', tipo: 'execucao' as const, modo: { id: 'argumentativa', revisao: 1 }, criada_em: '2026-09-25T00:00:00Z', marcas: 1, compreensao: true },
    { id: 'B', tipo: 'execucao' as const, modo: { id: 'argumentativa', revisao: 1 }, criada_em: '2026-09-25T00:00:00Z', marcas: 1 }];
  expect(compreensaoDaCamada('A', camadas)).toBe('A');
  expect(compreensaoDaCamada('B', camadas)).toBeNull();
  expect(compreensaoDaCamada('todas', camadas)).toBeNull();
  expect(compreensaoDaCamada(undefined, camadas)).toBeNull();
});

test('abrir um capítulo não preparado pede a preparação e acompanha até ficar pronto', async () => {
  const respostas = ['nao_preparado', 'preparando', 'pronto'] as const;
  let consulta = 0;
  const fontes: FontesDaCompreensao = {
    capitulo: vi.fn(() => {
      const visivel = respostas[Math.min(consulta++, 2)] ?? 'pronto';
      return Promise.resolve({ estado: visivel, visivel, modelo: visivel === 'pronto' ? modelo() : null, plano: visivel === 'pronto' ? plano() : null, plano_do_perfil_atual: true });
    }),
    preparar: vi.fn(() => Promise.resolve({ estado: 'na_fila', visivel: 'preparando' as const, seguinte: null })),
  };
  const { result } = renderHook(() => useCompreensao('C', id(60), fontes, 5));
  await waitFor(() => expect(result.current.visivel).toBe('pronto'));
  expect(fontes.preparar).toHaveBeenCalledTimes(1);
  expect(fontes.preparar).toHaveBeenCalledWith('C', id(60), true);
  expect(result.current.plano?.id).toBe(id(701));
  const semCompreensao = renderHook(() => useCompreensao(null, id(60), fontes, 5));
  expect(semCompreensao.result.current.visivel).toBeNull();
});

test('tentar de novo depois da falha volta a acompanhar até ficar pronto', async () => {
  const respostas = ['falhou', 'preparando', 'pronto'] as const;
  let consulta = 0;
  const fontes: FontesDaCompreensao = {
    capitulo: vi.fn(() => {
      const visivel = respostas[Math.min(consulta++, 2)] ?? 'pronto';
      return Promise.resolve({ estado: visivel, visivel, modelo: null, plano: null, plano_do_perfil_atual: true });
    }),
    preparar: vi.fn(() => Promise.resolve({ estado: 'na_fila', visivel: 'preparando' as const, seguinte: null })),
  };
  const { result } = renderHook(() => useCompreensao('C', id(61), fontes, 5));
  await waitFor(() => expect(result.current.visivel).toBe('falhou'));
  result.current.preparar();
  await waitFor(() => expect(result.current.visivel).toBe('pronto'));
  expect(fontes.capitulo).toHaveBeenCalledTimes(3);
  // O botão pede que os jobs que falharam voltem à fila (antes, "tentar de novo" não refazia nada).
  expect(fontes.preparar).toHaveBeenCalledWith('C', id(61), true, true);
});

test('braquetes no celular: pilhas na lateral esquerda; tocar abre a folha e esconde as outras', async () => {
  vi.stubGlobal('matchMedia', (consulta: string) => ({ matches: consulta.includes('max-width'), media: consulta, addEventListener: () => undefined, removeEventListener: () => undefined }));
  const rolar = vi.fn();
  window.scrollBy = rolar;
  try {
    const fontes: FontesDosBraquetes = {
      relacoes: vi.fn(() => Promise.resolve({ relacoes: [{ relacao: modelo().relacoes[0]!, relevante: true, origem: modelo().elementos[1], destino: modelo().elementos[0], conexao_id: null }] })),
    };
    const { container } = render(<Braquetes compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="relevantes" leitor={leitorFalso()} coluna={() => retangulo(0, 1000)} fontes={fontes} />);
    const pontos = await screen.findAllByRole('button', { name: '1 relação nesta linha' });
    expect(pontos).toHaveLength(2);
    expect(fontes.relacoes).toHaveBeenCalledWith('C', id(60), 'relevantes', id(503));
    expect(container.querySelector('path.espinha')).toBeNull();
    fireEvent.click(pontos[0]!);
    const folha = screen.getByRole('dialog', { name: 'Nesta linha' });
    // Aberta a folha, só a pilha tocada fica na tela.
    expect(screen.getAllByRole('button', { name: '1 relação nesta linha' })).toHaveLength(1);
    // Tocar na relação deixa só os dois pontos dela, ligados pela espinha, e leva ao outro trecho.
    fireEvent.click(within(folha).getByRole('button', { name: /pressupõe/ }));
    expect(container.querySelector('g.relacao-braquete.acesa path.braquete')).not.toBeNull();
    expect(container.querySelectorAll('circle.ponta-escolhida')).toHaveLength(2);
    expect(screen.queryAllByRole('button', { name: '1 relação nesta linha' })).toHaveLength(0);
    expect(rolar).toHaveBeenCalled();
    fireEvent.click(within(folha).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});

test('fixada pelo clique, a relação da leitura pode virar "minha conexão"; adotada, o card diz isso', async () => {
  const adotar = vi.fn(() => Promise.resolve({ conexao_id: 'CX', criada: true }));
  const aoAdotar = vi.fn();
  const fontes: FontesDosBraquetes = {
    relacoes: vi.fn(() => Promise.resolve({ relacoes: [{ relacao: modelo().relacoes[0]!, relevante: true, origem: modelo().elementos[1], destino: modelo().elementos[0], conexao_id: null }] })),
    adotar,
  };
  render(<Braquetes esperaMs={0} compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="relevantes" leitor={leitorFalso()} coluna={() => retangulo(0, 1000)} fontes={fontes} aoAdotar={aoAdotar} />);
  const alvo = await screen.findByRole('button', { name: /Relação: pressupõe/ });
  fireEvent.pointerEnter(alvo);
  // Só com o hover, o card é uma dica: nada de botão que disputaria o mouse.
  expect(screen.queryByRole('button', { name: 'Adotar como minha conexão' })).toBeNull();
  fireEvent.click(alvo);
  const card = screen.getByRole('group', { name: 'Relação da leitura' });
  fireEvent.click(within(card).getByRole('button', { name: 'Adotar como minha conexão' }));
  await waitFor(() => expect(adotar).toHaveBeenCalledWith('C', id(60), modelo().relacoes[0]!.id));
  expect(await within(card).findByText('Está em Minhas conexões.')).toBeDefined();
  expect(aoAdotar).toHaveBeenCalledOnce();
});

test('braquetes: a relação vira uma chave na lateral; o hover acende e mostra a explicação', async () => {
  const fontes: FontesDosBraquetes = {
    relacoes: vi.fn(() => Promise.resolve({ relacoes: [{ relacao: modelo().relacoes[0]!, relevante: true, origem: modelo().elementos[1], destino: modelo().elementos[0], conexao_id: null }] })),
  };
  const coluna = () => retangulo(0, 1000);
  const { container } = render(<Braquetes esperaMs={0} compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="relevantes" leitor={leitorFalso()} coluna={coluna} fontes={fontes} />);
  const alvo = await screen.findByRole('button', { name: /Relação: pressupõe/ });
  // Um colchete em cada trecho, ligados à espinha da pista; a retrospectiva tem a espinha tracejada (CSS).
  const grupo = container.querySelector('g.relacao-braquete.relevante.retrospectiva');
  expect(grupo?.querySelector('path.braquete:not(.espinha)')?.getAttribute('d')).toBe('M 394 400 H 388 V 430 H 394 M 394 100 H 388 V 160 H 394 M 388 415 H 370 M 388 130 H 370');
  expect(grupo?.querySelector('path.espinha')?.getAttribute('d')).toBe('M 370 415 V 130');
  // Apagada em repouso; com o mouse, acende e a página esmaece em volta dos dois trechos.
  expect(grupo?.classList.contains('acesa')).toBe(false);
  expect(container.querySelector('.veu-relacao')).toBeNull();
  fireEvent.pointerEnter(alvo);
  expect(container.querySelector('g.relacao-braquete')?.classList.contains('acesa')).toBe(true);
  // Véu em três tons: a página inteira, os dois parágrafos em tom leve e as citações sem véu.
  const veu = container.querySelector('svg.veu-relacao');
  expect(veu?.querySelectorAll('.veu-pagina')).toHaveLength(1);
  expect([...veu!.querySelectorAll('.veu-paragrafo')].map((rect) => rect.getAttribute('y'))).toEqual(['94', '394']);
  expect([...veu!.querySelectorAll('.veu-citacao')].map((rect) => rect.getAttribute('y'))).toEqual(['98', '398']);
  // Os dois cabem na tela: sem janela dividida.
  expect(container.querySelector('.janela-dividida')).toBeNull();
  // Mouse sobre a espinha: continua acesa; numa área vazia ao lado das chaves: apaga.
  vi.useFakeTimers();
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 371, clientY: 300 }));
  act(() => { vi.advanceTimersByTime(300); });
  expect(container.querySelector('g.relacao-braquete')?.classList.contains('acesa')).toBe(true);
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 250, clientY: 300 }));
  act(() => { vi.advanceTimersByTime(300); });
  expect(container.querySelector('g.relacao-braquete')?.classList.contains('acesa')).toBe(false);
  expect(container.querySelector('.veu-relacao')).toBeNull();
  vi.useRealTimers();
  fireEvent.pointerEnter(alvo);
  // A explicação abre com o hover, sem botões: nem adotar nem fechar.
  const dica = screen.getByRole('tooltip');
  expect(dica.textContent).toContain('pressupõe · retrospectiva');
  expect(within(dica).queryAllByRole('button')).toHaveLength(0);
  // Os colchetes, que relações do mesmo parágrafo compartilham, não respondem ao mouse: só a espinha.
  expect(container.querySelector('path.alvo-do-traco')?.getAttribute('d')).toBe('M 370 415 V 130');
  const ocultas = render(<Braquetes esperaMs={0} compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="ocultas" leitor={leitorFalso()} coluna={coluna} fontes={fontes} />);
  expect(ocultas.container.innerHTML).toBe('');
});

test('braquetes: no texto, trechos longe demais recolhem os blocos entre eles e devolvem ao sair', async () => {
  const relacao = modelo().relacoes[0]!;
  const fontes: FontesDosBraquetes = {
    relacoes: vi.fn(() => Promise.resolve({ relacoes: [{ relacao, relevante: true, origem: modelo().elementos[1], destino: modelo().elementos[0], conexao_id: null }] })),
  };
  const longe: { current: ApiDoLeitor } = { current: {
    localizar: () => null, ancoraVisivel: () => null,
    retangulosDaAncora: (ancora) => [ancora.bloco_id === id(1) ? retangulo(100, 60) : retangulo(2400, 30)],
  } };
  // Capítulo: bloco 1, três blocos no meio, bloco 2.
  const artigo = document.createElement('article');
  const ordem = [id(1), id(11), id(12), id(13), id(2)];
  for (const bloco of ordem) { const p = document.createElement('p'); p.dataset['bloco'] = bloco; p.textContent = 'texto'; artigo.append(p); }
  document.body.append(artigo);
  window.scrollBy = vi.fn();
  const blocos = ordem.map((bloco) => ({ id: bloco, texto: 'texto' }));
  const { container } = render(<Braquetes esperaMs={0} compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="relevantes" leitor={longe} coluna={() => retangulo(0, 1000)}
    blocos={blocos} artigo={() => artigo} fontes={fontes} />);
  fireEvent.pointerEnter(await screen.findByRole('button', { name: /Relação: pressupõe/ }), { clientY: 200 });
  const estados = () => [...artigo.children].map((filho) => filho.getAttribute('data-colapsado'));
  expect(estados()).toEqual([null, 'marco', '', '', '', null]);
  expect(artigo.children[1]?.getAttribute('data-recolhidos')).toBe('Conteúdo recolhido');
  // No texto, a dobra substitui a janela dividida.
  expect(container.querySelector('.janela-dividida')).toBeNull();
  // Mouse sobre a margem direita, longe das chaves e dos trechos: a relação apaga e o texto volta.
  vi.useFakeTimers();
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1300, clientY: 500 }));
  act(() => { vi.advanceTimersByTime(300); });
  expect(estados()).toEqual([null, null, null, null, null]);
  artigo.remove();
});

test('braquetes: recolher o texto não muda a pista da relação acesa, mesmo que outra suma', async () => {
  const [base] = modelo().elementos;
  if (!base) throw new Error('elemento esperado');
  const elemento = (bloco: number, sufixo: number) => ({ ...base, id: id(700 + sufixo), ancoras: [{ ...base.ancoras[0]!, bloco_id: id(bloco) }] });
  const relacao = modelo().relacoes[0]!;
  // A liga o bloco 1 ao 12 e começa antes; B liga o 11 ao 2, bem longe. B fica na pista 1.
  const itens = [
    { relacao: { ...relacao, id: id(801) }, relevante: true, origem: elemento(1, 1), destino: elemento(12, 2), conexao_id: null },
    { relacao: { ...relacao, id: id(802) }, relevante: true, origem: elemento(11, 3), destino: elemento(2, 4), conexao_id: null },
  ];
  const fontes: FontesDosBraquetes = { relacoes: vi.fn(() => Promise.resolve({ relacoes: itens })) };
  const ordem = [id(1), id(11), id(12), id(13), id(2)];
  const topos: Record<string, number> = { [id(1)]: 100, [id(11)]: 300, [id(12)]: 500, [id(13)]: 700, [id(2)]: 2400 };
  const artigo = document.createElement('article');
  for (const bloco of ordem) { const p = document.createElement('p'); p.dataset['bloco'] = bloco; artigo.append(p); }
  document.body.append(artigo);
  // Bloco recolhido não tem retângulo: a relação A some do desenho.
  const leitor: { current: ApiDoLeitor } = { current: {
    localizar: () => null, ancoraVisivel: () => null,
    retangulosDaAncora: (ancora) => artigo.querySelector(`[data-bloco="${ancora.bloco_id}"]`)?.hasAttribute('data-colapsado') ? [] : [retangulo(topos[ancora.bloco_id] ?? 0, 40)],
  } };
  window.scrollBy = vi.fn();
  const { container } = render(<Braquetes esperaMs={0} compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="relevantes" leitor={leitor} coluna={() => retangulo(0, 1000)}
    blocos={ordem.map((bloco) => ({ id: bloco, texto: 'texto' }))} artigo={() => artigo} fontes={fontes} />);
  const botoes = await screen.findAllByRole('button', { name: /Relação: pressupõe/ });
  const espinhaDeB = () => container.querySelectorAll('g.relacao-braquete path.espinha')[container.querySelectorAll('g.relacao-braquete').length - 1]?.getAttribute('d')?.split(' ')[1];
  const xAntes = espinhaDeB();
  fireEvent.pointerEnter(botoes[1]!);
  await act(async () => { await new Promise((pronto) => requestAnimationFrame(() => pronto(undefined))); });
  expect(artigo.querySelector('[data-colapsado]')).not.toBeNull();
  expect(container.querySelectorAll('g.relacao-braquete')).toHaveLength(1);
  expect(espinhaDeB()).toBe(xAntes);
  // Da relação B direto para a A: a dobra de B se desfaz e a A é decidida com a página já desdobrada.
  const desenhos = () => [...container.querySelectorAll('g.relacao-braquete path.espinha')].map((caminho) => caminho.getAttribute('d'));
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 356, clientY: 200 }));
  fireEvent.pointerEnter(botoes[0]!);
  await act(async () => { await new Promise((pronto) => setTimeout(pronto, 200)); });
  expect(artigo.querySelector('[data-colapsado]')).toBeNull();
  expect(desenhos()).toHaveLength(2);
  // Sem nenhuma acesa, as chaves voltam exatamente ao desenho inicial.
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1300, clientY: 500 }));
  await act(async () => { await new Promise((pronto) => setTimeout(pronto, 200)); });
  expect(container.querySelectorAll('g.relacao-braquete.acesa')).toHaveLength(0);
  expect(desenhos()).toEqual(['M 370 120 V 520', 'M 356 320 V 2420']);
  artigo.remove();
});

test('braquetes: com os dois trechos fora da tela, o texto não se recolhe e abre a janela dividida', async () => {
  const relacao = modelo().relacoes[0]!;
  const fontes: FontesDosBraquetes = {
    relacoes: vi.fn(() => Promise.resolve({ relacoes: [{ relacao, relevante: true, origem: modelo().elementos[1], destino: modelo().elementos[0], conexao_id: null }] })),
  };
  // Um acima da tela, outro abaixo; só a espinha passa pela tela.
  const fora: { current: ApiDoLeitor } = { current: {
    localizar: () => null, ancoraVisivel: () => null,
    retangulosDaAncora: (ancora) => [ancora.bloco_id === id(1) ? retangulo(-900, 60) : retangulo(2400, 30)],
  } };
  const artigo = document.createElement('article');
  const ordem = [id(1), id(11), id(12), id(2)];
  for (const bloco of ordem) { const p = document.createElement('p'); p.dataset['bloco'] = bloco; artigo.append(p); }
  document.body.append(artigo);
  const { container } = render(<Braquetes esperaMs={0} compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="relevantes" leitor={fora} coluna={() => retangulo(0, 1000)}
    blocos={ordem.map((bloco) => ({ id: bloco, texto: 'texto' }))} artigo={() => artigo} fontes={fontes} />);
  fireEvent.pointerEnter(await screen.findByRole('button', { name: /Relação: pressupõe/ }));
  expect(artigo.querySelector('[data-colapsado]')).toBeNull();
  expect(container.querySelector('.janela-dividida')).not.toBeNull();
  artigo.remove();
});

test('braquetes: a relação só acende se o mouse repousar na espinha; passar depressa não acende', async () => {
  const fontes: FontesDosBraquetes = {
    relacoes: vi.fn(() => Promise.resolve({ relacoes: [{ relacao: modelo().relacoes[0]!, relevante: true, origem: modelo().elementos[1], destino: modelo().elementos[0], conexao_id: null }] })),
  };
  const { container } = render(<Braquetes compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="relevantes" leitor={leitorFalso()} coluna={() => retangulo(0, 1000)} fontes={fontes} />);
  const alvo = await screen.findByRole('button', { name: /Relação: pressupõe/ });
  const grupo = () => container.querySelector('g.relacao-braquete');
  vi.useFakeTimers();
  // Passa por cima e segue: fica só candidata e não acende.
  fireEvent.pointerEnter(alvo);
  expect(grupo()?.classList.contains('candidata')).toBe(true);
  act(() => { vi.advanceTimersByTime(400); });
  act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 250, clientY: 300 })); });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(grupo()?.classList.contains('acesa')).toBe(false);
  expect(grupo()?.classList.contains('candidata')).toBe(false);
  // Repousa na espinha: acende depois da espera, com a explicação.
  fireEvent.pointerEnter(alvo);
  act(() => { vi.advanceTimersByTime(ESPERA_PARA_ACENDER_MS - 50); });
  expect(grupo()?.classList.contains('acesa')).toBe(false);
  act(() => { vi.advanceTimersByTime(100); });
  expect(grupo()?.classList.contains('acesa')).toBe(true);
  expect(screen.getByRole('tooltip')).toBeDefined();
  vi.useRealTimers();
});

test('braquetes: trechos longe demais para caber na tela abrem a janela dividida', async () => {
  const relacao = modelo().relacoes[0]!;
  const fontes: FontesDosBraquetes = {
    relacoes: vi.fn(() => Promise.resolve({ relacoes: [{ relacao, relevante: true, origem: modelo().elementos[1], destino: modelo().elementos[0], conexao_id: null }] })),
  };
  const longe: { current: ApiDoLeitor } = { current: {
    localizar: () => null, ancoraVisivel: () => null,
    retangulosDaAncora: (ancora) => [ancora.bloco_id === id(1) ? retangulo(100, 60) : retangulo(2400, 30)],
  } };
  const { container } = render(<Braquetes esperaMs={0} compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="relevantes" leitor={longe} coluna={() => retangulo(0, 1000)} fontes={fontes} />);
  fireEvent.pointerEnter(await screen.findByRole('button', { name: /Relação: pressupõe/ }));
  const janela = container.querySelector('.janela-dividida');
  expect(janela).not.toBeNull();
  // O que vem antes no capítulo fica em cima; a divisória diz a relação na direção de leitura.
  expect([...janela!.querySelectorAll('.painel-da-janela .eyebrow')].map((item) => item.textContent)).toEqual(['Para', 'De']);
  expect(janela!.querySelector('.divisoria-da-janela > span')?.textContent).toBe('↑ pressupõe · retrospectiva');
});

test('pistas: relações que se sobrepõem na vertical não se desenham uma em cima da outra', () => {
  const pistas = distribuirEmPistas([{ topo: 0, base: 100 }, { topo: 50, base: 150 }, { topo: 200, base: 300 }]);
  expect(pistas.map((item) => item.pista)).toEqual([0, 1, 0]);
});

test('o perfil do leitor carrega, edita e grava uma revisão nova', async () => {
  const gravar = vi.fn((perfil: Parameters<FontesDoPerfil['gravar']>[0]) => Promise.resolve({ perfil: { versao: 1 as const, revisao: 1, atualizado_em: '2026-09-25T12:00:00Z', ...perfil }, hash: 'h' }));
  const fontes: FontesDoPerfil = {
    obter: () => Promise.resolve({ perfil: { versao: 1, revisao: 0, areas: [{ nome: 'Economia', nivel: 'avancado' }], preferencias: ['exemplos'], observacoes: '', atualizado_em: '2026-09-25T12:00:00Z' }, hash: 'h' }),
    gravar,
  };
  render(<PerfilDoLeitor fontes={fontes} />);
  await screen.findByDisplayValue('Economia');
  fireEvent.click(screen.getByRole('button', { name: '+ Área' }));
  const areas = screen.getAllByRole('textbox', { name: 'Área' });
  fireEvent.change(areas[1]!, { target: { value: '  Filosofia ' } });
  fireEvent.change(screen.getByDisplayValue('exemplos'), { target: { value: 'exemplos\n\nnão explicar o básico\nexemplos' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Perfil do leitor' }));
  await waitFor(() => expect(gravar).toHaveBeenCalled());
  expect(gravar).toHaveBeenCalledWith({
    areas: [{ nome: 'Economia', nivel: 'avancado' }, { nome: 'Filosofia', nivel: 'intermediario' }],
    preferencias: ['exemplos', 'não explicar o básico'], observacoes: '',
  });
  expect(screen.getByRole('status').textContent).toContain('Perfil salvo');
});



test.each([false, true])('braquetes: pontas seguem a citação curta dentro de parágrafo longo (guiada=%s)', async (guiada) => {
  const dados = modelo();
  const fontes: FontesDosBraquetes = { relacoes: () => Promise.resolve({ relacoes: [{ relacao: dados.relacoes[0]!, relevante: true, origem: dados.elementos[1], destino: dados.elementos[0], conexao_id: null }] }) };
  const leitor: { current: ApiDoLeitor } = { current: {
    localizar: () => null, ancoraVisivel: () => null,
    retangulosDaAncora: (ancora) => ancora.bloco_id === id(1)
      ? [ancora.fim_utf16 === blocos[0]!.texto.length ? retangulo(80, 300) : retangulo(150, 22)]
      : [retangulo(500, 22)],
  } };
  const { container } = render(<Braquetes compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="todas" leitor={leitor} coluna={() => retangulo(0, 1000)} blocos={blocos} fontes={fontes} {...(guiada ? { fixas: [dados.relacoes[0]!.id] } : {})} />);
  await waitFor(() => expect(container.querySelector('path.braquete')).not.toBeNull());
  const desenho = container.querySelector('path.braquete')?.getAttribute('d');
  expect(desenho).toContain('150 H 388 V 172');
  expect(desenho).not.toContain('V 380');
});

test.each([false, true])('braquetes: recolhem imagens entre pontas adjacentes e restauram o DOM (lista=%s)', async (lista) => {
  const dados = modelo();
  const fontes: FontesDosBraquetes = { relacoes: () => Promise.resolve({ relacoes: [{ relacao: dados.relacoes[0]!, relevante: true, origem: dados.elementos[1], destino: dados.elementos[0], conexao_id: null }] }) };
  const artigo = document.createElement('article');
  const cima = document.createElement(lista ? 'li' : 'p'); cima.dataset['bloco'] = id(1);
  const baixo = document.createElement('p'); baixo.dataset['bloco'] = id(2);
  const imagem = document.createElement('img'); imagem.alt = 'Diagrama';
  const texto = document.createElement('span'); texto.dataset['inicio'] = '0'; texto.textContent = 'Trecho';
  const interna = document.createElement('img'); interna.alt = 'Figura no item';
  cima.append(texto, interna);
  if (lista) { const ul = document.createElement('ul'); ul.append(cima); artigo.append(ul); }
  else artigo.append(cima);
  artigo.append(imagem, baixo);
  document.body.append(artigo);
  const original = artigo.innerHTML;
  const leitor = leitorFalso();
  leitor.current.retangulosDaAncora = (ancora) => [retangulo(ancora.bloco_id === id(1) ? 100 : 2400, 22)];
  const { unmount } = render(<Braquetes esperaMs={0} compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="todas" leitor={leitor} coluna={() => retangulo(0, 1000)} blocos={blocos} artigo={() => artigo} fontes={fontes} />);
  fireEvent.pointerEnter(await screen.findByRole('button', { name: /Relação: pressupõe/ }));
  expect(imagem.getAttribute('data-colapsado')).toBe('');
  expect(interna.getAttribute('data-colapsado')).toBe('');
  expect(cima.hasAttribute('data-colapsado')).toBe(false);
  expect(baixo.hasAttribute('data-colapsado')).toBe(false);
  expect(artigo.querySelector('[data-colapsado="marco"]')?.tagName).toBe('DIV');
  unmount();
  expect(artigo.innerHTML).toBe(original);
  artigo.remove();
});

test('navegação lateral ativa a dobra como hover, mantém ao mover o mouse e restaura ao mudar para grifos', async () => {
  const dados = modelo();
  const fontes: FontesDosBraquetes = { relacoes: () => Promise.resolve({ relacoes: [{ relacao: dados.relacoes[0]!, relevante: true, origem: dados.elementos[1], destino: dados.elementos[0], conexao_id: null }] }) };
  const artigo = document.createElement('article');
  const cima = document.createElement('p'); cima.dataset['bloco'] = id(1);
  const baixo = document.createElement('p'); baixo.dataset['bloco'] = id(2);
  const imagem = document.createElement('img'); artigo.append(cima, imagem, baixo); document.body.append(artigo);
  const leitor = leitorFalso();
  leitor.current.retangulosDaAncora = (ancora) => [retangulo(ancora.bloco_id === id(1) ? 100 : 2400, 22)];
  const props = { compreensaoId: 'C', secaoId: id(60), modeloId: id(503), filtro: 'todas' as const, leitor, coluna: () => retangulo(0, 1000), blocos, artigo: () => artigo, fontes };
  const { container, rerender } = render(<Braquetes {...props} navegacao={{ aberta: true, relacaoId: dados.relacoes[0]!.id }} />);
  await waitFor(() => expect(imagem.hasAttribute('data-colapsado')).toBe(true));
  expect(container.querySelector('.relacao-braquete.acesa')).not.toBeNull();
  expect(screen.queryByRole('tooltip')).toBeNull(); // a explicação já está na barra lateral
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1400, clientY: 500 }));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
  expect(imagem.hasAttribute('data-colapsado')).toBe(true);
  rerender(<Braquetes {...props} navegacao={{ aberta: true, relacaoId: null }} />);
  await waitFor(() => expect(imagem.hasAttribute('data-colapsado')).toBe(false));
  expect(container.querySelector('.relacao-braquete.acesa')).toBeNull();
  artigo.remove();
});

test.each([false, true])('visualização por pontos mostra só o braquete escolhido e mantém a versão completa disponível (pdf=%s)', async (pdf) => {
  const dados = modelo();
  const itens = Array.from({ length: 30 }, (_, i) => ({ relacao: { ...dados.relacoes[0]!, id: id(900 + i) }, relevante: true, origem: dados.elementos[1], destino: dados.elementos[0], conexao_id: null }));
  const fontes: FontesDosBraquetes = { relacoes: () => Promise.resolve({ relacoes: itens }) };
  const props = { pdf, compreensaoId: 'C', secaoId: id(60), modeloId: id(503), filtro: 'todas' as const, leitor: leitorFalso(), coluna: () => retangulo(0, 1000), blocos, fontes };
  const { container, rerender } = render(<Braquetes {...props} visualizacao="pontos" />);
  const pilhas = await screen.findAllByRole('button', { name: '30 pontas de relações nesta linha' });
  expect(container.querySelectorAll('.relacao-braquete')).toHaveLength(0);
  fireEvent.pointerEnter(pilhas[0]!);
  const pontas = screen.getAllByRole('button', { name: /^Chegada:/ });
  fireEvent.pointerEnter(pontas[0]!);
  expect(container.querySelectorAll('.relacao-braquete')).toHaveLength(1);
  expect(container.querySelector('path.espinha')?.getAttribute('d')).toBe('M 370 415 V 130');
  expect(container.querySelector('.veu-relacao.veu-pdf')).not.toBeNull();
  expect(container.querySelector('.braquetes.em-pontos[data-acesa]')).not.toBeNull();
  for (let pagina = 0; pagina < 7; pagina++) fireEvent.click(screen.getByRole('button', { name: 'Próximas pontas' }));
  fireEvent.pointerEnter(screen.getAllByRole('button', { name: /^Chegada:/ }).at(-1)!);
  expect(container.querySelectorAll('.relacao-braquete')).toHaveLength(1);
  expect(container.querySelector('path.espinha')?.getAttribute('d')).toBe('M 370 415 V 130');
  rerender(<Braquetes {...props} visualizacao="linhas" />);
  expect(container.querySelectorAll('.relacao-braquete')).toHaveLength(30);
});

test('120 relações compartilham quatro leituras de geometria por quadro, sem conservar coordenadas antigas', async () => {
  const base = modelo();
  const fontes: FontesDosBraquetes = { relacoes: () => Promise.resolve({ relacoes: Array.from({ length: 120 }, (_, i) => ({
    relacao: { ...base.relacoes[0]!, id: id(1000 + i) }, relevante: true,
    origem: structuredClone(base.elementos[0]!), destino: structuredClone(base.elementos[1]!), conexao_id: null,
  })) }) };
  let deslocamento = 0;
  const medir = vi.fn((ancora: { bloco_id: string }) => [retangulo((ancora.bloco_id === id(1) ? 100 : 400) - deslocamento, 30)]);
  const leitor = { current: { localizar: () => null, ancoraVisivel: () => null, retangulosDaAncora: medir } };
  const { container } = render(<Braquetes compreensaoId="C" secaoId={id(60)} modeloId={base.id} filtro="relevantes"
    leitor={leitor} blocos={blocos} coluna={() => retangulo(0, 1000)} fontes={fontes} />);
  await waitFor(() => expect(container.querySelectorAll('.relacao-braquete')).toHaveLength(120));
  expect(medir).toHaveBeenCalledTimes(4);
  const antes = container.querySelector('path.braquete')?.getAttribute('d');
  medir.mockClear(); deslocamento = 20; fireEvent.scroll(window);
  await waitFor(() => expect(medir).toHaveBeenCalledTimes(4));
  expect(container.querySelector('path.braquete')?.getAttribute('d')).not.toBe(antes);
});

test('resposta atrasada de outra revisão não substitui os braquetes atuais', async () => {
  type Resposta = Awaited<ReturnType<FontesDosBraquetes['relacoes']>>;
  let antiga!: (r: Resposta) => void;
  const resposta = (texto: string): Resposta => ({ relacoes: [{ relacao: { ...modelo().relacoes[0]!, explicacao: texto }, relevante: true, origem: modelo().elementos[1], destino: modelo().elementos[0], conexao_id: null }] });
  const fontes: FontesDosBraquetes = { relacoes: vi.fn((_execucao, _secao, _filtro, revisao) => revisao === id(503)
    ? new Promise<Resposta>(resolver => { antiga = resolver; }) : Promise.resolve(resposta('Revisão nova.'))) };
  const props = { compreensaoId: 'C', secaoId: id(60), filtro: 'relevantes' as const, leitor: leitorFalso(), coluna: () => retangulo(0, 1000), fontes };
  const { rerender } = render(<Braquetes {...props} modeloId={id(503)} />);
  rerender(<Braquetes {...props} modeloId={id(504)} />);
  await screen.findByRole('button', { name: /Revisão nova/ });
  await act(async () => { antiga(resposta('Revisão antiga.')); await Promise.resolve(); });
  expect(screen.queryByRole('button', { name: /Revisão antiga/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Revisão nova/ })).not.toBeNull();
});

test('braquetes guiadas (leitura comentada, visita): a ponta fora da tela vira uma seta na borda, sem espinha até o infinito nem círculo solto', async () => {
  const dados = modelo();
  const fontes: FontesDosBraquetes = { relacoes: () => Promise.resolve({ relacoes: [{ relacao: dados.relacoes[0]!, relevante: true, origem: dados.elementos[1], destino: dados.elementos[0], conexao_id: null }] }) };
  // O bloco 1 (a outra ponta, que o comentário "volta a") está 900 px acima da tela; o bloco 2, à vista.
  const leitor: { current: ApiDoLeitor } = { current: {
    localizar: () => null, ancoraVisivel: () => null,
    retangulosDaAncora: (ancora) => [ancora.bloco_id === id(1) ? retangulo(-900, 40) : retangulo(400, 30)],
  } };
  const { container } = render(<Braquetes compreensaoId="C" secaoId={id(60)} modeloId={id(503)} filtro="todas" leitor={leitor} coluna={() => retangulo(0, 1000)} blocos={blocos} fontes={fontes} fixas={[dados.relacoes[0]!.id]} />);
  await waitFor(() => expect(container.querySelector('path.braquete')).not.toBeNull());
  const grupo = container.querySelector('g.relacao-braquete')!;
  const traco = grupo.querySelector('path.braquete')!.getAttribute('d')!;
  expect(grupo.hasAttribute('data-ponta-fora')).toBe(true);
  // Só o colchete da ponta à vista (400–430); a espinha para no topo útil (64 + 8), com a seta.
  expect(traco).toContain('M 394 400 H 388 V 430 H 394');
  expect(traco).not.toContain('-900');
  expect(traco).toMatch(/V 72$/);
  expect(grupo.querySelector('circle')).toBeNull();
});


test('J132: sem compreensão, as conexões do leitor são desenhadas pelos mesmos braquetes, sem pedir relações à API', async () => {
  const fontes: FontesDosBraquetes = { relacoes: vi.fn(() => Promise.resolve({ relacoes: [] })) };
  const extra = { relacao: { ...modelo().relacoes[0]!, id: 'CONEXAO-DO-LEITOR' }, relevante: true, origem: modelo().elementos[1], destino: modelo().elementos[0], conexao_id: 'CONEXAO-DO-LEITOR' };
  const { container } = render(<Braquetes esperaMs={0} compreensaoId={null} extras={[extra]} secaoId={id(60)} modeloId="conexoes" filtro="relevantes" leitor={leitorFalso()} coluna={() => retangulo(0, 1000)} fontes={fontes} />);
  await waitFor(() => expect(container.querySelector('g.relacao-braquete path.braquete')).not.toBeNull());
  expect(fontes.relacoes).not.toHaveBeenCalled();
  // Em "ocultas" (texto puro), também somem.
  const ocultas = render(<Braquetes esperaMs={0} compreensaoId={null} extras={[extra]} secaoId={id(60)} modeloId="conexoes" filtro="ocultas" leitor={leitorFalso()} coluna={() => retangulo(0, 1000)} fontes={fontes} />);
  expect(ocultas.container.querySelector('g.relacao-braquete')).toBeNull();
});

test('relação da análise: "Remover relação" confirma antes de apagar (V-T8); sem remover, só adotar', async () => {
  const item = { relacao: { id: 'R'.repeat(26), tipo: 'suporta', explicacao: 'A segunda apoia a primeira.' }, conexao_id: null } as unknown as Parameters<typeof AdotarRelacao>[0]['item'];
  const remover = vi.fn(() => Promise.resolve());
  const { unmount } = render(<AdotarRelacao item={item} adotar={vi.fn(() => Promise.resolve())} remover={remover} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remover relação' }));
  const dialogo = screen.getByRole('alertdialog');
  expect(dialogo.textContent).toContain('A segunda apoia a primeira.');
  expect(remover).not.toHaveBeenCalled();
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover' }));
    await act(() => Promise.resolve());
  expect(remover).toHaveBeenCalledWith('R'.repeat(26));
  unmount();
  render(<AdotarRelacao item={item} adotar={vi.fn(() => Promise.resolve())} />);
  expect(screen.queryByRole('button', { name: 'Remover relação' })).toBeNull();
});
