import { describe, expect, test } from 'vitest';
import { FIM_GERENCIADO, INICIO_GERENCIADO, margemIdDaNota } from './mesclar';
import { juntarCaminho, resumoDoRelatorio, sincronizar, validarIndice, type CofreDaSincronizacao, type DocumentoDoIndice, type IndiceDoMargem } from './sincronizar';

const A = '01KD0000000000000000000010';
const B = '01KD0000000000000000000020';

function notaGerada(id: string, titulo: string, corpo: string): string {
  return `---\ntitulo: ${JSON.stringify(titulo)}\nmargem_id: ${JSON.stringify(id)}\ntags:\n  - margem\n---\n${INICIO_GERENCIADO}\n\n# ${titulo}\n\n${corpo}\n\n${FIM_GERENCIADO}\n`;
}

/** Cofre em memória; `escritas` conta as gravações. */
function cofreEmMemoria(inicial: Record<string, string> = {}) {
  const arquivos = new Map(Object.entries(inicial));
  let escritas = 0;
  const cofre: CofreDaSincronizacao = {
    ler: (caminho) => Promise.resolve(arquivos.get(caminho) ?? null),
    escrever: (caminho, conteudo) => { arquivos.set(caminho, conteudo); escritas++; return Promise.resolve(); },
    notasDoMargem: () => {
      const mapa = new Map<string, string>();
      for (const [caminho, conteudo] of arquivos) { const id = margemIdDaNota(conteudo); if (id) mapa.set(id, caminho); }
      return Promise.resolve(mapa);
    },
  };
  return { cofre, arquivos, escritas: () => escritas };
}

function servidor(notas: Record<string, { titulo: string; arquivo: string; corpo: string }>) {
  const pedidos: string[] = [];
  const documento = (id: string): DocumentoDoIndice => {
    const nota = notas[id]!;
    return { documento_id: id, versao_id: id.replace('D', 'V'), titulo: nota.titulo, arquivo: nota.arquivo,
      sha256: Buffer.from(nota.corpo).toString('hex').padEnd(64, '0').slice(0, 64), itens: 1, atualizado_em: '2026-09-30T12:00:00.000Z' };
  };
  return {
    pedidos,
    cliente: {
      indice: (): Promise<IndiceDoMargem> => Promise.resolve({ versao: 1, url_base: 'https://m.ts.net', marcas: 'minhas', documentos: Object.keys(notas).map(documento) }),
      nota: (id: string) => { pedidos.push(id); const nota = notas[id]!; return Promise.resolve(notaGerada(id, nota.titulo, nota.corpo)); },
    },
  };
}

