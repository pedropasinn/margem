/**
 * Regras do modo estrito da saída estruturada (o `--output-schema` do Codex), conferidas sem rede
 * (V-W3, auditoria B-01). Um schema que viola uma delas faz a API devolver `400 invalid_json_schema`
 * e a CLI sair com código 1 em segundos, sem nenhuma pista na interface: o defeito só aparecia com
 * chamada real. `conferirModoEstrito` recebe o schema **já saneado** (`sanearSchemaParaOCodex`), o
 * mesmo arquivo que viaja para a CLI.
 *
 * Regras (documentação da OpenAI sobre Structured Outputs, mais o que as chamadas reais do J10 e do
 * J17 ensinaram):
 *   - a raiz é um objeto (não `anyOf`);
 *   - todo objeto tem `additionalProperties: false` e `required` com todas as chaves de `properties`;
 *   - todo subschema diz o `type` (ou é `anyOf`/`$ref`);
 *   - só palavras-chave conhecidas: as recusadas (`oneOf`, `allOf`, `not`, `if`…, `uniqueItems`,
 *     `patternProperties`…) e as desconhecidas são acusadas;
 *   - `$ref` só para dentro do próprio schema (`#`, `#/$defs/…`, `#/definitions/…`) e resolvível;
 *   - `format` só os aceitos; até 10 níveis de objetos, 5 000 propriedades e 1 000 valores de `enum`.
 */

/** Palavras que o modo estrito aceita (as de metadado da raiz incluídas). */
const PERMITIDAS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', '$ref', '$defs', 'definitions',
  'description', 'title', '$schema', '$id', '$comment',
  'pattern', 'format', 'minLength', 'maxLength',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems',
]);

/** Recusadas com certeza: o motivo vai na mensagem. */
const RECUSADAS: Readonly<Record<string, string>> = {
  oneOf: 'use anyOf (o saneador troca)',
  allOf: 'não é aceito',
  not: 'não é aceito',
  if: 'condicionais não são aceitas', then: 'condicionais não são aceitas', else: 'condicionais não são aceitas',
  dependentRequired: 'não é aceito', dependentSchemas: 'não é aceito',
  patternProperties: 'não é aceito', unevaluatedProperties: 'não é aceito', propertyNames: 'não é aceito',
  minProperties: 'não é aceito', maxProperties: 'não é aceito',
  uniqueItems: 'a API recusa (J10); o saneador tira',
  contains: 'não é aceito', minContains: 'não é aceito', maxContains: 'não é aceito', prefixItems: 'não é aceito',
  default: 'não é aceito no modo estrito',
};

const FORMATOS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid']);
const TIPOS = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

export const LIMITE_DE_NIVEIS = 10;
export const LIMITE_DE_PROPRIEDADES = 5_000;
export const LIMITE_DE_VALORES_DE_ENUM = 1_000;

export interface Violacao {
  /** JSON Pointer do subschema (`/properties/alteracoes/items/anyOf/2`). */
  caminho: string;
  regra: string;
}

function escapar(nome: string): string {
  return nome.replaceAll('~', '~0').replaceAll('/', '~1');
}

function tiposDe(schema: Record<string, unknown>): string[] {
  const tipo = schema.type;
  if (typeof tipo === 'string') return [tipo];
  return Array.isArray(tipo) ? tipo.filter((t): t is string => typeof t === 'string') : [];
}

