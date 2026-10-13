import type { ReactNode } from 'react';
import { CONFIG } from '../config';

const ANCORAS = [
  { href: '#leitura', rotulo: 'Leitura' },
  { href: '#privacidade', rotulo: 'Privacidade' },
  { href: '#codigo-aberto', rotulo: 'Código aberto' },
] as const;

const PAGINAS = [
  { href: '/docs/', rotulo: 'Documentação', secao: 'docs' },
  { href: '/novidades/', rotulo: 'Novidades', secao: 'novidades' },
] as const;

export type Secao = 'inicio' | 'docs' | 'novidades' | 'legal';

export function Logotipo(): ReactNode {
  return (
    <a className="logotipo" href="/" aria-label={`${CONFIG.nome}, página inicial`}>
      <img src="/icone-512.png" alt="" width={32} height={32} />
      <span>{CONFIG.nome}</span>
    </a>
  );
}

/** Cabeçalho: na página inicial, as âncoras das seções; em todas, Documentação, Novidades e Baixar. */
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
        <a className="botao primario pequeno" href={inicio ? '#baixar' : '/#baixar'}>Baixar</a>
      </div>
    </header>
  );
}

const COLUNAS: { titulo: string; links: { href: string; rotulo: string }[] }[] = [
  { titulo: 'Produto', links: [
    { href: '/#baixar', rotulo: 'Baixar' },
    { href: '/novidades/', rotulo: 'Novidades' },
    { href: '/#integracoes', rotulo: 'Integrações' },
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
          <Logotipo />
          <p>{CONFIG.slogan}</p>
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
