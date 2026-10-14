/**
 * Apagar em lote, por documento ou por capítulo (V-T8): "a análise do Codex" e "tudo meu", separados.
 *
 * Antes de apagar, a página mostra a contagem do que vai sair (`contarApagaveis`), com as mesmas regras
 * do apagamento: o que se conta é o que se apaga.
 *
 * Do Codex: grifos e comentários da leitura (marcas das execuções), relações, dificuldades, plano,
 * visita e leitura comentada (a compreensão inteira), flashcards criados pelo Codex, imagens e
 * fluxogramas, mapas, resoluções de exercícios, popups do vídeo, sugestões de conexão ainda não aceitas
 * e o tipo de texto que ele reconheceu (não o escolhido pela pessoa). O que estava na fila ou rodando é
 * cancelado antes. A análise apagada pode ser feita de novo do zero. As decisões do leitor sobre as
 * dificuldades que o Codex apontou saem com elas; a nota e os sinais que o leitor pôs num grifo do Codex
 * saem com o grifo (modelo D: a nota é do grifo), e a contagem avisa quando há.
 *
 * Do leitor: os grifos (com as notas), as notas, os sinais de dificuldade que ele marcou, as conexões (as
 * dele e as sugestões que ele aceitou) e os flashcards que ele escreveu.
 *
 * Exclusão real, como o resto do repositório (só o visual tem `apagado_em`, e continua assim): a
 * exportação para o Obsidian e a página de notas nunca veem o que foi apagado.
 */
import type { Id } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { obterVersao } from '../repos/documentos.js';
import { cancelarOperacoes } from './cancelar.js';
import { apagarExecucao, apagarJobs, apagarMarcas, itensApagados, ligarApagamento, purgarCapitulo, semApagados } from './compreensao.js';
import type { ModeloDoCapituloV1 } from '@margem/contratos';

export type Quem = 'codex' | 'leitor';

export interface ItemApagavel { chave: string; rotulo: string; singular: string; total: number }
export interface Apagaveis { codex: ItemApagavel[]; leitor: ItemApagavel[] }

export class CapituloInexistente extends Error {
  constructor() { super('O capítulo não existe na versão atual do documento.'); this.name = 'CapituloInexistente'; }
}

interface Escopo {
  documento_id: Id;
  /** Todas as versões do documento (o lote vale para todas). */
  versoes: Id[];
  /** Com capítulo: a versão atual, o capítulo e os blocos dele. */
  capitulo: { versao_id: Id; secao_id: Id; blocos: Id[] } | null;
}

async function escopo(cliente: Transacao, documentoId: Id, secaoId?: Id): Promise<Escopo> {
  const versoes = (await cliente.query<{ id: Id }>('SELECT id FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC', [documentoId])).rows.map((l) => l.id);
  if (secaoId === undefined) return { documento_id: documentoId, versoes, capitulo: null };
  const atual = versoes[0];
  if (atual === undefined) throw new CapituloInexistente();
  const canonico = (await obterVersao(cliente, atual)).canonico;
  const secao = canonico.secoes.find((item) => item.id === secaoId && item.nivel === 1);
  if (!secao) throw new CapituloInexistente();
  const inicio = canonico.blocos.findIndex((bloco) => bloco.id === secao.bloco_inicio);
  const fim = canonico.blocos.findIndex((bloco) => bloco.id === secao.bloco_fim);
  return { documento_id: documentoId, versoes, capitulo: { versao_id: atual, secao_id: secaoId, blocos: canonico.blocos.slice(inicio, fim + 1).map((b) => b.id) } };
}

/** Versões e blocos do escopo, para os filtros SQL (`blocos` nulo = documento inteiro). */
function filtro(e: Escopo): { versoes: Id[]; blocos: Id[] | null } {
  return e.capitulo ? { versoes: [e.capitulo.versao_id], blocos: e.capitulo.blocos } : { versoes: e.versoes, blocos: null };
}

const n = async (cliente: Transacao, sql: string, valores: unknown[]): Promise<number> =>
  Number((await cliente.query<{ n: string | number }>(sql, valores)).rows[0]?.n ?? 0);

// ---------------------------------------------------------------- o que é de quem

