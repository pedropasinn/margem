import { useState, type ReactNode } from 'react';
import { ESTADO_INICIAL, organizarPilha, reduzirAvisos } from './execucoes';
import { listaDeExemplo } from './exemplos';
import { PilhaDeAvisos } from './AvisosDoCodex';

/** A pilha de avisos do Codex com dados falsos, no fluxo da galeria. */
export function ExemploDeAvisos(): ReactNode {
  const [agora] = useState(() => Date.now());
  const [estado, definir] = useState(() => reduzirAvisos(ESTADO_INICIAL, { tipo: 'lista', lista: listaDeExemplo(agora), recebidaEm: agora }));
  return <PilhaDeAvisos noFluxo agrupadorAberto pilha={organizarPilha(estado)} agora={agora} desvioMs={estado.desvioMs}
    aoDispensar={(id) => definir((atual) => reduzirAvisos(atual, { tipo: 'dispensar', id }))} aoAbrir={() => undefined} />;
}
