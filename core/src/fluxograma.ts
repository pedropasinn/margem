/**
 * Conferência do fluxograma Mermaid que o Codex devolve (J70).
 *
 * Não é um parser de Mermaid: é a régua de um subconjunto fechado, o bastante para as ideias
 * de um capítulo e pequeno o bastante para ser seguro. Vale só `flowchart TD` (vertical);
 * nós com rótulo entre aspas ou simples, arestas com e sem rótulo, `subgraph … end` e
 * comentários `%%`. Diretivas (`%%{init}%%`), `click`, estilos, classes e HTML nos rótulos
 * são recusados: o que chega ao navegador já passou por aqui.
 */
/**
 * O mesmo cabeçalho de `CABECALHO_DO_FLUXOGRAMA` em `@margem/contratos` (o teste confere). Fica
 * repetido aqui para o módulo não puxar os validadores (que usam `node:fs`) para o navegador.
 */
export const CABECALHO_DO_FLUXOGRAMA = 'flowchart TD';

export type ConferenciaDoFluxograma =
  | { ok: true; nos: string[]; arestas: number; subgrafos: number }
  | { ok: false; linha: number; erro: string };

const ID = /^[A-Za-z][A-Za-z0-9_]{0,31}/u;
/** Formas aceitas, da mais longa para a mais curta (a ordem importa no casamento). */
const FORMAS: readonly [string, string][] = [['([', '])'], ['[[', ']]'], ['((', '))'], ['{{', '}}'], ['[(', ')]'], ['[', ']'], ['(', ')'], ['{', '}']];
const LIGACOES = ['-.->', '-.-', '-->', '---', '==>', '==='] as const;
const PROIBIDAS = new Set(['click', 'style', 'classdef', 'class', 'linkstyle', 'direction', 'call', 'href', 'interpolate', 'acctitle', 'accdescr']);
const RESERVADOS = new Set(['end', 'subgraph', 'graph', 'flowchart']);
/** Texto de rótulo: nada de HTML, aspas, crases (rótulo markdown), barras verticais nem chaves de entidade. */
const PROIBIDO_NO_ROTULO = /[<>"`|#&;]/u;
const ROTULO_SIMPLES_PROIBIDO = /[[\](){}]/u;

interface Cursor { texto: string; pos: number }

function espacos(c: Cursor): void {
  while (c.pos < c.texto.length && /\s/u.test(c.texto[c.pos]!)) c.pos += 1;
}

function lerRotulo(c: Cursor, fecha: string): string | null {
  const resto = c.texto.slice(c.pos);
  if (resto.startsWith('"')) {
    const fim = resto.indexOf('"', 1);
    if (fim < 0 || !resto.slice(fim + 1).startsWith(fecha)) return null;
    const rotulo = resto.slice(1, fim);
    if (PROIBIDO_NO_ROTULO.test(rotulo) || rotulo.trim() === '') return null;
    c.pos += fim + 1 + fecha.length;
    return rotulo;
  }
  const fim = resto.indexOf(fecha);
  if (fim <= 0) return null;
  const rotulo = resto.slice(0, fim);
  if (PROIBIDO_NO_ROTULO.test(rotulo) || ROTULO_SIMPLES_PROIBIDO.test(rotulo) || rotulo.trim() === '') return null;
  c.pos += fim + fecha.length;
  return rotulo;
}

/** Um nó, com ou sem forma. Devolve o id ou um erro. */
function lerNo(c: Cursor): { id: string } | { erro: string } {
  espacos(c);
  const casado = ID.exec(c.texto.slice(c.pos));
  if (!casado) return { erro: 'esperava o id de um nó (letra seguida de letras, dígitos ou _)' };
  const id = casado[0];
  if (RESERVADOS.has(id.toLowerCase())) return { erro: `"${id}" é palavra reservada e não pode ser id de nó` };
  c.pos += id.length;
  const depois = c.texto.slice(c.pos);
  if (/^[A-Za-z0-9_]/u.test(depois)) return { erro: 'id de nó longo demais (até 32 caracteres)' };
  for (const [abre, fecha] of FORMAS) {
    if (!depois.startsWith(abre)) continue;
    c.pos += abre.length;
    if (lerRotulo(c, fecha) === null) return { erro: `rótulo do nó ${id} malformado ou com caractere proibido (< > " \` | # & ;)` };
    return { id };
  }
  return { id };
}

/** Uma ligação (`-->`, `---`, `-.->`, `-.-`, `==>`, `===`) com rótulo opcional `|texto|` ou `-- texto -->`. */
function lerLigacao(c: Cursor): boolean | { erro: string } {
  espacos(c);
  const resto = c.texto.slice(c.pos);
  // Forma com texto no meio: `-- texto -->`, `-. texto .->`, `== texto ==>`.
  const meio = /^(--|-\.|==)\s+([^\n]*?)\s+(-->|---|\.->|\.-|==>|===)/u.exec(resto);
  if (meio && !resto.startsWith('-->') && !resto.startsWith('---') && !resto.startsWith('==>') && !resto.startsWith('===')) {
    const rotulo = meio[2] ?? '';
    if (PROIBIDO_NO_ROTULO.test(rotulo) || rotulo.trim() === '') return { erro: 'rótulo da ligação malformado' };
    c.pos += meio[0].length;
    return true;
  }
  const ligacao = LIGACOES.find((candidata) => resto.startsWith(candidata));
  if (!ligacao) return false;
  c.pos += ligacao.length;
  if (c.texto[c.pos] === '|') {
    const fim = c.texto.indexOf('|', c.pos + 1);
    const rotulo = fim < 0 ? '' : c.texto.slice(c.pos + 1, fim);
    if (fim < 0 || rotulo.trim() === '' || /[<>"`#&;]/u.test(rotulo)) return { erro: 'rótulo da ligação |…| malformado' };
    c.pos = fim + 1;
  }
  return true;
}

export function conferirFluxograma(codigo: string): ConferenciaDoFluxograma {
  const linhas = codigo.replaceAll('\r\n', '\n').split('\n');
  const nos = new Set<string>();
  let arestas = 0;
  let subgrafos = 0;
  let profundidade = 0;
  let cabecalho = false;
  for (const [indice, bruta] of linhas.entries()) {
    const numero = indice + 1;
    const linha = bruta.trim().replace(/;\s*$/u, '');
    if (linha === '') continue;
    if (linha.startsWith('%%')) {
      if (linha.startsWith('%%{')) return { ok: false, linha: numero, erro: 'diretivas %%{…}%% não são aceitas' };
      continue;
    }
    if (!cabecalho) {
      if (linha !== CABECALHO_DO_FLUXOGRAMA) return { ok: false, linha: numero, erro: `a primeira linha precisa ser exatamente "${CABECALHO_DO_FLUXOGRAMA}"` };
      cabecalho = true;
      continue;
    }
    const palavra = (/^[A-Za-z]+/u.exec(linha)?.[0] ?? '').toLowerCase();
    if (PROIBIDAS.has(palavra) && (linha.length === palavra.length || /\s/u.test(linha[palavra.length] ?? ''))) {
      return { ok: false, linha: numero, erro: `"${palavra}" não é aceito (sem estilos, classes, cliques nem direção)` };
    }
    if (palavra === 'flowchart' || palavra === 'graph') return { ok: false, linha: numero, erro: 'um só cabeçalho por diagrama' };
    if (linha === 'end') {
      if (profundidade === 0) return { ok: false, linha: numero, erro: '"end" sem "subgraph" aberto' };
      profundidade -= 1;
      continue;
    }
    if (palavra === 'subgraph' && /^subgraph\s/u.test(linha)) {
      const c: Cursor = { texto: linha.slice('subgraph'.length), pos: 0 };
      const no = lerNo(c);
      if ('erro' in no) return { ok: false, linha: numero, erro: `subgraph: ${no.erro}` };
      espacos(c);
      if (c.pos !== c.texto.length) return { ok: false, linha: numero, erro: 'subgraph: use subgraph ID["título"]' };
      subgrafos += 1;
      profundidade += 1;
      continue;
    }
    const c: Cursor = { texto: linha, pos: 0 };
    const primeiro = lerNo(c);
    if ('erro' in primeiro) return { ok: false, linha: numero, erro: primeiro.erro };
    nos.add(primeiro.id);
    for (;;) {
      const ligou = lerLigacao(c);
      if (typeof ligou === 'object') return { ok: false, linha: numero, erro: ligou.erro };
      if (!ligou) break;
      const proximo = lerNo(c);
      if ('erro' in proximo) return { ok: false, linha: numero, erro: proximo.erro };
      nos.add(proximo.id);
      arestas += 1;
    }
    espacos(c);
    if (c.pos !== c.texto.length) return { ok: false, linha: numero, erro: `sobrou texto depois do nó: "${c.texto.slice(c.pos, c.pos + 30)}"` };
  }
  if (!cabecalho) return { ok: false, linha: 1, erro: `o diagrama precisa começar por "${CABECALHO_DO_FLUXOGRAMA}"` };
  if (profundidade !== 0) return { ok: false, linha: linhas.length, erro: 'subgraph sem "end"' };
  if (nos.size === 0) return { ok: false, linha: linhas.length, erro: 'o diagrama não tem nós' };
  return { ok: true, nos: [...nos], arestas, subgrafos };
}
