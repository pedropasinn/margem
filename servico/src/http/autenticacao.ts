/**
 * Ponto único de autorização das escritas da API principal.
 *
 * A Margem ainda não tem contas (J100–J104). Até elas chegarem, a identidade de quem escreve vem
 * do que a infraestrutura já garante, e nada além disso:
 *
 * - **Pelo Tailscale Serve** (o `Host` é o nome do Serve): o Serve apaga os cabeçalhos
 *   `Tailscale-User-*` que vierem do cliente e escreve os do usuário da tailnet que fez o pedido.
 *   Escreve como dono só o login listado em `MARGEM_DONOS`. Outro usuário da tailnet é convidado;
 *   pedido sem login (máquina com tag) ou vindo do Funnel é anônimo.
 * - **Em loopback** (`Host` 127.0.0.1/localhost): o processo roda na própria máquina, com o mesmo
 *   alcance que já tem sobre o banco e os arquivos; é o dono. Exceção: se um proxy local (o Vite em
 *   5180) declarar em `X-Forwarded-For` um cliente que não é loopback, o pedido veio de fora e é
 *   anônimo. O login do Tailscale só vale no `Host` do Serve: um proxy local repassa cabeçalhos
 *   sem limpá-los.
 *
 * - **No modo instalado** (`MARGEM_MODO=instalado`, J100): a API roda num container cuja porta só é
 *   publicada em 127.0.0.1 do computador da pessoa. O pedido chega pelo encaminhamento do Docker,
 *   sem `X-Forwarded-For`, com `Host` localhost:<porta publicada>: é o mesmo caso do loopback, e
 *   quem instalou é a dona. Não há login.
 *
 * O `X-Margem` continua obrigatório em toda escrita (defesa contra outra página no navegador).
 *
 * Convidado não escreve em nada da API principal: tudo aqui pertence ao dono. O que um convidado
 * pode escrever mora no portão da sala de teste (`servico/src/sala/portao.ts`), com sessão própria e
 * escrita restrita aos comentários e à resposta dele, nos documentos da sala.
 *
 * Leitura não passa por aqui (decisão de escopo de 07/10: leituras ficam como estavam).
 */
import { CABECALHO_MARGEM, donos, hostTailscale } from './ambiente.js';
import { ErroDaApi } from './erros.js';

export interface CabecalhosDeAutorizacao {
  /** Valor de `X-Margem`. */
  margem: string | undefined;
  /** Valor de `Authorization`. Ainda não é conferido: tokens pessoais são o J104. */
  autorizacao?: string | undefined;
  /** `Host` do pedido (o mesmo já conferido contra `hostsAceitos`). */
  host?: string | undefined;
  /** `Tailscale-User-Login`, escrito pelo Tailscale Serve. */
  loginTailscale?: string | undefined;
  /** `Tailscale-Funnel-Request`, escrito pelo Serve quando o pedido veio da internet. */
  funil?: string | undefined;
  /** `X-Forwarded-For`, de um proxy local (Vite). */
  encaminhadoPor?: string | undefined;
}

export type Identidade =
  | { usuario: 'dono'; via: 'loopback' }
  | { usuario: 'dono'; via: 'tailscale'; login: string }
  | { usuario: 'convidado'; via: 'tailscale'; login: string }
  | { usuario: 'anonimo'; via: 'tailscale' | 'proxy' | 'funil' };

function semPorta443(host: string): string {
  return host.trim().toLowerCase().replace(/:443$/, '');
}

const LOOPBACK = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost)$/;

/** Todos os saltos declarados são loopback (ou não há nenhum). */
function soLoopback(encaminhadoPor: string | undefined): boolean {
  if (encaminhadoPor === undefined || encaminhadoPor.trim() === '') return true;
  return encaminhadoPor.split(',').every((salto) => LOOPBACK.test(salto.trim().replace(/^\[|\]$/g, '').toLowerCase()));
}

/** Quem está fazendo o pedido, sem decidir se pode escrever. */
export function identificar(cabecalhos: CabecalhosDeAutorizacao): Identidade {
  const tailscale = hostTailscale();
  const host = cabecalhos.host === undefined ? '' : semPorta443(cabecalhos.host);
  if (tailscale !== undefined && host === tailscale) {
    if ((cabecalhos.funil ?? '').trim() !== '') return { usuario: 'anonimo', via: 'funil' };
    const login = (cabecalhos.loginTailscale ?? '').trim().toLowerCase();
    if (login === '') return { usuario: 'anonimo', via: 'tailscale' };
    return donos().includes(login) ? { usuario: 'dono', via: 'tailscale', login } : { usuario: 'convidado', via: 'tailscale', login };
  }
  if (!soLoopback(cabecalhos.encaminhadoPor)) return { usuario: 'anonimo', via: 'proxy' };
  return { usuario: 'dono', via: 'loopback' };
}

/** Escrita na API principal: só o dono. Devolve a identidade ou lança 401/403. */
export function autorizarEscrita(cabecalhos: CabecalhosDeAutorizacao): Identidade & { usuario: 'dono' } {
  if ((cabecalhos.margem ?? '').trim() === '') {
    throw new ErroDaApi(403, 'cabecalho_ausente', `Escritas exigem o cabeçalho ${CABECALHO_MARGEM}.`);
  }
  const identidade = identificar(cabecalhos);
  switch (identidade.usuario) {
    case 'dono':
      return identidade;
    case 'convidado':
      throw new ErroDaApi(403, 'sem_permissao_de_escrita', 'Esta conta pode ler, mas não escrever nesta biblioteca.');
    case 'anonimo':
      throw new ErroDaApi(401, 'nao_autenticado', 'Escritas exigem o dono autenticado.');
  }
}
