import type { MarcaDoLeitor } from './f2';
import { memo, type ReactNode } from 'react';
import type { Bloco, Id } from '@margem/contratos';
import type { FormatoDaFonte } from './tipos';
import { AnnotatedText, linhasDaTabela } from './AnnotatedText';

export interface PropsDoBloco {
  bloco: Bloco;
  formatacao?: FormatoDaFonte | undefined;
  antes?: ReactNode;
  depois?: ReactNode;
  marcas: readonly MarcaDoLeitor[];
  assets: Record<Id, string>;
  /** Blocos `lista` consecutivos são agrupados por `ChapterContent` num único `ul`. */
  comoItemDeLista?: boolean;
  /** Marca ativa (J09), repassada até `AnnotatedText`. */
  ativa?: Id | null;
}

/** Atributos que permitem converter uma seleção do DOM em offset canônico. */
function ancoragem(bloco: Bloco): { 'data-bloco': Id; 'data-inicio': number; 'data-tipo': Bloco['tipo'] } {
  return { 'data-bloco': bloco.id, 'data-inicio': 0, 'data-tipo': bloco.tipo };
}

/** O marcador que o motor põe no lugar de uma imagem do EPUB: `[Imagem]` ou `[Imagem: <alt>]`. */
const MARCADOR_DE_IMAGEM = /^\[Imagem(?:: ([^]*))?\]$/;

function legenda(bloco: Bloco, marcas: readonly MarcaDoLeitor[], assets: Record<Id, string>, ativa: Id | null, formatacao?: FormatoDaFonte): ReactNode {
  const url = bloco.asset_id === undefined ? undefined : assets[bloco.asset_id];
  const texto = <AnnotatedText bloco={bloco} marcas={marcas} ativa={ativa} formatacao={formatacao} />;
  // Tabela do EPUB com linhas e células inequívocas: grade de verdade (os separadores seguem no DOM).
  if (bloco.tipo === 'tabela' && linhasDaTabela(bloco.texto)) {
    return <figure className={`bloco bloco-${bloco.tipo}`} {...ancoragem(bloco)}><span className="tabela" role="table">{texto}</span></figure>;
  }
  // Com a imagem na tela, o marcador "[Imagem: …]" não é legenda: vira só o texto alternativo. O texto
  // fica no DOM (oculto) para os offsets do bloco; sem a imagem, o marcador continua visível.
  const marcador = url === undefined ? null : MARCADOR_DE_IMAGEM.exec(bloco.texto);
  return (
    <figure className={`bloco bloco-${bloco.tipo}`} {...ancoragem(bloco)}>
      {url === undefined ? null : <img className="asset" src={url} alt={marcador ? (marcador[1] ?? '') : bloco.texto} />}
      <figcaption className="legenda" {...(marcador ? { hidden: true } : {})}>{texto}</figcaption>
    </figure>
  );
}

/** Um elemento por tipo de bloco; o texto sempre passa por `AnnotatedText`. */
export const BlockRenderer = memo(function BlockRenderer({ bloco, marcas, assets, comoItemDeLista = false, ativa = null, antes, depois, formatacao }: PropsDoBloco): ReactNode {
  const texto = <AnnotatedText bloco={bloco} marcas={marcas} ativa={ativa} formatacao={formatacao} />;
  const atributos = ancoragem(bloco);
  const classe = `bloco bloco-${bloco.tipo}`;

  if (comoItemDeLista) return <li className={classe} data-marcador={formatacao?.marcador} {...atributos}>{antes}{texto}{depois}</li>;

  switch (bloco.tipo) {
    case 'capitulo':
      return <h2 className={classe} {...atributos}>{texto}</h2>;
    case 'secao':
      return <h3 className={classe} {...atributos}>{texto}</h3>;
    case 'citacao':
      return <blockquote className={classe} {...atributos}>{texto}</blockquote>;
    case 'codigo':
      return <pre className={classe} {...atributos}><code>{texto}</code></pre>;
    case 'equacao':
    case 'figura':
    case 'tabela':
      return legenda(bloco, marcas, assets, ativa, formatacao);
    case 'nota_rodape':
      return <aside className={classe} {...atributos}>{texto}</aside>;
    case 'epigrafe':
      return <p className={`${classe} epigrafe`} {...atributos}>{texto}</p>;
    case 'legenda':
      return <p className={`${classe} legenda`} {...atributos}>{texto}</p>;
    case 'lista':
      return <ul className="lista"><li className={classe} {...atributos}>{texto}</li></ul>;
    case 'estrofe':
      return <p className={classe} {...atributos}>{texto}</p>;
    case 'paragrafo':
      return <p className={classe} {...atributos}>{texto}</p>;
  }
});
