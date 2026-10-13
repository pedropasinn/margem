import { forwardRef, lazy, Suspense } from 'react';
import type { ApiDoLeitor, SnapshotCapitulo } from './tipos';
import { ReaderViewport, type PropsDoLeitor } from './ReaderViewport';
const PdfReader = lazy(() => import('./PdfReader').then((modulo) => ({ default: modulo.PdfReader })));
export const TextoReader = ReaderViewport;
export function usaPdf(snapshot: SnapshotCapitulo): boolean {
  return snapshot.formato === 'pdf' && snapshot.geometria_disponivel === true;
}
export const DocumentReader = forwardRef<ApiDoLeitor, PropsDoLeitor & { documento_id: string }>(function DocumentReader(props, ref) {
  return usaPdf(props.snapshot)
    ? <Suspense fallback={<p className="aviso-estudo" role="status">Abrindo PDF…</p>}><PdfReader {...props} ref={ref} /></Suspense>
    : <TextoReader {...props} ref={ref} />;
});
