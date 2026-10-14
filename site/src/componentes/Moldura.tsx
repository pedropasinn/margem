import type { ReactNode } from 'react';
import { CONFIG } from '../config';
import { Assinatura } from './Marca';

const ANCORAS = [
  { href: '#estudar', rotulo: 'Recursos' },
  { href: '#biblioteca', rotulo: 'Formatos' },
] as const;

const PAGINAS = [
  { href: '/docs/obsidian/', rotulo: 'Plugin do Obsidian', secao: 'obsidian' },
  { href: '/docs/', rotulo: 'Documentação', secao: 'docs' },
  { href: '/novidades/', rotulo: 'Novidades', secao: 'novidades' },
] as const;

export type Secao = 'inicio' | 'download' | 'docs' | 'obsidian' | 'novidades' | 'legal';

/** A assinatura com link para a página inicial; no rodapé, com o lema ("Por uma formação integral"). */
export function Logotipo({ lema = false }: { lema?: boolean }): ReactNode {
  return (
    <a className={lema ? 'logotipo com-lema' : 'logotipo'} href="/" aria-label={`${CONFIG.nome}, página inicial`}>
      <Assinatura lema={lema} />
    </a>
  );
}

/** Cabeçalho: na página inicial, as âncoras das seções; em todas, Plugin do Obsidian, Documentação, Novidades e Baixar (a página de download). */
export function Cabecalho({ secao = 'legal' }: { secao?: Secao }): ReactNode {
  const inicio = secao === 'inicio';
  return (
    <header className="cabecalho">
      <div className="container cabecalho-linha">
        <Logotipo />
        <nav aria-label="Seções" className="cabecalho-nav">
          {inicio && ANCORAS.map((item) => <a key={item.href} className="so-largo" href={item.href}>{item.rotulo}</a>)}
          {PAGINAS.map((item) => (
            <a key={item.href} className={item.secao === 'docs' ? undefined : 'so-largo'} href={item.href} aria-current={secao === item.secao ? 'page' : undefined}>{item.rotulo}</a>
          ))}
        </nav>
        <a className="botao primario pequeno" href="/download/" aria-current={secao === 'download' ? 'page' : undefined}>Baixar</a>
      </div>
    </header>
  );
}

const COLUNAS: { titulo: string; links: { href: string; rotulo: string }[] }[] = [
  { titulo: 'Produto', links: [
    { href: '/download/', rotulo: 'Baixar' },
    { href: '/novidades/', rotulo: 'Novidades' },
    { href: '/docs/extensao/', rotulo: 'Extensão do navegador' },
    { href: '/docs/obsidian/', rotulo: 'Plugin do Obsidian' },
  ] },
  { titulo: 'Ajuda', links: [
    { href: '/docs/', rotulo: 'Documentação' },
    { href: '/docs/instalacao/', rotulo: 'Instalação' },
    { href: '/docs/perguntas/', rotulo: 'Perguntas frequentes' },
    { href: '/docs/problemas/', rotulo: 'Solução de problemas' },
  ] },
  { titulo: 'Projeto', links: [
    { href: CONFIG.urlDoRepositorio, rotulo: 'Código-fonte' },
    { href: '/docs/contribuir/', rotulo: 'Contribuir' },
    { href: '/privacidade/', rotulo: 'Privacidade' },
    { href: '/termos/', rotulo: 'Termos de uso' },
  ] },
];

export function Rodape(): ReactNode {
  return (
    <footer className="rodape">
      <div className="container rodape-linha">
        <div className="rodape-marca">
          <Logotipo lema />
        </div>
        {COLUNAS.map((coluna) => (
          <nav key={coluna.titulo} aria-label={coluna.titulo} className="rodape-coluna">
            <p>{coluna.titulo}</p>
            <ul role="list">{coluna.links.map((l) => <li key={l.href}><a href={l.href}>{l.rotulo}</a></li>)}</ul>
          </nav>
        ))}
        <p className="rodape-nota">{CONFIG.nome} {CONFIG.versao} · código aberto sob a licença {CONFIG.licenca} · feito no Brasil, 2026.</p>
      </div>
    </footer>
  );
}
