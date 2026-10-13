/** Recursos pessoais na interface (J102): navegação, telas e chamadas somem quando desligados. */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './biblioteca/App';
import { Lista } from './biblioteca/Lista';
import { carregarRecursos, ProvedorDosRecursos, RECURSOS, type Recurso } from './recursos';
import { LinkDoEink } from './eink/LinkDoEink';
import { RotaDoEink } from './eink/RotaDoEink';

const json = (valor: unknown, status = 200) => new Response(JSON.stringify(valor), { status, headers: { 'Content-Type': 'application/json' } });

/** API falsa: biblioteca vazia, quadros com uma obra, notícias e salas vazias; registra cada caminho pedido. */
function rede(recursos: readonly Recurso[] | 'antiga') {
  const pedidos: string[] = [];
  vi.stubGlobal('fetch', vi.fn((caminho: string) => {
    pedidos.push(caminho);
    if (caminho === '/api/recursos') return Promise.resolve(recursos === 'antiga' ? json({ erro: 'nao_encontrado' }, 404) : json({ recursos }));
    if (caminho.startsWith('/api/arte')) return Promise.resolve(json({ obras: [], acervo: { instalado: false, pacote: { versao: '2026.10.12', url: null, obras: 137, bytes: 488_500_000 }, comando: 'npm run arte:instalar' } }));
    if (caminho.startsWith('/api/salas')) return Promise.resolve(json({ salas: [], portao: { url: 'http://127.0.0.1:8760', configurada: true } }));
    return Promise.resolve(json({ documentos: [] }));
  }));
  return pedidos;
}

function app(caminho = '/') {
  window.history.replaceState(null, '', caminho);
  return render(<ProvedorDosRecursos><App /></ProvedorDosRecursos>);
}

const navegacao = () => within(screen.getAllByRole('navigation', { name: 'Seções' })[0]!);

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('carregarRecursos', () => {
  test('lê a lista da API e ignora nomes desconhecidos', async () => {
    const buscar = vi.fn(() => Promise.resolve(json({ recursos: ['sala', 'xpto', 'noticias'] })));
    expect([...await carregarRecursos(buscar)].sort()).toEqual(['noticias', 'sala']);
  });

  test('API anterior ao J102 (404): tudo ligado, como antes; falha de rede: só o padrão (arte)', async () => {
    expect([...await carregarRecursos(() => Promise.resolve(json({}, 404)))]).toEqual([...RECURSOS]);
    expect([...await carregarRecursos(() => Promise.reject(new Error('fora do ar')))]).toEqual(['arte']);
  });
});

