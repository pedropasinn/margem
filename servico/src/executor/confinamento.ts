/**
 * Confinamento do `codex exec` ao diretório da execução.
 *
 * O `--sandbox read-only` do Codex bloqueia escrita e rede dos comandos do modelo, mas
 * deixa ler o disco inteiro: um PDF com injeção de prompt poderia fazer o modelo citar
 * `~/.config/margem/postgres.env` ou o livro de outro documento. Por isso o processo do
 * Codex roda dentro de um `bwrap` externo cuja raiz é vazia e só recebe, por montagem:
 * `/usr` (só leitura), o mínimo de `/etc` para DNS e TLS, a pasta da versão do Codex,
 * o diretório da execução e uma casa temporária com o `auth.json` da conta. Nada do home.
 * O sandbox interno do Codex (também bwrap) convive com o externo; foi provado com a CLI real
 * (docs/jobs/CONFINAMENTO-RESULTADO.md).
 *
 * A casa temporária é também `HOME` e `CODEX_HOME` do processo: sessões, logs e imagens
 * geradas ficam nela e somem com ela, em vez de acumular o livro em `~/.codex/sessions`.
 */
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { renomearComRetentativa } from '../plataforma/disco.js';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { modoInstalado } from '../instalacao.js';
import { CODEX_DA_IMAGEM, codexCli, codexMotor } from '../plataforma/executaveis.js';
import type { Plataforma } from '../plataforma/processos.js';
import { ambienteSaneado } from './ambiente.js';

/**
 * Binário real do Codex quando `MARGEM_CODEX_MOTOR` não está definida: o caminho da imagem Docker
 * (`Dockerfile`). Fora dela, defina `MARGEM_CODEX_MOTOR` com o binário nativo do Codex.
 */
export const MOTOR_PADRAO = CODEX_DA_IMAGEM;

/**
 * Como o processo do Codex é confinado (J114):
 * - `bwrap` (padrão no Linux): o `bwrap` externo descrito acima; o modelo só enxerga o diretório.
 * - `nativo` (padrão no macOS e no Windows, onde não há bwrap): o Codex roda direto, com o ambiente
 *   limpo, o diretório da execução como cwd, a casa temporária como HOME/CODEX_HOME e o sandbox do
 *   próprio Codex na política mais fechada que a plataforma oferece (`politicaNativa`). É um
 *   isolamento mais fraco: ver docs/jobs/J114-RESULTADO.md, matriz de isolamento.
 */
export type TipoDeConfinamento = 'bwrap' | 'nativo';

/**
 * Política do sandbox do Codex no modo nativo:
 * - `perfil`: perfil de permissões (`default_permissions`) com leitura negada na raiz e liberada só no
 *   mínimo do sistema, no diretório da execução e nos anexos; rede desligada. É o padrão no macOS
 *   (Seatbelt) e no Linux nativo.
 * - `somente-leitura`: o `--sandbox read-only` clássico (escrita e rede bloqueadas, leitura livre).
 *   É o padrão no Windows, cujo sandbox sem administrador (`unelevated`) não nega leitura.
 */
export type PoliticaNativa = 'perfil' | 'somente-leitura';

/** Sandbox do Windows no modo nativo (`[windows] sandbox` do Codex). */
export type SandboxDoWindows = 'unelevated' | 'elevated' | 'mxc';

export interface Confinamento {
  /** Padrão `bwrap` (compatível com quem monta o objeto à mão, como os testes antigos). */
  tipo?: TipoDeConfinamento;
  /** Caminho do `bwrap` (só no tipo `bwrap`). */
  bwrap: string;
  /** Binário real do Codex; roda dentro do confinamento. */
  motor: string;
  plataforma?: Plataforma;
  politica?: PoliticaNativa;
  sandboxDoWindows?: SandboxDoWindows;
  /**
   * Traz a credencial da conta para a casa temporária (antes) e a devolve se o Codex a
   * renovou (depois). O padrão chama `codex login status` com `CODEX_HOME` na casa: o
   * embrulho do PATH sincroniza o login comum nos dois sentidos.
   */
  sincronizar?: (casaCodex: string) => Promise<void>;
}

/** Arquivos de `/etc` montados: DNS, nomes e certificados. Nada mais. */
const ETC_MINIMO = [
  '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group',
  '/etc/localtime', '/etc/ssl', '/etc/ca-certificates', '/etc/pki',
] as const;

