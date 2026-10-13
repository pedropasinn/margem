import { Button } from '../ui/Primitives';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AncoraV1, RelacaoConexao } from '@margem/contratos';
export interface EscolhaDeDestino { origem: AncoraV1; relacao: RelacaoConexao; justificativa: string }
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
    {escolha && <div className="escolha-destino" role="status">Escolha outro trecho: navegue até o destino e selecione o texto. <Button type="button" onClick={() => escolher(null)}>Cancelar escolha · Esc</Button></div>}
    {children}
  </Contexto.Provider>;
}
