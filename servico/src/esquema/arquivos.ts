/**
 * Onde mora o esquema do capítulo: um JSON por pedido, dentro da pasta da versão (como a
 * geometria), em `versao-<id>/esquemas/<compreensão>/<seção>/<esquema>.json`. Sem tabela nova:
 * o estado vem do job (`gerar_esquema`), e o arquivo só vale quando o job terminou `ok`.
 * A escrita é atômica (temporário + `rename`); um pedido nunca vê um arquivo pela metade.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { renomearComRetentativa } from '../plataforma/disco.js';
import { dirname, join } from 'node:path';
import { validarEsquemaDoCapitulo, type EsquemaDoCapituloV1, type Id } from '@margem/contratos';
import { ehUlid, pastaDaVersao } from '../dados.js';
import { arquivoNosDados } from '../geometria/arquivos.js';

function exigir(id: string, papel: string): string {
  if (!ehUlid(id)) throw new Error(`Identificador de ${papel} inválido.`);
  return id;
}

export function caminhoDoEsquema(documentoId: Id, versaoId: Id, compreensaoId: Id, secaoId: Id, esquemaId: Id): string {
  return join(pastaDaVersao(documentoId, versaoId), 'esquemas', exigir(compreensaoId, 'compreensão'), exigir(secaoId, 'seção'), `${exigir(esquemaId, 'esquema')}.json`);
}

export async function gravarEsquema(documentoId: Id, esquema: EsquemaDoCapituloV1): Promise<string> {
  if (!validarEsquemaDoCapitulo(esquema)) throw new Error(`Esquema inválido: ${JSON.stringify(validarEsquemaDoCapitulo.errors)}`);
  const destino = caminhoDoEsquema(documentoId, esquema.versao_id, esquema.compreensao_id, esquema.secao_id, esquema.id);
  await mkdir(dirname(destino), { recursive: true });
  const temporario = join(dirname(destino), `.tentativa-${randomUUID()}`);
  try {
    await writeFile(temporario, `${JSON.stringify(esquema, null, 2)}\n`, { mode: 0o644 });
    await renomearComRetentativa(temporario, destino);
  } finally {
    await rm(temporario, { force: true });
  }
  return destino;
}

/** O esquema guardado, conferido pelo contrato; `null` se o arquivo não existe. */
export async function lerEsquema(documentoId: Id, versaoId: Id, compreensaoId: Id, secaoId: Id, esquemaId: Id): Promise<EsquemaDoCapituloV1 | null> {
  const caminho = await arquivoNosDados(caminhoDoEsquema(documentoId, versaoId, compreensaoId, secaoId, esquemaId));
  if (caminho === null) return null;
  const valor: unknown = JSON.parse(await readFile(caminho, 'utf8'));
  if (!validarEsquemaDoCapitulo(valor) || valor.id !== esquemaId || valor.secao_id !== secaoId) throw new Error('Esquema guardado inválido.');
  return valor;
}
