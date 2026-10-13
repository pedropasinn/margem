/**
 * Aliases internos em texto livre (J76). O modelo vê `B007`, `L10`, `R03`, `D02`, `U1` e as refs `n1` que ele
 * mesmo cria; o resolvedor já os traduz nas referências, mas eles escapavam para o que o leitor lê: o
 * comentário de uma marca, a explicação de uma relação, um passo do plano (bancada-50: T08, T13, T27, T28).
 *
 * `traduzirAliasesNoTexto` troca cada alias conhecido por um trecho do que ele nomeia, entre aspas (o começo
 * do bloco, a citação do elemento, o título da unidade); `retirarAliases` é a rede de segurança sem a
 * tabela (a projeção): tira o alias com a preposição que o introduz. Um token que aparece no texto do
 * capítulo ("U2", "L10" do próprio autor) nunca é tocado.
 */
import type { DificuldadeTextualV1, ElementoSemanticoV1, Id, RelacaoSemanticaV1, UnidadeDeLeituraV1 } from '@margem/contratos';
import type { AliasesDoPrompt } from '@margem/core';

const FORMA = String.raw`(?:B\d{3}|[LRD]\d{2}|U\d{1,2}|n\d{1,3})`;
const ANTES = String.raw`(?<![\p{L}\p{N}_-])`;
const DEPOIS = String.raw`(?![\p{L}\p{N}_-])`;
/** Com preposição opcional antes e parênteses opcionais em volta. */
const COM_PREPOSICAO = new RegExp(String.raw`(?:(\s+)(em|no|na|de|do|da|por|pelo|pela|com|cf\.|ver)\s+)?\(?${ANTES}(${FORMA})${DEPOIS}\)?`, 'gu');
const SO_O_TOKEN = new RegExp(`${ANTES}${FORMA}${DEPOIS}`, 'u');

export function temAlias(texto: string): boolean { return SO_O_TOKEN.test(texto); }

function noCapitulo(token: string, textoDoCapitulo: string): boolean {
  return new RegExp(`${ANTES}${token}${DEPOIS}`, 'u').test(textoDoCapitulo);
}

function arrumar(texto: string): string {
  return texto.replace(/\s+([,.;:!?)])/gu, '$1').replace(/\(\s*\)/gu, '').replace(/[ \t]{2,}/gu, ' ').trim();
}

/** Tira os aliases (e a preposição que os introduz) que não são texto do capítulo. Refs `n…` ficam: sem a tabela, podem ser notação. */
export function retirarAliases(texto: string, textoDoCapitulo: string): string {
  if (!temAlias(texto)) return texto;
  const saida = texto.replace(COM_PREPOSICAO, (trecho: string, _espaco: string | undefined, _prep: string | undefined, token: string) =>
    (token.startsWith('n') || noCapitulo(token, textoDoCapitulo) ? trecho : ''));
  return arrumar(saida);
}

const PALAVRAS_DO_TRECHO = 6;
/** Começo de um texto, até seis palavras, entre aspas. */
export function trechoEntreAspas(texto: string): string {
  const palavras = texto.replace(/\s+/gu, ' ').trim().split(' ');
  const inicio = palavras.slice(0, PALAVRAS_DO_TRECHO).join(' ').replace(/[,;:.]$/u, '');
  return `“${inicio}${palavras.length > PALAVRAS_DO_TRECHO ? '…' : ''}”`;
}

export interface FontesDosAliases {
  aliases: AliasesDoPrompt;
  /** Texto dos blocos que o prompt mostrou. */
  blocos: ReadonlyMap<Id, { texto: string }>;
  elemento: (id: Id) => ElementoSemanticoV1 | undefined;
  relacao?: (id: Id) => RelacaoSemanticaV1 | undefined;
  dificuldade?: (id: Id) => DificuldadeTextualV1 | undefined;
  unidade?: (id: Id) => UnidadeDeLeituraV1 | undefined;
  /** Refs `n…` criadas nesta resposta → id. */
  novos?: ReadonlyMap<string, Id>;
  /** Todo o texto do capítulo: um token que aparece nele não é alias. */
  textoDoCapitulo: string;
}

