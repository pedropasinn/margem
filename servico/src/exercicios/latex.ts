/**
 * Os exercícios resolvidos de um documento em LaTeX (classe `book`, amsmath/amssymb/amsthm, sumário
 * por capítulo): o enunciado e a solução de cada um, item a item, com a ideia, os passos, a resposta
 * e a conferência.
 *
 * As resoluções são prosa com fórmulas entre `$…$` e `$$…$$` (prompt `resolver-exercicio@2`): a prosa
 * é escapada como texto; a fórmula passa como LaTeX depois de uma checagem (chaves e `\left/\right`
 * equilibradas, nenhum comando de arquivo, de definição ou de ambiente fora de uma lista curta). A
 * fórmula que não passa sai como o próprio código, em fonte de máquina. As resoluções antigas (@1),
 * em Unicode, têm os símbolos trocados pelos comandos.
 *
 * `seguros` é o modo de recuperação: os exercícios cujo LaTeX não compilou saem com todas as fórmulas
 * como código, e o resto do livro continua desenhado; `omitidos`, os que nem assim compilaram, saem só
 * com um aviso no lugar.
 */
import type { ItemDaResolucaoV1, ResolucaoV2 } from '@margem/contratos';

export type ParteDaMatematica = { tipo: 'texto'; valor: string } | { tipo: 'formula'; tex: string; destacada: boolean };

/** Mesma regra do leitor (`web/src/leitor/resolucao/Matematica.tsx`): `$$…$$` antes de `$…$`, `\$` é cifrão. */
export function partesDaMatematica(texto: string): ParteDaMatematica[] {
  const partes: ParteDaMatematica[] = [];
  let corrente = '';
  let i = 0;
  const empurrarTexto = () => { if (corrente !== '') { partes.push({ tipo: 'texto', valor: corrente }); corrente = ''; } };
  while (i < texto.length) {
    const caractere = texto[i]!;
    if (caractere === '\\' && texto[i + 1] === '$') { corrente += '$'; i += 2; continue; }
    if (caractere === '$') {
      const destacada = texto[i + 1] === '$';
      const abre = destacada ? 2 : 1;
      const fim = fechamento(texto, i + abre, destacada);
      const tex = fim === -1 ? '' : texto.slice(i + abre, fim).trim();
      if (fim !== -1 && tex !== '') {
        empurrarTexto();
        partes.push({ tipo: 'formula', tex, destacada });
        i = fim + abre;
        continue;
      }
    }
    corrente += caractere;
    i += 1;
  }
  empurrarTexto();
  return partes;
}
function fechamento(texto: string, de: number, destacada: boolean): number {
  for (let j = de; j < texto.length; j += 1) {
    if (texto[j] === '\\') { j += 1; continue; }
    if (texto[j] !== '$') continue;
    if (!destacada || texto[j + 1] === '$') return j;
  }
  return -1;
}

/** Símbolos em Unicode (resoluções @1, enunciados do OCR) → comando de modo matemático. */
const SIMBOLOS: Record<string, string> = {
  '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '≈': '\\approx', '≡': '\\equiv', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊃': '\\supset',
  '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap', '∅': '\\varnothing', '∞': '\\infty', '→': '\\to', '←': '\\leftarrow',
  '↦': '\\mapsto', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow', '↔': '\\leftrightarrow', '∀': '\\forall', '∃': '\\exists',
  '¬': '\\neg', '∧': '\\wedge', '∨': '\\vee', '×': '\\times', '·': '\\cdot', '⋅': '\\cdot', '÷': '\\div', '±': '\\pm', '∓': '\\mp', '√': '\\surd',
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∂': '\\partial', '∇': '\\nabla', '⋯': '\\cdots', '…': '\\ldots', '°': '^\\circ', '′': '\\prime',
  'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}', 'ℝ': '\\mathbb{R}', 'ℂ': '\\mathbb{C}', '℘': '\\wp', 'ℓ': '\\ell',
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\varepsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota',
  'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon',
  'φ': '\\varphi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega', 'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi',
  'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega', '−': '-', '⁻': '^{-}', '¹': '^{1}', '²': '^{2}', '³': '^{3}',
  '⁰': '^{0}', '⁴': '^{4}', '⁵': '^{5}', '⁶': '^{6}', '⁷': '^{7}', '⁸': '^{8}', '⁹': '^{9}', 'ⁿ': '^{n}', '₀': '_{0}', '₁': '_{1}', '₂': '_{2}',
  '₃': '_{3}', '₄': '_{4}', '₅': '_{5}', '₆': '_{6}', '₇': '_{7}', '₈': '_{8}', '₉': '_{9}', 'ₙ': '_{n}', 'ᵢ': '_{i}', 'ₖ': '_{k}', '⟨': '\\langle', '⟩': '\\rangle',
  '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil', '∘': '\\circ', '∖': '\\setminus', '≅': '\\cong', '∼': '\\sim', '≺': '\\prec', '≻': '\\succ',
};
const RE_SIMBOLO = new RegExp(`[${Object.keys(SIMBOLOS).join('')}]`, 'gu');