describe('instalação nova (nada ligado)', () => {
  test('a navegação não mostra Notícias, Quadros nem Salas de teste, e a API de arte nem é chamada', async () => {
    const pedidos = rede([]);
    app();
    await screen.findByText('Nenhum texto ainda.');
    const nav = navegacao();
    expect(nav.getByText('Início')).toBeDefined();
    expect(nav.getByText('Livros')).toBeDefined();
    expect(nav.queryByText('Notícias')).toBeNull();
    expect(nav.queryByText('Quadros')).toBeNull();
    expect(nav.queryByText('Salas de teste')).toBeNull();
    expect(pedidos.some((caminho) => caminho.startsWith('/api/arte'))).toBe(false);
    expect(pedidos.some((caminho) => caminho.startsWith('/api/noticias'))).toBe(false);
  });

  test.each([
    ['/noticias', '/'],
    ['/salas', '/'],
    ['/salas/nova', '/'],
    ['/quadros/educacao', '/'],
    ['/biblioteca?tipo=quadros', '/biblioteca'],
  ])('%s volta para %s sem desenhar a tela do recurso', async (caminho, destino) => {
    const pedidos = rede([]);
    app(caminho);
    await waitFor(() => { expect(`${window.location.pathname}${window.location.search}`).toBe(destino); });
    expect(pedidos.some((p) => p.startsWith('/api/noticias') || p.startsWith('/api/salas') || p.startsWith('/api/arte'))).toBe(false);
  });

  test('o filtro da biblioteca não oferece Quadros', async () => {
    rede([]);
    render(<ProvedorDosRecursos inicial={[]}><Lista ir={() => undefined} carregar={() => Promise.resolve({ documentos: [] })} /></ProvedorDosRecursos>);
    await screen.findByText('Nenhum texto ainda.');
    fireEvent.click(within(screen.getByRole('heading', { level: 1 })).getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'Quadros' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Livros' })).toBeDefined();
  });
});

describe('instalação com todos os recursos ligados', () => {
  test('a navegação é a de sempre e a lista de quadros é pedida', async () => {
    const pedidos = rede(['noticias', 'audio-colab', 'arte', 'sala']);
    app();
    await waitFor(() => { expect(navegacao().getByText('Notícias')).toBeDefined(); });
    const nav = navegacao();
    expect(nav.getByText('Quadros')).toBeDefined();
    expect(nav.getByText('Salas de teste')).toBeDefined();
    await waitFor(() => { expect(pedidos.some((caminho) => caminho.startsWith('/api/arte'))).toBe(true); });
  });

  test('as telas dos recursos abrem no próprio endereço', async () => {
    rede(['noticias', 'audio-colab', 'arte', 'sala']);
    app('/salas');
    await screen.findByText('Salas de teste', { selector: 'h1' });
    expect(window.location.pathname).toBe('/salas');
  });

  test('API anterior ao J102: tudo como antes', async () => {
    rede('antiga');
    app();
    await waitFor(() => { expect(navegacao().getByText('Notícias')).toBeDefined(); });
    expect(navegacao().getByText('Salas de teste')).toBeDefined();
  });
});

describe('e-ink (J102b)', () => {
  test('desligado: /eink/… volta ao Início sem pedir o capítulo, e o leitor não mostra "Ver no e-ink"', async () => {
    const pedidos = rede([]);
    window.history.replaceState(null, '', '/eink/DOC/SEC');
    render(<ProvedorDosRecursos><RotaDoEink documento_id="DOC" secao_id="SEC" /></ProvedorDosRecursos>);
    await waitFor(() => { expect(window.location.pathname).toBe('/'); });
    await screen.findByText('Nenhum texto ainda.');
    expect(pedidos.some((caminho) => caminho.includes('DOC'))).toBe(false);
    cleanup();
    render(<ProvedorDosRecursos inicial={[]}><ul><LinkDoEink documento_id="DOC" secao_id="SEC" /></ul></ProvedorDosRecursos>);
    expect(screen.queryByText('Ver no e-ink')).toBeNull();
  });

  test('ligado: a carcaça do e-ink abre no próprio endereço e o leitor oferece o link', async () => {
    const pedidos = rede(['eink']);
    window.history.replaceState(null, '', '/eink/DOC/SEC');
    render(<ProvedorDosRecursos><RotaDoEink documento_id="DOC" secao_id="SEC" /></ProvedorDosRecursos>);
    await waitFor(() => { expect(pedidos.some((caminho) => caminho.includes('DOC'))).toBe(true); });
    expect(window.location.pathname).toBe('/eink/DOC/SEC');
    cleanup();
    render(<ProvedorDosRecursos inicial={['eink']}><ul><LinkDoEink documento_id="DOC" secao_id="SEC" /></ul></ProvedorDosRecursos>);
    expect(screen.getByText('Ver no e-ink').closest('a')?.getAttribute('href')).toBe('/eink/DOC/SEC');
  });
});

describe('instalação nova padrão (só arte, J102b)', () => {
  test('Quadros aparece; sem acervo instalado, mostra como baixar os quadros, sem erro', async () => {
    const pedidos = rede(['arte']);
    app('/biblioteca?tipo=quadros');
    // Sem acervo (J110), Quadros explica o que é e como baixar o pacote, em vez do convite de textos.
    await screen.findByText('Nenhum quadro ainda.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(`${window.location.pathname}${window.location.search}`).toBe('/biblioteca?tipo=quadros');
    const nav = navegacao();
    expect(nav.getByText('Quadros')).toBeDefined();
    expect(nav.queryByText('Notícias')).toBeNull();
    expect(nav.queryByText('Salas de teste')).toBeNull();
    expect(pedidos).toContain('/api/arte');
  });
});
