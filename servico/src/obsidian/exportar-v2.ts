/**
 * Exportação para o Obsidian, formato 2: um documento do Margem vira uma pasta com uma nota por item.
 *
 *   <Documento>/<Documento>.md            nota-índice (o mesmo nome e os mesmos `^margem-<id>` da V1)
 *   <Documento>/Grifos/<…> · <id6>.md      uma por marca exportada (com a nota do leitor e as dificuldades)
 *   <Documento>/Anotações/<…>.md           uma por nota antiga, solta (sem grifo), ou de grifo que não foi exportado
 *   <Documento>/Perguntas/<…>.md           uma por conversa com mensagens
 *   <Documento>/Relações/<…>.md            uma por conexão aceita com origem neste documento
 *   <Documento>/Flashcards/<…>.md          uma por cartão (formato do plugin Spaced Repetition)
 *   <Documento>/Exercícios/<…>.md          uma por exercício resolvido
 *
 * Função pura, sem banco e sem relógio: a mesma entrada produz os mesmos bytes (toda lista é
 * ordenada aqui). Cada nota tem o frontmatter com `margem_esquema: 2`, `margem_tipo` e `margem_id`
 * e o corpo entre `%% margem:inicio %%` e `%% margem:fim %%`: reexportar troca só esse bloco e as
 * chaves do Margem no frontmatter (a mescla é `@margem/core/obsidian`). O nome de cada nota de item
 * é determinístico (as primeiras palavras e o fim do id), então os links `[[…]]` entre notas, até
 * entre documentos, apontam certo sem consultar o cofre.
 *
 * A citação do livro sai escapada (é texto literal); o que o leitor escreveu sai como Markdown, com o
 * mínimo de escape para não quebrar a nota (ver `markdownDoLeitor`). O formato completo está em
 * `FORMATO.md`, ao lado.
 */
import {
  FAMILIA_DA_RELACAO_SEMANTICA, PASTAS_DO_OBSIDIAN, ROTULOS_DA_RELACAO, ROTULOS_DA_RELACAO_SEMANTICA,
  type AncoraV1, type AnotacaoV1, type Bloco, type ConexaoV3, type ConversaV2, type DificuldadeV1, type EtiquetaV1, type Id, type MarcaV2,
  type ResolucaoV2, type Secao, type TipoDeNotaDoObsidian, type TipoDificuldadeTextual,
} from '@margem/contratos';
import {
  CALLOUTS, FIM_GERENCIADO, FUSO_DA_NOTA, INICIO_GERENCIADO, TIPOS_DE_COMENTARIO, TIPOS_DE_NOTA,
  alvoDeLink, blocoDeId, chaveDaFuncao, citar, dataLocal, escaparMarkdown, mesmaFaixa, montarItens, nomeDoArquivo,
  paginaDoBloco, porCriacao, porId, rotuloDaChave, umaLinha, type DocumentoExportado, type Item,
} from './exportar.js';

export const ESQUEMA_DO_OBSIDIAN = 2;

/**
 * As sete categorias de dificuldade textual, com o nome que a tela usa (o mesmo de
 * `web/src/leitor/compreensao/rotulos.ts`). Desde o modelo D a dificuldade é um sinal à parte
 * (`DificuldadeV1`); uma etiqueta antiga com um destes nomes já virou sinal na migração 0032 e não
 * sai mais como tag (a tag `margem/dificuldade/<nome>` vem dos sinais).
 */
export const ROTULO_DA_DIFICULDADE: Readonly<Record<TipoDificuldadeTextual, string>> = {
  premissa_implicita: 'Premissa implícita', mudanca_de_notacao: 'Mudança de notação', sintaxe_complexa: 'Sintaxe complexa',
  conceito_sem_definicao: 'Conceito sem definição', salto_argumentativo: 'Salto no argumento', referencia_externa: 'Referência externa',
  ambiguidade: 'Ambiguidade',
};
const DIFICULDADES: ReadonlySet<string> = new Set(Object.keys(ROTULO_DA_DIFICULDADE));

export interface FuncaoDaExportacao { rotulo: string; cor: string | null }

export interface CartaoDaExportacao {
  id: Id;
  ancora: AncoraV1;
  frente: string;
  verso: string;
  origem: 'ia' | 'manual';
  criado_em: string;
  atualizado_em: string;
}

/** Marca de outra versão que é ponta de uma relação: a nota dela mora na pasta do outro documento. */
export interface MarcaExterna { id: Id; ancora: AncoraV1; funcao: string; modo: { id: string; revisao: number } }

export interface EntradaDaExportacaoV2 {
  documento: DocumentoExportado;
  versao_id: Id;
  secoes: readonly Secao[];
  blocos: readonly Bloco[];
  marcas: readonly MarcaV2[];
  anotacoes: readonly AnotacaoV1[];
  conversas: readonly ConversaV2[];
  /** Conexões aceitas com a origem ou o destino (trecho) nesta versão. */
  conexoes: readonly ConexaoV3[];
  etiquetas: readonly EtiquetaV1[];
  /** Sinais de dificuldade da versão (os descartados não saem). */
  dificuldades: readonly DificuldadeV1[];
  flashcards: readonly CartaoDaExportacao[];
  resolucoes: readonly ResolucaoV2[];
  /** Rótulo e cor (a clara do modo) da função, por `<modo>@<revisão>:<chave>` (ver `chaveDaFuncao`). */
  funcoes: Readonly<Record<string, FuncaoDaExportacao>>;
  /** Título de outro documento (ponta de relação), por id de versão ou de documento. */
  destinos: Readonly<Record<Id, { documento_id: Id; titulo: string }>>;
  /** Marcas de outras versões com a mesma faixa de uma ponta de relação (ganham link para a nota delas). */
  marcas_externas: readonly MarcaExterna[];
  url_base: string;
  /** Nome da nota-índice e da pasta, quando quem chama já desambiguou dois títulos iguais. */
  nome?: string;
}

export interface NotaDoObsidianV2 {
  id: Id;
  tipo: TipoDeNotaDoObsidian;
  documento_id: Id;
  /** Relativo à pasta da exportação: `<Documento>/<Documento>.md` ou `<Documento>/<Subpasta>/<nota>.md`. */
  caminho: string;
  conteudo: string;
  atualizado_em: string;
}

export interface ExportacaoDoDocumentoV2 {
  /** O nome da pasta e da nota-índice (sem `.md`). */
  nome: string;
  /** A nota-índice primeiro; depois os itens, por tipo e caminho. */
  notas: NotaDoObsidianV2[];
  /** Trechos exportados (como o `itens` da V1). */
  itens: number;
  atualizado_em: string;
}

// ------------------------------------------------------------------ texto

/**
 * O que o leitor escreveu, como Markdown: ênfase, links, listas e títulos ficam. Só o que quebraria a
 * nota é escapado: `%%` (abriria um comentário que engole o fim do bloco do Margem), um `^id` no fim
 * da linha (criaria um bloco que disputa com os do Margem), um comentário HTML sem fim e uma cerca de
 * código aberta (fechada no fim).
 */
