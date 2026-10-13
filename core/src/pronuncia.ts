/**
 * Pronúncia antes da síntese de voz (J92; pendência do J91: a voz lia "Waterfall", "SWEBOK" e siglas
 * com o sotaque do modelo). Determinístico e puro: o texto do livro não muda, só o que a voz recebe.
 *
 * 1. Some o que não se lê em voz alta: "(link)", URLs.
 * 2. Glossário: termos em inglês e siglas que se dizem como palavra, na forma falada em português.
 * 3. Siglas em maiúsculas (2–6 letras) fora do glossário: soletradas com o nome das letras.
 * 4. Numeração de seção ("1.2") vira "1 ponto 2"; "etc." vira "etcétera".
 *
 * O glossário é editável: `GLOSSARIO_DE_PRONUNCIA` (termo → forma falada; a busca ignora maiúsculas,
 * salvo nas siglas, que só casam em maiúsculas).
 */

/** Nome das letras em português, para soletrar siglas. */
const LETRAS: Record<string, string> = {
  A: 'á', B: 'bê', C: 'cê', D: 'dê', E: 'é', F: 'éfe', G: 'gê', H: 'agá', I: 'i', J: 'jota', K: 'cá', L: 'éle', M: 'ême',
  N: 'ene', O: 'ó', P: 'pê', Q: 'quê', R: 'érre', S: 'ésse', T: 'tê', U: 'u', V: 'vê', W: 'dáblio', X: 'xis', Y: 'ípsilon', Z: 'zê',
};

/**
 * Termos com a forma falada. Chaves em minúsculas casam sem distinguir maiúsculas (palavras em
 * inglês); chaves em maiúsculas só casam em maiúsculas (siglas ditas como palavra ou com leitura
 * consagrada). Plural em "s" é tratado à parte para as siglas ("IDEs").
 */
export const GLOSSARIO_DE_PRONUNCIA: Readonly<Record<string, string>> = {
  // Siglas com leitura consagrada.
  IEEE: 'i três é',
  SWEBOK: 'suíbóqui',
  OTAN: 'Otan',
  COBOL: 'Cobol',
  ADA: 'Ada',
  NASA: 'Nasa',
  JUnit: 'djêi iúnit',
  // Termos em inglês comuns em livros de computação.
  waterfall: 'uóter fól',
  refactoring: 'rifáctorin',
  framework: 'frêimuôrk',
  frameworks: 'frêimuôrks',
  stakeholder: 'isteique rôlder',
  stakeholders: 'isteique rôlders',
  deployment: 'diplóimen',
  kanban: 'cã-bã',
  scrum: 'iscrâm',
  hardware: 'rárduer',
  engineering: 'endjiníring',
  society: 'sossáieti',
  knowledge: 'nóledj',
  body: 'bódi',
  mocks: 'móques',
  github: 'guit rrâb',
  google: 'gúgol',
  web: 'uéb',
};

const SIGLA = /^[A-Z]{2,6}$/u;

/** Soletra uma sigla ("UML" → "u ême éle"); com "s" final de plural, "IDEs" → "i dê és". */
export function soletrar(sigla: string): string {
  return [...sigla].map((letra) => LETRAS[letra] ?? letra).join(' ');
}

function trocarPalavra(palavra: string, glossario: Readonly<Record<string, string>>): string {
  // Exata: siglas (chave em maiúsculas) e palavras em minúsculas.
  if (Object.hasOwn(glossario, palavra)) return glossario[palavra]!;
  // "Waterfall" no começo da frase casa com "waterfall".
  const minuscula = palavra.toLowerCase();
  if (/^[A-Z][a-z]+$/u.test(palavra) && Object.hasOwn(glossario, minuscula)) return glossario[minuscula]!;
  if (SIGLA.test(palavra)) return soletrar(palavra);
  // Plural de sigla: "IDEs", "MVPs".
  if (/^[A-Z]{2,6}s$/u.test(palavra)) {
    const base = palavra.slice(0, -1);
    return Object.hasOwn(glossario, base) ? `${glossario[base]!}s` : `${soletrar(base)}s`;
  }
  return palavra;
}

/** O texto que a voz recebe para um trecho do livro ou uma fala do professor. */
export function textoFalado(texto: string, glossario: Readonly<Record<string, string>> = GLOSSARIO_DE_PRONUNCIA): string {
  const limpo = texto
    .replace(/\s*\((?:link|links)\)/giu, '')
    .replace(/https?:\/\/\S+/gu, '')
    .replace(/\betc\./gu, 'etcétera')
    .replace(/\b(\d{1,2})\.(\d{1,2})(?!\d)(?!\.\d)/gu, '$1 ponto $2');
  return limpo
    .replace(/[\p{L}][\p{L}\p{M}'’-]*/gu, (palavra) => trocarPalavra(palavra, glossario))
    .replace(/\s+/gu, ' ')
    .trim();
}
