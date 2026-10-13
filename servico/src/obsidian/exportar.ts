/**
 * Exportação para o Obsidian: um documento do Margem vira uma nota Markdown.
 *
 * Função pura, sem banco e sem relógio: a mesma entrada produz os mesmos bytes, para a nota
 * poder ser regravada no vault sem gerar conflito de sincronização. Toda lista é ordenada aqui
 * (posição no texto, depois id), nunca pela ordem em que o banco devolveu.
 *
 * Forma da nota:
 * - frontmatter YAML (titulo, autor, fonte, margem_id, data, tags `margem`);
 * - o corpo gerado entre `%% margem:inicio %%` e `%% margem:fim %%` (o plugin só troca o que está
 *   entre os dois marcadores; o que o leitor escreve fora deles fica);
 * - uma seção `##` por capítulo; cada trecho vira um callout com a citação, a função da marca como
 *   tipo do callout e como tag, o link de volta para o trecho no Margem e um bloco `^margem-<id>`;
 * - as notas do leitor logo abaixo, as perguntas e respostas em callouts recolhíveis e as conexões
 *   aceitas numa lista.
 */
import type {
  AncoraV1, AnotacaoV1, Bloco, ConexaoV2, ConversaV2, EtiquetaV1, Id, MarcaV2, Secao,
} from '@margem/contratos';

export const INICIO_GERENCIADO = '%% margem:inicio %%';
export const FIM_GERENCIADO = '%% margem:fim %%';
/** As datas da nota são as do leitor, não as do servidor. */
export const FUSO_DA_NOTA = 'America/Sao_Paulo';

export interface DocumentoExportado {
  id: Id;
  titulo: string;
  autor: string | null;
  formato: string;
  criado_em: string;
  /** URL de origem (vídeo, áudio) quando o documento tem uma. */
  fonte_url: string | null;
}

export interface EntradaDaExportacao {
  documento: DocumentoExportado;
  versao_id: Id;
  secoes: readonly Secao[];
  blocos: readonly Bloco[];
  marcas: readonly MarcaV2[];
  anotacoes: readonly AnotacaoV1[];
  conversas: readonly ConversaV2[];
  conexoes: readonly ConexaoV2[];
  etiquetas: readonly EtiquetaV1[];
  /** Rótulo legível da função, por `<modo>@<revisão>:<chave>` (ver `chaveDaFuncao`). */
  rotulos: Readonly<Record<string, string>>;
  /** Título do documento de destino de uma conexão, por id de versão ou de documento. */
  destinos: Readonly<Record<Id, { documento_id: Id; titulo: string }>>;
  /** Endereço absoluto do Margem, sem barra no fim. */
  url_base: string;
}

export interface NotaDoObsidian {
  /** Nome do arquivo no vault, sem pasta. */
  arquivo: string;
  conteudo: string;
  /** Trechos exportados. */
  itens: number;
  /** O instante mais recente entre tudo o que entrou na nota (ou a criação do documento). */
  atualizado_em: string;
}

export function chaveDaFuncao(modo: { id: string; revisao: number }, funcao: string): string {
  return `${modo.id}@${String(modo.revisao)}:${funcao}`;
}

// ------------------------------------------------------------------ escape

