/**
 * Estado da instalação para a primeira execução (J103): banco, motor Python, `codex` e cota, e se a
 * tela de boas-vindas da instalação já foi concluída.
 *
 * "Concluída" mora na tabela `instalacao` (migração 0026), uma linha só. Foi o mecanismo mais
 * simples que vale para todos os navegadores da pessoa: o perfil do leitor tem contrato versionado
 * (`PerfilDoLeitorV1`) e não é lugar para estado de interface, e o `localStorage` do onboarding é por
 * navegador.
 */
import { execFile } from 'node:child_process';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { ambienteSaneado } from '../executor/ambiente.js';
import { raizDoRepositorio } from '../dados.js';
import { comandoDoMotor, conferirFerramentas, noAppDeDesktop, type SituacaoDoExecutavel } from '../plataforma/executaveis.js';
import { verificarCodex, type EstadoDoCodex } from './codex.js';
import { portaPublica } from '../http/ambiente.js';
import { idDaInstancia } from '../instancia.js';

export interface EstadoDoMotor {
  ok: boolean;
  /** `congelado`: o executável do app de desktop (`MARGEM_MOTOR`); `python`: o venv (J114). */
  forma?: 'congelado' | 'python';
  /** Por que não respondeu (só quando `ok` é falso). */
  mensagem?: string;
}

/** Programas externos de que partes do app dependem (mídia, YouTube, Codex), sem afetar `pronto`. */
export type FerramentasDaInstalacao = Record<'ffmpeg' | 'ffprobe' | 'yt_dlp' | 'codex', Omit<SituacaoDoExecutavel, 'caminho'>>;

export interface EstadoDaInstalacao {
  versao: 1;
  banco: { ok: boolean };
  motor: EstadoDoMotor;
  /** `executor: 'falso'` (testes, demonstração): o Codex não é necessário. */
  codex: EstadoDoCodex & { executor: 'codex' | 'falso' };
  /** Há leitura esperando a cota da conta voltar; `volta_em` é a estimativa mais tardia anunciada. */
  cota: { esgotada: boolean; volta_em: string | null };
  /** J114: cada programa externo, com a mensagem do que falta. Ausente se a verificação não foi pedida. */
  ferramentas?: FerramentasDaInstalacao;
  /**
   * J113: avisos do app de computador sobre a instalação (ex.: o Codex roda no sandbox próprio porque o
   * bwrap do sistema não funciona). Vêm de `MARGEM_AVISOS`, um por linha; ausente quando não há.
   */
  avisos?: string[];
  /**
   * V-D5: `desktop` quando a API roda dentro do app de computador, cuja janela de abertura já
   * escolheu a pasta e conferiu o login do ChatGPT; a interface não refaz a checagem na primeira
   * execução. Ausente nas outras instalações.
   */
  origem?: 'desktop';
  /**
   * V-W9: a identificação desta instalação e a porta da API. A extensão do navegador procura o Margem
   * nas portas 8730–8739 e mostra a identificação de quem achou; a checagem mostra a mesma.
   */
  instancia: { id: string; porta: number };
  primeira_execucao: { concluida: boolean; concluida_em: string | null; exemplo_documento_id: Id | null };
  /** Banco, motor e Codex prontos para ler (o Codex logado, ou o executor falso). */
  pronto: boolean;
}

/**
 * O motor importa (com as dependências do venv, ou o executável congelado responde a `verificar`)
 * num subprocesso curto e sem rede.
 */
export function verificarMotor(raiz = raizDoRepositorio()): Promise<EstadoDoMotor> {
  const comando = comandoDoMotor('verificar', [], { raiz });
  const forma = comando.congelado ? 'congelado' : 'python';
  return new Promise((resolver) => {
    execFile(comando.programa, comando.argumentos,
      { cwd: comando.cwd, env: ambienteSaneado(), timeout: 20_000, windowsHide: true },
      (erro) => {
        if (erro === null) { resolver({ ok: true, forma }); return; }
        const ausente = (erro as NodeJS.ErrnoException).code === 'ENOENT';
        resolver({ ok: false, forma, mensagem: ausente
          ? `Motor ausente em ${comando.programa}${comando.congelado ? ' (MARGEM_MOTOR)' : ''}.`
          : `O motor não respondeu (${comando.programa}).` });
      });
  });
}

/** Situação dos programas externos, sem o caminho completo (a tela só precisa do que fazer). */
export async function verificarFerramentas(): Promise<FerramentasDaInstalacao> {
  const todas = await conferirFerramentas();
  const resumo = (s: SituacaoDoExecutavel) => ({ ok: s.ok, origem: s.origem, ...(s.mensagem === undefined ? {} : { mensagem: s.mensagem }) });
  return { ffmpeg: resumo(todas.ffmpeg), ffprobe: resumo(todas.ffprobe), yt_dlp: resumo(todas.yt_dlp), codex: resumo(todas.codex) };
}

