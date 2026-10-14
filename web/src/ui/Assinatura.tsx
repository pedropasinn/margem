import type { ReactNode } from 'react';
import { ARCO, ASSINATURA, ASSINATURA_CURTA } from './marca-dados';

/**
 * Assinatura do Margem (docs/identidade/): o arco de cinco segmentos seguido de "Margem" em contorno
 * (Inter Display ExtraBold); com `lema`, "Por uma formação integral" embaixo. As cores da palavra e
 * do lema vêm de `--marca-palavra` e `--marca-lema` (tokens.css), que seguem o tema do app.
 * Decorativa: quem a usa dá o nome acessível (o link ou o título ao lado).
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
