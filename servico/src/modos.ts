/**
 * Modos de leitura (J12): `contratos/modos/<id>@<revisao>.json`, lidos e validados por
 * `lerModosDeLeitura` (schema, nome do arquivo e régua de legibilidade). Os arquivos são
 * versionados com o código; lê-los uma vez por processo basta.
 */
import { MODO_F1, lerModosDeLeitura, mesmoModo, type ModoDeLeituraV1, type ReferenciaModo } from '@margem/contratos';

let cache: readonly ModoDeLeituraV1[] | undefined;

export function modosDeLeitura(): readonly ModoDeLeituraV1[] {
  cache ??= Object.freeze(lerModosDeLeitura());
  return cache;
}

export function modoOuNada(referencia: ReferenciaModo): ModoDeLeituraV1 | undefined {
  return modosDeLeitura().find((modo) => mesmoModo(modo, referencia));
}

export function exigirModo(referencia: ReferenciaModo): ModoDeLeituraV1 {
  const modo = modoOuNada(referencia);
  if (!modo) throw new Error(`Modo de leitura desconhecido: ${referencia.id}@${String(referencia.revisao)}`);
  return modo;
}

export function modoF1(): ModoDeLeituraV1 {
  return exigirModo(MODO_F1);
}