export interface Verificadores {
  codex: () => Promise<EstadoDoCodex>;
  motor: () => Promise<EstadoDoMotor>;
  executor: () => 'codex' | 'falso';
  /** Opcional: sem ele o estado não traz `ferramentas` (os testes antigos não passam). */
  ferramentas?: () => Promise<FerramentasDaInstalacao>;
}

/**
 * Guarda a resposta por alguns segundos: a tela consulta ao abrir e ao voltar ao foco, e cada
 * consulta seriam quatro subprocessos. Quem acabou de fazer login vê a mudança no "Verificar de novo",
 * que pede sem a memória.
 */
export function comMemoria<T>(verificar: () => Promise<T>, validadeMs: number, relogio: () => number = Date.now): (renovar?: boolean) => Promise<T> {
  let guardado: { quando: number; valor: Promise<T> } | undefined;
  return (renovar = false) => {
    const agora = relogio();
    if (!renovar && guardado && agora - guardado.quando < validadeMs) return guardado.valor;
    const valor = verificar();
    guardado = { quando: agora, valor };
    // Uma falha não fica guardada.
    valor.catch(() => { if (guardado?.valor === valor) guardado = undefined; });
    return valor;
  };
}

export const VERIFICADORES_PADRAO: Verificadores = {
  codex: () => verificarCodex(),
  motor: () => verificarMotor(),
  executor: () => (process.env.MARGEM_EXECUTOR === 'falso' ? 'falso' : 'codex'),
  ferramentas: () => verificarFerramentas(),
};

interface LinhaDoBanco {
  concluida_em: string | null;
  exemplo_documento_id: Id | null;
  volta_em: string | null;
  esgotada: boolean;
}

const iso = (coluna: string) => `to_char(${coluna} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

async function lerDoBanco(banco: pg.Pool): Promise<LinhaDoBanco | null> {
  try {
    return (await banco.query<LinhaDoBanco>(`SELECT
        ${iso('i.primeira_execucao_concluida_em')} AS concluida_em, i.exemplo_documento_id,
        (SELECT ${iso('max(j.not_before)')} FROM job j WHERE j.estado='adiado' AND j.error_code='cota') AS volta_em,
        EXISTS (SELECT 1 FROM job j WHERE j.estado='adiado' AND j.error_code='cota') AS esgotada
      FROM instalacao i WHERE i.id`)).rows[0] ?? null;
  } catch {
    return null;
  }
}

/** `MARGEM_AVISOS`: um aviso por linha, posto pelo app de computador ao subir o serviço. */
export function avisosDoApp(ambiente: NodeJS.ProcessEnv = process.env): string[] {
  return (ambiente.MARGEM_AVISOS ?? '').split(/\r?\n/u).map((linha) => linha.trim()).filter((linha) => linha !== '').slice(0, 10);
}

export async function lerEstadoDaInstalacao(
  banco: pg.Pool, verificadores: Verificadores,
): Promise<EstadoDaInstalacao> {
  const [linha, motor, codex, ferramentas] = await Promise.all([
    lerDoBanco(banco), verificadores.motor(), verificadores.codex(), verificadores.ferramentas?.().catch(() => undefined),
  ]);
  const executor = verificadores.executor();
  const codexPronto = executor === 'falso' || (codex.encontrado && codex.compativel && codex.logado === true);
  const avisos = avisosDoApp();
  return {
    versao: 1,
    banco: { ok: linha !== null },
    motor,
    codex: { ...codex, executor },
    cota: { esgotada: linha?.esgotada ?? false, volta_em: linha?.volta_em ?? null },
    ...(ferramentas === undefined ? {} : { ferramentas }),
    ...(avisos.length === 0 ? {} : { avisos }),
    ...(noAppDeDesktop() ? { origem: 'desktop' as const } : {}),
    instancia: { id: idDaInstancia(), porta: portaPublica() },
    primeira_execucao: {
      // Sem banco não dá para saber; a tela aparece, porque é ela que explica o que falta.
      concluida: linha?.concluida_em != null,
      concluida_em: linha?.concluida_em ?? null,
      exemplo_documento_id: linha?.exemplo_documento_id ?? null,
    },
    pronto: linha !== null && motor.ok && codexPronto,
  };
}

/** Marca a primeira execução como concluída. Idempotente: a data da primeira conclusão fica. */
export async function concluirPrimeiraExecucao(banco: pg.Pool): Promise<string> {
  const linha = (await banco.query<{ concluida_em: string }>(
    `UPDATE instalacao SET primeira_execucao_concluida_em=coalesce(primeira_execucao_concluida_em, clock_timestamp())
     WHERE id RETURNING ${iso('primeira_execucao_concluida_em')} AS concluida_em`)).rows[0];
  if (!linha) throw new Error('Tabela instalacao sem a linha única (migração 0026).');
  return linha.concluida_em;
}
