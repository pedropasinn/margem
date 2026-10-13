import type { ReactNode } from 'react';

/** Captura real do app (public/app), com a versão escura quando o sistema está no escuro. */
export function Captura({ nome, alt, className, largura = 2880, altura = 1800 }: { nome: string; alt: string; className?: string; largura?: number; altura?: number }): ReactNode {
  return (
    <figure className={className ? `captura ${className}` : 'captura'}>
      <picture>
        <source srcSet={`/app/${nome}-escuro.png`} media="(prefers-color-scheme: dark)" />
        <img src={`/app/${nome}-claro.png`} alt={alt} width={largura} height={altura} decoding="async" />
      </picture>
    </figure>
  );
}
