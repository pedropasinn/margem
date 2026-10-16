/**
 * R2-4 · Contexto textual do agente quando o Codex roda sem ferramentas (padrão no Windows, S-04).
 *
 * Sem ferramentas o modelo não abre a pasta `biblioteca/`: o serviço escolhe os trechos e os põe no
 * próprio prompt, com limite de tamanho. A escolha usa o que já existe no banco:
 *
 * 1. Documentos citados pela pessoa: o título (ou o autor) aparece na pergunta, ou o documento foi
 *    citado nas últimas respostas do fio (a pergunta seguinte costuma falar "dele").
 * 2. Capítulos pedidos: o título do capítulo aparece na pergunta, ou "capítulo N" de um documento citado.
 *    Esses entram inteiros (até o teto por capítulo).
 * 3. A busca no texto (`bloco.busca`, tsvector do idioma de cada bloco, o mesmo da busca da biblioteca):
 *    as palavras da pergunta, com qualquer uma delas bastando, ordenadas pela relevância; blocos dos
 *    documentos citados valem o dobro. Cada achado leva um bloco vizinho de cada lado.
 * 4. Sobrando espaço, o começo dos documentos citados (para "resuma este livro").
 *
 * Cada trecho sai como no export (`⟦b:<bloco_id>⟧ [tipo] texto`), agrupado por documento e capítulo,
 * com a `versao_id` e o `secao_id`, para o modelo citar como faria lendo os arquivos.
 */
