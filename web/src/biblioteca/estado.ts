import type { FuncaoContada, ItemDaBiblioteca } from './tipos';

/** Frase curta para o estado do documento, do jeito que o SPEC pede que apareça. */
export function fraseDoEstado(item: ItemDaBiblioteca): string {
  switch (item.estado) {
    case 'sem_texto': return 'sem texto';
    case 'canonizando': return 'preparando o texto';
    case 'transcrevendo': return 'transcrevendo as páginas';
    case 'marcando': return `marcando ${item.detalhe ?? `${String(item.partes_prontas)} de ${String(item.partes_total)}`}`;
    case 'revisando': return 'revisando';
    // A preparação da leitura (compreensão): "preparando · capítulo 2 de 9".
    case 'preparando': return item.detalhe === null ? 'preparando a leitura' : `preparando · ${item.detalhe}`;
    case 'falhou': return `falhou: ${item.detalhe ?? 'motivo não registrado'}`;
    default: return item.detalhe === null ? 'texto disponível' : `texto disponível · última falha: ${item.detalhe}`;
  }
}

/**
 * As funções contadas, na ordem do modo e sem as zeradas: as de qualquer modo (`por_funcao`, J107);
 * de uma API anterior, só as de F1 que ela conhecia.
 */
export function funcoesDasMarcas(item: Pick<ItemDaBiblioteca, 'marcas'>): FuncaoContada[] {
  if (item.marcas.por_funcao) return item.marcas.por_funcao.filter((funcao) => funcao.quantidade > 0);
  const antigas: [keyof Omit<ItemDaBiblioteca['marcas'], 'por_funcao' | 'total'>, string][] = [
    ['tese', 'Tese'], ['conceito', 'Conceito'], ['justificativa', 'Justificativa'], ['nenhuma', 'Sem função'],
  ];
  return antigas.filter(([chave]) => item.marcas[chave] > 0)
    .map(([funcao, rotulo]) => ({ funcao, rotulo, quantidade: item.marcas[funcao] }));
}

/** Contagem por função ("16 hipótese · 21 resultado"), omitindo as que estão zeradas. */
export function frasesDasMarcas(item: Pick<ItemDaBiblioteca, 'marcas'>): string[] {
  return funcoesDasMarcas(item).map((funcao) => `${String(funcao.quantidade)} ${funcao.rotulo.toLocaleLowerCase('pt-BR')}`);
}

export function fraseDoProgresso(item: ItemDaBiblioteca): string | null {
  if (item.progresso === null) return null;
  const capitulos = item.progresso.capitulos_concluidos;
  return capitulos === 0 ? 'leitura começada' : `${String(capitulos)} capítulo(s) concluído(s)`;
}
