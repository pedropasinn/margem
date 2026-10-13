import type { AnaliseCurtaDaObraV1, FormaDaRegiao, ModeloDaObraV1, RetanguloDaObra } from '@margem/contratos';
import { duracaoEstimada } from './visita';

export const QUADRO_INTEIRO: RetanguloDaObra = { x: 0, y: 0, largura: 1, altura: 1 };
export function limitesDaRegiao(forma: FormaDaRegiao): RetanguloDaObra {
  if (forma.tipo === 'bbox') return { x: forma.x, y: forma.y, largura: forma.largura, altura: forma.altura };
  if (forma.tipo === 'ponto') return { x: Math.max(0, Math.min(.92, forma.x - .04)), y: Math.max(0, Math.min(.92, forma.y - .04)), largura: .08, altura: .08 };
  const xs = forma.pontos.map(p => p.x), ys = forma.pontos.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), largura: Math.max(...xs) - Math.min(...xs), altura: Math.max(...ys) - Math.min(...ys) };
}
export function retanguloValido(r: RetanguloDaObra): boolean {
  return [r.x, r.y, r.largura, r.altura].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.largura > 0 && r.altura > 0 && r.x + r.largura <= 1 + 1e-9 && r.y + r.altura <= 1 + 1e-9;
}
export function cameraNoInstante(curta: AnaliseCurtaDaObraV1, segundo: number): RetanguloDaObra {
  const b = curta.batidas.find(b => segundo >= b.inicio_s && segundo < b.fim_s) ?? curta.batidas.at(-1);
  if (!b) return QUADRO_INTEIRO;
  const t = Math.max(0, Math.min(1, (segundo - b.inicio_s) / (b.fim_s - b.inicio_s)));
  const u = t * t * (3 - 2 * t);
  const de = b.camera.de, para = b.camera.para;
  return { x: de.x + (para.x - de.x) * u, y: de.y + (para.y - de.y) * u, largura: de.largura + (para.largura - de.largura) * u, altura: de.altura + (para.altura - de.altura) * u };
}
/** Regras contextuais: chamar depois da validação estrutural do contrato. */
export function conferirModeloDaObra(m: ModeloDaObraV1): string[] {
  const erros: string[] = [];
  const af = new Map(m.afirmacoes.map(a => [a.id, a]));
  const fontes = new Set(m.fontes.map(f => f.id)), regioes = new Set(m.regioes.map(r => r.id));
  const ids = [m.id, ...af.keys(), ...fontes, ...regioes];
  if (new Set(ids).size !== 1 + m.afirmacoes.length + m.fontes.length + m.regioes.length) erros.push('ids_duplicados');
  if (!fontes.has(m.imagem.fonte_id)) erros.push('fonte_imagem_ausente');
  for (const f of m.localizacao.fontes) if (!fontes.has(f)) erros.push('fonte_localizacao_ausente');
  if ((m.localizacao.instituicao_proprietaria || m.localizacao.localizacao_conhecida || m.localizacao.atualmente_exposto !== null || m.localizacao.sala) && !m.localizacao.fontes.length) erros.push('localizacao_sem_fonte');
  if (m.localizacao.sala && m.localizacao.atualmente_exposto !== true) erros.push('sala_sem_exposicao_confirmada');
  for (const r of m.regioes) {
    if (r.imagem_sha256 !== m.imagem.sha256) erros.push('ancora_de_outra_imagem');
    if (!retanguloValido(limitesDaRegiao(r.forma))) erros.push('regiao_fora_da_imagem');
    if (r.forma.tipo === 'poligono') {
      const p = r.forma.pontos;
      const area = Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]!; return s + a.x * b.y - b.x * a.y; }, 0));
      if (area < 1e-8) erros.push('poligono_degenerado');
    }
  }
  const visitando = new Set<string>(), visitados = new Set<string>();
  function visitar(id: string): void {
    if (visitando.has(id)) { erros.push('apoios_ciclicos'); return; }
    if (visitados.has(id)) return;
    visitando.add(id);
    for (const apoio of af.get(id)?.apoios ?? []) visitar(apoio);
    visitando.delete(id); visitados.add(id);
  }
  for (const a of m.afirmacoes) {
    if (a.fontes.some(f => !fontes.has(f)) || a.regioes.some(r => !regioes.has(r)) || a.apoios.some(id => !af.has(id))) erros.push('referencia_ausente');
    if (['fato', 'interpretacao_documentada'].includes(a.tipo) && !a.fontes.length) erros.push('afirmacao_documentada_sem_fonte');
    if (a.tipo === 'observacao' && !a.regioes.length) erros.push('observacao_sem_regiao');
    if (a.tipo === 'inferencia_ia' && (!a.apoios.length || a.proveniencia.autor !== 'ia')) erros.push('inferencia_sem_apoio_ou_autor');
    if (a.tipo === 'intencao_desconhecida' && a.confianca !== 'nao_aplicavel') erros.push('intencao_com_certeza');
    visitar(a.id);
  }
  if (m.identidade.afirmacoes.some(id => af.get(id)?.tipo !== 'fato')) erros.push('identidade_sem_fato');
  for (const e of m.estudo) if (e.afirmacoes.some(id => !af.has(id))) erros.push('estudo_sem_apoio');
  return [...new Set(erros)];
}
export function conferirAnaliseCurta(c: AnaliseCurtaDaObraV1, m: ModeloDaObraV1): string[] {
  const erros: string[] = [];
  if (c.obra_id !== m.id || c.revisao_modelo !== m.revisao || c.imagem_sha256 !== m.imagem.sha256) erros.push('projecao_desatualizada');
  const ids = new Set(m.afirmacoes.map(a => a.id));
  if (c.afirmacoes_da_tese.some(id => !ids.has(id))) erros.push('tese_sem_apoio');
  let fim = 0;
  for (const b of c.batidas) {
    if (Math.abs(b.inicio_s - fim) > .001 || b.fim_s <= b.inicio_s) erros.push('timeline_descontinua');
    if (b.fim_s - b.inicio_s + .1 < duracaoEstimada(b.narracao)) erros.push('fala_apressada');
    fim = b.fim_s;
    if (b.afirmacoes.some(id => !ids.has(id))) erros.push('batida_sem_apoio');
    const r = m.regioes.find(r => r.id === b.regiao_id);
    if (b.regiao_id && !r) erros.push('regiao_ausente');
    if (b.papel === 'evidencia_visual' && (!r || !m.afirmacoes.some(a => b.afirmacoes.includes(a.id) && a.regioes.includes(r.id)))) erros.push('fala_sem_ancora');
    for (const camera of [b.camera.de, b.camera.para]) {
      if (!retanguloValido(camera)) erros.push('camera_fora_da_imagem');
      if (r) {
        const l = limitesDaRegiao(r.forma); const x = l.x + l.largura / 2, y = l.y + l.altura / 2;
        if (x < camera.x || x > camera.x + camera.largura || y < camera.y || y > camera.y + camera.altura) erros.push('regiao_fora_da_camera');
      }
    }
  }
  if (fim < 20 || fim > 60) erros.push('duracao_fora_do_formato');
  return [...new Set(erros)];
}

