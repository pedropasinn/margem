import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { capituloExemplo } from '../leitor/fixtures/capitulo-exemplo';
import { Detalhe } from './Detalhe';
import { Ler, type FontesDaLeitura } from './Ler';
import { Lista } from './Lista';
import { Inicio } from './Inicio';
import { App } from './App';
import { PainelDoItem } from './PainelDoItem';
import { iconeDoDocumento, tipoDoDocumento } from './tipos';
import { caminhoCanonico, caminhoDaRota, rotaDoCaminho, type Rota } from './rotas';
import { categoriaDoDocumento, contadorDaCategoria, contarPorCategoria } from './categorias';
import { fraseDoEstado, frasesDasMarcas } from './estado';
import type { ArvoreDaVersao, DetalheDoDocumento, ItemDaBiblioteca, SnapshotDoCapitulo } from './tipos';
import type { SituacaoDaPreparacao } from './api';

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function item(parcial: Partial<ItemDaBiblioteca> = {}): ItemDaBiblioteca {
  return {
    id: '0'.repeat(25) + '1', titulo: 'Livro de teste', autor: 'Machado de Assis', formato: 'md',
    criado_em: '2026-09-20T12:00:00.000Z', versao_id: '0'.repeat(25) + '2',
    texto_disponivel: true, estado: 'pronto', detalhe: null,
    partes_prontas: 0, partes_total: 0,
    marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 },
    progresso: null, jobs_em_curso: 0, ...parcial,
  };
}

describe('roteamento por history', () => {
  test('os três lugares vão e voltam pelo caminho', () => {
    const rotas: Rota[] = [
      { nome: 'inicio' },
      { nome: 'biblioteca' },
      { nome: 'biblioteca', tipo: 'pdfs', aba: 'lendo' },
      { nome: 'biblioteca', tipo: 'markdowns' },
      { nome: 'adicionar' },
      { nome: 'documento', documento_id: 'ABC' },
      { nome: 'leitura', documento_id: 'ABC' },
      { nome: 'leitura', documento_id: 'ABC', secao_id: 'S1' },
    ];
    for (const rota of rotas) expect(rotaDoCaminho(caminhoDaRota(rota))).toEqual(rota);
  });

  test('V-D1: o antigo filtro de livros cai em Todos e o endereço é trocado pelo canônico', () => {
    expect(rotaDoCaminho('/biblioteca?tipo=livros')).toEqual({ nome: 'biblioteca' });
    expect(rotaDoCaminho('/biblioteca?tipo=livros&aba=lendo')).toEqual({ nome: 'biblioteca', aba: 'lendo' });
    expect(caminhoCanonico('/biblioteca?tipo=livros')).toBe('/biblioteca');
    expect(caminhoCanonico('/biblioteca?tipo=epubs')).toBeNull();
    expect(caminhoCanonico('/documentos/X')).toBeNull();
  });

  test('caminho desconhecido cai no Início', () => {
    expect(rotaDoCaminho('/coisa/que/nao/existe')).toEqual({ nome: 'inicio' });
    expect(rotaDoCaminho('')).toEqual({ nome: 'inicio' });
  });
});

describe('estado do documento em palavras', () => {
  test('cada estado tem a frase que o SPEC pede', () => {
    expect(fraseDoEstado(item({ estado: 'pronto' }))).toBe('texto disponível');
    expect(fraseDoEstado(item({ estado: 'marcando', partes_prontas: 3, partes_total: 9, detalhe: '3 de 9' })))
      .toBe('marcando 3 de 9');
    expect(fraseDoEstado(item({ estado: 'revisando' }))).toBe('revisando');
    expect(fraseDoEstado(item({ estado: 'falhou', detalhe: 'processo' }))).toBe('falhou: processo');
    expect(fraseDoEstado(item({ estado: 'canonizando' }))).toBe('preparando o texto');
    expect(fraseDoEstado(item({ estado: 'transcrevendo' }))).toBe('transcrevendo as páginas');
    // v0.1: a compreensão em andamento aparece na biblioteca, capítulo a capítulo.
    expect(fraseDoEstado(item({ estado: 'preparando', detalhe: 'capítulo 2 de 9' }))).toBe('preparando · capítulo 2 de 9');
    expect(fraseDoEstado(item({ estado: 'preparando' }))).toBe('preparando a leitura');
  });

  test('a contagem de marcas omite as funções zeradas (API anterior ao J107, só as de F1)', () => {
    expect(frasesDasMarcas(item({ marcas: { tese: 2, conceito: 0, justificativa: 1, nenhuma: 0, total: 3 } })))
      .toEqual(['2 tese', '1 justificativa']);
  });

  test('J107: a contagem por função vale para qualquer modo, com o rótulo e a ordem que a API manda', () => {
    const economica = { tese: 0, conceito: 0, justificativa: 0, nenhuma: 1, total: 86, por_funcao: [
      { funcao: 'hipotese', rotulo: 'Hipótese', quantidade: 16 }, { funcao: 'resultado', rotulo: 'Resultado', quantidade: 21 },
      { funcao: 'limitacao', rotulo: 'Limitação', quantidade: 0 }, { funcao: 'nenhuma', rotulo: 'Sem função', quantidade: 1 },
    ] };
    expect(frasesDasMarcas(item({ marcas: economica }))).toEqual(['16 hipótese', '21 resultado', '1 sem função']);
    expect(frasesDasMarcas(item({ marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0, por_funcao: [] } }))).toEqual([]);
  });
});