const ESCAPE_DO_TEXTO: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&', '%': '\\%', '#': '\\#', _: '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
  '<': '\\textless{}', '>': '\\textgreater{}', '|': '\\textbar{}',
};

/** Texto puro em LaTeX: caracteres especiais escapados, símbolos matemáticos em `$…$`. */
export function escaparTexto(texto: string): string {
  return texto.replace(/[\\{}$&%#_~^<>|]/g, (c) => ESCAPE_DO_TEXTO[c]!)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(RE_SIMBOLO, (c) => `$${SIMBOLOS[c]!}$`);
}

/** Ambientes que o KaTeX desenha e o amsmath conhece. */
const AMBIENTES = new Set(['cases', 'aligned', 'gathered', 'split', 'array', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix', 'alignedat']);
const PROIBIDOS = /\\(input|include|openin|openout|write|read|immediate|catcode|def|edef|gdef|xdef|let|futurelet|newcommand|renewcommand|providecommand|DeclareMathOperator|newenvironment|usepackage|documentclass|csname|endcsname|special|directlua|latelua|loop|repeat|expandafter|jobname|tracing\w*|output|every\w+|uppercase|lowercase|href|url|includegraphics|verb|lstinline|makeatletter|makeatother|afterassignment|scantokens|detokenize|unexpanded|noexpand|string|meaning|font|count\w*|dimen\w*|skip\w*|toks\w*|box\w*|setbox|vbox|hbox|par|show\w*|errmessage|message|newline|vspace|hspace|color|textcolor|colorbox)(?![a-zA-Z])/;

/** A fórmula pode ir como LaTeX? (sem comando perigoso, chaves e `\left/\right` equilibradas, `&` só dentro de ambiente). */
export function formulaAceitavel(tex: string): boolean {
  if (tex.length > 4000 || PROIBIDOS.test(tex) || /[#]/.test(tex)) return false;
  let nivel = 0;
  for (let i = 0; i < tex.length; i += 1) {
    if (tex[i] === '\\') { i += 1; continue; }
    if (tex[i] === '{') nivel += 1;
    if (tex[i] === '}') { nivel -= 1; if (nivel < 0) return false; }
  }
  if (nivel !== 0) return false;
  const ambientes = [...tex.matchAll(/\\(begin|end)\s*\{([^}]*)\}/g)];
  if (ambientes.some((a) => !AMBIENTES.has(a[2]!))) return false;
  const pilha: string[] = [];
  for (const [, tipo, nome] of ambientes) {
    if (tipo === 'begin') pilha.push(nome!);
    else if (pilha.pop() !== nome) return false;
  }
  if (pilha.length > 0) return false;
  if (/(^|[^\\])&/.test(tex) && ambientes.length === 0) return false;
  const esquerdas = (tex.match(/\\left(?![a-zA-Z])/g) ?? []).length;
  const direitas = (tex.match(/\\right(?![a-zA-Z])/g) ?? []).length;
  return esquerdas === direitas;
}

function formula(tex: string, destacada: boolean, seguro: boolean): string {
  const limpo = tex.replace(/%/g, '\\%').replace(RE_SIMBOLO, (c) => ` ${SIMBOLOS[c]!} `).replace(/\s*\n\s*/g, ' ');
  if (seguro || !formulaAceitavel(limpo)) {
    const codigo = `\\texttt{${escaparTexto(tex)}}`;
    return destacada ? `\n\n\\begin{center}${codigo}\\end{center}\n\n` : codigo;
  }
  return destacada ? `\n\\[ ${limpo} \\]\n` : `$${limpo}$`;
}

/** Quebra de linha: o `{}` impede que um `[` no começo da linha seguinte vire o argumento opcional de `\\`. */
const QUEBRA = '\\\\{}\n';

/** Prosa com fórmulas em LaTeX. Linhas em branco separam parágrafos; quebra simples vira quebra de linha. */
export function prosaEmLatex(texto: string, seguro = false): string {
  const paragrafos = texto.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((paragrafo) => paragrafo.trim()).filter((paragrafo) => paragrafo !== '');
  return paragrafos.map((paragrafo) => {
    const convertido = partesDaMatematica(paragrafo).map((parte) => parte.tipo === 'texto'
      ? escaparTexto(parte.valor).replace(/[ \t]*\n[ \t]*/g, QUEBRA)
      : formula(parte.tex, parte.destacada, seguro)).join('');
    // Uma quebra (`\\`) não pode abrir nem fechar parágrafo nem encostar numa fórmula destacada.
    return convertido.replace(/^(\s*\\\\\{\}\n)+/, '').replace(/(\\\\\{\}\n\s*)+$/, '').replace(/\\\\\{\}\n(\s*\\\[)/g, '$1').replace(/(\\\]\n)\\\\\{\}\n/g, '$1');
  }).join('\n\n');
}

export interface ExercicioParaExportar {
  sessao: ResolucaoV2;
  capitulo: string;
  secao: string | null;
  numero: string | null;
}
export interface DocumentoDoTex { titulo: string; autor: string | null; geradoEm: Date }
export interface Tex { tex: string; linhas: { id: string; inicio: number; fim: number }[] }

/** A conta de um passo: linhas que são só fórmulas destacadas vão juntas num `gather*`; o resto, linha a linha. */
export function calculoEmLatex(calculo: string, seguro = false): string {
  const linhas = calculo.split('\n').filter((linha) => linha.trim() !== '');
  const formulas = linhas.map((linha) => {
    const partes = partesDaMatematica(linha.trim());
    const unica = partes.length === 1 ? partes[0] : undefined;
    return unica?.tipo === 'formula' && unica.destacada ? unica.tex.replace(/%/g, '\\%').replace(RE_SIMBOLO, (c) => ` ${SIMBOLOS[c]!} `) : null;
  });
  if (!seguro && linhas.length > 1 && formulas.every((tex) => tex !== null && formulaAceitavel(tex) && !/\\\\/.test(tex))) {
    return `\\begin{gather*}\n${formulas.join(' \\\\\n')}\n\\end{gather*}`;
  }
  return linhas.map((linha) => prosaEmLatex(linha, seguro)).join('\n');
}

function item(item: ItemDaResolucaoV1, seguro: boolean): string {
  const partes: string[] = [];
  if (item.rotulo.trim() !== '') partes.push(`\\par\\medskip\\textbf{Item ${escaparTexto(item.rotulo.trim())}}`);
  partes.push(`\\textit{Ideia.} ${prosaEmLatex(item.estrategia, seguro)}`);
  if (item.passos.length > 0) {
    partes.push('\\begin{enumerate}');
    for (const passo of item.passos) {
      partes.push(`  \\item ${prosaEmLatex(passo.texto, seguro)}`);
      if (passo.calculo) partes.push(calculoEmLatex(passo.calculo, seguro));
    }
    partes.push('\\end{enumerate}');
  }
  partes.push(`\\textbf{Resposta.} ${prosaEmLatex(item.resposta, seguro)}`);
  if (item.verificacao) partes.push(`\\textit{Conferência.} ${prosaEmLatex(item.verificacao, seguro)}`);
  return partes.join('\n\n');
}

const PREAMBULO = String.raw`\documentclass[11pt,a4paper,oneside]{book}
\usepackage{fontspec}
\usepackage[brazil]{babel}
\usepackage{amsmath,amssymb,amsthm}
\usepackage[margin=2.4cm]{geometry}
\usepackage[hidelinks]{hyperref}
\providecommand{\R}{\mathbb{R}}\providecommand{\N}{\mathbb{N}}\providecommand{\Z}{\mathbb{Z}}
\providecommand{\Q}{\mathbb{Q}}\providecommand{\C}{\mathbb{C}}\providecommand{\reals}{\mathbb{R}}
\providecommand{\natnums}{\mathbb{N}}\providecommand{\Complex}{\mathbb{C}}\providecommand{\Bbb}{\mathbb}
\providecommand{\sen}{\operatorname{sen}}\providecommand{\tg}{\operatorname{tg}}\providecommand{\cotg}{\operatorname{cotg}}
\providecommand{\arcsen}{\operatorname{arcsen}}\providecommand{\arctg}{\operatorname{arctg}}\providecommand{\cossec}{\operatorname{cossec}}
\providecommand{\gt}{>}\providecommand{\lt}{<}\providecommand{\mathscr}{\mathcal}\providecommand{\bold}{\mathbf}
\newenvironment{exercicio}[1]{\par\medskip\noindent\textbf{Exercício #1.}\ }{\par}
\setcounter{tocdepth}{1}
\setlength{\parindent}{0pt}\setlength{\parskip}{0.5em}
`;

/** O `.tex` inteiro e, para cada exercício, as linhas que ele ocupa (para achar quem não compilou). */
export function montarTex(documento: DocumentoDoTex, exercicios: readonly ExercicioParaExportar[], seguros: ReadonlySet<string> = new Set(), omitidos: ReadonlySet<string> = new Set()): Tex {
  const linhas: string[] = PREAMBULO.split('\n');
  const mapa: Tex['linhas'] = [];
  const empurrar = (texto: string) => { linhas.push(...texto.split('\n')); };
  const data = documento.geradoEm.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  empurrar(String.raw`\begin{document}
\begin{titlepage}\centering\vspace*{5cm}
{\Huge ${escaparTexto(documento.titulo)}\par}\vspace{1em}
${documento.autor ? String.raw`{\Large ${escaparTexto(documento.autor)}\par}\vspace{2em}` : ''}
{\Large Exercícios resolvidos\par}\vfill
{\small Gerado pelo Margem em ${escaparTexto(data)}. Resoluções do Codex: confira antes de confiar.\par}
\end{titlepage}
\tableofcontents`);
  let capitulo: string | null = null;
  let secao: string | null = null;
  for (const ex of exercicios) {
    const resolucao = ex.sessao.resolucao;
    if (ex.capitulo !== capitulo) {
      capitulo = ex.capitulo; secao = null;
      empurrar(`\\chapter*{${escaparTexto(capitulo)}}\n\\addcontentsline{toc}{chapter}{${escaparTexto(capitulo)}}\n\\markboth{${escaparTexto(capitulo)}}{}`);
    }
    if (ex.secao !== null && ex.secao !== secao) {
      secao = ex.secao;
      empurrar(`\\section*{${escaparTexto(secao)}}\n\\addcontentsline{toc}{section}{${escaparTexto(secao)}}`);
    }
    const seguro = seguros.has(ex.sessao.id);
    const inicio = linhas.length + 1;
    const origem = ex.sessao.origem.tipo === 'recorte' ? ` (p.~${String(ex.sessao.origem.pagina)})` : '';
    const enunciado = resolucao?.enunciado ?? ex.sessao.texto_extraido;
    if (omitidos.has(ex.sessao.id)) {
      empurrar(`\\begin{exercicio}{${escaparTexto(ex.numero ?? '')}${origem}}\n\\emph{Este exercício não pôde ser composto em LaTeX; veja-o no Margem.}\n\\end{exercicio}`);
      mapa.push({ id: ex.sessao.id, inicio, fim: linhas.length });
      continue;
    }
    // Sem resolução, o enunciado é o texto do recorte (OCR ou camada do PDF): vai como texto, sem fórmulas.
    empurrar(`\\begin{exercicio}{${escaparTexto(ex.numero ?? '')}${origem}}\n${resolucao ? prosaEmLatex(enunciado, seguro) : escaparTexto(enunciado.trim()).replace(/\n+/g, QUEBRA)}\n\\end{exercicio}`);
    if (resolucao) {
      empurrar(`\\begin{proof}[Solução]\n${resolucao.itens.map((i) => item(i, seguro)).join('\n\n')}\n\\end{proof}`);
    } else {
      empurrar('\\emph{(Ainda sem resolução.)}');
    }
    mapa.push({ id: ex.sessao.id, inicio, fim: linhas.length });
  }
  if (exercicios.length === 0) empurrar('\\chapter*{Nenhum exercício resolvido ainda}');
  empurrar('\\end{document}');
  return { tex: `${linhas.join('\n')}\n`, linhas: mapa };
}