const RELACOES: Readonly<Record<ConexaoV2['relacao'], string>> = {
  semelhanca: 'Semelhança', contraste: 'Contraste', tensao: 'Tensão',
  prerequisito: 'Pré-requisito', desenvolve: 'Desenvolve', exemplo: 'Exemplo',
};
const TIPOS_DE_NOTA: Readonly<Record<AnotacaoV1['tipo'], string>> = {
  impressao: 'Impressão', observacao: 'Observação', hipotese: 'Hipótese', duvida: 'Dúvida', fonte: 'Fonte', nota: '',
};
const TIPOS_DE_COMENTARIO: Readonly<Record<string, string>> = {
  AUTOR: 'Do autor', LEITURA: 'Leitura', INVESTIGAR: 'Investigar', OBJECAO: 'Objeção',
  CONEXAO: 'Conexão', TENSAO: 'Tensão', PREREQUISITO: 'Pré-requisito',
};
/** Função → tipo de callout do Obsidian. O que não está aqui é citação. */
const CALLOUTS: Readonly<Record<string, string>> = {
  tese: 'important', hipotese: 'important', enunciado: 'important',
  conceito: 'info', definicao: 'info', distincao: 'info',
  justificativa: 'example', argumento: 'example', mecanismo: 'example', evidencia: 'example',
  identificacao: 'example', tecnica: 'example', passo_nao_trivial: 'example', dependencia: 'example',
  objecao: 'warning', limitacao: 'warning',
  resultado: 'success', consequencia: 'success',
};

/**
 * Texto livre (citação, nota, resposta) como Markdown literal no Obsidian: nada vira ênfase, link,
 * tag, matemática, destaque, comentário, HTML, título nem lista. As quebras de linha ficam.
 */
export function escaparMarkdown(texto: string): string {
  return texto.replace(/\r\n?/g, '\n').split('\n').map(escaparLinha).join('\n');
}

