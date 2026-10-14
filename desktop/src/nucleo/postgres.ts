/**
 * Postgres embutido do app: um cluster por biblioteca, em `<biblioteca>/.margem/banco`.
 *
 * - Primeira vez: `initdb` com autenticação scram e a senha aleatória do app (`--pwfile`, arquivo
 *   0600 apagado em seguida), sem locale (UTF-8) e só em 127.0.0.1, sem soquete Unix.
 * - Toda vez: confere a versão do cluster contra a dos binários (diferente: erro claro, sem
 *   pg_upgrade), limpa o `postmaster.pid` velho de uma queda (ou para o Postgres órfão que ainda
 *   esteja vivo com esta pasta), sobe com `pg_ctl start -w` numa porta livre e, ao sair, `pg_ctl stop -m fast`.
 * - Senha: guardada no app (não na biblioteca, que pode estar num Dropbox). Biblioteca vinda de outro
 *   computador ou senha recusada: a senha é redefinida (`redefinirSenha`) com o servidor subido pelo
 *   `pg_ctl` e um `pg_hba.conf` temporário que confia só no usuário do app, no banco `postgres` e em
 *   127.0.0.1, por alguns segundos. Não usa mais `postgres --single`: no Windows o `postgres` direto
 *   se recusa a rodar com token de administrador (app aberto como administrador, UAC desligado); o
 *   `pg_ctl` tira os privilégios antes de subir o servidor (V-W8, auditoria B-12).
 */
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { renomearComRetentativa } from './disco.js';
import type { BinariosDoPostgres } from './recursos.js';

export const USUARIO = 'margem';
export const BANCO = 'margem';
/** Abaixo disso não criamos nem subimos o banco (a primeira escrita já falharia). */
export const ESPACO_MINIMO_BYTES = 256 * 1024 * 1024;

export type CodigoDoErro =
  | 'binarios_ausentes' | 'versao_diferente' | 'disco_cheio' | 'pasta_invalida'
  | 'initdb' | 'subida' | 'porta' | 'senha' | 'parada' | 'migracao';

export class ErroDoBanco extends Error {
  constructor(readonly codigo: CodigoDoErro, mensagem: string, readonly detalhe?: string) {
    super(mensagem);
    this.name = 'ErroDoBanco';
  }
}

export interface Resultado { codigo: number; saida: string }
export type Executar = (arquivo: string, argumentos: readonly string[], entrada?: string) => Promise<Resultado>;

/** Ambiente dos binários do Postgres: sem PG* do usuário (PGPORT, PGDATA… mudariam o alvo). */
export function ambienteDoPostgres(origem: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const ambiente: NodeJS.ProcessEnv = {};
  for (const [nome, valor] of Object.entries(origem)) {
    if (/^PG/u.test(nome) || nome === 'DATABASE_URL') continue;
    ambiente[nome] = valor;
  }
  // Mensagens do Postgres em inglês e previsíveis (o app traduz as que importam).
  ambiente.LC_MESSAGES = 'C';
  return ambiente;
}

