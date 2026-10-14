/**
 * Modelos que a conta da pessoa oferece no Codex (V-T10).
 *
 * Fonte: `codex debug models`, que devolve o catálogo da conta em JSON (renova pela rede com o login
 * da pessoa e cai no catálogo embutido sem rede). Se o comando falhar, o Margem lê o cache que o
 * próprio Codex guarda em `$CODEX_HOME/models_cache.json`. Só entram os modelos que o Codex lista
 * no `/model` (`visibility: "list"`), na ordem dele (`priority`).
 *
 * O resultado fica em `preferencia_geral` (chave `catalogo_de_modelos`) e só é buscado de novo
 * quando a pessoa pede "Atualizar a lista": a tela de Configurações não abre o Codex a cada visita.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ambienteSaneado } from '../executor/ambiente.js';
import { codexCli } from '../plataforma/executaveis.js';

export const CHAVE_DO_CATALOGO = 'catalogo_de_modelos';

export interface ModeloDaConta {
  id: string;
  nome: string;
  descricao: string;
  /** Esforços aceitos pelo modelo (`low`, `medium`, `high`, …). */
  esforcos: string[];
}

export interface CatalogoDeModelos {
  obtido_em: string;
  /** `conta`: `codex debug models`; `cache_do_codex`: `models_cache.json`. */
  origem: 'conta' | 'cache_do_codex';
  modelos: ModeloDaConta[];
}

/** Executa a CLI e devolve a saída padrão; injetável nos testes (nenhum teste abre o Codex). */
export type ExecutarCodex = (argumentos: readonly string[]) => Promise<{ codigo: number; saida: string }>;
export type LerArquivo = (caminho: string) => Promise<string>;

export interface FontesDoCatalogo {
  executar?: ExecutarCodex;
  lerArquivo?: LerArquivo;
  ambiente?: Record<string, string>;
  agora?: () => Date;
}

const executarPadrao: ExecutarCodex = (argumentos) => new Promise((resolver) => {
  execFile(codexCli(), [...argumentos], { env: ambienteSaneado(), timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
    (erro, saida) => {
      const codigo = erro ? (typeof erro.code === 'number' ? erro.code : 1) : 0;
      resolver({ codigo, saida: typeof saida === 'string' ? saida : '' });
    });
});

const ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const texto = (valor: unknown, teto: number): string => (typeof valor === 'string' ? valor.trim().slice(0, teto) : '');

/** Lê o JSON do catálogo do Codex (`{ models: [...] }`); qualquer formato estranho dá lista vazia. */
export function lerCatalogoDoCodex(json: string): ModeloDaConta[] {
  let bruto: unknown;
  try { bruto = JSON.parse(json); } catch { return []; }
  const lista = typeof bruto === 'object' && bruto !== null ? (bruto as { models?: unknown }).models : undefined;
  if (!Array.isArray(lista)) return [];
  const modelos: (ModeloDaConta & { prioridade: number })[] = [];
  for (const item of lista as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const m = item as Record<string, unknown>;
    if (typeof m.slug !== 'string' || !ID_VALIDO.test(m.slug) || m.visibility !== 'list') continue;
    if (modelos.some((outro) => outro.id === m.slug)) continue;
    const niveis = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels as unknown[] : [];
    const esforcos = niveis
      .map((nivel) => (typeof nivel === 'object' && nivel !== null ? (nivel as { effort?: unknown }).effort : undefined))
      .filter((esforco): esforco is string => typeof esforco === 'string' && /^[a-z]{1,16}$/u.test(esforco));
    modelos.push({
      id: m.slug, nome: texto(m.display_name, 80) || m.slug, descricao: texto(m.description, 200), esforcos,
      prioridade: typeof m.priority === 'number' ? m.priority : Number.MAX_SAFE_INTEGER,
    });
  }
  return modelos.sort((a, b) => a.prioridade - b.prioridade).map((modelo) => ({ id: modelo.id, nome: modelo.nome, descricao: modelo.descricao, esforcos: modelo.esforcos }));
}

/** Busca na conta; sem resposta útil, o cache do Codex; sem ele, `null`. */
export async function buscarCatalogo(fontes: FontesDoCatalogo = {}): Promise<CatalogoDeModelos | null> {
  const { executar = executarPadrao, lerArquivo = (caminho) => readFile(caminho, 'utf8'), ambiente = ambienteSaneado(), agora = () => new Date() } = fontes;
  try {
    const { codigo, saida } = await executar(['debug', 'models']);
    const modelos = codigo === 0 ? lerCatalogoDoCodex(saida) : [];
    if (modelos.length > 0) return { obtido_em: agora().toISOString(), origem: 'conta', modelos };
  } catch {
    // Segue para o cache do Codex.
  }
  const casa = ambiente.CODEX_HOME ?? join(ambiente.HOME ?? homedir(), '.codex');
  try {
    const modelos = lerCatalogoDoCodex(await lerArquivo(join(casa, 'models_cache.json')));
    if (modelos.length > 0) return { obtido_em: agora().toISOString(), origem: 'cache_do_codex', modelos };
  } catch {
    // Sem cache.
  }
  return null;
}

type Consultavel = Pick<pg.ClientBase, 'query'>;

export async function catalogoGuardado(cliente: Consultavel): Promise<CatalogoDeModelos | null> {
  const linha = (await cliente.query<{ valor: CatalogoDeModelos }>('SELECT valor FROM preferencia_geral WHERE chave=$1', [CHAVE_DO_CATALOGO])).rows[0];
  const valor = linha?.valor;
  if (!valor || !Array.isArray(valor.modelos) || typeof valor.obtido_em !== 'string') return null;
  return valor;
}

export async function guardarCatalogo(cliente: Consultavel, catalogo: CatalogoDeModelos): Promise<void> {
  await cliente.query(`INSERT INTO preferencia_geral (chave, valor) VALUES ($1, $2)
    ON CONFLICT (chave) DO UPDATE SET valor=excluded.valor, atualizada_em=clock_timestamp()`, [CHAVE_DO_CATALOGO, JSON.stringify(catalogo)]);
}
