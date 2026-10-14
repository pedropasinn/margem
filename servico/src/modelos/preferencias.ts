/**
 * Escolha de modelo e esforço por categoria (V-T10), guardada em `preferencia_geral` (chave `modelos`).
 *
 * `null` é "Padrão do Margem". Ao ler, qualquer coisa fora do formato (categoria desconhecida, modelo
 * com caractere estranho, esforço fora de baixo/médio/alto) é ignorada e a categoria volta ao padrão:
 * uma preferência inválida nunca chega à linha de comando do Codex.
 */
import type pg from 'pg';
import { CATEGORIAS, ESFORCOS, idDeCategoria, type Esforco, type IdDaCategoria } from './categorias.js';

/** Pool ou transação: só a consulta interessa. */
type Consultavel = Pick<pg.ClientBase, 'query'>;

export const CHAVE_DAS_PREFERENCIAS = 'modelos';

export interface EscolhaDaCategoria {
  modelo: string | null;
  esforco: Esforco | null;
}

export type EscolhasDeModelo = Partial<Record<IdDaCategoria, EscolhaDaCategoria>>;

/** Nome de modelo aceito: letras, números, ponto, hífen, sublinhado e dois-pontos; até 64. */
const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

export function modeloValido(valor: unknown): valor is string {
  return typeof valor === 'string' && MODELO_VALIDO.test(valor) && valor !== 'conta';
}

export function esforcoValido(valor: unknown): valor is Esforco {
  return typeof valor === 'string' && (ESFORCOS as readonly string[]).includes(valor);
}

export class PreferenciaInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'PreferenciaInvalida';
  }
}

/** O que está gravado, já limpo: só categorias conhecidas, com escolha válida e não vazia. */
export function normalizarEscolhas(bruto: unknown): EscolhasDeModelo {
  const escolhas: EscolhasDeModelo = {};
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return escolhas;
  for (const [id, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (!idDeCategoria(id) || typeof valor !== 'object' || valor === null) continue;
    const { modelo, esforco } = valor as Record<string, unknown>;
    const escolha: EscolhaDaCategoria = { modelo: modeloValido(modelo) ? modelo : null, esforco: esforcoValido(esforco) ? esforco : null };
    if (escolha.modelo !== null || escolha.esforco !== null) escolhas[id] = escolha;
  }
  return escolhas;
}

export async function lerEscolhas(cliente: Consultavel): Promise<EscolhasDeModelo> {
  const linha = (await cliente.query<{ valor: { categorias?: unknown } }>('SELECT valor FROM preferencia_geral WHERE chave=$1', [CHAVE_DAS_PREFERENCIAS])).rows[0];
  return normalizarEscolhas(linha?.valor.categorias);
}

/**
 * Grava a escolha das categorias enviadas (as outras ficam como estavam). Aqui o formato é cobrado:
 * a tela recebe 422 em vez de ver a escolha sumir em silêncio.
 */
export async function gravarEscolhas(cliente: Consultavel, mudancas: unknown): Promise<EscolhasDeModelo> {
  if (typeof mudancas !== 'object' || mudancas === null || Array.isArray(mudancas)) throw new PreferenciaInvalida('Use { "categorias": { "<categoria>": { "modelo", "esforco" } } }.');
  const atuais = await lerEscolhas(cliente);
  for (const [id, valor] of Object.entries(mudancas as Record<string, unknown>)) {
    if (!idDeCategoria(id)) throw new PreferenciaInvalida(`Categoria desconhecida: ${id}.`);
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new PreferenciaInvalida(`Escolha inválida em ${id}.`);
    const { modelo = null, esforco = null, ...resto } = valor as Record<string, unknown>;
    if (Object.keys(resto).length > 0) throw new PreferenciaInvalida(`Campos desconhecidos em ${id}: ${Object.keys(resto).join(', ')}.`);
    const nomeDoModelo = typeof modelo === 'string' ? modelo.trim() : modelo;
    if (nomeDoModelo !== null && nomeDoModelo !== '' && !modeloValido(nomeDoModelo)) throw new PreferenciaInvalida('Nome de modelo inválido: use letras, números, ponto ou hífen.');
    if (esforco !== null && !esforcoValido(esforco)) throw new PreferenciaInvalida('O esforço é baixo (low), médio (medium) ou alto (high).');
    const escolha: EscolhaDaCategoria = { modelo: nomeDoModelo === '' || nomeDoModelo === null ? null : nomeDoModelo, esforco: esforco };
    if (escolha.modelo === null && escolha.esforco === null) delete atuais[id];
    else atuais[id] = escolha;
  }
  await cliente.query(`INSERT INTO preferencia_geral (chave, valor) VALUES ($1, $2)
    ON CONFLICT (chave) DO UPDATE SET valor=excluded.valor, atualizada_em=clock_timestamp()`,
  [CHAVE_DAS_PREFERENCIAS, JSON.stringify({ categorias: atuais })]);
  return atuais;
}

/** Ordem da tela, para quem lista as escolhas. */
export const ORDEM_DAS_CATEGORIAS: readonly IdDaCategoria[] = CATEGORIAS.map((categoria) => categoria.id);
