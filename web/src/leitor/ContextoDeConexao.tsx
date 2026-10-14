import { Button } from '../ui/Primitives';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AncoraV1, RelacaoConexao } from '@margem/contratos';
/** O primeiro trecho de uma conexão, à espera do segundo (J132: a relação se escolhe depois, num diálogo pequeno). */
export interface EscolhaDeDestino { origem: AncoraV1; relacao?: RelacaoConexao; justificativa?: string }
const Contexto = createContext<{ escolha: EscolhaDeDestino | null; escolher: (valor: EscolhaDeDestino | null) => void }>({ escolha: null, escolher: () => {} });
export const usarEscolhaDeDestino = () => useContext(Contexto);
export function ContextoDeConexao({ children }: { children: ReactNode }): ReactNode {
  const [escolha, escolher] = useState<EscolhaDeDestino | null>(null);
  useEffect(() => {
    const cancelar = (e: KeyboardEvent) => { if (e.key === 'Escape') escolher(null); };
    window.addEventListener('keydown', cancelar);
    return () => window.removeEventListener('keydown', cancelar);
  }, []);
  return <Contexto.Provider value={{ escolha, escolher }}>
    {escolha && <div className="escolha-destino" role="status"><span>Selecione o outro trecho e confirme <strong>Conectar estes dois</strong>. Não precisa estar grifado.</span><Button variante="ghost" tamanho="sm" onClick={() => escolher(null)}>Cancelar</Button></div>}
    {children}
  </Contexto.Provider>;
}
