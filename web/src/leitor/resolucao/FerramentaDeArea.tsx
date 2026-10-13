/**
 * Ferramenta de área (Player v2, etapa 6; ⬚ na barra, Shift Ctrl S), como a do Readwise: arrasta-se um
 * retângulo sobre a página do PDF; ao soltar, ele fica com alças (para ajustar ou mover) e uma minibarra
 * flutuante oferece o que fazer com a área: **Resolver** (a resolução de exercícios do J34/#38, que vira
 * um recorte marcado na página), **Explicar** (a conversa ancorada no trecho coberto), **Imagem** (o
 * visual do J70 para o trecho) e **Nota** (a anotação do trecho). As três últimas precisam de texto sob a
 * área: o trecho vem das palavras da geometria do PDF (`ancoraDaArea`); numa página só de imagem, ficam
 * desabilitadas e só o Resolver (que lê a imagem) funciona.
 *
 * O retângulo vive em frações da página, então acompanha a rolagem e o zoom. Nada é enviado aqui.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as EventoDePonteiro, type ReactNode } from 'react';
import type { AncoraV1 } from '@margem/contratos';
import { Icon } from '../../ui/Icon';
import { imagemDoRecorte, paginaSob, textoDoRecorte, type Recorte } from './RecorteDeExercicio';

export type AcaoDaArea = 'resolver' | 'explicar' | 'imagem' | 'nota';
interface Fracao { x: number; y: number; largura: number; altura: number }
interface Area { pagina: number; fracao: Fracao }
type Arrasto = { tipo: 'novo'; x0: number; y0: number; x: number; y: number } | { tipo: 'mover' | 'alca'; alca?: string; x0: number; y0: number; inicial: Fracao };

const MINIMO = 24;
const ALCAS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const limitar = (v: number) => Math.min(1, Math.max(0, v));

function folhaDaPagina(numero: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.capitulo-pdf .pdf-pagina[data-pagina="${String(numero)}"]`) ?? document.querySelector<HTMLElement>(`.pdf-pagina[data-pagina="${String(numero)}"]`);
}

export function FerramentaDeArea({ aoAgir, aoCancelar, ancoraDaArea }: {
  aoAgir: (acao: AcaoDaArea, recorte: Recorte, ancora: AncoraV1 | null) => void;
  aoCancelar: () => void;
  /** O trecho de texto sob a área, pelas palavras da geometria do PDF; `null` onde não há texto. */
  ancoraDaArea?: (pagina: number, fracao: Fracao) => AncoraV1 | null;
}): ReactNode {
  const [area, definirArea] = useState<Area | null>(null);
  const [arrasto, definirArrasto] = useState<Arrasto | null>(null);
  const [aviso, definirAviso] = useState<string | null>(null);
  const [, redesenhar] = useState(0);
  const cancelar = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelar.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); aoCancelar(); } };
    // Com a área na página, rolagem e zoom só mudam onde ela aparece na tela.
    const mudou = () => redesenhar((n) => n + 1);
    window.addEventListener('keydown', teclar, true);
    window.addEventListener('scroll', mudou, { passive: true });
    window.addEventListener('resize', mudou);
    return () => { window.removeEventListener('keydown', teclar, true); window.removeEventListener('scroll', mudou); window.removeEventListener('resize', mudou); };
  }, [aoCancelar]);

  const folha = area ? folhaDaPagina(area.pagina) : null;
  const base = folha?.getBoundingClientRect() ?? null;
  const fracaoAtual = area?.fracao ?? null;
  const naTela = area && base && fracaoAtual ? new DOMRect(base.left + fracaoAtual.x * base.width, base.top + fracaoAtual.y * base.height, fracaoAtual.largura * base.width, fracaoAtual.altura * base.height) : null;
  const desenhando = arrasto?.tipo === 'novo' ? new DOMRect(Math.min(arrasto.x0, arrasto.x), Math.min(arrasto.y0, arrasto.y), Math.abs(arrasto.x - arrasto.x0), Math.abs(arrasto.y - arrasto.y0)) : null;

  const comecar = (evento: EventoDePonteiro<HTMLDivElement>) => {
    if (evento.target instanceof Element && evento.target.closest('.minibarra-da-area, .alca-da-area, .corpo-da-area, .aviso-de-recorte')) return;
    evento.preventDefault();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    definirAviso(null); definirArea(null);
    definirArrasto({ tipo: 'novo', x0: evento.clientX, y0: evento.clientY, x: evento.clientX, y: evento.clientY });
  };
  const mover = (evento: EventoDePonteiro<HTMLDivElement>) => {
    if (!arrasto) return;
    if (arrasto.tipo === 'novo') { definirArrasto({ ...arrasto, x: evento.clientX, y: evento.clientY }); return; }
    if (!area || !base) return;
    const dx = (evento.clientX - arrasto.x0) / base.width; const dy = (evento.clientY - arrasto.y0) / base.height;
    const f = arrasto.inicial;
    let { x, y, largura, altura } = f;
    if (arrasto.tipo === 'mover') { x = limitar(Math.min(f.x + dx, 1 - f.largura)); y = limitar(Math.min(f.y + dy, 1 - f.altura)); }
    else {
      const alca = arrasto.alca ?? '';
      if (alca.includes('w')) { x = limitar(Math.min(f.x + dx, f.x + f.largura - .02)); largura = f.largura + (f.x - x); }
      if (alca.includes('e')) largura = Math.max(.02, Math.min(1 - f.x, f.largura + dx));
      if (alca.includes('n')) { y = limitar(Math.min(f.y + dy, f.y + f.altura - .02)); altura = f.altura + (f.y - y); }
      if (alca.includes('s')) altura = Math.max(.02, Math.min(1 - f.y, f.altura + dy));
    }
    definirArea({ ...area, fracao: { x, y, largura, altura } });
  };
  const soltar = () => {
    const feito = desenhando;
    definirArrasto(null);
    if (!feito) return;
    if (feito.width < MINIMO || feito.height < MINIMO) return;
    const pagina = paginaSob(feito);
    if (!pagina) { definirAviso('Arraste sobre uma página do PDF.'); return; }
    const folhaRect = pagina.elemento.getBoundingClientRect();
    definirArea({ pagina: pagina.numero, fracao: {
      x: limitar((pagina.dentro.left - folhaRect.left) / folhaRect.width), y: limitar((pagina.dentro.top - folhaRect.top) / folhaRect.height),
      largura: limitar(pagina.dentro.width / folhaRect.width), altura: limitar(pagina.dentro.height / folhaRect.height),
    } });
  };
  const pegar = (tipo: 'mover' | 'alca', alca?: string) => (evento: EventoDePonteiro<HTMLElement>) => {
    if (!area) return;
    evento.preventDefault(); evento.stopPropagation();
    evento.currentTarget.closest<HTMLElement>('.camada-de-recorte')?.setPointerCapture(evento.pointerId);
    definirArrasto({ tipo, ...(alca ? { alca } : {}), x0: evento.clientX, y0: evento.clientY, inicial: area.fracao });
  };

  const ancora = area && ancoraDaArea ? ancoraDaArea(area.pagina, area.fracao) : null;
  const agir = useCallback((acao: AcaoDaArea) => {
    if (!area || !folha || !naTela) return;
    const imagem = imagemDoRecorte(folha, naTela);
    if (!imagem) { definirAviso('A página ainda não foi desenhada; role até ela e tente de novo.'); return; }
    aoAgir(acao, { pagina: area.pagina, retangulo: area.fracao, imagem_png: imagem, texto: textoDoRecorte(folha, naTela) }, ancora);
  }, [area, folha, naTela, ancora, aoAgir]);

  const semTexto = 'Sem texto reconhecido nesta área: use Resolver, que lê a imagem';
  const barraEmCima = naTela ? naTela.bottom + 56 > window.innerHeight : false;
  return <div className="camada-de-recorte camada-da-area" role="application" aria-label="Selecionar área: arraste sobre a página"
    onPointerDown={comecar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => definirArrasto(null)}>
    {desenhando && <div className="retangulo-de-recorte" style={{ left: desenhando.left, top: desenhando.top, width: desenhando.width, height: desenhando.height }} />}
    {naTela && !desenhando && <>
      <div className="retangulo-de-recorte area-fixada" style={{ left: naTela.left, top: naTela.top, width: naTela.width, height: naTela.height }}>
        <span className="corpo-da-area" aria-hidden="true" onPointerDown={pegar('mover')} />
        {ALCAS.map((alca) => <span key={alca} className={`alca-da-area alca-${alca}`} aria-hidden="true" onPointerDown={pegar('alca', alca)} />)}
      </div>
      <div className="minibarra-da-area dicas-acima" role="toolbar" aria-label="O que fazer com a área"
        style={{ left: Math.max(12, Math.min(naTela.left, window.innerWidth - 332)), top: barraEmCima ? Math.max(64, naTela.top - 52) : naTela.bottom + 10 }}>
        <button type="button" onClick={() => agir('resolver')} data-dica="Resolver o exercício"><Icon name="resolver" size={16} /><span>Resolver</span></button>
        <button type="button" disabled={!ancora} onClick={() => agir('explicar')} data-dica={ancora ? 'Perguntar sobre o trecho' : semTexto}><Icon name="explicar" size={16} /><span>Explicar</span></button>
        <button type="button" disabled={!ancora} onClick={() => agir('imagem')} data-dica={ancora ? 'Criar uma imagem do trecho' : semTexto}><Icon name="imagem" size={16} /><span>Imagem</span></button>
        <button type="button" disabled={!ancora} onClick={() => agir('nota')} data-dica={ancora ? 'Anotar o trecho' : semTexto}><Icon name="nota-adesiva" size={16} /><span>Nota</span></button>
        <span className="traco-da-minibarra" aria-hidden="true" />
        <button type="button" aria-label="Fechar a seleção" data-dica="Fechar" data-atalho="Esc" onClick={aoCancelar}><Icon name="xis" size={16} /></button>
      </div>
    </>}
    <div className="aviso-de-recorte" onPointerDown={(evento) => evento.stopPropagation()}>
      <span>{aviso ?? (area ? 'Ajuste pelas alças ou arraste de novo' : 'Arraste sobre a página para selecionar uma área')}</span>
      <button ref={cancelar} type="button" className="ui-button ui-ghost" onClick={aoCancelar}>Cancelar</button>
    </div>
  </div>;
}
