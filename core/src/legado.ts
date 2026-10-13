import type { Bloco, CanonicoV1, MarcaGeradaV1, MarcasLegadoV1 } from '@margem/contratos';
import { validarMarcaGerada } from '@margem/contratos';
import { ancoraDeSelecao, resolverSubfaixas, type BlocoDeVersao } from './ancoras';

export type MotivoDoLegado = 'vazia' | 'ausente' | 'ambigua' | 'invalida' | 'sublinhar_parcial';

export interface MarcaLegadaNaoResolvida {
  id: string;
  motivo: MotivoDoLegado;
}

export interface ConversaoDoLegado {
  marcas: MarcaGeradaV1[];
  nao_resolvidas: MarcaLegadaNaoResolvida[];
}

/** `pagina_pdf` do legado → página do canônico, quando a extração foi refeita com outra paginação. */
export type MapaDePaginas = ReadonlyMap<number, number>;

/** MarcaGeradaV1 não carrega versão; a âncora aqui serve só para extrair prefixo e sufixo. */
const SEM_VERSAO = '';

function paginasDoBloco(bloco: Bloco): number[] {
  return bloco.origens.filter((origem) => origem.tipo === 'pdf').map((origem) => origem.pagina);
}

function ocorrencias(texto: string, citacao: string): number[] {
  const posicoes: number[] = [];
  for (let at = texto.indexOf(citacao); at !== -1; at = texto.indexOf(citacao, at + 1)) posicoes.push(at);
  return posicoes;
}

/**
 * Converte marcas do formato legado em MarcaGeradaV1 localizando a citação nos blocos do
 * canônico. A página do PDF só desempata entre blocos candidatos; citação repetida sem
 * desempate fica como `ambigua`, nunca resolvida em silêncio. Só mapeia: persistir é do J06.
 */
export function deMarcasLegado(
  canonico: CanonicoV1,
  marcasLegado: MarcasLegadoV1,
  mapaPaginas?: MapaDePaginas,
): ConversaoDoLegado {
  const marcas: MarcaGeradaV1[] = [];
  const nao_resolvidas: MarcaLegadaNaoResolvida[] = [];
  for (const legada of marcasLegado.marcas) {
    if (!legada.citacao) {
      nao_resolvidas.push({ id: legada.id, motivo: 'vazia' });
      continue;
    }
    let achados = canonico.blocos.flatMap((bloco) =>
      ocorrencias(bloco.texto, legada.citacao).map((inicio) => ({ bloco, inicio })));
    if (achados.length === 0) {
      nao_resolvidas.push({ id: legada.id, motivo: 'ausente' });
      continue;
    }
    if (achados.length > 1) {
      const pagina = mapaPaginas?.get(legada.pagina_pdf) ?? legada.pagina_pdf;
      const naPagina = achados.filter((achado) => paginasDoBloco(achado.bloco).includes(pagina));
      if (naPagina.length !== 1) {
        nao_resolvidas.push({ id: legada.id, motivo: 'ambigua' });
        continue;
      }
      achados = naPagina;
    }
    const achado = achados[0];
    if (!achado) continue;
    const blocoDeVersao: BlocoDeVersao = { id: achado.bloco.id, texto: achado.bloco.texto, versao_id: SEM_VERSAO };
    const ancora = ancoraDeSelecao(blocoDeVersao, achado.inicio, achado.inicio + legada.citacao.length);
    const { subfaixas, nao_resolvidas: termosPerdidos } = resolverSubfaixas(blocoDeVersao, ancora, legada.sublinhar);
    const perdidos = new Set(termosPerdidos.map((termo) => termo.texto));
    const marca: MarcaGeradaV1 = {
      bloco_id: achado.bloco.id,
      citacao: legada.citacao,
      prefixo: ancora.prefixo,
      sufixo: ancora.sufixo,
      funcao: legada.funcao,
      sublinhar: legada.sublinhar.filter((termo) => !perdidos.has(termo)),
      comentario: legada.comentario,
    };
    if (!validarMarcaGerada(marca)) {
      nao_resolvidas.push({ id: legada.id, motivo: 'invalida' });
      continue;
    }
    marcas.push(marca);
    if (subfaixas.length !== legada.sublinhar.length) nao_resolvidas.push({ id: legada.id, motivo: 'sublinhar_parcial' });
  }
  return { marcas, nao_resolvidas };
}
