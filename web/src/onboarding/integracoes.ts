/**
 * Pontos de entrada da extensão de navegador e da integração com o Obsidian.
 *
 * As duas existem (`extensao/` e `integracoes/obsidian/`), mas ainda não estão publicadas em loja.
 * Sem endereço, o cartão leva à página de ajuda interna com a instalação manual. Quando houver
 * um endereço (Chrome Web Store, plugin da comunidade), basta definir `VITE_MARGEM_EXTENSAO_URL` /
 * `VITE_MARGEM_OBSIDIAN_URL` no build: o cartão passa a mostrar o link, sem mudar código.
 */

export type NomeDaIntegracao = 'extensao' | 'obsidian';

export interface Integracao {
  nome: NomeDaIntegracao;
  titulo: string;
  resumo: string;
  icone: string;
  /** Endereço externo (loja, plugin) quando existir; sem ele, o cartão leva à ajuda interna. */
  link: string | null;
}

function endereco(valor: unknown): string | null {
  return typeof valor === 'string' && /^https:\/\//.test(valor) ? valor : null;
}

export function integracoes(ambiente: Record<string, unknown> = import.meta.env): Integracao[] {
  return [
    { nome: 'extensao', titulo: 'Extensão de navegador', icone: 'navegador',
      resumo: 'Mandar para o Margem o artigo aberto no navegador, com um clique.',
      link: endereco(ambiente['VITE_MARGEM_EXTENSAO_URL']) },
    { nome: 'obsidian', titulo: 'Obsidian', icone: 'caderno',
      resumo: 'Levar suas marcas e notas para o cofre do Obsidian, ligadas ao trecho.',
      link: endereco(ambiente['VITE_MARGEM_OBSIDIAN_URL']) },
  ];
}