async function execucoesDoCodex(cliente: Transacao, versoes: Id[]): Promise<Id[]> {
  return (await cliente.query<{ id: Id }>(`SELECT e.id FROM execucao_leitura e JOIN camada c ON c.id = e.id
    WHERE e.versao_id = ANY($1::text[]) AND c.tipo = 'execucao' ORDER BY e.criada_em`, [versoes])).rows.map((l) => l.id);
}

/** Marcas do Codex no escopo: as das execuções (camadas de leitura), não as importadas nem as do leitor. */
async function marcasDoCodex(cliente: Transacao, e: Escopo): Promise<{ id: Id; comentada: boolean }[]> {
  const { versoes, blocos } = filtro(e);
  return (await cliente.query<{ id: Id; comentada: boolean }>(`SELECT m.id, (m.comentario IS NOT NULL) AS comentada FROM marca m JOIN camada c ON c.id = m.camada_id
    WHERE m.versao_id = ANY($1::text[]) AND c.tipo = 'execucao' AND ($2::text[] IS NULL OR m.bloco_id = ANY($2::text[]))`, [versoes, blocos])).rows;
}

/** Relações e dificuldades vivas (a última revisão de cada capítulo, sem os itens apagados). */
async function itensDosModelos(cliente: Transacao, e: Escopo): Promise<{ relacoes: number; dificuldades: number }> {
  const { versoes } = filtro(e);
  const linhas = (await cliente.query<{ execucao_id: Id; secao_id: Id; conteudo: ModeloDoCapituloV1 }>(`SELECT DISTINCT ON (m.execucao_id, m.secao_id)
      m.execucao_id, m.secao_id, m.conteudo FROM modelo_capitulo m JOIN execucao_leitura x ON x.id = m.execucao_id
    WHERE x.versao_id = ANY($1::text[]) AND ($2::text IS NULL OR m.secao_id = $2) ORDER BY m.execucao_id, m.secao_id, m.revisao DESC`,
  [versoes, e.capitulo?.secao_id ?? null])).rows;
  let relacoes = 0;
  let dificuldades = 0;
  for (const linha of linhas) {
    const vivo = semApagados(linha.conteudo, await itensApagados(cliente, linha.execucao_id, linha.secao_id));
    relacoes += vivo.relacoes.length;
    dificuldades += vivo.dificuldades.length;
  }
  return { relacoes, dificuldades };
}

const DO_CODEX_NO_CAPITULO = `($2::text IS NULL OR secao_id = $2)`;

