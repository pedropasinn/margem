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

/** Uma leitura concluída com avisos (leitura parcial, marcas que ficaram de fora): não sai sozinha. */
export function ExemploDeAvisosComRessalva(): ReactNode {
  const [agora] = useState(() => Date.now());
  const [estado, definir] = useState(() => {
    const lista = listaDeExemplo(agora);
    const base = lista.execucoes[1]!;
    const PARCIAL = 'O Codex leu só parte deste trecho; pode faltar alguma marca.';
    lista.execucoes = [{ ...base, id: '01K0000000000000000000J009', tipo: 'ler_parte', rotulo: 'Lendo o capítulo 2 de Mixtape', mensagem: PARCIAL,
      avisos: [{ codigo: 'leitura_parcial', mensagem: PARCIAL }, { codigo: 'marcas_recusadas', mensagem: '3 marcas ficaram de fora porque não deu para ancorá-las no texto.' }] }];
    lista.omitidas = 0;
    return reduzirAvisos(ESTADO_INICIAL, { tipo: 'lista', lista, recebidaEm: agora });
  });
  return <PilhaDeAvisos noFluxo pilha={organizarPilha(estado)} agora={agora} desvioMs={estado.desvioMs}
    aoDispensar={(id) => definir((atual) => reduzirAvisos(atual, { tipo: 'dispensar', id }))} aoAbrir={() => undefined} />;
}
