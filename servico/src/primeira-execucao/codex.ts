/**
 * O `codex` desta instalação, visto de fora e sem rede (J103).
 *
 * Três perguntas baratas, cada uma um subprocesso curto com o ambiente saneado:
 * - está no PATH? (`codex --version`; o sistema não achar o arquivo é "ausente");
 * - a versão tem as flags de que o executor precisa? (`codex exec --help`, por `capacidades.ts`);
 * - há login? (`codex login status`, que só lê a credencial guardada em `CODEX_HOME` e responde
 *   "Logged in using ChatGPT", "Logged in using an API key…" ou "Not logged in").
 *
 * Nada aqui lê o `auth.json` nem devolve a saída crua da CLI: a resposta é só o que a interface
 * precisa (encontrado, versão, compatível, logado, tipo de conta). Nenhuma leitura é disparada.
 */
import { execFile } from 'node:child_process';
import { ambienteSaneado } from '../executor/ambiente.js';
import { detectarCapacidades, type ExecutarComando } from '../executor/capacidades.js';
import { codexCli } from '../plataforma/executaveis.js';

/** Código convencional de "comando não encontrado" (o mesmo do shell). */
export const CODIGO_AUSENTE = 127;

export interface EstadoDoCodex {
  /** O binário existe no PATH do serviço. */
  encontrado: boolean;
  /** Ex.: "codex-cli 0.160.0"; `null` sem binário. */
  versao: string | null;
  /** Todas as flags que o executor usa existem nesta versão. */
  compativel: boolean;
  /** `null` quando não deu para saber (sem binário ou resposta ilegível). */
  logado: boolean | null;
  /** Como está logado: a conta ChatGPT (o caminho do Margem) ou uma chave de API. */
  conta: 'chatgpt' | 'chave_api' | null;
}

/** Roda um comando curto; "arquivo inexistente" vira o código 127, sem lançar. */
export const comandoCurto: ExecutarComando = (arquivo, argumentos) =>
  new Promise((resolver) => {
    execFile(
      arquivo,
      [...argumentos],
      { env: ambienteSaneado(), timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true },
      (erro, saidaPadrao, saidaErro) => {
        const saida = `${saidaPadrao}\n${saidaErro}`;
        if (erro && (erro as NodeJS.ErrnoException).code === 'ENOENT') { resolver({ codigo: CODIGO_AUSENTE, saida: '' }); return; }
        const codigo = erro && typeof erro.code === 'number' ? erro.code : erro ? 1 : 0;
        resolver({ codigo, saida });
      },
    );
  });

/** Interpreta `codex login status`. Só olha a primeira linha que fala de login. */
export function lerStatusDoLogin(codigo: number, saida: string): Pick<EstadoDoCodex, 'logado' | 'conta'> {
  if (/\bnot logged in\b/i.test(saida)) return { logado: false, conta: null };
  if (codigo === 0 && /\blogged in\b/i.test(saida)) {
    if (/chatgpt/i.test(saida)) return { logado: true, conta: 'chatgpt' };
    if (/api key/i.test(saida)) return { logado: true, conta: 'chave_api' };
    return { logado: true, conta: null };
  }
  return { logado: null, conta: null };
}

/** A versão vem como "codex-cli 0.160.0"; guardamos só a linha que tem número de versão. */
function linhaDaVersao(saida: string): string | null {
  const linha = saida.split('\n').map((l) => l.trim()).find((l) => /\d+\.\d+/.test(l));
  return linha === undefined ? null : linha.slice(0, 80);
}

export async function verificarCodex(
  opcoes: { executarComando?: ExecutarComando; binario?: string } = {},
): Promise<EstadoDoCodex> {
  const { executarComando = comandoCurto, binario = codexCli() } = opcoes;
  const versao = await executarComando(binario, ['--version']);
  if (versao.codigo === CODIGO_AUSENTE) return { encontrado: false, versao: null, compativel: false, logado: null, conta: null };
  // A ajuda e o login são independentes: em paralelo, para a tela não esperar dois processos em fila.
  const [capacidades, login] = await Promise.all([
    detectarCapacidades({ executarComando, binario }),
    executarComando(binario, ['login', 'status']),
  ]);
  return {
    encontrado: true,
    versao: linhaDaVersao(versao.saida),
    compativel: versao.codigo === 0 && capacidades.faltando.length === 0,
    ...lerStatusDoLogin(login.codigo, login.saida),
  };
}