import type { EntradaDoSumarioSugerido, Id, MensagemDoAgenteV1 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

/** Teto do contexto inteiro (índice + trechos), em caracteres (~30 mil tokens). */
export const LIMITE_DO_CONTEXTO = 120_000;
/** Teto do índice da biblioteca dentro do contexto. */
export const LIMITE_DO_INDICE = 20_000;
/** Teto de um capítulo pedido pelo nome. */
export const LIMITE_POR_CAPITULO = 50_000;
/** Teto de um bloco (um bloco enorme não ocupa o contexto sozinho). */
export const LIMITE_POR_BLOCO = 4_000;
/** Quantos blocos a busca traz, no máximo. */
export const ACHADOS_DA_BUSCA = 60;
/** Quantas mensagens do fio contam para "documento citado". */
const MENSAGENS_RECENTES = 4;

interface DocumentoDoIndice {
  documento_id: Id; versao_id: Id; titulo: string; autor: string | null; formato: string;
  /**
   * R3-7: os títulos trazem o número do capítulo ("1. …", "Capítulo 3", "Chapter IV"). Então `numero` é esse
   * número (e `null` no prefácio e nas folhas sem número); sem nenhum título numerado, é a posição no índice.
   */
  numerada: boolean;
  capitulos: { secao_id: Id; titulo: string; numero: number | null; inicio: number; fim: number }[];
}
interface BlocoDoContexto { versao_id: Id; ordem: number; id: Id; tipo: string; texto: string }

export interface ContextoDaPergunta {
  texto: string;
  /** Documentos e blocos que entraram (para o registro e os testes). */
  documentos: number;
  blocos: number;
  /** Algum trecho escolhido ficou de fora pelo limite. */
  cortado: boolean;
}

const normalizar = (texto: string): string => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ');

/** Palavras da pergunta para a busca: letras e dígitos, 3+ caracteres, sem repetir, no máximo 16. */
export function termosDaPergunta(pergunta: string): string[] {
  const vistos = new Set<string>();
  for (const palavra of pergunta.match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    const minuscula = palavra.toLowerCase();
    if (minuscula === 'or') continue;
    vistos.add(minuscula);
    if (vistos.size >= 16) break;
  }
  return [...vistos];
}

async function indiceDaBiblioteca(cliente: Transacao): Promise<DocumentoDoIndice[]> {
  const documentos = (await cliente.query<{ documento_id: Id; versao_id: Id; titulo: string; autor: string | null; formato: string }>(`
    SELECT d.id AS documento_id, v.id AS versao_id, d.titulo, d.autor, d.formato
    FROM documento d JOIN LATERAL (SELECT id FROM versao_texto WHERE documento_id=d.id ORDER BY numero DESC LIMIT 1) v ON true
    WHERE d.arquivado_em IS NULL ORDER BY d.criado_em, d.id`)).rows;
  if (documentos.length === 0) return [];
  const versoes = documentos.map((documento) => documento.versao_id);
  const secoes = (await cliente.query<{ versao_id: Id; secao_id: Id; titulo: string; nivel: number; bloco_inicio: Id; inicio: string; fim: string }>(`
    SELECT s.versao_id, s.id AS secao_id, s.titulo, s.nivel, s.bloco_inicio, bi.ordem::text AS inicio, bf.ordem::text AS fim
    FROM secao s
    JOIN bloco bi ON bi.versao_id=s.versao_id AND bi.id=s.bloco_inicio
    JOIN bloco bf ON bf.versao_id=s.versao_id AND bf.id=s.bloco_fim
    WHERE s.versao_id = ANY($1::text[]) ORDER BY s.versao_id, s.ordem`, [versoes])).rows;
  // R3-7: com o sumário sugerido em uso, os capítulos e os títulos são os que a pessoa vê (mesmas seções).
  const sugestoes = new Map((await cliente.query<{ versao_id: Id; proposta: EntradaDoSumarioSugerido[] | null }>(
    `SELECT versao_id, resposta->'proposta' AS proposta FROM conferencia_sumario WHERE estado='aplicada' AND versao_id = ANY($1::text[])`,
    [versoes])).rows.map((linha) => [linha.versao_id, linha.proposta]));
  const porVersao = new Map<Id, typeof secoes>();
  for (const secao of secoes) porVersao.set(secao.versao_id, [...(porVersao.get(secao.versao_id) ?? []), secao]);
  return documentos.map((documento) => {
    const todas = porVersao.get(documento.versao_id) ?? [];
    const canonicos = todas.filter((secao) => secao.nivel === 1).map((secao) => ({ secao, titulo: secao.titulo }));
    const proposta = sugestoes.get(documento.versao_id);
    const porInicio = new Map(todas.map((secao) => [secao.bloco_inicio, secao]));
    const sugeridos = Array.isArray(proposta) ? proposta.filter((entrada) => entrada.nivel === 1)
      .map((entrada) => ({ secao: porInicio.get(entrada.bloco_inicio), titulo: entrada.titulo })) : null;
    const apresentados = sugeridos !== null && sugeridos.every((item) => item.secao !== undefined)
      ? sugeridos as { secao: (typeof todas)[number]; titulo: string }[] : canonicos;
    const editoriais = apresentados.map((item) => numeroNoTitulo(item.titulo));
    const numerada = editoriais.some((numero) => numero !== null);
    return { ...documento, numerada, capitulos: apresentados.map((item, indice) => ({
      secao_id: item.secao.secao_id, titulo: item.titulo, numero: numerada ? editoriais[indice]! : indice + 1,
      inicio: Number(item.secao.inicio), fim: Number(item.secao.fim),
    })) };
  });
}

const ROMANOS: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function romano(texto: string): number | null {
  let total = 0;
  for (let i = 0; i < texto.length; i++) {
    const valor = ROMANOS[texto[i]!]; const seguinte = ROMANOS[texto[i + 1] ?? ''] ?? 0;
    if (valor === undefined) return null;
    total += valor < seguinte ? -valor : valor;
  }
  return total > 0 && total < 400 ? total : null;
}

/** R3-7: o número editorial no começo do título: "1. …", "2 Party…", "Capítulo 3", "Chapter IV", "IV. …". */
export function numeroNoTitulo(titulo: string): number | null {
  const texto = normalizar(titulo).trim();
  const prefixo = String.raw`(?:capitulo|cap\.?|chapter|chap\.?)\s*`;
  const arabico = new RegExp(String.raw`^(?:${prefixo})?(\d{1,3})(?!\d)(?![\d.,]\d)`, 'u').exec(texto);
  if (arabico) return Number(arabico[1]);
  const comPrefixo = new RegExp(String.raw`^${prefixo}([ivxlc]+)\b`, 'u').exec(texto);
  const solto = /^([ivxlc]+)[.):]\s/u.exec(texto);
  const achado = comPrefixo?.[1] ?? solto?.[1];
  return achado === undefined ? null : romano(achado);
}

