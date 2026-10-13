/**
 * Apresentação do plano pedagógico por dispositivo (J30, `docs/desenho/10-MODELO-DO-CAPITULO.md` §7).
 * Pura e determinística: o dispositivo decide quanto cabe numa tela e onde vai a explicação; nunca
 * cria, junta ou remove passos.
 *
 * - `desktop`: por passo, uma tela de texto (os blocos em foco) e a explicação longa ao lado;
 * - `eink`: por passo, telas de texto de até `caracteres_por_tela` (quebra em fronteira de bloco) e uma
 *   tela com a explicação curta e o que observar;
 * - `audio`: por passo, a narração dos blocos e o comentário do professor (explicação curta e parada).
 */
import type { ApresentacaoDoPlanoV1, Bloco, Dispositivo, Id, PlanoPedagogicoV1, TelaDaApresentacaoV1 } from '@margem/contratos';

export const CARACTERES_POR_TELA_EINK = 1_800;
const TEXTO_MAXIMO = 8_000;

export interface OpcoesDaApresentacao { caracteres_por_tela?: number }

const grafemas = new Intl.Segmenter('pt', { granularity: 'grapheme' });
/** Mantém o orçamento UTF-16, mas corta apenas entre grafemas; reticência declara a redução. */
function limitar(texto: string): string {
  if (texto.length <= TEXTO_MAXIMO) return texto;
  let fim = 0;
  for (const parte of grafemas.segment(texto)) {
    const proximo = parte.index + parte.segment.length;
    if (proximo > TEXTO_MAXIMO - 1) break;
    fim = proximo;
  }
  return `${texto.slice(0, fim)}…`;
}

function blocosDoPasso(ordem: readonly Pick<Bloco, 'id' | 'texto'>[], inicio: Id, fim: Id): Pick<Bloco, 'id' | 'texto'>[] {
  const a = ordem.findIndex((bloco) => bloco.id === inicio);
  const b = ordem.findIndex((bloco) => bloco.id === fim);
  if (a === -1 || b === -1 || b < a) throw new Error(`Passo com faixa fora do capítulo: ${inicio}–${fim}.`);
  return ordem.slice(a, b + 1);
}

/** Agrupa blocos em telas de até `limite` caracteres, sem partir bloco. */
export function agruparEmTelas(blocos: readonly Pick<Bloco, 'id' | 'texto'>[], limite: number): Id[][] {
  const telas: Id[][] = [];
  let atual: Id[] = [];
  let tamanho = 0;
  for (const bloco of blocos) {
    if (atual.length > 0 && tamanho + bloco.texto.length > limite) {
      telas.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(bloco.id);
    tamanho += bloco.texto.length;
  }
  if (atual.length > 0) telas.push(atual);
  return telas;
}

export function apresentarPlano(
  plano: PlanoPedagogicoV1, blocosDoCapitulo: readonly Pick<Bloco, 'id' | 'texto'>[], dispositivo: Dispositivo, opcoes: OpcoesDaApresentacao = {},
): ApresentacaoDoPlanoV1 {
  const telas: TelaDaApresentacaoV1[] = [];
  for (const passo of plano.passos) {
    const blocos = blocosDoPasso(blocosDoCapitulo, passo.bloco_inicio, passo.bloco_fim);
    const ids = blocos.map((bloco) => bloco.id);
    switch (dispositivo) {
      case 'desktop':
        telas.push({ passo: passo.ordem, tipo: 'texto', blocos: ids, texto: null });
        telas.push({ passo: passo.ordem, tipo: 'explicacao', blocos: [], texto: limitar(`${passo.explicacao.longa}\n\n${passo.observar}`) });
        break;
      case 'eink':
        for (const grupo of agruparEmTelas(blocos, opcoes.caracteres_por_tela ?? CARACTERES_POR_TELA_EINK)) {
          telas.push({ passo: passo.ordem, tipo: 'texto', blocos: grupo, texto: null });
        }
        telas.push({ passo: passo.ordem, tipo: 'explicacao', blocos: [], texto: limitar(`${passo.explicacao.curta}\n\nObserve: ${passo.observar}`) });
        break;
      case 'audio':
        telas.push({ passo: passo.ordem, tipo: 'narracao', blocos: ids, texto: null });
        telas.push({
          passo: passo.ordem, tipo: 'comentario', blocos: [],
          texto: limitar([passo.explicacao.curta, passo.parada?.texto].filter((parte): parte is string => parte !== undefined).join(' ')),
        });
        break;
    }
  }
  return { versao: 1, plano_id: plano.id, dispositivo, telas };
}
