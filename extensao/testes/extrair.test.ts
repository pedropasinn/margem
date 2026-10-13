import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { extrairPagina, extrairSelecao, limparAutor, normalizarData } from '../src/extracao/extrair';
import { documentoDaFixture, documentoDeHtml } from './apoio';

const VENV = new URL('../../motor/.venv/bin/python', import.meta.url).pathname;
const MOTOR = new URL('../../motor', import.meta.url).pathname;

/** Blocos que o motor do Margem produziria deste Markdown (o mesmo código da canonização). */
function blocosDoMotor(markdown: string): { tipo: string; texto: string }[] {
  const programa = 'import json,sys\nfrom margem_motor.texto import extrair_texto\n'
    + 'print(json.dumps([{"tipo": b.tipo, "texto": b.texto} for b in extrair_texto(sys.stdin.buffer.read(), "md")], ensure_ascii=False))';
  const resultado = spawnSync(VENV, ['-c', programa], { input: markdown, cwd: MOTOR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (resultado.status !== 0) throw new Error(resultado.stderr);
  return JSON.parse(resultado.stdout) as { tipo: string; texto: string }[];
}
const comMotor = existsSync(VENV) ? test : test.skip;

describe('notícia (Agência Brasil)', () => {
  const captura = extrairPagina(documentoDaFixture('noticia'));
  test('metadados', () => {
    expect(captura).toMatchObject({
      tipo: 'pagina',
      titulo: 'Eleições 2026: saiba o que pode e o que não pode no dia da votação',
      site: 'Agência Brasil',
      url: 'https://agenciabrasil.ebc.com.br/politica/noticia/2026-09/eleicoes-2026-saiba-o-que-pode-e-o-que-nao-pode-no-dia-da-votacao',
      // article:published_time = 2026-10-01T11:28:00-03:00
      publicado_em: '2026-10-01T14:28:00.000Z',
    });
    expect(captura).not.toHaveProperty('autor');
    expect(captura.palavras).toBeGreaterThan(400);
    expect(captura.previa.length).toBeLessThanOrEqual(420);
  });
  test('corpo: intertítulos, negrito e listas; sem pixel de rastreamento nem menu do site', () => {
    expect(captura.markdown).toMatch(/^Com a proximidade do primeiro turno/);
    expect(captura.markdown).toContain('## Posso levar uma "colinha" em papel para a cabine de votação?');
    expect(captura.markdown).toContain('**estritamente proibido dentro da cabine**');
    expect(captura.markdown).toContain('- Deputado federal (4 dígitos)');
    expect(captura.markdown).not.toContain('ebc.png');
    expect(captura.markdown).not.toContain('Links da página');
    expect(captura.markdown).not.toMatch(/[  ]$/m);
  });
});

describe('post de blog (The Go Blog)', () => {
  const captura = extrairPagina(documentoDaFixture('blog'));
  test('metadados', () => {
    expect(captura.titulo).toContain('Routing Enhancements for Go 1.22');
    expect(captura.autor).toContain('Jonathan Amsterdam');
    expect(captura.site).toBe('go.dev');
  });
  test('código em cerca, código em linha e links na lista final', () => {
    expect(captura.markdown).toContain('```go\nhttp.HandleFunc("/posts/", handlePost)\n```');
    expect(captura.markdown).toContain('`net/http`');
    expect(captura.markdown).toContain('## Links da página\n\n- GitHub discussion: https://github.com/golang/go/discussions/60227');
    expect(captura.markdown).not.toMatch(/\]\(https?:/);
  });
});

describe('Wikipédia em português (Dom Casmurro)', () => {
  const captura = extrairPagina(documentoDaFixture('wikipedia'));
  test('metadados', () => {
    expect(captura.titulo).toBe('Dom Casmurro');
    expect(captura.url).toBe('https://pt.wikipedia.org/wiki/Dom_Casmurro');
    expect(captura.palavras).toBeGreaterThan(5000);
  });
  test('seções preservadas, chamadas de nota como [n], sem "editar" nem "↑"', () => {
    for (const secao of ['## Enredo', '## Características', '## Recepção', '## Referências']) expect(captura.markdown).toContain(secao);
    expect(captura.markdown).toContain('o próprio autor não tenha formulado esta categoria.\\[1\\]');
    expect(captura.markdown).not.toMatch(/\[editar|editar código-fonte/);
    expect(captura.markdown).not.toContain('↑');
    expect(captura.markdown).toContain('*Memórias Póstumas de Brás Cubas*');
  });
});

describe('ponte com o motor do Margem', () => {
  comMotor('o Markdown das três fixtures vira blocos sem sintaxe crua de link, imagem ou escape', () => {
    for (const nome of ['noticia', 'blog', 'wikipedia'] as const) {
      const blocos = blocosDoMotor(extrairPagina(documentoDaFixture(nome)).markdown);
      expect(blocos.length).toBeGreaterThan(5);
      const texto = blocos.filter((bloco) => bloco.tipo !== 'codigo').map((bloco) => bloco.texto).join('\n');
      expect(texto, nome).not.toMatch(/\]\(|!\[|\\[[\]*_#>]/);
      expect(blocos.some((bloco) => bloco.tipo === 'estrofe'), nome).toBe(false);
    }
    const wiki = blocosDoMotor(extrairPagina(documentoDaFixture('wikipedia')).markdown);
    expect(wiki.find((bloco) => bloco.texto === 'Enredo')?.tipo).toMatch(/capitulo|secao/);
    expect(wiki.some((bloco) => bloco.texto.includes('categoria.[1]'))).toBe(true);
  });
});

describe('seleção', () => {
  test('captura só o trecho selecionado, com o título da página', () => {
    const documento = documentoDeHtml('<html><head><title>Página longa</title></head><body><p id="a">Primeiro <b>parágrafo</b>.</p><p id="b">Segundo.</p></body></html>');
    const faixa = documento.createRange();
    faixa.selectNodeContents(documento.getElementById('a')!);
    documento.getSelection()!.addRange(faixa);
    expect(extrairSelecao(documento)).toEqual({
      tipo: 'selecao', titulo: 'Página longa (trecho)', site: 'exemplo.com.br', url: 'https://exemplo.com.br/artigo',
      markdown: 'Primeiro **parágrafo**.', palavras: 2, previa: 'Primeiro parágrafo.',
    });
  });
  test('sem seleção, nada', () => {
    expect(extrairSelecao(documentoDeHtml('<p>x</p>'))).toBeNull();
  });
});

test('normalizarData e limparAutor', () => {
  expect(normalizarData('2026-09-30')).toBe('2026-09-30');
  expect(normalizarData('2026-09-30T10:00:00-03:00')).toBe('2026-09-30T13:00:00.000Z');
  expect(normalizarData('ontem')).toBeUndefined();
  expect(normalizarData(undefined)).toBeUndefined();
  expect(limparAutor('Por Fulana de Tal')).toBe('Fulana de Tal');
  expect(limparAutor('https://facebook.com/fulana')).toBeUndefined();
});