function resolverRef(raiz: unknown, ref: string): boolean {
  if (ref === '#') return true;
  if (!ref.startsWith('#/')) return false;
  let atual: unknown = raiz;
  for (const parte of ref.slice(2).split('/').map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (typeof atual !== 'object' || atual === null || !(parte in atual)) return false;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return typeof atual === 'object' && atual !== null;
}

/** Todas as violações do modo estrito no schema saneado; lista vazia quando ele passa. */
export function conferirModoEstrito(schema: unknown): Violacao[] {
  const violacoes: Violacao[] = [];
  let propriedades = 0;
  let valoresDeEnum = 0;
  const acusar = (caminho: string, regra: string) => { violacoes.push({ caminho: caminho === '' ? '/' : caminho, regra }); };

  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    acusar('', 'o schema precisa ser um objeto JSON');
    return violacoes;
  }
  const raiz = schema as Record<string, unknown>;
  if (!tiposDe(raiz).includes('object') || 'anyOf' in raiz) acusar('', 'a raiz precisa ser "type": "object" (sem anyOf)');

  const visitar = (no: unknown, caminho: string, niveis: number): void => {
    if (typeof no !== 'object' || no === null || Array.isArray(no)) {
      acusar(caminho, 'subschema precisa ser um objeto');
      return;
    }
    const sub = no as Record<string, unknown>;
    for (const chave of Object.keys(sub)) {
      const motivo = RECUSADAS[chave];
      if (motivo !== undefined) acusar(caminho, `"${chave}": ${motivo}`);
      else if (!PERMITIDAS.has(chave)) acusar(caminho, `"${chave}": palavra-chave desconhecida para o modo estrito`);
    }
    const tipos = tiposDe(sub);
    if (tipos.length === 0 && !('anyOf' in sub) && !('$ref' in sub)) acusar(caminho, 'falta "type" (a API recusa: schema must have a \'type\' key)');
    for (const tipo of tipos) if (!TIPOS.has(tipo)) acusar(caminho, `tipo desconhecido: ${tipo}`);
    if (typeof sub.format === 'string' && !FORMATOS.has(sub.format)) acusar(caminho, `"format": "${sub.format}" não é aceito`);
    if (typeof sub.$ref === 'string' && !resolverRef(raiz, sub.$ref)) acusar(caminho, `"$ref" fora do schema ou sem destino: ${sub.$ref}`);
    if (Array.isArray(sub.enum)) valoresDeEnum += sub.enum.length;

    const ehObjeto = tipos.includes('object') || 'properties' in sub;
    let niveisAqui = niveis;
    if (ehObjeto) {
      niveisAqui += 1;
      if (niveisAqui > LIMITE_DE_NIVEIS) acusar(caminho, `mais de ${String(LIMITE_DE_NIVEIS)} níveis de objetos`);
      if (sub.additionalProperties !== false) acusar(caminho, '"additionalProperties" precisa ser false (mapa livre não é aceito)');
      const props = typeof sub.properties === 'object' && sub.properties !== null && !Array.isArray(sub.properties)
        ? Object.keys(sub.properties) : null;
      if (props === null) acusar(caminho, 'objeto sem "properties"');
      const exigidas = Array.isArray(sub.required) ? sub.required : null;
      if (exigidas === null) acusar(caminho, 'objeto sem "required" (o modo estrito exige a lista, mesmo vazia)');
      else if (props !== null) {
        const faltando = props.filter((nome) => !exigidas.includes(nome));
        const sobrando = exigidas.filter((nome) => typeof nome !== 'string' || !props.includes(nome));
        if (faltando.length > 0) acusar(caminho, `"required" sem: ${faltando.join(', ')} (toda propriedade é obrigatória; opcional vira tipo com null)`);
        if (sobrando.length > 0) acusar(caminho, `"required" com chaves fora de "properties": ${sobrando.map(String).join(', ')}`);
      }
      propriedades += props?.length ?? 0;
    }
    if (tipos.includes('array') && !('items' in sub)) acusar(caminho, 'lista sem "items"');

    for (const mapa of ['properties', '$defs', 'definitions'] as const) {
      const filhos = sub[mapa];
      if (typeof filhos === 'object' && filhos !== null && !Array.isArray(filhos)) {
        for (const [nome, filho] of Object.entries(filhos)) visitar(filho, `${caminho}/${mapa}/${escapar(nome)}`, mapa === 'properties' ? niveisAqui : 0);
      }
    }
    if ('items' in sub) visitar(sub.items, `${caminho}/items`, niveisAqui);
    if (Array.isArray(sub.anyOf)) sub.anyOf.forEach((alternativa, indice) => { visitar(alternativa, `${caminho}/anyOf/${String(indice)}`, niveisAqui); });
  };
  visitar(raiz, '', 0);
  if (propriedades > LIMITE_DE_PROPRIEDADES) acusar('', `mais de ${String(LIMITE_DE_PROPRIEDADES)} propriedades no total`);
  if (valoresDeEnum > LIMITE_DE_VALORES_DE_ENUM) acusar('', `mais de ${String(LIMITE_DE_VALORES_DE_ENUM)} valores de enum no total`);
  return violacoes;
}