function indiceEmTexto(documentos: readonly DocumentoDoIndice[]): { texto: string; cortado: boolean } {
  const linhas: string[] = [];
  let tamanho = 0;
  for (const [indice, documento] of documentos.entries()) {
    const deste = [`- ${documento.titulo}${documento.autor ? ` — ${documento.autor}` : ''} · documento_id ${documento.documento_id} · versao_id ${documento.versao_id} · ${documento.formato}`];
    // Com títulos numerados, o título já diz o número; a posição no índice só confundiria com prefácios.
    for (const capitulo of documento.capitulos) deste.push(`  - ${documento.numerada ? '' : `${String(capitulo.numero)}. `}${capitulo.titulo} · secao_id ${capitulo.secao_id}`);
    const texto = deste.join('\n');
    if (tamanho + texto.length > LIMITE_DO_INDICE) {
      linhas.push(`(mais ${String(documentos.length - indice)} documento(s) fora do índice, pelo tamanho)`);
      return { texto: linhas.join('\n'), cortado: true };
    }
    linhas.push(texto);
    tamanho += texto.length + 1;
  }
  return { texto: linhas.join('\n'), cortado: false };
}

/** Documentos que a pessoa nomeou na pergunta ou que o fio vinha citando. */
function documentosCitados(documentos: readonly DocumentoDoIndice[], pergunta: string, anteriores: readonly Pick<MensagemDoAgenteV1, 'citacoes'>[]): Set<Id> {
  const texto = normalizar(pergunta);
  const citados = new Set<Id>();
  for (const documento of documentos) {
    const titulo = normalizar(documento.titulo).trim();
    const autor = documento.autor === null ? '' : normalizar(documento.autor).trim();
    if ((titulo.length >= 4 && texto.includes(titulo)) || (autor.length >= 4 && texto.includes(autor))) citados.add(documento.documento_id);
  }
  for (const mensagem of anteriores.slice(-MENSAGENS_RECENTES)) for (const citacao of mensagem.citacoes) citados.add(citacao.documento_id);
  // Biblioteca de um documento só: é dele que se fala.
  if (documentos.length === 1) citados.add(documentos[0]!.documento_id);
  return citados;
}

/**
 * Capítulos pedidos: o título aparece na pergunta, ou "capítulo N" de um documento citado. R3-7: N é o
 * número editorial dos títulos (ou a posição, sem título numerado); dois capítulos com o mesmo N (partes
 * que recomeçam a contagem) é ambíguo, e nenhum entra pelo número: a busca e o índice ficam com o modelo.
 */
function capitulosPedidos(documentos: readonly DocumentoDoIndice[], citados: ReadonlySet<Id>, pergunta: string): { documento: DocumentoDoIndice; capitulo: DocumentoDoIndice['capitulos'][number] }[] {
  const texto = normalizar(pergunta);
  const numeros = new Set([...texto.matchAll(/cap(?:itulo|\.)?\s*(\d{1,3})/gu)].map((achado) => Number(achado[1])));
  const pedidos: { documento: DocumentoDoIndice; capitulo: DocumentoDoIndice['capitulos'][number] }[] = [];
  for (const documento of documentos) {
    const comNumero = new Map<number, number>();
    for (const capitulo of documento.capitulos) if (capitulo.numero !== null) comNumero.set(capitulo.numero, (comNumero.get(capitulo.numero) ?? 0) + 1);
    for (const capitulo of documento.capitulos) {
      const titulo = normalizar(capitulo.titulo).trim();
      const peloTitulo = titulo.length >= 6 && texto.includes(titulo);
      const peloNumero = citados.has(documento.documento_id) && capitulo.numero !== null && numeros.has(capitulo.numero)
        && comNumero.get(capitulo.numero) === 1;
      if (peloTitulo || peloNumero) pedidos.push({ documento, capitulo });
    }
  }
  return pedidos;
}