describe('sincronizar', () => {
  test('cria as notas na pasta, guarda o estado e, sem mudança no servidor, não baixa nem escreve de novo', async () => {
    const { cofre, arquivos, escritas } = cofreEmMemoria();
    const margem = servidor({ [A]: { titulo: 'Livro A', arquivo: 'Livro A.md', corpo: 'um' }, [B]: { titulo: 'Livro B', arquivo: 'Livro B.md', corpo: 'dois' } });
    const primeira = await sincronizar({ cofre, cliente: margem.cliente, pasta: '/Leituras/Margem/', estado: {} });
    expect(primeira.relatorio).toMatchObject({ criadas: ['Leituras/Margem/Livro A.md', 'Leituras/Margem/Livro B.md'], atualizadas: [], iguais: 0 });
    expect(arquivos.get('Leituras/Margem/Livro A.md')).toBe(notaGerada(A, 'Livro A', 'um'));
    expect(Object.keys(primeira.estado)).toEqual([A, B]);

    const segunda = await sincronizar({ cofre, cliente: margem.cliente, pasta: 'Leituras/Margem', estado: primeira.estado });
    expect(segunda.relatorio).toMatchObject({ criadas: [], atualizadas: [], iguais: 2 });
    expect(margem.pedidos).toEqual([A, B]);
    expect(escritas()).toBe(2);
    expect(resumoDoRelatorio(segunda.relatorio)).toBe('Margem: 0 novas, 0 atualizadas, 2 sem mudança.');
  });

  test('nota mudou no servidor: atualiza só o bloco, e acha a nota pelo margem_id mesmo renomeada e movida', async () => {
    const { cofre, arquivos } = cofreEmMemoria();
    const antes = servidor({ [A]: { titulo: 'Livro A', arquivo: 'Livro A.md', corpo: 'um' } });
    const { estado } = await sincronizar({ cofre, cliente: antes.cliente, pasta: 'Margem', estado: {} });
    // O usuário move, renomeia e escreve fora do bloco.
    const escrita = `${arquivos.get('Margem/Livro A.md') ?? ''}\n## Minhas notas\n\nIsto é meu.\n`;
    arquivos.delete('Margem/Livro A.md');
    arquivos.set('Zettel/Literatura/A — fichamento.md', escrita);

    const depois = servidor({ [A]: { titulo: 'Livro A', arquivo: 'Livro A.md', corpo: 'um\n\ndois' } });
    const { relatorio } = await sincronizar({ cofre, cliente: depois.cliente, pasta: 'Margem', estado });
    expect(relatorio.atualizadas).toEqual(['Zettel/Literatura/A — fichamento.md']);
    expect(arquivos.has('Margem/Livro A.md')).toBe(false);
    expect(arquivos.get('Zettel/Literatura/A — fichamento.md')).toBe(`${notaGerada(A, 'Livro A', 'um\n\ndois')}\n## Minhas notas\n\nIsto é meu.\n`);
  });

  test('nota apagada no cofre volta na próxima sincronização', async () => {
    const { cofre, arquivos } = cofreEmMemoria();
    const margem = servidor({ [A]: { titulo: 'Livro A', arquivo: 'Livro A.md', corpo: 'um' } });
    const { estado } = await sincronizar({ cofre, cliente: margem.cliente, pasta: 'Margem', estado: {} });
    arquivos.clear();
    const { relatorio } = await sincronizar({ cofre, cliente: margem.cliente, pasta: 'Margem', estado });
    expect(relatorio.criadas).toEqual(['Margem/Livro A.md']);
  });

  test('outro documento já ocupa o nome: a nota nova ganha o fim do id; nota manual sem margem_id recebe o bloco no fim', async () => {
    const { cofre, arquivos } = cofreEmMemoria({
      'Margem/Livro A.md': notaGerada('01KD0000000000000000000099', 'Livro A', 'de outro documento'),
      'Margem/Livro B.md': '# Livro B\n\nMinhas notas à mão.\n',
    });
    const margem = servidor({ [A]: { titulo: 'Livro A', arquivo: 'Livro A.md', corpo: 'um' }, [B]: { titulo: 'Livro B', arquivo: 'Livro B.md', corpo: 'dois' } });
    const { relatorio } = await sincronizar({ cofre, cliente: margem.cliente, pasta: 'Margem', estado: {} });
    expect(relatorio.criadas).toEqual(['Margem/Livro A (000010).md']);
    expect(relatorio.atualizadas).toEqual(['Margem/Livro B.md']);
    expect(arquivos.get('Margem/Livro A.md')).toContain('de outro documento');
    expect(arquivos.get('Margem/Livro B.md')).toContain('# Livro B\n\nMinhas notas à mão.\n\n%% margem:inicio %%');
  });

  test('marcadores quebrados: conflito no relatório, a nota não é tocada', async () => {
    const quebrada = notaGerada(A, 'Livro A', 'um').replace(FIM_GERENCIADO, '');
    const { cofre, arquivos, escritas } = cofreEmMemoria({ 'Margem/Livro A.md': quebrada });
    const margem = servidor({ [A]: { titulo: 'Livro A', arquivo: 'Livro A.md', corpo: 'dois' } });
    const { relatorio, estado } = await sincronizar({ cofre, cliente: margem.cliente, pasta: 'Margem', estado: {} });
    expect(relatorio.conflitos).toEqual([{ caminho: 'Margem/Livro A.md', motivo: expect.stringContaining('quebrados') as string }]);
    expect(arquivos.get('Margem/Livro A.md')).toBe(quebrada);
    expect(escritas()).toBe(0);
    expect(estado).toEqual({});
    expect(resumoDoRelatorio(relatorio)).toContain('1 com marcadores quebrados');
  });

  test('erro num documento não para os outros', async () => {
    const { cofre } = cofreEmMemoria();
    const margem = servidor({ [A]: { titulo: 'Livro A', arquivo: 'Livro A.md', corpo: 'um' }, [B]: { titulo: 'Livro B', arquivo: 'Livro B.md', corpo: 'dois' } });
    const cliente = { ...margem.cliente, nota: (id: string) => (id === A ? Promise.reject(new Error('caiu')) : margem.cliente.nota(id)) };
    const { relatorio } = await sincronizar({ cofre, cliente, pasta: 'Margem', estado: {} });
    expect(relatorio.erros).toEqual([{ titulo: 'Livro A', motivo: 'caiu' }]);
    expect(relatorio.criadas).toEqual(['Margem/Livro B.md']);
  });

  test('índice que não é do Margem é recusado; nome com pasta também', () => {
    expect(() => validarIndice({ documentos: [] })).toThrow('IndiceObsidianV1');
    expect(() => validarIndice({ versao: 1, documentos: [{ documento_id: A, arquivo: '../fora.md', sha256: 'a' }] })).toThrow('malformado');
    expect(juntarCaminho(' ../a//b/ ', 'x.md')).toBe('a/b/x.md');
  });
});
