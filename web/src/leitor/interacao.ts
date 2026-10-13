import type { Id } from '@margem/contratos';

/**
 * Estado transitório que coordena trecho e nota. Fica no ancestral comum (`ReaderController`),
 * nunca em dois componentes tentando se sincronizar, e nada dele vai ao servidor.
 *
 * O SPEC chama os campos de `hoveredId`, `focusedId` e `pinnedId`; a regra 8 do `AGENTS.md`
 * pede nomes em português, então aqui eles são `pairada`, `focada` e `fixada`.
 */
export interface EstadoDaInteracao {
  pairada: Id | null;
  focada: Id | null;
  fixada: Id | null;
}

export type AcaoDaInteracao =
  | { tipo: 'entrar'; id: Id }
  | { tipo: 'sair'; id: Id }
  | { tipo: 'fixar'; id: Id }
  | { tipo: 'focar'; id: Id }
  | { tipo: 'desfocar'; id: Id }
  | { tipo: 'fechar' };

export const INTERACAO_VAZIA: EstadoDaInteracao = { pairada: null, focada: null, fixada: null };

/** `fixada ?? focada ?? pairada`: a fixação ganha do foco, que ganha do ponteiro. */
export function marcaAtiva(estado: EstadoDaInteracao): Id | null {
  return estado.fixada ?? estado.focada ?? estado.pairada;
}

export function reduzirInteracao(estado: EstadoDaInteracao, acao: AcaoDaInteracao): EstadoDaInteracao {
  switch (acao.tipo) {
    case 'entrar':
      return estado.pairada === acao.id ? estado : { ...estado, pairada: acao.id };
    case 'sair':
      // Sair de outro trecho não apaga o corrente: o corredor entre trecho e nota é contínuo.
      return estado.pairada === acao.id ? { ...estado, pairada: null } : estado;
    case 'fixar':
      return estado.fixada === acao.id ? { ...estado, fixada: null } : { ...estado, fixada: acao.id };
    case 'focar':
      return estado.focada === acao.id ? estado : { ...estado, focada: acao.id };
    case 'desfocar':
      return estado.focada === acao.id ? { ...estado, focada: null } : estado;
    case 'fechar':
      return INTERACAO_VAZIA;
  }
}
