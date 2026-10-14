/**
 * Tipos de texto (v0.1, auditoria A §6.1): o que a pessoa vê ao preparar uma leitura. Dois níveis,
 * grupo e tipo ("Conto · Literatura"); o modo de leitura é detalhe interno, e vários tipos podem
 * apontar para o mesmo modo. A fonte da verdade é `contratos/tipos-de-texto.json`; o serviço o serve em
 * `GET /api/tipos-de-texto` e a interface só lê.
 *
 * O tipo de um documento (`TipoDoDocumentoV1`) é detectado pelo Codex depois da canonização ou escolhido
 * pela pessoa; a escolha dela nunca é sobrescrita por uma detecção.
 */
import { readFileSync } from 'node:fs';
import { lerModosDeLeitura } from './modos';
import type { ReferenciaModo } from './tipos';

export type EstadoDoTipo = 'estavel' | 'em_avaliacao';
export interface TipoDeTextoV1 {
  id: string;
  rotulo: string;
  /** Exemplos curtos, para quem escolhe reconhecer o tipo ("Machado de Assis, Tchékhov"). */
  exemplos: string;
  modo: ReferenciaModo;
  /** `em_avaliacao`: o modo ainda não passou pela bancada comparativa com leitores. */
  estado: EstadoDoTipo;
}
export interface GrupoDeTiposV1 { id: string; rotulo: string; tipos: TipoDeTextoV1[] }
export interface TiposDeTextoV1 {
  versao: 1;
  /** O tipo das leituras quando nada foi detectado nem escolhido ("Outro ou não sei"). */
  padrao: string;
  grupos: GrupoDeTiposV1[];
}

export type OrigemDoTipo = 'detectado' | 'escolhido';
export type ConfiancaDoTipo = 'alta' | 'media' | 'baixa';
/** Coluna `documento.tipo_de_texto` (migração 0030). */
export interface TipoDoDocumentoV1 {
  tipo_id: string;
  origem: OrigemDoTipo;
  confianca: ConfiancaDoTipo | null;
  justificativa: string | null;
  alternativas: string[];
  job_id: string | null;
  em: string;
}

const ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const texto = (valor: unknown, maximo: number): valor is string => typeof valor === 'string' && valor.trim() !== '' && valor.length <= maximo;
function objetoCom(valor: unknown, chaves: readonly string[]): valor is Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const proprias = Object.keys(valor);
  return proprias.length === chaves.length && chaves.every((chave) => proprias.includes(chave));
}

/** Estrutura, ids únicos, padrão existente e todo tipo apontando para um modo do catálogo. */
export function validarTiposDeTexto(valor: unknown, modos: readonly ReferenciaModo[]): valor is TiposDeTextoV1 {
  if (!objetoCom(valor, ['versao', 'padrao', 'grupos']) || valor.versao !== 1 || !Array.isArray(valor.grupos) || valor.grupos.length === 0) return false;
  const grupos = new Set<string>();
  const tipos = new Set<string>();
  for (const grupo of valor.grupos as unknown[]) {
    if (!objetoCom(grupo, ['id', 'rotulo', 'tipos']) || typeof grupo.id !== 'string' || !ID.test(grupo.id) || grupos.has(grupo.id)
      || !texto(grupo.rotulo, 40) || !Array.isArray(grupo.tipos) || grupo.tipos.length === 0) return false;
    grupos.add(grupo.id);
    for (const tipo of grupo.tipos as unknown[]) {
      if (!objetoCom(tipo, ['id', 'rotulo', 'exemplos', 'modo', 'estado']) || typeof tipo.id !== 'string' || !ID.test(tipo.id) || tipos.has(tipo.id)
        || !texto(tipo.rotulo, 60) || !texto(tipo.exemplos, 120) || (tipo.estado !== 'estavel' && tipo.estado !== 'em_avaliacao')) return false;
      const modo = tipo.modo;
      if (!objetoCom(modo, ['id', 'revisao']) || !modos.some((item) => item.id === modo.id && item.revisao === modo.revisao)) return false;
      tipos.add(tipo.id);
    }
  }
  return typeof valor.padrao === 'string' && tipos.has(valor.padrao);
}

const ARQUIVO = new URL('../tipos-de-texto.json', import.meta.url);
/** Lê e valida `contratos/tipos-de-texto.json` contra o catálogo de modos. */
export function lerTiposDeTexto(): TiposDeTextoV1 {
  const valor: unknown = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
  if (!validarTiposDeTexto(valor, lerModosDeLeitura())) throw new Error('Tipos de texto inválidos: contratos/tipos-de-texto.json');
  return valor;
}

/** O tipo e o grupo dele, ou `undefined`. */
export function tipoDeTexto(tipos: TiposDeTextoV1, id: string): { tipo: TipoDeTextoV1; grupo: GrupoDeTiposV1 } | undefined {
  for (const grupo of tipos.grupos) {
    const tipo = grupo.tipos.find((item) => item.id === id);
    if (tipo) return { tipo, grupo };
  }
  return undefined;
}

export function idsDosTipos(tipos: TiposDeTextoV1): string[] {
  return tipos.grupos.flatMap((grupo) => grupo.tipos.map((tipo) => tipo.id));
}

const ORIGENS: readonly OrigemDoTipo[] = ['detectado', 'escolhido'];
const CONFIANCAS: readonly ConfiancaDoTipo[] = ['alta', 'media', 'baixa'];
export function validarTipoDoDocumento(valor: unknown, tipos: TiposDeTextoV1): valor is TipoDoDocumentoV1 {
  if (!objetoCom(valor, ['tipo_id', 'origem', 'confianca', 'justificativa', 'alternativas', 'job_id', 'em'])) return false;
  const ids = new Set(idsDosTipos(tipos));
  return typeof valor.tipo_id === 'string' && ids.has(valor.tipo_id) && ORIGENS.includes(valor.origem as OrigemDoTipo)
    && (valor.confianca === null || CONFIANCAS.includes(valor.confianca as ConfiancaDoTipo))
    && (valor.justificativa === null || texto(valor.justificativa, 400))
    && Array.isArray(valor.alternativas) && valor.alternativas.length <= 3 && valor.alternativas.every((item) => typeof item === 'string' && ids.has(item))
    && (valor.job_id === null || typeof valor.job_id === 'string') && typeof valor.em === 'string' && !Number.isNaN(Date.parse(valor.em));
}
