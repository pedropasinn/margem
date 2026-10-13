import { describe, expect, test } from 'vitest';
import { CABECALHO_DO_FLUXOGRAMA as DO_CONTRATO } from '@margem/contratos';
import { CABECALHO_DO_FLUXOGRAMA, conferirFluxograma } from './fluxograma';

const bom = [
  'flowchart TD',
  '  %% as ideias do capítulo',
  '  A["A tese: o amor é fogo que arde sem se ver"] --> B("Paradoxo")',
  '  B -->|explica| C{"Contradição?"}',
  '  C -- sim --> D([Conclusão])',
  '  C -.-> E[[Voz do poeta]]',
  '  subgraph S1["Segunda estrofe"]',
  '    E ==> F((Fecho));',
  '  end',
  '  A --- F',
].join('\n');

describe('conferirFluxograma', () => {
  test('o cabeçalho é o do contrato VisualV1', () => { expect(CABECALHO_DO_FLUXOGRAMA).toBe(DO_CONTRATO); });
  test('aceita o subconjunto: formas, rótulos entre aspas e simples, ligações com rótulo, subgraph', () => {
    const r = conferirFluxograma(bom);
    expect(r).toEqual({ ok: true, nos: ['A', 'B', 'C', 'D', 'E', 'F'], arestas: 6, subgrafos: 1 });
  });
  test('encadeamento na mesma linha conta cada aresta', () => {
    expect(conferirFluxograma('flowchart TD\nA --> B --> C')).toMatchObject({ ok: true, arestas: 2 });
  });
  test.each([
    ['horizontal', 'flowchart LR\nA --> B', 1],
    ['graph TD', 'graph TD\nA --> B', 1],
    ['diretiva init', '%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\nA', 1],
    ['click', 'flowchart TD\nA --> B\nclick A "javascript:alert(1)"', 3],
    ['style', 'flowchart TD\nA\nstyle A fill:#f00', 3],
    ['classDef', 'flowchart TD\nA\nclassDef x fill:#f00', 3],
    ['HTML no rótulo', 'flowchart TD\nA["<img src=x onerror=alert(1)>"]', 2],
    ['rótulo markdown', 'flowchart TD\nA["`**negrito**`"]', 2],
    ['entidade', 'flowchart TD\nA["&lt;b&gt;"]', 2],
    ['end sobrando', 'flowchart TD\nA\nend', 3],
    ['subgraph aberto', 'flowchart TD\nsubgraph S\nA', 3],
    ['id reservado', 'flowchart TD\nend --> A', 2],
    ['lixo depois do nó', 'flowchart TD\nA --> B C', 2],
    ['rótulo simples com parêntese', 'flowchart TD\nA[texto (com parêntese)]', 2],
    ['vazio', 'flowchart TD\n%% nada', 2],
    ['dois cabeçalhos', 'flowchart TD\nflowchart TD\nA', 2],
    ['sem cabeçalho', '', 1],
  ])('recusa %s', (_nome, codigo, linha) => {
    const r = conferirFluxograma(codigo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.linha).toBe(linha);
  });
});