/** O texto vem do modelo; a aritmética do tempo estimado pertence ao núcleo. */
export function temporizarAnaliseCurta(curta: AnaliseCurtaDaObraV1): AnaliseCurtaDaObraV1 {
  let cursor = 0;
  return { ...curta, batidas: curta.batidas.map(b => {
    const inicio_s = cursor;
    cursor = Math.round((cursor + duracaoEstimada(b.narracao) + .35) * 100) / 100;
    return { ...b, inicio_s, fim_s: cursor };
  }) };
}

/** Como a câmera mostra uma região: a obra inteira, a região com o entorno, ou o detalhe. */
export type EnquadramentoDaCamera = 'inteiro' | 'meio' | 'detalhe';

function arredondar(v: number): number { return Math.round(v * 1000) / 1000; }

/**
 * Câmera determinística para uma região: um retângulo com a proporção da própria imagem (lado igual nas
 * coordenadas normalizadas) que contém a região inteira com folga, sem sair da obra. "detalhe" deixa
 * 18% de folga e lado mínimo 0,16; "meio" mostra a região com o entorno (lado ≥ 0,5). Sem região, ou
 * "inteiro", devolve o quadro inteiro.
 */
export function enquadrarRegiao(forma: FormaDaRegiao | null, enquadramento: EnquadramentoDaCamera): RetanguloDaObra {
  if (!forma || enquadramento === 'inteiro') return QUADRO_INTEIRO;
  const l = limitesDaRegiao(forma);
  const folga = enquadramento === 'detalhe' ? 1.36 : 1.8;
  const minimo = enquadramento === 'detalhe' ? 0.16 : 0.5;
  const lado = Math.min(1, Math.max(minimo, Math.max(l.largura, l.altura) * folga));
  if (lado >= 0.9) return QUADRO_INTEIRO;
  const cx = l.x + l.largura / 2, cy = l.y + l.altura / 2;
  const x = Math.max(0, Math.min(1 - lado, cx - lado / 2)), y = Math.max(0, Math.min(1 - lado, cy - lado / 2));
  const r = { x: arredondar(x), y: arredondar(y), largura: arredondar(lado), altura: arredondar(lado) };
  return { ...r, largura: Math.min(r.largura, arredondar(1 - r.x)), altura: Math.min(r.altura, arredondar(1 - r.y)) };
}

/** Se `externo` contém `interno` inteiro (com tolerância de arredondamento). */
export function contemRetangulo(externo: RetanguloDaObra, interno: RetanguloDaObra, tolerancia = 0.002): boolean {
  return interno.x >= externo.x - tolerancia && interno.y >= externo.y - tolerancia
    && interno.x + interno.largura <= externo.x + externo.largura + tolerancia
    && interno.y + interno.altura <= externo.y + externo.altura + tolerancia;
}

/** Interseção sobre união de dois retângulos normalizados (0 quando não se tocam). */
export function iouDeRetangulos(a: RetanguloDaObra, b: RetanguloDaObra): number {
  const largura = Math.min(a.x + a.largura, b.x + b.largura) - Math.max(a.x, b.x);
  const altura = Math.min(a.y + a.altura, b.y + b.altura) - Math.max(a.y, b.y);
  if (largura <= 0 || altura <= 0) return 0;
  const intersecao = largura * altura;
  return intersecao / (a.largura * a.altura + b.largura * b.altura - intersecao);
}
