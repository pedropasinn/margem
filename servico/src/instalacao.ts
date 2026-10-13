/**
 * Modo de operação do serviço (J100).
 *
 * - **Padrão** (sem `MARGEM_MODO`): o servidor de desenvolvimento a partir do código. Banco só em 127.0.0.1:5435, API
 *   ouvindo em 127.0.0.1, Tailscale Serve opcional. Nada muda em relação a antes do J100.
 * - **`MARGEM_MODO=instalado`**: a Margem instalada no computador de uma pessoa pela imagem Docker
 *   (`distribuicao/`). O banco é o serviço `postgres` do compose (qualquer host/porta pela
 *   `DATABASE_URL`), a API ouve dentro do container (0.0.0.0 por padrão) e a porta é publicada só
 *   em 127.0.0.1 no computador. Não há login: quem alcança a porta local é a pessoa dona da
 *   instalação, o mesmo que o loopback já significa no modo padrão.
 */

export type ModoDeOperacao = 'padrao' | 'instalado';

export function modoDeOperacao(ambiente: NodeJS.ProcessEnv = process.env): ModoDeOperacao {
  const bruto = (ambiente.MARGEM_MODO ?? '').trim().toLowerCase();
  if (bruto === '' || bruto === 'padrao') return 'padrao';
  if (bruto === 'instalado') return 'instalado';
  throw new Error(`MARGEM_MODO aceita "instalado" ou nada, não "${bruto}".`);
}

export function modoInstalado(ambiente: NodeJS.ProcessEnv = process.env): boolean {
  return modoDeOperacao(ambiente) === 'instalado';
}
