/**
 * Onde estão os programas externos que o serviço chama (J114). Todo `spawn`/`execFile` de programa
 * externo resolve o caminho aqui, a partir das variáveis do contrato com o app de desktop (J113):
 *
 * | variável              | programa                                   | sem a variável                          |
 * |-----------------------|--------------------------------------------|-----------------------------------------|
 * | `MARGEM_CODEX_MOTOR`  | binário nativo do Codex (roda as leituras) | o da imagem Docker (Linux) ou `codex`   |
 * | `MARGEM_CODEX`        | CLI do Codex para `--version`/`login`      | o motor no app de desktop; senão `codex`|
 * | `MARGEM_MOTOR`        | motor congelado `margem-motor[.exe]`       | `motor/.venv` + `python -m …`/`tools/`  |
 * | `MARGEM_YT_DLP`       | yt-dlp                                     | `yt-dlp` do PATH                        |
 * | `MARGEM_FFMPEG`       | ffmpeg                                     | `ffmpeg` do PATH                        |
 * | `MARGEM_FFPROBE`      | ffprobe                                    | `ffprobe` do PATH                       |
 * | `MARGEM_FONTE`        | fonte TTF dos rótulos da arte              | DejaVuSans.ttf do Debian                |
 * | `MARGEM_PYTHON_CAMADA`, `MARGEM_PYTHON_EXERCICIOS` | Python alternativo (só sem `MARGEM_MOTOR`) | o do motor |
 *
 * Sem nenhuma variável, tudo fica como antes do J114 (Docker e o servidor de desenvolvimento).
 * O motor Python tem duas formas com a mesma interface de subcomandos (`motor/empacotar/cli.py`):
 * congelado (PyInstaller) quando `MARGEM_MOTOR` existe, ou o venv com os módulos e scripts de sempre.
 */
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { raizDoRepositorio } from '../dados.js';
import type { Plataforma } from './processos.js';

export interface Contexto {
  ambiente?: NodeJS.ProcessEnv;
  plataforma?: Plataforma;
  /** Raiz do repositório (onde estão `motor/` e `tools/`). */
  raiz?: string;
}

/** Binário do Codex na imagem Docker (`Dockerfile`), o padrão histórico no Linux. */
export const CODEX_DA_IMAGEM = '/usr/local/lib/leitor/codex-motor';
/** Fonte dos rótulos na imagem Docker (`fonts-dejavu-core`). */
export const FONTE_DA_IMAGEM = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

function variavel(ambiente: NodeJS.ProcessEnv, nome: string): string | undefined {
  const valor = ambiente[nome]?.trim();
  return valor === undefined || valor === '' ? undefined : valor;
}

function contexto(ctx: Contexto): { ambiente: NodeJS.ProcessEnv; plataforma: Plataforma } {
  return { ambiente: ctx.ambiente ?? process.env, plataforma: ctx.plataforma ?? process.platform };
}

/** O app de desktop (J113) roda a API e o worker com `MARGEM_APP_DESKTOP=1`. */
export function noAppDeDesktop(ambiente: NodeJS.ProcessEnv = process.env): boolean {
  return variavel(ambiente, 'MARGEM_APP_DESKTOP') === '1';
}

/** `nome.exe` no Windows; o nome como está nos outros sistemas. */
export function comExtensao(nome: string, plataforma: Plataforma = process.platform): string {
  return plataforma === 'win32' && !/\.(exe|com)$/iu.test(nome) ? `${nome}.exe` : nome;
}

export function ffmpeg(ctx: Contexto = {}): string {
  return variavel(contexto(ctx).ambiente, 'MARGEM_FFMPEG') ?? 'ffmpeg';
}

export function ffprobe(ctx: Contexto = {}): string {
  return variavel(contexto(ctx).ambiente, 'MARGEM_FFPROBE') ?? 'ffprobe';
}

export function ytDlp(ctx: Contexto = {}): string {
  return variavel(contexto(ctx).ambiente, 'MARGEM_YT_DLP') ?? 'yt-dlp';
}

/** O binário que roda as leituras (dentro do confinamento). */
export function codexMotor(ctx: Contexto = {}): string {
  const { ambiente, plataforma } = contexto(ctx);
  return variavel(ambiente, 'MARGEM_CODEX_MOTOR') ?? (plataforma === 'linux' ? CODEX_DA_IMAGEM : 'codex');
}

/**
 * A CLI das consultas curtas (`--version`, `exec --help`, `login status`). No servidor de desenvolvimento e no Docker é o
 * `codex` do PATH (ou um embrulho que sincroniza o login); no app de desktop não há PATH com
 * codex, e a CLI é o próprio binário dos recursos (`MARGEM_CODEX_MOTOR`).
 */
