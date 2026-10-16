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
  /**
   * Editar → Desfazer do menu (U-05): o web decide se desfaz a digitação do campo ou o último grifo do leitor.
   * Devolve a função que para de ouvir.
   */
  aoDesfazer: (ouvir: () => void) => () => void;
}

/**
 * Atualização do app (J146, J151): a seção "Sobre e atualizações" das Configurações e o aviso de versão nova.
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
  /**
   * "Atualizar agora" do aviso (J151): instala se já baixou; baixando, reinicia sozinho ao terminar; sem
   * download, começa; no macOS sem assinatura, abre o site.
   */
  atualizarAgora: () => void;
  /** "Depois": não reinicia sozinho; a versão é instalada quando a pessoa fechar o Margem. */
  adiar: () => void;
  /** Abre margem.dev/novidades no navegador. */
  abrirNovidades: () => void;
  /** Avisa a cada mudança de estado; devolve a função que para de avisar. */
  aoMudar: (ouvir: (situacao: SituacaoDaAtualizacao) => void) => () => void;
}

/**
 * Cópia de segurança (U-03, W-01): onde moram a biblioteca e o banco desta biblioteca, a última cópia, e o
 * "Fazer cópia de segurança…" (o mesmo do menu Arquivo).
 */
export interface LocaisDaBibliotecaNaJanela {
  biblioteca: string;
  banco: string;
  /** O banco fica fora da pasta da biblioteca (pasta sincronizada): copiar só a pasta não leva as notas. */
  bancoSeparado: boolean;
  sincronizada: string | null;
  /** A cópia automática de antes da última atualização do banco, se houver. */
  copiaAntesDeMigrar: string | null;
  ultimaCopia: { pasta: string; criada_em: string } | null;
}

export interface CopiaDeSegurancaDoDesktop {
  locais: () => Promise<LocaisDaBibliotecaNaJanela>;
  /** Escolher a pasta e copiar (a biblioteca fecha durante a cópia e abre de novo). */
  fazer: () => void;
  /** Mostra a pasta no gerenciador de arquivos. */
  mostrar: (qual: 'biblioteca' | 'banco' | 'ultima') => void;
}

/**
 * Conectar ao ChatGPT pelas Configurações e pelo aviso da biblioteca (U-01/W-05): o mesmo login da janela de
 * abertura, com o Codex embutido e o CODEX_HOME do app. Espelho em `web/src/primeira-execucao/ponte-do-chatgpt.ts`.
 */
export interface ChatGPTDoDesktop {
  /** `encontrado: false`: o Codex embutido não está no app (reinstalar). */
  estado: () => Promise<{ encontrado: boolean; logado: boolean | null; conta: 'chatgpt' | 'chave_api' | null; falha?: { codigo: string; mensagem: string } }>;
  /** `dispositivo`: com o código de uso único (sem servidor local). Resolve com o login concluído ou não. */
  entrar: (dispositivo: boolean) => Promise<boolean>;
  cancelar: () => Promise<void>;
  /** Abre o link de login no navegador do sistema (só https). */
  abrirLink: (url: string) => Promise<void>;
  /** O link, o código e o fim do login, enquanto ele corre; devolve a função que para de avisar. */
  aoEvento: (ouvir: (evento: { tipo: 'link' | 'codigo' | 'concluido' | 'falhou'; valor?: string }) => void) => () => void;
}

/** Um arquivo que o sistema mandou abrir ("Abrir com", U-08): o nome e os bytes, nunca o caminho. */
export interface ArquivoAberto { nome: string; tipo: string; dados: Uint8Array }

/** "Abrir com" o Margem (U-08): a página pega os arquivos e os leva à tela Adicionar, para confirmar. */
export interface ArquivosDoDesktop {
  /** Os arquivos que chegaram desde o último pedido (e os esquece). */
  pegar: () => Promise<ArquivoAberto[]>;
  /** Avisa quando chegam arquivos com a janela aberta; devolve a função que para de avisar. */
  aoChegar: (ouvir: () => void) => () => void;
}

export interface PonteDaBiblioteca {
  /** Escolhe a pasta do cofre e grava nela as notas (de um documento, ou da biblioteca inteira). */
  exportarParaObsidian: (documentoId?: string) => Promise<ResultadoDaExportacaoNaJanela>;
  /**
   * S-01: a chave local da instalação. A página a troca pelo cookie da sessão (`POST /api/sessao`) e a
   * mostra nas Configurações, para a extensão e o plugin do Obsidian.
   */
  chaveLocal: () => Promise<string>;
  janela: JanelaDoDesktop;
  atualizacao: AtualizacaoDoDesktop;
  copia: CopiaDeSegurancaDoDesktop;
  chatgpt: ChatGPTDoDesktop;
  arquivos: ArquivosDoDesktop;
}

export const CANAIS_DA_BIBLIOTECA = {
  exportarParaObsidian: 'biblioteca:exportar-obsidian',
  chaveLocal: 'biblioteca:chave-local',
  abrirMenu: 'janela:abrir-menu',
  definirMoldura: 'janela:definir-moldura',
  desfazer: 'janela:desfazer',
  situacaoDaAtualizacao: 'atualizacao:situacao',
  procurarAtualizacao: 'atualizacao:procurar',
  reiniciarParaAtualizar: 'atualizacao:reiniciar',
  abrirDownload: 'atualizacao:abrir-download',
  atualizarAgora: 'atualizacao:atualizar-agora',
  adiarAtualizacao: 'atualizacao:adiar',
  abrirNovidades: 'atualizacao:abrir-novidades',
  atualizacaoMudou: 'atualizacao:mudou',
  locaisDaBiblioteca: 'copia:locais',
  fazerCopia: 'copia:fazer',
  mostrarPasta: 'copia:mostrar',
  estadoDoChatGPT: 'chatgpt:estado',
  entrarNoChatGPT: 'chatgpt:entrar',
  cancelarChatGPT: 'chatgpt:cancelar',
  abrirLinkDoChatGPT: 'chatgpt:abrir-link',
  eventoDoChatGPT: 'chatgpt:evento',
  pegarArquivosAbertos: 'arquivos:pegar',
  arquivosChegaram: 'arquivos:chegaram',
} as const;
