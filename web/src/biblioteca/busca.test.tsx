import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { capituloExemplo } from '../leitor/fixtures/capitulo-exemplo';
import { BuscaNoDocumento, type Ocorrencia } from '../leitor/BuscaNoDocumento';
import { Ler, ancoraDaFaixa, type FontesDaLeitura } from './Ler';
import { Lista } from './Lista';
import { caminhoDaRota, rotaDoCaminho, type Rota } from './rotas';
import type { ArvoreDaVersao, DetalheDoDocumento, ItemDaBiblioteca, RespostaDaBusca, ResultadoDaBusca, SnapshotDoCapitulo } from './tipos';

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const DOC = '0'.repeat(25) + '1';
const OUTRO_CAPITULO = '0'.repeat(25) + '9';

function resultado(parcial: Partial<ResultadoDaBusca> = {}): ResultadoDaBusca {
  return {
    documento_id: DOC, titulo: 'Livro de teste', autor: 'Machado de Assis', formato: 'md', versao_id: capituloExemplo.versao_id,
    capitulo: { id: capituloExemplo.secao.id, titulo: capituloExemplo.secao.titulo },
    bloco_id: capituloExemplo.blocos[1]!.id, pagina: null,
    ocorrencias: [{ inicio_utf16: 0, fim_utf16: 3 }],
    trecho: [{ texto: 'achado', marcado: true }, { texto: ' no texto', marcado: false }],
    ...parcial,
  };
}
function resposta(resultados: ResultadoDaBusca[]): RespostaDaBusca {
  return { consulta: 'x', total: resultados.length, resultados, proximo: null };
}

describe('rota com ?bloco=', () => {
  test('o bloco vai e volta pelo caminho do capítulo; sem capítulo, é ignorado', () => {
    const rota: Rota = { nome: 'leitura', documento_id: 'A', secao_id: 'S', bloco: 'B' };
    expect(caminhoDaRota(rota)).toBe('/ler/A/S?bloco=B');
    expect(rotaDoCaminho('/ler/A/S?bloco=B')).toEqual(rota);
    expect(rotaDoCaminho('/ler/A?bloco=B')).toEqual({ nome: 'leitura', documento_id: 'A' });
  });

  test('a âncora do achado guarda a faixa e o contexto', () => {
    const ancora = ancoraDaFaixa('V', { id: 'B', texto: 'antes alvo depois' }, { inicio_utf16: 6, fim_utf16: 10 });
    expect(ancora).toMatchObject({ bloco_id: 'B', citacao: 'alvo', prefixo: 'antes ', sufixo: ' depois', inicio_utf16: 6, fim_utf16: 10 });
  });
});

describe('painel de busca no documento', () => {
  test('busca, agrupa por capítulo, anda com Enter e Shift Enter e fecha com Esc', async () => {
    const pedidos: string[] = [];
    const idas: Ocorrencia[] = [];
    const fechar = vi.fn();
    const buscar = (documento: string, consulta: string) => {
      pedidos.push(`${documento}:${consulta}`);
      return Promise.resolve(resposta([
        resultado({ ocorrencias: [{ inicio_utf16: 0, fim_utf16: 3 }, { inicio_utf16: 5, fim_utf16: 8 }] }),
        resultado({ capitulo: { id: OUTRO_CAPITULO, titulo: 'Capítulo dois' }, bloco_id: 'B2', pagina: 12,
          trecho: [{ texto: '<b>não é HTML</b> ', marcado: false }, { texto: 'achado', marcado: true }] }),
      ]));
    };
    render(<BuscaNoDocumento documentoId={DOC} aoIr={(o) => idas.push(o)} aoFechar={fechar} buscar={buscar} espera={0} />);
    const campo = screen.getByRole('searchbox', { name: 'Buscar no documento' });
    expect(document.activeElement).toBe(campo);
    fireEvent.change(campo, { target: { value: 'achado' } });
    expect(await screen.findByText('3 ocorrências')).toBeDefined();
    expect(pedidos).toEqual([`${DOC}:achado`]);
    const lista = document.querySelector<HTMLElement>('.busca-no-documento-lista')!;
    expect(within(lista).getByText('Capítulo dois')).toBeDefined();
    // O trecho é texto: a tag vem escrita, e o termo, num <mark>.
    expect(within(lista).getByText(/<b>não é HTML<\/b>/)).toBeDefined();
    expect(lista.querySelector('b')).toBeNull();
    expect(lista.querySelectorAll('mark')).toHaveLength(2);
    expect(within(lista).getByText(/p\. 12/)).toBeDefined();

    fireEvent.keyDown(campo, { key: 'Enter' });
    fireEvent.keyDown(campo, { key: 'Enter' });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(screen.getByText('3 de 3')).toBeDefined();
    fireEvent.keyDown(campo, { key: 'Enter' });
    fireEvent.keyDown(campo, { key: 'Enter', shiftKey: true });
    expect(idas.map((o) => [o.resultado.bloco_id, o.faixa?.inicio_utf16])).toEqual([
      [capituloExemplo.blocos[1]!.id, 0], [capituloExemplo.blocos[1]!.id, 5], ['B2', 0], [capituloExemplo.blocos[1]!.id, 0], ['B2', 0],
    ]);
    fireEvent.click(screen.getByRole('button', { name: /não é HTML/ }));
    expect(idas.at(-1)?.resultado.bloco_id).toBe('B2');

    fireEvent.keyDown(campo, { key: 'Escape' });
    expect(fechar).toHaveBeenCalled();
  });

  test('sem achados diz isso; consulta curta não busca', async () => {
    const buscar = vi.fn(() => Promise.resolve(resposta([])));
    render(<BuscaNoDocumento documentoId={DOC} aoIr={() => undefined} aoFechar={() => undefined} buscar={buscar} espera={0} />);
    const campo = screen.getByRole('searchbox');
    fireEvent.change(campo, { target: { value: 'a' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(buscar).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: 'ausente' } });
    expect(await screen.findByText('Nada encontrado')).toBeDefined();
  });
});

