import { Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icone } from './Icone';

/*
 * "Outras formas de estudar": uma superfície só, com abas, e em cada aba o próprio app. Os componentes
 * do app (e o CSS, a obra, o KaTeX) chegam sob demanda, quando a seção se aproxima da tela, para não
 * pesar na abertura da página.
 */
const DemoDoQuadro = lazy(() => import('../demos/DemoDoQuadro'));
const DemoDoExercicio = lazy(() => import('../demos/DemoDoExercicio'));
const DemoDoObsidian = lazy(() => import('../demos/DemoDoObsidian'));

type Aba = 'quadros' | 'exercicios' | 'obsidian';
const ABAS: { id: Aba; rotulo: string; texto: ReactNode; dica: string; link: { href: string; rotulo: string } }[] = [
  {
    id: 'quadros', rotulo: 'Obras de arte',
    texto: 'Traga a imagem de uma obra. O Margem procura as fontes e prepara uma análise que separa o que se vê, o que está documentado e o que é interpretação.',
    dica: 'A obra de exemplo que vem com o app. Clique numa região, em Percorrer ou na análise curta.',
    link: { href: '/docs/quadros/', rotulo: 'Como funciona Quadros' },
  },
  {
    id: 'exercicios', rotulo: 'Exercícios',
    texto: <>Cole o print de uma questão (<kbd>Ctrl</kbd>+<kbd>V</kbd>) ou recorte-a no PDF. A ideia vem antes da conta, e cada passo só aparece quando você pede.</>,
    dica: 'O painel de resolução do app. Avance com a seta, veja todos os passos ou volte um.',
    link: { href: '/docs/questoes/', rotulo: 'Como resolver questões' },
  },
  {
    id: 'obsidian', rotulo: 'Obsidian',
    texto: 'Grifos, notas e perguntas vão para o seu cofre em Markdown, com o link de volta para o trecho. O plugin mantém tudo em dia sozinho.',
    dica: 'A nota do recorte lá de cima, escrita agora pelo exportador do app.',
    link: { href: '/docs/obsidian/', rotulo: 'Plugin do Obsidian' },
  },
];

function Demo({ aba }: { aba: Aba }): ReactNode {
  if (aba === 'quadros') return <DemoDoQuadro />;
  if (aba === 'exercicios') return <DemoDoExercicio />;
  return <DemoDoObsidian />;
}

export function OutrasFormas(): ReactNode {
  const secao = useRef<HTMLElement>(null);
  const abas = useRef<HTMLDivElement>(null);
  const [aba, escolher] = useState<Aba>('quadros');
  const [perto, aproximar] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') { aproximar(true); return; }
    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) { aproximar(true); observador.disconnect(); }
    }, { rootMargin: '800px 0px' });
    if (secao.current) observador.observe(secao.current);
    return () => { observador.disconnect(); };
  }, []);

  const teclar = (evento: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evento.key)) return;
    evento.preventDefault();
    const atual = ABAS.findIndex((a) => a.id === aba);
    const proxima = evento.key === 'Home' ? 0 : evento.key === 'End' ? ABAS.length - 1 : (atual + (evento.key === 'ArrowRight' ? 1 : -1) + ABAS.length) % ABAS.length;
    escolher(ABAS[proxima]!.id);
    abas.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[proxima]?.focus();
  };

  const atual = ABAS.find((a) => a.id === aba) ?? ABAS[0]!;
  return (
    <section id="estudar" ref={secao} className="secao estudar" aria-labelledby="estudar-titulo">
      <div className="container">
        <h2 id="estudar-titulo" className="titulo-de-secao">Uma obra, uma questão, o seu cofre de notas.</h2>
        <div className="abas" role="tablist" aria-label="Outras formas de estudar" ref={abas} onKeyDown={teclar}>
          {ABAS.map((a) => (
            <button key={a.id} type="button" role="tab" id={`aba-${a.id}`} aria-controls="estudar-painel" aria-selected={aba === a.id}
              tabIndex={aba === a.id ? 0 : -1} onClick={() => { escolher(a.id); }}>{a.rotulo}</button>
          ))}
        </div>
        <div id="estudar-painel" role="tabpanel" aria-labelledby={`aba-${aba}`} className="estudar-painel">
          <div className="estudar-texto">
            <p>{atual.texto}</p>
            <p className="estudar-dica">{atual.dica}</p>
            <a className="link-seta" href={atual.link.href}>{atual.link.rotulo}<Icone nome="seta" tamanho={16} /></a>
          </div>
          <div className={`estudar-demo estudar-demo-${aba}`}>
            {perto
              ? <Suspense fallback={<p className="estudar-carregando" role="status">Abrindo o app…</p>}><Demo key={aba} aba={aba} /></Suspense>
              : <p className="estudar-carregando">Abrindo o app…</p>}
          </div>
        </div>
        <p className="estudar-videos">
          Vídeos do YouTube e áudios também entram: o texto acompanha a fala, e um clique leva o vídeo até o trecho.{' '}
          <a href="/docs/videos/">Vídeos no Margem</a>
        </p>
      </div>
    </section>
  );
}
