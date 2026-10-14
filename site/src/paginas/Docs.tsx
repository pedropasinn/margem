import type { ReactNode } from 'react';
import { Icone } from '../componentes/Icone';
import { Cabecalho, Rodape } from '../componentes/Moldura';
import { CONFIG } from '../config';
import { GRUPOS, PAGINAS_DE_DOCS, type PaginaDeDoc } from '../docs/paginas';

const hrefDe = (slug: string): string => `/docs/${slug}/`;

/** Navegação lateral: grupos com links. No celular vira um bloco recolhível acima do texto. */
function Navegacao({ atual }: { atual: string | null }): ReactNode {
  const lista = (
    <>
      <a className="docs-nav-inicio" href="/docs/" aria-current={atual === null ? 'page' : undefined}>Visão geral</a>
      {GRUPOS.map((grupo) => (
        <div key={grupo} className="docs-nav-grupo">
          <p>{grupo}</p>
          <ul role="list">
            {PAGINAS_DE_DOCS.filter((p) => p.grupo === grupo).map((p) => (
              <li key={p.slug}><a href={hrefDe(p.slug)} aria-current={p.slug === atual ? 'page' : undefined}>{p.titulo}</a></li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
  const tituloAtual = PAGINAS_DE_DOCS.find((p) => p.slug === atual)?.titulo ?? 'Visão geral';
  return (
    <>
      <nav className="docs-nav docs-nav-larga" aria-label="Documentação">{lista}</nav>
      <details className="docs-nav docs-nav-estreita">
        <summary><span className="docs-nav-rotulo">Documentação</span><span>{tituloAtual}</span><span className="faq-sinal" aria-hidden="true" /></summary>
        <nav aria-label="Documentação">{lista}</nav>
      </details>
    </>
  );
}

function Indice(): ReactNode {
  return (
    <>
      <h1>Documentação</h1>
      <p className="docs-resumo">Tudo para instalar, usar e manter o {CONFIG.nome}, o seu assistente de estudos, no seu computador.</p>
      {GRUPOS.map((grupo) => (
        <section key={grupo} className="docs-indice-grupo" aria-label={grupo}>
          <h2>{grupo}</h2>
          <ul className="docs-cartoes" role="list">
            {PAGINAS_DE_DOCS.filter((p) => p.grupo === grupo).map((p) => (
              <li key={p.slug}>
                <a className="cartao docs-cartao" href={hrefDe(p.slug)}>
                  <h3>{p.titulo}</h3>
                  <p>{p.resumo}</p>
                  <span className="link-seta">Abrir<Icone nome="seta" tamanho={16} /></span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Artigo({ pagina }: { pagina: PaginaDeDoc }): ReactNode {
  const i = PAGINAS_DE_DOCS.indexOf(pagina);
  const anterior = PAGINAS_DE_DOCS[i - 1];
  const proxima = PAGINAS_DE_DOCS[i + 1];
  return (
    <>
      <p className="sobretitulo">{pagina.grupo}</p>
      <h1>{pagina.titulo}</h1>
      <p className="docs-resumo">{pagina.resumo}</p>
      <div className="docs-corpo">{pagina.corpo()}</div>
      <nav className="docs-vizinhas" aria-label="Páginas vizinhas">
        {anterior ? <a className="cartao" href={hrefDe(anterior.slug)}><span>Anterior</span>{anterior.titulo}</a> : <span />}
        {proxima && <a className="cartao docs-proxima" href={hrefDe(proxima.slug)}><span>Próxima</span>{proxima.titulo}</a>}
      </nav>
    </>
  );
}

/** Página da documentação. `slug` nulo é a visão geral (/docs/). */
export function PaginaDeDocs({ slug }: { slug: string | null }): ReactNode {
  const pagina = slug === null ? undefined : PAGINAS_DE_DOCS.find((p) => p.slug === slug);
  if (slug !== null && !pagina) throw new Error(`Página de documentação desconhecida: ${slug}`);
  return (
    <>
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <Cabecalho secao={slug === 'obsidian' ? 'obsidian' : 'docs'} />
      <div className="container docs-grade">
        <Navegacao atual={slug} />
        <main id="conteudo" className="docs-artigo">
          {pagina ? <Artigo pagina={pagina} /> : <Indice />}
        </main>
      </div>
      <Rodape />
    </>
  );
}
