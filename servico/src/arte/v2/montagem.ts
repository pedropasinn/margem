/**
 * Montagem dos contratos publicados (ModeloDaObraV1 e AnaliseCurtaDaObraV1) a partir das saídas das
 * etapas. Os IDs são ULIDs gerados pelo serviço, mas determinísticos (tempo da geração + hash de uma
 * chave), para que retomar uma geração remonte exatamente os mesmos arquivos.
 */
import { createHash } from 'node:crypto';
import type { AfirmacaoDaObra, AnaliseCurtaDaObraV1, ModeloDaObraV1, RetanguloDaObra, TemaDaObra } from '@margem/contratos';
import { enquadrarRegiao, limitesDaRegiao, QUADRO_INTEIRO, temporizarAnaliseCurta } from '../../../../core/src/arte.js';
import type { CandidatoRevisado } from './conferencias.js';
import type { RoteiroCandidato } from './tipos.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID válido: 10 caracteres do instante + 16 do SHA-256 de `semente/chave`. */
export function criarIds(instanteMs: number, semente: string): (chave: string) => string {
  let tempo = '';
  for (let t = instanteMs, i = 0; i < 10; i += 1, t = Math.floor(t / 32)) tempo = CROCKFORD[t % 32]! + tempo;
  return (chave) => {
    const hash = createHash('sha256').update(`${semente}/${chave}`).digest();
    let resto = '';
    for (let i = 0; i < 16; i += 1) resto += CROCKFORD[hash[i]! % 32]!;
    return tempo + resto;
  };
}

export const METODO_V2 = 'arte-v2/1';

export function montarModelo(base: ModeloDaObraV1, c: CandidatoRevisado, id: (chave: string) => string): { modelo: ModeloDaObraV1; idsAfirmacoes: string[]; idsRegioes: string[] } {
  const idsRegioes = c.regioes.map((_, i) => id(`regiao/${String(i)}`));
  const idsAfirmacoes = c.afirmacoes.map((_, i) => id(`afirmacao/${String(i)}`));
  const identidade = base.afirmacoes.filter((a) => base.identidade.afirmacoes.includes(a.id));
  const geradas: AfirmacaoDaObra[] = c.afirmacoes.map((a, i) => {
    const trechos = a.citacoes.map((x) => `“${x.trecho.trim()}” (${base.fontes.find((f) => f.id === x.fonte)?.titulo ?? x.fonte})`);
    return {
      id: idsAfirmacoes[i]!, texto: a.texto, tipo: a.tipo, confianca: a.tipo === 'intencao_desconhecida' ? 'nao_aplicavel' : a.confianca,
      evidencia: trechos.length ? `${a.evidencia} Trecho: ${trechos.join('; ')}` : a.evidencia,
      fontes: a.fontes, regioes: a.regioes.map((r) => idsRegioes[r]!), apoios: a.apoios.map((p) => idsAfirmacoes[p]!),
      proveniencia: a.origem === 'curadoria' ? { autor: 'curadoria', metodo: 'pesquisa-do-dossie' } : { autor: 'ia', metodo: METODO_V2 },
    };
  });
  const ordem: TemaDaObra[] = ['composicao', 'iconografia', 'tecnica', 'historia', 'artista', 'contexto', 'interpretacoes', 'obras_relacionadas'];
  const estudo = ordem.map((tema) => ({
    tema,
    afirmacoes: [...(tema === 'tecnica' || tema === 'artista' ? identidade.map((a) => a.id) : []), ...c.afirmacoes.flatMap((a, i) => (a.dimensao === tema ? [idsAfirmacoes[i]!] : []))],
  })).filter((e) => e.afirmacoes.length);
  const modelo: ModeloDaObraV1 = {
    ...base,
    id: id('modelo'), revisao: 1,
    regioes: c.regioes.map((r, i) => ({ id: idsRegioes[i]!, rotulo: r.rotulo, imagem_sha256: base.imagem.sha256, forma: r.forma })),
    afirmacoes: [...identidade, ...geradas],
    estudo,
    limites: [...c.limites, 'Análise gerada pelo algoritmo v2 (Codex) sobre um dossiê de fontes; candidata, sujeita a revisão humana.'],
  };
  return { modelo, idsAfirmacoes, idsRegioes };
}

/** Menor quadro de lados iguais (normalizados) que contém os dois retângulos, sem sair da obra. */
export function uniaoQuadrada(a: RetanguloDaObra, b: RetanguloDaObra): RetanguloDaObra {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.largura, b.x + b.largura), y1 = Math.max(a.y + a.altura, b.y + b.altura);
  const lado = Math.min(1, Math.max(x1 - x0, y1 - y0));
  if (lado >= 0.9) return QUADRO_INTEIRO;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const x = r(Math.max(0, Math.min(1 - lado, (x0 + x1) / 2 - lado / 2))), y = r(Math.max(0, Math.min(1 - lado, (y0 + y1) / 2 - lado / 2)));
  return { x, y, largura: Math.min(r(lado), r(1 - x)), altura: Math.min(r(lado), r(1 - y)) };
}

const contemCentro = (c: RetanguloDaObra, l: RetanguloDaObra): boolean => {
  const x = l.x + l.largura / 2, y = l.y + l.altura / 2;
  return x >= c.x && x <= c.x + c.largura && y >= c.y && y <= c.y + c.altura;
};

/** Roteiro → análise curta: câmera calculada pela região e pelo enquadramento, contínua entre batidas; tempo pelo núcleo. */
export function montarCurta(modelo: ModeloDaObraV1, r: RoteiroCandidato, idsAfirmacoes: string[], idsRegioes: string[]): AnaliseCurtaDaObraV1 {
  let anterior = QUADRO_INTEIRO;
  const batidas = r.batidas.map((b) => {
    const regiao = b.regiao === null ? null : modelo.regioes.find((x) => x.id === idsRegioes[b.regiao!]) ?? null;
    const para = enquadrarRegiao(regiao?.forma ?? null, regiao ? b.enquadramento : 'inteiro');
    // A câmera parte de onde a batida anterior parou; se a região nova não está ali, abre o bastante para contê-la.
    const alvo = regiao ? limitesDaRegiao(regiao.forma) : null;
    const camera = { de: !alvo || contemCentro(anterior, alvo) ? anterior : uniaoQuadrada(anterior, alvo), para };
    anterior = para;
    return {
      inicio_s: 0, fim_s: 1, narracao: b.narracao.trim(), legenda: b.narracao.trim(), papel: b.papel,
      afirmacoes: [...new Set(b.afirmacoes.map((a) => idsAfirmacoes[a]!))], regiao_id: regiao?.id ?? null, camera,
    };
  });
  return temporizarAnaliseCurta({
    versao: 1, obra_id: modelo.id, revisao_modelo: modelo.revisao, imagem_sha256: modelo.imagem.sha256,
    tese: r.tese.trim(), afirmacoes_da_tese: [...new Set(r.afirmacoes_da_tese.map((a) => idsAfirmacoes[a]!))], tempo: 'estimado', batidas,
  });
}
