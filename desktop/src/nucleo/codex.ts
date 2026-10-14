/**
 * Login do ChatGPT pela CLI `codex`, com o CODEX_HOME do app (no userData, nunca na biblioteca).
 *
 * - `codex login`: a própria CLI abre o navegador e espera a volta num servidor local; a janela de
 *   boas-vindas mostra o link caso o navegador não abra.
 * - `codex login --device-auth`: alternativa sem servidor local (rede corporativa, navegador em outro
 *   aparelho); a CLI imprime um link e um código de uso único, que a janela mostra.
 * - O estado vem de `codex login status` interpretado pela mesma função do serviço
 *   (`servico/src/primeira-execucao/codex.ts`), que nunca lê o `auth.json`.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { lerStatusDoLogin } from '../../../servico/src/primeira-execucao/codex.js';

export interface EstadoDoLogin { encontrado: boolean; logado: boolean | null; conta: 'chatgpt' | 'chave_api' | null }

/** Ambiente da CLI: o do app (a pessoa pode precisar de proxy), com o CODEX_HOME do app. */
export function ambienteDoCodex(codexHome: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const ambiente: NodeJS.ProcessEnv = { ...base, CODEX_HOME: codexHome };
  delete ambiente.ELECTRON_RUN_AS_NODE;
  delete ambiente.DATABASE_URL;
  return ambiente;
}

export function estadoDoLogin(codex: string | null, codexHome: string): Promise<EstadoDoLogin> {
  if (codex === null) return Promise.resolve({ encontrado: false, logado: null, conta: null });
  return new Promise((resolver) => {
    execFile(codex, ['login', 'status'], { env: ambienteDoCodex(codexHome), timeout: 20_000, windowsHide: true }, (erro, saida, saidaErro) => {
      if (erro && (erro as NodeJS.ErrnoException).code === 'ENOENT') { resolver({ encontrado: false, logado: null, conta: null }); return; }
      const codigo = erro === null ? 0 : typeof erro.code === 'number' ? erro.code : 1;
      resolver({ encontrado: true, ...lerStatusDoLogin(codigo, `${saida}\n${saidaErro}`) });
    });
  });
}

/** Primeiro link https da saída da CLI (o de autorização ou o da página do código). */
export function extrairLink(texto: string): string | null {
  const limpo = texto.replace(/\u001b\[[0-9;]*m/gu, '');
  const achado = /https:\/\/[^\s"'<>]+/u.exec(limpo);
  return achado ? achado[0].replace(/[.,;)]+$/u, '') : null;
}

/** Código de uso único do `--device-auth` (ex.: "ABCD-1234"). */
export function extrairCodigo(texto: string): string | null {
  const limpo = texto.replace(/\u001b\[[0-9;]*m/gu, '');
  const achado = /\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\b/u.exec(limpo);
  return achado ? (achado[1] ?? null) : null;
}

export interface EventoDoLogin {
  tipo: 'link' | 'codigo' | 'concluido' | 'falhou';
  valor?: string;
}

export interface LoginEmAndamento {
  cancelar: () => void;
  resultado: Promise<boolean>;
}

/** Roda `codex login` (ou `--device-auth`) e conta à janela o que aparecer: link, código, fim. */
export function iniciarLogin(
  codex: string, codexHome: string, dispositivo: boolean, aoEvento: (evento: EventoDoLogin) => void,
  criar: (arquivo: string, argumentos: string[], ambiente: NodeJS.ProcessEnv) => ChildProcess = (arquivo, argumentos, ambiente) =>
    spawn(arquivo, argumentos, { env: ambiente, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
): LoginEmAndamento {
  const filho = criar(codex, dispositivo ? ['login', '--device-auth'] : ['login'], ambienteDoCodex(codexHome));
  let texto = '';
  let linkAvisado = false;
  let codigoAvisado = false;
  const ler = (pedaco: Buffer): void => {
    texto += pedaco.toString();
    const link = extrairLink(texto);
    if (link !== null && !linkAvisado) { linkAvisado = true; aoEvento({ tipo: 'link', valor: link }); }
    const codigo = dispositivo ? extrairCodigo(texto) : null;
    if (codigo !== null && !codigoAvisado) { codigoAvisado = true; aoEvento({ tipo: 'codigo', valor: codigo }); }
  };
  filho.stdout?.on('data', ler);
  filho.stderr?.on('data', ler);
  const resultado = new Promise<boolean>((resolver) => {
    filho.on('error', () => { aoEvento({ tipo: 'falhou', valor: 'A CLI do Codex não foi encontrada.' }); resolver(false); });
    filho.on('exit', (codigo) => {
      const ok = codigo === 0;
      aoEvento(ok ? { tipo: 'concluido' } : { tipo: 'falhou', valor: 'O login não terminou.' });
      resolver(ok);
    });
  });
  return { cancelar: () => { filho.kill(); }, resultado };
}
