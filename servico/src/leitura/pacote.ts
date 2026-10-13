import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Bloco, CanonicoV1, Id } from '@margem/contratos';
import { sha256 } from '../executor/artefato.js';

/** JSON compacto com chaves ordenadas; mesma pré-imagem estável dos contratos. */
function serializarEstavel(valor: unknown): string {
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'string') return JSON.stringify(valor);
  if (typeof valor === 'number' && Number.isFinite(valor)) return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(serializarEstavel).join(',')}]`;
  if (typeof valor === 'object') {
    return `{${Object.entries(valor).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([chave, item]) => `${JSON.stringify(chave)}:${serializarEstavel(item)}`).join(',')}}`;
  }
  throw new Error('Valor não representável em JSON.');
}

/** Delimitadores dos blocos numerados. O texto do bloco fica entre as duas marcas, intacto. */
export const ABRE_BLOCO = '⟦b:';
export const FECHA_BLOCO = '⟦/b⟧';
export const MARCA_SECAO = '⟦s:';

export interface VersoesDoPacote {
  metodo_versao: string;
  prompt_versao: string;
  /** 1 = `leitor-de-parte@1` (F1); 2 = `leitor-de-parte@2`, por modo (J19); 3 = compreensão (J29). Só entra no hash. */
  schema_versao: 1 | 2 | 3;
}

/** Parte antes de ganhar id e hash: o suficiente para montar a entrada. */
export interface EsbocoDeParte {
  ordem: number;
  blocos_responsaveis: Id[];
  blocos_contexto: Id[];
  continuidade_anterior?: string;
}

export interface TextosDoPacote {
  /** Conteúdo de `prompts/metodo-leitor.md`. */
  metodo: string;
  /** Conteúdo de `prompts/leitor-de-parte@1.md`. */
  prompt: string;
  /** Conteúdo de `prompts/leitor-de-parte@1.schema.json`. */
  schema: string;
}

export interface ArquivoDoPacote {
  nome: string;
  conteudo: string;
  /** Arquivos voláteis ficam fora do `hash_entrada`. */
  volatil?: boolean;
}

export interface Pacote {
  arquivos: ArquivoDoPacote[];
  hash_entrada: string;
  /** Instrução que vai por argumento para o executor. */
  prompt: string;
}

function blocoPorId(canonico: CanonicoV1): Map<Id, Bloco> {
  return new Map(canonico.blocos.map((bloco) => [bloco.id, bloco]));
}

function exigirBloco(mapa: ReadonlyMap<Id, Bloco>, id: Id): Bloco {
  const bloco = mapa.get(id);
  if (!bloco) throw new Error(`Bloco ${id} não pertence a esta versão do texto.`);
  return bloco;
}

/**
 * Texto da parte em blocos numerados. Nenhuma página, nenhum offset, nenhuma coordenada:
 * o modelo devolve `bloco_id` e a citação literal; quem resolve posição é o serviço.
 */
export function textoDosBlocos(canonico: CanonicoV1, esboco: EsbocoDeParte): string {
  const mapa = blocoPorId(canonico);
  const ordemNoCanonico = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  const contexto = new Set(esboco.blocos_contexto);
  const ids = [...esboco.blocos_responsaveis, ...esboco.blocos_contexto]
    .sort((a, b) => (ordemNoCanonico.get(a) ?? 0) - (ordemNoCanonico.get(b) ?? 0));
  const linhas: string[] = [];
  for (const id of ids) {
    const bloco = exigirBloco(mapa, id);
    const rotulo = contexto.has(id) ? `contexto · ${bloco.tipo}` : bloco.tipo;
    linhas.push(`${ABRE_BLOCO}${bloco.id}⟧ [${rotulo}]`, bloco.texto, FECHA_BLOCO, '');
  }
  return linhas.join('\n');
}

/** Estrutura do documento, com os identificadores de seção que a resposta pode ecoar. */
export function sumarioDoDocumento(canonico: CanonicoV1, esboco: EsbocoDeParte): string {
  const ordemNoCanonico = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  const daParte = new Set([...esboco.blocos_responsaveis, ...esboco.blocos_contexto]
    .map((id) => ordemNoCanonico.get(id))
    .filter((indice): indice is number => indice !== undefined));
  const primeiro = Math.min(...daParte, Number.POSITIVE_INFINITY);
  const ultimo = Math.max(...daParte, Number.NEGATIVE_INFINITY);
  const linhas = [`# ${canonico.documento.titulo}`, '', `Idioma do texto-fonte: ${canonico.documento.idioma}.`, ''];
  if (canonico.secoes.length === 0) {
    linhas.push('O documento não declara seções.', '');
  } else {
    linhas.push('## Seções do documento', '');
    for (const secao of canonico.secoes) {
      const inicio = ordemNoCanonico.get(secao.bloco_inicio);
      const fim = ordemNoCanonico.get(secao.bloco_fim);
      const nesta = inicio !== undefined && fim !== undefined && inicio <= ultimo && fim >= primeiro;
      linhas.push(`${'  '.repeat(Math.max(0, secao.nivel - 1))}- ${MARCA_SECAO}${secao.id}⟧ ${secao.titulo}${nesta ? ' — **nesta parte**' : ''}`);
    }
    linhas.push('');
  }
  linhas.push('## Esta parte', '',
    `Ordem: ${String(esboco.ordem + 1)}.`,
    `Blocos para marcar: ${String(esboco.blocos_responsaveis.length)}.`,
    `Blocos só de contexto: ${String(esboco.blocos_contexto.length)}.`, '');
  if (canonico.limites.length > 0) {
    linhas.push('## Limites declarados pela canonização', '', ...canonico.limites.map((limite) => `- ${limite}`), '');
  }
  return linhas.join('\n');
}

