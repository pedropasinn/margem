/**
 * Único lugar com nome, domínio, versão, endereços de download e textos de marca do site.
 * Trocar o nome do produto ou o domínio é editar este arquivo: as páginas, os títulos e metadados
 * dos HTML (via `vite.config.ts`), a documentação e a imagem Open Graph (`scripts/capturar.mjs`)
 * leem daqui.
 *
 * Nome e domínio são definitivos (Margem, margem.dev; decisão de 12/10/2026). O app é distribuído
 * como app de desktop (decisão de 13/10/2026, J113–J116): um instalador por sistema, publicado no
 * GitHub Releases com nomes fixos. Enquanto `publicado` for falso, o site mostra "Download em
 * preparação" e os botões não apontam para os arquivos. Ao publicar o primeiro release, troque
 * `publicado` para `true` e confira os tamanhos. Este arquivo é importado também pelo Node
 * (vite.config e capturar.mjs): só dados, sem sintaxe que exija compilação além de tipos.
 */
export const CONFIG = {
  /** Nome do produto. */
  nome: 'Margem',
  /** Frase curta da marca (rodapé, títulos, Open Graph). */
  slogan: 'Seu assistente de estudos para uma formação integral.',
  /** Descrição para buscadores e Open Graph. */
  descricao: 'Um assistente de estudos para ir mais fundo em livros, artigos, poemas, vídeos e obras de arte: grifos por função, relações entre os trechos, notas na margem e exercícios resolvidos passo a passo. Um app para o seu computador, com a sua conta do ChatGPT.',
  /** Endereço do site (canonical e Open Graph), sem barra no fim. `VITE_SITE_URL` no build tem precedência. */
  dominio: 'https://margem.dev',

  /** Nome da versão mostrada no site e em /novidades/. */
  versao: 'v0.1.2',
  dataDaVersao: '15/10/2026',

  /**
   * Já existe um release público com os instaladores? Ficou verdadeiro com a v0.1.1 (14/10/2026); falso, o site avisa
   * que o download está em preparação. Os endereços abaixo já são os definitivos.
   */
  publicado: true as boolean,

  /** Licença do código (decidida em 12/10/2026). */
  licenca: 'AGPL-3.0',
  /** Repositório do código. */
  urlDoRepositorio: 'https://github.com/pedropasinn/margem',
  /** Página do último release (instaladores, extensão do navegador e plugin do Obsidian). */
  urlDoRelease: 'https://github.com/pedropasinn/margem/releases/latest',
  /** Página para relatar defeitos e sugerir melhorias. */
  urlDeProblemas: 'https://github.com/pedropasinn/margem/issues',
  /** Contato direto (dúvidas de privacidade, imprensa). */
  contato: '[A definir: e-mail de contato @margem.dev]',

  /**
   * Endereço local em que o app atende enquanto está aberto. A extensão do navegador e o plugin
   * do Obsidian falam com ele.
   */
  enderecoLocal: 'http://localhost:8730',
  porta: 8730,

  /**
   * Onde o app guarda as próprias configurações (não a biblioteca, que fica na pasta que a pessoa
   * escolhe). Padrão do Electron (`app.getPath('userData')`); conferir com o J113.
   */
  pastaDeConfiguracoes: {
    windows: '%APPDATA%\\Margem',
    macos: '~/Library/Application Support/Margem',
    linux: '~/.config/Margem',
  },
  /** Nome do pacote .deb, para remover pelo apt. Conferir com o J113. */
  pacoteDeb: 'margem',
} as const;

/** Verdadeiro enquanto não há release publicado: o site avisa que o download não abriu. */
export const downloadEmPreparacao: boolean = !CONFIG.publicado;

export type Sistema = 'windows' | 'macos' | 'linux';
export type Arquitetura = 'arm64' | 'x64';

export const SISTEMAS: Record<Sistema, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

/**
 * Sistemas ainda sem instalador no release (14/10/2026: a primeira versão é só para Windows e Linux).
 * O site mostra "Em breve" no lugar dos botões; para liberar, tire o sistema daqui.
 */
export const SISTEMAS_EM_BREVE: readonly Sistema[] = ['macos'];
export const emBreve = (sistema: Sistema): boolean => SISTEMAS_EM_BREVE.includes(sistema);

/** Requisitos mínimos de cada sistema. */
export const REQUISITOS: Record<Sistema, string> = {
  windows: 'Windows 10 ou 11, 64 bits.',
  macos: 'Em breve. A primeira versão é para Windows e Linux.',
  linux: 'Distribuição de 64 bits (x86_64). O .deb serve para Debian, Ubuntu e derivados.',
};

export interface Instalador {
  /** Identificador estável (âncoras e testes). */
  id: string;
  sistema: Sistema;
  /** Só no macOS: para qual processador é o .dmg. */
  arquitetura?: Arquitetura;
  /** Nome do botão. */
  rotulo: string;
  /** Formato mostrado ao lado do nome. */
  formato: string;
  /** Nome FIXO do arquivo no release (J116 publica com estes nomes). */
  arquivo: string;
  /** Tamanho aproximado do download. Conferir a cada release. */
  tamanho: string;
  /** Uma linha de ajuda, opcional. */
  detalhe?: string;
}

/** Os instaladores, na ordem em que aparecem. O primeiro de cada sistema é o principal. Os do macOS ficam aqui para quando a versão sair (veja `SISTEMAS_EM_BREVE`). */
export const INSTALADORES: readonly Instalador[] = [
  { id: 'windows', sistema: 'windows', rotulo: 'Instalador para Windows', formato: '.exe', arquivo: 'Margem-Setup.exe', tamanho: 'cerca de 330 MB' },
  { id: 'mac-arm64', sistema: 'macos', arquitetura: 'arm64', rotulo: 'Apple Silicon', formato: '.dmg', arquivo: 'Margem-mac-arm64.dmg', tamanho: 'cerca de 250 MB', detalhe: 'Macs com chip M1 ou mais novo.' },
  { id: 'mac-x64', sistema: 'macos', arquitetura: 'x64', rotulo: 'Intel', formato: '.dmg', arquivo: 'Margem-mac-x64.dmg', tamanho: 'cerca de 260 MB', detalhe: 'Macs com processador Intel.' },
  { id: 'linux-appimage', sistema: 'linux', rotulo: 'AppImage', formato: '.AppImage', arquivo: 'Margem-linux-x86_64.AppImage', tamanho: 'cerca de 500 MB', detalhe: 'Roda em qualquer distribuição e se atualiza sozinho.' },
  { id: 'linux-deb', sistema: 'linux', rotulo: 'Pacote Debian', formato: '.deb', arquivo: 'margem_amd64.deb', tamanho: 'cerca de 400 MB', detalhe: 'Debian, Ubuntu, Mint e derivados.' },
];

/** Endereço de download direto de um arquivo do último release. */
export const urlDoArquivo = (arquivo: string): string => `${CONFIG.urlDoRelease}/download/${arquivo}`;

/** Instaladores de um sistema, na ordem de preferência. */
export const instaladoresDe = (sistema: Sistema): Instalador[] => INSTALADORES.filter((i) => i.sistema === sistema);
