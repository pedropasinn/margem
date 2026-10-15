/**
 * Avisos das execuções do Codex no canto inferior direito, montados uma vez na casca do app.
 *
 * `PilhaDeAvisos` só desenha (a galeria de UI a usa com dados falsos); `AvisosDoCodex` liga a
 * pilha ao serviço, ao relógio e à navegação.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ExecucaoDoCodexV2 } from '@margem/contratos';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Primitives';
import { concluidaComAvisos, organizarPilha, tempoDoAviso, type Aviso, type PilhaOrganizada } from './execucoes';
import { usarExecucoes } from './usarExecucoes';
import { cancelarJob } from '../apagar/api';
import { CartaoDaPausa, usarTrabalhosEmPausa } from '../pausa/TrabalhosEmPausa';
import './avisos.css';

const ESTREITO = '(max-width: 599.98px)';

function Indicador({ estado, comAvisos = false }: { estado: ExecucaoDoCodexV2['estado']; comAvisos?: boolean }): ReactNode {
  if (comAvisos) return <span className="indicador-do-aviso" data-estado={estado} data-avisos="" aria-hidden="true"><Icon name="alerta" size={16} /></span>;
  if (estado === 'concluida') return <span className="indicador-do-aviso" data-estado={estado} aria-hidden="true"><Icon name="check" size={16} /></span>;
  if (estado === 'falhou') return <span className="indicador-do-aviso" data-estado={estado} aria-hidden="true"><Icon name="alerta" size={16} /></span>;
  return <span className="indicador-do-aviso" data-estado={estado} aria-hidden="true"><span className="ponto-do-aviso" /></span>;
}

const ESTADO_EM_PALAVRAS: Record<ExecucaoDoCodexV2['estado'], string> = {
  na_fila: 'na fila', rodando: 'rodando', concluida: 'pronto', falhou: 'falhou',
};
const emPalavras = (execucao: ExecucaoDoCodexV2) => (concluidaComAvisos(execucao) ? 'pronto, com avisos' : ESTADO_EM_PALAVRAS[execucao.estado]);

export interface PropsDaPilha {
  pilha: PilhaOrganizada;
  agora: number;
  desvioMs: number;
  anuncio?: string;
  aoDispensar: (id: string) => void;
  aoAbrir: (execucao: ExecucaoDoCodexV2) => void;
  /**
   * V-T8: "Cancelar" num pedido na fila ou rodando. O Codex para e nada do que ele faria fica (uma etapa
   * da análise cancela o capítulo inteiro). Sem ela, o botão não aparece.
   */
  aoCancelar?: (execucao: ExecucaoDoCodexV2) => Promise<void>;
  /** Na galeria, a pilha fica no fluxo da página em vez de presa ao canto. */
  noFluxo?: boolean;
  /** Agrupador aberto de saída (galeria e testes). */
  agrupadorAberto?: boolean;
  /** V-F1: o cartão "N trabalhos do Codex esperando", no topo da pilha (`null` sem nada em pausa). */
  pausa?: ReactNode;
}

export function PilhaDeAvisos({ pilha, agora, desvioMs, anuncio = '', aoDispensar, aoAbrir, aoCancelar, noFluxo = false, agrupadorAberto = false, pausa = null }: PropsDaPilha): ReactNode {
  const [aberto, abrir] = useState(agrupadorAberto);
  const [cancelando, marcarCancelando] = useState<ReadonlySet<string>>(new Set());
  const [falhaAoCancelar, definirFalha] = useState<string | null>(null);
  const emAndamento = (execucao: ExecucaoDoCodexV2) => execucao.estado === 'na_fila' || execucao.estado === 'rodando';
  const cancelar = (execucao: ExecucaoDoCodexV2) => {
    if (!aoCancelar) return;
    marcarCancelando((atual) => new Set(atual).add(execucao.id)); definirFalha(null);
    void aoCancelar(execucao).then(() => aoDispensar(execucao.id), (erro: unknown) => {
      definirFalha(erro instanceof Error ? erro.message : 'Não foi possível cancelar.');
    }).finally(() => marcarCancelando((atual) => { const novo = new Set(atual); novo.delete(execucao.id); return novo; }));
  };
  const botaoCancelar = (execucao: ExecucaoDoCodexV2, classe = 'cancelar-do-aviso') => aoCancelar && emAndamento(execucao)
    && <button type="button" className={classe} disabled={cancelando.has(execucao.id)} aria-label={`Cancelar: ${execucao.rotulo}`}
      title="Para o Codex agora; nada do que ele faria fica" onClick={() => cancelar(execucao)}>{cancelando.has(execucao.id) ? 'Cancelando…' : 'Cancelar'}</button>;
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

  const vazio = pilha.visiveis.length === 0 && pilha.mais === 0 && (pausa === null || pausa === false);
  const linhaDoTempo = (aviso: Aviso) => {
    const tempo = tempoDoAviso(aviso.execucao, agora, desvioMs);
    return aviso.execucao.estado === 'rodando' ? `Codex · rodando · ${tempo}` : `Codex · ${tempo.toLowerCase()}`;
  };

  return <section ref={raiz} className={`avisos-do-codex${noFluxo ? ' no-fluxo' : ''}`} aria-label="Execuções do Codex" onKeyDown={teclado} data-vazio={vazio || undefined}>
    <p className="anuncio-dos-avisos" role="status" aria-live="polite">{anuncio}</p>
    {pausa}
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
          {botaoCancelar(aviso.execucao, 'cancelar-do-aviso cancelar-agrupado')}
        </li>)}
        {pilha.mais > pilha.agrupados.length && <li className="avisos-omitidos">e mais {pilha.mais - pilha.agrupados.length} na fila</li>}
      </ul>}
    </div>}
    <ol className="avisos-pilha">
      {pilha.visiveis.map(({ execucao, ...aviso }) => <li key={execucao.id} className="aviso-do-codex" data-id={execucao.id} data-estado={execucao.estado}
        data-avisos={concluidaComAvisos(execucao) ? '' : undefined} aria-label={`${execucao.rotulo}: ${emPalavras(execucao)}`}>
        <Indicador estado={execucao.estado} comAvisos={concluidaComAvisos(execucao)} />
        <div className="corpo-do-aviso">
          <p className="rotulo-do-aviso">{execucao.rotulo}</p>
          <p className="meta-do-aviso"><span aria-live="off">{linhaDoTempo({ execucao, ...aviso })}</span></p>
          {execucao.estado === 'falhou' && execucao.mensagem && <p className="mensagem-do-aviso">{execucao.mensagem}</p>}
          {falhaAoCancelar && emAndamento(execucao) && <p className="mensagem-do-aviso" role="alert">{falhaAoCancelar}</p>}
          {concluidaComAvisos(execucao) && <ul className="avisos-da-execucao">{execucao.avisos.map((aviso) =>
            <li key={aviso.codigo}>{aviso.mensagem}</li>)}</ul>}
        </div>
        <div className="acoes-do-aviso">
          {botaoCancelar(execucao)}
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
  const { pausa, retomar, descartar } = usarTrabalhosEmPausa();
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
    aoAbrir={(execucao) => { if (execucao.rota) ir(execucao.rota); }}
    aoCancelar={async (execucao) => { await cancelarJob(execucao.id); }}
    pausa={pausa.total > 0 ? <CartaoDaPausa pausa={pausa} aoRetomar={retomar} aoDescartar={descartar} /> : null} />;
}
