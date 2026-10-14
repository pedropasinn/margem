import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listarDocumentos } from '../biblioteca/api';
import { armazemLocal, type ArmazemDoOnboarding } from './armazem';
import { ONBOARDING_INICIAL, reduzirOnboarding, type AcaoDoOnboarding, type EstadoDoOnboarding } from './estado';

export interface ValorDoOnboarding {
  estado: EstadoDoOnboarding;
  despachar: (acao: AcaoDoOnboarding) => void;
  /** Falso até sabermos se é a primeira abertura (evita piscar as boas-vindas para quem já usa). */
  pronto: boolean;
  /** Fora do provedor (testes, páginas `/dev`) nada do onboarding aparece. */
  ativo: boolean;
}

const TUDO_VISTO: EstadoDoOnboarding = {
  ...ONBOARDING_INICIAL, boas_vindas: 'concluida', tours: { texto: 'concluida', video: 'concluida', quadro: 'concluida' }, levar: 'concluida',
  primeiro_documento: { estado: 'concluida', origem: 'uso_anterior', documento_id: null },
};

const Contexto = createContext<ValorDoOnboarding>({ estado: TUDO_VISTO, despachar: () => {}, pronto: true, ativo: false });

export function usarOnboarding(): ValorDoOnboarding {
  return useContext(Contexto);
}

/** Há textos na biblioteca (arquivados inclusive)? Quem já tinha, não é recebido como estreante. */
async function jaUsava(): Promise<boolean> {
  const [ativos, arquivados] = await Promise.all([listarDocumentos(false), listarDocumentos(true)]);
  return ativos.documentos.length + arquivados.documentos.length > 0;
}

export function ProvedorDoOnboarding({ children, armazem: armazemDado, verificarUsoAnterior = jaUsava, agora = () => new Date().toISOString() }: {
  children: ReactNode;
  armazem?: ArmazemDoOnboarding;
  verificarUsoAnterior?: () => Promise<boolean>;
  agora?: () => string;
}): ReactNode {
  const armazem = useMemo(() => armazemDado ?? armazemLocal(), [armazemDado]);
  const [guardado] = useState(() => armazem.ler());
  const [estado, definir] = useState<EstadoDoOnboarding>(() => guardado ?? { ...ONBOARDING_INICIAL });
  const [pronto, aprontar] = useState(guardado !== null);
  const agoraRef = useRef(agora); agoraRef.current = agora;

  const despachar = useCallback((acao: AcaoDoOnboarding) => {
    definir((atual) => reduzirOnboarding(atual, acao, agoraRef.current()));
  }, []);
  // Grava depois de cada mudança; antes da primeira ação nada é escrito (continua "primeira abertura").
  useEffect(() => { if (estado.atualizado_em !== null) armazem.gravar(estado); }, [estado, armazem]);

  useEffect(() => {
    if (guardado !== null) return;
    let vivo = true;
    verificarUsoAnterior().then((usava) => { if (vivo && usava) despachar({ tipo: 'dispensar_por_uso_anterior' }); },
      () => { /* sem API: trata como primeira abertura */ })
      .finally(() => { if (vivo) aprontar(true); });
    return () => { vivo = false; };
  }, [guardado, verificarUsoAnterior, despachar]);

  const valor = useMemo(() => ({ estado, despachar, pronto, ativo: true }), [estado, despachar, pronto]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