async function blocosEntre(cliente: Transacao, versaoId: Id, inicio: number, fim: number): Promise<BlocoDoContexto[]> {
  return (await cliente.query<{ ordem: string; id: Id; tipo: string; texto: string }>(
    'SELECT ordem::text, id, tipo, texto FROM bloco WHERE versao_id=$1 AND ordem BETWEEN $2 AND $3 ORDER BY ordem', [versaoId, inicio, fim],
  )).rows.map((linha) => ({ versao_id: versaoId, ordem: Number(linha.ordem), id: linha.id, tipo: linha.tipo, texto: linha.texto }));
}

/** Os blocos mais relevantes para as palavras da pergunta, com um vizinho de cada lado. */
async function achadosDaBusca(cliente: Transacao, termos: readonly string[], citados: ReadonlySet<Id>): Promise<BlocoDoContexto[]> {
  if (termos.length === 0) return [];
  const consulta = termos.join(' or ');
  const achados = (await cliente.query<{ versao_id: Id; ordem: string }>(`
    WITH alvo AS (
      SELECT d.id AS documento_id, v.id AS versao_id FROM documento d
      JOIN LATERAL (SELECT id FROM versao_texto WHERE documento_id=d.id ORDER BY numero DESC LIMIT 1) v ON true
      WHERE d.arquivado_em IS NULL
    )
    SELECT a.versao_id, b.ordem::text,
      ts_rank(b.busca, websearch_to_tsquery(b.idioma_busca, $1)) * (CASE WHEN a.documento_id = ANY($2::text[]) THEN 2 ELSE 1 END) AS relevancia
    FROM alvo a JOIN bloco b ON b.versao_id=a.versao_id
    WHERE btrim(b.texto) <> '' AND (
         (b.idioma_busca='portuguese'::regconfig AND b.busca @@ websearch_to_tsquery('portuguese'::regconfig, $1))
      OR (b.idioma_busca='english'::regconfig AND b.busca @@ websearch_to_tsquery('english'::regconfig, $1))
      OR (b.idioma_busca='simple'::regconfig AND b.busca @@ websearch_to_tsquery('simple'::regconfig, $1)))
    ORDER BY relevancia DESC, a.versao_id, b.ordem LIMIT $3`, [consulta, [...citados], ACHADOS_DA_BUSCA])).rows;
  const blocos: BlocoDoContexto[] = [];
  for (const achado of achados) {
    const ordem = Number(achado.ordem);
    blocos.push(...await blocosEntre(cliente, achado.versao_id, Math.max(0, ordem - 1), ordem + 1));
  }
  return blocos;
}

function linhaDoBloco(bloco: BlocoDoContexto): string {
  const texto = bloco.texto.length > LIMITE_POR_BLOCO ? `${bloco.texto.slice(0, LIMITE_POR_BLOCO)} […]` : bloco.texto;
  return `⟦b:${bloco.id}⟧ [${bloco.tipo}] ${texto}`;
}

/** Os trechos escolhidos, agrupados por documento e capítulo, na ordem do texto. */
function trechosEmTexto(documentos: readonly DocumentoDoIndice[], blocos: readonly BlocoDoContexto[]): string {
  const porVersao = new Map(documentos.map((documento) => [documento.versao_id, documento]));
  const ordenados = [...blocos].sort((a, b) => a.versao_id.localeCompare(b.versao_id) || a.ordem - b.ordem);
  const saida: string[] = [];
  let grupo = '';
  let anterior: BlocoDoContexto | null = null;
  for (const bloco of ordenados) {
    const documento = porVersao.get(bloco.versao_id);
    if (!documento) continue;
    const capitulo = documento.capitulos.find((candidato) => bloco.ordem >= candidato.inicio && bloco.ordem <= candidato.fim) ?? null;
    const chave = `${bloco.versao_id}:${capitulo?.secao_id ?? '-'}`;
    if (chave !== grupo) {
      grupo = chave;
      const autor = documento.autor ? ` — ${documento.autor}` : '';
      const nome = capitulo === null ? 'fora dos capítulos'
        : documento.numerada || capitulo.numero === null ? capitulo.titulo : `capítulo ${String(capitulo.numero)}: ${capitulo.titulo}`;
      saida.push('', `### ${documento.titulo}${autor} · ${nome}`,
        `versao_id: ${documento.versao_id} · secao_id: ${capitulo?.secao_id ?? '(nenhum)'}`, '');
    } else if (anterior !== null && bloco.ordem > anterior.ordem + 1) {
      saida.push('[…]');
    }
    saida.push(linhaDoBloco(bloco));
    anterior = bloco;
  }
  return saida.join('\n').replace(/^\n/u, '');
}

