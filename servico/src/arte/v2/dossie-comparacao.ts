/** Comparação determinística entre o dossiê curado e o automático (sem modelo). */
import type { ModeloDaObraV1 } from '@margem/contratos';
import type { DossieDaObra } from './acervo.js';
import { conteudo, normalizar } from './texto.js';

/** Fração dos radicais de conteúdo da frase que aparecem no corpus. */
function presenca(frase: string, corpus: Set<string>): number {
  const r = [...new Set(conteudo(frase))];
  return r.length ? r.filter((p) => corpus.has(p)).length / r.length : 0;
}

export function compararDossies(curado: DossieDaObra, referencia: ModeloDaObraV1, auto: DossieDaObra) {
  const corpusAuto = new Set(auto.fontes.flatMap((f) => conteudo(f.texto ?? '')));
  const curadoTexto = curado.fontes.reduce((s, f) => s + (f.texto?.length ?? 0), 0);
  const igual = (a: string, b: string) => { const x = normalizar(a), y = normalizar(b); return x.includes(y) || y.includes(x); };
  const fatos = referencia.afirmacoes.filter((a) => a.tipo === 'fato' || a.tipo === 'interpretacao_documentada');
  const cobertura = fatos.map((a) => ({ tipo: a.tipo, texto: a.texto, presenca: Math.round(presenca(a.texto, corpusAuto) * 100) / 100 }));
  return {
    identidade: { artista: igual(referencia.identidade.artista, auto.identidade.artista), data: normalizar(referencia.identidade.data).includes(normalizar(auto.identidade.data) || '§'), automatica: auto.identidade, curada: { artista: referencia.identidade.artista, data: referencia.identidade.data, tecnica: referencia.identidade.tecnica } },
    caracteres: { curado: curadoTexto, automatico: auto.fontes.reduce((s, f) => s + (f.texto?.length ?? 0), 0) },
    categorias: { curado: curado.fontes.map((f) => f.categoria), automatico: auto.fontes.map((f) => f.categoria) },
    fatos_curados_presentes_no_automatico: `${String(cobertura.filter((c) => c.presenca >= 0.6).length)}/${String(cobertura.length)}`,
    cobertura,
  };
}
