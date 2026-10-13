import type { CanonicoV1, Id } from './tipos';
export interface ProvenienciaV1 {
  versao: 1;
  sha256_original: string;
  hash_estrutural: string;
  extrator: { nome: 'PyMuPDF'; versao: string };
  observacoes: { pagina: number; ordem: number; texto: string; bbox: number[];
    spans: { texto: string; bbox: number[]; fonte: string; tamanho: number; flags: number }[] }[];
  transformacoes: { regra: 'ligaturas_tipograficas' | 'hifen_remover' | 'hifen_manter' | 'numero_pagina' | 'cabecalho_heuristica_legada';
    antes: string; depois: string; pagina?: number; bbox?: number[]; bloco_id?: Id }[];
}
export function regrasProveniencia(p: ProvenienciaV1): boolean {
  const paginas = new Set(p.observacoes.map(o => o.pagina));
  const bboxValido = (b: number[]): boolean => b.every(Number.isFinite) && b[2]! >= b[0]! && b[3]! >= b[1]!;
  return p.observacoes.every((o, i) => o.ordem === i && (i === 0 || o.pagina >= p.observacoes[i - 1]!.pagina)
    && bboxValido(o.bbox) && o.spans.every(s => bboxValido(s.bbox)) && o.texto === o.spans.map(s => s.texto).join(''))
    && p.transformacoes.every(t => t.bloco_id !== undefined
      ? t.pagina === undefined && t.bbox === undefined
      : t.pagina !== undefined && paginas.has(t.pagina) && t.bbox !== undefined && bboxValido(t.bbox));
}
export function conferirProveniencia(p: ProvenienciaV1, c: CanonicoV1): boolean {
  const blocos = new Set(c.blocos.map(b => b.id));
  return p.sha256_original === c.documento.sha256_original && p.hash_estrutural === c.hash_estrutural
    && p.transformacoes.every(t => t.bloco_id === undefined || blocos.has(t.bloco_id));
}
