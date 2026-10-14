/**
 * Onde estão os recursos do app e qual executável usar para cada ferramenta — uma função única de
 * resolução (`resolverRecursos`), para que o resto do app não decida caminho nenhum.
 *
 * Layout (montado por `desktop/recursos/preparar.mjs`, J114):
 *   dev:        desktop/recursos/<plataforma>/   e a raiz do serviço em desktop/dist/raiz/
 *   empacotado: <resourcesPath>/recursos/        e a raiz do serviço em <resourcesPath>/margem/
 *
 *   recursos/postgres/{bin/initdb,bin/pg_ctl,bin/postgres,lib,share}
 *   recursos/motor/margem-motor[.exe]            (motor Python congelado, PyInstaller onedir)
 *   recursos/bin/{codex,yt-dlp,ffmpeg,ffprobe}[.exe]  (+ codex-path/ e codex-resources/ ao lado)
 *   recursos/fontes/DejaVuSans.ttf, recursos/licencas/, recursos/recursos.json
 *
 * O app empacotado só usa o que veio dentro. Em desenvolvimento, o que faltar em desktop/recursos é
 * procurado no PATH (o registro diz a origem de cada um).
 */
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { executavel, type Plataforma } from './plataforma.js';

export type Origem = 'embutido' | 'sistema';
export interface Resolvido { caminho: string; origem: Origem }

export interface LocalDosRecursos {
  /** Raiz que o serviço enxerga como "repositório": bundles, web/dist, prompts, migrações… */
  raizApp: string;
  /** Pasta dos binários da plataforma (pode não existir em desenvolvimento). */
  recursos: string;
  empacotado: boolean;
}

export function localDosRecursos(opcoes: {
  empacotado: boolean; resourcesPath: string; pastaDoDesktop: string; plataforma: Plataforma;
}): LocalDosRecursos {
  if (opcoes.empacotado) {
    return { raizApp: join(opcoes.resourcesPath, 'margem'), recursos: join(opcoes.resourcesPath, 'recursos'), empacotado: true };
  }
  return {
    raizApp: join(opcoes.pastaDoDesktop, 'dist', 'raiz'),
    recursos: join(opcoes.pastaDoDesktop, 'recursos', opcoes.plataforma),
    empacotado: false,
  };
}

export interface BinariosDoPostgres { initdb: string; pgCtl: string; postgres: string; origem: Origem }

export interface RecursosResolvidos {
  postgres: BinariosDoPostgres | null;
  codex: Resolvido | null;
  /** Executável do motor congelado (J114). */
  motor: Resolvido | null;
  /** TTF dos rótulos da arte (`MARGEM_FONTE`). */
  fonte: Resolvido | null;
  ytDlp: Resolvido | null;
  ffmpeg: Resolvido | null;
  ffprobe: Resolvido | null;
  /** Pasta `bin/` embutida, que entra na frente do PATH dos processos do serviço. */
  pastaBin: string | null;
}

/** Operações de disco injetáveis (os testes simulam a árvore de arquivos). */
export interface Disco {
  executavel: (caminho: string) => boolean;
  arquivo: (caminho: string) => boolean;
  pasta: (caminho: string) => boolean;
}

export const DISCO_REAL: Disco = {
  executavel: (caminho) => {
    try {
      if (!statSync(caminho).isFile()) return false;
      if (process.platform !== 'win32') accessSync(caminho, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  arquivo: (caminho) => {
    try { return statSync(caminho).isFile(); } catch { return false; }
  },
  pasta: (caminho) => {
    try { return statSync(caminho).isDirectory(); } catch { return false; }
  },
};

/** Procura um programa no PATH (no Windows, com as extensões do PATHEXT). */
export function procurarNoPath(nome: string, ambiente: NodeJS.ProcessEnv, sistema: NodeJS.Platform, disco: Disco): string | null {
  const caminhoBruto = ambiente.PATH ?? ambiente.Path ?? '';
  const separador = sistema === 'win32' ? ';' : delimiter;
  const extensoes = sistema === 'win32'
    ? (ambiente.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter((e) => e !== '').map((e) => e.toLowerCase())
    : [''];
  for (const pasta of caminhoBruto.split(separador)) {
    if (pasta === '') continue;
    for (const extensao of extensoes) {
      const candidato = join(pasta, `${nome}${extensao}`);
      if (disco.executavel(candidato)) return candidato;
    }
  }
  return null;
}

export interface OpcoesDaResolucao {
  local: LocalDosRecursos;
  sistema?: NodeJS.Platform;
  ambiente?: NodeJS.ProcessEnv;
  disco?: Disco;
}

export function resolverRecursos(opcoes: OpcoesDaResolucao): RecursosResolvidos {
  const sistema = opcoes.sistema ?? process.platform;
  const ambiente = opcoes.ambiente ?? process.env;
  const disco = opcoes.disco ?? DISCO_REAL;
  const { recursos, empacotado } = opcoes.local;
  const exe = (nome: string): string => executavel(nome, sistema);

  const ferramenta = (nome: string): Resolvido | null => {
    const embutido = join(recursos, 'bin', exe(nome));
    if (disco.executavel(embutido)) return { caminho: embutido, origem: 'embutido' };
    if (empacotado) return null;
    const doSistema = procurarNoPath(nome, ambiente, sistema, disco);
    return doSistema === null ? null : { caminho: doSistema, origem: 'sistema' };
  };

  const pastaDoPostgres = join(recursos, 'postgres', 'bin');
  const binarios = { initdb: join(pastaDoPostgres, exe('initdb')), pgCtl: join(pastaDoPostgres, exe('pg_ctl')), postgres: join(pastaDoPostgres, exe('postgres')) };
  const postgres: BinariosDoPostgres | null = disco.executavel(binarios.initdb) && disco.executavel(binarios.pgCtl) && disco.executavel(binarios.postgres)
    ? { ...binarios, origem: 'embutido' } : null;

  const motorEmbutido = join(recursos, 'motor', exe('margem-motor'));
  const fonte = join(recursos, 'fontes', 'DejaVuSans.ttf');
  const pastaBin = join(recursos, 'bin');
  return {
    postgres,
    codex: ferramenta('codex'),
    motor: disco.executavel(motorEmbutido) ? { caminho: motorEmbutido, origem: 'embutido' } : null,
    fonte: disco.arquivo(fonte) ? { caminho: fonte, origem: 'embutido' } : null,
    ytDlp: ferramenta('yt-dlp'),
    ffmpeg: ferramenta('ffmpeg'),
    ffprobe: ferramenta('ffprobe'),
    pastaBin: disco.pasta(pastaBin) ? pastaBin : null,
  };
}

/** Uma linha por recurso, para o registro do app (só caminhos e origens; nada de segredo). */
export function resumoDosRecursos(r: RecursosResolvidos): Record<string, string> {
  const linha = (valor: Resolvido | null): string => (valor === null ? 'ausente' : `${valor.origem}: ${valor.caminho}`);
  return {
    postgres: r.postgres === null ? 'ausente' : `${r.postgres.origem}: ${r.postgres.postgres}`,
    codex: linha(r.codex),
    motor: linha(r.motor),
    fonte: linha(r.fonte),
    yt_dlp: linha(r.ytDlp),
    ffmpeg: linha(r.ffmpeg),
    ffprobe: linha(r.ffprobe),
  };
}
