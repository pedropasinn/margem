import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ModoDeLeituraV1, ReferenciaModo } from '@margem/contratos';
import type { SelecaoDoLeitor } from './selecao';
import { Button, IconButton } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { atalhoNoSistema } from '../ui/teclas';
import { usarFuncoes } from './ContextoDosModos';
import { atalhoDeUmaTeclaDesligado, digitando } from './teclado/comandos';
import './barra-de-selecao.css';

/** Faixa da barra do leitor no topo: a barra de seleção não sobe para debaixo dela. */
const TOPO_UTIL = 56;
const FOLGA = 8;

/**
 * A pílula de ações sobre a seleção: acima da primeira linha quando cabe (como o balão do grifo), para
 * não cobrir a linha seguinte; abaixo da seleção só perto do topo. No celular, fixa embaixo (CSS).
 */
export function BarraDeSelecao({ selecao, children }: { selecao: SelecaoDoLeitor; children: ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [posicao, posicionar] = useState<{ left: number; top: number; lado: 'acima' | 'abaixo' }>({ left: 12, top: 12, lado: 'acima' });
  useLayoutEffect(() => {
    const medir = () => {
      const caixa = raiz.current?.getBoundingClientRect();
      const altura = caixa?.height || 40;
      const topoDaSelecao = selecao.caixa?.top ?? 0;
      const cabeAcima = topoDaSelecao - altura - FOLGA >= TOPO_UTIL;
      const top = cabeAcima ? topoDaSelecao - altura - FOLGA
        : Math.max(12, Math.min((selecao.caixa?.bottom ?? 0) + FOLGA, window.innerHeight - altura - (selecao.aparada ? 48 : 12)));
      posicionar({ left: Math.max(12, Math.min(selecao.caixa?.left ?? 12, window.innerWidth - (caixa?.width ?? 0) - 12)), top, lado: cabeAcima ? 'acima' : 'abaixo' });
    };
    medir();
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    if (raiz.current) observador?.observe(raiz.current);
    window.addEventListener('resize', medir);
    return () => { observador?.disconnect(); window.removeEventListener('resize', medir); };
  }, [selecao, children]);
  return <div ref={raiz} className="barra-selecao" role="toolbar" aria-label="Ações da seleção" data-lado={posicao.lado} style={{ left: posicao.left, top: posicao.top }} onPointerDown={(evento) => evento.preventDefault()}>
    {children}
    {selecao.aparada && <p className="aviso-selecao" role="status">Seleção aparada ao primeiro bloco.</p>}
  </div>;
}

const TRACOS = {
  grifar: 'm5 15 9-11 6 6-11 9H5v-4Zm-2 6h11',
  anotar: 'M4 4h16v12H9l-5 4V4Zm4 5h8m-8 4h5',
  perguntar: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  conectar: 'm10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1',
  resolver: 'M5 3h14v18H5V3Zm3 5h8m-8 5 2 2 5-5',
  imagem: 'M4 5h16v14H4V5Zm0 11 5-5 4 4 2-2 5 5M15.5 9.5v.1',
  fluxograma: 'M9 3h6v5H9V3Zm-5 13h6v5H4v-5Zm10 0h6v5h-6v-5ZM12 8v4m-5 4v-4h10v4',
  flashcard: 'M8 3h11a2 2 0 0 1 2 2v10M5 7h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  fechar: 'm6 6 12 12M6 18 18 6',
};
export function IconeDaSelecao({ nome }: { nome: keyof typeof TRACOS }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TRACOS[nome]} /></svg>;
}

/** Uma função com que grifar: rótulo, cor do modo e o modo dono (o grifo nasce nele, para poder trocar de função depois). */
export interface FuncaoParaGrifar { chave: string; rotulo: string; cor: string; modo?: ReferenciaModo | undefined }
/** O modo do método (o grifo sem modo nasce nele, como no serviço). */
export const MODO_DO_METODO: ReferenciaModo = { id: 'argumentativa', revisao: 1 };
/** Sem modos no contexto (página de desenvolvimento), as três funções do método. */
const FUNCOES_DO_METODO = [{ chave: 'tese', rotulo: 'Tese' }, { chave: 'conceito', rotulo: 'Conceito' }, { chave: 'justificativa', rotulo: 'Justificativa' }];
/** Quantas funções ficam à vista na fileira (as outras vão para o "…"), além do grifo simples. */
export const FUNCOES_A_VISTA = 3;