export function markdownDoLeitor(texto: string): string {
  let saida = texto.replace(/\r\n?/g, '\n').replace(/\s+$/u, '').replace(/%%/g, '\\%\\%')
    .split('\n').map((linha) => linha.replace(/[ \t]+$/, '').replace(/(\s)\^([A-Za-z0-9-]+)$/, '$1\\^$2')).join('\n');
  const abertura = saida.lastIndexOf('<!--');
  if (abertura >= 0 && saida.indexOf('-->', abertura) < 0) saida = `${saida.slice(0, abertura)}&lt;!--${saida.slice(abertura + 4)}`;
  let cerca: string | null = null;
  for (const linha of saida.split('\n')) {
    const marca = /^ {0,3}(`{3,}|~{3,})/.exec(linha)?.[1];
    if (marca === undefined) continue;
    if (cerca === null) cerca = marca;
    else if (marca[0] === cerca[0] && marca.length >= cerca.length && linha.trim() === marca) cerca = null;
  }
  return cerca === null ? saida : `${saida}\n${cerca}`;
}

/** O texto numa linha, cortado no fim de uma palavra (até `limite`), sem tirar caractere nenhum. */
function resumir(texto: string, limite: number): string {
  const linha = texto.replace(/\s+/g, ' ').trim();
  const letras = Array.from(linha);
  if (letras.length <= limite) return linha;
  const corte = letras.slice(0, limite).join('');
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > limite / 2 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/** As primeiras palavras do texto, sem a marcação do Markdown, para nomes de nota. */
function primeirasPalavras(texto: string, limite: number): string {
  const linha = texto.replace(/[*_`~=$^]/g, '').replace(/[#>[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
  const letras = Array.from(linha);
  if (letras.length <= limite) return linha;
  const corte = letras.slice(0, limite).join('');
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > limite / 2 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/** Nome de uma nota de item: as primeiras palavras (até 60), `·` e os 6 últimos caracteres do id. */
export function nomeDaNota(texto: string, id: Id, padrao: string): string {
  const base = nomeDoArquivo(primeirasPalavras(texto, 60) || padrao, id).slice(0, -3);
  return `${base === `Documento ${id}` ? padrao : base} · ${id.slice(-6).toLowerCase()}`;
}

const yaml = (texto: string): string => JSON.stringify(texto);
const link = (nome: string, apelido?: string): string => {
  const alvo = alvoDeLink(nome);
  const rotulo = apelido === undefined ? '' : alvoDeLink(apelido).replace(/\s+/g, ' ');
  return rotulo === '' || rotulo === alvo ? `[[${alvo}]]` : `[[${alvo}|${rotulo}]]`;
};

/** Instante no fuso do leitor, com o deslocamento: `2026-09-19T20:30:00-03:00`. */
const FORMATO_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_DA_NOTA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23', timeZoneName: 'longOffset',
});
export function instanteLocal(instante: string): string {
  const partes = Object.fromEntries(FORMATO_LOCAL.formatToParts(new Date(instante)).map((parte) => [parte.type, parte.value]));
  const deslocamento = String(partes.timeZoneName ?? 'GMT').replace(/^GMT/, '') || '+00:00';
  return `${String(partes.year)}-${String(partes.month)}-${String(partes.day)}T${String(partes.hour)}:${String(partes.minute)}:${String(partes.second)}${deslocamento}`;
}

const maisRecente = (instantes: readonly string[]): string => instantes.reduce((maior, atual) => (atual > maior ? atual : maior));

/** Tag do Obsidian: minúsculas, sem espaço nem os caracteres que a sintaxe de tag recusa. */
function tag(texto: string): string {
  return texto.normalize('NFC').toLowerCase().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_/-]/gu, '').replace(/^\/+|\/+$/g, '') || 'sem_nome';
}

// ------------------------------------------------------------------ frontmatter

/** Valor escrito sem aspas (datas: o Obsidian as lê como propriedade de data). */
interface Cru { cru: string }
const cru = (texto: string): Cru => ({ cru: texto });
type Valor = string | number | boolean | null | Cru | readonly (string | number)[] | Readonly<Record<string, number>>;

function frontmatter(campos: readonly [string, Valor | undefined][]): string {
  const linhas = ['---'];
  for (const [chave, valor] of campos) {
    if (valor === undefined || valor === null) continue;
    if (typeof valor === 'string') linhas.push(`${chave}: ${yaml(valor)}`);
    else if (typeof valor === 'number' || typeof valor === 'boolean') linhas.push(`${chave}: ${String(valor)}`);
    else if ('cru' in valor && typeof valor.cru === 'string') linhas.push(`${chave}: ${valor.cru}`);
    else if (Array.isArray(valor)) {
      const lista = valor as readonly (string | number)[];
      if (lista.every((item) => typeof item === 'number')) linhas.push(`${chave}: [${lista.join(', ')}]`);
      else if (lista.length === 0) continue;
      else linhas.push(`${chave}:`, ...lista.map((item) => `  - ${typeof item === 'number' ? String(item) : yaml(item)}`));
    } else {
      const pares = Object.entries(valor as Readonly<Record<string, number>>);
      linhas.push(`${chave}:`, ...pares.map(([nome, numero]) => `  ${nome}: ${String(numero)}`));
    }
  }
  linhas.push('---');
  return linhas.join('\n');
}

function montarNota(cabecalho: string, corpo: readonly string[]): string {
  return `${cabecalho}\n${[INICIO_GERENCIADO, ...corpo.filter((parte) => parte !== ''), FIM_GERENCIADO].join('\n\n')}\n`;
}

// ------------------------------------------------------------------ contexto

interface Ponta {
  /** Nome da nota do grifo desta ponta, se houver. */
  nota: string | null;
  /** Rótulo curto da ponta (função do grifo, ou primeiras palavras). */
  rotulo: string;
}

interface Contexto {
  entrada: EntradaDaExportacaoV2;
  nomeDoIndice: string;
  blocos: ReadonlyMap<Id, Bloco>;
  indiceDoBloco: ReadonlyMap<Id, number>;
  capituloDoBloco: (blocoId: Id) => Secao | undefined;
  /** Etiquetas livres (as de dificuldade viraram sinais e ficam de fora). */
  etiquetasDe: (alvo: Id) => readonly string[];
  /** Os sinais de dificuldade não descartados ligados a uma marca, na ordem do texto. */
  dificuldadesDe: (marca: Id) => readonly DificuldadeV1[];
  /** Onde mora o texto de cada anotação exportada: `[[…]]` da nota dela, ou da seção "Sua nota" do grifo. */
  linkDaAnotacao: ReadonlyMap<Id, string>;
  /** Nome da nota de cada marca exportada (desta versão e das externas). */
  notaDaMarca: ReadonlyMap<Id, string>;
  marcasPorFaixa: (ancora: AncoraV1) => MarcaV2 | MarcaExterna | undefined;
  rotuloDaFuncao: (marca: { funcao: string; modo: { id: string; revisao: number } }) => string;
}

function urlDoTrecho(contexto: Contexto, ancora: AncoraV1): string {
  const { entrada } = contexto;
  if (ancora.versao_id !== entrada.versao_id) {
    const outro = entrada.destinos[ancora.versao_id];
    return outro ? `${entrada.url_base}/ler/${outro.documento_id}` : `${entrada.url_base}/`;
  }
  const capitulo = contexto.capituloDoBloco(ancora.bloco_id);
  const base = `${entrada.url_base}/ler/${entrada.documento.id}`;
  return capitulo === undefined ? base : `${base}/${capitulo.id}?bloco=${ancora.bloco_id}`;
}

/** Página como o frontmatter a guarda: a impressa, ou a do PDF. */
function pagina(bloco: Bloco | undefined): string | undefined {
  const texto = paginaDoBloco(bloco);
  return texto === null ? undefined : texto.replace(/^p\. /, '');
}

