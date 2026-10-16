/**
 * O login do ChatGPT pelo app de computador (U-01/W-05), visto da página. Só existe no app: no navegador
 * `ponteDoChatGPT()` é null e a interface mostra as instruções da instalação (Docker ou terminal).
 *
 * Espelho de `desktop/src/principal/ponte.ts` (`ChatGPTDoDesktop`). O app usa o Codex que vem com ele e a
 * pasta de credenciais dele: o `codex login` do terminal autenticaria outra instalação.
 */
export interface EstadoDoLoginNoApp {
  encontrado: boolean; logado: boolean | null; conta: 'chatgpt' | 'chave_api' | null;
  /** A CLI não rodou (antivírus, política da empresa): a frase do app para a pessoa. */
  falha?: { codigo: string; mensagem: string };
}
export interface EventoDoLoginNoApp { tipo: 'link' | 'codigo' | 'concluido' | 'falhou'; valor?: string }

export interface PonteDoChatGPT {
  estado: () => Promise<EstadoDoLoginNoApp>;
  entrar: (dispositivo: boolean) => Promise<boolean>;
  cancelar: () => Promise<void>;
  abrirLink: (url: string) => Promise<void>;
  aoEvento: (ouvir: (evento: EventoDoLoginNoApp) => void) => () => void;
}

export function ponteDoChatGPT(): PonteDoChatGPT | null {
  if (typeof window === 'undefined') return null;
  const ponte = (window as { margemDesktop?: { chatgpt?: Partial<PonteDoChatGPT> } }).margemDesktop?.chatgpt;
  return typeof ponte?.estado === 'function' && typeof ponte.entrar === 'function' && typeof ponte.cancelar === 'function'
    && typeof ponte.abrirLink === 'function' && typeof ponte.aoEvento === 'function' ? ponte as PonteDoChatGPT : null;
}

const CHAVE = 'margem:chatgpt-ja-conectado';

/** Lembra, neste aparelho, que a conta já esteve conectada: a sessão que cai pede "Conectar novamente". */
export function lembrarConexao(): void {
  try { window.localStorage.setItem(CHAVE, '1'); } catch { /* sem armazenamento local: fica "Conectar" */ }
}

export function jaConectou(): boolean {
  try { return window.localStorage.getItem(CHAVE) === '1'; } catch { return false; }
}
