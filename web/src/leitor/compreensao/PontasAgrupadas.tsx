import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { TipoRelacaoSemantica } from '@margem/contratos';
import { IconeDaRelacao } from './IconeDaRelacao';

export interface PontoDeRelacao {
  tipo: TipoRelacaoSemantica; chave: string; id: string; y: number; cor: number; lado: 'saida' | 'chegada'; descricao: string;
}
interface GrupoDePontas { chave: string; topo: number; pontos: PontoDeRelacao[] }

/** A distância é comparada com o início da pilha, para não juntar uma página inteira por encadeamento. */
export function agruparPontas(pontos: readonly PontoDeRelacao[]): GrupoDePontas[] {
  const grupos: GrupoDePontas[] = [];
  for (const ponto of [...pontos].sort((a, b) => a.y - b.y || a.chave.localeCompare(b.chave))) {
    const ultimo = grupos.at(-1);
    if (ultimo && ponto.y - ultimo.topo < 44) ultimo.pontos.push(ponto);
    else grupos.push({ chave: ponto.chave, topo: ponto.y, pontos: [ponto] });
  }
  return grupos;
}

/** Semianel esquerdo, na mesma ordem do leque: de cima para baixo. */
function SemiAnel({ pontos }: { pontos: readonly PontoDeRelacao[] }): ReactNode {
  const cores = pontos.slice(0, 8);
  const passo = 120 / Math.max(1, cores.length);
  const polar = (angulo: number) => { const a = angulo * Math.PI / 180; return `${30 + 24 * Math.cos(a)} ${30 + 24 * Math.sin(a)}`; };
  return <svg className="semianel-pontas" viewBox="0 0 60 60" aria-hidden="true">
    {cores.map((ponto, i) => <path key={ponto.chave} className={`cor-${ponto.cor}`} d={`M ${polar(240 - i * passo - 2)} A 24 24 0 0 0 ${polar(240 - (i + 1) * passo + 2)}`} />)}
  </svg>;
}

export const PONTAS_POR_LEQUE = 4;
export function posicoesDoLeque(quantidade: number): { x: number; y: number }[] {
  return Array.from({ length: quantidade }, (_, i) => {
    const angulo = (quantidade === 1 ? 180 : 240 - 120 * i / (quantidade - 1)) * Math.PI / 180;
    return { x: Math.cos(angulo) * 60, y: Math.sin(angulo) * 60 };
  });
}