/** Os campos de localização comuns às notas ancoradas num trecho desta versão. */
function campos(contexto: Contexto, ancora: AncoraV1): [string, Valor | undefined][] {
  const { entrada } = contexto;
  const local = ancora.versao_id === entrada.versao_id;
  const capitulo = local ? contexto.capituloDoBloco(ancora.bloco_id) : undefined;
  return [
    ['margem_documento', `[[${alvoDeLink(contexto.nomeDoIndice)}]]`],
    ['documento', entrada.documento.titulo],
    ['documento_id', entrada.documento.id],
    ['autor', entrada.documento.autor === null || entrada.documento.autor.trim() === '' ? undefined : entrada.documento.autor],
    ['versao_id', entrada.versao_id],
    ['capitulo', capitulo === undefined ? undefined : umaLinha(capitulo.titulo).replace(/\\/g, '') || undefined],
    ['pagina', local ? pagina(contexto.blocos.get(ancora.bloco_id)) : undefined],
    ['bloco_id', ancora.bloco_id],
    ['posicao', [ancora.inicio_utf16, ancora.fim_utf16]],
    ['margem_url', urlDoTrecho(contexto, ancora)],
  ];
}

/** "[[Índice]] · I. Da dúvida · p. 111": onde o trecho está. */
function linhaDeLocal(contexto: Contexto, ancora: AncoraV1): string {
  const { entrada } = contexto;
  if (ancora.versao_id !== entrada.versao_id) {
    const outro = entrada.destinos[ancora.versao_id];
    return outro ? link(nomeDoArquivo(outro.titulo, outro.documento_id).slice(0, -3)) : 'Outro documento do Margem';
  }
  const capitulo = contexto.capituloDoBloco(ancora.bloco_id);
  const paginaTexto = paginaDoBloco(contexto.blocos.get(ancora.bloco_id));
  return [link(contexto.nomeDoIndice), ...(capitulo === undefined ? [] : [umaLinha(capitulo.titulo) || 'Sem título']),
    ...(paginaTexto === null ? [] : [paginaTexto])].join(' · ');
}

/** O trecho do livro num callout, com o link para a nota do grifo (ou para o Margem) e um bloco no fim. */
function calloutDoTrecho(contexto: Contexto, ancora: AncoraV1, bloco: string, semLink = false): string {
  const marca = contexto.marcasPorFaixa(ancora);
  const nota = marca === undefined || semLink ? undefined : contexto.notaDaMarca.get(marca.id);
  const rotulo = marca === undefined || marca.funcao === 'nenhuma' ? 'Trecho' : contexto.rotuloDaFuncao(marca);
  const tipo = marca === undefined ? 'quote' : CALLOUTS[marca.funcao] ?? 'quote';
  const titulo = [nota === undefined ? umaLinha(rotulo) : link(nota, rotulo), `[abrir no Margem](${urlDoTrecho(contexto, ancora)})`].join(' · ');
  return `${citar([`[!${tipo}] ${titulo}`, ...escaparMarkdown(ancora.citacao).split('\n')])}\n^${bloco}`;
}

function tagsDaEtiqueta(nome: string): string {
  return `margem/etiqueta/${tag(nome)}`;
}

/** Nome da categoria; sem categoria, "Dificuldade". */
function rotuloDaDificuldade(dificuldade: DificuldadeV1): string {
  return dificuldade.tipo === undefined ? 'Dificuldade' : ROTULO_DA_DIFICULDADE[dificuldade.tipo];
}

/** Uma linha de dificuldade: categoria, de quem é, a descrição do Codex e, se pedido, o trecho citado. */
function linhaDaDificuldade(dificuldade: DificuldadeV1, trecho: string | null): string {
  const partes = [`**${rotuloDaDificuldade(dificuldade)}**`];
  if (trecho !== null) partes.push(trecho);
  partes.push(dificuldade.origem === 'leitor' ? 'marcada por você'
    : dificuldade.estado === 'sugerida' ? 'sugerida pelo Codex' : 'do Codex, confirmada por você');
  const descricao = dificuldade.descricao === undefined ? '' : umaLinha(dificuldade.descricao);
  return `- ${partes.join(' · ')}${descricao === '' ? '' : ` — *Codex:* ${descricao}`}`;
}

/** A seção de notas no grifo: "Sua nota" é o nome do cabeçalho e o alvo dos links `[[Grifo#Sua nota]]`. */
const SUA_NOTA = 'Sua nota';

// ------------------------------------------------------------------ notas de item

interface Planejada { tipo: Exclude<TipoDeNotaDoObsidian, 'documento'>; id: Id; nome: string }

function caminhoDe(nomeDoIndice: string, nota: Planejada): string {
  return `${nomeDoIndice}/${PASTAS_DO_OBSIDIAN[nota.tipo]}/${nota.nome}.md`;
}

/** Nome da nota de uma relação: família, as duas pontas em poucas palavras, o fim do id. */
export function nomeDaRelacao(conexao: ConexaoV3, destinos: EntradaDaExportacaoV2['destinos']): string {
  const familia = ROTULOS_DA_RELACAO[conexao.relacao];
  const origem = primeirasPalavras(conexao.origem.citacao, 28);
  const d = conexao.destino;
  const destino = d.tipo === 'trecho' ? primeirasPalavras(d.ancora.citacao, 28)
    : d.tipo === 'documento' ? primeirasPalavras(destinos[d.documento_id]?.titulo ?? 'Outro documento', 28)
      : primeirasPalavras(d.titulo, 28);
  return nomeDaNota(`${familia} — ${origem} → ${destino}`.replace(/…/g, ''), conexao.id, 'Relação');
}

interface Relacionadas {
  /** A nota do leitor deste grifo (modelo D: uma por grifo, sem tipo). */
  nota: AnotacaoV1 | undefined;
  /** Notas antigas, soltas, com exatamente a faixa do grifo (cada uma tem a nota dela em Anotações/). */
  antigas: AnotacaoV1[];
  conversas: ConversaV2[];
  conexoes: ConexaoV3[];
}

