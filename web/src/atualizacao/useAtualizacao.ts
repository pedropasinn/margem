import { useEffect, useState } from 'react';
import { ponteDaAtualizacao, type PonteDaAtualizacao, type SituacaoDaAtualizacao } from './ponte';

/** A situação da atualização, ao vivo (null enquanto não chegou ou fora do app de computador). */
export function useAtualizacao(ponte: PonteDaAtualizacao | null = ponteDaAtualizacao()): SituacaoDaAtualizacao | null {
  const [situacao, definir] = useState<SituacaoDaAtualizacao | null>(null);
  useEffect(() => {
    if (ponte === null) return undefined;
    let vivo = true;
    const parar = ponte.aoMudar((nova) => { if (vivo) definir(nova); });
    ponte.situacao().then((nova) => { if (vivo) definir((atual) => atual ?? nova); }, () => undefined);
    return () => { vivo = false; parar(); };
  }, [ponte]);
  return situacao;
}
