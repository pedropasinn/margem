import { medirPdf } from './pdf';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChapterContent } from '../src/leitor/ChapterContent';
import { capituloExemplo } from '../src/leitor/fixtures/capitulo-exemplo';
import type { SnapshotCapitulo } from '../src/leitor/tipos';
import { segmentar } from '../src/leitor/segmentos';
// Corpus sintético determinístico: nenhum texto do usuário é exposto pelo benchmark.
const quantidade = 1200;
const texto = 'Um parágrafo de estudo com uma afirmação e sua justificativa. '.repeat(8);
const blocos = Array.from({ length: quantidade }, (_, i) => ({ ...capituloExemplo.blocos[1]!, tipo: 'paragrafo' as const, id: `bloco-${i}`, ordem: i, texto, inline: [] }));
const marcas = blocos.map((b, i) => ({ ...capituloExemplo.marcas[0]!, id: `marca-${i}`, ancora: { ...capituloExemplo.marcas[0]!.ancora, bloco_id: b.id, inicio_utf16: 0, fim_utf16: 12, citacao: texto.slice(0, 12), prefixo: '', sufixo: '' }, subfaixas: [] }));
const snapshot: SnapshotCapitulo = { ...capituloExemplo, blocos, marcas, assets: {}, ilustracoes: [] };
const root = createRoot(document.getElementById('root')!);
const quadro = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function medir() {
  const segmentacao: number[] = [], montagem: number[] = [], hover: number[] = [];
  for (let rodada = 0; rodada < 5; rodada++) {
    let t = performance.now(); for (const b of blocos) segmentar(b, marcas); segmentacao.push(performance.now() - t);
    flushSync(() => root.render(null));
    t = performance.now(); flushSync(() => root.render(<ChapterContent snapshot={snapshot} />)); montagem.push(performance.now() - t);
    await quadro(); await quadro();
    for (let i = 0; i < 8; i++) { t = performance.now(); flushSync(() => root.render(<ChapterContent snapshot={snapshot} ativa={marcas[i]!.id} />)); hover.push(performance.now() - t); }
  }
  const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
  const resultado = { blocos: blocos.length, marcas: marcas.length, segmentacao_ms: mediana(segmentacao), montagem_ms: mediana(montagem), hover_ms: mediana(hover), texto_preservado: blocos.every(b => document.querySelector(`[data-bloco="${b.id}"]`)?.textContent === b.texto) };
  document.body.dataset.resultado = JSON.stringify({ texto: resultado, pdf: medirPdf() });
}
void medir();