function notaDoGrifo(contexto: Contexto, marca: MarcaV2, nome: string, relacionadas: Relacionadas, nomes: ReadonlyMap<Id, string>): NotaDoObsidianV2 {
  const { entrada } = contexto;
  const funcao = entrada.funcoes[chaveDaFuncao(marca.modo, marca.funcao)];
  const rotulo = marca.funcao === 'nenhuma' ? 'Trecho' : contexto.rotuloDaFuncao(marca);
  const { nota } = relacionadas;
  const dificuldades = contexto.dificuldadesDe(marca.id);
  const atualizado = maisRecente([marca.criada_em, ...(nota === undefined ? [] : [nota.atualizada_em]),
    ...relacionadas.antigas.map((n) => n.atualizada_em), ...dificuldades.map((d) => d.atualizada_em),
    ...relacionadas.conversas.flatMap((c) => c.mensagens.map((m) => m.criada_em)), ...relacionadas.conexoes.map((c) => c.decidida_em ?? c.criada_em)]);
  const etiquetas = contexto.etiquetasDe(marca.id);
  const categorias = [...new Set(dificuldades.map((d) => d.tipo ?? 'sem_categoria'))];
  const cabecalho = frontmatter([
    ['margem_esquema', ESQUEMA_DO_OBSIDIAN], ['margem_tipo', 'grifo'], ['margem_id', marca.id],
    ...campos(contexto, marca.ancora),
    ['funcao', marca.funcao], ['funcao_rotulo', rotulo], ['modo', `${marca.modo.id}@${String(marca.modo.revisao)}`],
    ['cor', funcao?.cor ?? undefined], ['saliencia', marca.saliencia],
    ['autoria', marca.origem === 'manual' ? 'leitor' : 'ia'], ['avaliacao', marca.avaliacao],
    ['nota_do_leitor', nota === undefined ? undefined : true],
    ['nota_revisada_pelo_codex', nota?.revisao === undefined ? undefined : true],
    ['dificuldade', categorias.length === 0 ? undefined : categorias],
    ['etiquetas', etiquetas.length === 0 ? undefined : etiquetas],
    ['criado', cru(instanteLocal(marca.criada_em))], ['atualizado', cru(instanteLocal(atualizado))],
    ['tags', ['margem', 'margem/grifo', ...(marca.funcao === 'nenhuma' ? [] : [`margem/${tag(marca.funcao)}`]),
      ...(marca.origem === 'manual' ? [] : ['margem/ia']),
      ...categorias.map((categoria) => (categoria === 'sem_categoria' ? 'margem/dificuldade' : `margem/dificuldade/${categoria}`)),
      ...etiquetas.map(tagsDaEtiqueta)]],
  ]);
  const corpo: string[] = [linhaDeLocal(contexto, marca.ancora), calloutDoTrecho(contexto, marca.ancora, 'trecho', true)];
  if (nota !== undefined) {
    corpo.push(`## ${SUA_NOTA}`, markdownDoLeitor(nota.texto));
    if (nota.revisao !== undefined) corpo.push('*(revista pelo Codex)*');
  }
  if (marca.comentario) {
    const tipo = TIPOS_DE_COMENTARIO[marca.comentario.tipo] ?? rotuloDaChave(marca.comentario.tipo.toLowerCase());
    const cabeca = marca.comentario.rotulo.trim() === '' ? tipo : `${tipo} — ${umaLinha(marca.comentario.rotulo)}`;
    const [primeira = '', ...resto] = escaparMarkdown(marca.comentario.texto).split('\n');
    corpo.push('## Comentário do Codex', [`*${cabeca}:* ${primeira}`.trimEnd(), ...resto].join('\n'));
  }
  const lista = (titulo: string, linhas: string[]) => (linhas.length === 0 ? '' : `## ${titulo}\n\n${linhas.join('\n')}`);
  corpo.push(lista('Dificuldades', dificuldades.map((d) => linhaDaDificuldade(d,
    mesmaFaixa(d.ancora, marca.ancora) ? null : `«${umaLinha(resumir(d.ancora.citacao, 70))}»`))));
  corpo.push(lista('Perguntas', relacionadas.conversas.map((conversa) => `- ${link(nomes.get(conversa.id) ?? '', primeiraPergunta(conversa, 90))}`)));
  corpo.push(lista('Relações', relacionadas.conexoes.map((conexao) => {
    const daqui = mesmaFaixa(conexao.origem, marca.ancora);
    const outra = daqui ? resumoDoDestino(contexto, conexao) : `«${resumir(conexao.origem.citacao, 60)}»`;
    const familia = ROTULOS_DA_RELACAO[conexao.relacao];
    return `- ${daqui ? '→' : '←'} ${link(nomeDaRelacao(conexao, entrada.destinos), `${familia}: ${outra}`)}`;
  })));
  corpo.push(lista('Notas antigas', relacionadas.antigas.map((antiga) => `- ${link(nomes.get(antiga.id) ?? '', rotuloDaAnotacao(antiga))}`)));
  return { id: marca.id, tipo: 'grifo', documento_id: entrada.documento.id, caminho: caminhoDe(contexto.nomeDoIndice, { tipo: 'grifo', id: marca.id, nome }),
    conteudo: montarNota(cabecalho, corpo), atualizado_em: atualizado };
}

/** Rótulo de uma anotação em links e listas: o começo do texto (a nota do grifo não tem tipo; a antiga leva o dela). */
function rotuloDaAnotacao(nota: AnotacaoV1): string {
  const texto = resumir(nota.texto, 70);
  if (nota.marca_id !== undefined) return texto || 'Nota';
  const tipo = TIPOS_DE_NOTA[nota.tipo];
  return tipo === '' ? texto || 'Nota antiga' : `${tipo} — ${texto}`;
}

function primeiraPergunta(conversa: ConversaV2, limite: number): string {
  const primeira = conversa.mensagens.find((mensagem) => mensagem.autor === 'leitor') ?? conversa.mensagens[0];
  return resumir(primeira?.texto ?? 'Pergunta', limite) || 'Pergunta';
}

function resumoDoDestino(contexto: Contexto, conexao: ConexaoV3): string {
  const d = conexao.destino;
  if (d.tipo === 'trecho') return `«${resumir(d.ancora.citacao, 60)}»`;
  if (d.tipo === 'documento') return contexto.entrada.destinos[d.documento_id]?.titulo ?? 'outro documento';
  return d.titulo;
}

/**
 * Nota em Anotações/: a nota antiga, solta (sem grifo; só leitura no Margem), com o tipo que ela tinha;
 * ou a nota de um grifo que esta exportação não leva (rejeitado, ou grifos fora do `incluir`).
 */
function notaDaAnotacao(contexto: Contexto, nota: AnotacaoV1, nome: string): NotaDoObsidianV2 {
  const { entrada } = contexto;
  const antiga = nota.marca_id === undefined;
  const marca = (antiga ? undefined : entrada.marcas.find((m) => m.id === nota.marca_id)) ?? contexto.marcasPorFaixa(nota.ancora);
  const notaDoGrifo = marca === undefined ? undefined : contexto.notaDaMarca.get(marca.id);
  const etiquetas = contexto.etiquetasDe(nota.id);
  const cabecalho = frontmatter([
    ['margem_esquema', ESQUEMA_DO_OBSIDIAN], ['margem_tipo', 'anotacao'], ['margem_id', nota.id],
    ...campos(contexto, nota.ancora),
    ['nota_antiga', antiga ? true : undefined],
    ['anotacao_tipo', antiga ? nota.tipo : undefined],
    ['grifo', notaDoGrifo === undefined ? undefined : `[[${alvoDeLink(notaDoGrifo)}]]`],
    ...(antiga && nota.tipo === 'fonte' ? [
      ['fonte_titulo', nota.fonte.titulo], ['fonte_url', nota.fonte.url], ['fonte_pagina', nota.fonte.pagina],
    ] as [string, Valor | undefined][] : []),
    ['revisada_pelo_codex', nota.revisao === undefined ? undefined : true],
    ['etiquetas', etiquetas.length === 0 ? undefined : etiquetas],
    ['criado', cru(instanteLocal(nota.criada_em))], ['atualizado', cru(instanteLocal(nota.atualizada_em))],
    ['tags', ['margem', 'margem/anotacao', ...(antiga ? ['margem/nota_antiga'] : []), ...etiquetas.map(tagsDaEtiqueta)]],
  ]);
  const tipo = antiga ? TIPOS_DE_NOTA[nota.tipo] : '';
  const corpo = [linhaDeLocal(contexto, nota.ancora), calloutDoTrecho(contexto, nota.ancora, 'trecho'),
    antiga ? `**Nota antiga**${tipo === '' ? '' : ` · ${tipo}`}. *De antes das notas nos grifos; no Margem, só leitura.*` : `## ${SUA_NOTA}`,
    markdownDoLeitor(nota.texto)];
  if (antiga && nota.tipo === 'fonte') {
    const { titulo, url, pagina: paginaDaFonte } = nota.fonte;
    const referencia = url !== undefined && /^https?:\/\/[^\s()<>]+$/.test(url) ? `[${umaLinha(titulo)}](${url})` : umaLinha(titulo);
    corpo.push(`— ${referencia}${paginaDaFonte === undefined || paginaDaFonte.trim() === '' ? '' : `, p. ${umaLinha(paginaDaFonte)}`}`);
  }
  return { id: nota.id, tipo: 'anotacao', documento_id: entrada.documento.id, caminho: caminhoDe(contexto.nomeDoIndice, { tipo: 'anotacao', id: nota.id, nome }),
    conteudo: montarNota(cabecalho, corpo), atualizado_em: maisRecente([nota.criada_em, nota.atualizada_em]) };
}

