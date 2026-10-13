/**
 * O palco do quadro: a pintura inteira num SVG cujo `viewBox` é a câmera, e as regiões da análise no
 * mesmo sistema de coordenadas (como as marcas do `Marcador`: traço discreto, aceso no hover e no foco).
 * Zoom pela roda, pela pinça e pela pílula; arrasto com o ponteiro. A câmera é escrita direto no SVG
 * (sem passar pelo React a cada quadro): o player a move pela linha do tempo; o leitor, à mão.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type MouseEvent as EventoDeMouse, type PointerEvent as EventoDePonteiro, type ReactNode } from 'react';
import type { RegiaoDaObra, RetanguloDaObra } from '@margem/contratos';
import { arrastar, interpolarCamera, limitarCamera, mesmaCamera, nivelDeZoom, QUADRO_INTEIRO, zoomEm } from './camera';

export interface ApiDoPalco {
  /** Vai até a câmera com uma transição curta (ou de uma vez, com movimento reduzido). */
  irPara: (alvo: RetanguloDaObra) => void;
  /** Põe a câmera já (o player, a cada quadro). */
  definir: (camera: RetanguloDaObra) => void;
  atual: () => RetanguloDaObra;
  zoom: (fator: number) => void;
}

interface Props {
  url: string;
  titulo: string;
  largura: number;
  altura: number;
  regioes: readonly RegiaoDaObra[];
  /** Regiões acesas (a batida em curso, a afirmação escolhida, o hover no painel). */
  acesas: ReadonlySet<string>;
  /** Mostrar o contorno de todas as regiões (as acesas aparecem sempre). */
  contornos: boolean;
  aoEscolherRegiao: (id: string) => void;
  aoPassarRegiao: (id: string | null) => void;
  /** O leitor mexeu na câmera (zoom ou arrasto): o player deixa de conduzir. */
  aoInteragir: () => void;
  aoMudarZoom: (nivel: number) => void;
}

const movimentoReduzido = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function Forma({ regiao, largura, altura }: { regiao: RegiaoDaObra; largura: number; altura: number }): ReactNode {
  const f = regiao.forma;
  if (f.tipo === 'bbox') return <rect x={f.x * largura} y={f.y * altura} width={f.largura * largura} height={f.altura * altura} rx={Math.min(largura, altura) * 0.006} />;
  if (f.tipo === 'ponto') return <circle cx={f.x * largura} cy={f.y * altura} r={Math.min(largura, altura) * 0.02} />;
  return <polygon points={f.pontos.map((p) => `${String(p.x * largura)},${String(p.y * altura)}`).join(' ')} />;
}

