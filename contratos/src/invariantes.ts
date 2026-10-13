import type { AncoraV1, Bloco, CanonicoV1, ExecucaoLeituraV1, ExecucaoLeituraV2, LoteRevisaoV1, LoteRevisaoV2, MarcaGeradaV1, MarcaV1, ParteV1, ProgressoV1 } from './tipos';
import { conferirTextoAncora } from './regras';
import { hashMarcas, serializarEstavel } from './serializacao';
import { validarAncora, validarCanonico, validarExecucaoLeitura, validarExecucaoLeituraV2, validarLoteRevisao, validarLoteRevisaoV2, validarMarca, validarMarcaGerada, validarParte, validarProgresso } from './validadores';

export function conferirAncora(bloco: Pick<Bloco, 'id' | 'texto'>, ancora: AncoraV1): boolean {
  return validarAncora(ancora) && conferirTextoAncora(bloco, ancora);
}
export function conferirMarcaGerada(bloco: Pick<Bloco, 'id' | 'texto'>, marca: MarcaGeradaV1): boolean {
  if (!validarMarcaGerada(marca) || bloco.id !== marca.bloco_id) return false;
  let ocorrencias = 0;
  for (let inicio = bloco.texto.indexOf(marca.citacao); inicio !== -1; inicio = bloco.texto.indexOf(marca.citacao, inicio + 1)) {
    if (bloco.texto.slice(0, inicio).endsWith(marca.prefixo) && bloco.texto.slice(inicio + marca.citacao.length).startsWith(marca.sufixo)) ocorrencias++;
  }
  return ocorrencias === 1;
}
export function validarCamadaEditorial(marcas: readonly MarcaV1[]): [string, string][] {
  const conflitos: [string, string][] = [];
  for (const marca of marcas) if (!validarMarca(marca)) throw new Error('Marca inválida na camada.');
  const ativas = marcas.filter((marca) => marca.funcao !== 'nenhuma' && marca.validade === 'resolvida');
  for (let i = 0; i < ativas.length; i++) {
    const a = ativas[i];
    if (!a) continue;
    for (const b of ativas.slice(i + 1)) {
      if (a.ancora.versao_id === b.ancora.versao_id && a.ancora.bloco_id === b.ancora.bloco_id &&
        a.ancora.inicio_utf16 < b.ancora.fim_utf16 && b.ancora.inicio_utf16 < a.ancora.fim_utf16) conflitos.push([a.id, b.id]);
    }
  }
  return conflitos;
}

/** Verifica a coleção e, quando fornecidos, plano (execução V1 ou V2) e referências ao canônico. */
export function validarPartes(partes: readonly ParteV1[], execucao?: ExecucaoLeituraV1 | ExecucaoLeituraV2, canonico?: CanonicoV1): boolean {
  if (!partes.length || !partes.every((parte) => validarParte(parte))) return false;
  if (new Set(partes.map((parte) => parte.id)).size !== partes.length || new Set(partes.map((parte) => parte.ordem)).size !== partes.length ||
    new Set(partes.map((parte) => parte.execucao_id)).size !== 1) return false;
  const responsaveis = partes.flatMap((parte) => parte.blocos_responsaveis);
  if (new Set(responsaveis).size !== responsaveis.length) return false;
  if (execucao) {
    const valida = execucao.schema_versao === 2 ? validarExecucaoLeituraV2(execucao) : validarExecucaoLeitura(execucao);
    if (!valida || partes.some((parte) => parte.execucao_id !== execucao.id) ||
      serializarEstavel([...partes].sort((a, b) => a.ordem - b.ordem).map((parte) => parte.id)) !== serializarEstavel(execucao.plano_partes)) return false;
  }
  if (canonico) {
    if (!validarCanonico(canonico)) return false;
    const ids = new Set(canonico.blocos.map((bloco) => bloco.id));
    if (partes.some((parte) => [...parte.blocos_responsaveis, ...parte.blocos_contexto].some((id) => !ids.has(id)))) return false;
  }
  return true;
}