export async function contarApagaveis(cliente: Transacao, documentoId: Id, secaoId?: Id): Promise<Apagaveis> {
  const e = await escopo(cliente, documentoId, secaoId);
  const { versoes, blocos } = filtro(e);
  const secao = e.capitulo?.secao_id ?? null;
  const marcas = await marcasDoCodex(cliente, e);
  const { relacoes, dificuldades } = await itensDosModelos(cliente, e);
  const idsDoCodex = marcas.map((m) => m.id);
  const doLeitorNosGrifos = await n(cliente, `SELECT (SELECT count(*) FROM anotacao WHERE marca_id = ANY($1::text[]) AND fundida_em IS NULL)
      + (SELECT count(*) FROM dificuldade WHERE marca_id = ANY($1::text[]) AND origem='leitor') AS n`, [idsDoCodex]);
  const documentoInteiro = e.capitulo === null;
  const codex: ItemApagavel[] = [
    { chave: 'grifos', rotulo: 'grifos', singular: 'grifo', total: marcas.length },
    { chave: 'comentarios', rotulo: 'comentários nos grifos', singular: 'comentário nos grifos', total: marcas.filter((m) => m.comentada).length },
    { chave: 'relacoes', rotulo: 'relações', singular: 'relação', total: relacoes },
    { chave: 'dificuldades', rotulo: 'dificuldades apontadas', singular: 'dificuldade apontada', total: dificuldades },
    { chave: 'flashcards', rotulo: 'flashcards', singular: 'flashcard', total: await n(cliente, `SELECT count(*) AS n FROM flashcard WHERE versao_id = ANY($1::text[]) AND origem='ia' AND ${DO_CODEX_NO_CAPITULO}`, [versoes, secao]) },
    { chave: 'visuais', rotulo: 'imagens e fluxogramas', singular: 'imagem ou fluxograma', total: await n(cliente, `SELECT count(*) AS n FROM visual WHERE versao_id = ANY($1::text[]) AND apagado_em IS NULL AND ${DO_CODEX_NO_CAPITULO}`, [versoes, secao]) },
    { chave: 'mapas', rotulo: 'mapas', singular: 'mapa', total: await n(cliente, `SELECT count(*) AS n FROM job j JOIN execucao_leitura x ON x.id = split_part(j.dedup_key, ':', 2)
        WHERE j.tipo='gerar_esquema' AND j.estado='ok' AND x.versao_id = ANY($1::text[]) AND ($2::text IS NULL OR split_part(j.dedup_key, ':', 3) = $2)`, [versoes, secao]) },
    { chave: 'visitas', rotulo: 'visitas guiadas e leituras comentadas', singular: 'visita guiada ou leitura comentada', total: await n(cliente, `SELECT (SELECT count(*) FROM roteiro_visita WHERE versao_id = ANY($1::text[]) AND ${DO_CODEX_NO_CAPITULO})
        + (SELECT count(*) FROM leitura_comentada WHERE versao_id = ANY($1::text[]) AND ${DO_CODEX_NO_CAPITULO}) AS n`, [versoes, secao]) },
    { chave: 'sugestoes', rotulo: 'sugestões de conexão', singular: 'sugestão de conexão', total: await n(cliente, `SELECT count(*) AS n FROM conexao WHERE versao_id = ANY($1::text[]) AND autor='ia' AND estado<>'aceita'
        AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))`, [versoes, blocos]) },
    ...(documentoInteiro ? [
      { chave: 'resolucoes', rotulo: 'resoluções de exercícios', singular: 'resolução de exercício', total: await n(cliente, 'SELECT count(*) AS n FROM resolucao WHERE documento_id=$1', [documentoId]) },
      { chave: 'popups', rotulo: 'popups do vídeo', singular: 'popup do vídeo', total: await n(cliente, 'SELECT count(*) AS n FROM conceitos_video WHERE versao_id = ANY($1::text[])', [versoes]) },
      { chave: 'tipo', rotulo: 'tipo de texto reconhecido', singular: 'tipo de texto reconhecido', total: await n(cliente, `SELECT count(*) AS n FROM documento WHERE id=$1 AND tipo_de_texto IS NOT NULL
          AND coalesce(tipo_de_texto->>'origem', '') <> 'escolhido'`, [documentoId]) },
    ] : []),
    { chave: 'do_leitor_nos_grifos', rotulo: 'notas e dificuldades suas nesses grifos', singular: 'nota ou dificuldade sua nesses grifos', total: doLeitorNosGrifos },
    { chave: 'em_andamento', rotulo: 'pedidos na fila ou em andamento', singular: 'pedido na fila ou em andamento', total: await n(cliente, `SELECT count(*) AS n FROM job WHERE documento_id=$1
        AND estado IN ('fila','adiado','reservado') AND NOT (tipo = ANY($2::text[]))`, [documentoId, ['canonizar', 'canonizar_revisao', 'importar_youtube']]) },
  ];
  const leitor: ItemApagavel[] = [
    { chave: 'grifos', rotulo: 'grifos seus', singular: 'grifo seu', total: await n(cliente, `SELECT count(*) AS n FROM marca m JOIN camada c ON c.id = m.camada_id
        WHERE m.versao_id = ANY($1::text[]) AND c.tipo = 'leitor' AND ($2::text[] IS NULL OR m.bloco_id = ANY($2::text[]))`, [versoes, blocos]) },
    { chave: 'notas', rotulo: 'notas', singular: 'nota', total: await n(cliente, 'SELECT count(*) AS n FROM anotacao WHERE versao_id = ANY($1::text[]) AND fundida_em IS NULL AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))', [versoes, blocos]) },
    { chave: 'dificuldades', rotulo: 'dificuldades marcadas', singular: 'dificuldade marcada', total: await n(cliente, `SELECT count(*) AS n FROM dificuldade WHERE versao_id = ANY($1::text[]) AND origem='leitor'
        AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))`, [versoes, blocos]) },
    { chave: 'conexoes', rotulo: 'conexões', singular: 'conexão', total: await n(cliente, `SELECT count(*) AS n FROM conexao WHERE versao_id = ANY($1::text[]) AND (autor='leitor' OR estado='aceita')
        AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))`, [versoes, blocos]) },
    { chave: 'flashcards', rotulo: 'flashcards seus', singular: 'flashcard seu', total: await n(cliente, `SELECT count(*) AS n FROM flashcard WHERE versao_id = ANY($1::text[]) AND origem='manual' AND ${DO_CODEX_NO_CAPITULO}`, [versoes, secao]) },
  ];
  // "Em andamento" e o que é do leitor nos grifos do Codex só aparecem quando há algo; as outras linhas
  // sempre (zero também diz algo).
  return { codex: codex.filter((item) => (item.chave !== 'em_andamento' && item.chave !== 'do_leitor_nos_grifos') || item.total > 0), leitor };
}

