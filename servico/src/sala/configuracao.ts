/** Configuração do portão da sala de teste: endereço, porta e o endereço público dos links. */

export const PORTA_PADRAO_DO_PORTAO = 8760;
export const ENDERECO_PADRAO_DO_PORTAO = '127.0.0.1';

export function portaDoPortao(): number {
  const bruto = process.env.MARGEM_PORTAO_PORTA;
  if (bruto === undefined || bruto.trim() === '') return PORTA_PADRAO_DO_PORTAO;
  const valor = Number.parseInt(bruto, 10);
  if (!Number.isInteger(valor) || valor <= 0 || valor > 65_535) throw new Error('MARGEM_PORTAO_PORTA inválida.');
  return valor;
}

/** Loopback por padrão: quem expõe o portão é o Tailscale Funnel ou o Cloudflare Tunnel, nunca ele mesmo. */
export function enderecoDoPortao(): string {
  const bruto = process.env.MARGEM_PORTAO_ENDERECO;
  return bruto !== undefined && bruto.trim() !== '' ? bruto.trim() : ENDERECO_PADRAO_DO_PORTAO;
}

/**
 * Endereço que entra no link mandado ao testador (`MARGEM_PORTAO_URL`, http(s), sem barra no fim).
 * Sem ele, o portão em loopback, que só serve para testar na própria máquina.
 */
export function urlPublicaDoPortao(): { url: string; configurada: boolean } {
  const bruto = process.env.MARGEM_PORTAO_URL?.trim();
  if (bruto && /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/.test(bruto)) return { url: bruto.replace(/\/+$/, ''), configurada: true };
  return { url: `http://${ENDERECO_PADRAO_DO_PORTAO}:${String(portaDoPortao())}`, configurada: false };
}
