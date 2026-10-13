import { fronteiraUtf16, versosValidos } from './texto';
export { fronteiraUtf16, versosValidos, faixasDosVersos, conferirTextoAncora } from './texto';
import { hashEstrutural } from './serializacao';
import type { AncoraV1, CanonicoV1, Faixa, LoteRevisaoV1, LoteRevisaoV2, MarcaGeradaV1, MarcaV1, ParteV1, ProgressoV1 } from './tipos';

/** Sintaxe RFC 5646, incluindo private-use e grandfathered, sem consultar registro na rede. */
export function idiomaValido(idioma: string): boolean {
  const antigos = /^(?:en-GB-oed|i-(?:ami|bnn|default|enochian|hak|klingon|lux|mingo|navajo|pwn|tao|tay|tsu)|sgn-(?:BE-FR|BE-NL|CH-DE)|art-lojban|cel-gaulish|no-bok|no-nyn|zh-(?:guoyu|hakka|min|min-nan|xiang))$/i;
  if (antigos.test(idioma) || /^x(?:-[a-z0-9]{1,8})+$/i.test(idioma)) return true;
  const sintaxe = /^(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?((?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*)((?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*)(?:-x(?:-[a-z0-9]{1,8})+)?$/i;
  const grupos = sintaxe.exec(idioma);
  if (!grupos) return false;
  const variantes = (grupos[1] ?? '').toLowerCase().split('-').filter(Boolean);
  const extensoes = (grupos[2] ?? '').toLowerCase().split('-').filter((item) => item.length === 1);
  return new Set(variantes).size === variantes.length && new Set(extensoes).size === extensoes.length;
}

export function faixaValida(faixa: Faixa): boolean { return faixa.inicio_utf16 < faixa.fim_utf16; }
export function regrasAncora(ancora: AncoraV1): boolean {
  return faixaValida(ancora) && ancora.fim_utf16 - ancora.inicio_utf16 === ancora.citacao.length;
}
export function regrasSubfaixas(faixas: readonly Faixa[], ancora?: AncoraV1): boolean {
  const ordenadas = [...faixas].sort((a, b) => a.inicio_utf16 - b.inicio_utf16);
  return ordenadas.every((faixa, indice) => faixaValida(faixa) &&
    (indice === 0 || (ordenadas[indice - 1]?.fim_utf16 ?? Infinity) <= faixa.inicio_utf16) &&
    (!ancora || (faixa.inicio_utf16 >= ancora.inicio_utf16 && faixa.fim_utf16 <= ancora.fim_utf16 &&
      fronteiraUtf16(ancora.citacao, faixa.inicio_utf16 - ancora.inicio_utf16) &&
      fronteiraUtf16(ancora.citacao, faixa.fim_utf16 - ancora.inicio_utf16))));
}
export function regrasMarca(marca: MarcaV1): boolean {
  return regrasAncora(marca.ancora) && regrasSubfaixas(marca.subfaixas, marca.ancora);
}
export function regrasMarcaGerada(marca: Pick<MarcaGeradaV1, 'citacao' | 'sublinhar'>): boolean {
  const faixas: Faixa[] = [];
  for (const texto of marca.sublinhar) {
    const inicio = marca.citacao.indexOf(texto);
    if (inicio < 0 || marca.citacao.indexOf(texto, inicio + 1) !== -1) return false;
    faixas.push({ inicio_utf16: inicio, fim_utf16: inicio + texto.length });
  }
  return regrasSubfaixas(faixas);
}
export function regrasParte(parte: ParteV1): boolean {
  return parte.blocos_contexto.every((id) => !parte.blocos_responsaveis.includes(id));
}
export function regrasProgresso(progresso: ProgressoV1): boolean {
  return progresso.versao_id === progresso.ancora.versao_id && regrasAncora(progresso.ancora);
}
function idsUnicos(itens: readonly { id: string }[]): boolean { return new Set(itens.map((item) => item.id)).size === itens.length; }
function ordemCrescente(itens: readonly { ordem: number }[]): boolean {
  return itens.every((item, indice) => indice === 0 || item.ordem > (itens[indice - 1]?.ordem ?? Infinity));
}
export function regrasCanonico(canonico: CanonicoV1, conferirHash: boolean): boolean {
  const { blocos, secoes, assets } = canonico;
  if (!idsUnicos([...blocos, ...secoes, ...assets]) || !ordemCrescente(blocos) || !ordemCrescente(secoes)) return false;
  if (conferirHash && hashEstrutural(blocos) !== canonico.hash_estrutural) return false;
  const mapaBlocos = new Map(blocos.map((bloco, indice) => [bloco.id, { bloco, indice }]));
  const mapaAssets = new Map(assets.map((asset) => [asset.id, asset]));
  for (const bloco of blocos) {
    if (bloco.tipo === 'estrofe' && !versosValidos(bloco.texto)) return false;
    if (bloco.asset_id) {
      const asset = mapaAssets.get(bloco.asset_id);
      if (!asset || (asset.bloco_id !== undefined && asset.bloco_id !== bloco.id)) return false;
    }
    for (const faixa of bloco.inline) {
      if (faixa.inicio >= faixa.fim || !fronteiraUtf16(bloco.texto, faixa.inicio) || !fronteiraUtf16(bloco.texto, faixa.fim)) return false;
      if (faixa.estilo === 'nota_ref') {
        if (!faixa.ref || mapaBlocos.get(faixa.ref)?.bloco.tipo !== 'nota_rodape') return false;
      } else if (faixa.ref !== undefined) return false;
    }
    for (const origem of bloco.origens) {
      if (origem.tipo === 'texto' && origem.linha_inicio > origem.linha_fim) return false;
      if (origem.tipo === 'pdf') {
        if (origem.bbox[0] >= origem.bbox[2] || origem.bbox[1] >= origem.bbox[3]) return false;
        if (origem.inicio !== undefined && (origem.fim === undefined || origem.inicio >= origem.fim ||
          !fronteiraUtf16(bloco.texto, origem.inicio) || !fronteiraUtf16(bloco.texto, origem.fim))) return false;
      }
    }
  }
  for (const asset of assets) {
    if (asset.bloco_id !== undefined) {
      const bloco = mapaBlocos.get(asset.bloco_id)?.bloco;
      if (!bloco || (bloco.asset_id !== undefined && bloco.asset_id !== asset.id)) return false;
    }
  }
  const pilha: { nivel: number; inicio: number; fim: number }[] = [];
  let ultimoInicio = -1;
  for (const secao of secoes) {
    const inicio = mapaBlocos.get(secao.bloco_inicio);
    const fim = mapaBlocos.get(secao.bloco_fim);
    if (!inicio || !fim || inicio.indice > fim.indice || inicio.indice <= ultimoInicio ||
      !['capitulo', 'secao'].includes(inicio.bloco.tipo) || inicio.bloco.texto !== secao.titulo) return false;
    ultimoInicio = inicio.indice;
    let ultimaIrma: { fim: number } | undefined;
    while (pilha.length && (pilha.at(-1)?.nivel ?? 0) >= secao.nivel) ultimaIrma = pilha.pop();
    const pai = pilha.at(-1);
    if (secao.nivel !== (pai?.nivel ?? 0) + 1 || (pai && fim.indice > pai.fim) ||
      (ultimaIrma && inicio.indice <= ultimaIrma.fim)) return false;
    pilha.push({ nivel: secao.nivel, inicio: inicio.indice, fim: fim.indice });
  }
  return blocos.filter((bloco) => bloco.tipo === 'capitulo' || bloco.tipo === 'secao')
    .every((bloco) => secoes.some((secao) => secao.bloco_inicio === bloco.id));
}
export function regrasLote(lote: LoteRevisaoV1 | LoteRevisaoV2): boolean {
  if (new Set(lote.operacoes.map((op) => op.ordem)).size !== lote.operacoes.length) return false;
  for (const op of lote.operacoes) {
    if (op.op === 'remover' && (op.antes.id !== op.marca_id || !regrasMarca(op.antes) ||
      (op.antes.execucao_id !== undefined && op.antes.execucao_id !== lote.execucao_id))) return false;
    if (op.op === 'editar_subfaixas' && (!regrasSubfaixas(op.antes.subfaixas) || !regrasSubfaixas(op.depois.subfaixas))) return false;
  }
  return true;
}