describe('lista da biblioteca', () => {
  test('mostra título, autor, estado e leva ao detalhe sem recarregar a página', async () => {
    const destinos: Rota[] = [];
    render(
      <Lista
        ir={(destino) => destinos.push(destino)}
        carregar={() => Promise.resolve({
          documentos: [item({ estado: 'marcando', detalhe: '3 de 9', marcas: { tese: 4, conceito: 1, justificativa: 0, nenhuma: 0, total: 5 } })],
        })}
      />,
    );
    const titulo = await screen.findByRole('link', { name: 'Livro de teste' });
    expect(within(screen.getByRole('region', { name: 'Biblioteca' })).getByText('marcando 3 de 9')).toBeDefined();
    expect(screen.getByText('5 marcas')).toBeDefined();
    expect(within(screen.getByRole('region', { name: 'Biblioteca' })).getByText('Machado de Assis')).toBeDefined();
    fireEvent.click(titulo);
    expect(destinos).toEqual([{ nome: 'documento', documento_id: item().id }]);
  });

  test('Início retoma pelo capítulo sem repetir o título; a lista resume marcas e capítulos', async () => {
    const documento = item({ progresso: { capitulos_concluidos: 0, atualizado_em: '2026-09-24T12:00:00Z' } });
    vi.stubGlobal('fetch', vi.fn((caminho: string) => Promise.resolve(new Response(JSON.stringify(caminho.endsWith('/secoes')
      ? { capitulos: [{ id: 'capitulo', titulo: documento.titulo }, { id: 'dois', titulo: 'Dois' }] }
      : { progresso: { capitulos_concluidos: [] } })))));
    const destinos: Rota[] = [];
    const inicio = render(<Inicio ir={(rota) => destinos.push(rota)} carregar={() => Promise.resolve({ documentos: [documento] })} />);
    expect(await screen.findByText('Capítulo 1 de 2')).toBeDefined();
    const retomada = within(screen.getByRole('region', { name: 'Continuar lendo' }));
    expect(retomada.getByLabelText('0 de 2 capítulos').textContent).toBe('0/2');
    expect(retomada.getAllByRole('heading', { name: documento.titulo })).toHaveLength(1);
    const continuar = retomada.getByRole('link', { name: 'Continuar' });
    expect(continuar.parentElement?.querySelector('h3')?.textContent).toBe(documento.titulo);
    expect(continuar.getAttribute('href')).toBe(`/ler/${documento.id}`);
    fireEvent.click(continuar);
    expect(destinos).toEqual([{ nome: 'leitura', documento_id: documento.id }]);
    inicio.unmount();
    render(<Lista ir={() => undefined} carregar={() => Promise.resolve({ documentos: [documento] })} />);
    expect(await screen.findByText('0 de 2 capítulos')).toBeDefined();
    expect(screen.getByText('0 marcas')).toBeDefined();
  });

  test('Início de texto único: sem "capítulo 1 de 1", em andamento até ser lido', async () => {
    const documento = item({ progresso: { capitulos_concluidos: 0, atualizado_em: '2026-09-24T12:00:00Z' } });
    vi.stubGlobal('fetch', vi.fn((caminho: string) => Promise.resolve(new Response(JSON.stringify(caminho.endsWith('/secoes')
      ? { capitulos: [{ id: 'capitulo', titulo: documento.titulo }] }
      : { progresso: { capitulos_concluidos: [] } })))));
    const inicio = render(<Inicio ir={() => undefined} carregar={() => Promise.resolve({ documentos: [documento] })} />);
    await screen.findByRole('region', { name: 'Continuar lendo' });
    expect(within(screen.getByRole('region', { name: 'Continuar lendo' })).getByText('Texto único · em andamento')).toBeDefined();
    expect(screen.queryByText(/capítulo/i)).toBeNull();
    inicio.unmount();
    render(<Lista ir={() => undefined} carregar={() => Promise.resolve({ documentos: [documento] })} />);
    expect(await screen.findByText('texto único')).toBeDefined();
    expect(screen.queryByText(/capítulo 1 de 1/i)).toBeNull();
  });

  test('biblioteca vazia convida a adicionar', async () => {
    render(<Lista ir={() => undefined} carregar={() => Promise.resolve({ documentos: [] })} />);
    expect(await screen.findByText(/Nenhum item ainda/)).toBeDefined();
  });

  test('V-T1: a ordenação mostra o ícone e a escolha (o cabeçalho estreito esconde só o texto); a biblioteca vazia leva aos Primeiros passos das Configurações', async () => {
    const destinos: Rota[] = [];
    const { unmount } = render(<Lista ir={() => undefined} carregar={() => Promise.resolve({ documentos: [item()] })} />);
    await screen.findAllByText(item().titulo);
    const ordem = screen.getByRole('combobox', { name: 'Ordenação' });
    expect(ordem.querySelector('svg')).not.toBeNull();
    expect(ordem.querySelector('.rotulo-da-ordem')?.textContent).toBe('Última leitura');
    fireEvent.click(ordem);
    fireEvent.click(screen.getByRole('option', { name: 'Título' }));
    expect(ordem.querySelector('.rotulo-da-ordem')?.textContent).toBe('Título');
    unmount();
    render(<Lista ir={(r) => destinos.push(r)} carregar={() => Promise.resolve({ documentos: [] })} />);
    const link = await screen.findByRole('link', { name: /Primeiros passos/ });
    expect(link.getAttribute('href')).toBe('/configuracoes/primeiros-passos');
    fireEvent.click(link);
    expect(destinos).toEqual([{ nome: 'configuracoes', secao: 'primeiros-passos' }]);
  });
});