/**
 * Argumentos do `bwrap` (sem o próprio `bwrap`), terminando no binário do motor.
 * Raiz vazia; só o que está aqui existe lá dentro. `--unshare-pid` esconde os outros
 * processos (e o `/proc/<pid>/environ` do worker, que tem a URL do banco). A rede fica:
 * o motor precisa da API; os comandos do modelo já ficam sem rede pelo sandbox interno.
 */
export function montarConfinamento(entrada: {
  motor: string; pastaDoMotor: string; diretorio: string; casa: string;
  /** Pastas só de leitura montadas dentro do diretório da execução (o export da biblioteca). */
  somenteLeitura?: { origem: string; destino: string }[];
}): string[] {
  const { motor, pastaDoMotor, diretorio, casa, somenteLeitura = [] } = entrada;
  const lista = [
    '--die-with-parent', '--new-session',
    '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try',
    '--ro-bind', '/usr', '/usr',
    '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64', '--symlink', 'usr/sbin', '/sbin',
    '--dir', '/etc',
  ];
  for (const caminho of ETC_MINIMO) lista.push('--ro-bind-try', caminho, caminho);
  lista.push(
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--ro-bind', pastaDoMotor, pastaDoMotor,
    '--bind', casa, casa,
    '--bind', diretorio, diretorio,
  );
  for (const anexo of somenteLeitura) lista.push('--ro-bind', anexo.origem, anexo.destino);
  lista.push(
    '--chdir', diretorio,
    motor,
  );
  return lista;
}

/** Ambiente do motor confinado: a casa temporária é HOME e CODEX_HOME. */
export function ambienteConfinado(casa: string, origem: Record<string, string>): Record<string, string> {
  const ambiente: Record<string, string> = { PATH: '/usr/bin:/bin', HOME: casa, CODEX_HOME: join(casa, '.codex') };
  if (origem.LANG !== undefined) ambiente.LANG = origem.LANG;
  if (origem.TERM !== undefined) ambiente.TERM = origem.TERM;
  return ambiente;
}

/** Pasta da versão do motor: `.../releases/<versão>/` para `.../releases/<versão>/bin/codex`. */
export async function pastaDoMotor(motor: string): Promise<{ real: string; pasta: string }> {
  const real = await realpath(motor);
  return { real, pasta: dirname(dirname(real)) };
}

export function tipoDoConfinamento(confinamento: Confinamento): TipoDeConfinamento {
  return confinamento.tipo ?? 'bwrap';
}

/** O `bwrap` (se for o caso) e o motor existem e são executáveis? Sem eles a leitura não roda (falha fechada). */
export async function confinamentoDisponivel(confinamento: Confinamento): Promise<string | null> {
  const plataforma = confinamento.plataforma ?? process.platform;
  const exigidos: [string, string][] = tipoDoConfinamento(confinamento) === 'bwrap'
    ? [['bwrap', confinamento.bwrap], ['motor do Codex', confinamento.motor]]
    : [['motor do Codex', confinamento.motor]];
  for (const [nome, caminho] of exigidos) {
    try {
      if (plataforma === 'win32') { if (!(await stat(caminho)).isFile()) throw new Error('não é arquivo'); }
      else await access(caminho, constants.X_OK);
    } catch {
      const dica = nome === 'bwrap' ? ' Instale o bubblewrap (ou defina MARGEM_BWRAP).' : ' Defina MARGEM_CODEX_MOTOR com o binário do Codex.';
      return `${nome} ausente em ${caminho}; a leitura não roda sem confinamento.${dica}`;
    }
  }
  return null;
}

function lerTipo(ambiente: NodeJS.ProcessEnv, plataforma: Plataforma): TipoDeConfinamento {
  const bruto = ambiente.MARGEM_CONFINAMENTO?.trim() ?? '';
  if (bruto === 'bwrap' || bruto === 'nativo') return bruto;
  if (bruto !== '') throw new Error(`MARGEM_CONFINAMENTO aceita "bwrap" ou "nativo", não "${bruto}".`);
  return plataforma === 'linux' ? 'bwrap' : 'nativo';
}

function lerPolitica(ambiente: NodeJS.ProcessEnv, plataforma: Plataforma): PoliticaNativa {
  const bruto = ambiente.MARGEM_CODEX_SANDBOX?.trim() ?? '';
  if (bruto === 'perfil' || bruto === 'somente-leitura') return bruto;
  if (bruto !== '') throw new Error(`MARGEM_CODEX_SANDBOX aceita "perfil" ou "somente-leitura", não "${bruto}".`);
  return plataforma === 'win32' ? 'somente-leitura' : 'perfil';
}

