import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FIM_GERENCIADO, INICIO_GERENCIADO, caminhoSeguro, juntarCaminho, margemIdDaNota, mesclarNota, resumoDoRelatorio, sincronizarV2, validarIndiceV2,
  type CofreDaSincronizacao, type IndiceDoMargemV2, type NotaGeradaV2,
} from './obsidian';

const pastaDoExemplo = new URL('../../integracoes/obsidian/exemplo/', import.meta.url);
const arquivoDoExemplo = readdirSync(pastaDoExemplo).find((nome) => nome.endsWith('.md') && !nome.startsWith('mesclada'));
if (arquivoDoExemplo === undefined) throw new Error('Gere o exemplo com `npm run exemplo-obsidian` na raiz do Margem.');
/** A nota que o serviço gera para a entrada de exemplo (`npm run exemplo-obsidian`). */
const gerada = readFileSync(new URL(arquivoDoExemplo, pastaDoExemplo), 'utf8');

function nota(frontmatter: string, corpo: string): string {
  return `---\n${frontmatter}\n---\n${INICIO_GERENCIADO}\n\n${corpo}\n\n${FIM_GERENCIADO}\n`;
}
const v1 = nota('titulo: "Livro"\nmargem_id: "01KD0000000000000000000010"\natualizado: 2026-09-20\ntags:\n  - margem', '# Livro\n\n> [!quote] Trecho\n> um');
const v2 = nota('titulo: "Livro"\nmargem_id: "01KD0000000000000000000010"\natualizado: 2026-09-30\ntags:\n  - margem', '# Livro\n\n> [!quote] Trecho\n> um\n\n> [!quote] Trecho\n> dois');

function ok(resultado: ReturnType<typeof mesclarNota>): string {
  if (resultado.estado !== 'ok') throw new Error(resultado.motivo);
  return resultado.conteudo;
}

