/**
 * Página "Perguntar": Markdown sem HTML cru, marcas de citação que levam ao trecho, estados do job
 * (fila, pensando, falhou), salvar o mapa no capítulo. O Mermaid é trocado por um esboço (o jsdom
 * não desenha SVG); a régua e a higienização dele têm testes próprios no J70.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ConversaDoAgenteV1, MensagemDoAgenteV1 } from '@margem/contratos';
import { blocosDoMarkdown, Markdown } from './Markdown';

vi.mock('../leitor/visuais/DiagramaMermaid', () => ({
  DiagramaMermaid: ({ codigo, nos, aoCitar }: { codigo: string; nos: { id: string; rotulo: string; ancora?: unknown }[]; aoCitar?: (a: unknown) => void }) => <div data-testid="mermaid" data-codigo={codigo}>
    {nos.map((no) => (no.ancora && aoCitar ? <button key={no.id} type="button" onClick={() => aoCitar(no.ancora)}>{no.rotulo} — ir ao trecho</button> : <span key={no.id}>{no.rotulo}</span>))}
  </div>,
}));
// Importado depois do mock.
const { Perguntar } = await import('./Perguntar');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Markdown do agente', () => {
  test('HTML cru e links ficam como texto; ênfase, código, tabela e listas viram React', () => {
    const { container } = render(<Markdown texto={[
      '## Título', '', 'Texto com **negrito**, *itálico* e `<b>código</b>`.', '',
      '<img src=x onerror="alert(1)"> e <script>alert(2)</script> e [um link](javascript:alert(3))', '',
      '| Livro | Ideia |', '|---|---|', '| Mixtape | DAG |', '', '- um', '- dois', '', '1. primeiro', '', '> citação', '', '```', 'x = 1', '```',
    ].join('\n')} />);
    expect(container.querySelector('img, script, a, iframe')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector('h3')?.textContent).toBe('Título');
    expect(container.querySelector('strong')?.textContent).toBe('negrito');
    expect(container.querySelector('em')?.textContent).toBe('itálico');
    expect(container.querySelector('p code')?.textContent).toBe('<b>código</b>');
    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Livro', 'Ideia']);
    expect(container.querySelector('td')?.textContent).toBe('Mixtape');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(1);
    expect(container.querySelector('blockquote')?.textContent).toBe('citação');
    expect(container.querySelector('pre code')?.textContent).toBe('x = 1');
  });

  test('fórmulas não passam pela ênfase; bloco mermaid vai para o diagrama; marca sem citação fica como texto', () => {
    const { container } = render(<Markdown texto={'Se $a*b*c$ então [c1] e [c2].\n\n```mermaid\nflowchart TD\n  A["x"]\n```'}
      opcoes={{ citacao: (ref) => (ref === 'c1' ? <button type="button">fonte 1</button> : null) }} />);
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('[data-tex="a*b*c"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'fonte 1' })).toBeTruthy();
    expect(container.textContent).toContain('[c2]');
    expect(screen.getByTestId('mermaid').getAttribute('data-codigo')).toBe('flowchart TD\n  A["x"]');
    expect(blocosDoMarkdown('a\nb\n\nc').map((b) => b.tipo)).toEqual(['paragrafo', 'paragrafo']);
  });
});

const C = '01K0000000000000000000C001';
const D = '01K0000000000000000000D001';
const V = '01K0000000000000000000V001';
const S = '01K0000000000000000000S001';
const B = '01K0000000000000000000B001';
const conversa: ConversaDoAgenteV1 = { id: C, titulo: 'Mapa do capítulo 3', criada_em: '2026-10-02T22:00:00.000Z', atualizada_em: '2026-10-02T22:00:00.000Z' };
const pergunta = (estado: MensagemDoAgenteV1['estado'], extra: Partial<MensagemDoAgenteV1> = {}): MensagemDoAgenteV1 => ({
  id: '01K0000000000000000000M001', autor: 'leitor', texto: 'Faça o mapa do capítulo 3', citacoes: [], artefatos: [], diagnosticos: [], estado,
  criada_em: '2026-10-02T22:00:00.000Z', ...extra,
});
const ancora = { versao_id: V, bloco_id: B, inicio_utf16: 0, fim_utf16: 9, citacao: 'Um DAG mostra', prefixo: '', sufixo: '' };
const resposta: MensagemDoAgenteV1 = {
  id: '01K0000000000000000000M002', autor: 'agente', texto: 'O capítulo trata de DAGs [c1].', criada_em: '2026-10-02T22:01:00.000Z',
  citacoes: [{ ref: 'c1', documento_id: D, documento: 'Mixtape', capitulo: 'Directed Acyclic Graphs', secao_id: S, ancora }],
  artefatos: [{ tipo: 'mapa', titulo: 'Mapa dos DAGs', codigo: 'flowchart TD\n  A["DAG"]', nos: [{ id: 'A', rotulo: 'DAG', ancora }],
    capitulo: { documento_id: D, versao_id: V, secao_id: S, titulo: 'Directed Acyclic Graphs', documento: 'Mixtape' } }],
  diagnosticos: [{ codigo: 'citacao_ausente', mensagem: 'c2: o trecho não está literalmente no bloco.' }],
  execucao: { modelo: 'gpt-6-astra', esforco: 'medium', duracao_ms: 61_000 },
};

function servidor(respostas: Record<string, () => unknown>) {
  const chamadas: { url: string; metodo: string }[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, inicio?: RequestInit) => {
    const metodo = inicio?.method ?? 'GET';
    chamadas.push({ url, metodo });
    const corpo = respostas[`${metodo} ${url}`]?.();
    return Promise.resolve(new Response(JSON.stringify(corpo ?? { erro: 'nao_encontrado' }), { status: corpo === undefined ? 404 : 200 }));
  }));
  return chamadas;
}

describe('página Perguntar', () => {
  test('nova conversa: envia a pergunta, mostra a fila e navega para o fio', async () => {
    const chamadas = servidor({
      'GET /api/agente/conversas': () => ({ conversas: [] }),
      'POST /api/agente/conversas': () => ({ conversa, mensagens: [pergunta('na_fila')] }),
    });
    const ir = vi.fn();
    render(<Perguntar ir={ir} />);
    expect(screen.getByRole('heading', { name: 'Perguntar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Faça um mapa do capítulo 3 deste livro' }));
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Sua pergunta' }).value).toBe('Faça um mapa do capítulo 3 deste livro');
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }));
    await waitFor(() => expect(ir).toHaveBeenCalledWith({ nome: 'perguntar', conversa_id: C }, true));
    expect(chamadas.some((c) => c.metodo === 'POST' && c.url === '/api/agente/conversas')).toBe(true);
    expect((await screen.findAllByText('Na fila do Codex…')).length).toBeGreaterThan(0);
  });

  test('pensando relê o fio; a resposta traz marca que leva ao trecho, fontes, mapa com salvar e avisos', async () => {
    let fase = 0;
    const chamadas = servidor({
      'GET /api/agente/conversas': () => ({ conversas: [conversa] }),
      [`GET /api/agente/conversas/${C}`]: () => ({ conversa, mensagens: fase === 0 ? [pergunta('pensando')] : [pergunta('respondida'), resposta] }),
      [`POST /api/agente/mensagens/${resposta.id}/artefatos/0/salvar`]: () => ({ visual_id: '01K0000000000000000000X001', caminho: `/ler/${D}/${S}` }),
    });
    const ir = vi.fn();
    render(<Perguntar conversa_id={C} ir={ir} />);
    expect((await screen.findAllByText('Lendo a biblioteca…')).length).toBeGreaterThan(0);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Perguntar' }).disabled).toBe(true);
    fase = 1;
    const marca = await screen.findByRole('button', { name: 'Fonte 1: ir ao trecho' }, { timeout: 4000 });
    fireEvent.click(marca);
    expect(ir).toHaveBeenLastCalledWith({ nome: 'leitura', documento_id: D, secao_id: S, bloco: B });
    expect(screen.getByRole('region', { name: 'Fontes' }).textContent).toContain('“Um DAG mostra”');
    expect(screen.getByRole('region', { name: 'Fontes' }).textContent).toContain('Mixtape · Directed Acyclic Graphs');
    fireEvent.click(screen.getByRole('button', { name: 'DAG — ir ao trecho' }));
    expect(ir).toHaveBeenLastCalledWith({ nome: 'leitura', documento_id: D, secao_id: S, bloco: B });
    expect(screen.getByText('1 aviso da conferência')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar no capítulo' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'POST' && c.url.endsWith('/artefatos/0/salvar'))).toBe(true));
  });

  test('falha mostra o motivo e "Tentar de novo"; sem citação válida aparece o aviso', async () => {
    const semCitacao: MensagemDoAgenteV1 = { ...resposta, citacoes: [], artefatos: [], diagnosticos: [{ codigo: 'sem_citacao', mensagem: 'Nenhuma citação desta resposta conferiu.' }] };
    const chamadas = servidor({
      'GET /api/agente/conversas': () => ({ conversas: [conversa] }),
      [`GET /api/agente/conversas/${C}`]: () => ({ conversa, mensagens: [pergunta('respondida'), semCitacao, pergunta('falhou', { id: '01K0000000000000000000M003', motivo: 'O Codex passou do prazo.' })] }),
      'POST /api/agente/mensagens/01K0000000000000000000M003/repetir': () => ({ conversa, mensagens: [pergunta('na_fila')] }),
    });
    render(<Perguntar conversa_id={C} ir={vi.fn()} />);
    expect(await screen.findByText('O Codex passou do prazo.')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toBe('Nenhuma citação desta resposta conferiu.');
    expect(screen.getByText('[c1]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'POST' && c.url.endsWith('/repetir'))).toBe(true));
  });
});
