import { createHash } from 'node:crypto';
import { hashEstrutural } from '@margem/contratos';
import type { Bloco, CanonicoV1, MarcaV1 } from '@margem/contratos';
import type { BlocoDeVersao } from '../src/ancoras';

/** ULIDs determinísticos para os testes: 26 caracteres Crockford maiúsculos começando em 0. */
export function id(numero: number): string {
  return String(numero).padStart(26, '0');
}

export const VERSAO = id(20);

export function blocoDeVersao(texto: string, numero = 1): BlocoDeVersao {
  return { id: id(numero), texto, versao_id: VERSAO };
}

export function bloco(texto: string, inline: Bloco['inline'] = [], numero = 1): Pick<Bloco, 'id' | 'texto' | 'inline'> {
  return { id: id(numero), texto, inline };
}

export function marca(parcial: Partial<MarcaV1> & Pick<MarcaV1, 'ancora'>): MarcaV1 {
  return {
    id: id(50),
    funcao: 'tese',
    subfaixas: [],
    comentario: null,
    origem: 'parte',
    validade: 'resolvida',
    visivel: true,
    avaliacao: 'nao_avaliada',
    criada_em: '2026-09-20T18:00:00Z',
    ...parcial,
  };
}

/** Canônico mínimo e válido a partir de blocos já prontos (hash calculado pelos contratos). */
export function canonicoDe(blocos: Bloco[]): CanonicoV1 {
  return {
    versao: 1,
    documento: { titulo: 'Fixture', idioma: 'pt-BR', formato: 'pdf', sha256_original: createHash('sha256').update(blocos.map((b) => b.texto).join('\n\n'), 'utf8').digest('hex') },
    canonizacao: { motor: 'fixture-j02', gerado_em: '2026-09-20T18:00:00Z' },
    hash_estrutural: hashEstrutural(blocos),
    secoes: [],
    blocos,
    assets: [],
    limites: [],
  };
}

export function blocoPdf(texto: string, pagina: number, numero: number): Bloco {
  return {
    id: id(numero),
    ordem: numero,
    tipo: 'paragrafo',
    texto,
    inline: [],
    origens: [{ tipo: 'pdf', pagina, bbox: [0, 0, 100, 100] }],
  };
}
