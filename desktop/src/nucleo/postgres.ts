/**
 * Postgres embutido do app: um cluster por biblioteca, em `<biblioteca>/.margem/banco`.
 *
 * - Primeira vez: `initdb` com autenticação scram e a senha aleatória do app (`--pwfile`, arquivo
 *   0600 apagado em seguida), sem locale (UTF-8) e só em 127.0.0.1, sem soquete Unix.
 * - Toda vez: confere a versão do cluster contra a dos binários (diferente: erro claro, sem
 *   pg_upgrade), limpa o `postmaster.pid` velho de uma queda (ou para o Postgres órfão que ainda
 *   esteja vivo com esta pasta), sobe com `pg_ctl start -w` numa porta livre e, ao sair, `pg_ctl stop -m fast`.
 * - Senha: guardada no app (não na biblioteca, que pode estar num Dropbox). Biblioteca vinda de outro
 *   computador ou senha recusada: a senha é redefinida (`redefinirSenha`) com o cluster parado, pelo
 *   modo monousuário (`postgres --single`, o comando pela entrada padrão): nenhuma porta é aberta, e
 *   ninguém conecta sem senha nem por um instante (S-03). Só quando o Windows recusa o modo monousuário
 *   (app aberto como administrador, UAC desligado: o `postgres` direto não roda com esse token; V-W8,
 *   auditoria B-12) vale o caminho antigo: subida curta pelo `pg_ctl`, que tira os privilégios, com um
 *   `pg_hba.conf` temporário que confia só no usuário do app, no banco `postgres` e em 127.0.0.1.
 */
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, open, readdir, readFile, realpath, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import pg from 'pg';
import { renomearComRetentativa } from './disco.js';
import type { BinariosDoPostgres } from './recursos.js';

export const USUARIO = 'margem';
export const BANCO = 'margem';
/** Abaixo disso não criamos nem subimos o banco (a primeira escrita já falharia). */
export const ESPACO_MINIMO_BYTES = 256 * 1024 * 1024;

export type CodigoDoErro =
  | 'binarios_ausentes' | 'versao_diferente' | 'disco_cheio' | 'pasta_invalida'
  | 'initdb' | 'subida' | 'porta' | 'senha' | 'parada' | 'migracao' | 'lock_incerto'
  | 'bloqueado' | 'tempo_esgotado' | 'copia';

export class ErroDoBanco extends Error {
  constructor(readonly codigo: CodigoDoErro, mensagem: string, readonly detalhe?: string, readonly falha?: FalhaDoProcesso) {
    super(mensagem);
    this.name = 'ErroDoBanco';
  }
}

/**
 * Por que o programa nem rodou (W-06): o código do sistema (`ENOENT` ausente, `EACCES`/`EPERM` acesso negado,
 * em geral antivírus ou política da empresa; `ETIMEDOUT` prazo esgotado), o executável e a mensagem saneada.
 */
export interface FalhaDoProcesso { codigo: string; executavel: string; mensagem: string }

export interface Resultado { codigo: number; saida: string; falha?: FalhaDoProcesso }

/** Tira credenciais de URLs (`postgres://usuario:senha@`) e limita o tamanho, para registros e telas. */
export function sanear(texto: string, limite = 400): string {
  return texto.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]*@/giu, '$1***@').slice(0, limite);
}

function falhaDoErro(erro: { code?: string | number | null; killed?: boolean; message: string }, executavel: string): FalhaDoProcesso | undefined {
  if (erro.killed === true) return { codigo: 'ETIMEDOUT', executavel, mensagem: 'O programa não terminou no prazo.' };
  if (typeof erro.code === 'string') return { codigo: erro.code, executavel, mensagem: sanear(erro.message) };
  return undefined;
}

export type TipoDeFalha = 'ausente' | 'bloqueado' | 'tempo_esgotado' | 'outra';

