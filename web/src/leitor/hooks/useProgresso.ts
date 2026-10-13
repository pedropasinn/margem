import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AncoraV1, Id, ProgressoV1 } from '@margem/contratos';
import { ancoraDoPonto, pontoDaAncora } from '../ancora';
import type { ApiDoLeitor, SnapshotCapitulo } from '../tipos';

/** O que o servidor devolve: o mesmo progresso, com a revisão que ele atribuiu. */
export interface ProgressoGravado extends Omit<ProgressoV1, 'revisao_esperada'> {
  revisao: number;
}

export type RespostaDoProgresso =
  | { estado: 'gravado'; progresso: ProgressoGravado }
  | { estado: 'obsoleto'; progresso: ProgressoGravado | null }
  | { estado: 'erro'; progresso?: undefined };

export interface FontesDoProgresso {
  ler: (documentoId: Id) => Promise<ProgressoGravado | null>;
  gravar: (documentoId: Id, progresso: ProgressoV1) => Promise<RespostaDoProgresso>;
}

export interface OpcoesDoProgresso {
  documento_id: Id;
  snapshot: SnapshotCapitulo;
  leitor: RefObject<ApiDoLeitor | null>;
  /** Sem fontes, a leitura ainda retoma: vale a cópia em `localStorage`. */
  fontes?: FontesDoProgresso | undefined;
  atrasoMs?: number;
  agora?: () => string;
}

export interface ProgressoDoLeitor {
  capitulos_concluidos: readonly Id[];
  revisao: number;
  aviso: string | null;
  concluido: (secaoId: Id) => boolean;
  marcarCapituloLido: (secaoId: Id) => void;
  registrarLeitura: () => void;
  salvarAgora: () => void;
}

export const ATRASO_DO_PROGRESSO_MS = 2000;
/** Onde a âncora retomada é posta na tela: perto do topo, mas não colada nele. */
export const ALVO_DA_RETOMADA_PX = 96;

export const AVISO_DE_CONFLITO = 'posição mais recente em outro aparelho';

export function chaveLocal(documentoId: Id): string {
  return `margem:progresso:${documentoId}`;
}

interface CopiaLocal {
  progresso: ProgressoGravado;
  carimbo: string;
}

function lerCopiaLocal(documentoId: Id): CopiaLocal | null {
  try {
    const bruto = window.localStorage.getItem(chaveLocal(documentoId));
    if (bruto === null) return null;
    const copia = JSON.parse(bruto) as CopiaLocal;
    return typeof copia.carimbo === 'string' && typeof copia.progresso.revisao === 'number' ? copia : null;
  } catch {
    return null;
  }
}

function gravarCopiaLocal(documentoId: Id, copia: CopiaLocal): void {
  try {
    window.localStorage.setItem(chaveLocal(documentoId), JSON.stringify(copia));
  } catch {
    // Armazenamento indisponível (janela privativa, cota): a retomada pelo servidor continua.
  }
}

/**
 * Retomada por âncora, salvamento com atraso e revisão otimista.
 *
 * `Range`, `DOMRect` e `scrollTop` não saem daqui: o que é persistido é identidade textual
 * (bloco + deslocamento UTF-16 com citação e contexto literais).
 */
