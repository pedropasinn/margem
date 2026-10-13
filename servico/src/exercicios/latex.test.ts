import { expect, test } from 'vitest';
import type { ResolucaoV2 } from '@margem/contratos';
import { linhasComErro } from './compilar.js';
import { calculoEmLatex, escaparTexto, formulaAceitavel, montarTex, prosaEmLatex } from './latex.js';

test('o texto é escapado e os símbolos em Unicode viram comandos', () => {
  expect(escaparTexto('50% de R$ 10 & #1 _x_ {a} ~ ^ \\ < > |')).toBe(
    '50\\% de R\\$ 10 \\& \\#1 \\_x\\_ \\{a\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{} \\textless{} \\textgreater{} \\textbar{}');
  expect(escaparTexto('x ≤ y, n ∈ ℕ')).toBe('x $\\le$ y, n $\\in$ $\\mathbb{N}$');
});

test('fórmula: passa o LaTeX comum, recusa comando perigoso, chave solta e & fora de ambiente', () => {
  expect(formulaAceitavel('\\frac{n(n+1)}{2}')).toBe(true);
  expect(formulaAceitavel('\\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}')).toBe(true);
  expect(formulaAceitavel('\\left( x \\right)')).toBe(true);
  expect(formulaAceitavel('\\input{/etc/passwd}')).toBe(false);
  expect(formulaAceitavel('\\def\\x{1}')).toBe(false);
  expect(formulaAceitavel('\\frac{1}{2')).toBe(false);
  expect(formulaAceitavel('a & b')).toBe(false);
  expect(formulaAceitavel('\\begin{verbatim}x\\end{verbatim}')).toBe(false);
  expect(formulaAceitavel('\\left( x')).toBe(false);
});

test('prosa com fórmulas: na linha, destacada, recusada (vira código) e modo seguro', () => {
  expect(prosaEmLatex('Para $n \\ge 1$ vale:\n$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$')).toBe('Para $n \\ge 1$ vale:\n\\[ \\sum_{i=1}^n i = \\frac{n(n+1)}{2} \\]\n');
  expect(prosaEmLatex('Ruim: $\\frac{1}{2$ fim')).toBe('Ruim: \\texttt{\\textbackslash{}frac\\{1\\}\\{2} fim');
  expect(prosaEmLatex('Seguro: $x^2$', true)).toBe('Seguro: \\texttt{x\\textasciicircum{}2}');
  expect(prosaEmLatex('um\n\ndois\ntrês')).toBe('um\n\ndois\\\\{}\ntrês');
  // Um `[` depois da quebra não pode virar o argumento opcional de `\\`.
  expect(prosaEmLatex('fim\n[0,1] é compacto')).toBe('fim\\\\{}\n[0,1] é compacto');
  expect(prosaEmLatex('Custa \\$ 10 e 5% a mais')).toBe('Custa \\$ 10 e 5\\% a mais');
});

test('o .tex agrupa por capítulo e seção e marca as linhas de cada exercício', () => {
  const sessao = (id: string, enunciado: string): ResolucaoV2 => ({
    versao: 2, id, documento_id: '01M3S8K9DC29QMXKCDJWX3DTMP', versao_id: '01M3S8KV4D2NMVRWE8D6ADMT8K',
    origem: { tipo: 'recorte', pagina: 17, retangulo: { x: 0, y: 0, largura: 1, altura: 0.1 }, imagem_sha256: 'a'.repeat(64) },
    texto_extraido: enunciado, resolucao: { enunciado, legibilidade: 'boa', conceitos: [], observacao: null,
      itens: [{ rotulo: 'a)', enunciado, estrategia: 'Indução.', passos: [{ texto: 'Base.', calculo: '$$1 = 1$$' }], resposta: 'Vale.', verificacao: null }] },
    execucao: null, mensagens: [], criada_em: '2026-10-02T00:00:00Z',
  });
  const { tex, linhas } = montarTex({ titulo: 'Análise Real', autor: 'Elon Lages Lima', geradoEm: new Date('2026-10-02T12:00:00Z') }, [
    { sessao: sessao('01M3S8K9DC29QMXKCDJWX3DTM1', 'Prove $P(1)$.'), capitulo: 'Capítulo 1 · Conjuntos', secao: 'Seção 1: Naturais', numero: '1' },
    { sessao: sessao('01M3S8K9DC29QMXKCDJWX3DTM2', 'Prove $P(2)$.'), capitulo: 'Capítulo 1 · Conjuntos', secao: 'Seção 2: Finitos', numero: '1' },
  ]);
  expect(tex.match(/\\chapter\*/g)).toHaveLength(1);
  expect(tex.match(/\\section\*/g)).toHaveLength(2);
  expect(tex).toContain('\\textbf{Item a)}');
  expect(tex).toContain('{\\Large Elon Lages Lima\\par}');
  const fonte = tex.split('\n');
  expect(fonte[linhas[1]!.inicio - 1]).toBe('\\begin{exercicio}{1 (p.~17)}');
  expect(fonte[linhas[1]!.fim - 1]).toBe('\\end{proof}');
});

test('as linhas com erro saem do log do tectonic e do TeX', () => {
  expect(linhasComErro('error: exercicios.tex:120: Undefined control sequence\n! Missing $ inserted.\nl.98 $x\nerror: halted')).toEqual([120, 98]);
});

test('a conta de várias linhas destacadas vira um gather*; misturada com texto, linha a linha', () => {
  expect(calculoEmLatex('$$a = b$$\n$$b = c$$')).toBe('\\begin{gather*}\na = b \\\\\nb = c\n\\end{gather*}');
  expect(calculoEmLatex('$$a = b$$\nlogo $c$')).toBe('\n\\[ a = b \\]\n\nlogo $c$');
  expect(calculoEmLatex('$$a = b$$\n$$\\frac{1}{2$$')).toContain('\\texttt{');
});
