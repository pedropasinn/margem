import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FIM_GERENCIADO, INICIO_GERENCIADO, margemIdDaNota, mesclarNota } from './mesclar';

const pastaDoExemplo = new URL('../exemplo/', import.meta.url);
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
