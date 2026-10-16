/**
 * Configuração do app e pastas (no userData do Electron, nunca na biblioteca):
 *
 *   <userData>/config.json            pasta da biblioteca, portas da última vez, bandeja
 *   <userData>/bibliotecas.json       último caminho em que cada biblioteca (pelo id) foi vista (W-02)
 *   <userData>/copias-de-seguranca.json  a última "cópia de segurança" de cada biblioteca (U-03)
 *   <userData>/segredos/              senhas do banco, uma por biblioteca (0600; pasta 0700)
 *   <userData>/codex/                 CODEX_HOME: o login do ChatGPT desta pessoa
 *   <userData>/copias/<id>/           cópia do banco antes de migrar (no Windows, em %LOCALAPPDATA%\\Margem)
 *   <userData>/registros/             app.log, api.log, worker.log, postgres.log (com rotação; o resto do
 *                                     Postgres fica no próprio cluster, em `log/postgres-HH.log`)
 *
 * A biblioteca (escolhida pela pessoa, como o cofre do Obsidian) guarda os livros na própria pasta e o
 * banco em `<biblioteca>/.margem/banco`. As obras dos Quadros, que a pessoa importa (o acervo não é
 * distribuído), ficam no padrão do serviço, `<biblioteca>/quadros` (J118). Ela pode estar num Dropbox: por isso nenhum segredo vai lá.
 *
 * Biblioteca numa pasta sincronizada (OneDrive, Dropbox, Google Drive, iCloud; V-W8, auditoria B-10): o
 * sincronizador trava arquivos, cria "cópias em conflito" e envia o WAL pela metade, o que corrompe o
 * Postgres. Nesse caso o banco fica numa pasta local do app (`bancosLocais`, no Windows
 * `%LOCALAPPDATA%\Margem\bancos\<id da biblioteca>`), e os livros continuam na pasta da pessoa.
 *
 * O id da biblioteca fica na própria pasta, em `.margem/biblioteca.json` (W-02, D-03; `identidade.ts`):
 * renomear ou mover a pasta continua achando o mesmo banco local, a mesma senha e a mesma cópia.
 */
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { renomearComRetentativa } from './disco.js';
import { idLegadoDaBiblioteca, lerIdDaPasta } from './identidade.js';
import { gravarSecreto, novaSenha } from './postgres.js';

export interface ConfiguracaoDoApp {
  versao: 1;
  biblioteca: string | null;
  portaDaApi: number | null;
  portaDoBanco: number | null;
  bandeja: boolean;
  /** A última pasta escolhida em "Exportar para o Obsidian…" (o cofre). */
  cofreDoObsidian: string | null;
}

export const CONFIGURACAO_PADRAO: ConfiguracaoDoApp = {
  versao: 1, biblioteca: null, portaDaApi: null, portaDoBanco: null, bandeja: false, cofreDoObsidian: null,
};

export interface PastasDoApp {
  dadosDoApp: string;
  configuracao: string;
  segredos: string;
  codexHome: string;
  registros: string;
  temporaria: string;
  /** Bancos das bibliotecas que estão em pasta sincronizada, um por biblioteca. */
  bancosLocais: string;
  /** Cópia do banco de cada biblioteca antes de migrações (D-06), ao lado dos bancos locais. */
  copias: string;
  /** Último caminho de cada biblioteca, pelo id (mover × copiar, W-02). */
  bibliotecas: string;
  /** A última cópia de segurança feita pela pessoa, por biblioteca (U-03). */
  copiasDeSeguranca: string;
}

/**
 * Onde ficam os bancos locais. No Windows, `%LOCALAPPDATA%` (o userData do Electron é o `%APPDATA%`
 * itinerante, que num domínio também viaja entre computadores); nos outros, dentro do userData.
 */
export function pastaDosBancosLocais(dadosDoApp: string, ambiente: NodeJS.ProcessEnv = process.env, plataforma: NodeJS.Platform = process.platform): string {
  if (plataforma === 'win32') {
    const local = ambiente.LOCALAPPDATA?.trim();
    const base = local !== undefined && local !== '' ? local : ambiente.USERPROFILE ? win32.join(ambiente.USERPROFILE, 'AppData', 'Local') : null;
    if (base !== null) return win32.join(base, 'Margem', 'bancos');
  }
  return join(dadosDoApp, 'bancos');
}

