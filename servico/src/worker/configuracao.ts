/**
 * Monta a configuração da leitura (J06) a partir dos prompts versionados em disco.
 *
 * `MARGEM_EXECUTOR=falso` com `MARGEM_ROTEIRO=<arquivo>` troca o `codex exec` pelo
 * executor falso e determinístico do J05. É assim que a API e o worker são exercitados
 * de ponta a ponta sem gastar uma única chamada real ao Codex.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { executarCodex } from '../executor/codex.js';
import { confinamentoPadrao } from '../executor/confinamento.js';
import { criarExecutorFalso, carregarRoteiro } from '../executor/fake.js';
import type { Executor } from '../executor/tipos.js';
import type { ConfiguracaoDaLeitura } from '../leitura/manipuladores.js';
import type { ConfiguracaoDaCompreensao } from '../compreensao/pipeline.js';
import { raizDoRepositorio } from '../dados.js';

export const MODELO_PADRAO = 'gpt-5.6-sol';
export const ESFORCO_PADRAO = 'high';
/**
 * `MARGEM_MODELO=conta` (J19): a CLI roda sem `-m` e usa o modelo padrão da conta
 * (`~/.codex/config.toml`). A execução grava `conta` como pedido e o modelo que a CLI
 * anunciar como o efetivo.
 */
export const MODELO_DA_CONTA = 'conta';

/** Base opcional dos artefatos (`MARGEM_ARTEFATOS`): leitura, respostas e saídas conferidas do executor. */
export function baseDosArtefatos(ambiente: NodeJS.ProcessEnv = process.env): string | undefined {
  const base = ambiente.MARGEM_ARTEFATOS;
  return base === undefined || base.trim() === '' ? undefined : base;
}

export function caminhoDoPrompt(nome: string, raiz = raizDoRepositorio()): string {
  return join(raiz, 'prompts', nome);
}

function ler(nome: string, raiz: string): string {
  return readFileSync(caminhoDoPrompt(nome, raiz), 'utf8');
}

export async function escolherExecutor(): Promise<Executor> {
  if (process.env.MARGEM_EXECUTOR !== 'falso') {
    const base = baseDosArtefatos();
    // O motor só enxerga o diretório da execução (confinamento.ts); sem bwrap, não roda.
    const confinamento = confinamentoPadrao();
    return (pedido) => {
      const { modelo, ...resto } = pedido;
      return executarCodex({
        ...resto,
        ...(modelo === undefined || modelo === MODELO_DA_CONTA ? {} : { modelo }),
        ...(pedido.diretorioArtefatos === undefined && base !== undefined ? { diretorioArtefatos: join(base, 'artefatos') } : {}),
      }, { confinamento });
    };
  }
  const caminho = process.env.MARGEM_ROTEIRO;
  if (caminho === undefined || caminho === '') throw new Error('MARGEM_EXECUTOR=falso exige MARGEM_ROTEIRO.');
  return criarExecutorFalso(await carregarRoteiro(caminho));
}

export interface OpcoesDaConfiguracao {
  banco: pg.Pool;
  executor: Executor;
  raiz?: string;
  modelo?: string;
  esforco?: string;
  diretorioArtefatos?: string;
}

export function configuracaoDaLeitura(opcoes: OpcoesDaConfiguracao): ConfiguracaoDaLeitura {
  const raiz = opcoes.raiz ?? raizDoRepositorio();
  return {
    banco: opcoes.banco,
    executor: opcoes.executor,
    versoes: { metodo_versao: 'metodo@1', prompt_versao: 'leitor-de-parte@1', schema_versao: 1 },
    textos: {
      metodo: ler('metodo-leitor.md', raiz),
      prompt: ler('leitor-de-parte@1.md', raiz),
      schema: ler('leitor-de-parte@1.schema.json', raiz),
    },
    caminhoSchemaLeitor: caminhoDoPrompt('leitor-de-parte@1.schema.json', raiz),
    revisao: {
      metodo: ler('metodo-leitor.md', raiz),
      prompt: ler('revisao-consistencia@1.md', raiz),
      schema: ler('revisao-consistencia@1.schema.json', raiz),
      caminhoSchema: caminhoDoPrompt('revisao-consistencia@1.schema.json', raiz),
    },
    modelo: opcoes.modelo ?? process.env.MARGEM_MODELO ?? MODELO_PADRAO,
    esforco: opcoes.esforco ?? process.env.MARGEM_ESFORCO ?? ESFORCO_PADRAO,
    ...(opcoes.diretorioArtefatos === undefined
      ? (baseDosArtefatos() === undefined ? {} : { diretorioArtefatos: join(baseDosArtefatos() ?? '', 'leitura') })
      : { diretorioArtefatos: opcoes.diretorioArtefatos }),
  };
}