describe('detalhe do documento', () => {
  function detalhe(parcial: Partial<DetalheDoDocumento> = {}): DetalheDoDocumento {
    return {
      ...item(),
      versoes: [{
        id: '0'.repeat(25) + '2', numero: 1, criado_em: '2026-09-20T12:00:00.000Z',
        motor: 'margem-ingest/1', hash_estrutural: 'a'.repeat(64), blocos: 12, secoes: 2, assets: 0,
        limites: ['Tabela sem grade reconstruída como legenda.'],
      }],
      execucoes: [], jobs: [], exportacoes: [], ...parcial,
    };
  }

  test('mostra limites da canonização; "Analisar" é o botão principal, abre a janela do que criar e mostra o estado', async () => {
    const pedidos: boolean[] = [];
    const itensPedidos: string[][] = [];
    const opcao = (id: string, rotulo: string, disponivel = true, requer: string[] = []) => ({ id, rotulo, descricao: rotulo, disponivel, ao_importar: true, requer });
    const CATALOGO = { padrao: { ao_importar: true, itens: ['grifos_relacoes'] }, itens: [
      opcao('grifos_relacoes', 'Grifos e relações'), opcao('mapa', 'Mapa do capítulo', true, ['grifos_relacoes']), opcao('marcadores', 'Marcadores do PDF', false),
    ] };
    const situacao = (estado: SituacaoDaPreparacao['estado'], capitulos: SituacaoDaPreparacao['capitulos'] = []): SituacaoDaPreparacao => ({
      documento_id: item().id, versao_id: item().versao_id, estado, tipo: null, itens: [], compreensao: estado === 'nao_preparada' ? null : { id: 'C', modo: { id: 'ficcao_narrativa', revisao: 1 } },
      capitulos, erro: null,
    });
    render(
      <Detalhe
        documento_id={item().id}
        ir={() => undefined}
        carregar={() => Promise.resolve(detalhe())}
        capitulos={() => Promise.resolve({ capitulos: [{ id: 'S', titulo: 'Um apólogo' }], concluidos: [] })}
        preparacao={{
          situacao: () => Promise.resolve(situacao(pedidos.length === 0 ? 'nao_preparada' : 'preparando', pedidos.length === 0 ? []
            : [{ secao_id: 'S', titulo: 'Um apólogo', estado: 'preparando', etapa: 'analisando', relacoes: null }])),
          catalogo: () => Promise.resolve(CATALOGO),
          preparar: (_id, todos, itens) => {
            pedidos.push(todos === true);
            itensPedidos.push([...(itens ?? [])]);
            return Promise.resolve({ compreensao_id: 'C', criada: true, enfileirados: 1, devolvidos: 0, aguardando_tipo: false,
              situacao: situacao('preparando', [{ secao_id: 'S', titulo: 'Um apólogo', estado: 'preparando', etapa: 'analisando', relacoes: null }]) });
          },
        }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Opções do documento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diagnóstico' }));
    expect(await screen.findByText(/Tabela sem grade/)).toBeDefined();
    expect(screen.getByText(/12 blocos/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    // Nada de texto explicativo: o botão basta. "Analisar" vem à frente e é o primário; ler é secundário.
    const analisar = await screen.findByRole('button', { name: 'Analisar' });
    expect(screen.queryByText(/O Codex lê o texto/u)).toBeNull();
    expect(analisar.className).toMatch(/ui-primario/u);
    const ler = screen.getByRole('link', { name: 'Ler' });
    expect(ler.className).toMatch(/ui-secundario/u);
    expect(analisar.compareDocumentPosition(ler) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Notas, Exercícios e Flashcards são atalhos discretos (links), não botões do mesmo peso.
    const atalhos = screen.getByRole('navigation', { name: 'Do documento' });
    expect(within(atalhos).getAllByRole('link').map((link) => link.textContent?.trim())).toEqual(['Notas', 'Exercícios', 'Flashcards']);
    expect(within(atalhos).getAllByRole('link').every((link) => !link.className.includes('ui-button'))).toBe(true);
    // Nada de família, modo ou "leitura padrão": um botão só.
    expect(screen.queryByText('Usar leitura padrão')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Família do texto' })).toBeNull();
    // O botão abre a janela: o que criar, com o padrão marcado (grifos e relações).
    fireEvent.click(analisar);
    const janela = await screen.findByRole('dialog', { name: 'Analisar' });
    expect(await within(janela).findByRole('checkbox', { name: 'Grifos e relações' })).toHaveProperty('ariaChecked', 'true');
    expect(within(janela).getByRole('checkbox', { name: /Marcadores do PDF/u }).hasAttribute('disabled')).toBe(true);
    // Texto único: sem "capítulo" nos rótulos.
    fireEvent.click(within(janela).getByRole('checkbox', { name: 'Mapa do texto' }));
    expect(within(janela).queryByRole('switch', { name: /Todos os capítulos/u })).toBeNull();
    await act(async () => { fireEvent.click(within(janela).getByRole('button', { name: 'Analisar' })); await Promise.resolve(); });
    expect(await screen.findByText('Analisando o texto…')).toBeDefined();
    expect(pedidos).toEqual([false]);
    expect(itensPedidos).toEqual([['grifos_relacoes', 'mapa']]);
    expect(screen.queryByRole('dialog', { name: 'Analisar' })).toBeNull();
    // Em andamento, o botão principal diz e fica desabilitado.
    expect(screen.getByRole('button', { name: 'Analisando…' }).hasAttribute('disabled')).toBe(true);
  });

  test('"Analisar" chama a análise do tipo do documento: o vídeo tem a própria (ponto de extensão)', async () => {
    const pedidas: string[] = [];
    render(<Detalhe documento_id={item().id} ir={() => undefined}
      carregar={() => Promise.resolve(detalhe({ midia: { tipo: 'video', duracao_s: 600 } } as Partial<DetalheDoDocumento>))}
      capitulos={() => Promise.resolve({ capitulos: [{ id: 'S', titulo: 'Vídeo' }], concluidos: [] })}
      preparacao={{ situacao: () => Promise.resolve(null as unknown as SituacaoDaPreparacao), preparar: () => Promise.reject(new Error('não usado')) }}
      analisar={{ video: (documento) => { pedidas.push(documento.id); } }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Analisar' }));
    expect(pedidas).toEqual([item().id]);
    expect(screen.queryByRole('dialog', { name: 'Analisar' })).toBeNull();
  });

  test('J142: a análise do vídeo que devolve promessa segura o botão e relê a situação no fim', async () => {
    let consultas = 0;
    let terminar: () => void = () => undefined;
    render(<Detalhe documento_id={item().id} ir={() => undefined}
      carregar={() => Promise.resolve(detalhe({ midia: { tipo: 'video', duracao_s: 600 } } as Partial<DetalheDoDocumento>))}
      capitulos={() => Promise.resolve({ capitulos: [{ id: 'S', titulo: 'Vídeo' }], concluidos: [] })}
      preparacao={{ situacao: () => { consultas += 1; return Promise.resolve(null as unknown as SituacaoDaPreparacao); }, preparar: () => Promise.reject(new Error('não usado')) }}
      analisar={{ video: () => new Promise<void>((resolver) => { terminar = resolver; }) }} />);
    const botao = await screen.findByRole('button', { name: 'Analisar' });
    await waitFor(() => { expect(consultas).toBeGreaterThan(0); });
    const antes = consultas;
    fireEvent.click(botao);
    expect(botao.hasAttribute('disabled')).toBe(true);
    await act(async () => { terminar(); await Promise.resolve(); });
    await waitFor(() => { expect(consultas).toBeGreaterThan(antes); });
    expect(screen.getByRole('button', { name: 'Analisar' }).hasAttribute('disabled')).toBe(false);
  });

  test('J107: "Marcas por função" mostra as funções do modo econômico, não só o total', async () => {
    const marcas = { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 85, por_funcao: [
      { funcao: 'hipotese', rotulo: 'Hipótese', quantidade: 16 }, { funcao: 'mecanismo', rotulo: 'Mecanismo', quantidade: 18 },
      { funcao: 'evidencia', rotulo: 'Evidência', quantidade: 8 }, { funcao: 'resultado', rotulo: 'Resultado', quantidade: 21 },
      { funcao: 'limitacao', rotulo: 'Limitação', quantidade: 22 },
    ] };
    render(<Detalhe documento_id={item().id} ir={() => undefined} carregar={() => Promise.resolve(detalhe({ marcas }))}
      capitulos={() => Promise.resolve({ capitulos: [], concluidos: [] })} />);
    expect(await screen.findByText(/^85 marcas/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Opções do documento' }));
    expect(await screen.findByText('16 hipótese · 18 mecanismo · 8 evidência · 21 resultado · 22 limitação')).toBeDefined();
  });
});

test('PDF escaneado: "N páginas sem texto — transcrever" pede o job e some enquanto ele roda', async () => {
  const pedidos: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, opcoes?: RequestInit) => {
    pedidos.push(`${opcoes?.method ?? 'GET'} ${url}`);
    return Promise.resolve(new Response(JSON.stringify({ camadas: [], job_id: 'J', estado: 'fila', paginas: 3 }), { status: 202 }));
  }));
  let estado: ItemDaBiblioteca['estado'] = 'pronto';
  const carregar = () => Promise.resolve({ ...item({ formato: 'pdf', estado }), paginas_sem_texto: 3, versoes: [], execucoes: [], jobs: [], exportacoes: [] } as DetalheDoDocumento);
  render(<Detalhe documento_id={item().id} ir={() => undefined} carregar={carregar} capitulos={() => Promise.resolve({ capitulos: [], concluidos: [] })} />);
  expect(await screen.findByText(/3 páginas sem texto/)).toBeDefined();
  estado = 'transcrevendo';
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'transcrever' })); await Promise.resolve(); });
  await waitFor(() => { expect(screen.queryByText(/páginas sem texto/)).toBeNull(); });
  expect(pedidos).toContain(`POST /api/documentos/${item().id}/transcrever`);
  expect(screen.getByText('transcrevendo as páginas')).toBeDefined();
});

test('detalhe de um texto único: sem índice de capítulos, "Ler" e o estado da leitura', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ camadas: [] })))));
  const carregar = () => Promise.resolve({ ...item(), versoes: [], execucoes: [], jobs: [], exportacoes: [] } as DetalheDoDocumento);
  const { unmount } = render(<Detalhe documento_id={item().id} ir={() => undefined} carregar={carregar}
    capitulos={() => Promise.resolve({ capitulos: [{ id: 'unico', titulo: 'Livro de teste' }], concluidos: [] })} />);
  expect(await screen.findByText('Texto único')).toBeDefined();
  expect(screen.getByRole('link', { name: 'Ler' })).toBeDefined();
  expect(screen.queryByRole('region', { name: 'Capítulos' })).toBeNull();
  expect(screen.queryByText(/capítulos lidos/)).toBeNull();
  unmount();
  render(<Detalhe documento_id={item().id} ir={() => undefined} carregar={carregar}
    capitulos={() => Promise.resolve({ capitulos: [{ id: 'unico', titulo: 'Livro de teste' }], concluidos: ['unico'] })} />);
  expect(await screen.findByText('Lido')).toBeDefined();
  expect(screen.getByRole('link', { name: 'Reler' })).toBeDefined();
});

