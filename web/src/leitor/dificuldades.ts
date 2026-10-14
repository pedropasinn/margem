/**
 * O sinal de dificuldade no leitor (J138, modelo D): à parte do grifo — não é cor, função nem etiqueta.
 * O Codex sugere (`ModeloDoCapituloV1.dificuldades`); o leitor confirma ou descarta, ou marca a dele (já
 * confirmada). Aqui as duas fontes viram uma lista só, por trecho do capítulo.
 */
import type { AncoraV1, DificuldadeTextualV1, DificuldadeV1, EstadoDaDificuldade, Id, TipoDificuldadeTextual } from '@margem/contratos';

export interface SinalDeDificuldade {
  /** Estável na tela: a dificuldade do Codex (o id dela no modelo) ou a linha gravada do leitor. */
  chave: string;
  ancora: AncoraV1;
  origem: 'codex' | 'leitor';
  estado: EstadoDaDificuldade;
  tipo?: TipoDificuldadeTextual | undefined;
  descricao?: string | undefined;
  marca_id?: Id | undefined;
  /** A linha gravada (do leitor, ou a decisão sobre a do Codex), quando há. */
  gravada?: DificuldadeV1 | undefined;
  /** A dificuldade do modelo, para decidir (confirmar ou descartar) a do Codex. */
  codex?: { modelo_id: Id; dificuldade_id: Id } | undefined;
  /** A do Codex que está na análise aberta: a execução e o capítulo, para apagá-la de vez (V-T8). */
  analise?: { execucao_id: Id; secao_id: Id } | undefined;
}

/**
 * As do capítulo: as do Codex (com a decisão do leitor, se houver) e as do leitor. Só entram as que têm
 * âncora num bloco do capítulo.
 */
export function sinaisDoCapitulo(modelo: { id: Id; execucao_id?: Id; secao_id?: Id; dificuldades: readonly DificuldadeTextualV1[] } | null, gravadas: readonly DificuldadeV1[],
  versaoId: Id, blocos: readonly { id: Id }[]): SinalDeDificuldade[] {
  const noCapitulo = (ancora: AncoraV1) => ancora.versao_id === versaoId && blocos.some((bloco) => bloco.id === ancora.bloco_id);
  const doCodex = (modelo?.dificuldades ?? []).flatMap((d): SinalDeDificuldade[] => {
    const ancora = d.ancoras.find(noCapitulo);
    if (!ancora) return [];
    const decisao = gravadas.find((g) => g.codex?.dificuldade_id === d.id);
    return [{ chave: `codex-${d.id}`, ancora, origem: 'codex', estado: decisao?.estado ?? 'sugerida', tipo: d.tipo, descricao: d.descricao,
      gravada: decisao, codex: decisao?.codex ?? { modelo_id: modelo!.id, dificuldade_id: d.id },
      ...(modelo?.execucao_id && modelo.secao_id ? { analise: { execucao_id: modelo.execucao_id, secao_id: modelo.secao_id } } : {}) }];
  });
  // Decisões sobre dificuldades de outro modelo (outra revisão) ainda valem pelo trecho gravado.
  const decididasForaDoModelo = gravadas.filter((g) => g.origem === 'codex' && !doCodex.some((s) => s.gravada?.id === g.id) && noCapitulo(g.ancora))
    .map((g): SinalDeDificuldade => ({ chave: `gravada-${g.id}`, ancora: g.ancora, origem: 'codex', estado: g.estado, tipo: g.tipo, descricao: g.descricao, gravada: g, codex: g.codex, marca_id: g.marca_id }));
  const doLeitor = gravadas.filter((g) => g.origem === 'leitor' && noCapitulo(g.ancora))
    .map((g): SinalDeDificuldade => ({ chave: `gravada-${g.id}`, ancora: g.ancora, origem: 'leitor', estado: g.estado, tipo: g.tipo, marca_id: g.marca_id, gravada: g }));
  return [...doCodex, ...decididasForaDoModelo, ...doLeitor];
}

/** O sinal cruza o trecho (mesmo bloco, faixas que se tocam). */
export function cruza(a: AncoraV1, b: AncoraV1): boolean {
  return a.versao_id === b.versao_id && a.bloco_id === b.bloco_id && a.inicio_utf16 < b.fim_utf16 && b.inicio_utf16 < a.fim_utf16;
}

/**
 * Quais aparecem no texto: com as marcas à vista (V-T3), as sugeridas do Codex e as confirmadas; com as
 * marcas ocultas, nenhuma. As descartadas nunca (ficam gravadas).
 */
export function sinaisVisiveis(sinais: readonly SinalDeDificuldade[], marcasAVista: boolean): SinalDeDificuldade[] {
  if (!marcasAVista) return [];
  return sinais.filter((s) => s.estado === 'confirmada' || s.estado === 'sugerida');
}
