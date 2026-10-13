/**
 * Avisos das execuções do Codex no canto inferior direito, montados uma vez na casca do app.
 *
 * `PilhaDeAvisos` só desenha (a galeria de UI a usa com dados falsos); `AvisosDoCodex` liga a
 * pilha ao serviço, ao relógio e à navegação.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ExecucaoDoCodexV1 } from '@margem/contratos';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Primitives';
import { organizarPilha, tempoDoAviso, type Aviso, type PilhaOrganizada } from './execucoes';
import { usarExecucoes } from './usarExecucoes';
import './avisos.css';

const ESTREITO = '(max-width: 599.98px)';

function Indicador({ estado }: { estado: ExecucaoDoCodexV1['estado'] }): ReactNode {
  if (estado === 'concluida') return <span className="indicador-do-aviso" data-estado={estado} aria-hidden="true"><Icon name="check" size={16} /></span>;
  if (estado === 'falhou') return <span className="indicador-do-aviso" data-estado={estado} aria-hidden="true"><Icon name="alerta" size={16} /></span>;
  return <span className="indicador-do-aviso" data-estado={estado} aria-hidden="true"><span className="ponto-do-aviso" /></span>;
}

const ESTADO_EM_PALAVRAS: Record<ExecucaoDoCodexV1['estado'], string> = {
  na_fila: 'na fila', rodando: 'rodando', concluida: 'pronto', falhou: 'falhou',
};

export interface PropsDaPilha {
  pilha: PilhaOrganizada;
  agora: number;
  desvioMs: number;
  anuncio?: string;
  aoDispensar: (id: string) => void;
  aoAbrir: (execucao: ExecucaoDoCodexV1) => void;
  /** Na galeria, a pilha fica no fluxo da página em vez de presa ao canto. */
  noFluxo?: boolean;
  /** Agrupador aberto de saída (galeria e testes). */
  agrupadorAberto?: boolean;
}

