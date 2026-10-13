/**
 * Único lugar com nome, domínio, versão, endereços de download e textos de marca do site.
 * Trocar o nome do produto ou o domínio é editar este arquivo: as páginas, os títulos e metadados
 * dos HTML (via `vite.config.ts`), a documentação e a imagem Open Graph (`scripts/capturar.mjs`)
 * leem daqui.
 *
 * Nome e domínio são definitivos (Margem, margem.dev; decisão de 12/10/2026). O repositório
 * (github.com/pedropasinn/margem) e a imagem (ghcr.io/pedropasinn/margem) ainda não existem: enquanto
 * `publicado` for falso, o site mostra "Download em preparação". Ao publicar o primeiro release,
 * troque `publicado` para `true`. Pastas de instalação, serviços do `compose.yml` e porta seguem o
 * empacotamento (J100). Este arquivo é importado também pelo Node (vite.config e capturar.mjs): só dados,
 * sem sintaxe que exija compilação além de tipos.
 */
export const CONFIG = {
  /** Nome do produto. */
  nome: 'Margem',
  /** Frase curta da marca (rodapé, títulos, Open Graph). */
  slogan: 'Um leitor que marca o que o texto faz.',
  /** Descrição para buscadores e Open Graph. */
  descricao: 'Um leitor que marca a tese, o argumento, a objeção e a definição do seu texto, com notas na margem e perguntas presas ao trecho. Instalado no seu computador, com a sua conta do ChatGPT.',
  /** Endereço do site (canonical e Open Graph), sem barra no fim. `VITE_SITE_URL` no build tem precedência. */
  dominio: 'https://margem.dev',

  /** Nome da versão mostrada no site e em /novidades/. */
  versao: 'V0',
  dataDaVersao: '12/10/2026',

  /**
   * Já existe um release público (instaladores e imagem)? Falso até o primeiro release: o site avisa
   * que o download está em preparação. Os endereços abaixo já são os definitivos.
   */
  publicado: false as boolean,

  /** Licença do código (decidida em 12/10/2026). */
  licenca: 'AGPL-3.0',
  /** Repositório do código. */
  urlDoRepositorio: 'https://github.com/pedropasinn/margem',
  /** Página do último release (assets: instalar.sh, instalar.ps1 e compose.yml). */
  urlDoRelease: 'https://github.com/pedropasinn/margem/releases/latest',
  /** Página para relatar defeitos e sugerir melhorias. */
  urlDeProblemas: 'https://github.com/pedropasinn/margem/issues',
  /** Instaladores, baixados direto do release. */
  urlDoInstalador: 'https://github.com/pedropasinn/margem/releases/latest/download/instalar.sh',
  urlDoInstaladorWindows: 'https://github.com/pedropasinn/margem/releases/latest/download/instalar.ps1',
  /** Contato direto (dúvidas de privacidade, imprensa). */
  contato: '[A definir: e-mail de contato @margem.dev]',

  /**
   * Onde o instalador deixa o `compose.yml`, o `.env` e os backups (J100: `~/<PRODUTO_PROJETO>` de
   * `distribuicao/produto.env`). Os livros e o banco ficam em volumes do Docker, não nesta pasta.
   */
  pastaDeInstalacao: '~/margem',
  pastaDeInstalacaoWindows: '$HOME\\margem',
  /** Comando de gestão que o instalador cria (`<PRODUTO_PROJETO> iniciar | parar | backup …`, J100). */
  comando: 'margem',
  /** Endereço do app depois de instalado. */
  enderecoLocal: 'http://localhost:8730',
  /** Nomes dos serviços e do banco no `distribuicao/compose.yml` (J100). */
  servicoWorker: 'worker',
  servicoBanco: 'postgres',
  usuarioDoBanco: 'app',
  nomeDoBanco: 'app',
  /** Arquiteturas da imagem. Confirmar quando a imagem multiplataforma existir. */
  arquiteturas: 'x86_64 e arm64 (Apple Silicon)',
} as const;

/** Verdadeiro enquanto não há release publicado: o site avisa que o download não abriu. */
export const downloadEmPreparacao: boolean = !CONFIG.publicado;

/** Linux e macOS: baixar o script (para poder lê-lo antes) e rodar. */
export const COMANDO_DE_INSTALACAO = `curl -fsSL ${CONFIG.urlDoInstalador} -o instalar.sh\nbash instalar.sh`;

/** Windows (PowerShell): mesma ideia, com o instalar.ps1. */
export const COMANDO_DE_INSTALACAO_WINDOWS = `Invoke-WebRequest ${CONFIG.urlDoInstaladorWindows} -OutFile instalar.ps1\npowershell -ExecutionPolicy Bypass -File .\\instalar.ps1`;

/** Login do Codex dentro do container, pelo código de dispositivo. */
export const COMANDO_DE_LOGIN = `docker compose exec ${CONFIG.servicoWorker} codex login --device-auth`;