function notaDaPergunta(contexto: Contexto, conversa: ConversaV2, nome: string): NotaDoObsidianV2 {
  const { entrada } = contexto;
  const marca = (conversa.marca_id === undefined ? undefined : entrada.marcas.find((m) => m.id === conversa.marca_id)) ?? contexto.marcasPorFaixa(conversa.ancora);
  const notaDoGrifo = marca === undefined ? undefined : contexto.notaDaMarca.get(marca.id);
  const anotacao = conversa.anotacao_id === undefined ? undefined : contexto.linkDaAnotacao.get(conversa.anotacao_id);
  const atualizado = maisRecente([conversa.criada_em, ...conversa.mensagens.map((m) => m.criada_em)]);
  const cabecalho = frontmatter([
    ['margem_esquema', ESQUEMA_DO_OBSIDIAN], ['margem_tipo', 'pergunta'], ['margem_id', conversa.id],
    ...campos(contexto, conversa.ancora),
    ['estado', conversa.estado],
    ['grifo', notaDoGrifo === undefined ? undefined : `[[${alvoDeLink(notaDoGrifo)}]]`],
    ['anotacao', anotacao],
    ['criado', cru(instanteLocal(conversa.criada_em))], ['atualizado', cru(instanteLocal(atualizado))],
    ['tags', ['margem', 'margem/pergunta']],
  ]);
  const corpo = [linhaDeLocal(contexto, conversa.ancora), calloutDoTrecho(contexto, conversa.ancora, 'trecho')];
  for (const mensagem of conversa.mensagens) {
    corpo.push(`### ${mensagem.autor === 'leitor' ? 'Pergunta' : 'Resposta'}`, markdownDoLeitor(mensagem.texto));
    if (mensagem.autor === 'ia' && mensagem.citacoes.length > 0) {
      corpo.push(mensagem.citacoes.map((citacao) => {
        const citada = contexto.marcasPorFaixa(citacao);
        const nota = citada === undefined ? undefined : contexto.notaDaMarca.get(citada.id);
        const texto = `«${umaLinha(citacao.citacao, 140)}»`;
        return `- ${nota === undefined ? `${texto} ([abrir no Margem](${urlDoTrecho(contexto, citacao)}))` : `${texto} — ${link(nota)}`}`;
      }).join('\n'));
    }
  }
  if (conversa.estado === 'arquivada') corpo.push('*(conversa arquivada)*');
  return { id: conversa.id, tipo: 'pergunta', documento_id: entrada.documento.id, caminho: caminhoDe(contexto.nomeDoIndice, { tipo: 'pergunta', id: conversa.id, nome }),
    conteudo: montarNota(cabecalho, corpo), atualizado_em: atualizado };
}

/** Uma ponta de relação: a nota do grifo dela (desta versão ou de outra) e um rótulo curto. */
function ponta(contexto: Contexto, ancora: AncoraV1): Ponta {
  const marca = contexto.marcasPorFaixa(ancora);
  const nota = marca === undefined ? null : contexto.notaDaMarca.get(marca.id) ?? null;
  const rotulo = marca === undefined || marca.funcao === 'nenhuma' ? resumir(ancora.citacao, 40) : contexto.rotuloDaFuncao(marca);
  return { nota, rotulo };
}

function notaDaRelacao(contexto: Contexto, conexao: ConexaoV3, nome: string): NotaDoObsidianV2 {
  const { entrada } = contexto;
  const origem = ponta(contexto, conexao.origem);
  const d = conexao.destino;
  const destinoTrecho = d.tipo === 'trecho' ? ponta(contexto, d.ancora) : null;
  let destinoLink: string;
  if (d.tipo === 'trecho') {
    destinoLink = destinoTrecho?.nota != null ? `[[${alvoDeLink(destinoTrecho.nota)}]]`
      : d.ancora.versao_id === entrada.versao_id ? `[[${alvoDeLink(contexto.nomeDoIndice)}]]`
        : entrada.destinos[d.ancora.versao_id] ? `[[${alvoDeLink(nomeDoArquivo(entrada.destinos[d.ancora.versao_id]!.titulo, entrada.destinos[d.ancora.versao_id]!.documento_id).slice(0, -3))}]]` : urlDoTrecho(contexto, d.ancora);
  } else if (d.tipo === 'documento') {
    const outro = entrada.destinos[d.documento_id];
    destinoLink = outro ? `[[${alvoDeLink(nomeDoArquivo(outro.titulo, outro.documento_id).slice(0, -3))}]]` : `${entrada.url_base}/documentos/${d.documento_id}`;
  } else {
    destinoLink = `[[${alvoDeLink(d.caminho.replace(/\.md$/i, ''))}]]`;
  }
  const familia = ROTULOS_DA_RELACAO[conexao.relacao];
  const semantica = conexao.relacao_semantica;
  const atualizado = conexao.decidida_em ?? conexao.criada_em;
  const cabecalho = frontmatter([
    ['margem_esquema', ESQUEMA_DO_OBSIDIAN], ['margem_tipo', 'relacao'], ['margem_id', conexao.id],
    ...campos(contexto, conexao.origem),
    ['relacao', conexao.relacao], ['relacao_rotulo', familia],
    ['relacao_semantica', semantica], ['relacao_semantica_rotulo', semantica === undefined ? undefined : ROTULOS_DA_RELACAO_SEMANTICA[semantica]],
    ['autoria', conexao.autor], ['estado', conexao.estado],
    ['origem', origem.nota === null ? `[[${alvoDeLink(contexto.nomeDoIndice)}]]` : `[[${alvoDeLink(origem.nota)}]]`],
    ['destino', destinoLink],
    ['destino_tipo', d.tipo],
    ['justificativa', conexao.justificativa.trim() === '' ? undefined : conexao.justificativa],
    ['criado', cru(instanteLocal(conexao.criada_em))], ['atualizado', cru(instanteLocal(atualizado))],
    ['tags', ['margem', 'margem/relacao', `margem/relacao/${conexao.relacao}`, ...(conexao.autor === 'ia' ? ['margem/ia'] : [])]],
  ]);
  const tipoFino = semantica === undefined || FAMILIA_DA_RELACAO_SEMANTICA[semantica] !== conexao.relacao ? '' : ` (${ROTULOS_DA_RELACAO_SEMANTICA[semantica].toLowerCase()})`;
  const corpo = [
    `**${familia}**${tipoFino}: ${origem.nota === null ? umaLinha(origem.rotulo) : link(origem.nota, origem.rotulo)} → ${
      d.tipo === 'trecho' ? (destinoTrecho?.nota != null ? link(destinoTrecho.nota, destinoTrecho.rotulo) : umaLinha(destinoTrecho?.rotulo ?? ''))
        : d.tipo === 'documento' ? destinoLink : link(d.caminho.replace(/\.md$/i, ''), d.titulo)}`,
    '## Origem', linhaDeLocal(contexto, conexao.origem), calloutDoTrecho(contexto, conexao.origem, 'origem'),
    ...(conexao.justificativa.trim() === '' ? [] : ['## Por quê', markdownDoLeitor(conexao.justificativa)]),
    '## Destino',
  ];
  if (d.tipo === 'trecho') corpo.push(linhaDeLocal(contexto, d.ancora), calloutDoTrecho(contexto, d.ancora, 'destino'));
  else if (d.tipo === 'documento') corpo.push(entrada.destinos[d.documento_id] ? `O documento ${destinoLink}.` : `Outro documento do Margem: [abrir no Margem](${destinoLink}).`);
  else corpo.push(`A nota ${link(d.caminho.replace(/\.md$/i, ''), d.titulo)}.`);
  return { id: conexao.id, tipo: 'relacao', documento_id: entrada.documento.id, caminho: caminhoDe(contexto.nomeDoIndice, { tipo: 'relacao', id: conexao.id, nome }),
    conteudo: montarNota(cabecalho, corpo), atualizado_em: atualizado };
}

