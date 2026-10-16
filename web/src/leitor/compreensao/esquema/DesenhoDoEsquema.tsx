/**
 * O desenho do esquema do capítulo, no estilo dos fluxogramas didáticos: as partes do capítulo em
 * faixas de cor, de cima para baixo; cada ideia numa forma que diz o que ela é (pílula para tese e
 * conclusão, hexágono para questão, caixa com barras para mecanismo…), com a cor e o ícone do tipo;
 * setas com rótulo curto (cheias no fio principal, tracejadas nas ligações laterais).
 *
 * Arrastar move; a roda rola (com Ctrl ou ⌘, aproxima); os botões aproximam, afastam e ajustam;
 * dois dedos aproximam. Passar o ponteiro (ou o foco) num nó mostra o que ele diz e o trecho;
 * clicar (ou Enter) leva ao trecho no texto.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { AncoraV1, EsquemaDoCapituloV1, TipoDoNoDoEsquema } from '@margem/contratos';
import { Icon } from '../../../ui/Icon';
import { textoNoSistema } from '../../../ui/teclas';
import {
  ESPACO_DO_ICONE, ICONE, MEDIDAS_ESTREITAS, MEDIDAS_LARGAS, caminhoArredondado, calcularLayout, carregarElk, formaDoNo, medirTexto,
  type LayoutDoEsquema, type MotorDeLayout, type NoPosicionado,
} from './layout';

export const NOME_DO_TIPO: Record<TipoDoNoDoEsquema, string> = {
  tese: 'Tese', conceito: 'Conceito', mecanismo: 'Mecanismo', exemplo: 'Exemplo', questao: 'Questão', contraste: 'Contraste', conclusao: 'Conclusão',
};
export const ICONE_DO_TIPO: Record<TipoDoNoDoEsquema, string> = {
  tese: 'bandeira', conceito: 'lampada', mecanismo: 'engrenagem', exemplo: 'aspas', questao: 'pergunta', contraste: 'balanca', conclusao: 'concluido',
};
const ORDEM_DOS_TIPOS: readonly TipoDoNoDoEsquema[] = ['questao', 'tese', 'conceito', 'contraste', 'mecanismo', 'exemplo', 'conclusao'];

const ESCALA = { minima: 0.3, maxima: 2.4 };
const ESTREITA = 600;
/** Abaixo disto, cada faixa corre de cima para baixo; acima, da esquerda para a direita. */
const VERTICAL = 900;

interface Vista { x: number; y: number; escala: number }

export interface PropsDoDesenho {
  esquema: EsquemaDoCapituloV1;
  aoIr: (ancora: AncoraV1) => void;
  /** Troca o ELK nos testes. */
  motor?: () => Promise<MotorDeLayout>;
}

const larguraDoTitulo = (titulo: string): number => Math.ceil(medirTexto(titulo, 14, 700));

function limitar(valor: number, minimo: number, maximo: number): number { return Math.min(maximo, Math.max(minimo, valor)); }

/**
 * A vista inicial: o desenho inteiro, se couber sem ficar pequeno demais para ler; senão a largura
 * inteira (com um piso legível), a partir do topo.
 */
export function vistaInicial(layout: Pick<LayoutDoEsquema, 'largura' | 'altura'>, largura: number, altura: number): Vista {
  const util = Math.max(1, largura - 32);
  const minimaLegivel = largura < ESTREITA ? 0.8 : 0.62;
  const cabeInteiro = Math.min(util / layout.largura, Math.max(1, altura - 110) / layout.altura);
  const escala = limitar(Math.min(1.1, cabeInteiro >= minimaLegivel ? cabeInteiro : util / layout.largura), minimaLegivel, ESCALA.maxima);
  return { escala, x: Math.max(16, (largura - layout.largura * escala) / 2), y: 20 };
}

