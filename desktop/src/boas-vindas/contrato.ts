/** O que a janela de abertura (boas-vindas e "abrindo a biblioteca") pode pedir ao processo principal. */

export interface AvaliacaoDaPasta {
  caminho: string;
  existe: boolean;
  /** Já tem uma biblioteca do Margem (banco em `.margem/banco`). */
  temBiblioteca: boolean;
  /** Existe e tem outros arquivos (não é problema: os livros entram ao lado). */
  temOutrosArquivos: boolean;
}

export interface EstadoDoLoginNaJanela { encontrado: boolean; logado: boolean | null; conta: 'chatgpt' | 'chave_api' | null; falha?: { codigo: string; mensagem: string } }

export interface EventoDoLoginNaJanela { tipo: 'link' | 'codigo' | 'concluido' | 'falhou'; valor?: string; codigo?: string }

export type ResultadoDaConclusao = { ok: true } | { ok: false; mensagem: string };

export interface ApiDaAbertura {
  pastaPadrao: () => Promise<string>;
  escolherPasta: (atual: string) => Promise<string | null>;
  avaliarPasta: (caminho: string) => Promise<AvaliacaoDaPasta>;
  estadoDoLogin: () => Promise<EstadoDoLoginNaJanela>;
  entrar: (dispositivo: boolean) => Promise<boolean>;
  cancelarLogin: () => Promise<void>;
  abrirLink: (url: string) => Promise<void>;
  concluir: (pasta: string) => Promise<ResultadoDaConclusao>;
  aoLogin: (ouvir: (evento: EventoDoLoginNaJanela) => void) => void;
  aoProgresso: (ouvir: (etapa: string) => void) => void;
}

export const CANAIS = {
  pastaPadrao: 'abertura:pasta-padrao',
  escolherPasta: 'abertura:escolher-pasta',
  avaliarPasta: 'abertura:avaliar-pasta',
  estadoDoLogin: 'abertura:estado-do-login',
  entrar: 'abertura:entrar',
  cancelarLogin: 'abertura:cancelar-login',
  abrirLink: 'abertura:abrir-link',
  concluir: 'abertura:concluir',
  login: 'abertura:login',
  progresso: 'abertura:progresso',
} as const;
