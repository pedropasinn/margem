/**
 * Mescla e sincronização das notas do Margem com um cofre do Obsidian, sem dependência de Obsidian,
 * de Node ou de rede: o plugin (`integracoes/obsidian`) e o app de computador (`desktop`) usam este
 * mesmo código, cada um com o seu cofre (a API do Obsidian, ou o sistema de arquivos) e o seu cliente
 * (a API do Margem por HTTP).
 *
 * **Mescla** (`mesclarNota`):
 * - o corpo gerado mora entre `%% margem:inicio %%` e `%% margem:fim %%`: só esse trecho é trocado. O
 *   que está antes e depois dos marcadores fica. Nota sem marcadores (escrita à mão, com o mesmo nome)
 *   recebe o bloco no fim;
 * - no frontmatter, as chaves que o Margem gera são trocadas no lugar; as outras ficam, na ordem em que
 *   estão. `tags` é a união: as do usuário primeiro, depois as do Margem que faltam;
 * - marcadores quebrados (um sem o outro, fora de ordem, repetidos): nada é escrito, e a nota volta como
 *   conflito para o usuário resolver.
 * Função pura e idempotente: mesclar duas vezes dá o mesmo texto que mesclar uma.
 *
 * **Sincronização no formato 2** (`sincronizarV2`, ver `servico/src/obsidian/FORMATO.md`): lê o índice
 * (`IndiceObsidianV2`, uma entrada por nota), acha cada nota pelo `margem_id` (renomear e mover no cofre
 * não duplicam), pula a que não mudou desde a última vez, baixa as notas dos documentos que mudaram e
 * escreve com a mescla. Nunca apaga.
 */
export const INICIO_GERENCIADO = '%% margem:inicio %%';
export const FIM_GERENCIADO = '%% margem:fim %%';

// ------------------------------------------------------------------ mescla

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