test('vídeo se assiste e áudio se ouve: o botão principal fala a língua do documento', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ camadas: [] })))));
  const base = { ...item(), versoes: [], execucoes: [], jobs: [], exportacoes: [] } as DetalheDoDocumento;
  const unico = () => Promise.resolve({ capitulos: [{ id: 'unico', titulo: 'Episódio' }], concluidos: [] });
  const { unmount } = render(<Detalhe documento_id={item().id} ir={() => undefined} capitulos={unico}
    carregar={() => Promise.resolve({ ...base, midia: { tipo: 'video', duracao_s: 600, fonte_url: null } })} />);
  expect(await screen.findByRole('link', { name: 'Assistir' })).toBeDefined();
  expect(screen.queryByRole('link', { name: 'Ler' })).toBeNull();
  unmount();
  render(<Detalhe documento_id={item().id} ir={() => undefined} capitulos={unico}
    carregar={() => Promise.resolve({ ...base, midia: { tipo: 'audio', duracao_s: 600, fonte_url: null } })} />);
  expect(await screen.findByRole('link', { name: 'Ouvir' })).toBeDefined();
});

test('as camadas de leitura ficam no Diagnóstico, com os lotes legados reunidos por modo e dia', async () => {
  const base = { modo: { id: 'argumentativa', revisao: 1 }, criada_em: '2026-09-20T12:00:00Z', marcas: 2 };
  const camadas = [
    ...Array.from({ length: 11 }, (_, i) => ({ ...base, id: `lote-${i}`, tipo: 'importacao' })),
    { ...base, id: 'outra-data', tipo: 'importacao', criada_em: '2026-09-21T12:00:00Z' },
    { ...base, id: 'outro-modo', tipo: 'importacao', modo: { id: 'literaria', revisao: 1 } },
    { ...base, id: 'execucao-1', tipo: 'execucao' },
    { ...base, id: 'execucao-2', tipo: 'execucao' },
  ];
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ camadas })))));
  render(<Detalhe documento_id={item().id} ir={() => undefined}
    carregar={() => Promise.resolve({ ...item(), versoes: [], execucoes: [], jobs: [], exportacoes: [] })}
    capitulos={() => Promise.resolve({ capitulos: [], concluidos: [] })} />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByText('Importação legada · argumentativa · 20/09 · 11 lotes')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Opções do documento' }));
  fireEvent.click(screen.getByRole('button', { name: 'Diagnóstico' }));
  expect(await screen.findByText('Importação legada · argumentativa · 20/09 · 11 lotes')).toBeDefined();
  expect(screen.getByText('Importação legada · argumentativa · 21/09 · 1 lote')).toBeDefined();
  expect(screen.getByText('Importação legada · literaria · 20/09 · 1 lote')).toBeDefined();
  expect(screen.getAllByText('Leitura argumentativa · 20/09')).toHaveLength(2);
});