function notaDoCartao(contexto: Contexto, cartao: CartaoDaExportacao, nome: string): NotaDoObsidianV2 {
  const { entrada } = contexto;
  const cabecalho = frontmatter([
    ['margem_esquema', ESQUEMA_DO_OBSIDIAN], ['margem_tipo', 'flashcard'], ['margem_id', cartao.id],
    ...campos(contexto, cartao.ancora),
    ['autoria', cartao.origem === 'manual' ? 'leitor' : 'ia'],
    ['criado', cru(instanteLocal(cartao.criado_em))], ['atualizado', cru(instanteLocal(cartao.atualizado_em))],
    // `flashcards` é a tag que o plugin Spaced Repetition procura (o baralho).
    ['tags', ['margem', 'margem/flashcard', 'flashcards']],
  ]);
  // Cartão de várias linhas do Spaced Repetition: a frente, uma linha com `?` e o verso.
  const corpo = [linhaDeLocal(contexto, cartao.ancora), calloutDoTrecho(contexto, cartao.ancora, 'trecho'),
    `${markdownDoLeitor(cartao.frente)}\n?\n${markdownDoLeitor(cartao.verso)}`];
  return { id: cartao.id, tipo: 'flashcard', documento_id: entrada.documento.id, caminho: caminhoDe(contexto.nomeDoIndice, { tipo: 'flashcard', id: cartao.id, nome }),
    conteudo: montarNota(cabecalho, corpo), atualizado_em: maisRecente([cartao.criado_em, cartao.atualizado_em]) };
}

function nomeDoExercicio(resolucao: ResolucaoV2): string {
  const numero = resolucao.exercicio?.numero.trim();
  const enunciado = resolucao.resolucao?.enunciado ?? resolucao.texto_extraido;
  return nomeDaNota(numero ? `Exercício ${numero} — ${primeirasPalavras(enunciado, 40)}` : enunciado, resolucao.id, 'Exercício');
}

function notaDoExercicio(contexto: Contexto, resolucao: ResolucaoV2, nome: string): NotaDoObsidianV2 {
  const { entrada } = contexto;
  const gerada = resolucao.resolucao!;
  const ancora = resolucao.origem.tipo === 'trecho' ? resolucao.origem.ancora : null;
  const atualizado = maisRecente([resolucao.criada_em, ...resolucao.mensagens.map((m) => m.criada_em)]);
  const cabecalho = frontmatter([
    ['margem_esquema', ESQUEMA_DO_OBSIDIAN], ['margem_tipo', 'exercicio'], ['margem_id', resolucao.id],
    ...(ancora === null ? [
      ['margem_documento', `[[${alvoDeLink(contexto.nomeDoIndice)}]]`], ['documento', entrada.documento.titulo], ['documento_id', entrada.documento.id],
      ['autor', entrada.documento.autor ?? undefined], ['versao_id', resolucao.versao_id],
      ['pagina', resolucao.origem.tipo === 'recorte' ? String(resolucao.origem.pagina) : undefined],
    ] as [string, Valor | undefined][] : campos(contexto, ancora)),
    ['exercicio', resolucao.exercicio?.numero], ['capitulo_do_livro', resolucao.exercicio?.capitulo ?? undefined],
    ['secao_do_livro', resolucao.exercicio?.secao ?? undefined],
    ['conceitos', gerada.conceitos.length === 0 ? undefined : gerada.conceitos],
    ['criado', cru(instanteLocal(resolucao.criada_em))], ['atualizado', cru(instanteLocal(atualizado))],
    ['tags', ['margem', 'margem/exercicio']],
  ]);
  const corpo = [ancora === null ? link(contexto.nomeDoIndice) : linhaDeLocal(contexto, ancora), '## Enunciado', markdownDoLeitor(gerada.enunciado)];
  for (const item of gerada.itens) {
    corpo.push(`## ${item.rotulo.trim() === '' ? 'Resolução' : `Item ${umaLinha(item.rotulo)}`}`);
    if (item.rotulo.trim() !== '' && item.enunciado.trim() !== '') corpo.push(markdownDoLeitor(item.enunciado));
    if (item.estrategia.trim() !== '') corpo.push(`**Estratégia.** ${markdownDoLeitor(item.estrategia)}`);
    corpo.push(item.passos.map((passo, indice) => [`${String(indice + 1)}. ${markdownDoLeitor(passo.texto).replace(/\n/g, '\n   ')}`,
      ...(passo.calculo === null || passo.calculo.trim() === '' ? [] : [`   $$${passo.calculo.replace(/\$\$/g, '')}$$`])].join('\n')).join('\n'));
    corpo.push(`**Resposta.** ${markdownDoLeitor(item.resposta)}`);
    if (item.verificacao !== null && item.verificacao.trim() !== '') corpo.push(`**Verificação.** ${markdownDoLeitor(item.verificacao)}`);
  }
  if (gerada.observacao !== null && gerada.observacao.trim() !== '') corpo.push(`*${umaLinha(gerada.observacao)}*`);
  if (resolucao.mensagens.length > 0) {
    corpo.push('## Perguntas');
    for (const mensagem of resolucao.mensagens) corpo.push(`### ${mensagem.autor === 'leitor' ? 'Pergunta' : 'Resposta'}`, markdownDoLeitor(mensagem.texto));
  }
  return { id: resolucao.id, tipo: 'exercicio', documento_id: entrada.documento.id, caminho: caminhoDe(contexto.nomeDoIndice, { tipo: 'exercicio', id: resolucao.id, nome }),
    conteudo: montarNota(cabecalho, corpo), atualizado_em: atualizado };
}

// ------------------------------------------------------------------ nota-índice

function linhaDoItemNoIndice(contexto: Contexto, item: Item, nomes: ReadonlyMap<Id, string>, absorvidas: ReadonlyMap<Id, string>,
  conexoesDoItem: readonly ConexaoV3[]): string {
  const { entrada } = contexto;
  const paginaTexto = paginaDoBloco(contexto.blocos.get(item.ancora.bloco_id));
  const sufixo = (bloco: string) => ` ${bloco}`;
  const linhas: string[] = [];
  const citacao = resumir(item.ancora.citacao, 70);
  if (item.marca) {
    const rotulo = item.marca.funcao === 'nenhuma' ? 'Trecho' : contexto.rotuloDaFuncao(item.marca);
    linhas.push(`- ${link(nomes.get(item.marca.id) ?? '', `${rotulo} — ${citacao}`)}${paginaTexto === null ? '' : ` · ${paginaTexto}`}${sufixo(item.bloco)}`);
  } else {
    // Trecho sem marca (aberto por uma nota, pergunta ou relação): a linha guarda o bloco da V1 e cita o trecho.
    linhas.push(`- «${umaLinha(citacao)}»${paginaTexto === null ? '' : ` · ${paginaTexto}`} · [abrir no Margem](${urlDoTrecho(contexto, item.ancora)})${sufixo(item.bloco)}`);
  }
  // A nota do leitor guarda o bloco `^margem-<id>` dela: agora a linha aponta para a seção "Sua nota" do grifo.
  for (const nota of item.notas) {
    const doGrifo = absorvidas.get(nota.id);
    const rotulo = alvoDeLink(rotuloDaAnotacao(nota)).replace(/\s+/g, ' ');
    const alvo = doGrifo === undefined ? link(nomes.get(nota.id) ?? '', rotuloDaAnotacao(nota)) : `[[${alvoDeLink(doGrifo)}#${SUA_NOTA}|${rotulo}]]`;
    const titulo = doGrifo !== undefined ? SUA_NOTA : nota.marca_id === undefined ? 'Nota antiga' : 'Nota';
    linhas.push(`\t- ${titulo}: ${alvo} ${blocoDeId(nota.id)}`);
  }
  for (const conversa of item.conversas) linhas.push(`\t- Pergunta: ${link(nomes.get(conversa.id) ?? '', primeiraPergunta(conversa, 90))} ${blocoDeId(conversa.id)}`);
  for (const conexao of conexoesDoItem) {
    const daqui = mesmaFaixa(conexao.origem, item.ancora);
    const outra = daqui ? resumoDoDestino(contexto, conexao) : `«${resumir(conexao.origem.citacao, 60)}»`;
    linhas.push(`\t- Relação: ${daqui ? '→' : '←'} ${link(nomeDaRelacao(conexao, entrada.destinos), `${ROTULOS_DA_RELACAO[conexao.relacao]}: ${outra}`)}`);
  }
  return linhas.join('\n');
}