/**
 * As funções com que se pode grifar, na ordem do modo: as do modo dado, ou as do modo principal do
 * trecho/documento (J138: o catálogo inteiro está no contexto, mas a fileira é a do modo principal; os
 * outros modos ficam em "Outros olhares", no balão), e o grifo simples (sem função) por último. `aVista`
 * vão na fileira; `outras`, no "…". `atual` garante que a função de um grifo existente apareça na fileira.
 */
export function usarFuncoesParaGrifar(modo?: ReferenciaModo, atual?: string): { aVista: FuncaoParaGrifar[]; outras: FuncaoParaGrifar[] } {
  const { modos, principais, cor } = usarFuncoes();
  const referencia = modo ?? principais.find((ref) => modos.some((m) => m.id === ref.id && m.revisao === ref.revisao)) ?? MODO_DO_METODO;
  const fonte: ModoDeLeituraV1 | undefined = modos.find((m) => m.id === referencia.id && m.revisao === referencia.revisao);
  const todas: FuncaoParaGrifar[] = fonte
    ? fonte.funcoes.map((f) => ({ chave: f.chave, rotulo: f.rotulo, cor: cor(f.chave, fonte), modo: { id: fonte.id, revisao: fonte.revisao } }))
    : FUNCOES_DO_METODO.map((f) => ({ ...f, cor: cor(f.chave), modo: modos.length > 0 ? referencia : undefined }));
  const simples: FuncaoParaGrifar = { chave: 'nenhuma', rotulo: 'Grifo simples', cor: cor('nenhuma'), modo: fonte ? { id: fonte.id, revisao: fonte.revisao } : modo };
  const indiceDaAtual = atual === undefined ? -1 : todas.findIndex((f) => f.chave === atual);
  const aVista = indiceDaAtual >= FUNCOES_A_VISTA ? [...todas.slice(0, FUNCOES_A_VISTA - 1), todas[indiceDaAtual]!] : todas.slice(0, FUNCOES_A_VISTA);
  return { aVista: [...aVista, simples], outras: todas.filter((f) => !aVista.includes(f)) };
}

/**
 * A fileira de cores: um toque grifa já com a função (na seleção) ou troca a função (no balão do grifo,
 * com a atual marcada). As cores são as do modo, as mesmas do texto e da margem.
 */
export function FileiraDeCores({ funcoes, atual, aoEscolher, prefixo = '', desabilitada = false }: {
  funcoes: readonly FuncaoParaGrifar[]; atual?: string | undefined; aoEscolher: (funcao: FuncaoParaGrifar) => void; prefixo?: string; desabilitada?: boolean;
}): ReactNode {
  return <span className="fileira-de-cores" role="group" aria-label="Funções do grifo">
    {funcoes.map((funcao, indice) => <button key={funcao.chave} type="button" className="cor-do-grifo" data-funcao={funcao.chave} disabled={desabilitada}
      aria-label={funcao.chave === 'nenhuma' && prefixo ? 'Grifar' : `${prefixo}${funcao.rotulo}`}
      title={`${funcao.rotulo}  ${String(indice + 1)}${funcao.chave === 'nenhuma' && prefixo ? ' ou H' : ''}`}
      aria-pressed={atual === undefined ? undefined : atual === funcao.chave} style={{ '--cor-do-grifo': funcao.cor } as CSSProperties}
      onClick={() => aoEscolher(funcao)}><span className="ponto-do-grifo" aria-hidden="true" /></button>)}
  </span>;
}

/** Item do menu "…" (seleção e balão do grifo). */
export interface ItemDoMenu { id: string; rotulo: string; icone?: string; atalho?: string; perigo?: boolean; desabilitado?: boolean; executar: () => void }