/**
 * Monta o contexto da pergunta, até `limite` caracteres. A ordem de prioridade é a do cabeçalho do
 * arquivo: capítulos pedidos, achados da busca e o começo dos documentos citados.
 */
export async function contextoDaPergunta(
  cliente: Transacao, pergunta: string, anteriores: readonly Pick<MensagemDoAgenteV1, 'citacoes'>[], limite = LIMITE_DO_CONTEXTO,
): Promise<ContextoDaPergunta> {
  const documentos = await indiceDaBiblioteca(cliente);
  if (documentos.length === 0) return { texto: '(a biblioteca está vazia)', documentos: 0, blocos: 0, cortado: false };
  const indice = indiceEmTexto(documentos);
  const citados = documentosCitados(documentos, pergunta, anteriores);
  const escolhidos = new Map<string, BlocoDoContexto>();
  let usado = indice.texto.length;
  let cortado = indice.cortado;
  // Cabeçalhos de grupo e marcas de corte também ocupam: uma folga por bloco.
  const custo = (bloco: BlocoDoContexto): number => Math.min(bloco.texto.length, LIMITE_POR_BLOCO) + bloco.id.length + bloco.tipo.length + 40;
  const acrescentar = (bloco: BlocoDoContexto, teto = limite): boolean => {
    const chave = `${bloco.versao_id}:${String(bloco.ordem)}`;
    if (escolhidos.has(chave) || bloco.texto.trim() === '') return true;
    if (usado + custo(bloco) > teto) { cortado = true; return false; }
    escolhidos.set(chave, bloco);
    usado += custo(bloco);
    return true;
  };

  for (const { documento, capitulo } of capitulosPedidos(documentos, citados, pergunta)) {
    const teto = Math.min(limite, usado + LIMITE_POR_CAPITULO);
    for (const bloco of await blocosEntre(cliente, documento.versao_id, capitulo.inicio, capitulo.fim)) if (!acrescentar(bloco, teto)) break;
  }
  for (const bloco of await achadosDaBusca(cliente, termosDaPergunta(pergunta), citados)) acrescentar(bloco);
  const doComeco = documentos.filter((documento) => citados.has(documento.documento_id));
  for (const [indiceDoDocumento, documento] of doComeco.entries()) {
    if (usado >= limite) break;
    // Cada documento citado leva uma parte igual do que sobrou.
    const teto = usado + Math.floor((limite - usado) / (doComeco.length - indiceDoDocumento));
    let inicio = 0;
    let continuar = true;
    while (continuar) {
      const lote = await blocosEntre(cliente, documento.versao_id, inicio, inicio + 199);
      if (lote.length === 0) break;
      for (const bloco of lote) if (!acrescentar(bloco, teto)) { continuar = false; break; }
      inicio += 200;
    }
  }

  const blocos = [...escolhidos.values()];
  const trechos = blocos.length === 0
    ? '(nenhum trecho da biblioteca casou com a pergunta)'
    : trechosEmTexto(documentos, blocos);
  const texto = [
    '#### Índice da biblioteca',
    '',
    indice.texto,
    '',
    '#### Trechos escolhidos para esta pergunta',
    '',
    trechos,
    ...(cortado ? ['', '(Há mais texto relevante do que coube aqui; o que não veio não pôde ser lido.)'] : []),
  ].join('\n');
  return { texto, documentos: new Set(blocos.map((bloco) => bloco.versao_id)).size, blocos: blocos.length, cortado };
}
