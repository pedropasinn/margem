/**
 * Mescla a nota gerada pelo Margem com a nota que já está no cofre, sem perder o que o usuário
 * escreveu.
 *
 * - O corpo gerado mora entre `%% margem:inicio %%` e `%% margem:fim %%`: só esse trecho é trocado.
 *   O que está antes e depois dos marcadores fica como está. Nota sem marcadores (escrita à mão, com
 *   o mesmo nome) recebe o bloco no fim.
 * - No frontmatter, as chaves que o Margem gera são trocadas no lugar; as outras ficam, na ordem em
 *   que estão. `tags` é a união: as do usuário primeiro, depois as do Margem que faltam.
 * - Marcadores quebrados (um sem o outro, fora de ordem, repetidos): nada é escrito, e a nota volta
 *   como conflito para o usuário resolver.
 *
 * Função pura e idempotente: mesclar duas vezes dá o mesmo texto que mesclar uma.
 * Os marcadores repetem `servico/src/obsidian/exportar.ts` (o plugin não importa o serviço).
 */
export const INICIO_GERENCIADO = '%% margem:inicio %%';
export const FIM_GERENCIADO = '%% margem:fim %%';

export type ResultadoDaMescla = { estado: 'ok'; conteudo: string } | { estado: 'conflito'; motivo: string };

interface Partes { frontmatter: string[] | null; corpo: string }

function separar(texto: string): Partes {
  const normalizado = texto.replace(/\r\n?/g, '\n');
  if (!normalizado.startsWith('---\n')) return { frontmatter: null, corpo: normalizado };
  const fim = normalizado.indexOf('\n---', 3);
  // O fechamento é `---` sozinho numa linha.
  if (fim < 0 || !/^\n---(\n|$)/.test(normalizado.slice(fim, fim + 5))) return { frontmatter: null, corpo: normalizado };
  const linhas = normalizado.slice(4, fim).split('\n');
  const resto = normalizado.slice(fim + 4);
  return { frontmatter: linhas.length === 1 && linhas[0] === '' ? [] : linhas, corpo: resto.startsWith('\n') ? resto.slice(1) : resto };
}

interface Chave { nome: string | null; linhas: string[] }

