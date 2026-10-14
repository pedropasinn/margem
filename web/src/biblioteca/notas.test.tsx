import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { abrirNoLeitor, citacaoFormatada, escolhaDaUrl, filtroDaEscolha, intencaoDoItem, Notas, urlDaEscolha } from './Notas';
import { consumirIntencao } from './intencao';
import { caminhoDaRota, rotaDoCaminho } from './rotas';
import type { FiltroDaCentral } from './api';
import type { FacetasDaCentral, ItemDaCentral, PaginaDaCentral } from './tipos';
import { comoApagar, NotasComApagar } from '../apagar/NasNotas';
import { apagarGrifoDeQualquerUm, apagarItemDaAnalise } from '../apagar/api';

vi.mock('../apagar/api', () => ({ apagarGrifoDeQualquerUm: vi.fn(() => Promise.resolve({})), apagarItemDaAnalise: vi.fn(() => Promise.resolve({})) }));

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); window.history.replaceState(null, '', '/notas'); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const DOC = '0'.repeat(25) + '1';
const OUTRO = '0'.repeat(25) + '2';
const SECAO = '0'.repeat(25) + 'S';
const BLOCO = '0'.repeat(25) + 'B';
function item(parcial: Partial<ItemDaCentral> = {}): ItemDaCentral {
  const id = parcial.id ?? '0'.repeat(24) + 'M1';
  const tipo = parcial.tipo ?? 'grifo';
  return {
    chave: `${tipo}:${id}`, tipo, id, autoria: 'leitor', rotulo: 'Tese', estado: null, funcao: 'tese',
    modo: { id: 'argumentativa', revisao: 1, nome: 'Argumentativa' }, cor: { claro: '#c00', escuro: '#f66' },
    citacao: 'A vontade segue o bem apreendido', nota: 'Sempre, mesmo?', nota_id: '0'.repeat(24) + 'N1', comentario: null, texto: null,
    destino: null, mensagens: null, documento: { id: DOC, titulo: 'Tratado', autor: 'Tomás' }, versao_id: '0'.repeat(25) + 'V',
    capitulo: { id: SECAO, titulo: 'Da vontade' }, pagina: '12',
    abrir: { documento_id: DOC, secao_id: SECAO, bloco_id: BLOCO, faixa: { inicio_utf16: 2, fim_utf16: 30 }, painel: 'nota', alvo_id: id },
    analise: null, link: `/ler/${DOC}/${SECAO}?bloco=${BLOCO}`, criada_em: '2026-09-30T12:00:00.000Z', atualizada_em: '2026-09-30T12:00:00.000Z',
    ...parcial,
  };
}
const FACETAS: FacetasDaCentral = {
  tipos: { total: 5, grifo: 2, nota: 1, comentario: 1, relacao: 1, dificuldade: 0, resolucao: 1, flashcard: 1, conversa: 0, visual: 0 },
  autorias: { leitor: 3, codex: 2 },
  documentos: [{ id: OUTRO, titulo: 'Ensaio', autor: null, total: 1 }, { id: DOC, titulo: 'Tratado', autor: 'Tomás', total: 4 }],
  funcoes: [{ funcao: 'tese', modo: { id: 'argumentativa', revisao: 1, nome: 'Argumentativa' }, rotulo: 'Tese', cor: { claro: '#c00', escuro: '#f66' }, total: 2 }],
};
const ITENS: ItemDaCentral[] = [
  item(),
  item({ id: 'C1', autoria: 'codex', nota: null, nota_id: null, comentario: 'O autor exagera de propósito.', abrir: { ...item().abrir, painel: 'balao', alvo_id: 'C1' } }),
  item({ id: 'R1', tipo: 'relacao', autoria: 'codex', rotulo: 'Pressupõe', estado: 'da_leitura', funcao: null, modo: null, cor: null, nota: null, nota_id: null,
    texto: 'A conclusão depende da hipótese.', documento: { id: OUTRO, titulo: 'Ensaio', autor: null },
    destino: { citacao: 'a hipótese do começo', documento: { id: DOC, titulo: 'Tratado' }, titulo_externo: null,
      abrir: { documento_id: DOC, secao_id: SECAO, bloco_id: BLOCO, faixa: null, painel: 'trecho', alvo_id: null } },
    abrir: { documento_id: OUTRO, secao_id: SECAO, bloco_id: BLOCO, faixa: null, painel: 'relacao', alvo_id: 'R1' } }),
  item({ id: 'E1', tipo: 'resolucao', autoria: 'codex', rotulo: 'Exercício 1.1', estado: 'pronta', funcao: null, modo: null, cor: null, nota: null, nota_id: null,
    citacao: 'Mostre que $x$ cresce.', texto: 'Derivar.', comentario: 'Cresce.', abrir: { ...item().abrir, painel: 'resolucao', alvo_id: 'E1' } }),
  item({ id: 'F1', tipo: 'flashcard', rotulo: 'Flashcard', funcao: null, modo: null, cor: null, nota: null, nota_id: null, texto: 'Frente?', comentario: 'Verso.',
    abrir: { ...item().abrir, painel: 'flashcards', alvo_id: null } }),
];

