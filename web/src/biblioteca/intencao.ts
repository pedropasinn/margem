/**
 * O que abrir ao chegar no leitor (Player v2, etapa 8): a página do documento leva cada item ao ponto
 * certo — um trecho, uma página do PDF, um exercício, um visual, ou uma ação do estudo (mapa, visita,
 * leitura comentada). Guardado na sessão, por documento e capítulo, e consumido uma vez pelo leitor.
 */
import type { AncoraV1 } from '@margem/contratos';

export interface IntencaoDeLeitura {
  documento_id: string;
  secao_id: string;
  ancora?: AncoraV1;
  /** Uma seção do capítulo (sumário): o bloco onde ela começa. */
  bloco?: string;
  /** Com `bloco`: o trecho exato dentro dele (a página Notas leva ao grifo, não só ao parágrafo). */
  faixa?: { inicio_utf16: number; fim_utf16: number };
  pagina?: number;
  /** Notas (J145): o grifo cujo balão abre (com `nota`, já no campo da nota). */
  marca?: string;
  nota?: boolean;
  /** Notas (J145): a conexão cujo painel abre, a relação da leitura que o Percorrer mostra, a conversa que reabre. */
  conexao?: string;
  relacao?: string;
  conversa?: string;
  resolucao?: string;
  visual?: string;
  acao?: 'mapa' | 'visita' | 'comentada' | 'resolvidos';
}
const CHAVE = 'margem:ao-abrir';

export function gravarIntencao(intencao: IntencaoDeLeitura): void {
  try { sessionStorage.setItem(CHAVE, JSON.stringify(intencao)); } catch { /* sem storage: abre só o capítulo */ }
}

export function consumirIntencao(documentoId: string, secaoId: string): IntencaoDeLeitura | null {
  try {
    const bruta = sessionStorage.getItem(CHAVE);
    if (!bruta) return null;
    const intencao = JSON.parse(bruta) as IntencaoDeLeitura;
    if (intencao.documento_id !== documentoId || intencao.secao_id !== secaoId) return null;
    sessionStorage.removeItem(CHAVE);
    return intencao;
  } catch { return null; }
}

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * Link de fora (a nota do Obsidian): `/ler/<documento>/<capítulo>?bloco=<bloco>` abre o capítulo já no
 * trecho. Devolve a intenção e o caminho sem a consulta, ou `null` quando a URL não é dessas.
 */
export function intencaoDaUrl(caminho: string, busca: string): { intencao: IntencaoDeLeitura; caminho: string } | null {
  const achado = /^\/ler\/([^/]+)\/([^/]+)\/?$/.exec(caminho);
  const bloco = new URLSearchParams(busca).get('bloco');
  if (!achado?.[1] || !achado[2] || bloco === null || ![achado[1], achado[2], bloco].every((id) => ULID.test(id))) return null;
  return { intencao: { documento_id: achado[1], secao_id: achado[2], bloco }, caminho: `/ler/${achado[1]}/${achado[2]}` };
}