export const PalcoDoQuadro = forwardRef<ApiDoPalco, Props>(function PalcoDoQuadro({ url, titulo, largura: W, altura: H, regioes, acesas, contornos, aoEscolherRegiao, aoPassarRegiao, aoInteragir, aoMudarZoom }, ref) {
  const svg = useRef<SVGSVGElement>(null);
  const camera = useRef<RetanguloDaObra>(QUADRO_INTEIRO);
  const tween = useRef(0);
  const ultimoNivel = useRef(1);
  const [carregada, carregar] = useState(false);
  const [falhou, falhar] = useState(false);
  const callbacks = useRef({ aoInteragir, aoMudarZoom });
  callbacks.current = { aoInteragir, aoMudarZoom };

  const escrever = useCallback((c: RetanguloDaObra) => {
    camera.current = c;
    svg.current?.setAttribute('viewBox', `${(c.x * W).toFixed(2)} ${(c.y * H).toFixed(2)} ${(c.largura * W).toFixed(2)} ${(c.altura * H).toFixed(2)}`);
    const nivel = Math.round(nivelDeZoom(c) * 100) / 100;
    if (nivel !== ultimoNivel.current) { ultimoNivel.current = nivel; callbacks.current.aoMudarZoom(nivel); }
  }, [W, H]);

  const irPara = useCallback((alvo: RetanguloDaObra) => {
    cancelAnimationFrame(tween.current);
    const de = camera.current;
    const para = limitarCamera(alvo);
    if (movimentoReduzido() || mesmaCamera(de, para)) { escrever(para); return; }
    const inicio = performance.now();
    const passo = (agora: number) => {
      const u0 = Math.min(1, (agora - inicio) / 420);
      const u = 1 - (1 - u0) ** 3;
      escrever(interpolarCamera(de, para, u));
      if (u0 < 1) tween.current = requestAnimationFrame(passo);
    };
    tween.current = requestAnimationFrame(passo);
  }, [escrever]);

  useImperativeHandle(ref, () => ({
    irPara,
    definir: (c) => { cancelAnimationFrame(tween.current); escrever(c); },
    atual: () => camera.current,
    zoom: (fator) => { irPara(zoomEm(camera.current, fator)); },
  }), [irPara, escrever]);

  useLayoutEffect(() => { escrever(camera.current); }, [escrever]);
  useEffect(() => () => cancelAnimationFrame(tween.current), []);

  /** Ponto da tela → ponto normalizado da imagem, e quanto vale um pixel da tela na imagem. */
  const medida = useCallback(() => {
    const el = svg.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const c = camera.current;
    const vw = c.largura * W; const vh = c.altura * H;
    const s = Math.min(r.width / vw, r.height / vh);
    const ox = (r.width - vw * s) / 2; const oy = (r.height - vh * s) / 2;
    return {
      ponto: (sx: number, sy: number) => ({ x: c.x + (sx - r.left - ox) / s / W, y: c.y + (sy - r.top - oy) / s / H }),
      porPixel: { x: 1 / (s * W), y: 1 / (s * H) },
    };
  }, [W, H]);

  // Roda: zoom em torno do ponteiro (Ctrl+roda do trackpad também). Passiva não: precisa do preventDefault.
  useEffect(() => {
    const el = svg.current;
    if (!el) return undefined;
    const rodar = (evento: WheelEvent) => {
      evento.preventDefault();
      const m = medida();
      if (!m) return;
      cancelAnimationFrame(tween.current);
      const p = m.ponto(evento.clientX, evento.clientY);
      const fator = Math.exp(-evento.deltaY * (evento.ctrlKey ? 0.01 : 0.0022));
      callbacks.current.aoInteragir();
      escrever(zoomEm(camera.current, fator, p.x, p.y));
    };
    el.addEventListener('wheel', rodar, { passive: false });
    return () => el.removeEventListener('wheel', rodar);
  }, [medida, escrever]);

  // Arrasto e pinça.
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const moveu = useRef(false);
  const [arrastando, definirArrastando] = useState(false);
  const aoBaixar = (evento: EventoDePonteiro<SVGSVGElement>) => {
    if (evento.button !== 0 && evento.pointerType === 'mouse') return;
    ponteiros.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    moveu.current = false;
    // A captura só começa no arrasto: um toque numa região continua sendo um clique nela.
  };
  const aoMover = (evento: EventoDePonteiro<SVGSVGElement>) => {
    const anterior = ponteiros.current.get(evento.pointerId);
    if (!anterior) return;
    const m = medida();
    if (!m) return;
    const agora = { x: evento.clientX, y: evento.clientY };
    if (ponteiros.current.size >= 2) {
      const [a, b] = [...ponteiros.current.entries()];
      const outro = a![0] === evento.pointerId ? b![1] : a![1];
      const antes = Math.hypot(anterior.x - outro.x, anterior.y - outro.y);
      const depois = Math.hypot(agora.x - outro.x, agora.y - outro.y);
      const meio = m.ponto((agora.x + outro.x) / 2, (agora.y + outro.y) / 2);
      if (antes > 0) { cancelAnimationFrame(tween.current); escrever(zoomEm(camera.current, depois / antes, meio.x, meio.y)); }
    } else {
      const dx = agora.x - anterior.x; const dy = agora.y - anterior.y;
      if (!moveu.current && Math.hypot(dx, dy) < 3) return;
      if (!moveu.current) { moveu.current = true; definirArrastando(true); callbacks.current.aoInteragir(); evento.currentTarget.setPointerCapture(evento.pointerId); }
      cancelAnimationFrame(tween.current);
      escrever(arrastar(camera.current, -dx * m.porPixel.x, -dy * m.porPixel.y));
    }
    if (ponteiros.current.size >= 2 && !moveu.current) { moveu.current = true; callbacks.current.aoInteragir(); }
    ponteiros.current.set(evento.pointerId, agora);
  };
  const aoSoltar = (evento: EventoDePonteiro<SVGSVGElement>) => {
    ponteiros.current.delete(evento.pointerId);
    if (ponteiros.current.size === 0) definirArrastando(false);
  };
  const aoDuploClique = (evento: EventoDeMouse<SVGSVGElement>) => {
    const m = medida();
    if (!m) return;
    const p = m.ponto(evento.clientX, evento.clientY);
    callbacks.current.aoInteragir();
    irPara(nivelDeZoom(camera.current) > 3.5 ? QUADRO_INTEIRO : zoomEm(camera.current, 2, p.x, p.y));
  };

  return <div className="palco-do-quadro" data-carregada={carregada || undefined}>
    {!carregada && !falhou && <p className="palco-estado" role="status">Abrindo a imagem…</p>}
    {falhou && <p className="palco-estado" role="alert">A imagem não pôde ser carregada.</p>}
    <svg ref={svg} className={`tela-do-quadro ${arrastando ? 'arrastando' : ''}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={titulo}
      onPointerDown={aoBaixar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar} onDoubleClick={aoDuploClique}>
      <image href={url} width={W} height={H} onLoad={() => carregar(true)} onError={() => falhar(true)} />
      <g className={`regioes-do-quadro ${contornos ? 'com-contornos' : ''}`}>
        {regioes.map((r) => <g key={r.id} className={`regiao-do-quadro ${acesas.has(r.id) ? 'acesa' : ''}`} data-regiao={r.id} role="button" tabIndex={contornos || acesas.has(r.id) ? 0 : -1} aria-label={r.rotulo} aria-pressed={acesas.has(r.id)}
          onClick={(evento) => { evento.stopPropagation(); if (!moveu.current) aoEscolherRegiao(r.id); }}
          onPointerEnter={() => aoPassarRegiao(r.id)} onPointerLeave={() => aoPassarRegiao(null)} onFocus={() => aoPassarRegiao(r.id)} onBlur={() => aoPassarRegiao(null)}
          onKeyDown={(evento) => { if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); evento.stopPropagation(); aoEscolherRegiao(r.id); } }}>
          <title>{r.rotulo}</title>
          <Forma regiao={r} largura={W} altura={H} />
          <Forma regiao={r} largura={W} altura={H} />
        </g>)}
      </g>
    </svg>
  </div>;
});
