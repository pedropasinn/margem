import { execFile } from 'node:child_process';
import { ambienteSaneado } from './ambiente.js';
import { codexCli } from '../plataforma/executaveis.js';

/** Flags que o executor precisa encontrar em `codex exec --help` para montar o comando. */
export const FLAGS_NECESSARIAS = [
  '--sandbox',
  '--skip-git-repo-check',
  '--dangerously-bypass-hook-trust',
  '--output-schema',
  '--output-last-message',
  '-C',
  '-c',
  '-m',
] as const;

export interface Capacidades {
  /** Saída de `codex --version`, ex.: "codex-cli 0.154.0". */
  versao: string;
  /** Flag → presente na ajuda da versão local. */
  flags: Record<string, boolean>;
  /** Flags necessárias ausentes; vazio quando a CLI é compatível. */
  faltando: string[];
}

export type ExecutarComando = (
  arquivo: string,
  argumentos: readonly string[],
) => Promise<{ codigo: number; saida: string }>;

const comandoPadrao: ExecutarComando = (arquivo, argumentos) =>
  new Promise((resolver) => {
    execFile(
      arquivo,
      [...argumentos],
      { env: ambienteSaneado(), timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true },
      (erro, saidaPadrao, saidaErro) => {
        const saida = `${saidaPadrao}\n${saidaErro}`;
        const codigo = erro && typeof erro.code === 'number' ? erro.code : erro ? 1 : 0;
        resolver({ codigo, saida });
      },
    );
  });

/** Uma flag existe quando aparece na ajuda no começo de uma linha de opção. */
export function flagPresente(ajuda: string, flag: string): boolean {
  const escapada = flag.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s,])${escapada}([\\s,=]|$)`, 'm').test(ajuda);
}

export function lerCapacidades(versao: string, ajuda: string): Capacidades {
  const flags: Record<string, boolean> = {};
  for (const flag of FLAGS_NECESSARIAS) flags[flag] = flagPresente(ajuda, flag);
  // Opcionais: registradas, mas a ausência não impede a execução.
  for (const flag of ['--ephemeral', '--ignore-user-config', '--json', '--enable', '--disable', '--image']) {
    flags[flag] = flagPresente(ajuda, flag);
  }
  return {
    versao: versao.trim(),
    flags,
    faltando: FLAGS_NECESSARIAS.filter((flag) => !flags[flag]),
  };
}

let cache: Promise<Capacidades> | undefined;

/**
 * Roda `codex --version` e `codex exec --help` **uma vez** por processo e guarda o resultado.
 * Não executa nenhuma leitura; serve para decidir se o comando pode ser montado.
 */
export function detectarCapacidades(
  opcoes: { executarComando?: ExecutarComando; binario?: string; recarregar?: boolean } = {},
): Promise<Capacidades> {
  const { executarComando = comandoPadrao, binario = codexCli(), recarregar = false } = opcoes;
  if (cache && !recarregar && opcoes.executarComando === undefined) return cache;
  const promessa = (async (): Promise<Capacidades> => {
    const versao = await executarComando(binario, ['--version']);
    if (versao.codigo !== 0) {
      return { versao: '', flags: {}, faltando: [...FLAGS_NECESSARIAS] };
    }
    const ajuda = await executarComando(binario, ['exec', '--help']);
    if (ajuda.codigo !== 0) {
      return { versao: versao.saida.trim(), flags: {}, faltando: [...FLAGS_NECESSARIAS] };
    }
    return lerCapacidades(versao.saida, ajuda.saida);
  })();
  if (opcoes.executarComando === undefined) cache = promessa;
  return promessa;
}

/** Só para testes: descarta a memória do processo. */
export function esquecerCapacidades(): void {
  cache = undefined;
}