/** O "…": um menu curto, que abre para longe do texto selecionado. */
export function MenuDeMais({ itens, rotulo = 'Mais ações' }: { itens: readonly ItemDoMenu[]; rotulo?: string }): ReactNode {
  const [aberto, abrir] = useState(false);
  const lista = useRef<HTMLUListElement>(null);
  useEffect(() => { if (aberto) lista.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus({ preventScroll: true }); }, [aberto]);
  if (itens.length === 0) return null;
  return <span className="menu-de-mais">
    <IconButton className="botao-da-selecao" aria-label={rotulo} title={rotulo} aria-haspopup="menu" aria-expanded={aberto} onClick={() => abrir(!aberto)}><Icon name="reticencias" size={18} /></IconButton>
    {aberto && <ul ref={lista} className="menu-da-barra" role="menu" aria-label={rotulo} onKeyDown={(evento) => {
      if (evento.key === 'Escape') { evento.stopPropagation(); evento.preventDefault(); abrir(false); return; }
      if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return;
      evento.preventDefault();
      const botoes = [...(lista.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])];
      const atual = botoes.indexOf(document.activeElement as HTMLButtonElement);
      botoes[(atual + (evento.key === 'ArrowDown' ? 1 : -1) + botoes.length) % botoes.length]?.focus();
    }}>
      {itens.map((item) => <li key={item.id} role="none"><button type="button" role="menuitem" className={item.perigo ? 'perigo' : undefined} disabled={item.desabilitado}
        onClick={() => { abrir(false); item.executar(); }}>
        {item.icone && <Icon name={item.icone} size={16} />}<span>{item.rotulo}</span>{item.atalho && <kbd>{atalhoNoSistema(item.atalho)}</kbd>}
      </button></li>)}
    </ul>}
  </span>;
}

/**
 * As ações da seleção no leitor: as cores para grifar já com a função, Perguntar, Conectar e o "…"
 * (flashcard, imagem, fluxograma, resolver, copiar). As teclas 1 a 4 grifam com a cor da posição.
 */
export function AcoesDaSelecao({ aoGrifar, aoPerguntar, aoConectar, aoOutrosOlhares, mais, ocupado = false }: {
  aoGrifar: (funcao: FuncaoParaGrifar) => void; aoPerguntar: () => void; aoConectar: () => void; mais: readonly ItemDoMenu[]; ocupado?: boolean;
  /** Grifa sem função e abre o balão já em "Outros olhares" (as funções dos outros modos). */
  aoOutrosOlhares?: (() => void) | undefined;
}): ReactNode {
  const { aVista, outras } = usarFuncoesParaGrifar();
  const atual = useRef({ aVista, aoGrifar }); atual.current = { aVista, aoGrifar };
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (evento.metaKey || evento.ctrlKey || evento.altKey || digitando(evento.target) || atalhoDeUmaTeclaDesligado(evento)) return;
      const funcao = /^[1-9]$/.test(evento.key) ? atual.current.aVista[Number(evento.key) - 1] : undefined;
      if (funcao) { evento.preventDefault(); atual.current.aoGrifar(funcao); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, []);
  const itens: ItemDoMenu[] = [...outras.map((f) => ({ id: `grifar-${f.chave}`, rotulo: `Grifar como ${f.rotulo.toLocaleLowerCase('pt-BR')}`, icone: 'grifo', executar: () => aoGrifar(f) })),
    ...(aoOutrosOlhares ? [{ id: 'outros-olhares', rotulo: 'Grifar com outro olhar…', icone: 'grifo', executar: aoOutrosOlhares }] : []), ...mais];
  return <>
    <FileiraDeCores funcoes={aVista} prefixo="Grifar como " desabilitada={ocupado} aoEscolher={aoGrifar} />
    <span className="separador-selecao" aria-hidden="true" />
    <Button variante="ghost" className="botao-da-selecao" onClick={aoPerguntar} aria-label="Perguntar" title="Perguntar  P"><IconeDaSelecao nome="perguntar" /><span className="rotulo-da-selecao">Perguntar</span></Button>
    <Button variante="ghost" className="botao-da-selecao" onClick={aoConectar} aria-label="Conectar"><IconeDaSelecao nome="conectar" /><span className="rotulo-da-selecao">Conectar</span></Button>
    <MenuDeMais itens={itens} />
  </>;
}
