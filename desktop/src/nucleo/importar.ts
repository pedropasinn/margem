/**
 * Arquivo → Adicionar… do menu (V-D5): abre a tela Adicionar da biblioteca na aba do que se quer
 * trazer. É a mesma tela do web, com os aceites de cada aba (documento, vídeo, obra), em vez de um
 * diálogo do sistema que só aceitava documentos.
 */
export type AbaDeAdicionar = 'documento' | 'video' | 'quadro';

export const ITENS_DE_ADICIONAR: readonly { aba: AbaDeAdicionar; rotulo: string; atalho?: string }[] = [
  { aba: 'documento', rotulo: 'Adicionar documento…', atalho: 'CmdOrCtrl+O' },
  { aba: 'video', rotulo: 'Adicionar vídeo…' },
  { aba: 'quadro', rotulo: 'Adicionar obra…' },
];

/** O endereço da aba de Adicionar na biblioteca que roda em `base`. */
export function enderecoDeAdicionar(base: string, aba: AbaDeAdicionar): string {
  return `${base.replace(/\/+$/u, '')}/adicionar/${aba}`;
}

/** Configurações da biblioteca que roda em `base` (Margem → Ajustes… no macOS; Arquivo → Configurações… nos outros). */
export function enderecoDasConfiguracoes(base: string): string {
  return `${base.replace(/\/+$/u, '')}/configuracoes`;
}

/** Configurações → Sobre e atualizações, na biblioteca que roda em `base` (Menu → Procurar atualizações…; J146). */
export function enderecoDasAtualizacoes(base: string): string {
  return `${base.replace(/\/+$/u, '')}/configuracoes#atualizacoes`;
}
