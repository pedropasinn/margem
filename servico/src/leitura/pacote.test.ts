import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { canonicoDeTeste, idTeste, textosDoPrompt, VERSOES } from '../../testes/apoio.js';
import { escreverPacote, hashDaEntrada, montarPacote, textoDosBlocos, type EsbocoDeParte } from './pacote.js';

const textos = textosDoPrompt();

const canonico = canonicoDeTeste({
  titulo: 'Livro de teste',
  blocos: [
    { tipo: 'capitulo', texto: 'Capítulo um' },
    { tipo: 'paragrafo', texto: 'Primeiro parágrafo, com uma tese.' },
    { tipo: 'lista', texto: 'item um\nitem dois' },
    { tipo: 'paragrafo', texto: 'Segundo parágrafo, com a evidência.' },
  ],
  secoes: [{ nivel: 1, inicio: 0, fim: 3 }],
});

const esboco: EsbocoDeParte = {
  ordem: 0,
  blocos_responsaveis: [idTeste('B', 1), idTeste('B', 2)],
  blocos_contexto: [idTeste('B', 0)],
};

test('a mesma parte gera sempre o mesmo hash de entrada', () => {
  const a = montarPacote(canonico, esboco, VERSOES, textos);
  const b = montarPacote(canonico, esboco, VERSOES, textos);
  expect(a.hash_entrada).toBe(b.hash_entrada);
  expect(a.hash_entrada).toMatch(/^[0-9a-f]{64}$/);
});

test('parte diferente, versão diferente ou texto diferente mudam o hash', () => {
  const referencia = hashDaEntrada(canonico, esboco, VERSOES, textos);
  expect(hashDaEntrada(canonico, { ...esboco, ordem: 1 }, VERSOES, textos)).not.toBe(referencia);
  expect(hashDaEntrada(canonico, { ...esboco, blocos_responsaveis: [idTeste('B', 1)] }, VERSOES, textos)).not.toBe(referencia);
  expect(hashDaEntrada(canonico, esboco, { ...VERSOES, prompt_versao: 'leitor-de-parte@2' }, textos)).not.toBe(referencia);
  expect(hashDaEntrada(canonico, esboco, VERSOES, { ...textos, metodo: 'outro método' })).not.toBe(referencia);
});

test('a continuidade não entra no hash: o dedup_key identifica a parte, não a tentativa', () => {
  const sem = montarPacote(canonico, esboco, VERSOES, textos);
  const com = montarPacote(canonico, { ...esboco, continuidade_anterior: '# Continuidade\n\nResumo.' }, VERSOES, textos);
  expect(com.hash_entrada).toBe(sem.hash_entrada);
  expect(com.arquivos.map((arquivo) => arquivo.nome)).toContain('continuidade.md');
  expect(sem.arquivos.map((arquivo) => arquivo.nome)).not.toContain('continuidade.md');
});

test('o texto vai em blocos numerados, sem página e sem offset', () => {
  const texto = textoDosBlocos(canonico, esboco);
  expect(texto).toContain(`⟦b:${idTeste('B', 1)}⟧ [paragrafo]`);
  expect(texto).toContain(`⟦b:${idTeste('B', 0)}⟧ [contexto · capitulo]`);
  expect(texto).toContain('item um\nitem dois');
  expect(texto).toContain('⟦/b⟧');
  // Nada de coordenadas: nem "pagina", nem "utf16", nem "offset".
  expect(texto.toLowerCase()).not.toMatch(/p[áa]gina|utf16|offset|bbox/);
  // Os blocos saem na ordem do canônico, contexto incluído.
  expect(texto.indexOf(idTeste('B', 0))).toBeLessThan(texto.indexOf(idTeste('B', 1)));
});

test('o pacote escrito tem só os arquivos da entrada, com permissão restrita', async () => {
  const diretorio = join(await mkdtemp(join(tmpdir(), 'margem-pacote-teste-')), 'parte');
  try {
    const pacote = montarPacote(canonico, { ...esboco, continuidade_anterior: 'resumo' }, VERSOES, textos);
    await escreverPacote(diretorio, pacote);
    expect((await readdir(diretorio)).sort()).toEqual(
      ['continuidade.md', 'metodo.md', 'prompt.md', 'schema.json', 'sumario.md', 'texto.md']);
    expect((await stat(join(diretorio, 'texto.md'))).mode & 0o777).toBe(0o600);
    const sumario = await readFile(join(diretorio, 'sumario.md'), 'utf8');
    expect(sumario).toContain(`⟦s:${idTeste('S', 0)}⟧ Capítulo um`);
    expect(sumario).toContain('**nesta parte**');
    expect(JSON.parse(await readFile(join(diretorio, 'schema.json'), 'utf8'))).toHaveProperty('$id');
  } finally {
    await rm(join(diretorio, '..'), { recursive: true, force: true });
  }
});

test('bloco de fora da versão é recusado ao montar a entrada', () => {
  expect(() => textoDosBlocos(canonico, { ...esboco, blocos_responsaveis: [idTeste('B', 9)] }))
    .toThrow('não pertence a esta versão');
});