export function PontasAgrupadas({ pontos, x, ativa, aoAtivar, aoFixar, aoSair }: {
  pontos: readonly PontoDeRelacao[]; x: number; ativa: string | null;
  aoAtivar: (id: string) => void; aoFixar: (id: string) => void; aoSair: () => void;
}): ReactNode {
  // A origem do leque fica onde o mouse a encontrou, mesmo durante a dobra.
  const [aberto, abrir] = useState<GrupoDePontas | null>(null);
  const [pagina, paginar] = useState(0);
  const [fechando, recolher] = useState(false);
  const [avulsa, destacarAvulsa] = useState<PontoDeRelacao | null>(null);
  const painel = useRef<HTMLDivElement>(null);
  const espera = useRef<ReturnType<typeof setTimeout>>();
  const animacao = useRef<ReturnType<typeof setTimeout>>();
  const cancelar = () => clearTimeout(espera.current);
  const fechar = () => {
    cancelar(); clearTimeout(animacao.current); recolher(true); destacarAvulsa(null); aoSair();
    animacao.current = setTimeout(() => { abrir(null); recolher(false); }, 280);
  };
  const fecharAtual = useRef(fechar); fecharAtual.current = fechar;
  const sair = () => { cancelar(); espera.current = setTimeout(() => fecharAtual.current(), 180); };
  useEffect(() => () => { clearTimeout(espera.current); clearTimeout(animacao.current); }, []);
  useEffect(() => {
    const escapar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') fecharAtual.current(); };
    window.addEventListener('keydown', escapar);
    return () => window.removeEventListener('keydown', escapar);
  }, []);
  const esquerda = Math.max(4, x - 62);
  const mostrar = (grupo: GrupoDePontas) => {
    cancelar(); clearTimeout(animacao.current); recolher(false); destacarAvulsa(null);
    if (aberto?.chave !== grupo.chave) { paginar(0); abrir(grupo); }
  };
  const fatia = aberto?.pontos.slice(pagina * PONTAS_POR_LEQUE, (pagina + 1) * PONTAS_POR_LEQUE) ?? [];
  const posicoes = posicoesDoLeque(fatia.length);
  const paginas = Math.ceil((aberto?.pontos.length ?? 0) / PONTAS_POR_LEQUE);
  const trocarPagina = (delta: number) => { cancelar(); paginar((atual) => atual + delta); aoSair(); };
  const ativarAvulsa = (ponto: PontoDeRelacao) => {
    cancelar(); clearTimeout(animacao.current); abrir(null); recolher(false);
    destacarAvulsa(ponto); aoAtivar(ponto.id);
  };
  const grupos = agruparPontas(pontos.filter((ponto) => ponto.chave !== avulsa?.chave));
  if (avulsa) grupos.push({ chave: avulsa.chave, topo: avulsa.y, pontos: [avulsa] });
  return <div className="pontas-agrupadas" onPointerEnter={cancelar} onPointerLeave={sair} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) sair(); }}>
    {grupos.filter((grupo) => grupo.topo >= 64 && grupo.topo < window.innerHeight - 32).map((grupo) => grupo.pontos.length === 1 ? (() => {
      const ponto = grupo.pontos[0]!;
      return <button key={grupo.chave} type="button" className={`ponta-agrupada ponta-avulsa ${ponto.lado} cor-${ponto.cor}`}
        style={{ left: esquerda + 4, top: grupo.topo - 6 }}
        aria-label={`${ponto.lado === 'saida' ? 'Saída' : 'Chegada'}: ${ponto.descricao}`}
        aria-pressed={ativa === ponto.id}
        onPointerEnter={() => ativarAvulsa(ponto)} onFocus={() => ativarAvulsa(ponto)} onClick={() => aoFixar(ponto.id)}>
        <span className="orb-relacao"><IconeDaRelacao tipo={ponto.tipo} /><span className="direcao-ponta" aria-hidden="true">{ponto.lado === 'saida' ? '↗' : '↙'}</span></span>
      </button>;
    })() : <button
      key={grupo.chave} type="button" className="pilha-de-pontas" style={{ left: esquerda, top: grupo.topo - 10, ...(grupo.chave === aberto?.chave ? { opacity: 0, pointerEvents: 'none' } : {}) }}
      tabIndex={grupo.chave === aberto?.chave ? -1 : 0}
      aria-label={`${grupo.pontos.length} ${grupo.pontos.length === 1 ? 'ponta de relação' : 'pontas de relações'} nesta linha`}
      aria-expanded={grupo.chave === aberto?.chave} onPointerEnter={() => mostrar(grupo)} onFocus={() => { mostrar(grupo); requestAnimationFrame(() => painel.current?.querySelector<HTMLButtonElement>('.ponta-agrupada')?.focus()); }}
      onClick={() => { mostrar(grupo); requestAnimationFrame(() => painel.current?.querySelector<HTMLButtonElement>('.ponta-agrupada')?.focus()); }}>
      <SemiAnel pontos={grupo.pontos} /><span className="numero-familia">{grupo.pontos.length}</span>
    </button>)}
    {aberto && <div ref={painel} className={`pontas-espalhadas leque-pontas${fechando ? ' recolhendo' : ''}`} role="group" aria-label="Pontas desta linha"
      style={{ left: Math.max(4, Math.min(esquerda + 22 - 82, window.innerWidth - 116)), top: Math.max(68, Math.min(aberto.topo + 12 - 78, window.innerHeight - 198)), width: 112 }} onPointerEnter={cancelar}>
      <button className="centro-familia" type="button" aria-label="Recolher bolinhas" aria-expanded={!fechando} onClick={fechar}>
        <SemiAnel pontos={fatia} /><span className="numero-familia">{aberto.pontos.length}</span>
      </button>
      {fatia.map((ponto, i) => <button key={ponto.chave} type="button"
        className={`ponta-agrupada ${ponto.lado} cor-${ponto.cor}`} aria-label={`${ponto.lado === 'saida' ? 'Saída' : 'Chegada'}: ${ponto.descricao}`}
        style={{ '--orb-x': `${posicoes[i]?.x ?? 0}px`, '--orb-y': `${posicoes[i]?.y ?? 0}px` } as CSSProperties}
        aria-pressed={ativa === ponto.id}
        onPointerEnter={() => { cancelar(); aoAtivar(ponto.id); }} onFocus={() => { cancelar(); aoAtivar(ponto.id); }} onClick={() => aoFixar(ponto.id)}>
        <span className="orb-relacao"><IconeDaRelacao tipo={ponto.tipo} /><span className="direcao-ponta" aria-hidden="true">{ponto.lado === 'saida' ? '↗' : '↙'}</span></span>
      </button>)}
      {paginas > 1 && <nav className="paginas-leque" aria-label="Mais pontas desta linha">
        <button type="button" aria-label="Pontas anteriores" disabled={pagina === 0} onClick={() => trocarPagina(-1)}>←</button>
        <span>{pagina + 1} / {paginas}</span>
        <button type="button" aria-label="Próximas pontas" disabled={pagina + 1 === paginas} onClick={() => trocarPagina(1)}>→</button>
      </nav>}
    </div>}
  </div>;
}