export function useProgresso({
  documento_id, snapshot, leitor, fontes, atrasoMs = ATRASO_DO_PROGRESSO_MS, agora,
}: OpcoesDoProgresso): ProgressoDoLeitor {
  const [capitulos, definirCapitulos] = useState<readonly Id[]>([]);
  const [revisao, definirRevisao] = useState(0);
  const [aviso, definirAviso] = useState<string | null>(null);

  const capitulosRef = useRef<readonly Id[]>(capitulos);
  const revisaoRef = useRef(revisao);
  const ancoraRef = useRef<AncoraV1 | null>(null);
  const tempoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retomouRef = useRef(false);
  const retomadaPendente = useRef<AncoraV1 | null>(null);
  const larguraRef = useRef<number>(typeof window === 'undefined' ? 0 : window.innerWidth);
  const relogio = useRef(agora ?? ((): string => new Date().toISOString()));

  capitulosRef.current = capitulos;
  revisaoRef.current = revisao;

  const adotar = useCallback((gravado: ProgressoGravado) => {
    definirRevisao(gravado.revisao);
    definirCapitulos(gravado.capitulos_concluidos);
    revisaoRef.current = gravado.revisao;
    capitulosRef.current = gravado.capitulos_concluidos;
    ancoraRef.current = gravado.ancora;
  }, []);

  /** Rola até a âncora, sem animação. A geometria vem do navegador, nunca de estimativa. */
  const rolarAte = useCallback((ancora: AncoraV1) => {
    const ponto = pontoDaAncora(ancora);
    const caixa = leitor.current?.localizar(ponto.bloco_id, ponto.offset_utf16) ?? null;
    if (caixa === null) { retomadaPendente.current = ancora; return; }
    retomadaPendente.current = null;
    if (typeof window.scrollBy !== 'function') return;
    window.scrollBy({ top: caixa.top - ALVO_DA_RETOMADA_PX, left: 0, behavior: 'auto' });
  }, [leitor]);

  useEffect(() => {
    const tentar = () => { if (retomadaPendente.current) rolarAte(retomadaPendente.current); };
    window.addEventListener('margem:geometria', tentar);
    return () => window.removeEventListener('margem:geometria', tentar);
  }, [rolarAte]);

  const limparTempo = useCallback(() => {
    if (tempoRef.current !== null) {
      clearTimeout(tempoRef.current);
      tempoRef.current = null;
    }
  }, []);

  const salvar = useCallback(() => {
    limparTempo();
    const ponto = leitor.current?.ancoraVisivel() ?? null;
    const ancora = ponto === null ? ancoraRef.current : ancoraDoPonto(snapshot.blocos, snapshot.versao_id, ponto);
    if (ancora === null) return;
    ancoraRef.current = ancora;
    const progresso: ProgressoV1 = {
      documento_id,
      versao_id: snapshot.versao_id,
      ancora,
      revisao_esperada: revisaoRef.current,
      capitulos_concluidos: [...capitulosRef.current],
      atualizado_em: relogio.current(),
    };
    // A cópia local é gravada sempre: reabrir sem servidor continua caindo no mesmo lugar.
    gravarCopiaLocal(documento_id, {
      progresso: { ...progresso, revisao: revisaoRef.current },
      carimbo: progresso.atualizado_em,
    });
    if (fontes === undefined) return;
    void fontes.gravar(documento_id, progresso).then((resposta) => {
      if (resposta.estado === 'obsoleto') {
        // Adota a revisão do servidor e não regrava por cima: quem salvou depois foi o outro aparelho.
        limparTempo();
        if (resposta.progresso !== null) adotar(resposta.progresso);
        definirAviso(AVISO_DE_CONFLITO);
        return;
      }
      if (resposta.estado === 'erro') return;
      // Resposta fora de ordem: uma revisão menor chegando depois não faz o progresso retroceder.
      if (resposta.progresso.revisao <= revisaoRef.current) return;
      adotar(resposta.progresso);
      definirAviso(null);
    }, () => { /* rede indisponível: a cópia local basta até a próxima tentativa. */ });
  }, [adotar, documento_id, fontes, leitor, limparTempo, snapshot.blocos, snapshot.versao_id]);

  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;

  const registrarLeitura = useCallback(() => {
    limparTempo();
    tempoRef.current = setTimeout(() => { salvarRef.current(); }, atrasoMs);
  }, [atrasoMs, limparTempo]);

  // Abertura: cópia local primeiro (imediata), servidor depois; o servidor vence se tiver revisão maior.
  useEffect(() => {
    let vivo = true;
    const copia = lerCopiaLocal(documento_id);
    if (copia !== null && copia.progresso.versao_id === snapshot.versao_id) {
      adotar(copia.progresso);
      if (!retomouRef.current) {
        retomouRef.current = true;
        rolarAte(copia.progresso.ancora);
      }
    }
    if (fontes === undefined) return;
    void fontes.ler(documento_id).then((doServidor) => {
      if (!vivo || doServidor === null) return;
      if (doServidor.versao_id !== snapshot.versao_id) return;
      if (copia !== null && doServidor.revisao <= copia.progresso.revisao) return;
      adotar(doServidor);
      if (!retomouRef.current) {
        retomouRef.current = true;
        rolarAte(doServidor.ancora);
      }
    }, () => { /* sem servidor: vale a cópia local. */ });
    return () => { vivo = false; };
  }, [adotar, documento_id, fontes, rolarAte, snapshot.versao_id]);

  // Rolagem: guarda a âncora visível a cada quadro e reinicia o atraso de 2 s.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let quadro = 0;
    const aoRolar = (): void => {
      if (quadro !== 0) return;
      quadro = window.requestAnimationFrame(() => {
        quadro = 0;
        const ponto = leitor.current?.ancoraVisivel() ?? null;
        const ancora = ponto === null ? null : ancoraDoPonto(snapshot.blocos, snapshot.versao_id, ponto);
        if (ancora !== null) ancoraRef.current = ancora;
      });
      registrarLeitura();
    };
    window.addEventListener('scroll', aoRolar, { passive: true });
    return () => {
      if (quadro !== 0) window.cancelAnimationFrame(quadro);
      window.removeEventListener('scroll', aoRolar);
    };
  }, [leitor, registrarLeitura, snapshot.blocos, snapshot.versao_id]);

  // Largura mudou: a âncora foi capturada antes (na rolagem); aqui ela é relocalizada.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const aoRedimensionar = (): void => {
      if (window.innerWidth === larguraRef.current) return;
      larguraRef.current = window.innerWidth;
      const ancora = ancoraRef.current;
      if (ancora !== null) rolarAte(ancora);
    };
    window.addEventListener('resize', aoRedimensionar);
    return () => { window.removeEventListener('resize', aoRedimensionar); };
  }, [rolarAte]);

  // Sair da página grava o que estiver pendente.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const aoSair = (): void => {
      if (tempoRef.current !== null) salvarRef.current();
    };
    window.addEventListener('pagehide', aoSair);
    return () => {
      window.removeEventListener('pagehide', aoSair);
      aoSair();
      limparTempo();
    };
  }, [limparTempo]);

  const marcarCapituloLido = useCallback((secaoId: Id) => {
    if (capitulosRef.current.includes(secaoId)) return;
    const novos = [...capitulosRef.current, secaoId];
    capitulosRef.current = novos;
    definirCapitulos(novos);
    salvarRef.current();
  }, []);

  const concluido = useCallback((secaoId: Id) => capitulos.includes(secaoId), [capitulos]);

  return useMemo(() => ({
    capitulos_concluidos: capitulos,
    revisao,
    aviso,
    concluido,
    marcarCapituloLido,
    registrarLeitura,
    salvarAgora: () => { salvarRef.current(); },
  }), [aviso, capitulos, concluido, marcarCapituloLido, registrarLeitura, revisao]);
}
