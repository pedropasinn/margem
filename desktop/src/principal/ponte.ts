/**
 * O que a janela da biblioteca (o web do Margem, carregado do serviço local) pode pedir ao processo
 * principal. Só isto: nada de Node no renderer. O web descobre o app de computador por
 * `window.margemDesktop` (ausente no navegador).
 */
import type { SituacaoDaAtualizacao } from '../nucleo/atualizacao.js';
export interface ResultadoDaExportacaoNaJanela {
  /** `cancelada`: a pessoa fechou o diálogo de pasta sem escolher. */
  estado: 'ok' | 'cancelada' | 'falhou';
  /** Uma frase para quem lê. */
  mensagem: string;
  pasta?: string;
}

/**
 * A moldura da janela (V-U5): o web desenha a faixa de arraste no topo, reserva o canto dos botões nativos
 * e, fora do macOS, o botão de menu; e manda as cores do tema para os botões nativos acompanharem.
 */
export interface JanelaDoDesktop {
  /** `process.platform` do app: no macOS os semáforos ficam à esquerda e o menu na barra do sistema. */
  sistema: string;
  /** Altura da área de título em px (a mesma dos botões nativos). */
  alturaDoTitulo: number;
  /** Abre o menu do app (Arquivo, Editar, Exibir, Ajuda) como pop-up no canto superior esquerdo. */
  abrirMenu: () => void;
  /**
   * Os botões nativos acompanham a tela: cores `#rrggbb` (o fundo sob eles e o dos símbolos), a altura da
   * área de título (a da barra do topo da tela; a do leitor é mais alta que a padrão) e onde o menu abre
   * (logo abaixo do botão de menu).
   */
  definirMoldura: (moldura: { fundo: string; simbolo: string; altura: number; menu: { x: number; y: number } }) => void;
}

/**
 * Atualização do app (J146): a seção "Sobre e atualizações" das Configurações e o aviso de versão pronta.
 * O estado é o de `nucleo/atualizacao.ts` (`SituacaoDaAtualizacao`).
 */
export interface AtualizacaoDoDesktop {
  /** Versão instalada e estado atual. */
  situacao: () => Promise<SituacaoDaAtualizacao>;
  /** Procura agora (o resultado chega por `aoMudar`). */
  procurar: () => Promise<SituacaoDaAtualizacao>;
  /** Fecha o Margem e instala a versão baixada (o serviço é desligado antes). */
  reiniciar: () => void;
  /** Abre a página de download no navegador (sistemas que não se atualizam sozinhos). */
  abrirDownload: () => void;
  /** Avisa a cada mudança de estado; devolve a função que para de avisar. */
  aoMudar: (ouvir: (situacao: SituacaoDaAtualizacao) => void) => () => void;
}

export interface PonteDaBiblioteca {
  /** Escolhe a pasta do cofre e grava nela as notas (de um documento, ou da biblioteca inteira). */
  exportarParaObsidian: (documentoId?: string) => Promise<ResultadoDaExportacaoNaJanela>;
  janela: JanelaDoDesktop;
  atualizacao: AtualizacaoDoDesktop;
}

export const CANAIS_DA_BIBLIOTECA = {
  exportarParaObsidian: 'biblioteca:exportar-obsidian',
  abrirMenu: 'janela:abrir-menu',
  definirMoldura: 'janela:definir-moldura',
  situacaoDaAtualizacao: 'atualizacao:situacao',
  procurarAtualizacao: 'atualizacao:procurar',
  reiniciarParaAtualizar: 'atualizacao:reiniciar',
  abrirDownload: 'atualizacao:abrir-download',
  atualizacaoMudou: 'atualizacao:mudou',
} as const;