describe('mesclar a nota do Margem com a do cofre', () => {
  test('nota nova: exatamente a gerada', () => {
    expect(ok(mesclarNota(null, gerada))).toBe(gerada);
  });

  test('nota igual à gerada: nada muda (idempotente)', () => {
    expect(ok(mesclarNota(gerada, gerada))).toBe(gerada);
    expect(ok(mesclarNota(v1, v1))).toBe(v1);
  });

  test('preserva o que o usuário escreveu antes e depois do bloco, e troca só o bloco', () => {
    const editada = v1.replace(`${INICIO_GERENCIADO}`, `Minha introdução, com [[link]] e #tag.\n\n${INICIO_GERENCIADO}`)
      + '\n## Minhas conclusões\n\nO autor erra no capítulo 2. ^minha-ideia\n';
    const mesclada = ok(mesclarNota(editada, v2));
    expect(mesclada).toContain('Minha introdução, com [[link]] e #tag.\n\n%% margem:inicio %%');
    expect(mesclada).toContain('> dois\n\n%% margem:fim %%\n\n## Minhas conclusões\n\nO autor erra no capítulo 2. ^minha-ideia\n');
    expect(mesclada).toContain('atualizado: 2026-09-30');
    expect(mesclada).not.toContain('2026-09-20');
    // Mesclar de novo não muda nada.
    expect(ok(mesclarNota(mesclada, v2))).toBe(mesclada);
  });

  test('frontmatter: chaves do Margem trocadas no lugar, as do usuário ficam, tags em união', () => {
    const doUsuario = v1.replace('---\ntitulo', '---\naliases:\n  - Meu livro\ntitulo').replace('tags:\n  - margem', 'tags: [leitura, "margem"]\nlido: false');
    const mesclada = ok(mesclarNota(doUsuario, v2.replace('  - margem', '  - margem\n  - margem/filosofia')));
    expect(mesclada.split('\n---\n')[0]).toBe([
      '---', 'aliases:', '  - Meu livro', 'titulo: "Livro"', 'margem_id: "01KD0000000000000000000010"', 'atualizado: 2026-09-30',
      'tags:', '  - leitura', '  - margem', '  - margem/filosofia', 'lido: false',
    ].join('\n'));
  });

  test('tags do usuário sem nada a acrescentar ficam na forma dele', () => {
    const doUsuario = v1.replace('tags:\n  - margem', 'tags: [margem, leitura]');
    expect(ok(mesclarNota(doUsuario, v2))).toContain('tags: [margem, leitura]\n');
  });

  test('nota escrita à mão com o mesmo nome, sem marcadores: o bloco entra no fim, o texto fica', () => {
    const manual = '# Minhas notas sobre o livro\n\nComecei em setembro.\n';
    const mesclada = ok(mesclarNota(manual, v1));
    expect(mesclada.startsWith('---\ntitulo: "Livro"\n')).toBe(true);
    expect(mesclada).toContain('---\n# Minhas notas sobre o livro\n\nComecei em setembro.\n\n%% margem:inicio %%\n');
    expect(mesclada.endsWith(`${FIM_GERENCIADO}\n`)).toBe(true);
    expect(ok(mesclarNota(mesclada, v1))).toBe(mesclada);
  });

  test('CRLF do cofre vira LF, sem perder texto', () => {
    const windows = `${v1}\nDepois.\n`.replace(/\n/g, '\r\n');
    const mesclada = ok(mesclarNota(windows, v2));
    expect(mesclada).not.toContain('\r');
    expect(mesclada.endsWith(`${FIM_GERENCIADO}\n\nDepois.\n`)).toBe(true);
  });

  test.each([
    ['sem o fim', v1.replace(FIM_GERENCIADO, '')],
    ['sem o início', v1.replace(INICIO_GERENCIADO, '')],
    ['fora de ordem', v1.replace(INICIO_GERENCIADO, 'x').replace(FIM_GERENCIADO, INICIO_GERENCIADO).replace('x', FIM_GERENCIADO)],
    ['repetidos', `${v1}\n${INICIO_GERENCIADO}\n${FIM_GERENCIADO}\n`],
  ])('marcadores quebrados (%s): conflito, nada é escrito', (_nome, quebrada) => {
    expect(mesclarNota(quebrada, v2)).toMatchObject({ estado: 'conflito' });
  });

  test('a nota gerada precisa ter os marcadores', () => {
    expect(mesclarNota(null, '# sem marcadores\n')).toMatchObject({ estado: 'conflito' });
  });

  test('margem_id do frontmatter, com ou sem aspas', () => {
    expect(margemIdDaNota(gerada)).toBe('01KD0000000000000000000010');
    expect(margemIdDaNota('---\nmargem_id: 01KABC\n---\n')).toBe('01KABC');
    expect(margemIdDaNota('# sem frontmatter')).toBeNull();
  });
});

// ------------------------------------------------------------------ sincronização (formato 2)


const DOC = '01KD0000000000000000000010';
const GRIFO = '01KM0000000000000000000010';
const NOTA = '01KN0000000000000000000010';
const sha = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

/** Cofre em memória; conta as gravações. */
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

function notaV2(id: string, tipo: string, corpo: string, extra = ''): string {
  return `---\nmargem_esquema: 2\nmargem_tipo: "${tipo}"\nmargem_id: "${id}"${extra}\ntags:\n  - "margem"\n  - "margem/${tipo}"\n---\n${INICIO_GERENCIADO}\n\n${corpo}\n\n${FIM_GERENCIADO}\n`;
}

