import { interpretarJson, lerTextoLimitado, ORCAMENTOS, LimiteDeEntrada } from '../entrada-json.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import adicionarFormatos from 'ajv-formats';
import type { AnySchema } from 'ajv';

export function sha256(conteudo: string): string {
  return createHash('sha256').update(conteudo, 'utf8').digest('hex');
}

export function diretorioArtefatosPadrao(): string {
  return join(homedir(), '.cache/margem/artefatos');
}

/**
 * Palavras-chave de JSON Schema que a API de saída estruturada do Codex recusa.
 * Descoberta na primeira chamada real (J10): `uniqueItems` em `sublinhar` devolveu
 * `400 invalid_json_schema`. Elas continuam valendo na conferência local — só não
 * viajam para o modelo. Acrescentar aqui o que a API passar a recusar.
 */
export const PALAVRAS_RECUSADAS_PELO_CODEX: readonly string[] = ['uniqueItems'];
/** Palavras que a API não aceita mas têm equivalente aceito (segunda chamada real: `oneOf` na revisão). */
export const PALAVRAS_TROCADAS_PELO_CODEX: Readonly<Record<string, string>> = { oneOf: 'anyOf' };

function semPalavrasRecusadas(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semPalavrasRecusadas);
  if (typeof valor !== 'object' || valor === null) return valor;
  const saida: Record<string, unknown> = {};
  const objeto = valor as Record<string, unknown>;
  for (const [chave, item] of Object.entries(objeto)) {
    if (PALAVRAS_RECUSADAS_PELO_CODEX.includes(chave)) continue;
    saida[PALAVRAS_TROCADAS_PELO_CODEX[chave] ?? chave] = semPalavrasRecusadas(item);
  }
  // A API exige `type` em todo subschema: um `const` sozinho é recusado ("schema must have a 'type' key").
  if ('const' in objeto && !('type' in objeto)) {
    const c = objeto.const;
    saida.type = typeof c === 'string' ? 'string' : typeof c === 'boolean' ? 'boolean' : Number.isInteger(c) ? 'integer' : 'number';
  }
  return saida;
}

/**
 * Copia o schema para o diretório da execução tirando o que a API recusa.
 * O arquivo original continua sendo a régua da conferência da resposta.
 */
export async function escreverSchemaDoCodex(origem: string, destino: string): Promise<void> {
  const texto = await readFile(origem, 'utf8');
  const limpo = semPalavrasRecusadas(JSON.parse(texto) as unknown);
  await writeFile(destino, `${JSON.stringify(limpo, null, 2)}\n`, { mode: 0o600 });
}

export type Conferencia =
  | { estado: 'ok'; valor: unknown; bytes: string; sha256: string }
  | { estado: 'json_invalido'; mensagem: string }
  | { estado: 'schema'; mensagem: string };

/**
 * Lê a resposta final, confere se é JSON e se obedece ao schema pedido.
 * Mensagens de erro descrevem a violação; nunca carregam o conteúdo bruto.
 */
export async function conferirResposta(caminho: string, schema: string): Promise<Conferencia> {
  let bytes: string;
  try {
    bytes = await lerTextoLimitado(caminho, ORCAMENTOS.resposta);
  } catch (erro) {
    if (erro instanceof LimiteDeEntrada) return { estado: 'json_invalido', mensagem: erro.message };
    return { estado: 'json_invalido', mensagem: 'A CLI não gravou a resposta final.' };
  }
  let valor: unknown;
  try {
    valor = interpretarJson(bytes, ORCAMENTOS.resposta);
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : 'erro desconhecido';
    return { estado: 'json_invalido', mensagem: `Resposta final não é JSON: ${detalhe}` };
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  adicionarFormatos(ajv);
  let validar;
  try {
    const texto = await readFile(schema, 'utf8');
    validar = ajv.compile(JSON.parse(texto) as AnySchema);
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : 'erro desconhecido';
    return { estado: 'schema', mensagem: `Schema da execução ilegível: ${detalhe}` };
  }
  if (!validar(valor)) {
    const problemas = (validar.errors ?? [])
      .slice(0, 5)
      .map((erro) => `${erro.instancePath || '/'} ${erro.message ?? 'inválido'}`)
      .join('; ');
    return { estado: 'schema', mensagem: `Resposta fora do schema: ${problemas}` };
  }
  return { estado: 'ok', valor, bytes, sha256: sha256(bytes) };
}

/** Copia a resposta conferida para fora do diretório temporário, que será removido. */
export async function guardarArtefato(
  bytes: string,
  destino: string,
  nome: string,
): Promise<string> {
  await mkdir(destino, { recursive: true, mode: 0o700 });
  const caminho = join(destino, `${basename(nome)}.json`);
  await writeFile(caminho, bytes, { mode: 0o600 });
  return caminho;
}