/** Quantos itens o lote apagou, pela mesma chave da contagem. */
export type Apagados = Record<string, number>;

export async function apagarDoCodex(cliente: Transacao, documentoId: Id, secaoId?: Id): Promise<Apagados> {
  const antes = await contarApagaveis(cliente, documentoId, secaoId);
  // O que estava na fila ou rodando para (e o processo do Codex morre) antes de apagar.
  await cancelarOperacoes(cliente, { documento_id: documentoId, ...(secaoId === undefined ? {} : { secao_id: secaoId }) });
  await ligarApagamento(cliente);
  const e = await escopo(cliente, documentoId, secaoId);
  const { versoes, blocos } = filtro(e);
  const secao = e.capitulo?.secao_id ?? null;
  const execucoes = await execucoesDoCodex(cliente, versoes);
  if (e.capitulo) {
    for (const execucao of execucoes) await purgarCapitulo(cliente, execucao, e.capitulo.secao_id);
    // Leituras antigas (F1/V2) não têm capítulo na chave: as marcas delas no capítulo saem uma a uma.
    await apagarMarcas(cliente, (await marcasDoCodex(cliente, e)).map((m) => m.id));
  } else {
    for (const execucao of execucoes) await apagarExecucao(cliente, execucao);
  }
  // Flashcards do Codex (com as revisões, em cascata) e os jobs que os criaram.
  const jobsDosCartoes = (await cliente.query<{ id: Id }>(`SELECT id FROM job WHERE split_part(dedup_key, ':', 1)='flashcards'
    AND split_part(dedup_key, ':', 2) = ANY($1::text[]) AND ($2::text IS NULL OR split_part(dedup_key, ':', 3) = $2)`, [versoes, secao])).rows.map((l) => l.id);
  await cliente.query(`DELETE FROM flashcard WHERE versao_id = ANY($1::text[]) AND origem='ia' AND ${DO_CODEX_NO_CAPITULO}`, [versoes, secao]);
  await apagarJobs(cliente, jobsDosCartoes);
  // Visuais: o padrão do repositório é `apagado_em` (o arquivo por hash pode servir a outro visual).
  await cliente.query(`UPDATE visual SET apagado_em=clock_timestamp() WHERE versao_id = ANY($1::text[]) AND apagado_em IS NULL AND ${DO_CODEX_NO_CAPITULO}`, [versoes, secao]);
  // Mapas que sobraram de execuções que ficam (no capítulo, a purga já os levou).
  const mapas = (await cliente.query<{ id: Id }>(`SELECT j.id FROM job j JOIN execucao_leitura x ON x.id = split_part(j.dedup_key, ':', 2)
    WHERE j.tipo='gerar_esquema' AND x.versao_id = ANY($1::text[]) AND ($2::text IS NULL OR split_part(j.dedup_key, ':', 3) = $2)`, [versoes, secao])).rows.map((l) => l.id);
  await apagarJobs(cliente, mapas);
  await cliente.query(`DELETE FROM conexao WHERE versao_id = ANY($1::text[]) AND autor='ia' AND estado<>'aceita' AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))`, [versoes, blocos]);
  // Decisões sobre dificuldades do Codex que sobraram (as do capítulo já saíram com a análise).
  await cliente.query(`DELETE FROM dificuldade WHERE versao_id = ANY($1::text[]) AND origem='codex' AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))`, [versoes, blocos]);
  if (!e.capitulo) {
    const sessoes = (await cliente.query<{ id: Id }>('SELECT id FROM resolucao WHERE documento_id=$1', [documentoId])).rows.map((l) => l.id);
    const jobsDasSessoes = (await cliente.query<{ id: Id }>(`SELECT id FROM job WHERE split_part(dedup_key, ':', 1) IN ('resolver','explicar')
      AND split_part(dedup_key, ':', 2) = ANY($1::text[])`, [sessoes])).rows.map((l) => l.id);
    await cliente.query('DELETE FROM resolucao WHERE documento_id=$1', [documentoId]);
    await apagarJobs(cliente, jobsDasSessoes);
    const popups = (await cliente.query<{ job_id: Id }>('DELETE FROM conceitos_video WHERE versao_id = ANY($1::text[]) RETURNING job_id', [versoes])).rows.map((l) => l.job_id);
    await apagarJobs(cliente, popups);
    // O tipo reconhecido pelo Codex sai e a identificação pode rodar de novo; o escolhido pela pessoa fica.
    const tipo = await cliente.query(`UPDATE documento SET tipo_de_texto=NULL WHERE id=$1 AND tipo_de_texto IS NOT NULL
      AND coalesce(tipo_de_texto->>'origem', '') <> 'escolhido'`, [documentoId]);
    if ((tipo.rowCount ?? 0) > 0) {
      const identificacoes = (await cliente.query<{ id: Id }>(`SELECT id FROM job WHERE tipo='identificar_tipo' AND versao_id = ANY($1::text[])`, [versoes])).rows.map((l) => l.id);
      await apagarJobs(cliente, identificacoes);
    }
  }
  return Object.fromEntries(antes.codex.map((item) => [item.chave, item.total]));
}