describe('leitura', () => {
  const versaoId = capituloExemplo.versao_id;
  const arvore: ArvoreDaVersao = {
    versao_id: versaoId, documento_id: item().id, titulo: 'Livro de teste',
    secoes: [], limites: [],
    capitulos: [
      { id: capituloExemplo.secao.id, titulo: capituloExemplo.secao.titulo },
      { id: '0'.repeat(25) + '9', titulo: 'Capítulo dois' },
    ],
  };
  const snapshot: SnapshotDoCapitulo = {
    ...capituloExemplo, documento_id: item().id, revisao_marcas: 'a'.repeat(64),
    recuperacao: [{ secao_id: capituloExemplo.secao.id, perguntas: ['O que a seção afirma?'] }],
    anterior: null, proxima: '0'.repeat(25) + '9',
  };

  function fontes(registro: string[]): FontesDaLeitura {
    return {
      documento: () => Promise.resolve({ ...item(), versoes: [], execucoes: [], jobs: [], exportacoes: [], versao_id: versaoId } as DetalheDoDocumento),
      arvore: () => Promise.resolve(arvore),
      capitulo: (_versao: string, secao: string) => { registro.push(secao); return Promise.resolve(snapshot); },
      progresso: () => Promise.resolve({ progresso: null }),
      gravarProgresso: () => Promise.resolve({ estado: 'erro' as const }),
      marca: () => Promise.resolve(null),
    };
  }

  test('título da aba acompanha capítulo e livro e volta a Margem ao sair', async () => {
    const base = fontes([]);
    const ir = () => undefined;
    const carregar = { ...base, capitulo: (_v: string, secao: string) => Promise.resolve({ ...snapshot, secao: { ...snapshot.secao, id: secao, titulo: secao === snapshot.secao.id ? 'Primeiro' : 'Segundo' } }) };
    const { rerender, unmount } = render(<Ler documento_id={item().id} secao_id={snapshot.secao.id} ir={ir} fontes={carregar} />);
    await waitFor(() => expect(document.title).toBe('Primeiro · Livro de teste — Margem'));
    rerender(<Ler documento_id={item().id} secao_id={arvore.capitulos[1]!.id} ir={ir} fontes={carregar} />);
    await waitFor(() => expect(document.title).toBe('Segundo · Livro de teste — Margem'));
    unmount();
    expect(document.title).toBe('Margem');
  });

  test('a barra conta capítulos sem confundir a ordem das subseções', async () => {
    const base = fontes([]);
    render(<Ler documento_id={item().id} ir={() => undefined} fontes={{ ...base,
      capitulo: () => Promise.resolve({ ...snapshot, secao: { ...snapshot.secao, ordem: 64 } }),
    }} />);
    // A posição no centro da barra é a da lista de capítulos, não a ordem da seção (64).
    expect(await screen.findByRole('button', { name: /^Capítulo 1 de 2; ir para capítulo$/ })).toBeDefined();
    expect(screen.queryByText(/65/)).toBeNull();
  });

  test('abre o primeiro capítulo no ReaderViewport e lista os capítulos ao lado', async () => {
    const registro: string[] = [];
    const destinos: Rota[] = [];
    const { container } = render(
      <Ler documento_id={item().id} ir={(destino) => destinos.push(destino)} fontes={fontes(registro)} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Sumário' }));
    const indice = await screen.findByRole('navigation', { name: 'Capítulos' });
    await within(indice).findByText('Capítulo dois');
    expect(container.querySelector('.leitor')).not.toBeNull();
    expect(registro).toEqual([capituloExemplo.secao.id]);
    // A URL é corrigida para o capítulo aberto, sem empilhar histórico.
    expect(destinos[0]).toEqual({ nome: 'leitura', documento_id: item().id, secao_id: capituloExemplo.secao.id });

    fireEvent.click(within(indice).getByText('Capítulo dois'));
    expect(destinos.at(-1)).toEqual({ nome: 'leitura', documento_id: item().id, secao_id: arvore.capitulos[1]?.id });
  });

  test('barra enxuta (Player v2): voltar só com o ícone, [ abre o sumário e Shift J vai a um capítulo', async () => {
    const destinos: Rota[] = [];
    const { container } = render(<Ler documento_id={item().id} ir={(destino) => destinos.push(destino)} fontes={fontes([])} />);
    const voltar = await screen.findByRole('link', { name: 'Voltar ao documento' });
    expect(voltar.textContent).toBe('');
    fireEvent.click(voltar);
    expect(destinos.at(-1)).toEqual({ nome: 'documento', documento_id: item().id });
    fireEvent.keyDown(window, { key: '[' });
    expect(await screen.findByRole('complementary', { name: 'Sumário do documento' })).toBeDefined();
    // Aberto, o painel esquerdo cobre a faixa das braquetes: elas se escondem.
    expect(container.querySelector<HTMLElement>('.leitor-controlado')?.dataset['lateralEsquerda']).toBe('oculta');
    fireEvent.keyDown(window, { key: 'J', shiftKey: true });
    const campo = await screen.findByRole('textbox', { name: 'Número do capítulo' });
    fireEvent.change(campo, { target: { value: '2' } });
    fireEvent.submit(campo.closest('form')!);
    expect(destinos.at(-1)).toEqual({ nome: 'leitura', documento_id: item().id, secao_id: arvore.capitulos[1]?.id });
  });

  test('sem capítulo pedido, pula a seção que é só título (a folha de rosto) e abre a do texto', async () => {
    const registro: string[] = [];
    const destinos: Rota[] = [];
    const base = fontes(registro);
    const rosto = { ...snapshot, blocos: snapshot.blocos.slice(0, 1).map((bloco) => ({ ...bloco, tipo: 'capitulo' as const })) };
    render(<Ler documento_id={item().id} ir={(destino) => destinos.push(destino)}
      fontes={{ ...base, capitulo: (_versao: string, secao: string) => { registro.push(secao); return Promise.resolve(secao === capituloExemplo.secao.id ? rosto : snapshot); } }} />);
    await waitFor(() => expect(destinos[0]).toEqual({ nome: 'leitura', documento_id: item().id, secao_id: arvore.capitulos[1]?.id }));
    expect(registro).toEqual([capituloExemplo.secao.id, arvore.capitulos[1]?.id]);
  });

  test('o rodapé navega pelos vizinhos que vieram no snapshot', async () => {
    const destinos: Rota[] = [];
    const base = fontes([]);
    render(<Ler documento_id={item().id} ir={(destino) => destinos.push(destino)}
      fontes={{ ...base, capitulo: () => Promise.resolve({ ...snapshot, anterior: 'ANTERIOR' }) }} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Próximo capítulo' }));
    expect(destinos.at(-1)).toEqual({ nome: 'leitura', documento_id: item().id, secao_id: snapshot.proxima });
    fireEvent.click(screen.getByRole('link', { name: 'Anterior' }));
    expect(destinos.at(-1)).toEqual({ nome: 'leitura', documento_id: item().id, secao_id: 'ANTERIOR' });
  });

  test('as perguntas de recuperação do capítulo chegam à margem', async () => {
    render(<Ler documento_id={item().id} ir={() => undefined} fontes={fontes([])} />);
    await screen.findByText('Recuperação da seção');
    expect(screen.getByText('O que a seção afirma?')).not.toBeNull();
  });

  test('texto único: abertura com autor e tempo, sem "Capítulo 1", e o fim do texto marca como lido', async () => {
    // Os testes anteriores deixam a cópia local do progresso (com este capítulo lido pelo "Próximo capítulo").
    window.localStorage.clear();
    const base = fontes([]);
    const unico = { ...snapshot, anterior: null, proxima: null };
    const { container } = render(<Ler documento_id={item().id} ir={() => undefined} fontes={{
      ...base,
      arvore: () => Promise.resolve({ ...arvore, capitulos: arvore.capitulos.slice(0, 1) }),
      capitulo: () => Promise.resolve(unico),
    }} />);
    const abertura = await screen.findByText(/min de leitura/);
    expect(abertura.parentElement?.textContent).toMatch(/^Machado de Assis\d+ min de leitura$/);
    expect(container.querySelector('.leitura.texto-unico')).not.toBeNull();
    expect(screen.queryByText(/^Capítulo \d/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sumário' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Capítulo' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Navegar capítulos' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Terminei a leitura' }));
    expect(await screen.findByText('Lido')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Terminei a leitura' })).toBeNull();
  });

  test('documento sem texto avisa em vez de quebrar', async () => {
    const base = fontes([]);
    render(
      <Ler
        documento_id={item().id}
        ir={() => undefined}
        fontes={{ ...base, documento: () => Promise.resolve({ ...item({ versao_id: null }), versoes: [], execucoes: [], jobs: [], exportacoes: [] } as DetalheDoDocumento) }}
      />,
    );
    expect(await screen.findByText(/ainda não tem texto/)).toBeDefined();
  });
});

describe('regras de interface da biblioteca', () => {
  const folha = readFileSync(`${import.meta.dirname}/biblioteca.css`, 'utf8');

  test('a casca não tem max-width nem borda grossa à esquerda', () => {
    const casca = /\.casca\s*\{([^}]*)\}/.exec(folha)?.[1] ?? '';
    expect(casca).not.toContain('max-width');
    expect(folha).not.toMatch(/border-(inline-start|left)\s*:\s*[3-9]/);
  });

  test('só as duas famílias do leitor e nenhum fundo sobre o texto marcado', () => {
    // Desde a casca da plataforma de estudos (ui/componentes.css) botões, cartões e o capítulo
    // atual têm fundo; a regra do AGENTS.md vale para o segmento de texto, desenhado por SVG.
    const componentes = readFileSync(`${import.meta.dirname}/../ui/componentes.css`, 'utf8');
    for (const css of [folha, componentes]) {
      const familias = new Set([...css.matchAll(/font-family:\s*([^;]+);/g)].map((achado) => (achado[1] ?? '').trim()));
      expect([...familias].every((familia) => ['var(--serif)', 'var(--sans)', 'inherit', "'Figtree Variable'"].includes(familia))).toBe(true);
      const regrasDoTexto = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((achado) => /\.(marca-|segmento|amostra|capitulo(?![-\w])|bloco)/.test(achado[1] ?? ''));
      expect(regrasDoTexto.filter((achado) => /background/.test(achado[2] ?? ''))).toEqual([]);
    }
    expect(componentes).not.toContain('box-shadow: 0 var(--base-3d)');
  });
});


describe('interações da nova biblioteca', () => {
  beforeEach(() => { localStorage.clear(); });
  function simularArvore() {
    vi.stubGlobal('fetch', vi.fn((caminho: string) => Promise.resolve(new Response(JSON.stringify(caminho.endsWith('/secoes')
      ? { capitulos: [{ id: 'um', titulo: 'Um' }, { id: 'dois', titulo: 'Dois' }] }
      : { progresso: { capitulos_concluidos: ['um'] } })))));
  }
  test('setas movem o foco, Enter lê, Shift+Enter abre o documento e busca ignora atalhos', async () => {
    simularArvore();
    const destinos: Rota[] = [];
    const { container } = render(<Lista ir={(r) => destinos.push(r)} carregar={() => Promise.resolve({ documentos: [item(), item({ id: 'segundo', titulo: 'Outro livro' })] })} />);
    await screen.findByRole('link', { name: 'Outro livro' });
    const linhas = container.querySelectorAll<HTMLElement>('[data-linha]');
    act(() => linhas[0]?.focus());
    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    expect(document.activeElement).toBe(linhas[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', shiftKey: true });
    expect(destinos).toEqual([{ nome: 'leitura', documento_id: 'segundo' }, { nome: 'documento', documento_id: 'segundo' }]);
    fireEvent.keyDown(document.activeElement!, { key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    act(() => linhas[0]?.focus());
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(localStorage.getItem('margem:painel-biblioteca')).toBe('false');
  });
  test('filtro de tipo pelo formato do arquivo e busca por autor preserva a navegação das abas', async () => {
    simularArvore();
    const destinos: Rota[] = [];
    render(<Lista rota={{ nome: 'biblioteca', tipo: 'pdfs' }} ir={(r) => destinos.push(r)} carregar={() => Promise.resolve({ documentos: [item(), item({ id: 'pdf', titulo: 'PDF recente', formato: 'pdf', autor: 'Ana' }), item({ id: 'pdf2', titulo: 'Outro PDF', formato: 'pdf' })] })} />);
    await screen.findByRole('link', { name: 'PDF recente' });
    expect(screen.queryByRole('link', { name: 'Livro de teste' })).toBeNull();
    expect(screen.getByText('2 PDFs')).toBeDefined();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Ana' } });
    expect(screen.getByRole('link', { name: 'PDF recente' })).toBeDefined();
    expect(screen.getByText('1 PDF')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Não abertos' }));
    expect(destinos.at(-1)).toEqual({ nome: 'biblioteca', tipo: 'pdfs', aba: 'novos' });
  });
  test('vídeos aparecem como vídeo na linha e têm o próprio filtro', async () => {
    simularArvore();
    const video = item({ id: 'video', titulo: 'A jogada de mestre', formato: 'txt', midia: { tipo: 'video', duracao_s: 1290, fonte_url: null } });
    render(<Lista rota={{ nome: 'biblioteca', tipo: 'videos' }} ir={() => undefined} carregar={() => Promise.resolve({ documentos: [item(), video] })} />);
    await screen.findByRole('link', { name: 'A jogada de mestre' });
    expect(screen.queryByRole('link', { name: 'Livro de teste' })).toBeNull();
    expect(screen.getByText('Vídeo · 22 min')).toBeDefined();
    // A capa do vídeo é a miniatura dele, guardada pelo serviço (J133), não o título repetido.
    const capa = screen.getByRole('link', { name: 'A jogada de mestre' }).closest('.linha-documento')!.querySelector('.capa img');
    expect(capa?.getAttribute('src')).toBe('/api/documentos/video/miniatura');
    expect(screen.getByText('1 vídeo')).toBeDefined();
  });
  test('textos: TXT e texto colado; vídeo (txt com mídia), Markdown e PDF ficam fora', async () => {
    vi.stubGlobal('fetch', vi.fn((caminho: string) => Promise.resolve(new Response(JSON.stringify(caminho.endsWith('/secoes')
      ? { capitulos: [{ id: 'um', titulo: 'Um' }] } : { progresso: null })))));
    const txt = item({ id: 'txt', titulo: 'Notas soltas', formato: 'txt' });
    const colado = item({ id: 'colado', titulo: 'Soneto', formato: 'colado' });
    const md = item({ id: 'md', titulo: 'Artigo da web', formato: 'md' });
    const video = item({ id: 'video', titulo: 'A jogada de mestre', formato: 'txt', midia: { tipo: 'video', duracao_s: 1290, fonte_url: null } });
    const pdf = item({ id: 'pdf', titulo: 'Análise escaneada', formato: 'pdf' });
    render(<Lista rota={{ nome: 'biblioteca', tipo: 'textos' }} ir={() => undefined} carregar={() => Promise.resolve({ documentos: [txt, colado, md, video, pdf] })} />);
    await screen.findByRole('link', { name: 'Soneto' });
    expect(screen.getByRole('link', { name: 'Notas soltas' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Artigo da web' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'A jogada de mestre' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Análise escaneada' })).toBeNull();
    expect(screen.getByText('2 textos')).toBeDefined();
  });

  test('V-D1: as categorias não se sobrepõem, a soma bate com Todos e nada pede a árvore para classificar', async () => {
    const buscas = vi.fn((caminho: string) => Promise.resolve(new Response(JSON.stringify(caminho.endsWith('/secoes') ? { capitulos: [] } : { progresso: null }))));
    vi.stubGlobal('fetch', buscas);
    const documentos = [
      item({ id: 'pdf-livro', titulo: 'Tratado', formato: 'pdf', capitulos_total: 14 }),
      item({ id: 'pdf-curto', titulo: 'Artigo', formato: 'pdf', capitulos_total: 1 }),
      item({ id: 'md-capitulos', titulo: 'Engenharia de Software', formato: 'md', capitulos_total: 9 }),
      item({ id: 'epub-unico', titulo: 'Conto', formato: 'epub', capitulos_total: 1 }),
      item({ id: 'txt', titulo: 'Notas', formato: 'txt', capitulos_total: 1 }),
      item({ id: 'colado', titulo: 'Poema', formato: 'colado', capitulos_total: 1 }),
      item({ id: 'video', titulo: 'Aula', formato: 'txt', capitulos_total: 1, midia: { tipo: 'video', duracao_s: 600, fonte_url: null } }),
      item({ id: 'audio', titulo: 'Podcast', formato: 'txt', capitulos_total: 1, midia: { tipo: 'audio', duracao_s: 600, fonte_url: null } }),
      item({ id: 'sem-versao', titulo: 'Ainda preparando', formato: 'epub', versao_id: null, texto_disponivel: false, estado: 'canonizando', capitulos_total: null }),
    ];
    const contagem = contarPorCategoria(documentos);
    expect(contagem).toEqual({ pdfs: 2, epubs: 2, textos: 2, markdowns: 1, videos: 2, quadros: 0 });
    expect(Object.values(contagem).reduce((a, b) => a + b, 0)).toBe(documentos.length);
    expect(categoriaDoDocumento({ formato: 'pdf_foto', midia: null })).toBe('pdfs');
    const vistos: string[] = [];
    for (const tipo of ['pdfs', 'epubs', 'textos', 'markdowns', 'videos'] as const) {
      const { container, unmount } = render(<Lista rota={{ nome: 'biblioteca', tipo }} ir={() => undefined} carregar={() => Promise.resolve({ documentos })} />);
      await waitFor(() => expect(container.querySelectorAll('[data-linha]').length).toBe(contagem[tipo]));
      vistos.push(...[...container.querySelectorAll('.linha-documento .titulo')].map((a) => a.textContent ?? ''));
      unmount();
    }
    expect(vistos.sort()).toEqual(documentos.map((d) => d.titulo).sort());
    // O painel pede só a árvore do item aberto; a classificação, nenhuma.
    expect(buscas.mock.calls.filter(([caminho]) => caminho.endsWith('/secoes')).length).toBeLessThanOrEqual(5);
    render(<Lista rota={{ nome: 'biblioteca', tipo: 'pdfs' }} ir={() => undefined} carregar={() => Promise.resolve({ documentos })} />);
    expect((await screen.findAllByText('0 de 14 capítulos')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('PDF · Livro')).toHaveLength(1);
  });

  test('V-D1: Quadros só tem as abas Todos e Não abertos', async () => {
    render(<Lista rota={{ nome: 'biblioteca', tipo: 'quadros' }} ir={() => undefined} carregar={() => Promise.resolve({ documentos: [] })} carregarQuadros={() => Promise.resolve({ obras: [], preparando: [] })} />);
    await screen.findByText('Nenhum quadro ainda.');
    const abas = within(screen.getByRole('navigation', { name: 'Filtrar biblioteca' }));
    expect(abas.getAllByRole('button').map((b) => b.textContent)).toEqual(['Todos', 'Não abertos']);
    expect(screen.getByText('0 quadros')).toBeDefined();
  });

  test('V-D1: o contador fala o nome da categoria', () => {
    expect(contadorDaCategoria(47, 'pdfs')).toBe('47 PDFs');
    expect(contadorDaCategoria(1, 'epubs')).toBe('1 EPUB');
    expect(contadorDaCategoria(25, 'markdowns')).toBe('25 Markdowns');
    expect(contadorDaCategoria(20, 'videos', ['video', 'video'])).toBe('20 vídeos');
    expect(contadorDaCategoria(1, 'videos', ['audio'])).toBe('1 áudio');
    expect(contadorDaCategoria(2, 'videos', ['video', 'audio'])).toBe('2 vídeos e áudios');
    expect(contadorDaCategoria(138, 'quadros')).toBe('138 quadros');
    expect(contadorDaCategoria(238, null)).toBe('238 itens');
  });
  test('ação rápida arquiva e atualiza os documentos', async () => {
    simularArvore();
    const carregar = vi.fn().mockResolvedValueOnce({ documentos: [item()] }).mockResolvedValue({ documentos: [] });
    render(<Lista ir={() => undefined} carregar={carregar} />);
    const lista = within(screen.getByRole('region', { name: 'Biblioteca' }));
    fireEvent.click(await lista.findByRole('button', { name: 'Arquivar' }));
    await screen.findByText('Nenhum item ainda.');
    expect(carregar).toHaveBeenCalledTimes(2);
    const chamada = vi.mocked(fetch).mock.calls.find(([url]) => url === `/api/documentos/${item().id}/arquivar`);
    expect(chamada?.[1]).toMatchObject({ method: 'POST', body: '{}', headers: { 'X-Margem': '1' } });
  });
  test('painel marca capítulos concluídos pelos IDs e abre a seção escolhida', async () => {
    simularArvore();
    const destinos: Rota[] = [];
    const arvore: ArvoreDaVersao = { versao_id: 'v', documento_id: item().id, titulo: 'Livro', secoes: [], limites: [], capitulos: [{ id: 'um', titulo: 'Um' }, { id: 'dois', titulo: 'Dois' }] };
    render(<PainelDoItem item={item()} arvore={arvore} ir={(r) => destinos.push(r)} fechar={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Capítulos 2' }));
    await screen.findByLabelText('Lido');
    expect(screen.getByLabelText('Não lido')).toBeDefined();
    fireEvent.click(screen.getByRole('link', { name: 'Não lido Dois' }));
    expect(destinos).toEqual([{ nome: 'leitura', documento_id: item().id, secao_id: 'dois' }]);
  });
});


test('casca lembra o recolhimento; a busca fica na Biblioteca (/ põe o foco no campo)', async () => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ documentos: [] })))));
  const { unmount } = render(<App />);
  await screen.findByRole('heading', { name: 'Início' });
  fireEvent.click(screen.getByRole('button', { name: 'Recolher barra lateral' }));
  expect(localStorage.getItem('margem:barra-lateral')).toBe('false');
  expect(screen.getByRole('button', { name: 'Abrir barra lateral' })).toBeDefined();
  fireEvent.keyDown(window, { key: '[' });
  expect(screen.getByRole('button', { name: 'Recolher barra lateral' })).toBeDefined();
  // V-U3: Buscar saiu da barra (a busca mora na Biblioteca). V-T1: Primeiros passos fica dentro de Configurações, não na barra.
  expect(screen.queryByRole('link', { name: 'Buscar' })).toBeNull();
  const rodape = document.querySelector<HTMLElement>('.barra-lateral .barra-inferior')!;
  expect(within(rodape).getByRole('link', { name: 'Configurações' })).toBeDefined();
  expect(within(document.querySelector<HTMLElement>('.barra-lateral')!).queryByRole('link', { name: 'Primeiros passos' })).toBeNull();
  fireEvent.click(within(document.querySelector<HTMLElement>('.barra-lateral')!).getByRole('link', { name: 'Biblioteca' }));
  await screen.findByRole('searchbox');
  fireEvent.keyDown(window, { key: '/' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));
  expect(window.location.pathname).toBe('/biblioteca');
  fireEvent.keyDown(document.activeElement!, { key: '[' });
  expect(screen.getByRole('button', { name: 'Recolher barra lateral' })).toBeDefined();
  unmount();
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('acabamento da casca e do painel', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ documentos: [], progresso: null })))));
  });
  afterEach(() => { window.history.replaceState(null, '', '/'); localStorage.clear(); });

  test('gaveta intermediária fecha por Esc e pelo véu e devolve foco ao acionador', async () => {
    vi.stubGlobal('innerWidth', 900);
    localStorage.setItem('margem:barra-lateral', 'true');
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'Início' });
    const botao = screen.getByRole('button', { name: 'Abrir barra lateral' });
    for (const modo of ['esc', 'fora']) {
      act(() => botao.focus());
      fireEvent.click(botao);
      const gaveta = screen.getByRole('dialog', { name: 'Navegação' });
      expect(gaveta.contains(document.activeElement)).toBe(true);
      if (modo === 'esc') fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      else fireEvent.pointerDown(container.querySelector('.ui-veu')!);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(botao);
    }
  });

  test.each(['/', '/biblioteca'])('atalhos em %s fecham com Esc, contêm o foco e ignoram campos', async (caminho) => {
    window.history.replaceState(null, '', caminho);
    render(<App />);
    if (caminho === '/') await screen.findByRole('heading', { name: 'Início' });
    else await screen.findByRole('searchbox');
    const botao = screen.getByRole('button', { name: 'Recolher barra lateral' });
    act(() => botao.focus());
    fireEvent.keyDown(botao, { key: '?' });
    const dialogo = screen.getByRole('dialog', { name: 'Atalhos de teclado' });
    expect(within(dialogo).getByText('Shift')).toBeDefined();
    expect(within(dialogo).getByText('Esc')).toBeDefined();
    const fechar = within(dialogo).getByRole('button', { name: 'Fechar' });
    fireEvent.keyDown(fechar, { key: 'Tab' });
    expect(document.activeElement).toBe(fechar);
    fireEvent.keyDown(fechar, { key: '[' });
    expect(screen.getByRole('button', { name: 'Recolher barra lateral' })).toBeDefined();
    fireEvent.keyDown(fechar, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(botao);
    fireEvent.click(screen.getByRole('button', { name: 'Buscar textos na biblioteca' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));
    fireEvent.keyDown(document.activeElement!, { key: '?' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('D-06: com a barra lateral aberta o título é estático; no celular, é o seletor de tipo', async () => {
    window.history.replaceState(null, '', '/biblioteca?tipo=pdfs');
    localStorage.setItem('margem:barra-lateral', 'true');
    const { unmount } = render(<App />);
    await screen.findByRole('searchbox');
    expect(within(screen.getByRole('heading', { level: 1 })).queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PDFs');
    unmount();
    vi.stubGlobal('innerWidth', 390);
    render(<App />);
    await screen.findByRole('searchbox');
    expect(within(screen.getByRole('heading', { level: 1 })).getByRole('combobox', { name: 'Tipo de documento' })).toBeDefined();
  });

  test('D-18: no celular, a barra de baixo tem cinco itens e "Mais" leva a Notas e Flashcards', async () => {
    vi.stubGlobal('innerWidth', 390);
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'Início' });
    const barra = within(container.querySelector<HTMLElement>('.bottomnav')!);
    expect([...container.querySelectorAll('.bottomnav > .bottomnav-item')].map((item) => item.textContent)).toEqual(['Início', 'Biblioteca', 'Adicionar', 'Perguntar', 'Mais']);
    fireEvent.click(barra.getByRole('button', { name: 'Mais' }));
    const mais = within(screen.getByRole('dialog', { name: 'Mais' }));
    fireEvent.click(mais.getByRole('link', { name: 'Notas' }));
    expect(window.location.pathname).toBe('/notas');
    expect(screen.queryByRole('dialog', { name: 'Mais' })).toBeNull();
    expect(barra.getByRole('button', { name: 'Mais' }).className).toContain('active');
  });

  test('busca do topo móvel abre a Biblioteca com foco', async () => {
    vi.stubGlobal('innerWidth', 412);
    render(<App />);
    await screen.findByRole('heading', { name: 'Início' });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar textos na biblioteca' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));
    expect(window.location.pathname).toBe('/biblioteca');
  });

  test('aba Marcas mostra as funções contadas e rodapé mantém os destinos', () => {
    const destinos: Rota[] = [];
    const documento = item({ marcas: { tese: 2, conceito: 3, justificativa: 4, nenhuma: 5, total: 14 } });
    const { container } = render(<PainelDoItem item={documento} arvore={undefined} ir={(r) => destinos.push(r)} fechar={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Marcas 14' }));
    for (const [nome, valor] of [['Tese', '2'], ['Conceito', '3'], ['Justificativa', '4'], ['Sem função', '5']]) {
      expect(screen.getByText(nome!).closest('li')?.textContent).toBe(`${nome}${valor}`);
    }
    const rodape = within(container.querySelector('footer')!);
    fireEvent.click(rodape.getByRole('button', { name: 'Ler' }));
    fireEvent.click(rodape.getByRole('button', { name: 'Documento' }));
    expect(destinos).toEqual([{ nome: 'leitura', documento_id: documento.id }, { nome: 'documento', documento_id: documento.id }]);
  });

  test('J107: aba Marcas e Info com modos misturados, na ordem da API e sem as zeradas', () => {
    const documento = item({ marcas: { tese: 3, conceito: 5, justificativa: 0, nenhuma: 1, total: 13, por_funcao: [
      { funcao: 'conceito', rotulo: 'Conceito', quantidade: 5 }, { funcao: 'tese', rotulo: 'Tese', quantidade: 3 },
      { funcao: 'imagem', rotulo: 'Imagem', quantidade: 4 }, { funcao: 'nenhuma', rotulo: 'Sem função', quantidade: 1 },
    ] } });
    const { container } = render(<PainelDoItem item={documento} arvore={undefined} ir={() => undefined} fechar={() => undefined} />);
    expect(container.querySelector('dd small')?.textContent).toBe('5 conceito · 3 tese · 4 imagem · 1 sem função');
    fireEvent.click(screen.getByRole('button', { name: 'Marcas 13' }));
    expect([...container.querySelectorAll('.painel-marcas li')].map((li) => li.textContent))
      .toEqual(['Conceito5', 'Tese3', 'Imagem4', 'Sem função1']);
  });
});

test('cada tipo de documento tem o seu ícone: vídeo, PDF (distinto do texto, mesmo sendo livro), livro e texto', () => {
  const base: { formato: string; midia: null } = { formato: 'md', midia: null };
  expect(iconeDoDocumento({ ...base, midia: { tipo: 'video', duracao_s: 60, fonte_url: null } }, 1)).toBe('video-doc');
  expect(iconeDoDocumento({ ...base, formato: 'pdf' }, 1)).toBe('pdf');
  expect(iconeDoDocumento({ ...base, formato: 'pdf' }, 11)).toBe('pdf');
  expect(iconeDoDocumento(base, 10)).toBe('livro');
  expect(iconeDoDocumento({ ...base, formato: 'txt' }, 1)).toBe('texto');
  expect(tipoDoDocumento({ ...base, formato: 'pdf' }, 11).rotulo).toBe('PDF · livro');
});
