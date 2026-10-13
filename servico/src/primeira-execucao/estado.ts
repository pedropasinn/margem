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
import { join } from 'node:path';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { ambienteSaneado } from '../executor/ambiente.js';
import { raizDoRepositorio } from '../dados.js';
import { verificarCodex, type EstadoDoCodex } from './codex.js';

export interface EstadoDoMotor { ok: boolean }

export interface EstadoDaInstalacao {
  versao: 1;
  banco: { ok: boolean };
  motor: EstadoDoMotor;
  /** `executor: 'falso'` (testes, demonstração): o Codex não é necessário. */
  codex: EstadoDoCodex & { executor: 'codex' | 'falso' };
  /** Há leitura esperando a cota da conta voltar; `volta_em` é a estimativa mais tardia anunciada. */
  cota: { esgotada: boolean; volta_em: string | null };
  primeira_execucao: { concluida: boolean; concluida_em: string | null; exemplo_documento_id: Id | null };
  /** Banco, motor e Codex prontos para ler (o Codex logado, ou o executor falso). */
  pronto: boolean;
}

/** O motor importa (com as dependências do venv) num subprocesso curto e sem rede. */
export function verificarMotor(raiz = raizDoRepositorio()): Promise<EstadoDoMotor> {
  return new Promise((resolver) => {
    execFile(join(raiz, 'motor/.venv/bin/python'), ['-c', 'import margem_motor.ingest'],
      { cwd: join(raiz, 'motor'), env: ambienteSaneado(), timeout: 20_000 },
      (erro) => { resolver({ ok: erro === null }); });
  });
}

export interface Verificadores {
  codex: () => Promise<EstadoDoCodex>;
  motor: () => Promise<EstadoDoMotor>;
  executor: () => 'codex' | 'falso';
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

export async function lerEstadoDaInstalacao(
  banco: pg.Pool, verificadores: Verificadores,
): Promise<EstadoDaInstalacao> {
  const [linha, motor, codex] = await Promise.all([lerDoBanco(banco), verificadores.motor(), verificadores.codex()]);
  const executor = verificadores.executor();
  const codexPronto = executor === 'falso' || (codex.encontrado && codex.compativel && codex.logado === true);
  return {
    versao: 1,
    banco: { ok: linha !== null },
    motor,
    codex: { ...codex, executor },
    cota: { esgotada: linha?.esgotada ?? false, volta_em: linha?.volta_em ?? null },
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
