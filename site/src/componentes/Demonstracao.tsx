import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MARCAS, PARAGRAFOS, PERGUNTA, ROTULO, type Marca } from '../demo/texto';
import { retangulosDoElemento, tracos, type Estilo, type Traco } from '../demo/tracos';
import { CONFIG } from '../config';

const INTERVALO_MS = 900;
const VAO_ENTRE_NOTAS = 20;

function prefereMenosMovimento(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Geometria { caminhos: Record<string, Traco[]>; topos: Record<string, number>; alturaMargem: number }

/**
 * Um trecho de leitura marcada, recriado com a linguagem do app: serifa, marcas desenhadas numa
 * camada SVG atrás das letras (o texto nunca recebe fundo nem peso), notas na margem à altura do
 * seu trecho. As marcas se desenham uma a uma quando a demonstração entra na tela.
 */
export function Demonstracao(): ReactNode {
  const raiz = useRef<HTMLElement>(null);
  const artigo = useRef<HTMLDivElement>(null);
  const margem = useRef<HTMLDivElement>(null);
  const [estilo, definirEstilo] = useState<Estilo>('marca_texto');
  const [atencao, definirAtencao] = useState<0 | 1 | 2 | 3>(3);
  const [fase, definirFase] = useState(0);
  const [ativa, definirAtiva] = useState<string | null>(null);
  const [geometria, definirGeometria] = useState<Geometria>({ caminhos: {}, topos: {}, alturaMargem: 0 });
  const [versaoDoLayout, definirVersaoDoLayout] = useState(0);

  const final = MARCAS.length + 1;

  // Revela as marcas uma a uma quando a demonstração aparece; sem animação se o leitor pediu menos movimento.
  useEffect(() => {
    if (prefereMenosMovimento() || typeof IntersectionObserver !== 'function') { definirFase(final); return; }
    let relogio: number | undefined;
    const observador = new IntersectionObserver((entradas) => {
      if (!entradas.some((e) => e.isIntersecting)) return;
      observador.disconnect();
      let atual = 0;
      relogio = window.setInterval(() => {
        atual += 1;
        definirFase(atual);
        if (atual >= final) window.clearInterval(relogio);
      }, INTERVALO_MS);
    }, { threshold: .35 });
    if (raiz.current) observador.observe(raiz.current);
    return () => { observador.disconnect(); window.clearInterval(relogio); };
  }, [final]);

  // Fontes e largura mudam a quebra das linhas: refaz a geometria.
  useEffect(() => {
    const refazer = (): void => { definirVersaoDoLayout((v) => v + 1); };
    void document.fonts?.ready.then(refazer);
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(refazer) : null;
    if (artigo.current) observador?.observe(artigo.current);
    return () => { observador?.disconnect(); };
  }, []);

  const medir = useCallback((): void => {
    const texto = artigo.current;
    if (!texto) return;
    const base = texto.getBoundingClientRect();
    const caminhos: Record<string, Traco[]> = {};
    const ancoras: Record<string, number> = {};
    for (const elemento of texto.querySelectorAll<HTMLElement>('[data-marca]')) {
      const id = elemento.dataset['marca'];
      if (!id) continue;
      const linhas = retangulosDoElemento(elemento, base);
      caminhos[id] = tracos(linhas, estilo, id);
      ancoras[id] = linhas[0]?.y ?? 0;
    }
    // Cada nota começa na altura do seu trecho, sem encostar na anterior.
    const topos: Record<string, number> = {};
    let fimAnterior = -Infinity;
    let alturaMargem = 0;
    const notas = margem.current?.querySelectorAll<HTMLElement>('[data-nota]') ?? [];
    for (const nota of notas) {
      const id = nota.dataset['nota'];
      if (!id || getComputedStyle(nota).position !== 'absolute') continue;
      const topo = Math.max(ancoras[id] ?? 0, fimAnterior + VAO_ENTRE_NOTAS);
      topos[id] = topo;
      fimAnterior = topo + nota.offsetHeight;
      alturaMargem = fimAnterior;
    }
    definirGeometria({ caminhos, topos, alturaMargem });
  }, [estilo]);

  useLayoutEffect(() => { medir(); }, [medir, versaoDoLayout, fase, atencao]);

  const visivel = (marca: Marca): boolean => marca.saliencia <= atencao;
  const revelada = (indice: number): boolean => fase > indice;
  const numero = (id: string): number => MARCAS.findIndex((m) => m.id === id) + 1;

  const opacidade = (id: string): string => {
    if (estilo === 'sublinhado') return ativa === null ? '.9' : id === ativa ? '1' : '.3';
    if (ativa === null) return 'var(--opacidade-marca)';
    return id === ativa ? '.6' : '.14';
  };

  return (
    <figure className="demo" ref={raiz} aria-labelledby="demo-legenda">
      <div className="demo-barra">
        <span className="demo-documento"><span aria-hidden="true">‹</span> Instinto de nacionalidade</span>
        <div className="demo-controles">
          <div className="demo-atencao" role="radiogroup" aria-label="Atenção: quantas marcas mostrar">
            <span className="demo-rotulo" aria-hidden="true">Atenção</span>
            {([0, 1, 2, 3] as const).map((nivel) => (
              <button key={nivel} type="button" role="radio" aria-checked={atencao === nivel}
                aria-label={['Texto puro', 'Só as essenciais', 'Essenciais e importantes', 'Todas as marcas'][nivel]}
                className="demo-ponto" data-cheio={nivel <= atencao}
                onClick={() => { definirAtencao(nivel); }} />
            ))}
          </div>
          <div className="demo-segmentado" role="radiogroup" aria-label="Estilo das marcas">
            {(['marca_texto', 'sublinhado'] as const).map((opcao) => (
              <button key={opcao} type="button" role="radio" aria-checked={estilo === opcao}
                onClick={() => { definirEstilo(opcao); }}>
                {opcao === 'marca_texto' ? 'Marca-texto' : 'Sublinhado'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="demo-corpo">
        <div className="demo-texto" ref={artigo} lang="pt-BR">
          <svg className="demo-marcas" aria-hidden="true" focusable="false">
            {MARCAS.map((marca, indice) => (
              <g key={marca.id} data-estado={!visivel(marca) ? 'oculta' : revelada(indice) ? 'desenhada' : 'aguardando'}
                style={{ '--cor': `var(--f-${marca.funcao})`, opacity: opacidade(marca.id) } as CSSProperties}>
                {(geometria.caminhos[marca.id] ?? []).map((traco, i) => (
                  <path key={i} d={traco.d} className={traco.preenchido ? 'faixa' : 'linha'} pathLength={traco.preenchido ? undefined : 1} />
                ))}
              </g>
            ))}
          </svg>
          <p className="demo-titulo">Notícia da atual literatura brasileira</p>
          {PARAGRAFOS.map((paragrafo, i) => (
            <p key={i} className="demo-paragrafo">
              {i === 2 && <span className="demo-elipse" aria-label="trecho omitido">[…] </span>}
              {paragrafo.map((segmento, j) => typeof segmento === 'string'
                ? <span key={j}>{segmento}</span>
                : (
                  <span key={j} data-marca={segmento.marca} className="demo-trecho"
                    onMouseEnter={() => { definirAtiva(segmento.marca); }} onMouseLeave={() => { definirAtiva(null); }}>
                    {segmento.texto}
                  </span>
                ))}
            </p>
          ))}
          <p className="demo-fonte">Machado de Assis, 1873 · domínio público</p>
        </div>

        <div className="demo-margem" ref={margem} style={{ minHeight: geometria.alturaMargem }} aria-label="Notas na margem">
          {MARCAS.map((marca, indice) => (
            <div key={marca.id} data-nota={marca.id} className="demo-nota"
              data-estado={!visivel(marca) ? 'oculta' : revelada(indice) ? 'visivel' : 'aguardando'}
              data-ativa={ativa === marca.id}
              style={{ top: geometria.topos[marca.id] ?? 0, '--cor': `var(--f-${marca.funcao})` } as CSSProperties}
              onMouseEnter={() => { definirAtiva(marca.id); }} onMouseLeave={() => { definirAtiva(null); }}>
              <p className="demo-nota-cabeca">
                <span className="demo-numero" aria-hidden="true">{numero(marca.id)}</span>
                {ROTULO[marca.funcao]}
              </p>
              <p className="demo-nota-texto">{marca.nota}</p>
              {marca.id === PERGUNTA.marca && fase >= final && visivel(marca) && (
                <div className="demo-conversa">
                  <p className="demo-pergunta"><span className="demo-quem">Você</span>{PERGUNTA.pergunta}</p>
                  <p className="demo-resposta"><span className="demo-quem">{CONFIG.nome}</span>{PERGUNTA.resposta}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <figcaption id="demo-legenda" className="demo-legenda">
        Demonstração recriada nesta página com a linguagem visual do {CONFIG.nome}. Mude a atenção e o estilo das marcas, ou passe o cursor sobre uma nota.
      </figcaption>
    </figure>
  );
}