function servidor(itens = ITENS) {
  const pedidos: FiltroDaCentral[] = [];
  const carregar = vi.fn((filtro: FiltroDaCentral): Promise<PaginaDaCentral> => {
    pedidos.push(filtro);
    const filtrados = itens.filter((i) => (!filtro.tipo || i.tipo === filtro.tipo || (filtro.tipo === 'nota' && i.nota !== null))
      && (!filtro.autoria || i.autoria === filtro.autoria) && (!filtro.documento || i.documento.id === filtro.documento));
    const inicio = filtro.deslocamento ?? 0;
    const limite = filtro.limite ?? 50;
    return Promise.resolve({ itens: filtrados.slice(inicio, inicio + limite), total: filtrados.length, limite, deslocamento: inicio, ...(filtro.facetas ? { facetas: FACETAS } : {}) });
  });
  return { carregar, pedidos };
}

test('rotas das notas: da biblioteca e do documento', () => {
  expect(rotaDoCaminho('/notas')).toEqual({ nome: 'notas' });
  expect(rotaDoCaminho(`/documentos/${DOC}/notas`)).toEqual({ nome: 'notas', documento_id: DOC });
  expect(caminhoDaRota({ nome: 'notas' })).toBe('/notas');
  expect(caminhoDaRota({ nome: 'notas', documento_id: DOC })).toBe(`/documentos/${DOC}/notas`);
});

test('copiar como citação: aspas, autor, título em itálico e página; sem página, o capítulo', () => {
  expect(citacaoFormatada(item())).toBe('“A vontade segue o bem apreendido” — Tomás, *Tratado*, p. 12');
  expect(citacaoFormatada(item({ pagina: null }))).toBe('“A vontade segue o bem apreendido” — Tomás, *Tratado*, cap. Da vontade');
  expect(citacaoFormatada(item({ pagina: null, capitulo: { id: 'x', titulo: 'Capítulo 3' } }))).toBe('“A vontade segue o bem apreendido” — Tomás, *Tratado*, Capítulo 3');
  expect(citacaoFormatada(item({ pagina: null, capitulo: null, documento: { id: DOC, titulo: 'Ensaio', autor: null } }))).toBe('“A vontade segue o bem apreendido” — *Ensaio*');
});

test('a escolha vai e volta pela URL; o filtro do serviço sai dela', () => {
  const escolha = escolhaDaUrl(`?tipo=relacao&autoria=codex&documento=${DOC}&funcao=argumentativa:tese&periodo=7&ordem=antigos&agrupar=1&q=hip`);
  expect(escolha).toEqual({ tipo: 'relacao', autoria: 'codex', documento: DOC, funcao: 'argumentativa:tese', periodo: '7', ordem: 'antigos', agrupar: true, texto: 'hip' });
  expect(escolhaDaUrl(urlDaEscolha(escolha))).toEqual(escolha);
  expect(escolhaDaUrl('?tipo=tudo&autoria=eu&documento=x&ordem=sorte')).toEqual(escolhaDaUrl(''));
  expect(filtroDaEscolha(escolha, undefined, new Date('2026-10-14T12:00:00Z'))).toEqual({
    documento: DOC, tipo: 'relacao', autoria: 'codex', funcao: 'tese', modo: 'argumentativa', texto: 'hip', desde: '2026-10-07', ordem: 'documento' });
  // Na página de um documento, ele vence; o grifo sem função não tem modo.
  expect(filtroDaEscolha({ ...escolha, funcao: ':nenhuma', periodo: '', agrupar: false }, OUTRO)).toMatchObject({ documento: OUTRO, funcao: 'nenhuma', ordem: 'antigos' });
});