describe('busca no texto da biblioteca', () => {
  function item(parcial: Partial<ItemDaBiblioteca> = {}): ItemDaBiblioteca {
    return {
      id: DOC, titulo: 'Livro de teste', autor: 'Machado de Assis', formato: 'md', criado_em: '2026-09-20T12:00:00.000Z',
      versao_id: '0'.repeat(25) + '2', texto_disponivel: true, estado: 'pronto', detalhe: null, partes_prontas: 0, partes_total: 0,
      marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 }, progresso: null, jobs_em_curso: 0,
      arquivado_em: null, midia: null, ...parcial,
    };
  }

  test('o campo também busca o conteúdo, agrupa por documento e leva ao trecho', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ capitulos: [{ id: 'um', titulo: 'Um' }] })))));
    const destinos: Rota[] = [];
    const consultas: string[] = [];
    const buscarTexto = (consulta: string) => {
      consultas.push(consulta);
      return Promise.resolve(resposta([
        resultado({ bloco_id: 'B1' }), resultado({ bloco_id: 'B2' }),
        resultado({ documento_id: 'outro', titulo: 'Outro texto', autor: null, capitulo: null, bloco_id: 'B3' }),
        // Arquivado ou fora dos filtros: some.
        resultado({ documento_id: 'invisivel', titulo: 'Invisível', bloco_id: 'B4' }),
      ]));
    };
    render(<Lista ir={(r) => destinos.push(r)} buscarTexto={buscarTexto}
      carregar={() => Promise.resolve({ documentos: [item(), item({ id: 'outro', titulo: 'Outro texto' })] })} />);
    await screen.findByRole('link', { name: 'Outro texto' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'achado' } });
    const secao = await screen.findByRole('region', { name: 'Encontrado no texto' });
    expect(consultas).toEqual(['achado']);
    // Nenhum título bate com "achado", mas o texto sim: nada de "Nenhum texto encontrado".
    expect(screen.queryByText('Nenhum texto encontrado.')).toBeNull();
    expect(within(secao).queryByText('Invisível')).toBeNull();
    const trechos = within(secao).getAllByRole('link');
    expect(trechos).toHaveLength(3);
    expect(trechos[0]!.getAttribute('href')).toBe(`/ler/${DOC}/${capituloExemplo.secao.id}?bloco=B1`);
    fireEvent.click(trechos[0]!);
    fireEvent.click(trechos[2]!);
    expect(destinos).toEqual([
      { nome: 'leitura', documento_id: DOC, secao_id: capituloExemplo.secao.id, bloco: 'B1' },
      { nome: 'leitura', documento_id: 'outro' },
    ]);
  });
});

describe('leitor: Ctrl F e ?bloco=', () => {
  const versaoId = capituloExemplo.versao_id;
  const arvore: ArvoreDaVersao = {
    versao_id: versaoId, documento_id: DOC, titulo: 'Livro de teste', secoes: [], limites: [],
    capitulos: [{ id: capituloExemplo.secao.id, titulo: capituloExemplo.secao.titulo }, { id: OUTRO_CAPITULO, titulo: 'Capítulo dois' }],
  };
  const snapshot: SnapshotDoCapitulo = {
    ...capituloExemplo, documento_id: DOC, revisao_marcas: 'a'.repeat(64), recuperacao: [], anterior: null, proxima: OUTRO_CAPITULO,
  };
  const fontes: FontesDaLeitura = {
    documento: () => Promise.resolve({ versao_id: versaoId, autor: null, formato: 'md', midia: null } as unknown as DetalheDoDocumento),
    arvore: () => Promise.resolve(arvore),
    capitulo: () => Promise.resolve(snapshot),
    progresso: () => Promise.resolve({ progresso: null }),
    gravarProgresso: () => Promise.resolve({ estado: 'erro' as const }),
    marca: () => Promise.resolve(null),
  };

  test('Ctrl F abre o painel; achado em outro capítulo abre o capítulo no bloco', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(resposta([
      resultado({ capitulo: { id: OUTRO_CAPITULO, titulo: 'Capítulo dois' }, bloco_id: 'BX' }),
    ]))))));
    const destinos: Rota[] = [];
    render(<Ler documento_id={DOC} secao_id={capituloExemplo.secao.id} ir={(r) => destinos.push(r)} fontes={fontes} />);
    await screen.findByRole('button', { name: 'Buscar no documento' });
    expect(screen.queryByRole('search')).toBeNull();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const campo = await screen.findByRole('searchbox', { name: 'Buscar no documento' });
    fireEvent.change(campo, { target: { value: 'achado' } });
    await screen.findByText('1 ocorrência');
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(destinos.at(-1)).toEqual({ nome: 'leitura', documento_id: DOC, secao_id: OUTRO_CAPITULO, bloco: 'BX' });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar a busca' }));
    expect(screen.queryByRole('search')).toBeNull();
  });

  test('?bloco= rola até o bloco depois que o capítulo abre', async () => {
    const rolados: string[] = [];
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Element.prototype.scrollIntoView = function (this: Element) { if (this instanceof HTMLElement) rolados.push(this.dataset['bloco'] ?? ''); };
    try {
      const alvo = capituloExemplo.blocos[1]!.id;
      render(<Ler documento_id={DOC} secao_id={capituloExemplo.secao.id} bloco={alvo} ir={() => undefined} fontes={fontes} />);
      await waitFor(() => expect(rolados).toContain(alvo), { timeout: 2000 });
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});
