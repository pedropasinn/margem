/**
 * Aviso discreto de versão pronta (J146), no lugar da caixa de diálogo do sistema: uma pílula no pé da
 * janela com "Reiniciar agora" e "Depois". "Depois" só esconde o aviso desta versão; a atualização é
 * instalada quando a pessoa fechar o Margem (e segue em Configurações → Sobre e atualizações).
 */
import { useState, type ReactNode } from 'react';
import { ponteDaAtualizacao, type PonteDaAtualizacao } from './ponte';
import { useAtualizacao } from './useAtualizacao';
import './atualizacao.css';

export function AvisoDeAtualizacao({ ponte = ponteDaAtualizacao() }: { ponte?: PonteDaAtualizacao | null } = {}): ReactNode {
  const situacao = useAtualizacao(ponte);
  const [dispensada, dispensar] = useState<string | null>(null);
  const estado = situacao?.atualizacao;
  if (ponte === null || estado?.estado !== 'pronta' || dispensada === estado.versao) return null;
  return <div className="aviso-de-atualizacao" role="status" aria-live="polite">
    <span>O Margem {estado.versao} está pronto para instalar.</span>
    <button type="button" className="principal" onClick={() => ponte.reiniciar()}>Reiniciar agora</button>
    <button type="button" onClick={() => dispensar(estado.versao)} title="Instala quando você fechar o Margem">Depois</button>
  </div>;
}
