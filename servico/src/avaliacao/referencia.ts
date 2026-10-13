/**
 * Referência de avaliação (J32, `docs/desenho/10-MODELO-DO-CAPITULO.md` §12): o que o leitor anota num
 * capítulo que conhece bem, num markdown simples, com citações literais.
 *
 *   # Referência · Mixtape cap. 3 · argumentativa
 *   documento: <ULID>
 *   secao: <ULID>
 *
 *   ## Essenciais
 *   - A · tese · “Conditioning on a collider opens a backdoor path”
 *   - F · hipotese · “Admitamos inicialmente que” · antes: “Capítulo 3. ”
 *
 *   ## Relações
 *   - A -> K · desenvolve
 *
 *   ## Retrospectivas
 *   - F
 *
 *   ## Dificuldades textuais
 *   - H · premissa_implicita · “…”
 *
 *   ## Não deveria marcar
 *   - C · “…”
 *
 * `antes:` e `depois:` são prefixo e sufixo opcionais, para desambiguar uma citação repetida.
 * As citações se resolvem pelo mesmo `localizarCitacao` do resto do sistema.
 */
import type { AncoraV1, Bloco, Id } from '@margem/contratos';
import { localizarCitacao } from '@margem/contratos';

export interface ItemCitado { rotulo: string; tipo: string | null; citacao: string; prefixo: string; sufixo: string; linha: number }
export interface ReferenciaDeAvaliacao {
  titulo: string;
  documento_id: Id | null;
  secao_id: Id | null;
  essenciais: ItemCitado[];
  relacoes: { origem: string; destino: string; tipo: string | null; linha: number }[];
  retrospectivas: { rotulo: string; linha: number }[];
  dificuldades: ItemCitado[];
  nao_marcar: ItemCitado[];
}

export class ReferenciaInvalida extends Error {
  constructor(public readonly problemas: string[]) {
    super(`Referência inválida:\n${problemas.map((item) => `  - ${item}`).join('\n')}`);
    this.name = 'ReferenciaInvalida';
  }
}

type Secao = 'essenciais' | 'relacoes' | 'retrospectivas' | 'dificuldades' | 'nao_marcar';
const SECOES: Record<string, Secao> = {
  essenciais: 'essenciais', 'relações': 'relacoes', relacoes: 'relacoes', retrospectivas: 'retrospectivas',
  'dificuldades textuais': 'dificuldades', dificuldades: 'dificuldades', 'não deveria marcar': 'nao_marcar', 'nao deveria marcar': 'nao_marcar',
};

