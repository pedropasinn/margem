/**
 * Onde moram os arquivos do usuário: originais, saídas da canonização e assets.
 *
 * Nenhum caminho vem do cliente. A API só compõe caminhos a partir de identificadores
 * ULID já validados e do `caminho` relativo que o motor gravou no próprio canônico.
 */
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz dos dados; `MARGEM_DADOS` sobrepõe (os testes usam um diretório temporário). */
export function raizDeDados(): string {
  const bruto = process.env.MARGEM_DADOS;
  return bruto !== undefined && bruto.trim() !== '' ? resolve(bruto) : join(homedir(), 'dados/margem');
}

/** Raiz do repositório, para achar `motor/.venv` e `prompts/` sem depender do cwd. */
export function raizDoRepositorio(): string {
  const bruto = process.env.MARGEM_RAIZ;
  if (bruto !== undefined && bruto.trim() !== '') return resolve(bruto);
  return fileURLToPath(new URL('../../', import.meta.url));
}

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function ehUlid(valor: string): boolean {
  return ULID.test(valor);
}

function exigirUlid(valor: string, papel: string): string {
  if (!ehUlid(valor)) throw new Error(`Identificador de ${papel} inválido.`);
  return valor;
}

export function pastaDoDocumento(documentoId: string): string {
  return join(raizDeDados(), exigirUlid(documentoId, 'documento'));
}

/** Saída da canonização enquanto o job roda: o nome carrega o job, não a versão. */
export function pastaDaCanonizacao(documentoId: string, jobId: string): string {
  return join(pastaDoDocumento(documentoId), `canonizacao-${exigirUlid(jobId, 'job')}`);
}

/** Tentativas concorrentes nunca compartilham saída, mesmo após expiração do lease. */
export function pastaDaTentativaDeCanonizacao(documentoId: string, jobId: string, token: string): string {
  return join(pastaDaCanonizacao(documentoId, jobId), `tentativa-${exigirUlid(token, 'concessão')}`);
}

/** Mesma saída depois que a versão foi publicada; é por aqui que os assets são servidos. */
export function pastaDaVersao(documentoId: string, versaoId: string): string {
  return join(pastaDoDocumento(documentoId), `versao-${exigirUlid(versaoId, 'versão')}`);
}

export const EXTENSAO_POR_FORMATO: Readonly<Record<string, string>> = {
  pdf: 'pdf', epub: 'epub', md: 'md', txt: 'txt', colado: 'txt',
};

export function caminhoDoOriginal(documentoId: string, formato: string): string {
  const extensao = EXTENSAO_POR_FORMATO[formato];
  if (extensao === undefined) throw new Error('Formato sem extensão conhecida.');
  return join(pastaDoDocumento(documentoId), `original.${extensao}`);
}

const NOMES_DE_ORIGINAL = new Set(Object.values(EXTENSAO_POR_FORMATO).map((extensao) => `original.${extensao}`));

/**
 * Onde está, na biblioteca atual, o original de um documento (D-04). `origem_caminho` guarda o
 * caminho absoluto de quando o original foi importado; com a biblioteca movida para outro disco ou
 * restaurada noutro computador, ele aponta para fora da raiz e `arquivoNosDados` o recusa (com razão).
 * O original gerenciado pelo app (`<raiz>/<id do documento>/original.<extensão>`) é refeito pela raiz
 * atual a partir do id; qualquer outro valor (registro de outra origem) volta como está, e a conferência
 * de caminho de quem o usa continua valendo.
 */
export function originalDoDocumento(documento: { id: string; origem_caminho: string }): string {
  const partes = documento.origem_caminho.split(/[\\/]/);
  const nome = partes.at(-1) ?? '';
  if (!ehUlid(documento.id) || partes.at(-2) !== documento.id || !NOMES_DE_ORIGINAL.has(nome)) return documento.origem_caminho;
  return join(pastaDoDocumento(documento.id), nome);
}

/**
 * Resolve um caminho relativo **dentro** de uma raiz. Recusa caminho absoluto, `..`
 * e qualquer resultado que escape da raiz — inclusive por link simbólico no nome.
 */
export function dentroDaRaiz(raiz: string, relativo: string): string | null {
  if (relativo === '' || isAbsolute(relativo) || relativo.includes('\0')) return null;
  if (relativo.split(/[\\/]/).some((parte) => parte === '..')) return null;
  const alvo = resolve(raiz, relativo);
  const base = resolve(raiz);
  return alvo === base || alvo.startsWith(base + sep) ? alvo : null;
}

const TIPO_POR_EXTENSAO: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf',
};

export function tipoDoArquivo(caminho: string): string {
  const extensao = caminho.slice(caminho.lastIndexOf('.') + 1).toLowerCase();
  return TIPO_POR_EXTENSAO[extensao] ?? 'application/octet-stream';
}