/** Identidades vêm do envelope do serviço: CanonicoV1 não tem documento_id/versao_id. */
export function conferirProgresso(canonico: CanonicoV1, documentoId: string, versaoId: string, progresso: ProgressoV1): boolean {
  if (!validarCanonico(canonico) || !validarProgresso(progresso) || progresso.documento_id !== documentoId || progresso.versao_id !== versaoId) return false;
  const bloco = canonico.blocos.find((item) => item.id === progresso.ancora.bloco_id);
  return !!bloco && conferirAncora(bloco, progresso.ancora) && progresso.capitulos_concluidos.every((id) =>
    canonico.secoes.some((secao) => secao.id === id && secao.nivel === 1));
}
function exigirConjunto(marcas: readonly MarcaV1[]): void {
  if (!marcas.every((marca) => validarMarca(marca)) || new Set(marcas.map((marca) => marca.id)).size !== marcas.length) throw new Error('Conjunto de marcas inválido.');
  if (validarCamadaEditorial(marcas).length) throw new Error('Conflito na camada editorial.');
}
function iguais(a: unknown, b: unknown): boolean { return serializarEstavel(a) === serializarEstavel(b); }
function transformar(marcas: readonly MarcaV1[], lote: LoteRevisaoV1 | LoteRevisaoV2, reverso: boolean): MarcaV1[] {
  const mapa = new Map(structuredClone([...marcas]).map((marca) => [marca.id, marca]));
  const operacoes = [...lote.operacoes].sort((a, b) => a.ordem - b.ordem);
  if (reverso) operacoes.reverse();
  for (const op of operacoes) {
    const marca = mapa.get(op.marca_id);
    if (op.op === 'remover') {
      if (reverso) {
        if (marca) throw new Error('Remoção já não corresponde ao estado atual.');
        mapa.set(op.marca_id, structuredClone(op.antes));
      } else {
        if (!marca || !iguais(marca, op.antes)) throw new Error('Antes da remoção diverge da marca.');
        mapa.delete(op.marca_id);
      }
      continue;
    }
    if (!marca) throw new Error('Marca referenciada não existe.');
    if (marca.execucao_id !== undefined && marca.execucao_id !== lote.execucao_id) throw new Error('Execução da marca diverge do lote.');
    const esperado = reverso ? op.depois : op.antes;
    const substituir = reverso ? op.antes : op.depois;
    const atual = Object.fromEntries(Object.keys(esperado).map((chave) => [chave, marca[chave as keyof MarcaV1]]));
    if (!iguais(atual, esperado)) throw new Error('Antes/depois diverge do estado da marca.');
    const alterada: unknown = { ...marca, ...structuredClone(substituir) };
    if (!validarMarca(alterada)) throw new Error('Operação produz marca inválida.');
    mapa.set(op.marca_id, alterada);
  }
  return [...mapa.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/** Pura, atômica e sem cache: reaplicação reconstrói e confere o snapshot base. */
export function aplicarLote(marcas: readonly MarcaV1[], lote: LoteRevisaoV1 | LoteRevisaoV2): MarcaV1[] {
  if (!validarLoteRevisaoV2(lote) && !validarLoteRevisao(lote)) throw new Error('Lote inválido.');
  exigirConjunto(marcas);
  if (hashMarcas(marcas) === lote.snapshot_base) {
    const resultado = transformar(marcas, lote, false);
    exigirConjunto(resultado);
    return resultado;
  }
  const base = transformar(marcas, lote, true);
  exigirConjunto(base);
  if (hashMarcas(base) !== lote.snapshot_base) throw new Error('Snapshot base divergente.');
  const resultado = transformar(base, lote, false);
  exigirConjunto(resultado);
  if (hashMarcas(resultado) !== hashMarcas(marcas)) throw new Error('Reaplicação divergente.');
  return resultado;
}