function escaparLinha(linha: string): string {
  let saida = linha.replace(/^[ \t\u00a0]+/, '').replace(/[ \t]+$/, '')
    .replace(/[\\`*_[\]<#|$^]/g, (caractere) => `\\${caractere}`)
    .replace(/([=%~])(?=\1)/g, '$1\\');
  // Começo de linha: citação, lista, lista numerada, régua e título setext.
  saida = saida.replace(/^([>+=-])/, '\\$1').replace(/^(\d+)([.)])(\s|$)/, '$1\\$2$3');
  return saida;
}

/** Uma linha só, para títulos de callout e de seção. */
function umaLinha(texto: string, limite?: number): string {
  const corrida = texto.replace(/\s+/g, ' ').trim();
  const letras = Array.from(corrida);
  const cortada = limite !== undefined && letras.length > limite ? `${letras.slice(0, limite - 1).join('').trimEnd()}…` : corrida;
  return escaparLinha(cortada);
}

/** Alvo de wikilink: sem os caracteres que o Obsidian usa na sintaxe do link. */
function alvoDeLink(texto: string): string {
  return texto.replace(/[[\]|#^\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Nome do arquivo da nota: o título, sem os caracteres que Windows, macOS, Android e o próprio
 * Obsidian recusam em nomes de nota, com no máximo 200 caracteres.
 */
export function nomeDoArquivo(titulo: string, id: Id): string {
  const limpo = titulo.normalize('NFC').replace(/:/g, ' -').replace(/[\\/*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim();
  const letras = Array.from(limpo);
  const nome = (letras.length > 200 ? letras.slice(0, 200).join('').trimEnd() : limpo) || `Documento ${id}`;
  return `${nome}.md`;
}

function blocoDeId(id: Id): string {
  return `^margem-${id.toLowerCase()}`;
}

function citar(linhas: readonly string[]): string {
  return linhas.map((linha) => (linha === '' ? '>' : `> ${linha}`)).join('\n');
}

function dataLocal(instante: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DA_NOTA, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(instante));
}

function rotuloDaChave(chave: string): string {
  const texto = chave.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ------------------------------------------------------------------ itens

interface Item {
  /** Id do trecho: o da marca, ou o da primeira coisa ancorada nele. */
  id: Id;
  /** Bloco `^margem-…` do trecho. Sem marca, leva `trecho-` para não repetir o da nota (ou pergunta) que o abriu. */
  bloco: string;
  ancora: AncoraV1;
  indiceDoBloco: number;
  marca?: MarcaV2;
  notas: AnotacaoV1[];
  conversas: ConversaV2[];
  conexoes: ConexaoV2[];
}

const mesmaFaixa = (a: AncoraV1, b: AncoraV1): boolean =>
  a.versao_id === b.versao_id && a.bloco_id === b.bloco_id && a.inicio_utf16 === b.inicio_utf16 && a.fim_utf16 === b.fim_utf16;
const porId = <T extends { id: Id }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const porCriacao = <T extends { id: Id; criada_em: string }>(a: T, b: T): number =>
  a.criada_em < b.criada_em ? -1 : a.criada_em > b.criada_em ? 1 : porId(a, b);

function montarItens(entrada: EntradaDaExportacao, indiceDoBloco: ReadonlyMap<Id, number>): Item[] {
  const itens: Item[] = [];
  const naVersao = (ancora: AncoraV1) => ancora.versao_id === entrada.versao_id && indiceDoBloco.has(ancora.bloco_id);
  const novo = (id: Id, ancora: AncoraV1): Item => {
    const item: Item = { id, bloco: blocoDeId(id), ancora, indiceDoBloco: indiceDoBloco.get(ancora.bloco_id) ?? 0, notas: [], conversas: [], conexoes: [] };
    itens.push(item);
    return item;
  };
  const porMarca = new Map<Id, Item>();
  for (const marca of [...entrada.marcas].sort(porId)) {
    if (!naVersao(marca.ancora)) continue;
    const item = novo(marca.id, marca.ancora);
    item.marca = marca;
    porMarca.set(marca.id, item);
  }
  // A nota, a pergunta e a conexão vão para o trecho da marca a que se referem, ou para um trecho
  // com exatamente a mesma faixa; senão abrem um trecho próprio.
  const alojar = (id: Id, ancora: AncoraV1, marcaId: Id | undefined): Item =>
    (marcaId === undefined ? undefined : porMarca.get(marcaId))
    ?? itens.find((item) => mesmaFaixa(item.ancora, ancora))
    ?? Object.assign(novo(id, ancora), { bloco: blocoDeId(`trecho-${id}`) });
  const porNota = new Map<Id, Item>();
  for (const nota of [...entrada.anotacoes].sort(porCriacao)) {
    if (!naVersao(nota.ancora)) continue;
    const item = alojar(nota.id, nota.ancora, nota.marca_id);
    item.notas.push(nota);
    porNota.set(nota.id, item);
  }
  for (const conversa of [...entrada.conversas].sort(porCriacao)) {
    if (!naVersao(conversa.ancora) || conversa.mensagens.length === 0) continue;
    const item = (conversa.anotacao_id === undefined ? undefined : porNota.get(conversa.anotacao_id))
      ?? alojar(conversa.id, conversa.ancora, conversa.marca_id);
    item.conversas.push(conversa);
  }
  for (const conexao of [...entrada.conexoes].sort(porCriacao)) {
    if (conexao.estado !== 'aceita' || !naVersao(conexao.origem)) continue;
    alojar(conexao.id, conexao.origem, undefined).conexoes.push(conexao);
  }
  return itens.sort((a, b) => a.indiceDoBloco - b.indiceDoBloco || a.ancora.inicio_utf16 - b.ancora.inicio_utf16
    || a.ancora.fim_utf16 - b.ancora.fim_utf16 || porId(a, b));
}

// ------------------------------------------------------------------ renderização

interface Contexto {
  entrada: EntradaDaExportacao;
  blocos: ReadonlyMap<Id, Bloco>;
  capituloDoBloco: (indice: number) => Secao | undefined;
  indiceDoBloco: ReadonlyMap<Id, number>;
  itens: readonly Item[];
  etiquetasDe: (alvo: Id) => string[];
}

function urlDoTrecho(contexto: Contexto, blocoId: Id): string {
  const { entrada } = contexto;
  const capitulo = contexto.capituloDoBloco(contexto.indiceDoBloco.get(blocoId) ?? -1);
  const base = `${entrada.url_base}/ler/${entrada.documento.id}`;
  return capitulo === undefined ? base : `${base}/${capitulo.id}?bloco=${blocoId}`;
}

function paginaDoBloco(bloco: Bloco | undefined): string | null {
  const origem = bloco?.origens.find((candidata) => candidata.tipo === 'pdf');
  if (origem?.tipo !== 'pdf') return null;
  return `p. ${origem.impressa !== undefined && origem.impressa.trim() !== '' ? umaLinha(origem.impressa) : String(origem.pagina)}`;
}

function tagsDaMarca(contexto: Contexto, marca: MarcaV2 | undefined): string[] {
  if (!marca) return [];
  return [
    ...(marca.funcao === 'nenhuma' ? [] : [`#margem/${marca.funcao}`]),
    ...(marca.origem === 'manual' ? [] : ['#margem/ia']),
    ...contexto.etiquetasDe(marca.id),
  ];
}

function renderizarTrecho(contexto: Contexto, item: Item): string {
  const { marca } = item;
  const bloco = contexto.blocos.get(item.ancora.bloco_id);
  const funcao = marca === undefined || marca.funcao === 'nenhuma' ? 'Trecho'
    : contexto.entrada.rotulos[chaveDaFuncao(marca.modo, marca.funcao)] ?? rotuloDaChave(marca.funcao);
  const tipo = marca === undefined ? 'quote' : CALLOUTS[marca.funcao] ?? 'quote';
  const pagina = paginaDoBloco(bloco);
  const titulo = [umaLinha(funcao), ...(pagina === null ? [] : [pagina]), `[abrir no Margem](${urlDoTrecho(contexto, item.ancora.bloco_id)})`].join(' · ');
  const corpo = escaparMarkdown(item.ancora.citacao).split('\n');
  if (marca?.comentario) {
    const rotulo = TIPOS_DE_COMENTARIO[marca.comentario.tipo] ?? rotuloDaChave(marca.comentario.tipo.toLowerCase());
    const cabeca = marca.comentario.rotulo.trim() === '' ? rotulo : `${rotulo} — ${umaLinha(marca.comentario.rotulo)}`;
    const [primeira = '', ...resto] = escaparMarkdown(marca.comentario.texto).split('\n');
    corpo.push('', `*${cabeca}:* ${primeira}`.trimEnd(), ...resto);
  }
  const tags = tagsDaMarca(contexto, marca);
  if (tags.length > 0) corpo.push('', tags.join(' '));
  return `${citar([`[!${tipo}] ${titulo}`, ...corpo])}\n\n${item.bloco}`;
}

function renderizarNota(contexto: Contexto, nota: AnotacaoV1): string {
  const linhas = escaparMarkdown(nota.texto).split('\n');
  const rotulo = TIPOS_DE_NOTA[nota.tipo];
  if (rotulo !== '') linhas[0] = `**${rotulo}.** ${linhas[0] ?? ''}`.trimEnd();
  if (nota.tipo === 'fonte') {
    const { titulo, url, pagina } = nota.fonte;
    const referencia = url !== undefined && /^https?:\/\/[^\s()<>]+$/.test(url) ? `[${umaLinha(titulo)}](${url})` : umaLinha(titulo);
    linhas.push(`— ${referencia}${pagina === undefined || pagina.trim() === '' ? '' : `, p. ${umaLinha(pagina)}`}`);
  }
  // O bloco `^id` fica no fim da última linha com texto: é o parágrafo que o Obsidian liga.
  while (linhas.length > 1 && linhas.at(-1) === '') linhas.pop();
  const sufixo = [...contexto.etiquetasDe(nota.id), blocoDeId(nota.id)].join(' ');
  linhas[linhas.length - 1] = `${linhas.at(-1) ?? ''} ${sufixo}`.trimStart();
  return linhas.join('\n');
}

function renderizarConversa(conversa: ConversaV2): string {
  const primeira = conversa.mensagens.find((mensagem) => mensagem.autor === 'leitor') ?? conversa.mensagens[0];
  const titulo = `[!question]- ${umaLinha(primeira?.texto ?? 'Pergunta', 90)}`;
  const corpo: string[] = [];
  for (const mensagem of conversa.mensagens) {
    if (corpo.length > 0) corpo.push('');
    const [inicio = '', ...resto] = escaparMarkdown(mensagem.texto).split('\n');
    corpo.push(`**${mensagem.autor === 'leitor' ? 'Pergunta' : 'Resposta'}:** ${inicio}`.trimEnd(), ...resto);
  }
  if (conversa.estado === 'arquivada') corpo.push('', '*(conversa arquivada)*');
  return `${citar([titulo, ...corpo])}\n\n${blocoDeId(conversa.id)}`;
}

function renderizarConexao(contexto: Contexto, conexao: ConexaoV2): string {
  const { entrada } = contexto;
  const relacao = RELACOES[conexao.relacao];
  const destino = conexao.destino;
  let alvo: string;
  if (destino.tipo === 'trecho') {
    const citacao = `«${umaLinha(destino.ancora.citacao, 140)}»`;
    if (destino.ancora.versao_id === entrada.versao_id) {
      const item = contexto.itens.find((candidato) => mesmaFaixa(candidato.ancora, destino.ancora));
      const apelido = alvoDeLink(Array.from(destino.ancora.citacao.replace(/\s+/g, ' ').trim()).slice(0, 80).join(''));
      alvo = item ? `[[#${item.bloco}|«${apelido}»]]`
        : `${citacao} ([abrir no Margem](${urlDoTrecho(contexto, destino.ancora.bloco_id)}))`;
    } else {
      const outro = entrada.destinos[destino.ancora.versao_id];
      alvo = outro ? `${citacao}, em [[${alvoDeLink(nomeDoArquivo(outro.titulo, outro.documento_id).slice(0, -3))}]]` : citacao;
    }
  } else if (destino.tipo === 'documento') {
    const outro = entrada.destinos[destino.documento_id];
    alvo = outro ? `[[${alvoDeLink(nomeDoArquivo(outro.titulo, outro.documento_id).slice(0, -3))}]]` : 'outro documento do Margem';
  } else {
    const caminho = alvoDeLink(destino.caminho.replace(/\.md$/i, ''));
    const titulo = alvoDeLink(destino.titulo);
    alvo = caminho === '' ? umaLinha(destino.titulo) : titulo === '' || titulo === caminho ? `[[${caminho}]]` : `[[${caminho}|${titulo}]]`;
  }
  const justificativa = umaLinha(conexao.justificativa);
  return `- *${relacao}:* ${alvo}${justificativa === '' ? '' : ` — ${justificativa}`}`;
}

function renderizarItem(contexto: Contexto, item: Item): string {
  const partes = [renderizarTrecho(contexto, item)];
  for (const nota of item.notas) partes.push(renderizarNota(contexto, nota));
  for (const conversa of item.conversas) partes.push(renderizarConversa(conversa));
  if (item.conexoes.length > 0) partes.push(item.conexoes.map((conexao) => renderizarConexao(contexto, conexao)).join('\n'));
  return partes.join('\n\n');
}

// ------------------------------------------------------------------ frontmatter

const yaml = (texto: string): string => JSON.stringify(texto);

function frontmatter(entrada: EntradaDaExportacao, atualizadoEm: string): string {
  const { documento } = entrada;
  const urlDoDocumento = `${entrada.url_base}/documentos/${documento.id}`;
  const linhas = [
    '---',
    `titulo: ${yaml(documento.titulo)}`,
    ...(documento.autor === null || documento.autor.trim() === '' ? [] : [`autor: ${yaml(documento.autor)}`]),
    `fonte: ${yaml(documento.fonte_url ?? urlDoDocumento)}`,
    `formato: ${yaml(documento.formato)}`,
    `margem_id: ${yaml(documento.id)}`,
    `margem_versao: ${yaml(entrada.versao_id)}`,
    `margem_url: ${yaml(urlDoDocumento)}`,
    `data: ${dataLocal(documento.criado_em)}`,
    `atualizado: ${dataLocal(atualizadoEm)}`,
    'tags:',
    '  - margem',
    '---',
  ];
  return linhas.join('\n');
}

function instantes(entrada: EntradaDaExportacao, itens: readonly Item[]): string[] {
  const todos: string[] = [entrada.documento.criado_em];
  for (const item of itens) {
    if (item.marca) todos.push(item.marca.criada_em);
    for (const nota of item.notas) todos.push(nota.criada_em, nota.atualizada_em);
    for (const conversa of item.conversas) todos.push(conversa.criada_em, ...conversa.mensagens.map((mensagem) => mensagem.criada_em));
    for (const conexao of item.conexoes) todos.push(conexao.criada_em, ...(conexao.decidida_em === undefined ? [] : [conexao.decidida_em]));
  }
  return todos;
}

// ------------------------------------------------------------------ nota

export function exportarParaObsidian(entrada: EntradaDaExportacao): NotaDoObsidian {
  const indiceDoBloco = new Map(entrada.blocos.map((bloco, indice) => [bloco.id, indice]));
  const blocos = new Map(entrada.blocos.map((bloco) => [bloco.id, bloco]));
  const capitulos = [...entrada.secoes].filter((secao) => secao.nivel === 1).sort((a, b) => a.ordem - b.ordem)
    .map((secao) => ({ secao, inicio: indiceDoBloco.get(secao.bloco_inicio) ?? -1, fim: indiceDoBloco.get(secao.bloco_fim) ?? -2 }));
  const capituloDoBloco = (indice: number) => capitulos.find((capitulo) => indice >= capitulo.inicio && indice <= capitulo.fim)?.secao;
  const etiquetas = new Map<Id, string[]>();
  for (const etiqueta of [...entrada.etiquetas].sort(porCriacao)) {
    const lista = etiquetas.get(etiqueta.alvo.id) ?? [];
    const tag = `#margem/dificuldade/${etiqueta.nome}`;
    if (!lista.includes(tag)) lista.push(tag);
    etiquetas.set(etiqueta.alvo.id, lista);
  }
  const itens = montarItens(entrada, indiceDoBloco);
  const contexto: Contexto = {
    entrada, blocos, capituloDoBloco, indiceDoBloco, itens, etiquetasDe: (alvo) => etiquetas.get(alvo) ?? [],
  };

  const secoes: string[] = [];
  let atual: Secao | null | undefined;
  for (const item of itens) {
    const capitulo = capituloDoBloco(item.indiceDoBloco) ?? null;
    if (atual === undefined || capitulo?.id !== atual?.id) {
      const titulo = capitulo === null ? 'Fora dos capítulos' : umaLinha(capitulo.titulo) || 'Sem título';
      secoes.push(`## ${titulo}`);
      atual = capitulo;
    }
    secoes.push(renderizarItem(contexto, item));
  }

  const { documento } = entrada;
  const atualizadoEm = instantes(entrada, itens).reduce((maior, instante) => (instante > maior ? instante : maior));
  const cabecalho = [
    `# ${umaLinha(documento.titulo) || 'Sem título'}`,
    [...(documento.autor === null || documento.autor.trim() === '' ? [] : [umaLinha(documento.autor)]),
      `[abrir no Margem](${entrada.url_base}/documentos/${documento.id})`].join(' · '),
  ];
  const corpo = itens.length === 0 ? ['*Nenhuma marca, nota ou pergunta neste documento ainda.*'] : secoes;
  const conteudo = `${frontmatter(entrada, atualizadoEm)}\n${[INICIO_GERENCIADO, cabecalho.join('\n\n'), ...corpo, FIM_GERENCIADO].join('\n\n')}\n`;
  return { arquivo: nomeDoArquivo(documento.titulo, documento.id), conteudo, itens: itens.length, atualizado_em: atualizadoEm };
}
