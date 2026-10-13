import { useState, type CSSProperties } from 'react';
import { Icon } from './Icon';

export function Capa({ titulo, autor, formato, id, tamanho, icone, versao_id }: { titulo: string; autor: string | null; formato: string; id: string; tamanho: 'mini' | 'cartao'; icone?: string; versao_id?: string | null }) {
  const [falha, definirFalha] = useState<string | null>(null);
  const imagem = formato === 'pdf' && versao_id ? `/api/versoes/${versao_id}/capa` : null;
  const matizes = ['#a88c73', '#768f88', '#7e8da6', '#9983a0', '#af9465', '#a87775'];
  const hash = Array.from(id).reduce((valor, letra) => (valor * 31 + letra.charCodeAt(0)) >>> 0, 0);
  const estilo = { background: `color-mix(in oklab, ${matizes[hash % matizes.length]} 22%, var(--bg))` } satisfies CSSProperties;
  if (imagem && falha !== imagem) return <div className={`capa capa-${tamanho} capa-real`} style={estilo} aria-hidden="true">
    <img src={imagem} alt="" loading="lazy" onError={() => definirFalha(imagem)} />
  </div>;
  return <div className={`capa capa-${tamanho}`} style={estilo} aria-hidden="true"><span className="capa-titulo">{tamanho === 'mini' ? inicial(titulo) : titulo}</span><span className="capa-filete" />{tamanho === 'mini' ? (icone ? <span className="capa-icone" title={formato}><Icon name={icone} size={14} /></span> : <small>{formato}</small>) : <small>{autor}</small>}</div>;
}

/** A primeira letra ou algarismo do título: "[bancada] T50" vira "B", não "[". */
function inicial(titulo: string): string {
  return (/[\p{L}\p{N}]/u.exec(titulo)?.[0] ?? titulo.trim().slice(0, 1)).toLocaleUpperCase();
}