function lerSandboxDoWindows(ambiente: NodeJS.ProcessEnv): SandboxDoWindows {
  const bruto = ambiente.MARGEM_WINDOWS_SANDBOX?.trim() ?? '';
  if (bruto === 'unelevated' || bruto === 'elevated' || bruto === 'mxc') return bruto;
  if (bruto !== '') throw new Error(`MARGEM_WINDOWS_SANDBOX aceita "unelevated", "elevated" ou "mxc", não "${bruto}".`);
  return 'unelevated';
}

/**
 * Confinamento da máquina: `MARGEM_CODEX_MOTOR` troca o binário real do Codex. No modo instalado
 * (J100) não há embrulho de credenciais: a CLI é a oficial, instalada na imagem, e o login mora em
 * `CODEX_HOME` (um volume); a sincronização é por cópia do `auth.json`.
 */
export function confinamentoPadrao(ambiente: NodeJS.ProcessEnv = process.env, binario?: string, plataforma: Plataforma = process.platform): Confinamento {
  const cli = binario ?? codexCli({ ambiente, plataforma });
  const bwrap = ambiente.MARGEM_BWRAP?.trim();
  return {
    tipo: lerTipo(ambiente, plataforma),
    bwrap: bwrap === undefined || bwrap === '' ? '/usr/bin/bwrap' : bwrap,
    motor: codexMotor({ ambiente, plataforma }),
    plataforma,
    politica: lerPolitica(ambiente, plataforma),
    sandboxDoWindows: lerSandboxDoWindows(ambiente),
    sincronizar: modoInstalado(ambiente)
      ? (casaCodex) => sincronizarPorCopia(casaCodex, pastaCodexDoUsuario(ambiente))
      : (casaCodex) => sincronizarPeloEmbrulho(cli, casaCodex, ambiente),
  };
}

function pastaCodexDoUsuario(ambiente: NodeJS.ProcessEnv): string {
  return ambiente.CODEX_HOME !== undefined && ambiente.CODEX_HOME !== ''
    ? ambiente.CODEX_HOME : join(ambiente.HOME ?? homedir(), '.codex');
}

/**
 * Sincronização sem embrulho. Antes da execução a casa ainda não tem `auth.json`: copia o do
 * usuário. Depois, se o Codex renovou o token (o da casa difere do do usuário), devolve o novo ao
 * `CODEX_HOME` do usuário por troca atômica, para a próxima execução não usar um token já girado.
 */
export async function sincronizarPorCopia(casaCodex: string, codexDoUsuario: string): Promise<void> {
  const daCasa = await lerCredencial(casaCodex);
  const doUsuario = await lerCredencial(codexDoUsuario);
  if (daCasa === null) {
    if (doUsuario !== null) await writeFile(join(casaCodex, 'auth.json'), doUsuario, { mode: 0o600 });
    return;
  }
  if (daCasa === doUsuario) return;
  const temporario = join(codexDoUsuario, `.auth.json.${String(process.pid)}.${String(Date.now())}`);
  await writeFile(temporario, daCasa, { mode: 0o600 });
  await renomearComRetentativa(temporario, join(codexDoUsuario, 'auth.json'));
}

/** `codex login status` com `CODEX_HOME` na casa temporária; o embrulho do PATH sincroniza o login. */
function sincronizarPeloEmbrulho(binario: string, casaCodex: string, ambiente: NodeJS.ProcessEnv): Promise<void> {
  const env: Record<string, string> = { ...ambienteSaneado(ambiente), CODEX_HOME: casaCodex };
  delete env.TERM;
  return new Promise((resolver) => {
    execFile(binario, ['login', 'status'], { env, timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true }, () => { resolver(); });
  });
}

/**
 * Casa temporária do motor: `<casa>/.codex` com a credencial da conta e, se houver, só a
 * linha `model = ...` do `config.toml` do usuário (o "modelo da conta" do J19). Nada de
 * sessões, histórico, hooks, MCPs ou projetos.
 */