export const executarDeVerdade: Executar = (arquivo, argumentos, entrada) => new Promise((resolver) => {
  if (entrada === undefined) {
    execFile(arquivo, [...argumentos], { env: ambienteDoPostgres(), timeout: 360_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (erro, saida, saidaErro) => {
        const codigo = erro === null ? 0 : typeof erro.code === 'number' ? erro.code : 1;
        resolver({ codigo, saida: `${saida}\n${saidaErro}`.trim() });
      });
    return;
  }
  const filho = spawn(arquivo, [...argumentos], { env: ambienteDoPostgres(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let texto = '';
  filho.stdout.on('data', (pedaco: Buffer) => { texto += pedaco.toString(); });
  filho.stderr.on('data', (pedaco: Buffer) => { texto += pedaco.toString(); });
  filho.on('error', (falha) => { resolver({ codigo: 127, saida: falha.message }); });
  filho.on('close', (codigo) => { resolver({ codigo: codigo ?? 1, saida: texto.trim() }); });
  filho.stdin.end(entrada);
});

/**
 * Para `pg_ctl start`: o servidor que ele deixa no ar herda os pipes de stdout/stderr (no Windows,
 * por `CreateProcess` com herança de handles), e o `close` de `execFile` só viria quando o Postgres
 * parasse. Aqui o resultado sai no `exit` do `pg_ctl`, e os pipes são soltos em seguida.
 */
export const executarSemEsperarOsPipes: Executar = (arquivo, argumentos) => new Promise((resolver) => {
  const filho = spawn(arquivo, [...argumentos], { env: ambienteDoPostgres(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let texto = '';
  let resolvido = false;
  const prazo = setTimeout(() => { filho.kill(); }, 360_000);
  filho.stdout.on('data', (pedaco: Buffer) => { texto += pedaco.toString(); });
  filho.stderr.on('data', (pedaco: Buffer) => { texto += pedaco.toString(); });
  filho.on('error', (falha) => {
    if (resolvido) return;
    resolvido = true;
    clearTimeout(prazo);
    resolver({ codigo: 127, saida: falha.message });
  });
  filho.on('exit', (codigo) => {
    clearTimeout(prazo);
    // Um instante para o que já está no pipe chegar; depois os pipes (presos ao servidor) são soltos.
    setTimeout(() => {
      filho.stdout.destroy();
      filho.stderr.destroy();
      if (resolvido) return;
      resolvido = true;
      resolver({ codigo: codigo ?? 1, saida: texto.trim() });
    }, 200);
  });
});

/** "postgres (PostgreSQL) 18.4" → 18. */
export function lerVersaoPrincipal(texto: string): number | null {
  const achado = /\(PostgreSQL\)\s+(\d+)(?:\.\d+)?/u.exec(texto) ?? /^\s*(\d+)(?:\.\d+)?\s*$/u.exec(texto);
  return achado ? Number.parseInt(achado[1] ?? '', 10) : null;
}

export async function versaoDosBinarios(binarios: BinariosDoPostgres, executar: Executar = executarDeVerdade): Promise<number> {
  const resultado = await executar(binarios.postgres, ['--version']);
  const versao = resultado.codigo === 0 ? lerVersaoPrincipal(resultado.saida) : null;
  if (versao === null) throw new ErroDoBanco('binarios_ausentes', 'Os programas do banco embutido não rodaram.', resultado.saida.slice(0, 400));
  return versao;
}

/** Versão gravada no cluster (`PG_VERSION`); `null` se a pasta ainda não tem cluster. */
export async function versaoDoCluster(pasta: string): Promise<number | null> {
  try {
    return lerVersaoPrincipal(await readFile(join(pasta, 'PG_VERSION'), 'utf8'));
  } catch {
    return null;
  }
}

export function mensagemDeVersaoDiferente(cluster: number, binarios: number): string {
  return `O banco desta biblioteca foi criado pelo PostgreSQL ${String(cluster)}, e esta versão do Margem traz o `
    + `PostgreSQL ${String(binarios)}. ${cluster > binarios
      ? 'Atualize o Margem para a versão mais recente.'
      : 'A conversão automática ainda não existe: guarde uma cópia da pasta e fale com o suporte.'}`;
}

export async function conferirEspaco(pasta: string, minimo = ESPACO_MINIMO_BYTES): Promise<void> {
  let livres: number;
  try {
    const info = await statfs(pasta);
    livres = Number(info.bavail) * Number(info.bsize);
  } catch {
    return; // Sistema de arquivos que não responde: deixa o Postgres dizer.
  }
  if (livres < minimo) {
    throw new ErroDoBanco('disco_cheio',
      `Há só ${String(Math.floor(livres / (1024 * 1024)))} MB livres no disco da biblioteca (${pasta}). `
      + `Libere espaço (o Margem precisa de pelo menos ${String(Math.round(minimo / (1024 * 1024)))} MB) e abra de novo.`);
  }
}

export function pareceDiscoCheio(texto: string): boolean {
  return /no space left on device|ENOSPC|could not extend file|disk full/iu.test(texto);
}

export function pareceSemPorta(texto: string): boolean {
  return /could not bind|address already in use|could not create any TCP\/IP sockets/iu.test(texto);
}

/** O que vai no `postgresql.conf` do cluster do app. A porta vem na linha de comando de cada subida. */
export function configuracaoDoCluster(): string {
  return [
    '',
    '# --- Margem (app de computador) ---',
    "listen_addresses = '127.0.0.1'",
    "unix_socket_directories = ''",
    'max_connections = 40',
    "password_encryption = 'scram-sha-256'",
    "logging_collector = off",
    "log_min_messages = warning",
    "timezone = 'UTC'",
    '',
  ].join('\n');
}

export function argumentosDoInitdb(pasta: string, arquivoDaSenha: string): string[] {
  return [
    '-D', pasta, '-U', USUARIO, '--auth=scram-sha-256', `--pwfile=${arquivoDaSenha}`,
    '-E', 'UTF8', '--no-locale', '--no-instructions',
  ];
}

export function argumentosDaSubida(pasta: string, porta: number, arquivoDeLog: string): string[] {
  return ['start', '-D', pasta, '-w', '-t', '90', '-l', arquivoDeLog, '-o', `-p ${String(porta)}`];
}

/**
 * Prazo longo de propósito: a parada faz um checkpoint, e o primeiro depois de criar e migrar o banco
 * sincroniza centenas de arquivos (num disco rígido, mais de um minuto).
 */
export const PRAZO_DA_PARADA_S = 300;

export function argumentosDaParada(pasta: string): string[] {
  return ['stop', '-D', pasta, '-m', 'fast', '-w', '-t', String(PRAZO_DA_PARADA_S)];
}

export function urlDoBanco(senha: string, porta: number, banco = BANCO): string {
  return `postgres://${USUARIO}:${encodeURIComponent(senha)}@127.0.0.1:${String(porta)}/${banco}`;
}

export function novaSenha(): string {
  return randomBytes(24).toString('base64url');
}

/** Grava um arquivo legível só pelo dono (0600). */
export async function gravarSecreto(caminho: string, conteudo: string): Promise<void> {
  await writeFile(caminho, conteudo, { mode: 0o600 });
}

export async function inicializarCluster(
  binarios: BinariosDoPostgres, pasta: string, senha: string, pastaTemporaria: string, executar: Executar = executarDeVerdade,
): Promise<void> {
  await mkdir(pastaTemporaria, { recursive: true, mode: 0o700 });
  const arquivoDaSenha = join(pastaTemporaria, `pw-${randomBytes(6).toString('hex')}`);
  await gravarSecreto(arquivoDaSenha, `${senha}\n`);
  let resultado: Resultado;
  try {
    resultado = await executar(binarios.initdb, argumentosDoInitdb(pasta, arquivoDaSenha));
  } finally {
    await rm(arquivoDaSenha, { force: true });
  }
  if (resultado.codigo !== 0) {
    if (pareceDiscoCheio(resultado.saida)) {
      throw new ErroDoBanco('disco_cheio', 'O disco da biblioteca encheu ao criar o banco. Libere espaço e abra de novo.', resultado.saida.slice(-600));
    }
    throw new ErroDoBanco('initdb', 'Não foi possível criar o banco da biblioteca.', resultado.saida.slice(-1200));
  }
  await appendFile(join(pasta, 'postgresql.conf'), configuracaoDoCluster());
}

/** Onde o `pg_hba.conf` do cluster espera enquanto o temporário vale. */
export const HBA_GUARDADO = 'pg_hba.conf.margem-original';

/** `pg_hba.conf` da redefinição: só o usuário do app, só no banco `postgres`, só por 127.0.0.1. */
export function hbaDaRedefinicao(): string {
  return [
    '# Temporário do Margem: redefinição da senha. Some em segundos; o original está em pg_hba.conf.margem-original.',
    `host postgres ${USUARIO} 127.0.0.1/32 trust`,
    '',
  ].join('\n');
}

/**
 * Se uma redefinição foi interrompida (queda no meio), o `pg_hba.conf` temporário ainda está no lugar:
 * volta o original. Chamado antes de qualquer subida.
 */
export async function restaurarHbaSeFicou(pasta: string): Promise<boolean> {
  const guardado = join(pasta, HBA_GUARDADO);
  if (!existsSync(guardado)) return false;
  await renomearComRetentativa(guardado, join(pasta, 'pg_hba.conf'));
  return true;
}

export type AlterarSenha = (porta: number, senha: string) => Promise<void>;

/** `ALTER ROLE` pela conexão local confiável (sem senha), com a senha nova como literal escapado. */
export const alterarSenhaPeloPg: AlterarSenha = async (porta, senha) => {
  const cliente = new pg.Client({ host: '127.0.0.1', port: porta, user: USUARIO, database: 'postgres', connectionTimeoutMillis: 10_000 });
  await cliente.connect();
  try {
    await cliente.query(`ALTER ROLE ${USUARIO} WITH PASSWORD ${cliente.escapeLiteral(senha)}`);
  } finally {
    await cliente.end().catch(() => undefined);
  }
};

export interface OpcoesDaRedefinicao {
  /** Porta livre para a subida curta. */
  porta: number;
  arquivoDeLog: string;
  /** Para o `pg_ctl stop` (padrão: espera o processo). */
  executar?: Executar;
  /** Para o `pg_ctl start` (padrão: não espera os pipes herdados pelo servidor). */
  executarSubida?: Executar;
  alterar?: AlterarSenha;
}

/**
 * Redefine a senha do usuário do app com o servidor parado antes e depois: guarda o `pg_hba.conf`,
 * põe o temporário (`hbaDaRedefinicao`), sobe pelo `pg_ctl`, faz o `ALTER ROLE`, para e devolve o
 * original, aconteça o que acontecer.
 */
export async function redefinirSenha(
  binarios: BinariosDoPostgres, pasta: string, senha: string, opcoes: OpcoesDaRedefinicao,
): Promise<void> {
  const executar = opcoes.executar ?? executarDeVerdade;
  const executarSubida = opcoes.executarSubida ?? executarSemEsperarOsPipes;
  const alterar = opcoes.alterar ?? alterarSenhaPeloPg;
  await restaurarHbaSeFicou(pasta);
  const hba = join(pasta, 'pg_hba.conf');
  const guardado = join(pasta, HBA_GUARDADO);
  await renomearComRetentativa(hba, guardado);
  let falha: ErroDoBanco | null = null;
  try {
    await writeFile(hba, hbaDaRedefinicao(), { mode: 0o600 });
    const subida = await executarSubida(binarios.pgCtl, argumentosDaSubida(pasta, opcoes.porta, opcoes.arquivoDeLog));
    if (subida.codigo !== 0) {
      let log = '';
      try { log = (await readFile(opcoes.arquivoDeLog, 'utf8')).slice(-1500); } catch { /* sem log */ }
      throw new ErroDoBanco('senha', 'Não foi possível ajustar a senha do banco da biblioteca.', `${subida.saida}\n${log}`.slice(-1200));
    }
    try {
      await alterar(opcoes.porta, senha);
    } catch (erro) {
      falha = new ErroDoBanco('senha', 'Não foi possível ajustar a senha do banco da biblioteca.', (erro as Error).message.slice(0, 600));
    }
    const parada = await executar(binarios.pgCtl, argumentosDaParada(pasta));
    if (parada.codigo !== 0 && existsSync(join(pasta, 'postmaster.pid'))) {
      falha ??= new ErroDoBanco('parada', 'O banco da biblioteca não parou depois de ajustar a senha.', parada.saida.slice(-600));
    }
  } finally {
    await rm(hba, { force: true });
    await renomearComRetentativa(guardado, hba);
    // Se o servidor ficou no ar (a parada falhou), ele relê o pg_hba.conf original e larga o `trust`.
    if (existsSync(join(pasta, 'postmaster.pid'))) await executar(binarios.pgCtl, ['reload', '-D', pasta]).catch(() => undefined);
  }
  if (falha !== null) throw falha;
}

// ---------------------------------------------------------------- lock velho

export interface InfoDoLock { pid: number; pasta: string | null; porta: number | null }

/** `postmaster.pid`: pid, pasta de dados, início, porta… uma informação por linha. */
export function lerLock(texto: string): InfoDoLock | null {
  const linhas = texto.split(/\r?\n/u);
  const pid = Number.parseInt(linhas[0] ?? '', 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const porta = Number.parseInt(linhas[3] ?? '', 10);
  return { pid, pasta: linhas[1]?.trim() || null, porta: Number.isInteger(porta) ? porta : null };
}

export type ProcessoEhPostgres = (pid: number) => Promise<boolean>;

/** O pid vivo é mesmo um Postgres? (pid reaproveitado depois de reiniciar o computador não conta.) */
export const processoEhPostgres: ProcessoEhPostgres = async (pid) => {
  try { process.kill(pid, 0); } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  if (process.platform === 'linux') {
    try { return /postgres/u.test(readFileSync(`/proc/${String(pid)}/comm`, 'utf8')); } catch { return false; }
  }
  const [arquivo, argumentos] = process.platform === 'win32'
    ? ['tasklist', ['/FI', `PID eq ${String(pid)}`, '/NH', '/FO', 'CSV']] as const
    : ['ps', ['-p', String(pid), '-o', 'comm=']] as const;
  return new Promise((resolver) => {
    execFile(arquivo, [...argumentos], { timeout: 10_000, windowsHide: true }, (erro, saida) => {
      resolver(erro === null && /postgres/iu.test(saida));
    });
  });
};

export type DecisaoDoLock = 'sem_lock' | 'lock_velho_removido' | 'orfao_parado';

/**
 * Antes de subir: sem `postmaster.pid`, nada a fazer; pid morto (ou que não é Postgres), o arquivo
 * é velho e sai; Postgres vivo com esta pasta é um órfão de uma queda do app (o app é instância
 * única) e é parado com `pg_ctl stop -m fast`.
 */
export async function tratarLockVelho(
  binarios: BinariosDoPostgres, pasta: string,
  opcoes: { ehPostgres?: ProcessoEhPostgres; executar?: Executar } = {},
): Promise<DecisaoDoLock> {
  const arquivo = join(pasta, 'postmaster.pid');
  if (!existsSync(arquivo)) return 'sem_lock';
  let info: InfoDoLock | null;
  try { info = lerLock(await readFile(arquivo, 'utf8')); } catch { info = null; }
  const ehPostgres = opcoes.ehPostgres ?? processoEhPostgres;
  if (info !== null && await ehPostgres(info.pid)) {
    const resultado = await (opcoes.executar ?? executarDeVerdade)(binarios.pgCtl, argumentosDaParada(pasta));
    if (resultado.codigo !== 0 && existsSync(arquivo)) {
      throw new ErroDoBanco('parada', 'Um banco antigo desta biblioteca ainda está rodando e não parou. Reinicie o computador e abra o Margem de novo.', resultado.saida.slice(-600));
    }
    return 'orfao_parado';
  }
  await rm(arquivo, { force: true });
  return 'lock_velho_removido';
}

// ---------------------------------------------------------------- subir e parar

export async function subir(
  binarios: BinariosDoPostgres, pasta: string, porta: number, arquivoDeLog: string, executar: Executar = executarSemEsperarOsPipes,
): Promise<void> {
  const resultado = await executar(binarios.pgCtl, argumentosDaSubida(pasta, porta, arquivoDeLog));
  if (resultado.codigo === 0) return;
  let log = '';
  try { log = (await readFile(arquivoDeLog, 'utf8')).slice(-4000); } catch { /* sem log */ }
  const texto = `${resultado.saida}\n${log}`;
  if (pareceSemPorta(texto)) throw new ErroDoBanco('porta', `A porta ${String(porta)} do banco está ocupada.`, texto.slice(-600));
  if (pareceDiscoCheio(texto)) throw new ErroDoBanco('disco_cheio', 'O disco da biblioteca está cheio. Libere espaço e abra de novo.', texto.slice(-600));
  throw new ErroDoBanco('subida', 'O banco da biblioteca não subiu.', texto.slice(-1200));
}

export async function parar(binarios: BinariosDoPostgres, pasta: string, executar: Executar = executarDeVerdade): Promise<boolean> {
  if (!existsSync(join(pasta, 'postmaster.pid'))) return true;
  const resultado = await executar(binarios.pgCtl, argumentosDaParada(pasta));
  return resultado.codigo === 0;
}