/** Esforço do plano pedagógico (§11 do desenho 10): `MARGEM_ESFORCO_PLANO`, padrão `medium`. */
export const ESFORCO_DO_PLANO_PADRAO = 'medium';

/**
 * Esforço dos visuais (J70, imagem e fluxograma): `MARGEM_ESFORCO_VISUAL`, padrão `medium`
 * (regra do projeto de 28/09: medium por padrão; high só quando a tarefa exige muita precisão).
 * As leituras continuam com `ESFORCO_PADRAO`.
 */
export const ESFORCO_DOS_VISUAIS_PADRAO = 'medium';

export function esforcoDosVisuais(ambiente: NodeJS.ProcessEnv = process.env): string {
  const valor = ambiente.MARGEM_ESFORCO_VISUAL;
  return valor === undefined || valor.trim() === '' ? ESFORCO_DOS_VISUAIS_PADRAO : valor.trim();
}

/** Compreensão do capítulo (J29): mesmo executor, modelo e esforço das leituras; o plano com esforço próprio. */
export function configuracaoDaCompreensao(
  opcoes: { banco: pg.Pool; executor: Executor; modelo?: string; esforco?: string }, ambiente: NodeJS.ProcessEnv = process.env,
): ConfiguracaoDaCompreensao {
  return {
    banco: opcoes.banco, executor: opcoes.executor,
    modelo: opcoes.modelo ?? ambiente.MARGEM_MODELO ?? MODELO_PADRAO,
    esforco: opcoes.esforco ?? ambiente.MARGEM_ESFORCO ?? ESFORCO_PADRAO,
    esforcoDoPlano: ambiente.MARGEM_ESFORCO_PLANO ?? ESFORCO_DO_PLANO_PADRAO,
    profundidadeDoPrefetch: profundidadeDoPrefetch(ambiente),
  };
}

/** `MARGEM_PREFETCH`: quantos capítulos adiante preparar, de 0 a 5; padrão 1 (o seguinte). */
export function profundidadeDoPrefetch(ambiente: NodeJS.ProcessEnv = process.env): number {
  const valor = Number.parseInt(ambiente.MARGEM_PREFETCH ?? '', 10);
  return Number.isInteger(valor) && valor >= 0 && valor <= 5 ? valor : 1;
}

/** Esforço das falas da leitura comentada (J92): `MARGEM_ESFORCO_LEITURA_COMENTADA`, padrão `medium`. */
export function esforcoDaLeituraComentada(ambiente: NodeJS.ProcessEnv = process.env): string {
  const valor = ambiente.MARGEM_ESFORCO_LEITURA_COMENTADA;
  return valor === undefined || valor.trim() === '' ? 'medium' : valor.trim();
}

/** Esforço do roteiro da visita guiada (J91): `MARGEM_ESFORCO_VISITA`, padrão `medium`. */
export const ESFORCO_DA_VISITA_PADRAO = 'medium';
export function esforcoDaVisita(ambiente: NodeJS.ProcessEnv = process.env): string {
  const valor = ambiente.MARGEM_ESFORCO_VISITA;
  return valor === undefined || valor.trim() === '' ? ESFORCO_DA_VISITA_PADRAO : valor.trim();
}