export async function prepararCasa(casa: string, confinamento: Confinamento, ambiente: NodeJS.ProcessEnv = process.env): Promise<string> {
  const casaCodex = join(casa, '.codex');
  await mkdir(casaCodex, { recursive: true, mode: 0o700 });
  const origem = ambiente.CODEX_HOME !== undefined && ambiente.CODEX_HOME !== ''
    ? ambiente.CODEX_HOME : join(ambiente.HOME ?? homedir(), '.codex');
  const linhaDoModelo = await modeloDoUsuario(join(origem, 'config.toml'));
  if (linhaDoModelo !== null) await writeFile(join(casaCodex, 'config.toml'), `${linhaDoModelo}\n`, { mode: 0o600 });
  await confinamento.sincronizar?.(casaCodex);
  // Sem o embrulho (CLI instalada direto), a credencial vem do CODEX_HOME do usuário.
  const auth = join(casaCodex, 'auth.json');
  try {
    await access(auth);
  } catch {
    try { await copyFile(join(origem, 'auth.json'), auth); } catch { /* sem login: a CLI dirá `auth`. */ }
  }
  return casaCodex;
}

/** Só a linha `model = "..."` de nível superior (antes da primeira tabela). */
export async function modeloDoUsuario(caminho: string): Promise<string | null> {
  let texto: string;
  try {
    texto = await readFile(caminho, 'utf8');
  } catch {
    return null;
  }
  for (const linha of texto.split('\n')) {
    if (linha.trim().startsWith('[')) return null;
    if (/^model\s*=\s*"[A-Za-z0-9._-]+"\s*$/u.test(linha.trim())) return linha.trim();
  }
  return null;
}

