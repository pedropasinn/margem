/**
 * Miniaturas das páginas do PDF no painel esquerdo (Player v2, etapa 7, como o Readwise). Cada página
 * só é desenhada quando entra na lista visível; a atual fica marcada e rola junto; tocar numa vai até
 * ela (no capítulo aberto, ou abrindo o capítulo dela).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

const LARGURA = 120;

function Miniatura({ documento, numero, atual, proporcao, aoIr }: { documento: PDFDocumentProxy; numero: number; atual: boolean; proporcao: number; aoIr: (n: number) => void }): ReactNode {
  const botao = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visivel, mostrar] = useState(false);
  useEffect(() => {
    const elemento = botao.current;
    if (!elemento || typeof IntersectionObserver === 'undefined') { mostrar(true); return; }
    const observador = new IntersectionObserver(([entrada]) => { if (entrada?.isIntersecting) mostrar(true); }, { rootMargin: '400px 0px' });
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);
  useEffect(() => {
    if (!visivel || !canvas.current) return;
    let vivo = true;
    let cancelar = () => { /* nada ainda */ };
    void documento.getPage(numero).then((pagina) => {
      if (!vivo || !canvas.current) return;
      const base = pagina.getViewport({ scale: 1 });
      const densidade = Math.min(2, window.devicePixelRatio || 1);
      const viewport = pagina.getViewport({ scale: (LARGURA / base.width) * densidade });
      const alvo = canvas.current;
      alvo.width = Math.round(viewport.width); alvo.height = Math.round(viewport.height);
      const tarefa = pagina.render({ canvas: alvo, viewport });
      cancelar = () => tarefa.cancel();
      void tarefa.promise.catch(() => undefined);
    }, () => undefined);
    return () => { vivo = false; cancelar(); };
  }, [visivel, documento, numero]);
  useEffect(() => { if (atual) botao.current?.scrollIntoView?.({ block: 'nearest' }); }, [atual]);
  return <li><button ref={botao} type="button" className="miniatura" aria-current={atual ? 'page' : undefined} aria-label={`Página ${String(numero)}`} onClick={() => aoIr(numero)}>
    <canvas ref={canvas} aria-hidden="true" style={{ width: LARGURA, height: Math.round(LARGURA * proporcao) }} />
    <span className="miniatura-numero">{numero}</span>
  </button></li>;
}

export function MiniaturasDoPdf({ documento, atual, aoIr }: { documento: PDFDocumentProxy | null; atual: number | null; aoIr: (pagina: number) => void }): ReactNode {
  const [proporcao, definirProporcao] = useState(1.414);
  const [erro, definirErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    definirErro(false);
    definirProporcao(1.414);
    if (documento) void documento.getPage(1).then((pagina) => {
      if (!vivo) return;
      const primeira = pagina.getViewport({ scale: 1 });
      definirProporcao(primeira.height / primeira.width);
    }).catch(() => { if (vivo) definirErro(true); });
    // O leitor é dono do documento e do worker; fechar o painel só cancela desenhos.
    return () => { vivo = false; };
  }, [documento]);
  if (erro) return <p className="painel-leitor-vazio">Não foi possível abrir as miniaturas.</p>;
  if (!documento) return <p className="painel-leitor-vazio" role="status">Abrindo as páginas…</p>;
  return <ol className="miniaturas" aria-label="Páginas">
    {Array.from({ length: documento.numPages }, (_, i) => i + 1).map((numero) => <Miniatura key={numero} documento={documento} numero={numero} atual={numero === atual} proporcao={proporcao} aoIr={aoIr} />)}
  </ol>;
}