export async function apagarDoLeitor(cliente: Transacao, documentoId: Id, secaoId?: Id): Promise<Apagados> {
  const antes = await contarApagaveis(cliente, documentoId, secaoId);
  await ligarApagamento(cliente);
  const e = await escopo(cliente, documentoId, secaoId);
  const { versoes, blocos } = filtro(e);
  const secao = e.capitulo?.secao_id ?? null;
  const grifos = (await cliente.query<{ id: Id }>(`SELECT m.id FROM marca m JOIN camada c ON c.id = m.camada_id
    WHERE m.versao_id = ANY($1::text[]) AND c.tipo = 'leitor' AND ($2::text[] IS NULL OR m.bloco_id = ANY($2::text[]))`, [versoes, blocos])).rows.map((l) => l.id);
  await apagarMarcas(cliente, grifos);
  await cliente.query('DELETE FROM anotacao WHERE versao_id = ANY($1::text[]) AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[])) AND fundida_em IS NOT NULL', [versoes, blocos]);
  await cliente.query('DELETE FROM anotacao WHERE versao_id = ANY($1::text[]) AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))', [versoes, blocos]);
  await cliente.query(`DELETE FROM dificuldade WHERE versao_id = ANY($1::text[]) AND origem='leitor' AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))`, [versoes, blocos]);
  const conexoes = (await cliente.query<{ id: Id }>(`SELECT id FROM conexao WHERE versao_id = ANY($1::text[]) AND (autor='leitor' OR estado='aceita')
    AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))`, [versoes, blocos])).rows.map((l) => l.id);
  await cliente.query('DELETE FROM relacao_adotada WHERE conexao_id = ANY($1::text[])', [conexoes]);
  await cliente.query('DELETE FROM conexao WHERE id = ANY($1::text[])', [conexoes]);
  await cliente.query(`DELETE FROM flashcard WHERE versao_id = ANY($1::text[]) AND origem='manual' AND ${DO_CODEX_NO_CAPITULO}`, [versoes, secao]);
  return Object.fromEntries(antes.leitor.map((item) => [item.chave, item.total]));
}