/** Conteúdo do `auth.json` da casa, para saber se o Codex renovou o token durante a execução. */
export async function lerCredencial(casaCodex: string): Promise<string | null> {
  try {
    return await readFile(join(casaCodex, 'auth.json'), 'utf8');
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ modo nativo (macOS, Windows)

/** Subpastas da casa temporária que o modo nativo usa como perfil do usuário e temporários. */
export function pastasDaCasaNativa(casa: string, plataforma: Plataforma): string[] {
  return plataforma === 'win32'
    ? [join(casa, 'tmp'), join(casa, 'AppData', 'Roaming'), join(casa, 'AppData', 'Local')]
    : [join(casa, 'tmp')];
}

/**
 * Ambiente do Codex no modo nativo: nada do ambiente do worker além do que o sistema exige para
 * rodar um programa (no Windows, `SystemRoot` e companhia); casa, perfil e temporários apontam para
 * a casa temporária; o PATH só tem as pastas do sistema (os comandos do modelo são `ls`, `cat`, `rg`
 * do sistema, ou o PowerShell no Windows).
 */
export function ambienteNativo(casa: string, origem: NodeJS.ProcessEnv, plataforma: Plataforma): Record<string, string> {
  const base = ambienteSaneado(origem, plataforma);
  const ambiente: Record<string, string> = { HOME: casa, CODEX_HOME: join(casa, '.codex') };
  if (base.LANG !== undefined) ambiente.LANG = base.LANG;
  if (base.TERM !== undefined) ambiente.TERM = base.TERM;
  if (plataforma === 'win32') {
    const sistema = base.SystemRoot ?? base.windir ?? 'C:\\Windows';
    for (const nome of ['SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'ProgramData', 'ProgramFiles']) {
      const valor = base[nome];
      if (valor !== undefined) ambiente[nome] = valor;
    }
    ambiente.SystemRoot = sistema;
    ambiente.PATH = [join(sistema, 'System32'), sistema, join(sistema, 'System32', 'Wbem'), join(sistema, 'System32', 'WindowsPowerShell', 'v1.0')].join(';');
    ambiente.USERPROFILE = casa;
    ambiente.APPDATA = join(casa, 'AppData', 'Roaming');
    ambiente.LOCALAPPDATA = join(casa, 'AppData', 'Local');
    ambiente.TEMP = join(casa, 'tmp');
    ambiente.TMP = join(casa, 'tmp');
  } else {
    ambiente.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    ambiente.TMPDIR = join(casa, 'tmp');
  }
  return ambiente;
}

/** Cadeia TOML básica (as regras de escape do JSON valem no TOML para estes caracteres). */
function tomlTexto(valor: string): string {
  return JSON.stringify(valor);
}

/** Nome do perfil de permissões que o Margem escreve na casa temporária. */
export const PERFIL_DO_MARGEM = 'margem-leitura';

/**
 * Trecho do `config.toml` da casa temporária com a política do sandbox nativo. No `perfil`, leitura
 * negada na raiz e liberada no mínimo do sistema, no diretório da execução e nos anexos; escrita em
 * lugar nenhum; rede desligada. No Windows, o tipo de sandbox (`[windows] sandbox`).
 * As chaves seguem a documentação de permissões do Codex (`default_permissions`, `[permissions.<nome>]`).
 */
export function politicaNativa(entrada: {
  politica: PoliticaNativa; plataforma: Plataforma; sandboxDoWindows: SandboxDoWindows;
  diretorio: string; leituras: readonly string[];
}): { topo: string[]; tabelas: string[] } {
  const topo: string[] = [];
  const tabelas: string[] = [];
  if (entrada.politica === 'perfil') {
    topo.push(`default_permissions = ${tomlTexto(PERFIL_DO_MARGEM)}`);
    tabelas.push(
      `[permissions.${PERFIL_DO_MARGEM}]`,
      'description = "Margem: só lê o diretório da execução; sem escrita fora dele e sem rede."',
      `[permissions.${PERFIL_DO_MARGEM}.filesystem]`,
      '":root" = "deny"',
      '":minimal" = "read"',
      ...[entrada.diretorio, ...entrada.leituras].map((caminho) => `${tomlTexto(caminho)} = "read"`),
      `[permissions.${PERFIL_DO_MARGEM}.filesystem.":workspace_roots"]`,
      '"." = "read"',
      `[permissions.${PERFIL_DO_MARGEM}.network]`,
      'enabled = false',
    );
  }
  if (entrada.plataforma === 'win32') tabelas.push('[windows]', `sandbox = ${tomlTexto(entrada.sandboxDoWindows)}`);
  return { topo, tabelas };
}

/**
 * Argumentos do `codex exec` no modo nativo. Com o perfil, o `--sandbox` sai da linha: a documentação
 * do Codex pede um sistema ou o outro, e o `--sandbox` da linha de comando venceria o perfil.
 */
export function argumentosNativos(argumentos: readonly string[], politica: PoliticaNativa): string[] {
  if (politica !== 'perfil') return [...argumentos];
  const lista = [...argumentos];
  const posicao = lista.indexOf('--sandbox');
  if (posicao >= 0 && posicao < lista.indexOf('--')) lista.splice(posicao, 2);
  return lista;
}

/**
 * Prepara a casa para o modo nativo: pastas de perfil e temporários, e a política no `config.toml`
 * (depois da linha do modelo que `prepararCasa` já escreveu). Devolve a linha de comando e o ambiente.
 */
export async function prepararNativo(entrada: {
  confinamento: Confinamento; casa: string; diretorio: string; leituras: readonly string[];
  argumentos: readonly string[]; origem?: NodeJS.ProcessEnv;
}): Promise<{ comando: string; argumentos: string[]; ambiente: Record<string, string> }> {
  const { confinamento, casa } = entrada;
  const plataforma = confinamento.plataforma ?? process.platform;
  const politica = confinamento.politica ?? (plataforma === 'win32' ? 'somente-leitura' : 'perfil');
  for (const pasta of pastasDaCasaNativa(casa, plataforma)) await mkdir(pasta, { recursive: true, mode: 0o700 });
  const configuracao = join(casa, '.codex', 'config.toml');
  let atual = '';
  try { atual = await readFile(configuracao, 'utf8'); } catch { /* sem linha do modelo */ }
  // O Codex reexecuta o próprio binário dentro do sandbox (no Linux, como auxiliar do bwrap): a pasta
  // da versão precisa ser legível, senão o perfil que nega a raiz esconde o próprio Codex.
  const pastaDoCodex = /[\\/]/u.test(confinamento.motor) ? (await pastaDoMotor(confinamento.motor)).pasta : null;
  const { topo, tabelas } = politicaNativa({
    politica, plataforma, sandboxDoWindows: confinamento.sandboxDoWindows ?? 'unelevated',
    diretorio: entrada.diretorio, leituras: [...entrada.leituras, ...(pastaDoCodex === null ? [] : [pastaDoCodex])],
  });
  // Chaves de topo antes de qualquer tabela; a linha do modelo (se houver) é de topo.
  await writeFile(configuracao, [...topo, ...atual.split('\n').filter((linha) => linha.trim() !== ''), ...tabelas, ''].join('\n'), { mode: 0o600 });
  return {
    comando: confinamento.motor,
    argumentos: argumentosNativos(entrada.argumentos, politica),
    ambiente: ambienteNativo(casa, entrada.origem ?? process.env, plataforma),
  };
}
