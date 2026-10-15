/**
 * Aviso de versão nova (J146, refeito no J151). Um cartão no canto da janela, sem bloquear nada, que
 * aparece ao abrir o app (ou quando uma procura acha versão nova com ele aberto):
 *   - disponível: "Versão X disponível", a linha do que mudou (ou "O que mudou") e o download em segundo plano;
 *   - baixando (a pessoa pediu): a porcentagem, e o Margem reinicia sozinho ao terminar;
 *   - pronta: "Atualizar agora" reinicia e instala;
 *   - erro: o motivo, "Tentar de novo" e o link para baixar no site.
 * "Depois" esconde o aviso desta versão até o app fechar; a instalação acontece quando a pessoa fechar o
 * Margem. No macOS sem assinatura o botão leva ao site.
 */
import { useState, type ReactNode } from 'react';
import { Button } from '../ui/Primitives';
import { ponteDaAtualizacao, vistaDoAviso, type PonteDaAtualizacao, type VistaDoAviso } from './ponte';
import { useAtualizacao } from './useAtualizacao';
import './atualizacao.css';

const CHAVE = 'margem:atualizacao:depois';

/** O "Depois" vale até o app fechar: sobrevive às trocas de página (sessionStorage), não ao reinício. */
function lerDispensada(): string | null {
  try { return window.sessionStorage.getItem(CHAVE); } catch { return null; }
}
function gravarDispensada(chave: string): void {
  try { window.sessionStorage.setItem(CHAVE, chave); } catch { /* fica só na memória */ }
}

function titulo(vista: VistaDoAviso): string {
  switch (vista.tipo) {
    case 'disponivel': return `Versão ${vista.versao} disponível`;
    case 'baixando': return vista.versao === null ? 'Atualizando o Margem' : `Atualizando para a versão ${vista.versao}`;
    case 'pronta': return `Versão ${vista.versao} pronta para instalar`;
    case 'erro': return 'Não deu para atualizar o Margem';
  }
}

export function AvisoDeAtualizacao({ ponte = ponteDaAtualizacao() }: { ponte?: PonteDaAtualizacao | null } = {}): ReactNode {
  const situacao = useAtualizacao(ponte);
  const [dispensada, dispensar] = useState<string | null>(lerDispensada);
  const vista = vistaDoAviso(situacao?.atualizacao);
  if (ponte === null || vista === null) return null;
  const chave = vista.versao ?? 'erro';
  if (dispensada === chave) return null;
  const depois = (adiar: boolean) => {
    if (adiar) ponte.adiar();
    gravarDispensada(chave);
    dispensar(chave);
  };
  const notas = vista.tipo === 'erro' ? null : vista.notas;
  const manual = vista.tipo === 'disponivel' && vista.manual;

  return <section className="aviso-de-atualizacao" role="status" aria-live="polite" aria-labelledby="titulo-do-aviso-de-atualizacao" data-tipo={vista.tipo}>
    <p className="titulo" id="titulo-do-aviso-de-atualizacao">{titulo(vista)}</p>
    {vista.tipo !== 'erro' && <p className="o-que-mudou">
      {notas !== null && <span>{notas} </span>}
      <button type="button" className="link" onClick={() => ponte.abrirNovidades()}>O que mudou</button>
    </p>}
    {vista.tipo === 'disponivel' && <p className="detalhe">
      {manual ? 'Neste computador, a versão nova é instalada pelo site. A biblioteca continua onde está.'
        : vista.porcentagem === null ? 'O download leva alguns minutos.'
          : `Baixando em segundo plano: ${vista.porcentagem}%.`}
    </p>}
    {vista.tipo === 'baixando' && <>
      <div className="progress-track" role="progressbar" aria-label="Download da versão nova" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={vista.porcentagem}><span style={{ width: `${vista.porcentagem}%` }} /></div>
      <p className="detalhe">Baixando: {vista.porcentagem}%. O Margem reinicia sozinho ao terminar.</p>
    </>}
    {vista.tipo === 'pronta' && <p className="detalhe">O Margem fecha e abre de novo, já atualizado. Leva alguns segundos.</p>}
    {vista.tipo === 'erro' && <p className="detalhe">{vista.motivo} Se continuar, <button type="button" className="link" onClick={() => ponte.abrirDownload()}>baixe no site</button>.</p>}
    <div className="acoes">
      {vista.tipo === 'erro'
        ? <>
          <Button variante="primario" tamanho="sm" onClick={() => ponte.atualizarAgora()}>Tentar de novo</Button>
          <Button variante="ghost" tamanho="sm" onClick={() => depois(false)}>Agora não</Button>
        </>
        : manual
          ? <>
            <Button variante="primario" tamanho="sm" onClick={() => ponte.atualizarAgora()}>Baixar no site</Button>
            <Button variante="ghost" tamanho="sm" onClick={() => depois(false)}>Depois</Button>
          </>
          : <>
            {vista.tipo !== 'baixando' && <Button variante="primario" tamanho="sm" onClick={() => ponte.atualizarAgora()}>Atualizar agora</Button>}
            <Button variante="ghost" tamanho="sm" onClick={() => depois(true)}>Depois (instala ao fechar)</Button>
          </>}
    </div>
  </section>;
}