const ASPAS = /[“"]([^”"]+)[”"]/u;
function extrairAspas(texto: string): string | null { return ASPAS.exec(texto)?.[1] ?? null; }

function itemCitado(corpo: string, linha: number, comTipo: boolean, problemas: string[]): ItemCitado | null {
  const partes = corpo.split(' · ').map((parte) => parte.trim());
  const rotulo = partes[0] ?? '';
  const citacaoParte = partes.find((parte, indice) => indice > 0 && /^[“"]/u.test(parte));
  const citacao = citacaoParte === undefined ? null : extrairAspas(citacaoParte);
  if (rotulo === '' || citacao === null) { problemas.push(`linha ${String(linha)}: use “- R · ${comTipo ? 'tipo · ' : ''}“citação””.`); return null; }
  const tipo = comTipo ? (partes[1] !== undefined && !/^[“"]/u.test(partes[1]) ? partes[1] : null) : null;
  const antes = partes.find((parte) => parte.startsWith('antes:'));
  const depois = partes.find((parte) => parte.startsWith('depois:'));
  return {
    rotulo, tipo, citacao, linha,
    prefixo: antes === undefined ? '' : extrairAspas(antes) ?? '', sufixo: depois === undefined ? '' : extrairAspas(depois) ?? '',
  };
}

export function lerReferencia(texto: string): ReferenciaDeAvaliacao {
  const referencia: ReferenciaDeAvaliacao = {
    titulo: '', documento_id: null, secao_id: null, essenciais: [], relacoes: [], retrospectivas: [], dificuldades: [], nao_marcar: [],
  };
  const problemas: string[] = [];
  let secao: Secao | null = null;
  texto.split('\n').forEach((bruta, indice) => {
    const linha = indice + 1;
    const conteudo = bruta.trim();
    if (conteudo === '') return;
    if (conteudo.startsWith('# ')) { referencia.titulo = conteudo.slice(2).trim(); return; }
    if (conteudo.startsWith('## ')) {
      const nome = conteudo.slice(3).trim().toLocaleLowerCase('pt-BR');
      secao = SECOES[nome] ?? null;
      if (secao === null) problemas.push(`linha ${String(linha)}: seção desconhecida “${conteudo.slice(3).trim()}”.`);
      return;
    }
    const campo = /^(documento|secao|seção):\s*(\S+)$/u.exec(conteudo);
    if (campo) { if (campo[1] === 'documento') referencia.documento_id = campo[2] ?? null; else referencia.secao_id = campo[2] ?? null; return; }
    if (!conteudo.startsWith('- ')) return;
    const corpo = conteudo.slice(2).trim();
    switch (secao) {
      case 'essenciais': case 'dificuldades': case 'nao_marcar': {
        const item = itemCitado(corpo, linha, secao !== 'nao_marcar', problemas);
        if (item) referencia[secao].push(item);
        return;
      }
      case 'relacoes': {
        const casado = /^(\S+)\s*->\s*(\S+)(?:\s*·\s*(\S+))?$/u.exec(corpo);
        if (!casado) { problemas.push(`linha ${String(linha)}: use “- A -> K · tipo”.`); return; }
        referencia.relacoes.push({ origem: casado[1] ?? '', destino: casado[2] ?? '', tipo: casado[3] ?? null, linha });
        return;
      }
      case 'retrospectivas':
        referencia.retrospectivas.push({ rotulo: corpo.split(' · ')[0]?.trim() ?? corpo, linha });
        return;
      default:
        problemas.push(`linha ${String(linha)}: item fora de uma seção conhecida.`);
    }
  });
  const rotulos = new Set([...referencia.essenciais, ...referencia.dificuldades, ...referencia.nao_marcar].map((item) => item.rotulo));
  for (const relacao of referencia.relacoes) {
    for (const ponta of [relacao.origem, relacao.destino]) if (!rotulos.has(ponta)) problemas.push(`linha ${String(relacao.linha)}: ${ponta} não foi definido com citação.`);
  }
  for (const item of referencia.retrospectivas) if (!rotulos.has(item.rotulo)) problemas.push(`linha ${String(item.linha)}: ${item.rotulo} não foi definido com citação.`);
  if (problemas.length > 0) throw new ReferenciaInvalida(problemas);
  return referencia;
}

export interface ItemResolvido extends ItemCitado { ancora: AncoraV1 }
export interface ReferenciaResolvida {
  essenciais: ItemResolvido[];
  dificuldades: ItemResolvido[];
  nao_marcar: ItemResolvido[];
  relacoes: ReferenciaDeAvaliacao['relacoes'];
  retrospectivas: string[];
}

/** Cada citação precisa aparecer uma única vez nos blocos do capítulo; senão é erro com a linha. */
export function resolverReferencia(referencia: ReferenciaDeAvaliacao, versaoId: Id, blocos: readonly Pick<Bloco, 'id' | 'texto'>[]): ReferenciaResolvida {
  const problemas: string[] = [];
  const resolver = (item: ItemCitado): ItemResolvido | null => {
    const achados = blocos.flatMap((bloco) => {
      const local = localizarCitacao(bloco, item.citacao, item.prefixo, item.sufixo);
      if (local.tipo === 'unica') return [{ bloco, inicio: local.inicio_utf16, fim: local.fim_utf16 }];
      if (local.tipo === 'ambigua') return [{ bloco, inicio: -1, fim: -1 }, { bloco, inicio: -1, fim: -1 }];
      return [];
    });
    const [achado] = achados;
    if (!achado) { problemas.push(`linha ${String(item.linha)}: “${item.citacao}” não aparece no capítulo.`); return null; }
    if (achados.length > 1) { problemas.push(`linha ${String(item.linha)}: “${item.citacao}” aparece mais de uma vez; acrescente “antes:” ou “depois:”.`); return null; }
    return {
      ...item,
      ancora: { versao_id: versaoId, bloco_id: achado.bloco.id, inicio_utf16: achado.inicio, fim_utf16: achado.fim, citacao: item.citacao, prefixo: item.prefixo, sufixo: item.sufixo },
    };
  };
  const lista = (itens: readonly ItemCitado[]) => itens.map(resolver).filter((item): item is ItemResolvido => item !== null);
  const saida = {
    essenciais: lista(referencia.essenciais), dificuldades: lista(referencia.dificuldades), nao_marcar: lista(referencia.nao_marcar),
    relacoes: referencia.relacoes, retrospectivas: referencia.retrospectivas.map((item) => item.rotulo),
  };
  if (problemas.length > 0) throw new ReferenciaInvalida(problemas);
  return saida;
}
