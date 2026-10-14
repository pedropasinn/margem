import {
  aplicarLote as aplicarLoteContrato, conferirAncora, conferirMarcaNoModo, hashMarcas, marcaV1ParaV2, mesmoModo,
  validarCamadaEditorialV2, validarLoteRevisaoV2, validarMarca, validarMarcaV2,
  MODO_F1, type ConflitosDaCamada, type Id, type LoteRevisaoV2, type MarcaV1, type MarcaV2, type ReferenciaModo,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { modoOuNada } from '../modos.js';
import { bloquearVersao, obterVersao } from './documentos.js';
import * as camadasRepo from './camadas.js';
import { obter as obterExecucao } from './execucoes.js';

export class ConflitoEditorial extends Error {
  /** `pares` junta os pares de todas as camadas; `camadas` os separa por camada (0004). */
  readonly pares: [string, string][];
  constructor(public readonly camadas: ConflitosDaCamada[]) {
    const pares = camadas.flatMap((camada) => camada.pares);
    super(`Marcas editoriais sobrepostas: ${JSON.stringify(pares)}`); this.name = 'ConflitoEditorial';
    this.pares = pares;
  }
}

const OBJETO_V1 = `jsonb_build_object(
    'id',id,'ancora',jsonb_build_object('versao_id',versao_id,'bloco_id',bloco_id,
      'inicio_utf16',inicio_utf16,'fim_utf16',fim_utf16,'citacao',citacao,'prefixo',prefixo,'sufixo',sufixo),
    'funcao',funcao,'subfaixas',subfaixas,'comentario',comentario,'origem',origem,'validade',validade,
    'visivel',visivel,'avaliacao',avaliacao,'criada_em',criada_em_literal)
    || CASE WHEN execucao_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('execucao_id',execucao_id) END
    || CASE WHEN job_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('job_id',job_id) END`;
const OBJETO_V2 = `${OBJETO_V1} || jsonb_build_object('saliencia',saliencia,'camada_id',camada_id,
    'modo',jsonb_build_object('id',modo_id,'revisao',modo_revisao))`;
/**
 * O que a V1 representa (`marcaV2ParaV1`): modo `argumentativa@1`, saliência 2, função e
 * tipo de comentário do enum de F1, e origem que a V1 conhece (a `projecao` do J29 não). Os grifos do
 * leitor (J37) também não: não pertencem a execução nenhuma.
 * As outras marcas não existem para os consumidores V1.
 */
const REPRESENTAVEL_EM_V1 = `origem<>'projecao' AND modo_id='argumentativa' AND modo_revisao=1 AND saliencia=2
    AND camada_id NOT IN (SELECT id FROM camada WHERE tipo='leitor')
    AND funcao IN ('tese','conceito','justificativa','nenhuma')
    AND (comentario IS NULL OR comentario->>'tipo' IN ('AUTOR','LEITURA','INVESTIGAR','OBJECAO','CONEXAO'))`;

/**
 * Projeção V1 das marcas da versão (a `marcaV2ParaV1` de cada uma que a V1 representa).
 * É o conjunto sobre o qual `LoteRevisaoV2`, `revisao_marcas` e a web de F1 trabalham.
 */
export async function listarPorVersao(cliente: Transacao, versaoId: string): Promise<MarcaV1[]> {
  const resultado = await cliente.query<{ marca: MarcaV1 }>(`SELECT ${OBJETO_V1} AS marca
    FROM marca WHERE versao_id=$1 AND ${REPRESENTAVEL_EM_V1} ORDER BY id`, [versaoId]);
  return resultado.rows.map(linha => linha.marca);
}
/** Marcas da versão como `MarcaV2`, opcionalmente só as de uma camada. */
export async function listarV2PorVersao(cliente: Transacao, versaoId: Id, filtro: { camada_id?: Id } = {}): Promise<MarcaV2[]> {
  const resultado = await cliente.query<{ marca: MarcaV2 }>(`SELECT ${OBJETO_V2} AS marca
    FROM marca WHERE versao_id=$1 AND ($2::text IS NULL OR camada_id=$2) ORDER BY id`, [versaoId, filtro.camada_id ?? null]);
  return resultado.rows.map(linha => linha.marca);
}

async function conferirMarcas(cliente: Transacao, versaoId: string, marcas: MarcaV2[]): Promise<void> {
  const versao = await obterVersao(cliente, versaoId);
  const blocos = new Map(versao.canonico.blocos.map(bloco => [bloco.id, bloco]));
  const camadas = new Map((await camadasRepo.listar(cliente, versaoId)).map(camada => [camada.id, camada]));
  const execucoes = new Map((await cliente.query<{ id: Id; modo: ReferenciaModo }>(
    `SELECT id, jsonb_build_object('id',modo_id,'revisao',modo_revisao) AS modo FROM execucao_leitura WHERE versao_id=$1`,
    [versaoId])).rows.map(linha => [linha.id, linha.modo]));
  const ids = new Set<string>();
  for (const marca of marcas) {
    if (!validarMarcaV2(marca) || marca.ancora.versao_id !== versaoId || ids.has(marca.id)) throw new Error('Marca inválida, repetida ou de outra versão.');
    ids.add(marca.id);
    const bloco = blocos.get(marca.ancora.bloco_id);
    if (!bloco || (marca.validade === 'resolvida' && !conferirAncora(bloco, marca.ancora))) throw new Error('Âncora não confere no bloco da versão.');
    if (marca.execucao_id) {
      const modoDaExecucao = execucoes.get(marca.execucao_id);
      if (!modoDaExecucao) throw new Error('Execução de outra versão.');
      if (!mesmoModo(modoDaExecucao, marca.modo)) throw new Error('Marca com modo diferente do da execução.');
    }
    if (marca.job_id) {
      const job = (await cliente.query<{ versao_id: string | null; execucao_id: string | null }>(`SELECT j.versao_id,p.execucao_id
        FROM job j LEFT JOIN parte p ON p.id=j.parte_id WHERE j.id=$1`, [marca.job_id])).rows[0];
      if (!job || job.versao_id !== versaoId || (job.execucao_id && job.execucao_id !== marca.execucao_id)) throw new Error('Job incompatível com a marca.');
    }
    const camada = camadas.get(marca.camada_id);
    if (!camada) throw new Error('Camada inexistente nesta versão.');
    if (!mesmoModo(camada.modo, marca.modo)) throw new Error('Marca com modo diferente do da camada.');
    const modo = modoOuNada(marca.modo);
    if (!modo || !conferirMarcaNoModo(marca, modo)) throw new Error('Função ou comentário fora do modo da marca.');
  }
  // 0004: a não sobreposição editorial vale por camada.
  const conflitos = validarCamadaEditorialV2(marcas);
  if (conflitos.length) throw new ConflitoEditorial(conflitos);
}
async function inserir(cliente: Transacao, marca: MarcaV2): Promise<void> {
  const a = marca.ancora;
  await cliente.query(`INSERT INTO marca
    (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,funcao,subfaixas,comentario,
      origem,validade,visivel,avaliacao,execucao_id,job_id,criada_em,criada_em_literal,
      saliencia,camada_id,modo_id,modo_revisao)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::text::timestamptz,$18::text,$19,$20,$21,$22)`,
  [marca.id, a.versao_id, a.bloco_id, a.inicio_utf16, a.fim_utf16, a.citacao, a.prefixo, a.sufixo,
    marca.funcao, JSON.stringify(marca.subfaixas), marca.comentario === null ? null : JSON.stringify(marca.comentario),
    marca.origem, marca.validade, marca.visivel, marca.avaliacao, marca.execucao_id ?? null, marca.job_id ?? null, marca.criada_em,
    marca.saliencia, marca.camada_id, marca.modo.id, marca.modo.revisao]);
}
/** Publica `MarcaV2` já resolvidas, conferindo todas as marcas da versão camada a camada. */
export async function publicarMarcasV2(cliente: Transacao, versaoId: string, marcas: MarcaV2[]): Promise<void> {
  await bloquearVersao(cliente, versaoId);
  const atuais = await listarV2PorVersao(cliente, versaoId);
  await conferirMarcas(cliente, versaoId, [...atuais, ...marcas]);
  for (const marca of marcas) await inserir(cliente, marca);
}
/**
 * Recebe MarcaV1 já resolvida pelo J06. Usar dentro de jobs.publicar para resultados de worker.
 * Desde a 0004 vira `MarcaV2` por `marcaV1ParaV2`: camada = execução; as marcas sem
 * execução desta chamada formam um lote de importação novo (uma camada).
 */
export async function publicarMarcas(cliente: Transacao, versaoId: string, marcas: MarcaV1[]): Promise<void> {
  if (!marcas.every(marca => validarMarca(marca))) throw new Error('Marca inválida, repetida ou de outra versão.');
  let lote: Id | undefined;
  const v2: MarcaV2[] = [];
  for (const marca of marcas) {
    if (marca.execucao_id === undefined && lote === undefined) {
      lote = (await camadasRepo.criarLoteDeImportacao(cliente, versaoId, MODO_F1)).id;
    }
    v2.push(marcaV1ParaV2(marca, marca.execucao_id === undefined ? lote : undefined));
  }
  await publicarMarcasV2(cliente, versaoId, v2);
}
export type ResultadoLote = { estado: 'aplicado' | 'ja_aplicado' } | { estado: 'recusado'; motivo: string };
export async function aplicarLote(cliente: Transacao, lote: LoteRevisaoV2): Promise<ResultadoLote> {
  if (!validarLoteRevisaoV2(lote)) throw new Error('Lote de revisão inválido.');
  // Também serializa o mesmo ID quando dois pedidos apontam para versões distintas.
  await cliente.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 3003))', [lote.id]);
  if ((await cliente.query('SELECT id FROM lote_revisao WHERE id=$1', [lote.id])).rowCount) return { estado: 'ja_aplicado' };
  const execucao = await obterExecucao(cliente, lote.execucao_id);
  await bloquearVersao(cliente, execucao.versao_id);
  const recusado = (await cliente.query<{ motivo: string }>('SELECT motivo FROM lote_recusado WHERE id=$1', [lote.id])).rows[0];
  if (recusado) return { estado: 'recusado', motivo: recusado.motivo };
  const atuais = await listarPorVersao(cliente, execucao.versao_id);
  if (hashMarcas(atuais) !== lote.snapshot_base) throw new Error('Snapshot de marcas divergente.');
  for (const op of lote.operacoes) {
    const marca = atuais.find(marca => marca.id === op.marca_id);
    if (!marca || (marca.execucao_id && marca.execucao_id !== lote.execucao_id)) {
      throw new Error('Marca incompatível com a execução do lote.');
    }
  }
  if (lote.autor === 'codex') {
    const humanas = await cliente.query<{ marca_id: string }>(`SELECT DISTINCT r.marca_id FROM revisao_marca r
      JOIN lote_revisao l ON l.id=r.lote_id WHERE l.autor='leitor' AND r.op IN ('avaliar','mudar_visibilidade')
      AND r.marca_id=ANY($1::text[])`, [lote.operacoes.map(op => op.marca_id)]);
    if (humanas.rows.length) {
      const motivo = `Decisão humana protegida nas marcas: ${humanas.rows.map(linha => linha.marca_id).sort().join(', ')}`;
      await cliente.query('INSERT INTO lote_recusado(id,versao_id,lote,motivo) VALUES ($1,$2,$3,$4)',
        [lote.id, execucao.versao_id, JSON.stringify(lote), motivo]);
      // Resultado explícito, sem lançar: lançar aqui apagaria também o diagnóstico no rollback.
      return { estado: 'recusado', motivo };
    }
  }
  const novas = aplicarLoteContrato(atuais, lote);
  // A camada editorial final é conferida por camada, junto das marcas que a V1 não representa.
  const todasV2 = await listarV2PorVersao(cliente, execucao.versao_id);
  const camadaDe = new Map(todasV2.map(marca => [marca.id, marca.camada_id]));
  const representadas = new Set(atuais.map(marca => marca.id));
  await conferirMarcas(cliente, execucao.versao_id, [
    ...todasV2.filter(marca => !representadas.has(marca.id)),
    ...novas.map(marca => marcaV1ParaV2(marca, marca.execucao_id === undefined ? camadaDe.get(marca.id) : undefined)),
  ]);
  await cliente.query(`INSERT INTO lote_revisao(id,execucao_id,versao_id,snapshot_base,autor,motivo,operacoes)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [lote.id, lote.execucao_id, execucao.versao_id, lote.snapshot_base, lote.autor, lote.motivo_do_lote, JSON.stringify(lote.operacoes)]);
  for (const op of [...lote.operacoes].sort((a,b) => a.ordem - b.ordem)) {
    await cliente.query('INSERT INTO revisao_marca(lote_id,ordem,marca_id,op,antes,depois,motivo) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [lote.id, op.ordem, op.marca_id, op.op, JSON.stringify(op.antes), JSON.stringify(op.depois), op.motivo]);
  }
  const porId = new Map(novas.map(marca => [marca.id, marca]));
  for (const id of new Set(lote.operacoes.map(op => op.marca_id))) {
    const marca = porId.get(id);
    if (!marca) { await cliente.query('DELETE FROM marca WHERE id=$1', [id]); continue; }
    await cliente.query(`UPDATE marca SET funcao=$2,subfaixas=$3,comentario=$4,visivel=$5,avaliacao=$6,
      atualizada_em=clock_timestamp() WHERE id=$1`, [id, marca.funcao, JSON.stringify(marca.subfaixas),
      marca.comentario === null ? null : JSON.stringify(marca.comentario), marca.visivel, marca.avaliacao]);
  }
  return { estado: 'aplicado' };
}

// ------------------------------------------------------------------ J37: grifos do leitor e edições

/** As marcas da camada do leitor na versão (os grifos dele), em qualquer modo. */
export async function listarDoLeitor(cliente: Transacao, versaoId: Id): Promise<MarcaV2[]> {
  const resultado = await cliente.query<{ marca: MarcaV2 }>(`SELECT ${OBJETO_V2} AS marca FROM marca
    WHERE versao_id=$1 AND camada_id IN (SELECT id FROM camada WHERE versao_id=$1 AND tipo='leitor') ORDER BY id`, [versaoId]);
  return resultado.rows.map(linha => linha.marca);
}

export class GrifoRecusado extends Error {
  constructor(readonly codigo: string, mensagem: string) { super(mensagem); this.name = 'GrifoRecusado'; }
}

/**
 * Grifo do leitor: uma `MarcaV2` `manual`, confirmada, sem nota, na camada dele. Passa pelas mesmas
 * conferências das outras marcas (âncora no bloco, função do modo); dois grifos dele que se sobrepõem
 * são recusados, como numa camada editorial.
 */
export async function criarGrifo(cliente: Transacao, grifo: Pick<MarcaV2, 'id' | 'ancora' | 'funcao' | 'modo' | 'criada_em'>): Promise<MarcaV2> {
  const camada = await camadasRepo.camadaDoLeitor(cliente, grifo.ancora.versao_id, grifo.modo);
  const marca: MarcaV2 = {
    id: grifo.id, ancora: grifo.ancora, funcao: grifo.funcao, saliencia: 2, subfaixas: [], comentario: null,
    origem: 'manual', validade: 'resolvida', visivel: true, avaliacao: 'confirmada',
    camada_id: camada.id, modo: grifo.modo, criada_em: grifo.criada_em,
  };
  try {
    await publicarMarcasV2(cliente, grifo.ancora.versao_id, [marca]);
  } catch (erro) {
    if (erro instanceof ConflitoEditorial) throw new GrifoRecusado('grifo_sobreposto', 'Este trecho já tem um grifo seu; mude a função dele ou tire-o antes.');
    throw new GrifoRecusado('grifo_invalido', erro instanceof Error ? erro.message : 'Grifo inválido.');
  }
  return (await listarDoLeitor(cliente, grifo.ancora.versao_id)).find((item) => item.id === grifo.id)!;
}

/** Tira um grifo do leitor. Só os dele: as marcas da IA se rejeitam, não se apagam. */
export async function apagarGrifo(cliente: Transacao, id: Id): Promise<boolean | null> {
  const linha = (await cliente.query<{ tipo: string }>(`SELECT c.tipo FROM marca m JOIN camada c ON c.id=m.camada_id WHERE m.id=$1`, [id])).rows[0];
  if (!linha) return null;
  if (linha.tipo !== 'leitor') return false;
  // Modelo D (J138): a nota é do grifo e sai com ele (a tela pede confirmação antes). As notas que a 0032
  // juntou nela também saem, para não voltarem soltas.
  await cliente.query('DELETE FROM anotacao WHERE marca_id=$1 AND fundida_em IS NOT NULL', [id]);
  await cliente.query('DELETE FROM anotacao WHERE marca_id=$1', [id]);
  await cliente.query('DELETE FROM marca WHERE id=$1', [id]);
  return true;
}

/** O que o leitor mudou nas marcas da IA: a função e a nota originais, guardadas na primeira mudança. */
export interface EdicaoDaMarca { funcao_da_ia?: string; comentario_da_ia?: MarcaV2['comentario'] }

export async function edicoes(cliente: Transacao, versaoId: Id, blocos?: readonly Id[]): Promise<Record<Id, EdicaoDaMarca>> {
  const linhas = (await cliente.query<{ id: Id; funcao_da_ia: string | null; comentario_da_ia: MarcaV2['comentario'] | null }>(
    `SELECT id, funcao_da_ia, comentario_da_ia FROM marca WHERE versao_id=$1 AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[]))
      AND (funcao_da_ia IS NOT NULL OR comentario_da_ia IS NOT NULL)`, [versaoId, blocos === undefined ? null : [...blocos]])).rows;
  return Object.fromEntries(linhas.map((linha) => [linha.id, {
    ...(linha.funcao_da_ia === null ? {} : { funcao_da_ia: linha.funcao_da_ia }),
    ...(linha.comentario_da_ia === null ? {} : { comentario_da_ia: linha.comentario_da_ia }),
  }]));
}

async function marcaV2(cliente: Transacao, id: Id): Promise<MarcaV2 | null> {
  return (await cliente.query<{ marca: MarcaV2 }>(`SELECT ${OBJETO_V2} AS marca FROM marca WHERE id=$1`, [id])).rows[0]?.marca ?? null;
}

/**
 * Troca a função de uma marca (a etiqueta de função). Na marca da IA a função original fica em
 * `funcao_da_ia` na primeira troca; voltar a ela limpa a edição. `null` se a marca não existe.
 */
export async function trocarFuncao(cliente: Transacao, id: Id, funcao: string, outroModo?: ReferenciaModo): Promise<MarcaV2 | null> {
  const atual = await marcaV2(cliente, id);
  if (!atual) return null;
  if (outroModo !== undefined && !mesmoModo(outroModo, atual.modo)) return trocarOlhar(cliente, atual, funcao, outroModo);
  const modo = modoOuNada(atual.modo);
  if (!modo || !conferirMarcaNoModo({ ...atual, funcao }, modo)) throw new GrifoRecusado('funcao_fora_do_modo', `A função ${funcao} não existe no modo da marca.`);
  // A sobreposição editorial vale para a nova função também (duas marcas editoriais da camada no mesmo trecho).
  const daCamada = (await listarV2PorVersao(cliente, atual.ancora.versao_id, { camada_id: atual.camada_id })).map((marca) => marca.id === id ? { ...marca, funcao } : marca);
  if (validarCamadaEditorialV2(daCamada).length > 0) throw new GrifoRecusado('funcao_sobreposta', 'Com esta função a marca se sobrepõe a outra da mesma camada.');
  await cliente.query(`UPDATE marca SET
      funcao_da_ia = CASE WHEN origem='manual' THEN NULL WHEN funcao_da_ia IS NULL THEN funcao
                          WHEN funcao_da_ia = $2 THEN NULL ELSE funcao_da_ia END,
      funcao=$2, atualizada_em=clock_timestamp() WHERE id=$1`, [id, funcao]);
  return marcaV2(cliente, id);
}

/**
 * Outro olhar sobre o grifo do leitor (J138): a função de outro modo. O vocabulário não fica preso ao tipo de
 * leitura: o grifo passa para a camada do leitor daquele modo (uma por versão e modo), com a função escolhida.
 * Só os grifos do leitor mudam de modo; a marca da IA é do modo da execução dela (quem chama cria um grifo do
 * leitor no mesmo trecho).
 */
async function trocarOlhar(cliente: Transacao, atual: MarcaV2, funcao: string, outroModo: ReferenciaModo): Promise<MarcaV2> {
  if (atual.origem !== 'manual') throw new GrifoRecusado('modo_da_marca_da_ia', 'A marca da IA fica no modo dela; grife o trecho com este olhar.');
  const modo = modoOuNada(outroModo);
  if (!modo) throw new GrifoRecusado('modo_inexistente', 'O modo do grifo não existe.');
  if (!conferirMarcaNoModo({ ...atual, funcao, modo: outroModo }, modo)) throw new GrifoRecusado('funcao_fora_do_modo', `A função ${funcao} não existe no modo ${outroModo.id}.`);
  const camada = await camadasRepo.camadaDoLeitor(cliente, atual.ancora.versao_id, outroModo);
  const movida = { ...atual, funcao, modo: outroModo, camada_id: camada.id };
  const daCamada = [...(await listarV2PorVersao(cliente, atual.ancora.versao_id, { camada_id: camada.id })).filter((marca) => marca.id !== atual.id), movida];
  if (validarCamadaEditorialV2(daCamada).length > 0) throw new GrifoRecusado('grifo_sobreposto', 'Neste olhar o trecho já tem um grifo seu; mude a função dele ou tire-o antes.');
  await cliente.query(`UPDATE marca SET funcao=$2, camada_id=$3, modo_id=$4, modo_revisao=$5, atualizada_em=clock_timestamp() WHERE id=$1`,
    [atual.id, funcao, camada.id, outroModo.id, outroModo.revisao]);
  return (await marcaV2(cliente, atual.id))!;
}

/**
 * Reescreve o texto da nota de uma marca (a nota do Codex, editada pelo leitor). O original fica em
 * `comentario_da_ia` na primeira edição; `texto: null` volta ao original. Marca sem nota recebe uma
 * nota do tipo LEITURA (a do leitor sobre o próprio grifo, por exemplo).
 */
export async function editarComentario(cliente: Transacao, id: Id, texto: string | null): Promise<MarcaV2 | null> {
  const linha = (await cliente.query<{ comentario: MarcaV2['comentario']; comentario_da_ia: MarcaV2['comentario'] | null }>(
    'SELECT comentario, comentario_da_ia FROM marca WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!linha) return null;
  if (texto === null) {
    if (linha.comentario_da_ia !== null) await cliente.query('UPDATE marca SET comentario=comentario_da_ia, comentario_da_ia=NULL, atualizada_em=clock_timestamp() WHERE id=$1', [id]);
    return marcaV2(cliente, id);
  }
  const base = linha.comentario ?? { tipo: 'LEITURA', rotulo: 'LEITURA', texto: '' };
  const novo = { ...base, texto };
  const atual = await marcaV2(cliente, id);
  if (!atual || !validarMarcaV2({ ...atual, comentario: novo })) throw new GrifoRecusado('nota_invalida', 'A nota não cabe no contrato da marca (vazia ou longa demais).');
  await cliente.query(`UPDATE marca SET comentario_da_ia = CASE WHEN comentario_da_ia IS NULL AND origem<>'manual' THEN comentario ELSE comentario_da_ia END,
      comentario=$2, atualizada_em=clock_timestamp() WHERE id=$1`, [id, JSON.stringify(novo)]);
  return marcaV2(cliente, id);
}