/** Um servidor falso com as notas de um documento; `versao` muda o texto da nota do grifo. */
function servidor(versao = 1) {
  const notas: (NotaGeradaV2 & { tipo: string })[] = [
    { id: DOC, tipo: 'documento', caminho: 'Livro/Livro.md', conteudo: notaV2(DOC, 'documento', `# Livro\n\n- [[Tese · 000010]] ^margem-${GRIFO.toLowerCase()}`, '\ntitulo: "Livro"') },
    { id: GRIFO, tipo: 'grifo', caminho: 'Livro/Grifos/Tese · 000010.md', conteudo: notaV2(GRIFO, 'grifo', `> [!important] Tese\n> trecho v${String(versao)}\n^trecho`) },
    { id: NOTA, tipo: 'anotacao', caminho: 'Livro/Anotações/Minha nota · 000010.md', conteudo: notaV2(NOTA, 'anotacao', 'Uma *nota*.') },
  ];
  const pedidos: string[] = [];
  const indice: IndiceDoMargemV2 = {
    versao: 2, url_base: 'https://m.ts.net', marcas: 'minhas', incluir: ['documento', 'grifo', 'anotacao'],
    notas: notas.map((nota) => ({ id: nota.id, tipo: nota.tipo, documento_id: DOC, caminho: nota.caminho, sha256: sha(nota.conteudo), atualizado_em: '2026-09-30T12:00:00.000Z' })),
  };
  return {
    pedidos, notas,
    cliente: {
      indice: () => Promise.resolve(indice),
      documento: (id: string) => { pedidos.push(id); return Promise.resolve({ notas: notas.map(({ id: i, caminho, conteudo }) => ({ id: i, caminho, conteudo })) }); },
    },
  };
}