test('abrir no leitor: o capítulo, o trecho exato e o painel de cada tipo', () => {
  expect(intencaoDoItem(item().abrir)).toEqual({ documento_id: DOC, secao_id: SECAO, bloco: BLOCO, faixa: { inicio_utf16: 2, fim_utf16: 30 }, marca: item().id, nota: true });
  expect(intencaoDoItem({ ...item().abrir, painel: 'conexao', alvo_id: 'X' })).toMatchObject({ conexao: 'X' });
  expect(intencaoDoItem({ ...item().abrir, painel: 'relacao', alvo_id: 'R' })).toMatchObject({ relacao: 'R' });
  expect(intencaoDoItem({ ...item().abrir, painel: 'conversa', alvo_id: 'Q' })).toMatchObject({ conversa: 'Q' });
  expect(intencaoDoItem({ ...item().abrir, painel: 'resolucao', alvo_id: 'E' })).toMatchObject({ resolucao: 'E' });
  expect(intencaoDoItem({ ...item().abrir, painel: 'visual', alvo_id: 'V' })).toMatchObject({ visual: 'V' });
  expect(intencaoDoItem({ ...item().abrir, painel: 'trecho', alvo_id: null })).toEqual({ documento_id: DOC, secao_id: SECAO, bloco: BLOCO, faixa: { inicio_utf16: 2, fim_utf16: 30 } });
  const ir = vi.fn();
  abrirNoLeitor(item().abrir, ir);
  expect(ir).toHaveBeenLastCalledWith({ nome: 'leitura', documento_id: DOC, secao_id: SECAO });
  expect(consumirIntencao(DOC, SECAO)).toMatchObject({ marca: item().id, nota: true, bloco: BLOCO });
  abrirNoLeitor({ ...item().abrir, painel: 'flashcards' }, ir);
  expect(ir).toHaveBeenLastCalledWith({ nome: 'flashcards', documento_id: DOC });
  abrirNoLeitor({ ...item().abrir, secao_id: null }, ir);
  expect(ir).toHaveBeenLastCalledWith({ nome: 'leitura', documento_id: DOC });
});

