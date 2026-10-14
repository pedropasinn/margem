import { describe, expect, test } from 'vitest';
import { clienteDoMargem, consulta, margemIdDaNota, sincronizarV2, type CofreDaSincronizacao } from './sincronizar';

const DOC = '01KD0000000000000000000010';
const nota = (id: string, tipo: string, corpo: string) =>
  `---\nmargem_esquema: 2\nmargem_tipo: "${tipo}"\nmargem_id: "${id}"\n---\n%% margem:inicio %%\n\n${corpo}\n\n%% margem:fim %%\n`;

describe('cliente do plugin', () => {
  test('pede o índice V2 e as notas do documento com a consulta e o endereço sem barra final', async () => {
    const pedidos: string[] = [];
    const indice = { versao: 2, url_base: 'https://m.ts.net', marcas: 'todas', incluir: ['documento'], notas: [
      { id: DOC, tipo: 'documento', documento_id: DOC, caminho: 'Livro/Livro.md', sha256: 'a'.repeat(64), atualizado_em: '2026-09-30T12:00:00.000Z' },
    ] };
    const cliente = clienteDoMargem({ servidor: 'https://m.ts.net/', marcas: 'todas', todos: true }, (url) => {
      pedidos.push(url);
      return Promise.resolve(JSON.stringify(url.includes('/indice') ? indice : { notas: [{ id: DOC, caminho: 'Livro/Livro.md', conteudo: nota(DOC, 'documento', '# Livro') }] }));
    });
    const arquivos = new Map<string, string>();
    const cofre: CofreDaSincronizacao = {
      ler: (caminho) => Promise.resolve(arquivos.get(caminho) ?? null),
      escrever: (caminho, conteudo) => { arquivos.set(caminho, conteudo); return Promise.resolve(); },
      notasDoMargem: () => Promise.resolve(new Map([...arquivos].flatMap(([caminho, texto]) => { const id = margemIdDaNota(texto); return id ? [[id, caminho] as const] : []; }))),
    };
    const { relatorio } = await sincronizarV2({ cofre, cliente, pasta: 'Margem', estado: {} });
    expect(relatorio.criadas).toEqual(['Margem/Livro/Livro.md']);
    const comum = consulta({ servidor: 'https://m.ts.net', marcas: 'todas', todos: true });
    expect(comum).toBe('marcas=todas&base=https%3A%2F%2Fm.ts.net&todos=1');
    expect(pedidos).toEqual([`https://m.ts.net/api/obsidian/v2/indice?${comum}`, `https://m.ts.net/api/obsidian/v2/documentos/${DOC}?${comum}`]);
  });

  test('resposta sem notas é erro do documento, não quebra a sincronização', async () => {
    const cliente = clienteDoMargem({ servidor: 'http://127.0.0.1:8730', marcas: 'minhas', todos: false },
      (url) => Promise.resolve(url.includes('/indice')
        ? JSON.stringify({ versao: 2, url_base: 'x', marcas: 'minhas', incluir: [], notas: [{ id: DOC, tipo: 'documento', documento_id: DOC, caminho: 'L/L.md', sha256: 'b'.repeat(64), atualizado_em: '' }] })
        : '{}'));
    const cofre: CofreDaSincronizacao = { ler: () => Promise.resolve(null), escrever: () => Promise.resolve(), notasDoMargem: () => Promise.resolve(new Map()) };
    const { relatorio } = await sincronizarV2({ cofre, cliente, pasta: 'Margem', estado: {} });
    expect(relatorio.erros).toEqual([{ titulo: 'L', motivo: 'O Margem não devolveu as notas do documento.' }]);
  });
});
