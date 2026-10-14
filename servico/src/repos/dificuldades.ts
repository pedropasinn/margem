/**
 * O sinal de dificuldade (`DificuldadeV1`, migração 0032, J138): à parte do grifo, não é cor, função nem
 * etiqueta. Há dois donos: o Codex sugere (no modelo do capítulo, `ModeloDoCapituloV1.dificuldades`) e o
 * leitor confirma ou descarta; o leitor também marca as dele, já confirmadas. A sugestão ainda sem decisão
 * não tem linha aqui: vem do próprio modelo. Nada é apagado; descartar é um estado.
 */
import {
  conferirAncora, validarDificuldade, type AncoraV1, type DificuldadeV1, type EstadoDaDificuldade, type Id, type TipoDificuldadeTextual,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { DATA, DadoRecusado, OBJETO_ANCORA } from './anotacoes.js';
import { obterVersao } from './documentos.js';
import { obterModelo } from './compreensao.js';

const OBJETO = `jsonb_build_object('versao',1,'id',d.id,'versao_id',d.versao_id,'ancora',${OBJETO_ANCORA('d.')},
    'origem',d.origem,'estado',d.estado,'criada_em',${DATA('d.criada_em')},'atualizada_em',${DATA('d.atualizada_em')})
  || CASE WHEN d.tipo IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('tipo',d.tipo) END
  || CASE WHEN d.descricao IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('descricao',d.descricao) END
  || CASE WHEN d.marca_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('marca_id',d.marca_id) END
  || CASE WHEN d.codex_dificuldade_id IS NULL THEN '{}'::jsonb
     ELSE jsonb_build_object('codex',jsonb_build_object('modelo_id',d.codex_modelo_id,'dificuldade_id',d.codex_dificuldade_id)) END`;

export async function obter(cliente: Transacao, id: Id, travar = false): Promise<DificuldadeV1 | null> {
  return (await cliente.query<{ d: DificuldadeV1 }>(`SELECT ${OBJETO} AS d FROM dificuldade d WHERE d.id=$1${travar ? ' FOR UPDATE' : ''}`, [id])).rows[0]?.d ?? null;
}

/** As dificuldades gravadas nos blocos pedidos (do leitor e decisões sobre as do Codex), na ordem de criação. */
export async function listarNosBlocos(cliente: Transacao, versaoId: Id, blocos: readonly Id[]): Promise<DificuldadeV1[]> {
  return (await cliente.query<{ d: DificuldadeV1 }>(`SELECT ${OBJETO} AS d FROM dificuldade d
    WHERE d.versao_id=$1 AND d.bloco_id = ANY($2::text[]) ORDER BY d.criada_em, d.id`, [versaoId, [...blocos]])).rows.map((linha) => linha.d);
}

/** Todas as da versão (exportação). */
export async function listarDaVersao(cliente: Transacao, versaoId: Id): Promise<DificuldadeV1[]> {
  return (await cliente.query<{ d: DificuldadeV1 }>(`SELECT ${OBJETO} AS d FROM dificuldade d
    WHERE d.versao_id=$1 ORDER BY d.criada_em, d.id`, [versaoId])).rows.map((linha) => linha.d);
}

async function inserir(cliente: Transacao, d: DificuldadeV1): Promise<DificuldadeV1> {
  if (!validarDificuldade(d)) throw new DadoRecusado('dificuldade_invalida', 'A dificuldade não segue o contrato DificuldadeV1.');
  const a = d.ancora;
  await cliente.query(`INSERT INTO dificuldade (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,origem,estado,tipo,descricao,
      marca_id,codex_modelo_id,codex_dificuldade_id,criada_em,atualizada_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
  [d.id, d.versao_id, a.bloco_id, a.inicio_utf16, a.fim_utf16, a.citacao, a.prefixo, a.sufixo, d.origem, d.estado, d.tipo ?? null, d.descricao ?? null,
    d.marca_id ?? null, d.codex?.modelo_id ?? null, d.codex?.dificuldade_id ?? null, d.criada_em, d.atualizada_em]);
  return (await obter(cliente, d.id))!;
}

/** O leitor marca uma dificuldade num trecho (com ou sem grifo); já nasce confirmada. */
export async function marcarDoLeitor(cliente: Transacao, entrada: { id: Id; ancora: AncoraV1; tipo?: TipoDificuldadeTextual; marca_id?: Id; agora: string }): Promise<DificuldadeV1> {
  const versao = await obterVersao(cliente, entrada.ancora.versao_id).catch(() => null);
  if (!versao) throw new DadoRecusado('versao_inexistente', 'A versão da âncora não existe.');
  const bloco = versao.canonico.blocos.find((candidato) => candidato.id === entrada.ancora.bloco_id);
  if (!bloco || !conferirAncora(bloco, entrada.ancora)) throw new DadoRecusado('ancora_invalida', 'A âncora não confere no bloco da versão.');
  if (entrada.marca_id !== undefined && !(await cliente.query('SELECT 1 FROM marca WHERE id=$1 AND versao_id=$2', [entrada.marca_id, entrada.ancora.versao_id])).rowCount) {
    throw new DadoRecusado('marca_inexistente', 'O grifo citado não existe nesta versão.');
  }
  return inserir(cliente, {
    versao: 1, id: entrada.id, versao_id: entrada.ancora.versao_id, ancora: entrada.ancora, origem: 'leitor', estado: 'confirmada',
    ...(entrada.tipo === undefined ? {} : { tipo: entrada.tipo }), ...(entrada.marca_id === undefined ? {} : { marca_id: entrada.marca_id }),
    criada_em: entrada.agora, atualizada_em: entrada.agora,
  });
}

/**
 * O leitor decide uma dificuldade sugerida pelo Codex: confirma, descarta ou volta a deixá-la sugerida. A primeira
 * decisão grava a linha (âncora principal, tipo e descrição do modelo); as seguintes só mudam o estado.
 */
export async function decidirDoCodex(cliente: Transacao, entrada: { id: Id; modelo_id: Id; dificuldade_id: Id; estado: EstadoDaDificuldade; agora: string }): Promise<DificuldadeV1> {
  const existente = (await cliente.query<{ id: Id }>('SELECT id FROM dificuldade WHERE codex_dificuldade_id=$1 FOR UPDATE', [entrada.dificuldade_id])).rows[0];
  if (existente) return mudar(cliente, existente.id, { estado: entrada.estado, agora: entrada.agora });
  const modelo = await obterModelo(cliente, entrada.modelo_id);
  const sugerida = modelo?.dificuldades.find((d) => d.id === entrada.dificuldade_id);
  const ancora = sugerida?.ancoras[0];
  if (!modelo || !sugerida || !ancora) throw new DadoRecusado('dificuldade_inexistente', 'Esta dificuldade não está no modelo do capítulo.');
  return inserir(cliente, {
    versao: 1, id: entrada.id, versao_id: ancora.versao_id, ancora, origem: 'codex', estado: entrada.estado, tipo: sugerida.tipo,
    descricao: sugerida.descricao.slice(0, 2000), codex: { modelo_id: modelo.id, dificuldade_id: sugerida.id },
    criada_em: entrada.agora, atualizada_em: entrada.agora,
  });
}

/** Estado e categoria (o detalhe opcional, escolhido depois; `null` tira). A do leitor não volta a "sugerida". */
export async function mudar(cliente: Transacao, id: Id, mudanca: { estado?: EstadoDaDificuldade; tipo?: TipoDificuldadeTextual | null; agora: string }): Promise<DificuldadeV1> {
  const atual = await obter(cliente, id, true);
  if (!atual) throw new DadoRecusado('dificuldade_inexistente', 'Dificuldade inexistente.');
  const tipo = mudanca.tipo === undefined ? atual.tipo : mudanca.tipo ?? undefined;
  const semTipo: DificuldadeV1 = { ...atual };
  delete semTipo.tipo;
  const nova: DificuldadeV1 = { ...semTipo, ...(tipo === undefined ? {} : { tipo }), estado: mudanca.estado ?? atual.estado,
    atualizada_em: Date.parse(mudanca.agora) >= Date.parse(atual.criada_em) ? mudanca.agora : atual.criada_em };
  if (!validarDificuldade(nova)) throw new DadoRecusado('dificuldade_invalida', 'Esta mudança não cabe no sinal de dificuldade.');
  await cliente.query('UPDATE dificuldade SET estado=$2, tipo=$3, atualizada_em=$4 WHERE id=$1', [id, nova.estado, nova.tipo ?? null, nova.atualizada_em]);
  return (await obter(cliente, id))!;
}
