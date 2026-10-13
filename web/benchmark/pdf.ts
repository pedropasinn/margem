import type { AncoraV1, PalavraGeometria } from '@margem/contratos';
import { quadsDaAncora } from '../../core/src/geometria';
import { agruparPor, consultarQuads, porPaginaDaAncora } from '../src/leitor/indices';

/** Mede somente a preparação/consulta das marcas PDF, não rasterização do canvas. */
export function medirPdf() {
  const palavras: PalavraGeometria[] = Array.from({ length: 120000 }, (_, i) => ({ bloco_id: `B${Math.floor(i / 100)}`,
    pagina: Math.floor(i / 1200) + 1, inicio_utf16: (i % 100) * 6, fim_utf16: (i % 100) * 6 + 5,
    quad: [0, i % 1200, 50, i % 1200, 50, i % 1200 + 10, 0, i % 1200 + 10],
  }));
  const marcas = Array.from({ length: 1200 }, (_, i) => ({ id: `M${i}`, ancora: { versao_id: 'V', bloco_id: `B${i}`,
    inicio_utf16: 0, fim_utf16: 5, citacao: 'teste', prefixo: '', sufixo: '' } satisfies AncoraV1 }));
  const t = performance.now();
  const porBloco = agruparPor(palavras, p => p.bloco_id), quads = consultarQuads('V', porBloco);
  const paginas = porPaginaDaAncora(marcas, quads);
  const indexacao = performance.now() - t;
  const antes: number[] = [], depois: number[] = [];
  let a = 0, b = 0;
  for (let rodada = 0; rodada < 5; rodada++) {
    let inicio = performance.now(); a = 0;
    for (let pagina = 1; pagina <= 100; pagina++) for (const m of marcas) a += quadsDaAncora(m.ancora, { versao_id: 'V', palavras: porBloco.get(m.ancora.bloco_id) ?? [] }).find(g => g.pagina === pagina)?.quads.length ?? 0;
    antes.push(performance.now() - inicio); inicio = performance.now(); b = 0;
    for (let pagina = 1; pagina <= 100; pagina++) for (const m of paginas.get(pagina) ?? []) b += quads(m.ancora).find(g => g.pagina === pagina)?.quads.length ?? 0;
    depois.push(performance.now() - inicio);
  }
  const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[2]!;
  return { paginas: 100, palavras: palavras.length, marcas: marcas.length, indexacao_ms: indexacao,
    consulta_anterior_ms: mediana(antes), consulta_indexada_ms: mediana(depois), quads_iguais: a === b && b === 1200 };
}
