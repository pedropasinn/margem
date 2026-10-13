/**
 * Cliente da API do Margem, usado só pelo fundo (service worker / página de fundo).
 *
 * Escrita exige o cabeçalho `X-Margem` (proteção de escrita do servidor). Com token
 * configurado, ele vai nesse cabeçalho e também em `Authorization: Bearer`, que é onde os
 * tokens por usuário vão ser conferidos quando existirem.
 */
import type { CapturaDePdf, CapturaDeTexto, Configuracao, Enviado, ImportacaoWeb } from './tipos';

/** Onde o Margem instalado no próprio computador responde (Docker Compose, porta 8730). */
export const SERVIDOR_PADRAO = 'http://localhost:8730';

/** Hosts cobertos por `host_permissions` no manifesto (qualquer porta). */
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1']);

/** Como abrir o Margem, repetido nas mensagens de erro. */
const COMANDO_DE_ABRIR = 'rode `margem iniciar` (ou `docker compose up -d` na pasta da instalação)';
export const COMO_ABRIR = `Abra o Margem: ${COMANDO_DE_ABRIR} e tente de novo.`;

/** Endereço normalizado (http/https, sem barra final) ou `null` se não servir. */
export function normalizarServidor(bruto: string): string | null {
  try {
    const url = new URL(bruto.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function cabecalhosDeEscrita(configuracao: Configuracao): Record<string, string> {
  const token = configuracao.token.trim();
  return token === '' ? { 'X-Margem': 'extensao' } : { 'X-Margem': token, Authorization: `Bearer ${token}` };
}

/** Corpo do contrato ImportacaoWebV1 a partir da captura. */
export function importacaoDaCaptura(captura: CapturaDeTexto, agora: Date): ImportacaoWeb {
  return {
    markdown: captura.markdown,
    titulo: captura.titulo,
    ...(captura.autor === undefined ? {} : { autor: captura.autor }),
    ...(captura.site === undefined ? {} : { site: captura.site }),
    url_origem: captura.url,
    ...(captura.publicado_em === undefined ? {} : { publicado_em: captura.publicado_em }),
    capturado_em: agora.toISOString(),
    ...(captura.tipo === 'selecao' ? { trecho: true } : {}),
  };
}

/** Padrão de permissão de host do servidor, sem porta (vale para qualquer porta); `null` se inválido. */
export function padraoDeHost(servidor: string): string | null {
  try {
    const url = new URL(servidor);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

/**
 * Permissão que a página de opções pede em tempo de execução para um servidor fora de
 * `localhost`/`127.0.0.1`; `null` para os locais (já no manifesto) e para endereços inválidos.
 */
export function permissaoDeHost(servidor: string): string | null {
  const padrao = padraoDeHost(servidor);
  if (padrao === null || HOSTS_LOCAIS.has(new URL(servidor).hostname)) return null;
  return padrao;
}

const ORIGEM_RECUSADA = 'O Margem está aberto, mas não autorizou esta extensão. Copie a origem mostrada nas opções '
  + 'da extensão para MARGEM_EXTENSOES na configuração do Margem e reinicie o Margem.';

const MENSAGENS: Readonly<Record<string, string>> = {
  origem_recusada: ORIGEM_RECUSADA,
  rota_fora_da_extensao: 'O servidor não deixa a extensão usar esta rota.',
  host_recusado: `O Margem recusou o endereço usado. Use ${SERVIDOR_PADRAO} (ou o endereço exato configurado no Margem, com a mesma porta).`,
  cabecalho_ausente: 'O servidor exigiu o cabeçalho X-Margem e ele não chegou.',
  importacao_invalida: 'O servidor recusou a página capturada',
  corpo_grande_demais: 'A página (ou o PDF) passa do limite de tamanho do servidor.',
  formato_nao_suportado: 'Este servidor não aceita o formato enviado.',
};

export class ErroDoServidor extends Error {
  constructor(mensagem: string, readonly codigo?: string) {
    super(mensagem);
    this.name = 'ErroDoServidor';
  }
}

async function interpretar<T>(resposta: Response): Promise<T> {
  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = null;
  }
  if (resposta.ok) return corpo as T;
  const erro = (corpo ?? {}) as { erro?: unknown; detalhe?: unknown };
  const codigo = typeof erro.erro === 'string' ? erro.erro : undefined;
  const detalhe = typeof erro.detalhe === 'string' ? erro.detalhe : undefined;
  const base = (codigo !== undefined ? MENSAGENS[codigo] : undefined) ?? `O Margem respondeu ${String(resposta.status)}${codigo ? ` (${codigo})` : ''}`;
  throw new ErroDoServidor(detalhe && codigo === 'importacao_invalida' ? `${base}: ${detalhe}` : `${base}.`, codigo);
}

/**
 * Diz se a extensão tem permissão de host para o servidor. Com ela, o navegador não aplica CORS
 * ao pedido: falha de rede só pode ser conexão recusada, e uma origem não autorizada chega como
 * 403 `origem_recusada`, legível. Sem ela (ou sem saber), uma falha de rede pode ser as duas
 * coisas. O fundo instala o verificador real (`browser.permissions.contains`).
 */
export type VerificadorDeAcesso = (servidor: string) => Promise<boolean>;

let verificadorDeAcesso: VerificadorDeAcesso | undefined;

export function definirVerificadorDeAcesso(verificador: VerificadorDeAcesso | undefined): void {
  verificadorDeAcesso = verificador;
}

async function temAcesso(servidor: string): Promise<boolean> {
  if (verificadorDeAcesso === undefined) return false;
  try {
    return await verificadorDeAcesso(servidor);
  } catch {
    return false;
  }
}

/** Falha de rede: Margem fechado (conexão recusada) ou, sem permissão de host, CORS recusado. */
export function erroDeRede(servidor: string, acessoAoHost: boolean): ErroDoServidor {
  const inicio = `Não foi possível falar com ${servidor}.`;
  if (acessoAoHost) return new ErroDoServidor(`${inicio} O Margem não parece estar aberto. ${COMO_ABRIR}`, 'rede');
  return new ErroDoServidor(`${inicio} Se o Margem não estiver aberto, ${COMANDO_DE_ABRIR}. Se estiver, ele ainda não `
    + 'autorizou esta extensão: copie a origem mostrada nas opções para MARGEM_EXTENSOES na configuração do Margem e '
    + 'reinicie o Margem.', 'rede');
}

async function pedir(configuracao: Configuracao, caminho: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${configuracao.servidor}${caminho}`, { ...init, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw erroDeRede(configuracao.servidor, await temAcesso(configuracao.servidor));
  }
}

function enviado(configuracao: Configuracao, documentoId: string): Enviado {
  return { documento_id: documentoId, endereco: `${configuracao.servidor}/documentos/${documentoId}` };
}

export async function enviarTexto(configuracao: Configuracao, captura: CapturaDeTexto, agora = new Date()): Promise<Enviado> {
  const resposta = await pedir(configuracao, '/api/importacoes/web', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecalhosDeEscrita(configuracao) },
    body: JSON.stringify(importacaoDaCaptura(captura, agora)),
  });
  const corpo = await interpretar<{ documento_id: string }>(resposta);
  return enviado(configuracao, corpo.documento_id);
}

export async function enviarPdf(configuracao: Configuracao, captura: CapturaDePdf, bytes: ArrayBuffer): Promise<Enviado> {
  const formulario = new FormData();
  formulario.set('titulo', captura.titulo);
  formulario.set('formato', 'pdf');
  const nome = (captura.titulo.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim() || 'documento').slice(0, 120);
  formulario.set('arquivo', new File([bytes], nome.endsWith('.pdf') ? nome : `${nome}.pdf`, { type: 'application/pdf' }));
  const resposta = await pedir(configuracao, '/api/documentos', {
    method: 'POST', headers: cabecalhosDeEscrita(configuracao), body: formulario,
  });
  const corpo = await interpretar<{ documento_id: string }>(resposta);
  return enviado(configuracao, corpo.documento_id);
}

export interface Conexao {
  versao: number;
}

export async function testarConexao(configuracao: Configuracao): Promise<Conexao> {
  const resposta = await pedir(configuracao, '/api/importacoes/web', { method: 'GET' });
  if (resposta.status === 404) {
    throw new ErroDoServidor('O servidor respondeu, mas não tem a rota de importação web: atualize o Margem.', 'sem_rota');
  }
  const corpo = await interpretar<{ servico?: unknown; importacao_web?: unknown }>(resposta);
  if (corpo.servico !== 'margem' || typeof corpo.importacao_web !== 'number') {
    throw new ErroDoServidor('O endereço respondeu, mas não parece ser o Margem.', 'nao_e_margem');
  }
  return { versao: corpo.importacao_web };
}