export function pastasDoApp(dadosDoApp: string, ambiente: NodeJS.ProcessEnv = process.env, plataforma: NodeJS.Platform = process.platform): PastasDoApp {
  return {
    dadosDoApp,
    configuracao: join(dadosDoApp, 'config.json'),
    segredos: join(dadosDoApp, 'segredos'),
    codexHome: join(dadosDoApp, 'codex'),
    registros: join(dadosDoApp, 'registros'),
    temporaria: join(dadosDoApp, 'tmp'),
    bancosLocais: pastaDosBancosLocais(dadosDoApp, ambiente, plataforma),
    copias: plataforma === 'win32'
      ? win32.join(win32.dirname(pastaDosBancosLocais(dadosDoApp, ambiente, plataforma)), 'copias')
      : join(dirname(pastaDosBancosLocais(dadosDoApp, ambiente, plataforma)), 'copias'),
    bibliotecas: join(dadosDoApp, 'bibliotecas.json'),
    copiasDeSeguranca: join(dadosDoApp, 'copias-de-seguranca.json'),
  };
}

export type Sincronizador = 'OneDrive' | 'Dropbox' | 'Google Drive' | 'iCloud';

/** Nomes de pasta que denunciam um sincronizador (comparados sem caixa, segmento a segmento). */
const SEGMENTOS: readonly (readonly [RegExp, Sincronizador])[] = [
  [/^onedrive(?: - .+)?$/iu, 'OneDrive'],
  [/^onedrive-.+$/iu, 'OneDrive'], // macOS: ~/Library/CloudStorage/OneDrive-Pessoal
  [/^dropbox(?: \(.+\))?$/iu, 'Dropbox'],
  [/^dropbox-.+$/iu, 'Dropbox'],
  [/^(?:google drive|googledrive|meu drive|my drive|drive compartilhados|shared drives)$/iu, 'Google Drive'],
  [/^googledrive-.+$/iu, 'Google Drive'],
  [/^(?:icloud drive|iclouddrive|mobile documents)$/iu, 'iCloud'],
  [/^com~apple~clouddocs$/iu, 'iCloud'],
];

/**
 * A pasta está dentro de um sincronizador? Pelas variáveis do OneDrive no Windows (`OneDrive`,
 * `OneDriveConsumer`, `OneDriveCommercial`) e pelos nomes das pastas no caminho.
 */
export function pastaSincronizada(caminho: string, ambiente: NodeJS.ProcessEnv = process.env, plataforma: NodeJS.Platform = process.platform): Sincronizador | null {
  const caminhos = plataforma === 'win32' ? win32 : posix;
  const alvo = caminhos.resolve(caminho);
  const normalizar = (texto: string) => (plataforma === 'win32' || plataforma === 'darwin' ? texto.toLowerCase() : texto);
  for (const nome of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const raiz = ambiente[nome]?.trim();
    if (raiz === undefined || raiz === '') continue;
    const base = normalizar(caminhos.resolve(raiz));
    const dentro = normalizar(alvo);
    if (dentro === base || dentro.startsWith(base.endsWith(caminhos.sep) ? base : `${base}${caminhos.sep}`)) return 'OneDrive';
  }
  for (const segmento of alvo.split(/[\\/]/u)) {
    for (const [padrao, sincronizador] of SEGMENTOS) if (padrao.test(segmento)) return sincronizador;
  }
  return null;
}

/**
 * Identificador estável da biblioteca: o do marcador na pasta (`.margem/biblioteca.json`); sem ele (a
 * abertura ainda não gravou), o hash do caminho, que é o que o app usava antes do marcador.
 */
export function idDaBiblioteca(biblioteca: string): string {
  return lerIdDaPasta(biblioteca) ?? idLegadoDaBiblioteca(biblioteca);
}

const ehCluster = (pasta: string): boolean => existsSync(join(pasta, 'PG_VERSION'));

export interface PastasDaBiblioteca {
  biblioteca: string;
  /** O id da biblioteca (marcador da pasta ou, sem ele, o hash do caminho). */
  id: string;
  interna: string;
  /** Onde o cluster do Postgres mora. */
  banco: string;
  /** O lugar antigo e padrão, `<biblioteca>/.margem/banco` (é de onde a migração parte). */
  bancoNaBiblioteca: string;
  /** Sincronizador que contém a biblioteca; com ele, o banco vai para `bancosLocais`. */
  sincronizada: Sincronizador | null;
}

