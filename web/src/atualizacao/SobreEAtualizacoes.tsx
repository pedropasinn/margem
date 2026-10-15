/**
 * Configurações → Sobre e atualizações (J146): a versão instalada, "Procurar atualização" e o estado
 * (procurando, atualizado, baixando, pronta para instalar, indisponível). Só no app de computador.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../ui/Primitives';
import { frase, ponteDaAtualizacao, type PonteDaAtualizacao } from './ponte';
import { useAtualizacao } from './useAtualizacao';
import './atualizacao.css';

export function SobreEAtualizacoes({ ponte = ponteDaAtualizacao() }: { ponte?: PonteDaAtualizacao | null } = {}): ReactNode {
  const situacao = useAtualizacao(ponte);
  const [pedindo, pedir] = useState(false);
  const chegou = situacao !== null;
  // Menu → Procurar atualizações… abre /configuracoes#atualizacoes: a seção só existe depois da ponte responder.
  // As seções de cima (Modelos, Áudio) carregam depois e empurram esta para baixo: rola de novo enquanto elas chegam.
  useEffect(() => {
    if (!chegou || window.location.hash !== '#atualizacoes') return undefined;
    const rolar = () => { document.getElementById('atualizacoes')?.scrollIntoView?.({ block: 'start' }); };
    rolar();
    const relogios = [300, 1000, 2000].map((ms) => setTimeout(rolar, ms));
    return () => { relogios.forEach(clearTimeout); };
  }, [chegou]);
  if (ponte === null) return null;
  const estado = situacao?.atualizacao;
  const procurar = () => {
    pedir(true);
    ponte.procurar().catch(() => undefined).finally(() => pedir(false));
  };
  const ocupado = pedindo || estado?.estado === 'procurando' || estado?.estado === 'baixando';
  const desligada = estado?.estado === 'desligada';

  return <section className="card configuracao-da-atualizacao" id="atualizacoes" aria-labelledby="titulo-da-atualizacao" aria-busy={situacao === null}>
    <div className="cabeca-da-secao">
      <h2 id="titulo-da-atualizacao">Sobre e atualizações</h2>
      <p className="secundario">Quando sai uma versão nova, o Margem baixa sozinho e instala ao fechar. A biblioteca, as notas e as configurações continuam onde estão.</p>
    </div>
    <dl className="versao-instalada">
      <dt>Versão instalada</dt>
      <dd>{situacao === null ? '…' : `Margem ${situacao.versao}`}</dd>
    </dl>
    {estado && <div className="estado-da-atualizacao" role="status" aria-live="polite">
      <p>{frase(estado)}</p>
      {estado.estado === 'baixando' && <div className="progress-track" role="progressbar" aria-label="Download da versão nova"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={estado.porcentagem}><span style={{ width: `${estado.porcentagem}%` }} /></div>}
    </div>}
    <div className="button-row">
      {estado?.estado === 'pronta'
        ? <Button variante="primario" onClick={() => ponte.reiniciar()}>Reiniciar e atualizar</Button>
        : estado?.estado === 'manual'
          ? <Button variante="primario" onClick={() => ponte.abrirDownload()}>Baixar a versão nova</Button>
          : estado?.estado === 'disponivel'
            ? <Button variante="primario" onClick={() => ponte.atualizarAgora()}>Atualizar agora</Button>
          : <Button disabled={situacao === null || ocupado || desligada} onClick={procurar}>{estado?.estado === 'procurando' ? 'Procurando…' : 'Procurar atualização'}</Button>}
      {desligada && estado.motivo === 'sem_feed' && <Button variante="ghost" onClick={() => ponte.abrirDownload()}>Abrir margem.dev</Button>}
    </div>
  </section>;
}
