import type { IdentificacaoDaObraV1 } from '@margem/contratos';
import { pedir } from '../biblioteca/api';
import type { AnaliseDoQuadro, DetalheDoQuadro, ListaDeQuadros, ManifestoDaNarracao, QuadroDaPessoaV1 } from './tipos';

const segmento = (valor: string): string => encodeURIComponent(valor);

export function listarQuadros(): Promise<ListaDeQuadros> {
  return pedir('/api/arte');
}
/** Envia a imagem de uma obra (`arquivo`) e, se houver, `titulo`, `artista` e `ano` (J118). */
export function adicionarObra(formulario: FormData): Promise<QuadroDaPessoaV1> {
  return pedir('/api/arte', { method: 'POST', body: formulario });
}
export function corrigirIdentificacao(slug: string, identificacao: IdentificacaoDaObraV1): Promise<QuadroDaPessoaV1> {
  return pedir(`/api/arte/${segmento(slug)}/identificacao`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identificacao) });
}
export function tentarObraDeNovo(slug: string): Promise<QuadroDaPessoaV1> {
  return pedir(`/api/arte/${segmento(slug)}/tentar-de-novo`, { method: 'POST' });
}
export function removerObra(slug: string): Promise<null> {
  return pedir(`/api/arte/${segmento(slug)}`, { method: 'DELETE' });
}

/** Operações de escrita da área de Quadros; os testes trocam. */
export interface OperacoesDosQuadros {
  adicionar: typeof adicionarObra;
  corrigir: typeof corrigirIdentificacao;
  tentarDeNovo: typeof tentarObraDeNovo;
  remover: typeof removerObra;
}
export const OPERACOES_DOS_QUADROS: OperacoesDosQuadros = { adicionar: adicionarObra, corrigir: corrigirIdentificacao, tentarDeNovo: tentarObraDeNovo, remover: removerObra };

export function obterQuadro(slug: string): Promise<DetalheDoQuadro> {
  return pedir(`/api/arte/${segmento(slug)}`);
}
export function obterAnaliseDoQuadro(slug: string, rotulo: string): Promise<AnaliseDoQuadro> {
  return pedir(`/api/arte/${segmento(slug)}/analises/${segmento(rotulo)}`);
}
export function obterNarracaoDoQuadro(slug: string, rotulo: string): Promise<ManifestoDaNarracao> {
  return pedir(`/api/arte/${segmento(slug)}/audio/${segmento(rotulo)}/manifesto.json`);
}
export function arquivoDaNarracaoDoQuadro(slug: string, rotulo: string): string {
  return `/api/arte/${segmento(slug)}/audio/${segmento(rotulo)}/narracao.mp3`;
}

/** Quadros já abertos neste aparelho (para "Não abertos" e "Última leitura" na Biblioteca). */
const CHAVE_DOS_VISTOS = 'margem:quadros:vistos';
export function quadrosVistos(): Record<string, string> {
  try {
    const bruto: unknown = JSON.parse(localStorage.getItem(CHAVE_DOS_VISTOS) ?? '{}');
    return typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto) ? bruto as Record<string, string> : {};
  } catch { return {}; }
}
export function marcarQuadroVisto(slug: string): void {
  try { localStorage.setItem(CHAVE_DOS_VISTOS, JSON.stringify({ ...quadrosVistos(), [slug]: new Date().toISOString() })); } catch { /* sem storage */ }
}