export function DesenhoDoEsquema({ esquema, aoIr, motor = carregarElk }: PropsDoDesenho): ReactNode {
  const tela = useRef<HTMLDivElement>(null);
  const [tamanho, definirTamanho] = useState<{ largura: number; altura: number } | null>(null);
  const [layout, definirLayout] = useState<LayoutDoEsquema | null>(null);
  const [falha, definirFalha] = useState<string | null>(null);
  const [vista, definirVista] = useState<Vista>({ x: 16, y: 20, escala: 1 });
  const [aceso, acender] = useState<string | null>(null);
  const [legendaAberta, abrirLegenda] = useState(false);
  const prefixo = useId().replace(/[^a-zA-Z0-9_-]/gu, '');
  const estreita = (tamanho?.largura ?? 1000) < ESTREITA;
  const vertical = (tamanho?.largura ?? 1000) < VERTICAL;
  /** O layout só se refaz quando muda a forma da tela (estreita, vertical), não a cada pixel. */
  const forma = tamanho === null ? null : `${estreita ? 'estreita' : 'larga'}-${vertical ? 'DOWN' : 'RIGHT'}`;

  useLayoutEffect(() => {
    const elemento = tela.current;
    if (!elemento) return undefined;
    const medir = () => {
      const caixa = elemento.getBoundingClientRect();
      definirTamanho((atual) => atual && atual.largura === caixa.width && atual.altura === caixa.height ? atual : { largura: caixa.width, altura: caixa.height });
    };
    medir();
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    observador?.observe(elemento);
    return () => observador?.disconnect();
  }, []);

  useEffect(() => {
    let vivo = true;
    definirFalha(null);
    if (forma === null) return undefined;
    const [medida, direcao] = forma.split('-') as ['estreita' | 'larga', 'DOWN' | 'RIGHT'];
    motor().then((elk) => calcularLayout(esquema, medida === 'estreita' ? MEDIDAS_ESTREITAS : MEDIDAS_LARGAS, elk, direcao)).then((calculado) => {
      if (vivo) definirLayout(calculado);
    }, (erro: unknown) => { if (vivo) definirFalha(erro instanceof Error ? erro.message : 'Não foi possível desenhar o mapa.'); });
    return () => { vivo = false; };
  }, [esquema, forma, motor]);

  // Ajusta a vista quando o desenho fica pronto (ou muda de medidas).
  const ajustar = useCallback(() => {
    if (layout && tamanho) definirVista(vistaInicial(layout, tamanho.largura, tamanho.altura));
  }, [layout, tamanho]);
  const ajustado = useRef<LayoutDoEsquema | null>(null);
  useEffect(() => {
    if (!layout || !tamanho || ajustado.current === layout) return;
    ajustado.current = layout;
    ajustar();
  }, [layout, tamanho, ajustar]);

  const zoom = useCallback((fator: number, cx?: number, cy?: number) => {
    definirVista((atual) => {
      const escala = limitar(atual.escala * fator, ESCALA.minima, ESCALA.maxima);
      const px = cx ?? (tamanho?.largura ?? 0) / 2;
      const py = cy ?? (tamanho?.altura ?? 0) / 2;
      const real = escala / atual.escala;
      return { escala, x: px - (px - atual.x) * real, y: py - (py - atual.y) * real };
    });
  }, [tamanho]);

  // A roda precisa de `passive: false` para não rolar a página por baixo.
  useEffect(() => {
    const elemento = tela.current;
    if (!elemento) return undefined;
    const rodar = (evento: WheelEvent) => {
      evento.preventDefault();
      const caixa = elemento.getBoundingClientRect();
      if (evento.ctrlKey || evento.metaKey) zoom(Math.exp(-evento.deltaY * 0.0022), evento.clientX - caixa.left, evento.clientY - caixa.top);
      else definirVista((atual) => ({ ...atual, x: atual.x - (evento.shiftKey ? evento.deltaY : evento.deltaX), y: atual.y - (evento.shiftKey ? 0 : evento.deltaY) }));
    };
    elemento.addEventListener('wheel', rodar, { passive: false });
    return () => elemento.removeEventListener('wheel', rodar);
  }, [zoom]);

  // Arrastar (um ponteiro) e pinçar (dois).
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef<{ inicio: { x: number; y: number }; vista: Vista; moveu: boolean; no: string | null; distancia?: number } | null>(null);
  const noDoAlvo = (alvo: EventTarget | null): string | null => (alvo instanceof Element ? alvo.closest<SVGGElement>('[data-no]')?.dataset['no'] ?? null : null);
  const aoApertar = (evento: PointerEvent<HTMLDivElement>) => {
    if (evento.button !== 0 && evento.pointerType === 'mouse') return;
    ponteiros.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    evento.currentTarget.setPointerCapture?.(evento.pointerId);
    const pontos = [...ponteiros.current.values()];
    gesto.current = pontos.length === 2
      ? { inicio: { x: (pontos[0]!.x + pontos[1]!.x) / 2, y: (pontos[0]!.y + pontos[1]!.y) / 2 }, vista, moveu: true, no: null, distancia: Math.hypot(pontos[0]!.x - pontos[1]!.x, pontos[0]!.y - pontos[1]!.y) }
      : { inicio: { x: evento.clientX, y: evento.clientY }, vista, moveu: false, no: noDoAlvo(evento.target) };
  };
  const aoMover = (evento: PointerEvent<HTMLDivElement>) => {
    if (!ponteiros.current.has(evento.pointerId) || !gesto.current) return;
    ponteiros.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    const atual = gesto.current;
    const pontos = [...ponteiros.current.values()];
    if (pontos.length === 2 && atual.distancia !== undefined) {
      const caixa = evento.currentTarget.getBoundingClientRect();
      const distancia = Math.hypot(pontos[0]!.x - pontos[1]!.x, pontos[0]!.y - pontos[1]!.y);
      const escala = limitar(atual.vista.escala * distancia / atual.distancia, ESCALA.minima, ESCALA.maxima);
      const cx = atual.inicio.x - caixa.left; const cy = atual.inicio.y - caixa.top;
      const real = escala / atual.vista.escala;
      definirVista({ escala, x: cx - (cx - atual.vista.x) * real, y: cy - (cy - atual.vista.y) * real });
      return;
    }
    const dx = evento.clientX - atual.inicio.x; const dy = evento.clientY - atual.inicio.y;
    if (!atual.moveu && Math.hypot(dx, dy) < 5) return;
    atual.moveu = true;
    definirVista({ ...atual.vista, x: atual.vista.x + dx, y: atual.vista.y + dy });
  };
  const aoSoltar = (evento: PointerEvent<HTMLDivElement>) => {
    ponteiros.current.delete(evento.pointerId);
    const atual = gesto.current;
    if (ponteiros.current.size > 0) { gesto.current = null; return; }
    gesto.current = null;
    if (atual && !atual.moveu && atual.no !== null) ir(atual.no);
  };

  const porId = useMemo(() => new Map((layout?.nos ?? []).map((item) => [item.no.id, item])), [layout]);
  const ir = (id: string) => {
    const ancora = porId.get(id)?.no.ancora;
    if (ancora) aoIr(ancora);
  };
  const teclar = (evento: KeyboardEvent<SVGGElement>, id: string) => {
    if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); ir(id); }
  };
  const teclarNaTela = (evento: KeyboardEvent<HTMLDivElement>) => {
    const passo = 60;
    const mapa: Record<string, () => void> = {
      '+': () => zoom(1.2), '=': () => zoom(1.2), '-': () => zoom(1 / 1.2), '0': ajustar,
      ArrowUp: () => definirVista((v) => ({ ...v, y: v.y + passo })), ArrowDown: () => definirVista((v) => ({ ...v, y: v.y - passo })),
      ArrowLeft: () => definirVista((v) => ({ ...v, x: v.x + passo })), ArrowRight: () => definirVista((v) => ({ ...v, x: v.x - passo })),
    };
    const acao = evento.target === evento.currentTarget ? mapa[evento.key] : (['+', '=', '-', '0'].includes(evento.key) ? mapa[evento.key] : undefined);
    if (acao) { evento.preventDefault(); acao(); }
  };

  const vizinhos = useMemo(() => {
    if (!aceso || !layout) return null;
    const ligadas = layout.ligacoes.filter((ligacao) => ligacao.de === aceso || ligacao.para === aceso);
    return { ligacoes: new Set(ligadas.map((ligacao) => ligacao.id)), nos: new Set([aceso, ...ligadas.flatMap((ligacao) => [ligacao.de, ligacao.para])]) };
  }, [aceso, layout]);

  const tipos = useMemo(() => ORDEM_DOS_TIPOS.filter((tipo) => esquema.nos.some((no) => no.tipo === tipo)), [esquema]);
  const cartao = aceso ? porId.get(aceso) : undefined;

  return <div className="esquema-area">
    <div ref={tela} className="esquema-tela" tabIndex={0} role="application" aria-roledescription="mapa esquemático"
      aria-label={`${esquema.titulo}. Arraste para mover, ${textoNoSistema('Ctrl')} e roda ou os botões para aproximar; Tab percorre as ideias.`}
      onPointerDown={aoApertar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar} onKeyDown={teclarNaTela}>
      {falha && <p className="esquema-falha" role="alert">{falha}</p>}
      {layout && <svg className="esquema-svg" width={tamanho?.largura ?? 0} height={tamanho?.altura ?? 0} data-escala={vista.escala.toFixed(2)}>
        <defs>
          <marker id={`${prefixo}-seta`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="ponta-da-seta" />
          </marker>
          <marker id={`${prefixo}-seta-acesa`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="ponta-da-seta acesa" />
          </marker>
        </defs>
        <g transform={`translate(${String(vista.x)} ${String(vista.y)}) scale(${String(vista.escala)})`}>
          {layout.grupos.map((grupo) => <g key={grupo.id} className={`faixa-do-esquema cor-${String(grupo.indice % 6)}`}>
            <rect x={grupo.x} y={grupo.y} width={grupo.largura} height={grupo.altura} rx={18} className="fundo-da-faixa" />
          </g>)}
          {layout.ligacoes.map((ligacao) => {
            const acesa = vizinhos?.ligacoes.has(ligacao.id) ?? false;
            return <path key={ligacao.id} d={caminhoArredondado(ligacao.pontos)} markerEnd={`url(#${prefixo}-seta${acesa ? '-acesa' : ''})`}
              className={`ligacao-do-esquema ${ligacao.forca}${vizinhos ? (acesa ? ' acesa' : ' apagada') : ''}`} />;
          })}
          {layout.ligacoes.map((ligacao) => ligacao.etiqueta && ligacao.rotulo && (!ligacao.raia || vizinhos?.ligacoes.has(ligacao.id)) && <g key={`e${ligacao.id}`}
            className={`etiqueta-do-esquema ${ligacao.forca}${vizinhos ? (vizinhos.ligacoes.has(ligacao.id) ? ' acesa' : ' apagada') : ''}`}>
            <rect x={ligacao.etiqueta.x} y={ligacao.etiqueta.y} width={ligacao.etiqueta.largura} height={ligacao.etiqueta.altura} rx={ligacao.etiqueta.altura / 2} />
            <text x={ligacao.etiqueta.x + ligacao.etiqueta.largura / 2} y={ligacao.etiqueta.y + ligacao.etiqueta.altura / 2 + 4} textAnchor="middle">{ligacao.rotulo}</text>
          </g>)}
          {/* Os títulos das faixas vêm depois das setas: uma seta que entra pelo alto passa por trás do título. */}
          {layout.grupos.map((grupo) => <g key={`t${grupo.id}`} className={`faixa-do-esquema cor-${String(grupo.indice % 6)}`}>
            <rect x={grupo.x + 14} y={grupo.y + 12} width={larguraDoTitulo(grupo.titulo) + 50} height={30} rx={15} className="fundo-do-titulo" />
            <circle cx={grupo.x + 30} cy={grupo.y + 27} r={11} className="numero-da-faixa" />
            <text x={grupo.x + 30} y={grupo.y + 31.5} className="numero-da-faixa-texto" textAnchor="middle">{grupo.indice + 1}</text>
            <text x={grupo.x + 50} y={grupo.y + 32} className="titulo-da-faixa">{grupo.titulo}{grupo.resumo && <title>{grupo.resumo}</title>}</text>
          </g>)}
          {layout.nos.map((item) => <No key={item.no.id} item={item} fonte={estreita ? MEDIDAS_ESTREITAS : MEDIDAS_LARGAS}
            apagado={vizinhos !== null && !vizinhos.nos.has(item.no.id)} aceso={aceso === item.no.id}
            aoEntrar={() => acender(item.no.id)} aoSair={() => acender((atual) => (atual === item.no.id ? null : atual))} aoTeclar={(evento) => teclar(evento, item.no.id)} />)}
        </g>
      </svg>}
      {cartao && tamanho && <CartaoDoNo item={cartao} vista={vista} tela={tamanho} />}
    </div>
    <div className="esquema-controles" role="toolbar" aria-label="Aproximação">
      {estreita && <button type="button" className={`ui-button ui-ghost botao-legenda${legendaAberta ? ' ativo' : ''}`} aria-expanded={legendaAberta} onClick={() => abrirLegenda((atual) => !atual)}>Legenda</button>}
      <button type="button" className="ui-button ui-ghost ui-icon" aria-label="Afastar" onClick={() => zoom(1 / 1.25)}><Icon name="menos" size={18} /></button>
      <button type="button" className="ui-button ui-ghost escala-do-esquema" aria-label="Ajustar à tela" title="Ajustar à tela" onClick={ajustar}>{Math.round(vista.escala * 100)}%</button>
      <button type="button" className="ui-button ui-ghost ui-icon" aria-label="Aproximar" onClick={() => zoom(1.25)}><Icon name="somar" size={18} /></button>
    </div>
    {(!estreita || legendaAberta) && <ul className="legenda-do-esquema" aria-label="Legenda">
      {tipos.map((tipo) => <li key={tipo} className={`tipo-${tipo}`}><span className="amostra"><Icon name={ICONE_DO_TIPO[tipo]} size={13} /></span>{NOME_DO_TIPO[tipo]}</li>)}
      <li className="legenda-seta"><svg width="26" height="8" aria-hidden="true"><path d="M1 4 H25" /></svg>fio principal</li>
      <li className="legenda-seta fraca"><svg width="26" height="8" aria-hidden="true"><path d="M1 4 H25" /></svg>ligação lateral</li>
    </ul>}
  </div>;
}

function No({ item, fonte, apagado, aceso, aoEntrar, aoSair, aoTeclar }: {
  item: NoPosicionado; fonte: { fonte: number; linha: number }; apagado: boolean; aceso: boolean;
  aoEntrar: () => void; aoSair: () => void; aoTeclar: (evento: KeyboardEvent<SVGGElement>) => void;
}): ReactNode {
  const { no, largura: l, altura: a, linhas } = item;
  const forma = formaDoNo(no.tipo, l, a);
  const inicio = (l - item.bloco) / 2;
  const alturaDoTexto = linhas.length * fonte.linha;
  const topo = (a - alturaDoTexto) / 2;
  const trecho = no.ancora !== undefined;
  const rotulo = `${NOME_DO_TIPO[no.tipo]}: ${no.rotulo}.${no.detalhe ? ` ${no.detalhe}` : ''}${trecho ? ' Enter leva ao trecho.' : ''}`;
  return <g data-no={no.id} transform={`translate(${String(item.x)} ${String(item.y)})`} role={trecho ? 'button' : 'img'} tabIndex={0} aria-label={rotulo}
    className={`no-do-esquema tipo-${no.tipo}${trecho ? ' com-trecho' : ''}${apagado ? ' apagado' : ''}${aceso ? ' aceso' : ''}`}
    onPointerEnter={(evento) => { if (evento.pointerType === 'mouse') aoEntrar(); }} onPointerLeave={(evento) => { if (evento.pointerType === 'mouse') aoSair(); }}
    onFocus={aoEntrar} onBlur={aoSair} onKeyDown={aoTeclar}>
    {forma.tipo === 'rect' ? <rect className="forma" width={l} height={a} rx={forma.rx} /> : <polygon className="forma" points={forma.pontos} />}
    {no.tipo === 'mecanismo' && <path className="barras" d={`M 8 0 V ${String(a)} M ${String(l - 8)} 0 V ${String(a)}`} />}
    {no.tipo === 'contraste' && <rect className="forma-interna" x={4} y={4} width={l - 8} height={a - 8} rx={9} />}
    <g className="icone-do-no" transform={`translate(${String(inicio)} ${String(a / 2 - ICONE / 2)})`}><Icon name={ICONE_DO_TIPO[no.tipo]} size={ICONE} /></g>
    <text className="rotulo-do-no" style={{ fontSize: fonte.fonte }}>
      {linhas.map((linha, i) => <tspan key={i} x={inicio + ESPACO_DO_ICONE} y={topo + fonte.linha * (i + 1) - 4.5}>{linha}</tspan>)}
    </text>
  </g>;
}

function CartaoDoNo({ item, vista, tela }: { item: NoPosicionado; vista: Vista; tela: { largura: number; altura: number } }): ReactNode {
  const largura = Math.min(320, tela.largura - 24);
  const direita = vista.x + (item.x + item.largura) * vista.escala + 14;
  const cabeAoLado = direita + largura < tela.largura - 8;
  const esquerda = cabeAoLado ? direita : limitar(vista.x + item.x * vista.escala, 12, tela.largura - largura - 12);
  const topo = cabeAoLado ? vista.y + item.y * vista.escala : vista.y + (item.y + item.altura) * vista.escala + 10;
  const { no } = item;
  return <div className={`cartao-do-no tipo-${no.tipo}`} role="tooltip" style={{ left: esquerda, top: limitar(topo, 8, tela.altura - 60), width: largura }}>
    <span className="eyebrow">{NOME_DO_TIPO[no.tipo]}</span>
    <strong>{no.rotulo}</strong>
    {no.detalhe && <p className="detalhe-do-no">{no.detalhe}</p>}
    {no.ancora && <p className="citacao-do-no">“{no.ancora.citacao}”</p>}
    <span className="dica-do-no">{no.ancora ? 'Clique para ler no texto' : 'Síntese do capítulo, sem trecho próprio'}</span>
  </div>;
}
