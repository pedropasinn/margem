import { interpretarJson, LimiteDeEntrada, ORCAMENTOS } from '../entrada-json.js';
import { ErroDaApi } from './erros.js';
import { conferirTamanho } from './seguranca.js';

/** Conta bytes realmente recebidos, inclusive sem Content-Length; limita antes de JSON.parse. */
export async function lerCorpoJson(requisicao: Request, vazioPermitido = false): Promise<unknown> {
  const limite = ORCAMENTOS.canonico;
  conferirTamanho(requisicao.headers.get('content-length') ?? undefined, limite.bytes);
  const leitor = requisicao.body?.getReader();
  const partes: Uint8Array[] = []; let tamanho = 0;
  try {
    if (leitor) for (;;) {
      const resultado = await leitor.read();
      if (resultado.done) break;
      const value: unknown = resultado.value;
      if (!(value instanceof Uint8Array)) throw new Error('Corpo precisa conter bytes.');
      tamanho += value.byteLength;
      if (tamanho > limite.bytes) { await leitor.cancel(); throw new LimiteDeEntrada('bytes'); }
      partes.push(value);
    }
    const texto = Buffer.concat(partes).toString('utf8');
    return vazioPermitido && texto.trim() === '' ? {} : interpretarJson(texto, limite);
  } catch (erro) {
    if (erro instanceof LimiteDeEntrada) throw new ErroDaApi(413, 'limite_de_entrada', erro.message);
    throw new ErroDaApi(400, 'json_invalido', 'O corpo precisa ser JSON.');
  } finally { leitor?.releaseLock(); }
}