describe('sincronizar no formato 2', () => {
  test('cria a árvore na pasta; de novo, sem mudança no servidor, não baixa nem escreve', async () => {
    const { cofre, arquivos, escritas } = cofreEmMemoria();
    const margem = servidor();
    const primeira = await sincronizarV2({ cofre, cliente: margem.cliente, pasta: 'Margem', estado: {} });
    expect(primeira.relatorio.criadas).toEqual(['Margem/Livro/Livro.md', 'Margem/Livro/Grifos/Tese · 000010.md', 'Margem/Livro/Anotações/Minha nota · 000010.md']);
    expect(arquivos.get('Margem/Livro/Grifos/Tese · 000010.md')).toBe(margem.notas[1]!.conteudo);
    expect(Object.keys(primeira.estado).sort()).toEqual([DOC, GRIFO, NOTA].sort());
    const segunda = await sincronizarV2({ cofre, cliente: margem.cliente, pasta: 'Margem', estado: primeira.estado });
    expect(segunda.relatorio).toMatchObject({ criadas: [], atualizadas: [], iguais: 3 });
    expect(escritas()).toBe(3);
    expect(margem.pedidos).toEqual([DOC]);
  });

  test('da V1 para a V2: a nota do documento vira índice no mesmo arquivo, o texto do usuário fica; a segunda vez não muda um byte', async () => {
    const v1 = `---\ntitulo: "Livro"\nmargem_id: "${DOC}"\ndata: 2026-09-19\nlido: true\ntags:\n  - margem\n  - leitura\n---\nMinha introdução.\n\n${INICIO_GERENCIADO}\n\n# Livro\n\n> [!quote] Trecho\n> velho ^margem-${GRIFO.toLowerCase()}\n\n${FIM_GERENCIADO}\n\n## Minhas conclusões\n`;
    const { cofre, arquivos } = cofreEmMemoria({ 'Margem/Livro.md': v1, 'Outra/Nota solta.md': '# solta\n' });
    const margem = servidor();
    // O estado da V1 do plugin (por documento) não atrapalha: o sha mudou, a nota é reescrita.
    const primeira = await sincronizarV2({ cofre, cliente: margem.cliente, pasta: 'Margem', estado: { [DOC]: { sha256: 'a'.repeat(64), caminho: 'Margem/Livro.md' } } });
    expect(primeira.relatorio.atualizadas).toEqual(['Margem/Livro.md']);
    expect(primeira.relatorio.criadas).toEqual(['Margem/Livro/Grifos/Tese · 000010.md', 'Margem/Livro/Anotações/Minha nota · 000010.md']);
    const indice = arquivos.get('Margem/Livro.md')!;
    expect(indice).toContain('Minha introdução.\n\n%% margem:inicio %%\n\n# Livro\n\n- [[Tese · 000010]]');
    expect(indice).toContain('%% margem:fim %%\n\n## Minhas conclusões\n');
    expect(indice).toContain('margem_esquema: 2\n');
    expect(indice).toContain('lido: true\n');
    expect(indice).toContain('  - leitura\n');
    expect(arquivos.has('Margem/Livro/Livro.md')).toBe(false);
    const antes = new Map(arquivos);
    const segunda = await sincronizarV2({ cofre, cliente: margem.cliente, pasta: 'Margem', estado: primeira.estado });
    expect(segunda.relatorio).toMatchObject({ criadas: [], atualizadas: [] });
    expect(arquivos).toEqual(antes);
  });

  test('renomear ou mover uma nota no cofre não gera duplicata: a mudança vai para onde ela está', async () => {
    const { cofre, arquivos } = cofreEmMemoria();
    const primeira = await sincronizarV2({ cofre, cliente: servidor(1).cliente, pasta: 'Margem', estado: {} });
    const conteudo = arquivos.get('Margem/Livro/Grifos/Tese · 000010.md')!;
    arquivos.delete('Margem/Livro/Grifos/Tese · 000010.md');
    arquivos.set('Zettel/Minha tese preferida.md', `${conteudo}\nComentário meu.\n`);
    const segunda = await sincronizarV2({ cofre, cliente: servidor(2).cliente, pasta: 'Margem', estado: primeira.estado });
    expect(segunda.relatorio.criadas).toEqual([]);
    expect(segunda.relatorio.atualizadas).toEqual(['Zettel/Minha tese preferida.md']);
    expect(arquivos.get('Zettel/Minha tese preferida.md')).toContain('> trecho v2\n^trecho\n\n%% margem:fim %%\n\nComentário meu.\n');
    expect([...arquivos.keys()].filter((caminho) => caminho.includes('Tese'))).toEqual([]);
    expect(segunda.estado[GRIFO]?.caminho).toBe('Zettel/Minha tese preferida.md');
  });

  test('caminho ocupado por outra nota: a nova ganha o fim do id; marcadores quebrados viram conflito', async () => {
    const ocupado = '---\nmargem_id: "01KX0000000000000000000099"\n---\nOutra coisa.\n';
    const quebrada = `---\nmargem_id: "${NOTA}"\n---\n${INICIO_GERENCIADO}\nsem fim\n`;
    const { cofre, arquivos } = cofreEmMemoria({ 'Margem/Livro/Grifos/Tese · 000010.md': ocupado, 'Margem/Livro/Anotações/x.md': quebrada });
    const { relatorio } = await sincronizarV2({ cofre, cliente: servidor().cliente, pasta: 'Margem', estado: {} });
    expect(relatorio.criadas).toContain('Margem/Livro/Grifos/Tese · 000010 (000010).md');
    expect(arquivos.get('Margem/Livro/Grifos/Tese · 000010.md')).toBe(ocupado);
    expect(relatorio.conflitos).toEqual([{ caminho: 'Margem/Livro/Anotações/x.md', motivo: expect.stringContaining('quebrados') as string }]);
    expect(resumoDoRelatorio(relatorio)).toBe('Margem: 2 novas, 0 atualizadas, 0 sem mudança, 1 com marcadores quebrados (não mexi).');
  });

  test('índice de outro formato ou com caminho perigoso é recusado', () => {
    expect(() => validarIndiceV2({ versao: 1, documentos: [] })).toThrow(/formato 2/);
    const nota = { id: DOC, tipo: 'documento', documento_id: DOC, sha256: 'a'.repeat(64), atualizado_em: '' };
    for (const caminho of ['../fora.md', '/abs.md', 'a\\b.md', 'Livro/.oculto/x.md', 'Livro/x.txt']) {
      expect(() => validarIndiceV2({ versao: 2, notas: [{ ...nota, caminho }] })).toThrow(/malformada/);
    }
    expect(caminhoSeguro('Livro/Grifos/Tese · 000010.md')).toBe(true);
    expect(juntarCaminho(' /Leituras\\Margem/ ', 'Livro/Livro.md')).toBe('Leituras/Margem/Livro/Livro.md');
  });
});
