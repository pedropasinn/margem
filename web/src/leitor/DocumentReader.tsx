import { forwardRef, lazy, Suspense, useState } from 'react';
import type { ApiDoLeitor, SnapshotCapitulo } from './tipos';
import { ReaderViewport, type PropsDoLeitor } from './ReaderViewport';
import { LimiteDeErro } from '../ui/LimiteDeErro';
/** O módulo do PDF chega à parte (pdf.js é grande). Um import que falhou fica guardado pelo `lazy`: tentar de novo cria outro. */
const carregarPdf = () => lazy(() => import('./PdfReader').then((modulo) => ({ default: modulo.PdfReader })));
let PdfReaderPreguicoso = carregarPdf();
export const TextoReader = ReaderViewport;
export function usaPdf(snapshot: SnapshotCapitulo): boolean {
  return snapshot.formato === 'pdf' && snapshot.geometria_disponivel === true;
}
export const DocumentReader = forwardRef<ApiDoLeitor, PropsDoLeitor & { documento_id: string }>(function DocumentReader(props, ref) {
  const [PdfReader, trocarPdfReader] = useState(() => PdfReaderPreguicoso);
  // I-08: sem o limite, a rejeição do import (rede caiu, versão nova do app no meio) derrubava a tela inteira.
  const tentarDeNovo = () => { PdfReaderPreguicoso = carregarPdf(); trocarPdfReader(() => PdfReaderPreguicoso); };
  return usaPdf(props.snapshot)
    ? <LimiteDeErro titulo="Não foi possível abrir o PDF." aoTentar={tentarDeNovo}>
      <Suspense fallback={<p className="aviso-estudo" role="status">Abrindo PDF…</p>}><PdfReader {...props} ref={ref} /></Suspense>
    </LimiteDeErro>
    : <TextoReader {...props} ref={ref} />;
});
