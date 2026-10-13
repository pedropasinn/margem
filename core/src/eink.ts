import { conferirPlanoNoModelo } from './conferir-plano';
/**
 * Roteiro do e-ink (Xteink X4 Pro, `docs/desenho/09-VISAO.md` §62): a apresentação `eink` do plano
 * (telas de texto do passo e, depois, uma tela de explicação) com o que o passo acende. Na tela de
 * texto, os elementos em foco ganham sublinhado e número; na de explicação, os mesmos números com o
 * enunciado, as ligações do passo (com a tela onde está o outro trecho) e a parada. Puro: não mede nada.
 */
import type { ApresentacaoDoPlanoV1, Bloco, Id, ModeloDoCapituloV1, PlanoPedagogicoV1, TipoRelacaoSemantica } from '@margem/contratos';

export interface GrifoNoEink { inicio: number; fim: number; numero: number; periferico: boolean }
export interface ItemDoPasso { numero: number; enunciado: string; periferico: boolean }
export interface LigacaoDoPasso { tipo: TipoRelacaoSemantica; explicacao: string; retrospectiva: boolean; citacao: string; tela: number | null }

export type TelaDoEink =
  | { tipo: 'texto'; passo: number; blocos: Pick<Bloco, 'id' | 'tipo' | 'texto'>[]; grifos: Record<Id, GrifoNoEink[]> }
  | { tipo: 'explicacao'; passo: number; texto: string; itens: ItemDoPasso[]; ligacoes: LigacaoDoPasso[]; parada: PlanoPedagogicoV1['passos'][number]['parada'] };

export function roteiroDoEink(
  apresentacao: ApresentacaoDoPlanoV1, plano: PlanoPedagogicoV1, modelo: ModeloDoCapituloV1 | null, blocos: readonly Pick<Bloco, 'id' | 'tipo' | 'texto'>[],
): TelaDoEink[] {
  if (apresentacao.plano_id !== plano.id) throw new Error('A apresentação pertence a outro plano.');
  const conferido = conferirPlanoNoModelo(plano, modelo, blocos);
  if (!conferido.ok) throw new Error(conferido.erros[0]!.mensagem);
  const porBloco = new Map(blocos.map((bloco) => [bloco.id, bloco]));
  const elementos = new Map((modelo?.elementos ?? []).map((elemento) => [elemento.id, elemento]));
  const relacoes = new Map((modelo?.relacoes ?? []).map((relacao) => [relacao.id, relacao]));
  const passos = new Map(plano.passos.map((passo) => [passo.ordem, passo]));
  // A tela de texto onde cada bloco aparece pela primeira vez: é para lá que uma ligação aponta.
  const telaDoBloco = new Map<Id, number>();
  apresentacao.telas.forEach((tela, indice) => {
    if (tela.tipo !== 'texto') return;
    for (const id of tela.blocos) if (!telaDoBloco.has(id)) telaDoBloco.set(id, indice);
  });
  return apresentacao.telas.map((tela) => {
    const passo = passos.get(tela.passo);
    const foco = (passo?.foco ?? []).flatMap((id) => { const elemento = elementos.get(id); return elemento ? [elemento] : []; });
    if (tela.tipo === 'texto') {
      const grifos: Record<Id, GrifoNoEink[]> = {};
      foco.forEach((elemento, posicao) => {
        for (const ancora of elemento.ancoras) {
          if (!tela.blocos.includes(ancora.bloco_id)) continue;
          (grifos[ancora.bloco_id] ??= []).push({ inicio: ancora.inicio_utf16, fim: ancora.fim_utf16, numero: posicao + 1, periferico: elemento.centralidade === 3 });
        }
      });
      for (const lista of Object.values(grifos)) lista.sort((a, b) => a.inicio - b.inicio);
      return { tipo: 'texto', passo: tela.passo, blocos: tela.blocos.flatMap((id) => { const bloco = porBloco.get(id); return bloco ? [bloco] : []; }), grifos };
    }
    const ligacoes = (passo?.relacoes ?? []).flatMap((id): LigacaoDoPasso[] => {
      const relacao = relacoes.get(id);
      if (!relacao) return [];
      const pontas = [relacao.origem_id, relacao.destino_id].map((item) => elementos.get(item));
      const fora = pontas.find((elemento) => elemento && !passo?.foco.includes(elemento.id)) ?? pontas[1];
      const ancora = fora?.ancoras.find(a => telaDoBloco.has(a.bloco_id)) ?? fora?.ancoras[0];
      return [{ tipo: relacao.tipo, explicacao: relacao.explicacao, retrospectiva: relacao.retrospectiva, citacao: ancora?.citacao ?? '', tela: ancora ? telaDoBloco.get(ancora.bloco_id) ?? null : null }];
    });
    return {
      tipo: 'explicacao', passo: tela.passo, texto: tela.texto ?? '',
      itens: foco.map((elemento, posicao) => ({ numero: posicao + 1, enunciado: elemento.enunciado, periferico: elemento.centralidade === 3 })),
      ligacoes, parada: passo?.parada ?? null,
    };
  });
}

/** O texto do bloco em trechos, com os grifos no lugar; grifos sobrepostos ficam com o primeiro. */
export function trechosDoBloco(texto: string, grifos: readonly GrifoNoEink[]): { texto: string; grifo: GrifoNoEink | null }[] {
  const trechos: { texto: string; grifo: GrifoNoEink | null }[] = [];
  let cursor = 0;
  for (const grifo of grifos) {
    if (grifo.inicio < cursor || grifo.fim > texto.length || grifo.fim <= grifo.inicio) continue;
    if (grifo.inicio > cursor) trechos.push({ texto: texto.slice(cursor, grifo.inicio), grifo: null });
    trechos.push({ texto: texto.slice(grifo.inicio, grifo.fim), grifo });
    cursor = grifo.fim;
  }
  if (cursor < texto.length) trechos.push({ texto: texto.slice(cursor), grifo: null });
  return trechos;
}

/** Como cada relação se lê numa tela de e-ink (ou num EPUB), com maiúscula: o verbo, da origem ao destino. */
export const ROTULO_DA_RELACAO_EINK: Record<TipoRelacaoSemantica, string> = {
  suporta: 'Sustenta', desenvolve: 'Desenvolve', pressupoe: 'Pressupõe', contrasta: 'Contrasta com', exemplifica: 'Exemplifica',
  retoma: 'Retoma', responde: 'Responde a', tensiona: 'Tensiona', ecoa: 'Ecoa',
};