export function tipoDaFalha(codigo: string): TipoDeFalha {
  if (codigo === 'ENOENT') return 'ausente';
  // `UNKNOWN` é o que o Windows devolve quando o Defender barra o arquivo ("contém um vírus").
  if (codigo === 'EACCES' || codigo === 'EPERM' || codigo === 'UNKNOWN') return 'bloqueado';
  if (codigo === 'ETIMEDOUT') return 'tempo_esgotado';
  return 'outra';
}

/** O programa do banco nem rodou: mensagem que distingue ausência, bloqueio e prazo, com o diagnóstico junto. */
export function erroDaFalha(falha: FalhaDoProcesso): ErroDoBanco {
  const nome = basename(falha.executavel);
  const diagnostico = `${falha.codigo} ${falha.executavel}: ${falha.mensagem}`;
  switch (tipoDaFalha(falha.codigo)) {
    case 'ausente':
      return new ErroDoBanco('binarios_ausentes',
        `O programa ${nome} do banco embutido não foi encontrado nesta instalação. Se o antivírus avisou de algo, confira o histórico de proteção dele; senão, reinstale o Margem.`,
        diagnostico, falha);
    case 'bloqueado':
      return new ErroDoBanco('bloqueado',
        `O sistema não deixou o Margem rodar o programa ${nome} do banco embutido. Costuma ser o antivírus ou uma política da empresa: veja o histórico de proteção do antivírus, libere o Margem e clique em Tentar novamente.`,
        diagnostico, falha);
    case 'tempo_esgotado':
      return new ErroDoBanco('tempo_esgotado',
        `O programa ${nome} do banco embutido não respondeu a tempo. Pode ser o antivírus examinando o arquivo: espere um pouco e clique em Tentar novamente.`,
        diagnostico, falha);
    default:
      return new ErroDoBanco('binarios_ausentes', `Não foi possível rodar o programa ${nome} do banco embutido (${falha.codigo}).`, diagnostico, falha);
  }
}
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
        const falha = erro === null ? undefined : falhaDoErro(erro, arquivo);
        resolver({ codigo, saida: `${saida}\n${saidaErro}`.trim(), ...(falha === undefined ? {} : { falha }) });
      });
    return;
  }
  const filho = spawn(arquivo, [...argumentos], { env: ambienteDoPostgres(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let texto = '';
  let resolvido = false;
  const prazo = setTimeout(() => { filho.kill(); }, 360_000);
  const fim = (resultado: Resultado): void => { if (resolvido) return; resolvido = true; clearTimeout(prazo); resolver(resultado); };
  filho.stdout.on('data', (pedaco: Buffer) => { texto += pedaco.toString(); });
  filho.stderr.on('data', (pedaco: Buffer) => { texto += pedaco.toString(); });
  filho.stdin.on('error', () => { /* o programa saiu antes de ler a entrada: o código conta */ });
  filho.on('error', (erro: NodeJS.ErrnoException) => {
    const falha = falhaDoErro(erro, arquivo);
    fim({ codigo: 127, saida: erro.message, ...(falha === undefined ? {} : { falha }) });
  });
  filho.on('close', (codigo, sinal) => {
    fim({ codigo: codigo ?? 1, saida: texto.trim(), ...(sinal === 'SIGTERM' && codigo === null ? { falha: { codigo: 'ETIMEDOUT', executavel: arquivo, mensagem: 'O programa não terminou no prazo.' } } : {}) });
  });
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
  let estourou = false;
  const prazo = setTimeout(() => { estourou = true; filho.kill(); }, 360_000);
  filho.stdout.on('data', (pedaco: Buffer) => { texto += pedaco.toString(); });
  filho.stderr.on('data', (pedaco: Buffer) => { texto += pedaco.toString(); });
  filho.on('error', (falha: NodeJS.ErrnoException) => {
    if (resolvido) return;
    resolvido = true;
    clearTimeout(prazo);
    const diagnostico = falhaDoErro(falha, arquivo);
    resolver({ codigo: 127, saida: falha.message, ...(diagnostico === undefined ? {} : { falha: diagnostico }) });
  });
  filho.on('exit', (codigo) => {
    clearTimeout(prazo);
    // Um instante para o que já está no pipe chegar; depois os pipes (presos ao servidor) são soltos.
    setTimeout(() => {
      filho.stdout.destroy();
      filho.stderr.destroy();
      if (resolvido) return;
      resolvido = true;
      resolver({
        codigo: codigo ?? 1, saida: texto.trim(),
        ...(estourou ? { falha: { codigo: 'ETIMEDOUT', executavel: arquivo, mensagem: 'O programa não terminou no prazo.' } } : {}),
      });
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
  if (resultado.falha !== undefined) throw erroDaFalha(resultado.falha);
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
    "log_min_messages = warning",
    "timezone = 'UTC'",
    configuracaoDosRegistros(),
  ].join('\n');
}

/** Marca do bloco dos registros no `postgresql.conf` (clusters antigos o recebem uma vez). */
export const MARCA_DOS_REGISTROS = '# --- Margem: registros do servidor ---';
/** Pasta dos registros do servidor, relativa ao cluster (sem caminho do usuário no conf: acentos no Windows). */
export const PASTA_DOS_REGISTROS = 'log';

/**
 * Rotação nativa do Postgres (L-08): o coletor escreve `log/postgres-HH.log`, um arquivo por hora do dia,
 * truncado quando a hora volta no dia seguinte. São no máximo 24 arquivos (um dia de registros), e nada
 * cresce sem limite numa sessão longa. O `pg_ctl -l` continua recebendo só o que sai antes do coletor subir.
 */
export function configuracaoDosRegistros(): string {
  return [
    '',
    MARCA_DOS_REGISTROS,
    'logging_collector = on',
    `log_directory = '${PASTA_DOS_REGISTROS}'`,
    "log_filename = 'postgres-%H.log'",
    'log_rotation_age = 60',
    'log_rotation_size = 0',
    'log_truncate_on_rotation = on',
    'log_file_mode = 0600',
    '',
  ].join('\n');
}

/** Cluster criado antes da rotação nativa: acrescenta o bloco (o último valor do arquivo vale). */
export async function garantirConfiguracaoDosRegistros(pasta: string): Promise<boolean> {
  const arquivo = join(pasta, 'postgresql.conf');
  let atual: string;
  try { atual = await readFile(arquivo, 'utf8'); } catch { return false; }
  if (atual.includes(MARCA_DOS_REGISTROS)) return false;
  await appendFile(arquivo, configuracaoDosRegistros());
  return true;
}

/** Os últimos `bytes` de um arquivo, sem carregar o resto (registro de dias pode ter centenas de MB). */
export async function lerCauda(caminho: string, bytes = 4_000, desdeByte = 0): Promise<string> {
  const arquivo = await open(caminho, 'r');
  try {
    const { size } = await arquivo.stat();
    const inicio = Math.max(size - bytes, Math.min(desdeByte, size), 0);
    const tamanho = size - inicio;
    const buffer = Buffer.alloc(tamanho);
    await arquivo.read(buffer, 0, tamanho, inicio);
    return buffer.toString('utf8');
  } finally {
    await arquivo.close();
  }
}

/** Onde uma tentativa começou nos registros: o tamanho do arquivo do `pg_ctl -l` e a hora. */
export interface MarcoDosRegistros { bytes: number; quando: number }

export async function marcoDosRegistros(arquivoDeLog: string): Promise<MarcoDosRegistros> {
  let bytes = 0;
  try { bytes = (await stat(arquivoDeLog)).size; } catch { /* ainda não existe */ }
  return { bytes, quando: Date.now() };
}

/**
 * Cauda do que o servidor disse desde `desde` (sem ele, o fim de tudo): o arquivo do `pg_ctl -l` (o que sai
 * antes do coletor subir) e o registro mais recente do coletor. Mensagens de sessões antigas não entram,
 * para um "could not bind" de ontem não virar o diagnóstico de hoje.
 */
export async function caudaDosRegistros(pasta: string, arquivoDeLog: string, bytes = 4_000, desde?: MarcoDosRegistros): Promise<string> {
  const partes: string[] = [];
  try { partes.push(await lerCauda(arquivoDeLog, bytes, desde?.bytes ?? 0)); } catch { /* sem log */ }
  try {
    const pastaDosRegistros = join(pasta, PASTA_DOS_REGISTROS);
    let maisNovo: { caminho: string; quando: number } | null = null;
    for (const nome of await readdir(pastaDosRegistros)) {
      if (!nome.endsWith('.log')) continue;
      const caminho = join(pastaDosRegistros, nome);
      const quando = (await stat(caminho)).mtimeMs;
      if (desde !== undefined && quando < desde.quando - 2_000) continue;
      if (maisNovo === null || quando > maisNovo.quando) maisNovo = { caminho, quando };
    }
    if (maisNovo !== null) partes.push(await lerCauda(maisNovo.caminho, bytes));
  } catch { /* coletor ainda não escreveu */ }
  return partes.join('\n');
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
  if (resultado.falha !== undefined) throw erroDaFalha(resultado.falha);
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
  /** Porta livre para a subida curta (só no caminho do administrador no Windows). */
  porta: number;
  arquivoDeLog: string;
  /** Para o modo monousuário e o `pg_ctl stop` (padrão: espera o processo). */
  executar?: Executar;
  /** Para o `pg_ctl start` (padrão: não espera os pipes herdados pelo servidor). */
  executarSubida?: Executar;
  alterar?: AlterarSenha;
  plataforma?: NodeJS.Platform;
}

/** `postgres --single` no banco `postgres` do cluster parado; o comando vai pela entrada padrão. */
export function argumentosDoModoUnico(pasta: string): string[] {
  return ['--single', '-D', pasta, 'postgres'];
}

/** O `ALTER ROLE` do modo monousuário: uma linha, a senha como literal SQL (aspas dobradas). */
export function comandoDaSenha(senha: string): string {
  return `ALTER ROLE ${USUARIO} WITH PASSWORD '${senha.replaceAll("'", "''")}';\n`;
}

/** O Windows não deixa o `postgres` direto rodar com token de administrador. */
export function recusouAdministrador(texto: string): boolean {
  return /administrative permissions|administrador/iu.test(texto);
}

/** Tira a senha de um texto que vai para o diagnóstico (o modo monousuário pode repetir o comando). */
function semSenha(texto: string, senha: string): string {
  return senha === '' ? texto : texto.split(senha).join('***');
}

/**
 * Redefine a senha do usuário do app com o cluster parado: modo monousuário, sem porta aberta (S-03).
 * Se o Windows recusar o modo monousuário (administrador), cai na subida curta pelo `pg_ctl`.
 */
export async function redefinirSenha(
  binarios: BinariosDoPostgres, pasta: string, senha: string, opcoes: OpcoesDaRedefinicao,
): Promise<void> {
  const executar = opcoes.executar ?? executarDeVerdade;
  await restaurarHbaSeFicou(pasta);
  const resultado = await executar(binarios.postgres, argumentosDoModoUnico(pasta), comandoDaSenha(senha));
  if (resultado.falha !== undefined) throw erroDaFalha(resultado.falha);
  const saida = semSenha(resultado.saida, senha);
  const falhou = resultado.codigo !== 0 || /\b(?:ERROR|FATAL|PANIC):/u.test(saida);
  if (!falhou) return;
  if ((opcoes.plataforma ?? process.platform) === 'win32' && recusouAdministrador(saida)) {
    await redefinirSenhaPeloServidor(binarios, pasta, senha, opcoes);
    return;
  }
  if (pareceDiscoCheio(saida)) throw new ErroDoBanco('disco_cheio', 'O disco da biblioteca está cheio. Libere espaço e abra de novo.', saida.slice(-600));
  throw new ErroDoBanco('senha', 'Não foi possível ajustar a senha do banco da biblioteca.', saida.slice(-1200));
}

/**
 * Só para o Windows com token de administrador: guarda o `pg_hba.conf`, põe o temporário
 * (`hbaDaRedefinicao`), sobe pelo `pg_ctl`, faz o `ALTER ROLE`, para e devolve o original, aconteça o que
 * acontecer.
 */
export async function redefinirSenhaPeloServidor(
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
      const log = await caudaDosRegistros(pasta, opcoes.arquivoDeLog, 1500);
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

export interface InfoDoLock { pid: number; pasta: string | null; inicio: number | null; porta: number | null }

/** `postmaster.pid`: pid, pasta de dados, início (segundos desde 1970), porta… uma informação por linha. */
export function lerLock(texto: string): InfoDoLock | null {
  const linhas = texto.split(/\r?\n/u);
  const pid = Number.parseInt(linhas[0] ?? '', 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const inicio = Number.parseInt(linhas[2] ?? '', 10);
  const porta = Number.parseInt(linhas[3] ?? '', 10);
  return {
    pid, pasta: linhas[1]?.trim() || null,
    inicio: Number.isInteger(inicio) && inicio > 0 ? inicio : null,
    porta: Number.isInteger(porta) ? porta : null,
  };
}

/**
 * Quem é o processo que tem o pid do lock (L-04). `pasta`: o diretório de trabalho (o postmaster faz `chdir`
 * para a pasta de dados) ou o `-D` da linha de comando; `inicio`: quando começou, em segundos desde 1970.
 * `null` quando o sistema não diz.
 */
export interface IdentidadeDoProcesso {
  vivo: boolean;
  /** Vivo, mas de outro usuário: não pode ser o servidor deste cluster (o próprio Postgres pensa assim). */
  deOutroUsuario?: boolean;
  postgres: boolean;
  pasta: string | null;
  inicio: number | null;
  /**
   * Vivo, mas o sistema não disse quem é (PowerShell/CIM falhou ou estourou o prazo, `ps` não respondeu): não
   * dá para afirmar que não é o Postgres deste cluster (R-01).
   */
  desconhecido?: boolean;
}

export type IdentificarProcesso = (pid: number) => Promise<IdentidadeDoProcesso>;

function executarCurto(arquivo: string, argumentos: readonly string[]): Promise<string | null> {
  return new Promise((resolver) => {
    execFile(arquivo, [...argumentos], { timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (erro, saida) => {
      resolver(erro === null ? saida : null);
    });
  });
}

/** `-D "C:\pasta"` ou `-D /pasta` numa linha de comando do Windows. */
export function pastaDaLinhaDeComando(linha: string): string | null {
  const achado = /(?:^|\s)-D\s+(?:"([^"]+)"|(\S+))/u.exec(linha);
  return achado ? (achado[1] ?? achado[2] ?? null) : null;
}

const NADA: IdentidadeDoProcesso = { vivo: false, postgres: false, pasta: null, inicio: null };
const DESCONHECIDO: IdentidadeDoProcesso = { vivo: true, desconhecido: true, postgres: false, pasta: null, inicio: null };

function vivoAoSinal(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (erro) { return (erro as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** O processo ainda existe (a pasta dele no /proc está lá), mas o `comm` não foi lido. */
function erroDoProc(pid: number): boolean {
  return existsSync(`/proc/${String(pid)}`) && vivoAoSinal(pid);
}

export const identificarProcesso: IdentificarProcesso = async (pid) => {
  try { process.kill(pid, 0); } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'EPERM') return NADA;
    if (process.platform !== 'win32') return { vivo: true, deOutroUsuario: true, postgres: false, pasta: null, inicio: null };
  }
  if (process.platform === 'linux') {
    const { readlink } = await import('node:fs/promises');
    let postgres = false;
    try { postgres = /postgres/u.test(readFileSync(`/proc/${String(pid)}/comm`, 'utf8')); } catch {
      // Sumiu entre o sinal e a leitura (morto), ou o /proc não deixou ler (não dá para dizer quem é).
      return (erroDoProc(pid) ? DESCONHECIDO : NADA);
    }
    let pasta: string | null = null;
    try { pasta = await readlink(`/proc/${String(pid)}/cwd`); } catch { /* sem acesso */ }
    let inicio: number | null = null;
    try {
      // Campo 22 do stat (depois do nome entre parênteses): início em tiques desde o boot (100 por segundo).
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      const campos = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const tiques = Number(campos[19]);
      const boot = /^btime\s+(\d+)/mu.exec(readFileSync('/proc/stat', 'utf8'));
      if (Number.isFinite(tiques) && boot) inicio = Number(boot[1]) + Math.floor(tiques / 100);
    } catch { /* sem acesso */ }
    return { vivo: true, postgres, pasta, inicio };
  }
  if (process.platform === 'win32') {
    const roteiro = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}"; if ($p) { $p.Name; ([DateTimeOffset]$p.CreationDate).ToUnixTimeSeconds(); $p.CommandLine }`;
    const saida = await executarCurto('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', roteiro]);
    if (saida === null) return DESCONHECIDO;
    const [nome = '', inicio = '', ...linha] = saida.split(/\r?\n/u);
    if (nome.trim() === '') return NADA;
    const segundos = Number.parseInt(inicio.trim(), 10);
    return {
      vivo: true, postgres: /postgres/iu.test(nome), pasta: pastaDaLinhaDeComando(linha.join(' ')),
      inicio: Number.isInteger(segundos) ? segundos : null,
    };
  }
  const ps = await executarCurto('ps', ['-p', String(pid), '-o', 'lstart=,comm=']);
  // `ps` sai com erro também quando o processo não existe: se ele ainda responde ao sinal, é desconhecido.
  if (ps === null || ps.trim() === '') return vivoAoSinal(pid) ? DESCONHECIDO : NADA;
  // "Thu Oct 15 23:35:18 2026 /caminho/postgres": a data tem 5 partes.
  const partes = ps.trim().split(/\s+/u);
  const quando = Date.parse(partes.slice(0, 5).join(' '));
  const lsof = await executarCurto('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const pasta = lsof?.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? null;
  return {
    vivo: true, postgres: /postgres/iu.test(partes.slice(5).join(' ')), pasta,
    inicio: Number.isFinite(quando) ? Math.floor(quando / 1000) : null,
  };
};

export type ConclusaoDoLock = 'velho' | 'nosso' | 'incerto';

/** Folga entre o início gravado no lock e o do processo (o lock é escrito logo depois de o servidor nascer). */
const FOLGA_DO_INICIO_S = 5;

function mesmoCaminho(a: string, b: string, plataforma: NodeJS.Platform): boolean {
  const normalizar = (caminho: string): string => {
    const limpo = caminho.replaceAll('\\', '/').replace(/\/+$/u, '');
    return plataforma === 'win32' || plataforma === 'darwin' ? limpo.toLowerCase() : limpo;
  };
  return normalizar(a) === normalizar(b);
}

/**
 * O processo é o servidor deste cluster? Pela pasta de dados (o mais forte) e, sem ela, pelo horário de
 * início gravado no lock. Sem nenhuma das duas, `incerto`: o app não para nem apaga nada (L-04).
 */
export function concluirLock(
  info: InfoDoLock, processo: IdentidadeDoProcesso, pastas: readonly string[], plataforma: NodeJS.Platform = process.platform,
): ConclusaoDoLock {
  if (!processo.vivo || processo.deOutroUsuario === true) return 'velho';
  // R-01: "não consegui saber quem é" não é "não é Postgres": o lock fica e nada é parado.
  if (processo.desconhecido === true) return 'incerto';
  if (!processo.postgres) return 'velho';
  if (processo.pasta !== null) return pastas.some((p) => mesmoCaminho(p, processo.pasta ?? '', plataforma)) ? 'nosso' : 'velho';
  if (processo.inicio !== null && info.inicio !== null) return Math.abs(processo.inicio - info.inicio) <= FOLGA_DO_INICIO_S ? 'nosso' : 'velho';
  return 'incerto';
}

export type DecisaoDoLock = 'sem_lock' | 'lock_velho_removido' | 'orfao_parado';

/**
 * Antes de subir: sem `postmaster.pid`, nada a fazer; pid morto, que não é Postgres ou que é outro
 * Postgres (outra pasta de dados, outro horário de início: o pid foi reaproveitado depois de reiniciar o
 * computador), o arquivo é velho e sai; o servidor deste cluster ainda vivo é um órfão de uma queda do app
 * (o app é instância única) e é parado com `pg_ctl stop -m fast`. Sem como confirmar, erro que a pessoa
 * resolve (fechar o outro programa, reiniciar) e nada é parado.
 */
export async function tratarLockVelho(
  binarios: BinariosDoPostgres, pasta: string,
  opcoes: { identificar?: IdentificarProcesso; executar?: Executar; plataforma?: NodeJS.Platform } = {},
): Promise<DecisaoDoLock> {
  const arquivo = join(pasta, 'postmaster.pid');
  if (!existsSync(arquivo)) return 'sem_lock';
  let info: InfoDoLock | null;
  try { info = lerLock(await readFile(arquivo, 'utf8')); } catch { info = null; }
  if (info !== null) {
    const processo = await (opcoes.identificar ?? identificarProcesso)(info.pid);
    let real = pasta;
    try { real = await realpath(pasta); } catch { /* fica o caminho dado */ }
    const conclusao = concluirLock(info, processo, [pasta, real], opcoes.plataforma);
    if (conclusao === 'incerto') {
      throw new ErroDoBanco('lock_incerto',
        'Um PostgreSQL está rodando com o número de processo que o banco desta biblioteca usou da última vez, e o Margem '
        + 'não conseguiu confirmar se é o dele. Para não interromper outro programa, nada foi parado. Feche outros programas '
        + 'que usam PostgreSQL ou reinicie o computador, e clique em Tentar novamente.',
        `pid ${String(info.pid)}`);
    }
    if (conclusao === 'nosso') {
      const resultado = await (opcoes.executar ?? executarDeVerdade)(binarios.pgCtl, argumentosDaParada(pasta));
      if (resultado.codigo !== 0 && existsSync(arquivo)) {
        throw new ErroDoBanco('parada', 'Um banco antigo desta biblioteca ainda está rodando e não parou. Reinicie o computador e abra o Margem de novo.', resultado.saida.slice(-600));
      }
      return 'orfao_parado';
    }
  }
  await rm(arquivo, { force: true });
  return 'lock_velho_removido';
}

// ---------------------------------------------------------------- subir e parar

export async function subir(
  binarios: BinariosDoPostgres, pasta: string, porta: number, arquivoDeLog: string, executar: Executar = executarSemEsperarOsPipes,
): Promise<void> {
  await garantirConfiguracaoDosRegistros(pasta);
  const marco = await marcoDosRegistros(arquivoDeLog);
  const resultado = await executar(binarios.pgCtl, argumentosDaSubida(pasta, porta, arquivoDeLog));
  if (resultado.codigo === 0) return;
  if (resultado.falha !== undefined) throw erroDaFalha(resultado.falha);
  const log = await caudaDosRegistros(pasta, arquivoDeLog, 4_000, marco);
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