export function codexCli(ctx: Contexto = {}): string {
  const { ambiente } = contexto(ctx);
  const explicita = variavel(ambiente, 'MARGEM_CODEX');
  if (explicita !== undefined) return explicita;
  const motor = variavel(ambiente, 'MARGEM_CODEX_MOTOR');
  return noAppDeDesktop(ambiente) && motor !== undefined ? motor : 'codex';
}

/** Fonte TTF que o `drawtext` do ffmpeg usa nos rótulos da arte. */
export function fonteDosRotulos(ctx: Contexto = {}): string {
  return variavel(contexto(ctx).ambiente, 'MARGEM_FONTE') ?? FONTE_DA_IMAGEM;
}

/** Python do venv do motor: `bin/python` no Linux e no macOS, `Scripts\python.exe` no Windows. */
export function pythonDoVenv(raiz: string, plataforma: Plataforma = process.platform): string {
  return plataforma === 'win32' ? join(raiz, 'motor', '.venv', 'Scripts', 'python.exe') : join(raiz, 'motor', '.venv', 'bin', 'python');
}

/** Subcomandos do motor; os mesmos no congelado (`margem-motor <sub>`) e no venv. */
export type SubcomandoDoMotor =
  | 'ingest' | 'pdf-anotado' | 'renderizar-paginas' | 'camada-da-transcricao' | 'exercicios' | 'miniatura' | 'imagem' | 'verificar';

export interface ComandoDoMotor {
  programa: string;
  argumentos: string[];
  /** Diretório de trabalho (o venv precisa de `motor/` para achar `margem_motor`). */
  cwd: string;
  congelado: boolean;
}

/**
 * Miniatura com o PyMuPDF do motor (forma do venv; o congelado tem o mesmo código no subcomando
 * `miniatura`): reduz sem ampliar, mantendo a proporção; CMYK/cinza viram RGB.
 */
export const SCRIPT_MINIATURA_PYMUPDF = [
  'import sys, pymupdf',
  'p = pymupdf.Pixmap(sys.argv[1])',
  'if p.alpha: p = pymupdf.Pixmap(p, 0)',
  'if p.n != 3: p = pymupdf.Pixmap(pymupdf.csRGB, p)',
  'lado = int(sys.argv[3]); f = min(1.0, lado / max(p.width, p.height))',
  'if f < 1: p = pymupdf.Pixmap(p, max(1, round(p.width * f)), max(1, round(p.height * f)), None)',
  'open(sys.argv[2], "wb").write(p.tobytes(output="jpg", jpg_quality=82))',
].join('\n');

/** O motor congelado, se `MARGEM_MOTOR` estiver definida. */
export function motorCongelado(ctx: Contexto = {}): string | undefined {
  return variavel(contexto(ctx).ambiente, 'MARGEM_MOTOR');
}

/**
 * Linha de comando de um subcomando do motor. Com `MARGEM_MOTOR`, `margem-motor <sub> <args>`; sem,
 * exatamente o que o serviço rodava antes (módulo do pacote ou script de `tools/`).
 * `python` troca o interpretador da forma venv (testes; `MARGEM_PYTHON_CAMADA` e `MARGEM_PYTHON_EXERCICIOS`).
 */
export function comandoDoMotor(subcomando: SubcomandoDoMotor, argumentos: readonly string[], ctx: Contexto & { python?: string } = {}): ComandoDoMotor {
  const { ambiente, plataforma } = contexto(ctx);
  const raiz = resolve(ctx.raiz ?? raizDoRepositorio());
  const congelado = motorCongelado(ctx);
  if (congelado !== undefined && ctx.python === undefined) {
    return { programa: congelado, argumentos: [subcomando, ...argumentos], cwd: raiz, congelado: true };
  }
  const doVenv = pythonDoVenv(raiz, plataforma);
  const motor = join(raiz, 'motor');
  const ferramenta = (nome: string) => join(raiz, 'tools', nome);
  switch (subcomando) {
    case 'ingest':
      return { programa: ctx.python ?? doVenv, argumentos: ['-m', 'margem_motor.ingest', ...argumentos], cwd: motor, congelado: false };
    case 'pdf-anotado':
      return { programa: ctx.python ?? doVenv, argumentos: ['-m', 'margem_motor.pdf_anotado', ...argumentos], cwd: motor, congelado: false };
    case 'imagem':
      return { programa: ctx.python ?? doVenv, argumentos: ['-m', 'margem_motor.imagem', ...argumentos], cwd: motor, congelado: false };
    case 'verificar':
      return { programa: ctx.python ?? doVenv, argumentos: ['-c', 'import margem_motor.ingest', ...argumentos], cwd: motor, congelado: false };
    case 'renderizar-paginas':
      return { programa: ctx.python ?? doVenv, argumentos: [ferramenta('renderizar-paginas.py'), ...argumentos], cwd: raiz, congelado: false };
    case 'camada-da-transcricao':
      return { programa: ctx.python ?? variavel(ambiente, 'MARGEM_PYTHON_CAMADA') ?? doVenv,
        argumentos: [ferramenta('camada-da-transcricao.py'), ...argumentos], cwd: raiz, congelado: false };
    case 'exercicios':
      return { programa: ctx.python ?? variavel(ambiente, 'MARGEM_PYTHON_EXERCICIOS') ?? doVenv,
        argumentos: [ferramenta('exercicios-do-pdf.py'), ...argumentos], cwd: raiz, congelado: false };
    case 'miniatura':
      return { programa: ctx.python ?? doVenv, argumentos: ['-c', SCRIPT_MINIATURA_PYMUPDF, ...argumentos], cwd: raiz, congelado: false };
  }
}

