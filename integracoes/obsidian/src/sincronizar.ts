/**
 * "Margem: sincronizar", no formato 2 (uma nota por item, numa pasta por documento). A mescla e a
 * sincronização são as de `core/src/obsidian.ts`, as mesmas do app de computador; aqui fica só o
 * cliente HTTP da API do Margem:
 *
 * - `GET /api/obsidian/v2/indice` — `IndiceObsidianV2`: uma entrada por nota, com o sha256;
 * - `GET /api/obsidian/v2/documentos/:id` — as notas de um documento, com o conteúdo.
 */
import type { ClienteDoMargemV2, IndiceDoMargemV2, NotaGeradaV2 } from '../../../core/src/obsidian';

export {
  FIM_GERENCIADO, INICIO_GERENCIADO, juntarCaminho, margemIdDaNota, mesclarNota, resumoDoRelatorio, sincronizarV2,
  type CofreDaSincronizacao, type EstadoDaSincronizacao, type IndiceDoMargemV2, type RelatorioDaSincronizacao,
} from '../../../core/src/obsidian';

export interface OpcoesDoCliente {
  servidor: string;
  marcas: 'minhas' | 'todas';
  /** Também os documentos sem nada do leitor (só a nota-índice). */
  todos: boolean;
}

/** Faz um GET e devolve o texto (o plugin usa o `requestUrl` do Obsidian; os testes, um falso). */
export type Pedir = (url: string) => Promise<string>;

/** A consulta comum: as marcas, os documentos sem notas e o endereço do Margem nos links de volta. */
export function consulta(opcoes: OpcoesDoCliente): string {
  const parametros = new URLSearchParams({ marcas: opcoes.marcas, base: opcoes.servidor });
  if (opcoes.todos) parametros.set('todos', '1');
  return parametros.toString();
}

export function clienteDoMargem(opcoes: OpcoesDoCliente, pedir: Pedir): ClienteDoMargemV2 {
  const servidor = opcoes.servidor.trim().replace(/\/+$/, '');
  const comum = consulta({ ...opcoes, servidor });
  return {
    indice: async () => JSON.parse(await pedir(`${servidor}/api/obsidian/v2/indice?${comum}`)) as IndiceDoMargemV2,
    documento: async (documentoId) => {
      const corpo = JSON.parse(await pedir(`${servidor}/api/obsidian/v2/documentos/${encodeURIComponent(documentoId)}?${comum}`)) as { notas?: unknown };
      if (!Array.isArray(corpo.notas)) throw new Error('O Margem não devolveu as notas do documento.');
      return { notas: corpo.notas as NotaGeradaV2[] };
    },
  };
}