export function pastasDaBiblioteca(
  biblioteca: string,
  opcoes: { bancosLocais?: string; ambiente?: NodeJS.ProcessEnv; plataforma?: NodeJS.Platform; id?: string } = {},
): PastasDaBiblioteca {
  const raiz = resolve(biblioteca);
  const id = opcoes.id ?? idDaBiblioteca(raiz);
  const interna = join(raiz, '.margem');
  const bancoNaBiblioteca = join(interna, 'banco');
  const sincronizada = pastaSincronizada(raiz, opcoes.ambiente, opcoes.plataforma);
  const local = opcoes.bancosLocais === undefined ? null : join(opcoes.bancosLocais, id);
  // Fora de pasta sincronizada vale o banco da pasta; sem ele, o banco local que a biblioteca já tem
  // (ela saiu de um OneDrive, D-03): o banco não fica para trás.
  const banco = local !== null && (sincronizada !== null || (!ehCluster(bancoNaBiblioteca) && ehCluster(local))) ? local : bancoNaBiblioteca;
  return { biblioteca: raiz, id, interna, banco, bancoNaBiblioteca, sincronizada };
}

function inteiroOuNulo(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0 && valor <= 65_535 ? valor : null;
}

/** Lê o `config.json`; arquivo ausente ou estragado vira o padrão (a primeira execução volta). */
export async function lerConfiguracao(caminho: string): Promise<ConfiguracaoDoApp> {
  let bruto: unknown;
  try { bruto = JSON.parse(await readFile(caminho, 'utf8')); } catch { return { ...CONFIGURACAO_PADRAO }; }
  if (typeof bruto !== 'object' || bruto === null) return { ...CONFIGURACAO_PADRAO };
  const dados = bruto as Record<string, unknown>;
  return {
    versao: 1,
    biblioteca: typeof dados.biblioteca === 'string' && dados.biblioteca.trim() !== '' ? dados.biblioteca : null,
    portaDaApi: inteiroOuNulo(dados.portaDaApi),
    portaDoBanco: inteiroOuNulo(dados.portaDoBanco),
    bandeja: dados.bandeja === true,
    cofreDoObsidian: typeof dados.cofreDoObsidian === 'string' && dados.cofreDoObsidian.trim() !== '' ? dados.cofreDoObsidian : null,
  };
}

/** Grava por cima de forma atômica (arquivo temporário + rename). */
export async function gravarConfiguracao(caminho: string, configuracao: ConfiguracaoDoApp): Promise<void> {
  const temporario = `${caminho}.${String(process.pid)}.tmp`;
  await writeFile(temporario, `${JSON.stringify(configuracao, null, 2)}\n`, { mode: 0o600 });
  await renomearComRetentativa(temporario, caminho);
}

export async function prepararPastasDoApp(pastas: PastasDoApp): Promise<void> {
  await mkdir(pastas.dadosDoApp, { recursive: true });
  for (const pasta of [pastas.segredos, pastas.codexHome, pastas.temporaria]) {
    await mkdir(pasta, { recursive: true, mode: 0o700 });
    // `mkdir` não muda o modo de pasta que já existia.
    try { await chmod(pasta, 0o700); } catch { /* Windows: sem modo POSIX */ }
  }
  await mkdir(pastas.registros, { recursive: true });
}

/**
 * Segredos do serviço de UMA biblioteca (a chave da ElevenLabs; S-02, R-04): cada biblioteca tem a sua
 * pasta, para a chave de uma nunca tomar o lugar da de outra.
 */
export function segredosDaBiblioteca(segredos: string, id: string): string {
  return join(segredos, 'bibliotecas', id);
}

/** Nome do arquivo da senha: o id da biblioteca (o caminho não vaza no nome). */
export function arquivoDaSenha(segredos: string, biblioteca: string, id: string = idDaBiblioteca(biblioteca)): string {
  return join(segredos, `banco-${id}.senha`);
}

/** Senha do banco desta biblioteca; `nova` quando acabou de ser criada (o cluster pode ter outra). */
export async function senhaDaBiblioteca(segredos: string, biblioteca: string, id?: string): Promise<{ senha: string; nova: boolean }> {
  const arquivo = arquivoDaSenha(segredos, biblioteca, id);
  try {
    const senha = (await readFile(arquivo, 'utf8')).trim();
    if (senha.length >= 16) return { senha, nova: false };
  } catch {
    // Primeira vez com esta biblioteca neste computador.
  }
  const senha = novaSenha();
  await gravarSecreto(arquivo, `${senha}\n`);
  return { senha, nova: true };
}