// ------------------------------------------------------------------ exportação

export function exportarParaObsidianV2(entrada: EntradaDaExportacaoV2): ExportacaoDoDocumentoV2 {
  const { documento } = entrada;
  const nomeDoIndice = entrada.nome ?? nomeDoArquivo(documento.titulo, documento.id).slice(0, -3);
  const indiceDoBloco = new Map(entrada.blocos.map((bloco, indice) => [bloco.id, indice]));
  const blocos = new Map(entrada.blocos.map((bloco) => [bloco.id, bloco]));
  const capitulos = [...entrada.secoes].filter((secao) => secao.nivel === 1).sort((a, b) => a.ordem - b.ordem)
    .map((secao) => ({ secao, inicio: indiceDoBloco.get(secao.bloco_inicio) ?? -1, fim: indiceDoBloco.get(secao.bloco_fim) ?? -2 }));
  const capituloDoIndice = (indice: number) => capitulos.find((capitulo) => indice >= capitulo.inicio && indice <= capitulo.fim)?.secao;
  const naVersao = (ancora: AncoraV1) => ancora.versao_id === entrada.versao_id && indiceDoBloco.has(ancora.bloco_id);

  const etiquetas = new Map<Id, string[]>();
  for (const etiqueta of [...entrada.etiquetas].sort(porCriacao)) {
    if (DIFICULDADES.has(etiqueta.nome.toLowerCase())) continue;
    const lista = etiquetas.get(etiqueta.alvo.id) ?? [];
    if (!lista.includes(etiqueta.nome)) lista.push(etiqueta.nome);
    etiquetas.set(etiqueta.alvo.id, lista);
  }

  const marcas = [...entrada.marcas].filter((marca) => naVersao(marca.ancora)).sort(porId);
  const anotacoes = [...entrada.anotacoes].filter((nota) => naVersao(nota.ancora)).sort(porCriacao);
  // Modelo D: a nota do leitor (a primeira, por criação, ligada a cada grifo exportado) vai dentro da nota
  // do grifo. As outras (antigas e soltas, ou de um grifo que não foi exportado) têm nota própria em Anotações/.
  const idsDasMarcas = new Set(marcas.map((marca) => marca.id));
  const notaDoLeitor = new Map<Id, AnotacaoV1>();
  for (const nota of anotacoes) {
    if (nota.marca_id !== undefined && idsDasMarcas.has(nota.marca_id) && !notaDoLeitor.has(nota.marca_id)) notaDoLeitor.set(nota.marca_id, nota);
  }
  const dentroDoGrifo = new Set([...notaDoLeitor.values()].map((nota) => nota.id));
  const avulsas = anotacoes.filter((nota) => !dentroDoGrifo.has(nota.id));
  const posicao = (ancora: AncoraV1) => [indiceDoBloco.get(ancora.bloco_id) ?? 0, ancora.inicio_utf16, ancora.fim_utf16] as const;
  const dificuldades = [...entrada.dificuldades].filter((d) => d.estado !== 'descartada' && naVersao(d.ancora)).sort((a, b) => {
    const [pa, pb] = [posicao(a.ancora), posicao(b.ancora)];
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2] || porId(a, b);
  });
  const conversas = [...entrada.conversas].filter((conversa) => naVersao(conversa.ancora) && conversa.mensagens.length > 0).sort(porCriacao);
  const conexoes = [...entrada.conexoes].filter((conexao) => conexao.estado === 'aceita'
    && (naVersao(conexao.origem) || (conexao.destino.tipo === 'trecho' && naVersao(conexao.destino.ancora)))).sort(porCriacao);
  const daqui = conexoes.filter((conexao) => naVersao(conexao.origem));
  const cartoes = [...entrada.flashcards].filter((cartao) => naVersao(cartao.ancora)).sort(porId);
  const resolucoes = [...entrada.resolucoes].filter((resolucao) => resolucao.resolucao !== null).sort(porId);

  // Nomes: determinísticos; colisão (sem distinguir maiúsculas) ganha mais caracteres do id.
  const nomes = new Map<Id, string>();
  const usados = new Set<string>();
  const reservar = (id: Id, nome: string) => {
    let final = nome;
    if (usados.has(final.toLowerCase())) final = `${nome.slice(0, nome.lastIndexOf(' · '))} · ${id.toLowerCase()}`;
    usados.add(final.toLowerCase());
    nomes.set(id, final);
  };
  const rotuloDaFuncao = (marca: { funcao: string; modo: { id: string; revisao: number } }) =>
    entrada.funcoes[chaveDaFuncao(marca.modo, marca.funcao)]?.rotulo ?? rotuloDaChave(marca.funcao);
  for (const marca of marcas) {
    const rotulo = marca.funcao === 'nenhuma' ? '' : `${rotuloDaFuncao(marca)} — `;
    reservar(marca.id, nomeDaNota(`${rotulo}${marca.ancora.citacao}`, marca.id, 'Grifo'));
  }
  for (const nota of avulsas) reservar(nota.id, nomeDaNota(nota.texto, nota.id, 'Anotação'));
  for (const conversa of conversas) reservar(conversa.id, nomeDaNota(primeiraPergunta(conversa, 200), conversa.id, 'Pergunta'));
  for (const conexao of daqui) reservar(conexao.id, nomeDaRelacao(conexao, entrada.destinos));
  for (const cartao of cartoes) reservar(cartao.id, nomeDaNota(cartao.frente, cartao.id, 'Flashcard'));
  for (const resolucao of resolucoes) reservar(resolucao.id, nomeDoExercicio(resolucao));

  const notaDaMarca = new Map<Id, string>();
  for (const marca of marcas) notaDaMarca.set(marca.id, nomes.get(marca.id) ?? '');
  for (const externa of entrada.marcas_externas) {
    const rotulo = externa.funcao === 'nenhuma' ? '' : `${rotuloDaFuncao(externa)} — `;
    notaDaMarca.set(externa.id, nomeDaNota(`${rotulo}${externa.ancora.citacao}`, externa.id, 'Grifo'));
  }
  // A primeira marca de cada faixa (por id): a que dá nome e link ao trecho.
  const faixa = (ancora: AncoraV1) => `${ancora.versao_id}|${ancora.bloco_id}|${String(ancora.inicio_utf16)}|${String(ancora.fim_utf16)}`;
  const porFaixa = new Map<string, MarcaV2 | MarcaExterna>();
  for (const marca of [...marcas, ...[...entrada.marcas_externas].sort(porId)]) if (!porFaixa.has(faixa(marca.ancora))) porFaixa.set(faixa(marca.ancora), marca);
  const absorvidas = new Map<Id, string>();
  for (const [marcaId, nota] of notaDoLeitor) absorvidas.set(nota.id, notaDaMarca.get(marcaId) ?? '');
  const linkDaAnotacao = new Map<Id, string>();
  for (const nota of avulsas) linkDaAnotacao.set(nota.id, `[[${alvoDeLink(nomes.get(nota.id) ?? '')}]]`);
  for (const [notaId, grifo] of absorvidas) linkDaAnotacao.set(notaId, `[[${alvoDeLink(grifo)}#${SUA_NOTA}]]`);
  const contexto: Contexto = {
    entrada, nomeDoIndice, blocos, indiceDoBloco,
    capituloDoBloco: (blocoId) => capituloDoIndice(indiceDoBloco.get(blocoId) ?? -1),
    etiquetasDe: (alvo) => etiquetas.get(alvo) ?? [],
    dificuldadesDe: (marcaId) => dificuldades.filter((d) => d.marca_id === marcaId),
    linkDaAnotacao,
    notaDaMarca,
    marcasPorFaixa: (ancora) => porFaixa.get(faixa(ancora)),
    rotuloDaFuncao,
  };

  // Notas de item.
  const notas: NotaDoObsidianV2[] = [];
  for (const marca of marcas) {
    const relacionadas: Relacionadas = {
      nota: notaDoLeitor.get(marca.id),
      antigas: avulsas.filter((nota) => nota.marca_id === undefined && mesmaFaixa(nota.ancora, marca.ancora)),
      conversas: conversas.filter((conversa) => conversa.marca_id === marca.id || (conversa.marca_id === undefined && mesmaFaixa(conversa.ancora, marca.ancora))),
      conexoes: conexoes.filter((conexao) => mesmaFaixa(conexao.origem, marca.ancora)
        || (conexao.destino.tipo === 'trecho' && mesmaFaixa(conexao.destino.ancora, marca.ancora))),
    };
    notas.push(notaDoGrifo(contexto, marca, nomes.get(marca.id) ?? '', relacionadas, nomes));
  }
  for (const nota of avulsas) notas.push(notaDaAnotacao(contexto, nota, nomes.get(nota.id) ?? ''));
  for (const conversa of conversas) notas.push(notaDaPergunta(contexto, conversa, nomes.get(conversa.id) ?? ''));
  for (const conexao of daqui) notas.push(notaDaRelacao(contexto, conexao, nomes.get(conexao.id) ?? ''));
  for (const cartao of cartoes) notas.push(notaDoCartao(contexto, cartao, nomes.get(cartao.id) ?? ''));
  for (const resolucao of resolucoes) notas.push(notaDoExercicio(contexto, resolucao, nomes.get(resolucao.id) ?? ''));

  // Nota-índice: a mesma organização da V1 (um item por trecho, na ordem do texto), cada linha com o
  // bloco `^margem-<id>` que a V1 tinha, agora apontando para a nota do item.
  const itens = montarItens({ versao_id: entrada.versao_id, marcas, anotacoes, conversas, conexoes: daqui }, indiceDoBloco);
  const conexoesNoItem = (item: Item) => conexoes.filter((conexao) => mesmaFaixa(conexao.origem, item.ancora)
    || (conexao.destino.tipo === 'trecho' && mesmaFaixa(conexao.destino.ancora, item.ancora)));
  const secoes: string[] = [];
  let atual: Secao | null | undefined;
  for (const item of itens) {
    const capitulo = capituloDoIndice(item.indiceDoBloco) ?? null;
    if (atual === undefined || capitulo?.id !== atual?.id) {
      secoes.push(`## ${capitulo === null ? 'Fora dos capítulos' : umaLinha(capitulo.titulo) || 'Sem título'}`);
      atual = capitulo;
    }
    secoes.push(linhaDoItemNoIndice(contexto, item, nomes, absorvidas, conexoesNoItem(item)));
  }
  // Relações cujo destino está aqui e cuja origem está noutro documento, sem item próprio neste.
  const deFora = conexoes.filter((conexao) => !naVersao(conexao.origem) && conexao.destino.tipo === 'trecho'
    && !itens.some((item) => conexao.destino.tipo === 'trecho' && mesmaFaixa(item.ancora, conexao.destino.ancora)));
  if (deFora.length > 0) {
    secoes.push('## Relações vindas de outros documentos', deFora.map((conexao) =>
      `- ← ${link(nomeDaRelacao(conexao, entrada.destinos), `${ROTULOS_DA_RELACAO[conexao.relacao]}: «${resumir(conexao.origem.citacao, 60)}»`)}`).join('\n'));
  }
  // Os sinais de dificuldade (do leitor e os do Codex que ele não descartou), na ordem do texto.
  if (dificuldades.length > 0) {
    secoes.push('## Dificuldades', dificuldades.map((d) => {
      const grifo = d.marca_id === undefined ? undefined : notaDaMarca.get(d.marca_id);
      const onde = grifo === undefined ? `[abrir no Margem](${urlDoTrecho(contexto, d.ancora)})` : link(grifo, 'grifo');
      return linhaDaDificuldade(d, `«${umaLinha(resumir(d.ancora.citacao, 70))}» (${onde})`);
    }).join('\n'));
  }
  const listaDe = (tipo: 'flashcard' | 'exercicio', titulo: string) => {
    const daquelas = notas.filter((nota) => nota.tipo === tipo);
    if (daquelas.length > 0) secoes.push(`## ${titulo}`, daquelas.map((nota) => `- ${link(nomes.get(nota.id) ?? '')}`).join('\n'));
  };
  listaDe('flashcard', 'Flashcards');
  listaDe('exercicio', 'Exercícios');

  const instantes = [documento.criado_em, ...notas.map((nota) => nota.atualizado_em), ...dificuldades.map((d) => d.atualizada_em)];
  const atualizadoEm = maisRecente(instantes);
  const urlDoDocumento = `${entrada.url_base}/documentos/${documento.id}`;
  const contagem = (tipo: TipoDeNotaDoObsidian) => notas.filter((nota) => nota.tipo === tipo).length;
  const cabecalho = frontmatter([
    ['titulo', documento.titulo],
    ['autor', documento.autor === null || documento.autor.trim() === '' ? undefined : documento.autor],
    ['fonte', documento.fonte_url ?? urlDoDocumento],
    ['formato', documento.formato],
    ['margem_esquema', ESQUEMA_DO_OBSIDIAN], ['margem_tipo', 'documento'],
    ['margem_id', documento.id], ['margem_versao', entrada.versao_id], ['margem_url', urlDoDocumento],
    ['data', cru(dataLocal(documento.criado_em))], ['atualizado', cru(dataLocal(atualizadoEm))],
    ['contagens', {
      grifos: contagem('grifo'), notas: notaDoLeitor.size, anotacoes: contagem('anotacao'), perguntas: contagem('pergunta'),
      relacoes: contagem('relacao'), dificuldades: dificuldades.length, flashcards: contagem('flashcard'), exercicios: contagem('exercicio'),
    }],
    ['tags', ['margem']],
  ]);
  const topo = [
    `# ${umaLinha(documento.titulo) || 'Sem título'}`,
    [...(documento.autor === null || documento.autor.trim() === '' ? [] : [umaLinha(documento.autor)]), `[abrir no Margem](${urlDoDocumento})`].join(' · '),
  ].join('\n\n');
  const corpo = secoes.length === 0 ? ['*Nenhuma marca, nota ou pergunta neste documento ainda.*'] : secoes;
  const indice: NotaDoObsidianV2 = {
    id: documento.id, tipo: 'documento', documento_id: documento.id, caminho: `${nomeDoIndice}/${nomeDoIndice}.md`,
    conteudo: montarNota(cabecalho, [topo, ...corpo]), atualizado_em: atualizadoEm,
  };
  const ordemDoTipo: TipoDeNotaDoObsidian[] = ['grifo', 'anotacao', 'pergunta', 'relacao', 'flashcard', 'exercicio'];
  notas.sort((a, b) => ordemDoTipo.indexOf(a.tipo) - ordemDoTipo.indexOf(b.tipo) || (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  return { nome: nomeDoIndice, notas: [indice, ...notas], itens: itens.length, atualizado_em: atualizadoEm };
}