export function PilhaDeAvisos({ pilha, agora, desvioMs, anuncio = '', aoDispensar, aoAbrir, noFluxo = false, agrupadorAberto = false }: PropsDaPilha): ReactNode {
  const [aberto, abrir] = useState(agrupadorAberto);
  const raiz = useRef<HTMLElement>(null);
  useEffect(() => { if (pilha.mais === 0) abrir(false); }, [pilha.mais]);

  const dispensar = (id: string) => {
    const focoDentro = raiz.current?.contains(document.activeElement) ?? false;
    aoDispensar(id);
    if (!focoDentro) return;
    // O foco não se perde: vai para o próximo aviso ou, sem nenhum, de volta ao conteúdo.
    requestAnimationFrame(() => {
      const proximo = raiz.current?.querySelector<HTMLElement>(`.aviso-do-codex:not([data-id="${id}"]) button, .avisos-mais`);
      if (proximo) proximo.focus();
      else document.getElementById('conteudo')?.focus();
    });
  };
  const teclado = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    const alvo = e.target as HTMLElement;
    if (aberto && alvo.closest('.avisos-agrupador')) { e.preventDefault(); e.stopPropagation(); abrir(false); raiz.current?.querySelector<HTMLElement>('.avisos-mais')?.focus(); return; }
    const id = alvo.closest<HTMLElement>('.aviso-do-codex')?.dataset.id;
    if (id) { e.preventDefault(); e.stopPropagation(); dispensar(id); }
  };

  const vazio = pilha.visiveis.length === 0 && pilha.mais === 0;
  const linhaDoTempo = (aviso: Aviso) => {
    const tempo = tempoDoAviso(aviso.execucao, agora, desvioMs);
    return aviso.execucao.estado === 'rodando' ? `Codex · rodando · ${tempo}` : `Codex · ${tempo.toLowerCase()}`;
  };

  return <section ref={raiz} className={`avisos-do-codex${noFluxo ? ' no-fluxo' : ''}`} aria-label="Execuções do Codex" onKeyDown={teclado} data-vazio={vazio || undefined}>
    <p className="anuncio-dos-avisos" role="status" aria-live="polite">{anuncio}</p>
    {pilha.mais > 0 && <div className="avisos-agrupador">
      <button type="button" className="avisos-mais" aria-expanded={aberto} onClick={() => abrir(!aberto)}>
        <span className="ponto-do-aviso" aria-hidden="true" />
        <span>Mais {pilha.mais} em andamento</span>
        <span className={`avisos-chevron${aberto ? ' aberto' : ''}`} aria-hidden="true"><Icon name="chevron" size={14} /></span>
      </button>
      {aberto && <ul className="avisos-agrupados">
        {pilha.agrupados.map((aviso) => <li key={aviso.execucao.id} data-estado={aviso.execucao.estado}>
          <Indicador estado={aviso.execucao.estado} />
          <span className="rotulo-agrupado">{aviso.execucao.rotulo}</span>
          <span className="tempo-agrupado">{tempoDoAviso(aviso.execucao, agora, desvioMs)}</span>
        </li>)}
        {pilha.mais > pilha.agrupados.length && <li className="avisos-omitidos">e mais {pilha.mais - pilha.agrupados.length} na fila</li>}
      </ul>}
    </div>}
    <ol className="avisos-pilha">
      {pilha.visiveis.map(({ execucao, ...aviso }) => <li key={execucao.id} className="aviso-do-codex" data-id={execucao.id} data-estado={execucao.estado}
        aria-label={`${execucao.rotulo}: ${ESTADO_EM_PALAVRAS[execucao.estado]}`}>
        <Indicador estado={execucao.estado} />
        <div className="corpo-do-aviso">
          <p className="rotulo-do-aviso">{execucao.rotulo}</p>
          <p className="meta-do-aviso"><span aria-live="off">{linhaDoTempo({ execucao, ...aviso })}</span></p>
          {execucao.estado === 'falhou' && execucao.mensagem && <p className="mensagem-do-aviso">{execucao.mensagem}</p>}
        </div>
        <div className="acoes-do-aviso">
          {execucao.estado === 'concluida' && execucao.rota && <a className="abrir-do-aviso" href={execucao.rota}
            onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); aoAbrir(execucao); aoDispensar(execucao.id); }}>Abrir</a>}
          <IconButton className="fechar-do-aviso" aria-label={`Dispensar aviso: ${execucao.rotulo}`} title="Dispensar (Esc)" onClick={() => dispensar(execucao.id)}><Icon name="xis" size={16} /></IconButton>
        </div>
      </li>)}
    </ol>
  </section>;
}

function usarEstreito(): boolean {
  const [estreito, definir] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(ESTREITO).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const consulta = window.matchMedia(ESTREITO);
    const mudar = () => definir(consulta.matches);
    consulta.addEventListener('change', mudar);
    return () => consulta.removeEventListener('change', mudar);
  }, []);
  return estreito;
}

/** A pilha ligada ao serviço. `ir` recebe o caminho do resultado (`/ler/<doc>/<seção>`). */
export function AvisosDoCodex({ ir }: { ir: (caminho: string) => void }): ReactNode {
  const { estado, despachar, anuncio } = usarExecucoes();
  const [agora, definirAgora] = useState(() => Date.now());
  const estreito = usarEstreito();
  // No celular, um aviso só (o resto no agrupador): a pilha não pode tomar a página.
  const pilha = organizarPilha(estado, estreito ? 1 : 3);
  const algo = pilha.visiveis.length > 0 || pilha.mais > 0;
  useEffect(() => {
    if (!algo) return;
    const relogio = setInterval(() => {
      const instante = Date.now();
      definirAgora(instante);
      despachar({ tipo: 'expirar', agora: instante });
    }, 1000);
    return () => clearInterval(relogio);
  }, [algo, despachar]);
  return <PilhaDeAvisos pilha={pilha} agora={agora} desvioMs={estado.desvioMs} anuncio={anuncio}
    aoDispensar={(id) => despachar({ tipo: 'dispensar', id })}
    aoAbrir={(execucao) => { if (execucao.rota) ir(execucao.rota); }} />;
}