test('central: todos os tipos, de todos os documentos, com o trecho, o lugar, o Codex à parte e filtros que pedem ao serviço', async () => {
  const { carregar, pedidos } = servidor();
  const ir = vi.fn();
  render(<Notas ir={ir} carregar={carregar} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Notas' })).toBeTruthy();
  await screen.findByText('5 itens');
  expect(pedidos[0]).toEqual({ ordem: 'recentes', limite: 50, facetas: true });
  // Só as abas dos tipos que existem.
  expect(within(screen.getByRole('navigation', { name: 'Tipo' })).getAllByRole('button').map((b) => b.textContent))
    .toEqual(['Tudo', 'Grifos', 'Notas', 'Comentários', 'Relações', 'Exercícios', 'Flashcards']);
  // O que é cada item e de quem é.
  expect(screen.getByText('Tese · Codex')).toBeTruthy();
  expect(screen.getByText('Relação · pressupõe · Codex')).toBeTruthy();
  expect(screen.getByText('da leitura')).toBeTruthy();
  expect(screen.getByText('Exercício 1.1 · Codex')).toBeTruthy();
  // A nota do leitor e, à parte, a voz do Codex; a relação com o outro trecho; o exercício sem cifrões.
  expect(screen.getByText('Sempre, mesmo?').className).toBe('central-nota');
  expect(screen.getByText('O autor exagera de propósito.').closest('p')?.className).toBe('central-codex');
  expect(screen.getByText('a hipótese do começo')).toBeTruthy();
  expect(screen.getByText('Mostre que x cresce.')).toBeTruthy();
  expect(screen.getByText('Frente?')).toBeTruthy();
  // O lugar: documento (na lista de tudo), capítulo, página.
  const primeiro = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-chave') === `grifo:${item().id}`)!;
  expect(within(primeiro).getByText('Tratado')).toBeTruthy();
  expect(within(primeiro).getByText('Da vontade')).toBeTruthy();
  expect(within(primeiro).getByText('p. 12')).toBeTruthy();

  // Tocar o trecho abre o leitor no lugar e no painel certo.
  fireEvent.click(within(primeiro).getByRole('link', { name: /^Abrir: A vontade/ }));
  expect(ir).toHaveBeenLastCalledWith({ nome: 'leitura', documento_id: DOC, secao_id: SECAO });
  expect(consumirIntencao(DOC, SECAO)).toMatchObject({ marca: item().id, nota: true, faixa: { inicio_utf16: 2, fim_utf16: 30 } });
  // O "⋯": abrir, o outro trecho da relação, copiar; sem "Apagar" enquanto a casca não o liga.
  const relacao = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-chave') === 'relacao:R1')!;
  fireEvent.click(within(relacao).getByRole('button', { name: /^Mais ações/ }));
  const menu = screen.getByRole('menu', { name: 'Ações do item' });
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Abrir', 'Abrir o outro trecho', 'Copiar como citação']);
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Abrir o outro trecho' }));
  expect(ir).toHaveBeenLastCalledWith({ nome: 'leitura', documento_id: DOC, secao_id: SECAO });

  // Filtros: tipo, autoria, documento, função; cada um pede ao serviço e vai para a URL.
  fireEvent.click(screen.getByRole('button', { name: 'Relações' }));
  await waitFor(() => expect(screen.getByText('1 item')).toBeTruthy());
  expect(pedidos.at(-1)).toMatchObject({ tipo: 'relacao', facetas: true });
  expect(window.location.search).toBe('?tipo=relacao');
  fireEvent.click(screen.getByRole('button', { name: 'Tudo' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Codex' }));
  await waitFor(() => expect(pedidos.at(-1)).toMatchObject({ autoria: 'codex' }));
  await screen.findByText('3 itens');
  fireEvent.click(screen.getByRole('combobox', { name: 'Documento' }));
  fireEvent.click(screen.getByRole('option', { name: 'Ensaio' }));
  await waitFor(() => expect(pedidos.at(-1)).toMatchObject({ autoria: 'codex', documento: OUTRO }));
  fireEvent.click(screen.getByRole('combobox', { name: 'Função' }));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Todas as funções', 'Tese']);
  fireEvent.click(screen.getByRole('option', { name: 'Tese' }));
  await waitFor(() => expect(pedidos.at(-1)).toMatchObject({ funcao: 'tese', modo: 'argumentativa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
  await screen.findByText('5 itens');
  // Agrupar por documento: a ordem do texto e um título por documento.
  fireEvent.click(screen.getByRole('switch', { name: 'Agrupar por documento' }));
  await waitFor(() => expect(pedidos.at(-1)).toMatchObject({ ordem: 'documento' }));
  expect((await screen.findAllByRole('heading', { level: 2, name: /Tratado/ })).length).toBeGreaterThan(0);
  expect(screen.getByRole('heading', { level: 2, name: 'Ensaio' })).toBeTruthy();
});

test('busca em tudo espera a digitação; páginas seguintes sem repetir', async () => {
  const muitos = Array.from({ length: 120 }, (_, i) => item({ id: `G${String(i).padStart(3, '0')}`, nota: null, nota_id: null }));
  const { carregar, pedidos } = servidor(muitos);
  render(<Notas ir={vi.fn()} carregar={carregar} />);
  await screen.findByText('120 itens');
  expect(screen.getAllByRole('listitem')).toHaveLength(50);
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar mais (70)' }));
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(100));
  expect(pedidos.at(-1)).toMatchObject({ deslocamento: 50, limite: 50 });
  expect(pedidos.at(-1)?.facetas).toBeUndefined();
  const campo = screen.getByRole('searchbox', { name: 'Procurar nas notas' });
  fireEvent.change(campo, { target: { value: 'vont' } });
  fireEvent.change(campo, { target: { value: 'vontade' } });
  await waitFor(() => expect(pedidos.at(-1)).toMatchObject({ texto: 'vontade', facetas: true }));
  expect(pedidos.filter((p) => p.texto === 'vont')).toHaveLength(0);
});

test('Apagar aparece no "⋯" quando a casca o liga; o item apagado sai da lista', async () => {
  const apagar = vi.fn<(alvo: ItemDaCentral) => Promise<boolean>>(() => Promise.resolve(true));
  render(<Notas ir={vi.fn()} carregar={servidor().carregar} apagar={apagar} />);
  await screen.findByText('5 itens');
  fireEvent.click(screen.getAllByRole('button', { name: /^Mais ações/ })[0]!);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Apagar…' }));
  expect(apagar).toHaveBeenCalledWith(ITENS[0]);
  // Apagado: sai da lista sem recarregar.
  await screen.findByText('4 itens');
  expect(screen.queryByText('Sempre, mesmo?')).toBeNull();
});

test('J143 nas Notas: cada tipo apaga pela sua rota; conexão gravada e dificuldade decidida ficam sem "Apagar…"', async () => {
  const analise = { execucao_id: 'X1', secao_id: SECAO };
  expect(comoApagar(item({ estado: 'aceita', tipo: 'relacao', analise: null }))).toBeNull();
  expect(comoApagar(item({ estado: 'confirmada', tipo: 'dificuldade', analise: null }))).toBeNull();
  expect(comoApagar(item({ tipo: 'conversa' }))).toBeNull();
  expect(comoApagar(item({ tipo: 'nota_antiga' }))).toBeNull();
  await comoApagar(item({ id: 'R9', tipo: 'relacao', estado: 'da_leitura', analise }))!.executar();
  await comoApagar(item({ id: 'D9', tipo: 'dificuldade', estado: 'sugerida', analise }))!.executar();
  expect(vi.mocked(apagarItemDaAnalise).mock.calls).toEqual([['X1', SECAO, 'R9'], ['X1', SECAO, 'D9']]);
});

test('J143 nas Notas: "Apagar…" pede confirmação; "Manter" deixa o item, "Apagar" tira', async () => {
  vi.mocked(apagarGrifoDeQualquerUm).mockClear();
  // A relação da leitura sem `analise` (fixture antiga) não oferece Apagar.
  render(<NotasComApagar ir={vi.fn()} carregar={servidor().carregar} />);
  await screen.findByText('5 itens');
  const menus = () => screen.getAllByRole('button', { name: /^Mais ações/ });
  fireEvent.click(menus()[2]!);
  expect(screen.queryByRole('menuitem', { name: 'Apagar…' })).toBeNull();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  cleanup();
  render(<NotasComApagar ir={vi.fn()} carregar={servidor().carregar} />);
  await screen.findByText('5 itens');
  fireEvent.click(menus()[0]!);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Apagar…' }));
  const aviso = await screen.findByRole('alertdialog', { name: 'Apagar o grifo?' });
  fireEvent.click(within(aviso).getByRole('button', { name: 'Manter' }));
  expect(apagarGrifoDeQualquerUm).not.toHaveBeenCalled();
  expect(screen.getByText('5 itens')).toBeDefined();
  fireEvent.click(menus()[0]!);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Apagar…' }));
  await act(async () => { fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Apagar' })); await Promise.resolve(); });
  expect(apagarGrifoDeQualquerUm).toHaveBeenCalledWith(ITENS[0]!.id);
  await screen.findByText('4 itens');
});

test('notas de um documento: só dele, na ordem do texto, com o voltar e a exportação dele', async () => {
  const { carregar, pedidos } = servidor();
  const ir = vi.fn();
  window.history.replaceState(null, '', `/documentos/${DOC}/notas`);
  render(<Notas documento_id={DOC} ir={ir} carregar={carregar} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Notas · Tratado' })).toBeTruthy();
  expect(pedidos[0]).toEqual({ documento: DOC, ordem: 'documento', limite: 50, facetas: true });
  expect(screen.queryByRole('combobox', { name: 'Documento' })).toBeNull();
  expect(screen.queryByRole('switch', { name: 'Agrupar por documento' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Exportar as notas' }));
  expect(screen.getByRole('menuitem', { name: /CSV/ }).getAttribute('href')).toBe(`/api/notas/exportacao.csv?documento=${DOC}`);
  act(() => { fireEvent.click(screen.getByRole('link', { name: 'Voltar ao documento' })); });
  expect(ir).toHaveBeenCalledWith({ nome: 'documento', documento_id: DOC });
});

test('sem nada: o vazio diz de onde as coisas vêm', async () => {
  render(<Notas ir={vi.fn()} carregar={servidor([]).carregar} />);
  expect(await screen.findByText('Nada ainda. Grife, anote ou peça uma análise ao Codex: tudo aparece aqui.')).toBeTruthy();
});
