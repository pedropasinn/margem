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
import { access, copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { modoInstalado } from '../instalacao.js';

/**
 * Binário real do Codex quando `MARGEM_CODEX_MOTOR` não está definida: o caminho da imagem Docker
 * (`Dockerfile`). Fora dela, defina `MARGEM_CODEX_MOTOR` com o binário nativo (ELF) do Codex.
 */
export const MOTOR_PADRAO = '/usr/local/lib/leitor/codex-motor';

export interface Confinamento {
  /** Caminho do `bwrap`. */
  bwrap: string;
  /** Binário real do Codex (ELF); roda dentro do confinamento. */
  motor: string;
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

/** O `bwrap` e o motor existem e são executáveis? Sem eles a leitura não roda (falha fechada). */
export async function confinamentoDisponivel(confinamento: Confinamento): Promise<string | null> {
  for (const [nome, caminho] of [['bwrap', confinamento.bwrap], ['motor do Codex', confinamento.motor]] as const) {
    try {
      await access(caminho, constants.X_OK);
    } catch {
      return `${nome} ausente em ${caminho}; a leitura não roda sem confinamento.`;
    }
  }
  return null;
}

/**
 * Confinamento da máquina: `MARGEM_CODEX_MOTOR` troca o binário real do Codex. No modo instalado
 * (J100) não há embrulho de credenciais: a CLI é a oficial, instalada na imagem, e o login mora em
 * `CODEX_HOME` (um volume); a sincronização é por cópia do `auth.json`.
 */
export function confinamentoPadrao(ambiente: NodeJS.ProcessEnv = process.env, binario = 'codex'): Confinamento {
  const motor = ambiente.MARGEM_CODEX_MOTOR;
  return {
    bwrap: '/usr/bin/bwrap',
    motor: motor === undefined || motor === '' ? MOTOR_PADRAO : motor,
    sincronizar: modoInstalado(ambiente)
      ? (casaCodex) => sincronizarPorCopia(casaCodex, pastaCodexDoUsuario(ambiente))
      : (casaCodex) => sincronizarPeloEmbrulho(binario, casaCodex, ambiente),
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
  await rename(temporario, join(codexDoUsuario, 'auth.json'));
}

/** `codex login status` com `CODEX_HOME` na casa temporária; o embrulho do PATH sincroniza o login. */
function sincronizarPeloEmbrulho(binario: string, casaCodex: string, ambiente: NodeJS.ProcessEnv): Promise<void> {
  const env: Record<string, string> = { CODEX_HOME: casaCodex };
  for (const nome of ['PATH', 'HOME', 'LANG'] as const) {
    const valor = ambiente[nome];
    if (valor !== undefined && valor !== '') env[nome] = valor;
  }
  return new Promise((resolver) => {
    execFile(binario, ['login', 'status'], { env, timeout: 30_000, maxBuffer: 256 * 1024 }, () => { resolver(); });
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