function arquivosEstaveis(canonico: CanonicoV1, esboco: EsbocoDeParte, textos: TextosDoPacote): ArquivoDoPacote[] {
  return [
    { nome: 'metodo.md', conteudo: textos.metodo },
    { nome: 'prompt.md', conteudo: textos.prompt },
    { nome: 'schema.json', conteudo: textos.schema },
    { nome: 'sumario.md', conteudo: sumarioDoDocumento(canonico, esboco) },
    { nome: 'texto.md', conteudo: textoDosBlocos(canonico, esboco) },
  ];
}

/**
 * Hash da entrada imutável da parte: versões, estrutura e texto dos blocos.
 * `continuidade.md` fica de fora de propósito — ela só existe depois que as partes
 * anteriores rodaram, e o `dedup_key` precisa identificar a parte, não a tentativa.
 */
export function hashDaEntrada(canonico: CanonicoV1, esboco: EsbocoDeParte, versoes: VersoesDoPacote, textos: TextosDoPacote): string {
  return sha256(serializarEstavel({
    versoes,
    ordem: esboco.ordem,
    blocos_responsaveis: esboco.blocos_responsaveis,
    blocos_contexto: esboco.blocos_contexto,
    arquivos: arquivosEstaveis(canonico, esboco, textos).map((arquivo) => [arquivo.nome, arquivo.conteudo]),
  }));
}

export function montarPacote(
  canonico: CanonicoV1, esboco: EsbocoDeParte, versoes: VersoesDoPacote, textos: TextosDoPacote,
): Pacote {
  const arquivos = arquivosEstaveis(canonico, esboco, textos);
  if (esboco.continuidade_anterior !== undefined && esboco.continuidade_anterior !== '') {
    arquivos.push({ nome: 'continuidade.md', conteudo: esboco.continuidade_anterior, volatil: true });
  }
  return {
    arquivos,
    hash_entrada: hashDaEntrada(canonico, esboco, versoes, textos),
    prompt: textos.prompt,
  };
}

/** Escreve o diretório isolado que o executor recebe em `-C`. */
export async function escreverPacote(diretorio: string, pacote: Pacote): Promise<void> {
  await mkdir(diretorio, { recursive: true, mode: 0o700 });
  for (const arquivo of pacote.arquivos) {
    await writeFile(join(diretorio, arquivo.nome), arquivo.conteudo, { mode: 0o600 });
  }
}