/** Tag como item de lista YAML: entre aspas quando a forma simples poderia ser lida de outro jeito. */
function itemDaTag(tag: string): string {
  return /^[\p{L}\p{N}_/-]+$/u.test(tag) ? tag : JSON.stringify(tag);
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
      if (faltam.length > 0) existente.linhas = ['tags:', ...[...atuais, ...faltam].map((tag) => `  - ${itemDaTag(tag)}`)];
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

/** O `margem_id` do frontmatter, para achar a nota de um item mesmo depois de renomeada ou movida. */
export function margemIdDaNota(texto: string): string | null {
  const { frontmatter } = separar(texto);
  const grupo = chaves(frontmatter ?? []).find((candidato) => candidato.nome === 'margem_id');
  const linha = grupo?.linhas[0];
  if (linha === undefined) return null;
  const valor = semAspas(linha.slice(linha.indexOf(':') + 1));
  return valor === '' ? null : valor;
}

// ------------------------------------------------------------------ caminhos

/** Pasta + caminho relativo, com `/`, sem `.`/`..` nem barras nas pontas. */
export function juntarCaminho(pasta: string, arquivo: string): string {
  const limpar = (texto: string) => texto.replace(/\\/g, '/').split('/').map((parte) => parte.trim())
    .filter((parte) => parte !== '' && parte !== '.' && parte !== '..');
  return [...limpar(pasta), ...limpar(arquivo)].join('/');
}

/** Caminho relativo seguro vindo do servidor: partes sem `..`, sem começar por `/` nem conter `\`. */
export function caminhoSeguro(caminho: string): boolean {
  if (caminho === '' || caminho.startsWith('/') || caminho.includes('\\') || !caminho.endsWith('.md')) return false;
  return caminho.split('/').every((parte) => parte !== '' && parte !== '.' && parte !== '..' && !parte.startsWith('.'));
}

// ------------------------------------------------------------------ sincronização (formato 2)

/** Espelho mínimo de `IndiceObsidianV2` (o validador completo mora no serviço). */
export interface NotaDoIndiceV2 {
  id: string;
  tipo: string;
  documento_id: string;
  caminho: string;
  sha256: string;
  atualizado_em: string;
}
export interface IndiceDoMargemV2 {
  versao: 2;
  url_base: string;
  marcas: 'minhas' | 'todas';
  incluir: string[];
  notas: NotaDoIndiceV2[];
}

/** Uma nota com o conteúdo, como `GET /api/obsidian/v2/documentos/:id` a devolve. */
export interface NotaGeradaV2 { id: string; caminho: string; conteudo: string }

export interface ClienteDoMargemV2 {
  indice: () => Promise<IndiceDoMargemV2>;
  /** Todas as notas de um documento, com o conteúdo. */
  documento: (documentoId: string) => Promise<{ notas: NotaGeradaV2[] }>;
}

export interface CofreDaSincronizacao {
  ler: (caminho: string) => Promise<string | null>;
  /** Cria ou substitui o arquivo (criando as pastas que faltarem). */
  escrever: (caminho: string, conteudo: string) => Promise<void>;
  /** Notas do cofre com `margem_id` no frontmatter: id → caminho. */
  notasDoMargem: () => Promise<Map<string, string>>;
}

/** O que fica guardado entre uma sincronização e outra, por nota (`margem_id`). */
export interface EstadoDaNota { sha256: string; caminho: string }
export type EstadoDaSincronizacao = Record<string, EstadoDaNota>;

export interface RelatorioDaSincronizacao {
  criadas: string[];
  atualizadas: string[];
  iguais: number;
  conflitos: { caminho: string; motivo: string }[];
  erros: { titulo: string; motivo: string }[];
}

export function validarIndiceV2(valor: unknown): IndiceDoMargemV2 {
  const indice = valor as Partial<IndiceDoMargemV2> | null;
  if (indice === null || typeof indice !== 'object' || indice.versao !== 2 || !Array.isArray(indice.notas)) {
    throw new Error('O servidor não respondeu um índice do Margem no formato 2. Confira o endereço e a versão do Margem.');
  }
  for (const nota of indice.notas) {
    if (typeof nota.id !== 'string' || typeof nota.documento_id !== 'string' || typeof nota.sha256 !== 'string'
      || typeof nota.caminho !== 'string' || !caminhoSeguro(nota.caminho)) {
      throw new Error('O índice do Margem tem uma nota malformada.');
    }
  }
  return indice as IndiceDoMargemV2;
}

/** Caminho para uma nota nova: o do índice; se já houver outra nota (de outro item) nele, com o fim do id. */
async function caminhoNovo(cofre: CofreDaSincronizacao, pasta: string, nota: NotaDoIndiceV2): Promise<string> {
  const preferido = juntarCaminho(pasta, nota.caminho);
  const existente = await cofre.ler(preferido);
  if (existente === null) return preferido;
  const dono = margemIdDaNota(existente);
  if (dono === null || dono === nota.id) return preferido;
  return `${preferido.slice(0, -3)} (${nota.id.slice(-6).toLowerCase()}).md`;
}

/**
 * Sincroniza o cofre com o índice V2. `estado` é o da última vez (o plugin guarda em `data.json`; o app
 * de computador, em `.margem/manifesto.json`); volta o novo. Os documentos são baixados um a um, só os
 * que têm alguma nota a escrever.
 */
export async function sincronizarV2(entrada: {
  cofre: CofreDaSincronizacao; cliente: ClienteDoMargemV2; pasta: string; estado: EstadoDaSincronizacao;
}): Promise<{ relatorio: RelatorioDaSincronizacao; estado: EstadoDaSincronizacao; indice: IndiceDoMargemV2 }> {
  const { cofre, cliente, pasta } = entrada;
  const estado: EstadoDaSincronizacao = { ...entrada.estado };
  const relatorio: RelatorioDaSincronizacao = { criadas: [], atualizadas: [], iguais: 0, conflitos: [], erros: [] };
  const indice = validarIndiceV2(await cliente.indice());
  const porId = await cofre.notasDoMargem();

  // Onde cada nota está agora (pelo margem_id; senão o caminho guardado, se ainda existir).
  const atuais = new Map<string, string | null>();
  for (const nota of indice.notas) {
    let caminho = porId.get(nota.id) ?? null;
    const anterior = estado[nota.id];
    if (caminho === null && anterior !== undefined && (await cofre.ler(anterior.caminho)) !== null) caminho = anterior.caminho;
    atuais.set(nota.id, caminho);
  }
  const porDocumento = new Map<string, NotaDoIndiceV2[]>();
  for (const nota of indice.notas) {
    const caminho = atuais.get(nota.id) ?? null;
    if (caminho !== null && estado[nota.id]?.sha256 === nota.sha256) {
      relatorio.iguais++;
      estado[nota.id] = { sha256: nota.sha256, caminho };
      continue;
    }
    porDocumento.set(nota.documento_id, [...(porDocumento.get(nota.documento_id) ?? []), nota]);
  }

  for (const [documentoId, pendentes] of porDocumento) {
    const titulo = indice.notas.find((nota) => nota.id === documentoId)?.caminho.split('/')[0] ?? documentoId;
    let geradas: Map<string, NotaGeradaV2>;
    try {
      geradas = new Map((await cliente.documento(documentoId)).notas.map((nota) => [nota.id, nota]));
    } catch (erro) {
      relatorio.erros.push({ titulo, motivo: erro instanceof Error ? erro.message : String(erro) });
      continue;
    }
    for (const nota of pendentes) {
      try {
        const gerada = geradas.get(nota.id);
        if (gerada === undefined) throw new Error(`O Margem não devolveu a nota ${nota.caminho}.`);
        const destino = atuais.get(nota.id) ?? await caminhoNovo(cofre, pasta, nota);
        const atual = await cofre.ler(destino);
        const mescla = mesclarNota(atual, gerada.conteudo);
        if (mescla.estado === 'conflito') { relatorio.conflitos.push({ caminho: destino, motivo: mescla.motivo }); continue; }
        if (atual === null) {
          await cofre.escrever(destino, mescla.conteudo);
          relatorio.criadas.push(destino);
        } else if (atual.replace(/\r\n?/g, '\n') !== mescla.conteudo) {
          await cofre.escrever(destino, mescla.conteudo);
          relatorio.atualizadas.push(destino);
        } else {
          relatorio.iguais++;
        }
        estado[nota.id] = { sha256: nota.sha256, caminho: destino };
      } catch (erro) {
        relatorio.erros.push({ titulo: nota.caminho, motivo: erro instanceof Error ? erro.message : String(erro) });
      }
    }
  }
  return { relatorio, estado, indice };
}

export function resumoDoRelatorio(relatorio: RelatorioDaSincronizacao): string {
  const partes = [
    `${String(relatorio.criadas.length)} nova${relatorio.criadas.length === 1 ? '' : 's'}`,
    `${String(relatorio.atualizadas.length)} atualizada${relatorio.atualizadas.length === 1 ? '' : 's'}`,
    `${String(relatorio.iguais)} sem mudança`,
  ];
  if (relatorio.conflitos.length > 0) partes.push(`${String(relatorio.conflitos.length)} com marcadores quebrados (não mexi)`);
  if (relatorio.erros.length > 0) partes.push(`${String(relatorio.erros.length)} com erro`);
  return `Margem: ${partes.join(', ')}.`;
}
