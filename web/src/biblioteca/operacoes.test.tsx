import { escolherOpcao } from '../../tests/apoio-react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SituacaoDaPreparacao } from './api';
import { EstadoDaPreparacao, JanelaDaPreparacao, PadraoDaPreparacaoNasConfiguracoes, usePreparacao, type FontesDaPreparacao } from './Operacoes';
import { Adicionar } from './Adicionar';
import { Lista } from './Lista';
import { Detalhe } from './Detalhe';
import type { DetalheDoDocumento } from './tipos';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
function EstadoComHook({ situacao, pedidos }: { situacao: SituacaoDaPreparacao; pedidos: boolean[] }) {
  const preparacao = usePreparacao('doc', true, {
    situacao: () => Promise.resolve(situacao),
    preparar: (_id, todos) => { pedidos.push(todos === true); return Promise.resolve({ compreensao_id: 'C', criada: false, enfileirados: 1, devolvidos: 0, aguardando_tipo: false, situacao }); },
  });
  return <EstadoDaPreparacao preparacao={preparacao} textoUnico={false} />;
}

describe('operação de leitura', () => {
  test('falha vira "Tentar de novo"; num livro, "Analisar todos os capítulos" pede o livro inteiro', async () => {
    const pedidos: boolean[] = [];
    const capitulos = [
      { secao_id: 'A', titulo: 'Um', estado: 'falhou' as const, etapa: 'falhou', relacoes: null },
      { secao_id: 'B', titulo: 'Dois', estado: 'nao_preparado' as const, etapa: 'nao_preparado', relacoes: null },
    ];
    let situacao: SituacaoDaPreparacao = { documento_id: 'doc', versao_id: 'v', estado: 'falhou', tipo: null, itens: [], compreensao: { id: 'C', modo: { id: 'geral', revisao: 1 } },
      capitulos, erro: { codigo: 'processo', mensagem: 'O Codex parou com erro.' } };
    const documento: DetalheDoDocumento = {
      id: 'doc', titulo: 'Livro', autor: null, formato: 'md', criado_em: '2026-09-24T12:00:00Z', versao_id: 'v', texto_disponivel: true,
      estado: 'pronto', detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 },
      progresso: null, jobs_em_curso: 0, versoes: [], execucoes: [], exportacoes: [], jobs: [],
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ camadas: [] }))));
    render(<Detalhe documento_id="doc" carregar={() => Promise.resolve(documento)} ir={() => {}}
      capitulos={() => Promise.resolve({ capitulos: [{ id: 'A', titulo: 'Um' }, { id: 'B', titulo: 'Dois' }], concluidos: [] })}
      preparacao={{
        situacao: () => Promise.resolve(situacao),
        preparar: (_id, todos) => {
          pedidos.push(todos === true);
          situacao = { ...situacao, estado: 'preparando', erro: null, capitulos: capitulos.map((c) => ({ ...c, estado: 'preparando' as const })) };
          return Promise.resolve({ compreensao_id: 'C', criada: false, enfileirados: 2, devolvidos: 1, aguardando_tipo: false, situacao });
        },
      }} />);
    expect(await screen.findByText('A análise parou: O Codex parou com erro.')).toBeDefined();
    // Com falha, o pedido é "Tentar de novo"; "todos os capítulos" espera a falha se resolver.
    expect(screen.queryByRole('button', { name: 'Analisar todos os capítulos' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Analisando… 0 de 2 capítulos prontos.')).toBeDefined();
    expect(pedidos).toEqual([false]);
  });
  test('leitura parcial: diz quantas relações há e oferece o livro inteiro', async () => {
    const pedidos: boolean[] = [];
    const situacao: SituacaoDaPreparacao = { documento_id: 'doc', versao_id: 'v', estado: 'parcial', tipo: null, itens: [], compreensao: { id: 'C', modo: { id: 'geral', revisao: 1 } }, erro: null,
      capitulos: [{ secao_id: 'A', titulo: 'Um', estado: 'pronto', etapa: 'pronto', relacoes: 3 }, { secao_id: 'B', titulo: 'Dois', estado: 'nao_preparado', etapa: 'nao_preparado', relacoes: null }] };
    render(<EstadoComHook situacao={situacao} pedidos={pedidos} />);
    expect(await screen.findByText('Análise pronta em 1 de 2 capítulos · 3 relações.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Analisar todos os capítulos' }));
    await waitFor(() => expect(pedidos).toEqual([true]));
  });
  test('upload informa poesia e faixa de páginas só nos formatos correspondentes', async () => {
    const formularios: FormData[] = [];
    const enviar = vi.fn((formulario: FormData) => { formularios.push(formulario); return Promise.resolve({ documento_id: 'doc', job_id: 'job' }); });
    render(<Adicionar ir={() => {}} enviar={enviar} servicos={{ intervalo: 60_000 }} />);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Poema' } });
    fireEvent.change(screen.getByLabelText('Texto', { exact: true }), { target: { value: 'Um verso\nOutro verso' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    escolherOpcao('Tipo do texto', 'Poesia');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar texto' }));
    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(formularios[0]?.get('poesia')).toBe('1');
    expect(formularios[0]?.has('paginas')).toBe(false);
    fireEvent.change(screen.getByLabelText('Arquivo'), { target: { files: [new File(['pdf'], 'livro.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Mais opções.*livro.pdf/ }));
    expect(screen.queryByRole('combobox', { name: 'Tipo do texto' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Páginas'), { target: { value: '12-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
    await waitFor(() => expect(enviar).toHaveBeenCalledTimes(2));
    expect(formularios[1]?.get('paginas')).toBe('12-25');
    expect(formularios[1]?.has('poesia')).toBe(false);
  });
  test('filtro de arquivados continua acessível na biblioteca vazia', async () => {
    const carregar = vi.fn(() => Promise.resolve({ documentos: [] }));
    render(<Lista carregar={carregar} ir={() => {}} />);
    await screen.findByText('Nenhum item ainda.');
    fireEvent.click(screen.getByRole('button', { name: 'Arquivados' }));
    await waitFor(() => expect(carregar).toHaveBeenLastCalledWith(true));
    expect(screen.getByText('Nada arquivado.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    await waitFor(() => expect(carregar).toHaveBeenLastCalledWith(false));
  });
  test('arquivar e trabalhos chamam as rotas compatíveis com seus estados', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => { urls.push(url); return Promise.resolve(json({})); }));
    const documento: DetalheDoDocumento = {
      id: 'doc', titulo: 'Texto', autor: null, formato: 'txt', criado_em: '2026-09-24T12:00:00Z', versao_id: null, texto_disponivel: false,
      estado: 'sem_texto', detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 }, progresso: null, jobs_em_curso: 1, versoes: [], execucoes: [], exportacoes: [], jobs: ['fila', 'falhou', 'ok'].map((estado) => ({ id: estado, estado, tipo: 'ler_parte', attempt: 1, not_before: null, error_code: null, atualizado_em: '2026-09-24T12:00:00Z' })),
    };
    render(<Detalhe documento_id="doc" carregar={() => Promise.resolve(documento)} ir={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Opções do documento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diagnóstico' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reenfileirar' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Reenfileirar' }));
    await waitFor(() => expect(urls).toEqual(['/api/documentos/doc/arquivar', '/api/jobs/fila/cancelar', '/api/jobs/falhou/reenfileirar']));
  });

  test('trabalho concluído com avisos aparece na página e no Diagnóstico', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({}))));
    const AVISO = 'O Codex leu só parte deste trecho; pode faltar alguma marca.';
    const documento: DetalheDoDocumento = {
      id: 'doc', titulo: 'Texto', autor: null, formato: 'txt', criado_em: '2026-09-24T12:00:00Z', versao_id: null, texto_disponivel: false,
      estado: 'sem_texto', detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 }, progresso: null, jobs_em_curso: 0, versoes: [], execucoes: [], exportacoes: [],
      jobs: [{ id: 'j1', estado: 'ok', tipo: 'ler_parte', attempt: 1, not_before: null, error_code: null, atualizado_em: '2026-09-24T12:00:00Z',
        diagnosticos: [{ nivel: 'aviso', codigo: 'leitura_parcial', mensagem: 'blocos 4–9' }], avisos: [{ codigo: 'leitura_parcial', mensagem: AVISO }] }],
    };
    render(<Detalhe documento_id="doc" carregar={() => Promise.resolve(documento)} ir={() => {}} />);
    expect((await screen.findByText(/Concluído com avisos:/)).textContent).toContain(AVISO);
    fireEvent.click(screen.getByRole('button', { name: 'ver detalhes' }));
    expect(await screen.findByText(/concluído com avisos/)).toBeTruthy();
    expect(screen.getByText(AVISO).tagName).toBe('LI');
  });
});

const ITEM = (id: string, rotulo: string, extra: Partial<{ disponivel: boolean; ao_importar: boolean; requer: string[] }> = {}) =>
  ({ id, rotulo, descricao: rotulo, disponivel: true, ao_importar: true, requer: [], ...extra });
const CATALOGO = { padrao: { ao_importar: true, itens: ['grifos_relacoes'] }, itens: [
  ITEM('grifos_relacoes', 'Grifos e relações'), ITEM('flashcards', 'Flashcards'), ITEM('mapa', 'Mapa do capítulo', { requer: ['grifos_relacoes'] }),
  ITEM('exercicios', 'Resolver os exercícios', { ao_importar: false }), ITEM('narracao', 'Áudio (narração)', { disponivel: false, ao_importar: false }),
] };

const SITUACAO_DA_JANELA: SituacaoDaPreparacao = { documento_id: 'doc', versao_id: 'v', estado: 'nao_preparada', tipo: { tipo_id: 'espiritualidade', rotulo: 'Leitura espiritual e vida de santo', grupo: 'Religião e espiritualidade', origem: 'detectado', confianca: 'alta', justificativa: null, alternativas: [] },
  itens: [], compreensao: null, capitulos: [], erro: null };
function JanelaComHook({ fontes, aoFechar }: { fontes: FontesDaPreparacao; aoFechar: () => void }) {
  const preparacao = usePreparacao('doc', true, fontes);
  return <JanelaDaPreparacao preparacao={preparacao} documentoId="doc" textoUnico={false} aoFechar={aoFechar} />;
}

test('janela: o padrão vem marcado; mapa leva grifos junto; exercícios vão pelas rotas dos exercícios; "em breve" desabilitado', async () => {
  const pedidos: unknown[] = [];
  const exercicios = vi.fn(() => Promise.resolve(3));
  const fontes: FontesDaPreparacao = {
    situacao: () => Promise.resolve(SITUACAO_DA_JANELA), catalogo: () => Promise.resolve(CATALOGO), exercicios,
    preparar: (_id, todos, itens) => { pedidos.push({ todos, itens }); return Promise.resolve({ compreensao_id: 'C', criada: true, enfileirados: 1, devolvidos: 0, aguardando_tipo: false, situacao: SITUACAO_DA_JANELA }); },
  };
  render(<JanelaComHook fontes={fontes} aoFechar={() => pedidos.push('fechou')} />);
  const janela = await screen.findByRole('dialog', { name: 'Analisar' });
  await waitFor(() => expect(within(janela).getByRole('checkbox', { name: 'Grifos e relações' }).getAttribute('aria-checked')).toBe('true'));
  expect(within(janela).getByRole('checkbox', { name: /Áudio \(narração\) · em breve/u }).hasAttribute('disabled')).toBe(true);
  // Família e modo não aparecem; o tipo é informação discreta, com "mudar".
  expect(within(janela).queryByText(/Família/u)).toBeNull();
  expect(within(janela).getByText(/Leitura espiritual e vida de santo/u)).toBeDefined();
  fireEvent.click(within(janela).getByRole('checkbox', { name: 'Grifos e relações' }));
  fireEvent.click(within(janela).getByRole('checkbox', { name: 'Mapa do capítulo' }));
  expect(within(janela).getByRole('checkbox', { name: 'Grifos e relações' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(within(janela).getByRole('checkbox', { name: 'Resolver os exercícios' }));
  fireEvent.click(within(janela).getByRole('switch', { name: /Todos os capítulos agora/u }));
  fireEvent.click(within(janela).getByRole('button', { name: 'Analisar' }));
  await waitFor(() => expect(pedidos).toEqual([{ todos: true, itens: ['grifos_relacoes', 'mapa'] }, 'fechou']));
  expect(exercicios).toHaveBeenCalledWith('doc');
});

test('Configurações → Ao importar: liga, desliga e escolhe o que criar', async () => {
  const gravados: unknown[] = [];
  let atual = CATALOGO;
  render(<PadraoDaPreparacaoNasConfiguracoes fontes={{
    catalogo: () => Promise.resolve(atual),
    gravar: (padrao) => { gravados.push(padrao); atual = { ...atual, padrao }; return Promise.resolve(atual); },
  }} />);
  const secao = await screen.findByRole('region', { name: 'Ao importar' });
  // Exercícios pedem a janela: não entram no padrão.
  expect(within(secao).queryByRole('checkbox', { name: 'Resolver os exercícios' })).toBeNull();
  fireEvent.click(within(secao).getByRole('checkbox', { name: 'Flashcards' }));
  await waitFor(() => expect(gravados).toEqual([{ ao_importar: true, itens: ['grifos_relacoes', 'flashcards'] }]));
  fireEvent.click(within(secao).getByRole('switch', { name: /Analisar sozinho/u }));
  await waitFor(() => expect(gravados[1]).toEqual({ ao_importar: false, itens: ['grifos_relacoes', 'flashcards'] }));
});
