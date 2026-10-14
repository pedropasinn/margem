import type { ReactNode } from 'react';
import { ARCO, ASSINATURA, ASSINATURA_CURTA } from './marca-dados';

/**
 * Assinatura do Margem (docs/identidade/): o arco de cinco segmentos seguido de "Margem" em contorno
 * (Inter Display ExtraBold); com `lema`, "Por uma formação integral" embaixo. A cor da palavra e do
 * lema vem de `--marca-palavra` e `--marca-lema`, que trocam com o tema.
 */
export function Assinatura({ lema = false, className }: { lema?: boolean; className?: string }): ReactNode {
  const a = lema ? ASSINATURA : ASSINATURA_CURTA;
  return (
    <svg className={['assinatura', className].filter(Boolean).join(' ')} viewBox={a.viewBox} aria-hidden="true" focusable="false">
      {ARCO.map((s) => <path key={s.cor} d={s.d} fill={s.cor} />)}
      <path className="assinatura-palavra" d={a.palavra} />
      {lema && <path className="assinatura-lema" d={ASSINATURA.lema} />}
    </svg>
  );
}
