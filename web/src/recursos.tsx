/**
 * Recursos pessoais ligados nesta instalação (J102), lidos de `GET /api/recursos`.
 *
 * Desligados, somem a navegação, as telas e as chamadas deles (Notícias, Quadros, Salas de teste, a tela
 * e o botão do e-ink). `horarium` não tem interface: só a rota de importação na API.
 * Enquanto a resposta não chega, nada pessoal aparece: numa instalação nova o Início nunca mostra,
 * nem por um instante, o que não vai funcionar. Uma API anterior ao J102 (404 na rota) tinha tudo
 * ligado, e assim continua. Sem provedor (páginas de desenvolvimento e testes), tudo ligado.
 *
 * `audio-colab` não esconde nada na interface: tocar áudio publicado vale sempre.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Recurso = 'noticias' | 'audio-colab' | 'arte' | 'sala' | 'horarium' | 'eink';
export const RECURSOS: readonly Recurso[] = ['noticias', 'audio-colab', 'arte', 'sala', 'horarium', 'eink'];
/** O padrão do serviço numa instalação nova (J102b): os Quadros fazem parte da V0. */
export const RECURSOS_PADRAO: readonly Recurso[] = ['arte'];

export interface EstadoDosRecursos {
  /** `false` até a API responder. */
  carregado: boolean;
  ativos: ReadonlySet<Recurso>;
}

const TODOS: EstadoDosRecursos = { carregado: true, ativos: new Set(RECURSOS) };
const CARREGANDO: EstadoDosRecursos = { carregado: false, ativos: new Set() };

const Contexto = createContext<EstadoDosRecursos>(TODOS);

export function usarRecursos(): EstadoDosRecursos {
  return useContext(Contexto);
}

export function usarRecurso(recurso: Recurso): boolean {
  return usarRecursos().ativos.has(recurso);
}

/** Lê a rota. 404 (API anterior ao J102): tudo ligado; outra falha: só o padrão (a arte). */
export async function carregarRecursos(buscar: typeof fetch = fetch): Promise<ReadonlySet<Recurso>> {
  try {
    const resposta = await buscar('/api/recursos');
    if (resposta.status === 404) return new Set(RECURSOS);
    if (!resposta.ok) return new Set(RECURSOS_PADRAO);
    const corpo = await resposta.json() as { recursos?: unknown };
    const lista = Array.isArray(corpo.recursos) ? corpo.recursos : [];
    return new Set(RECURSOS.filter((recurso) => lista.includes(recurso)));
  } catch {
    return new Set(RECURSOS_PADRAO);
  }
}

export function ProvedorDosRecursos({ children, carregar = carregarRecursos, inicial }: {
  children: ReactNode;
  carregar?: () => Promise<ReadonlySet<Recurso>>;
  /** Para testes: começa já carregado com estes recursos (e não busca). */
  inicial?: readonly Recurso[];
}): ReactNode {
  const [estado, definir] = useState<EstadoDosRecursos>(() => inicial ? { carregado: true, ativos: new Set(inicial) } : CARREGANDO);
  useEffect(() => {
    if (inicial) return;
    let vivo = true;
    void carregar().then((ativos) => { if (vivo) definir({ carregado: true, ativos }); });
    return () => { vivo = false; };
  }, [carregar, inicial]);
  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>;
}