/** Situação de um programa externo, para `/api/estado-instalacao` e para as mensagens de erro. */
export interface SituacaoDoExecutavel {
  ok: boolean;
  /** Caminho conferido (absoluto, ou o nome procurado no PATH). */
  caminho: string;
  /** De onde veio: a variável do contrato ou o padrão. */
  origem: string;
  /** Explicação curta quando `ok` é falso. */
  mensagem?: string;
}

/** Procura um nome sem barra no PATH (com `PATHEXT` no Windows), como o `spawn` faria. */
export async function procurarNoPath(nome: string, ctx: Contexto = {}): Promise<string | null> {
  const { ambiente, plataforma } = contexto(ctx);
  const caminhos = (ambiente.PATH ?? ambiente.Path ?? '').split(plataforma === 'win32' ? ';' : delimiter).filter((p) => p !== '');
  const extensoes = plataforma === 'win32' ? ['.exe', '.com', ''] : [''];
  for (const pasta of caminhos) {
    for (const extensao of extensoes) {
      const candidato = join(pasta, `${nome}${extensao}`);
      if (await executavel(candidato, plataforma)) return candidato;
    }
  }
  return null;
}

async function executavel(caminho: string, plataforma: Plataforma): Promise<boolean> {
  try {
    if (!(await stat(caminho)).isFile()) return false;
    // No Windows não há bit de execução: basta existir.
    if (plataforma !== 'win32') await access(caminho, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Confere se o programa existe e é executável; a mensagem diz qual variável apontou para onde. */
export async function conferirExecutavel(programa: string, variavelDoContrato: string, ctx: Contexto = {}): Promise<SituacaoDoExecutavel> {
  const { ambiente, plataforma } = contexto(ctx);
  const origem = variavel(ambiente, variavelDoContrato) === undefined ? 'padrão' : variavelDoContrato;
  if (plataforma === 'win32' && /\.(cmd|bat)$/iu.test(programa)) {
    return { ok: false, caminho: programa, origem, mensagem: `${programa} é um script (.cmd/.bat); o serviço só roda executáveis, sem shell. Aponte ${variavelDoContrato} para o .exe.` };
  }
  const temSeparador = isAbsolute(programa) || programa.includes('/') || (plataforma === 'win32' && programa.includes('\\'));
  if (temSeparador) {
    if (await executavel(programa, plataforma)) return { ok: true, caminho: programa, origem };
    return { ok: false, caminho: programa, origem,
      mensagem: origem === 'padrão' ? `${programa} não existe; defina ${variavelDoContrato}.` : `${variavelDoContrato} aponta para ${programa}, que não existe ou não é executável.` };
  }
  const achado = await procurarNoPath(programa, ctx);
  if (achado !== null) return { ok: true, caminho: achado, origem };
  return { ok: false, caminho: programa, origem, mensagem: `${programa} não está no PATH; instale ou defina ${variavelDoContrato}.` };
}

/** As ferramentas de mídia e o motor, de uma vez (o estado da instalação mostra cada uma). */
export async function conferirFerramentas(ctx: Contexto = {}): Promise<Record<'motor' | 'ffmpeg' | 'ffprobe' | 'yt_dlp' | 'codex', SituacaoDoExecutavel>> {
  const raiz = resolve(ctx.raiz ?? raizDoRepositorio());
  const congelado = motorCongelado(ctx);
  const [motor, ff, fp, yt, cx] = await Promise.all([
    congelado === undefined ? conferirExecutavel(pythonDoVenv(raiz, contexto(ctx).plataforma), 'MARGEM_MOTOR', ctx) : conferirExecutavel(congelado, 'MARGEM_MOTOR', ctx),
    conferirExecutavel(ffmpeg(ctx), 'MARGEM_FFMPEG', ctx),
    conferirExecutavel(ffprobe(ctx), 'MARGEM_FFPROBE', ctx),
    conferirExecutavel(ytDlp(ctx), 'MARGEM_YT_DLP', ctx),
    conferirExecutavel(codexMotor(ctx), 'MARGEM_CODEX_MOTOR', ctx),
  ]);
  return { motor, ffmpeg: ff, ffprobe: fp, yt_dlp: yt, codex: cx };
}