/** Agrupa o frontmatter por chave de primeiro nível: a linha `chave:` e as que a continuam. */
function chaves(linhas: readonly string[]): Chave[] {
  const grupos: Chave[] = [];
  for (const linha of linhas) {
    const nome = /^([^\s#:-][^:]*?|"[^"]+"|'[^']+'):(\s|$)/.exec(linha)?.[1];
    if (nome !== undefined) grupos.push({ nome: nome.replace(/^["']|["']$/g, ''), linhas: [linha] });
    else if (grupos.length > 0) grupos.at(-1)?.linhas.push(linha);
    else grupos.push({ nome: null, linhas: [linha] });
  }
  return grupos;
}

function semAspas(valor: string): string {
  const limpo = valor.trim();
  if (limpo.startsWith('"') && limpo.endsWith('"') && limpo.length >= 2) {
    try { return JSON.parse(limpo) as string; } catch { return limpo.slice(1, -1); }
  }
  if (limpo.startsWith("'") && limpo.endsWith("'") && limpo.length >= 2) return limpo.slice(1, -1).replace(/''/g, "'");
  return limpo;
}

/** Os valores de `tags`: lista em bloco, lista `[a, b]` ou texto separado por vírgulas/espaços. */
function valoresDasTags(grupo: Chave): string[] {
  const [primeira = '', ...resto] = grupo.linhas;
  const depois = primeira.slice(primeira.indexOf(':') + 1).trim();
  let valores: string[];
  if (depois.startsWith('[')) valores = depois.replace(/^\[|\]$/g, '').split(',');
  else if (depois !== '') valores = depois.split(/[,\s]+/);
  else valores = resto.flatMap((linha) => { const item = /^\s*-\s+(.*)$/.exec(linha)?.[1]; return item === undefined ? [] : [item]; });
  return valores.map(semAspas).map((valor) => valor.replace(/^#/, '')).filter((valor) => valor !== '');
}

function mesclarFrontmatter(atual: readonly string[], gerado: readonly string[]): string[] {
  const doUsuario = chaves(atual);
  const doMargem = chaves(gerado);
  const resultado = doUsuario.map((grupo) => ({ ...grupo, linhas: [...grupo.linhas] }));
  for (const grupo of doMargem) {
    if (grupo.nome === null) continue;
    const existente = resultado.find((candidato) => candidato.nome === grupo.nome);
    if (!existente) { resultado.push({ ...grupo, linhas: [...grupo.linhas] }); continue; }
    if (grupo.nome === 'tags') {
      const atuais = valoresDasTags(existente);
      const faltam = valoresDasTags(grupo).filter((tag) => !atuais.includes(tag));
      // Sem nada a acrescentar, a forma que o usuário usou fica intacta.
      if (faltam.length > 0) existente.linhas = ['tags:', ...[...atuais, ...faltam].map((tag) => `  - ${tag}`)];
      continue;
    }
    existente.linhas = [...grupo.linhas];
  }
  return resultado.flatMap((grupo) => grupo.linhas);
}

function ocorrencias(texto: string, trecho: string): number[] {
  const posicoes: number[] = [];
  for (let i = texto.indexOf(trecho); i >= 0; i = texto.indexOf(trecho, i + 1)) posicoes.push(i);
  return posicoes;
}

/** O bloco gerenciado da nota gerada, dos marcadores inclusive. */
function blocoGerenciado(corpo: string): string | null {
  const inicio = corpo.indexOf(INICIO_GERENCIADO);
  const fim = corpo.lastIndexOf(FIM_GERENCIADO);
  if (inicio < 0 || fim < inicio) return null;
  return corpo.slice(inicio, fim + FIM_GERENCIADO.length);
}

export function mesclarNota(atual: string | null, gerada: string): ResultadoDaMescla {
  const nova = separar(gerada);
  const bloco = blocoGerenciado(nova.corpo);
  if (bloco === null) return { estado: 'conflito', motivo: 'A nota gerada não tem os marcadores do Margem.' };
  if (atual === null) return { estado: 'ok', conteudo: gerada.replace(/\r\n?/g, '\n') };

  const velha = separar(atual);
  const inicios = ocorrencias(velha.corpo, INICIO_GERENCIADO);
  const fins = ocorrencias(velha.corpo, FIM_GERENCIADO);
  let corpo: string;
  if (inicios.length === 0 && fins.length === 0) {
    const antes = velha.corpo.replace(/\s+$/, '');
    corpo = antes === '' ? `${bloco}\n` : `${antes}\n\n${bloco}\n`;
  } else if (inicios.length === 1 && fins.length === 1 && (inicios[0] ?? 0) < (fins[0] ?? 0)) {
    const inicio = inicios[0] ?? 0;
    const fim = (fins[0] ?? 0) + FIM_GERENCIADO.length;
    corpo = `${velha.corpo.slice(0, inicio)}${bloco}${velha.corpo.slice(fim)}`;
  } else {
    return { estado: 'conflito', motivo: 'Os marcadores %% margem:inicio %% e %% margem:fim %% estão quebrados ou repetidos nesta nota.' };
  }

  const frontmatter = mesclarFrontmatter(velha.frontmatter ?? [], nova.frontmatter ?? []);
  const conteudo = frontmatter.length === 0 && velha.frontmatter === null ? corpo : `---\n${frontmatter.join('\n')}\n---\n${corpo}`;
  return { estado: 'ok', conteudo };
}

/** O `margem_id` do frontmatter, para achar a nota de um documento mesmo depois de renomeada. */
export function margemIdDaNota(texto: string): string | null {
  const { frontmatter } = separar(texto);
  const grupo = chaves(frontmatter ?? []).find((candidato) => candidato.nome === 'margem_id');
  const linha = grupo?.linhas[0];
  if (linha === undefined) return null;
  const valor = semAspas(linha.slice(linha.indexOf(':') + 1));
  return valor === '' ? null : valor;
}