function nomear(token: string, fontes: FontesDosAliases): string | undefined {
  const citacaoDo = (id: Id | undefined): string | undefined => {
    const elemento = id === undefined ? undefined : fontes.elemento(id);
    const ancora = elemento?.ancoras[0];
    return ancora ? trechoEntreAspas(ancora.citacao) : undefined;
  };
  switch (token[0]) {
    case 'B': {
      const id = fontes.aliases.blocos.id(token);
      const bloco = id === undefined ? undefined : fontes.blocos.get(id);
      return bloco ? `o trecho ${trechoEntreAspas(bloco.texto)}` : undefined;
    }
    case 'L': return citacaoDo(fontes.aliases.elementos.id(token));
    case 'n': return citacaoDo(fontes.novos?.get(token));
    case 'R': {
      const id = fontes.aliases.relacoes.id(token);
      const relacao = id === undefined ? undefined : fontes.relacao?.(id);
      const origem = citacaoDo(relacao?.origem_id);
      const destino = citacaoDo(relacao?.destino_id);
      return origem && destino ? `a relação entre ${origem} e ${destino}` : undefined;
    }
    case 'D': {
      const id = fontes.aliases.dificuldades.id(token);
      const ancora = id === undefined ? undefined : fontes.dificuldade?.(id)?.ancoras[0];
      return ancora ? trechoEntreAspas(ancora.citacao) : undefined;
    }
    case 'U': {
      const id = fontes.aliases.unidades.id(token);
      const unidade = id === undefined ? undefined : fontes.unidade?.(id);
      return unidade ? `“${unidade.titulo}”` : undefined;
    }
    default: return undefined;
  }
}

/**
 * Troca cada alias por um trecho entre aspas do que ele nomeia ("em B007" → "em o trecho “Dividindo…”" vira
 * "no trecho “Dividindo…”"). Alias sem objeto some com a preposição; ref `n…` desconhecida fica (pode ser notação).
 */
export function traduzirAliasesNoTexto(texto: string, fontes: FontesDosAliases): string {
  if (!temAlias(texto)) return texto;
  const saida = texto.replace(COM_PREPOSICAO, (trecho: string, espaco: string | undefined, prep: string | undefined, token: string) => {
    if (noCapitulo(token, fontes.textoDoCapitulo)) return trecho;
    const nome = nomear(token, fontes);
    if (nome === undefined) return token.startsWith('n') ? trecho : '';
    const parenteses = trecho.trimEnd().endsWith(')') && trecho.includes(`(${token}`);
    const corpo = parenteses ? `(${nome})` : nome;
    if (prep === undefined) return trecho.replace(parenteses ? `(${token})` : token, corpo);
    return `${espaco ?? ' '}${contrair(prep, corpo)}`;
  });
  return arrumar(saida);
}

const BASE_DA_PREPOSICAO: Record<string, string> = { em: 'em', no: 'em', na: 'em', de: 'de', do: 'de', da: 'de', por: 'por', pelo: 'por', pela: 'por' };
const CONTRACOES: Record<string, Record<'o' | 'a', string>> = { em: { o: 'no', a: 'na' }, de: { o: 'do', a: 'da' }, por: { o: 'pelo', a: 'pela' } };

/** Preposição + nome com artigo ("o trecho", "a relação") vira a contração: "em B007" → "no trecho “…”". */
function contrair(preposicao: string, nome: string): string {
  const artigo = nome.startsWith('o ') ? 'o' : nome.startsWith('a ') ? 'a' : null;
  const base = BASE_DA_PREPOSICAO[preposicao];
  if (base === undefined) return `${preposicao} ${nome}`;
  if (artigo === null) return `${base} ${nome}`;
  const contraida = CONTRACOES[base]?.[artigo];
  return contraida === undefined ? `${preposicao} ${nome}` : `${contraida} ${nome.slice(2)}`;
}
