/** Configuração da API: porta, origens aceitas e limites de tamanho. */
import { modoInstalado } from '../instalacao.js';

export const PORTA_PADRAO = 8730;
export const ENDERECO_PADRAO = '127.0.0.1';
/** Cabeçalho de mesma origem exigido em toda escrita (CSRF simples). */
export const CABECALHO_MARGEM = 'x-margem';
/** Limite do original enviado por upload. */
export const LIMITE_UPLOAD_BYTES = 200 * 1024 * 1024;
/** Limite de um corpo JSON (progresso, revisão, importação legada). */
export const LIMITE_JSON_BYTES = 32 * 1024 * 1024;

export function porta(): number {
  const bruto = process.env.MARGEM_PORTA;
  if (bruto === undefined) return PORTA_PADRAO;
  const valor = Number.parseInt(bruto, 10);
  if (!Number.isInteger(valor) || valor <= 0 || valor > 65_535) throw new Error('MARGEM_PORTA inválida.');
  return valor;
}

/**
 * Endereço em que a API ouve. No modo padrão é sempre 127.0.0.1. No modo instalado (J100) a API
 * roda num container e precisa ouvir na interface dele (0.0.0.0 por padrão, ou `MARGEM_ENDERECO`);
 * quem limita o alcance é a publicação da porta só em 127.0.0.1 no computador (compose).
 */
export function enderecoDeEscuta(ambiente: NodeJS.ProcessEnv = process.env): string {
  if (!modoInstalado(ambiente)) return ENDERECO_PADRAO;
  const bruto = ambiente.MARGEM_ENDERECO;
  return bruto !== undefined && bruto.trim() !== '' ? bruto.trim() : '0.0.0.0';
}

/**
 * Porta que o navegador enxerga. No modo instalado o compose pode publicar a porta interna
 * (8730) em outra porta do computador (`MARGEM_PORTA_PUBLICA`); `Host` e `Origin` chegam com ela.
 * Fora do modo instalado é a própria porta da API.
 */
export function portaPublica(ambiente: NodeJS.ProcessEnv = process.env): number {
  const bruto = ambiente.MARGEM_PORTA_PUBLICA;
  if (!modoInstalado(ambiente) || bruto === undefined || bruto.trim() === '') return porta();
  const valor = Number.parseInt(bruto, 10);
  if (!Number.isInteger(valor) || valor <= 0 || valor > 65_535) throw new Error('MARGEM_PORTA_PUBLICA inválida.');
  return valor;
}

/** Portas pelas quais a API é alcançada em loopback: a interna e, no modo instalado, a publicada. */
function portasLocais(): string[] {
  return [...new Set([String(porta()), String(portaPublica())])];
}

/** Host do Tailscale Serve, quando configurado; entra nas origens e nos hosts aceitos. */
export function hostTailscale(): string | undefined {
  const bruto = process.env.MARGEM_TAILSCALE_HOST;
  return bruto !== undefined && bruto.trim() !== '' ? bruto.trim().toLowerCase() : undefined;
}

/**
 * Logins da tailnet que escrevem como dono pelo Tailscale Serve (`MARGEM_DONOS`, vírgulas;
 * o login é o que o Serve põe em `Tailscale-User-Login`, por exemplo `fulano@github`).
 * Vazio: ninguém escreve pelo Serve; só em loopback.
 */
export function donos(): string[] {
  const bruto = process.env.MARGEM_DONOS;
  if (bruto === undefined || bruto.trim() === '') return [];
  return bruto.split(',').map((item) => item.trim().toLowerCase()).filter((item) => item !== '');
}

/**
 * Origens aceitas. `MARGEM_ORIGENS` (lista separada por vírgula) sobrepõe o padrão,
 * que é a própria API em loopback mais o host do Tailscale Serve, se houver.
 */
export function origensAceitas(): string[] {
  const bruto = process.env.MARGEM_ORIGENS;
  if (bruto !== undefined && bruto.trim() !== '') {
    return bruto.split(',').map((item) => item.trim().toLowerCase()).filter((item) => item !== '');
  }
  const origens = portasLocais().flatMap((numero) => [`http://127.0.0.1:${numero}`, `http://localhost:${numero}`]);
  const tailscale = hostTailscale();
  if (tailscale !== undefined) origens.push(`https://${tailscale}`);
  return origens;
}

/** Hosts aceitos no cabeçalho `Host`: só loopback e o nome do Tailscale Serve. */
export function hostsAceitos(): string[] {
  const hosts = [...portasLocais().flatMap((numero) => [`127.0.0.1:${numero}`, `localhost:${numero}`]), '127.0.0.1', 'localhost'];
  const tailscale = hostTailscale();
  if (tailscale !== undefined) hosts.push(tailscale, `${tailscale}:443`);
  return hosts;
}

const ID_CHROME = /^[a-p]{32}$/;
const UUID_FIREFOX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Origens da extensão do navegador, por lista explícita em `MARGEM_EXTENSOES` (vírgulas).
 * Cada item é a origem inteira (`chrome-extension://<id>`, `moz-extension://<uuid>`) ou só o
 * identificador: 32 letras a–p são do Chrome/Edge/Brave; um UUID é o interno do Firefox, que
 * muda a cada instalação (about:debugging o mostra). Não há curinga: item inválido derruba.
 */
export function origensDeExtensao(): string[] {
  const bruto = process.env.MARGEM_EXTENSOES;
  if (bruto === undefined || bruto.trim() === '') return [];
  return bruto.split(',').map((item) => item.trim().toLowerCase()).filter((item) => item !== '').map((item) => {
    const achado = /^(chrome-extension|moz-extension):\/\/([^/]+)\/?$/.exec(item);
    const [esquema, id] = achado ? [achado[1], achado[2] ?? ''] : [undefined, item];
    if ((esquema === undefined || esquema === 'chrome-extension') && ID_CHROME.test(id)) return `chrome-extension://${id}`;
    if ((esquema === undefined || esquema === 'moz-extension') && UUID_FIREFOX.test(id)) return `moz-extension://${id}`;
    throw new Error(`MARGEM_EXTENSOES inválida: "${item}" não é id de extensão do Chrome nem UUID do Firefox.`);
  });
}

/** Tamanho mínimo da chave local: o app de computador gera 32 bytes aleatórios em base64url (43 caracteres). */
const CHAVE_LOCAL_MINIMA = 32;

/**
 * S-01 · Chave local da instalação (`MARGEM_CHAVE_LOCAL`), que o app de computador gera e guarda na
 * pasta de segredos do app (fora da biblioteca). Com ela, a API exige a chave nas leituras e escritas
 * (`chave-local.ts`): loopback é dividido por todas as contas do computador. Sem ela (desenvolvimento,
 * Docker, um servidor pessoal), nada muda. Chave curta demais derruba a API em vez de valer fraca.
 */
export function chaveLocal(ambiente: NodeJS.ProcessEnv = process.env): string | undefined {
  const bruta = ambiente.MARGEM_CHAVE_LOCAL?.trim() ?? '';
  if (bruta === '') return undefined;
  if (bruta.length < CHAVE_LOCAL_MINIMA || !/^[A-Za-z0-9_-]+$/u.test(bruta)) {
    throw new Error(`MARGEM_CHAVE_LOCAL inválida: use ao menos ${String(CHAVE_LOCAL_MINIMA)} caracteres de A–Z, a–z, 0–9, _ ou -.`);
  }
  return bruta;
}
