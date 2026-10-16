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

/**
 * Portas em que a extensão procura o Margem deste computador (V-W9). O app de computador abre na 8730
 * e, se ela estiver ocupada (outro programa, um Margem em Docker, um túnel), numa das seguintes.
 */
export const PORTAS_DO_MARGEM: readonly number[] = Array.from({ length: 10 }, (_, i) => 8730 + i);

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

/**
 * Leitura (o teste de conexão): com token, só o `Authorization`. O app de computador exige a chave da
 * biblioteca também nas leituras (S-01); o token das opções é essa chave.
 */
export function cabecalhosDeLeitura(configuracao: Configuracao): Record<string, string> {
  const token = configuracao.token.trim();
  return token === '' ? {} : { Authorization: `Bearer ${token}` };
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
  chave_local: 'O Margem pediu a chave desta biblioteca. No Margem, abra Configurações, copie a "Chave para a extensão e o '
    + 'Obsidian" e cole no campo Token das opções da extensão',
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

/**
 * R2-6 · No app de computador a API exige a chave local, que o navegador não tem: abrir
 * `http://127.0.0.1:<porta>/documentos/<id>` numa aba daria 401. Quando quem respondeu é o app
 * (`app_de_computador` na saúde, que é pública), o endereço para abrir é o link `margem://` que o app
 * registra e abre na janela dele. Em qualquer outro caso (Docker, Tailscale, saúde sem resposta), fica o http.
 */
export const BASE_DO_APP = 'margem://abrir';

export async function enderecoParaAbrir(configuracao: Configuracao, resultado: Enviado, buscar: typeof fetch = (...a) => fetch(...a), prazoMs = 1_500): Promise<Enviado> {
  try {
    const resposta = await buscar(`${configuracao.servidor}/api/saude`, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(prazoMs) });
    const corpo = await resposta.json() as { servico?: unknown; app_de_computador?: unknown };
    if (corpo.servico !== 'margem' || corpo.app_de_computador !== true) return resultado;
    return { ...resultado, endereco: `${BASE_DO_APP}/documentos/${encodeURIComponent(resultado.documento_id)}` };
  } catch {
    return resultado;
  }
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
  /** Onde respondeu e com que identificação (V-W9), quando a extensão procurou pelas portas. */
  servidor?: string;
  instancia_id?: string | null;
  outros?: number;
}

export async function testarConexao(configuracao: Configuracao): Promise<Conexao> {
  const resposta = await pedir(configuracao, '/api/importacoes/web', { method: 'GET', headers: cabecalhosDeLeitura(configuracao) });
  if (resposta.status === 404) {
    throw new ErroDoServidor('O servidor respondeu, mas não tem a rota de importação web: atualize o Margem.', 'sem_rota');
  }
  const corpo = await interpretar<{ servico?: unknown; importacao_web?: unknown }>(resposta);
  if (corpo.servico !== 'margem' || typeof corpo.importacao_web !== 'number') {
    throw new ErroDoServidor('O endereço respondeu, mas não parece ser o Margem.', 'nao_e_margem');
  }
  return { versao: corpo.importacao_web };
}

// ------------------------------------------------------------------ descoberta do Margem local (V-W9)

/** Um Margem que respondeu numa das portas locais. */
export interface MargemEncontrado {
  servidor: string;
  porta: number;
  /** A identificação mostrada na checagem da instalação do Margem; `null` num Margem antigo. */
  instancia_id: string | null;
  app_de_computador: boolean;
}

/**
 * O endereço configurado é o padrão local (localhost ou 127.0.0.1 numa das portas do Margem)? Só então
 * a extensão procura o Margem pelas portas; um endereço escolhido à mão (outra porta, Tailscale) vale
 * como está.
 */
export function procuraAutomatica(servidor: string): boolean {
  try {
    const url = new URL(servidor);
    return url.protocol === 'http:' && HOSTS_LOCAIS.has(url.hostname) && url.pathname.replace(/\/+$/, '') === ''
      && PORTAS_DO_MARGEM.includes(Number(url.port || '80'));
  } catch {
    return false;
  }
}

/** Erros com que só o Margem responde à rota de saúde quando recusa a extensão (sem a identificação). */
const ERROS_DO_MARGEM = new Set(['origem_recusada', 'rota_fora_da_extensao', 'host_recusado']);

/**
 * `GET /api/saude` numa porta: quem responde como Margem (mesmo com o banco fora, 503). S-06: identificação
 * completa é `servico: "margem"` com `instancia_id`; uma resposta genérica (`{ "ok": true }`) não conta.
 * Um Margem que recusou a extensão entra sem identificação, só para o erro dele chegar a quem usa.
 */
async function sondar(host: string, porta: number, buscar: typeof fetch, prazoMs: number): Promise<MargemEncontrado | null> {
  const servidor = `http://${host}:${String(porta)}`;
  try {
    const resposta = await buscar(`${servidor}/api/saude`, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(prazoMs) });
    const corpo = await resposta.json() as { servico?: unknown; instancia_id?: unknown; app_de_computador?: unknown; erro?: unknown };
    if (corpo.servico === 'margem' && typeof corpo.instancia_id === 'string' && corpo.instancia_id !== '') {
      return { servidor, porta, instancia_id: corpo.instancia_id, app_de_computador: corpo.app_de_computador === true };
    }
    if (typeof corpo.erro === 'string' && ERROS_DO_MARGEM.has(corpo.erro)) return { servidor, porta, instancia_id: null, app_de_computador: false };
    return null;
  } catch {
    return null;
  }
}

/** Procura em paralelo nas portas 8730–8739 do host configurado. */
export async function procurarMargem(servidor: string, buscar: typeof fetch = (...a) => fetch(...a), prazoMs = 1_500): Promise<MargemEncontrado[]> {
  const host = new URL(servidor).hostname;
  const achados = await Promise.all(PORTAS_DO_MARGEM.map((porta) => sondar(host, porta, buscar, prazoMs)));
  return achados.filter((a): a is MargemEncontrado => a !== null);
}

/**
 * Qual dos Margens achados usar. S-06: com uma identificação já conhecida, só ela; se ela não responde, nenhum
 * (trocar de biblioteca é escolha de quem usa, pelo "Testar conexão" das opções). Sem nenhuma conhecida: o
 * app de computador identificado; senão o primeiro identificado; senão o que recusou a extensão (o erro dele
 * explica o que fazer).
 */
export function escolherMargem(achados: readonly MargemEncontrado[], conhecida: string | null): MargemEncontrado | null {
  if (conhecida !== null) return achados.find((a) => a.instancia_id === conhecida) ?? null;
  const identificados = achados.filter((a) => a.instancia_id !== null);
  return identificados.find((a) => a.app_de_computador) ?? identificados[0] ?? achados[0] ?? null;
}

export interface Resolvido { configuracao: Configuracao; encontrado: MargemEncontrado | null; outros: number }

/** A biblioteca que a extensão conhece não respondeu, mas outra sim: o envio para, sem POST. */
export function margemConhecidoAusente(conhecida: string): ErroDoServidor {
  return new ErroDoServidor(`O Margem que esta extensão usa (identificação ${conhecida}) não está aberto, mas outro Margem `
    + 'respondeu neste computador. Nada foi enviado. Abra o seu Margem e tente de novo; para usar a outra biblioteca, '
    + 'abra as opções da extensão e clique em "Testar conexão".', 'margem_conhecido_ausente');
}

/**
 * A configuração com o endereço do Margem achado nas portas locais (quando a procura vale para o
 * endereço configurado). Sem nenhum Margem respondendo, fica o configurado (o erro de rede explica).
 * Com a identificação conhecida ausente e outro Margem respondendo, recusa (S-06).
 */
export async function resolverServidor(configuracao: Configuracao, conhecida: string | null, buscar?: typeof fetch): Promise<Resolvido> {
  if (!procuraAutomatica(configuracao.servidor)) return { configuracao, encontrado: null, outros: 0 };
  const achados = await procurarMargem(configuracao.servidor, buscar);
  const escolhido = escolherMargem(achados, conhecida);
  if (escolhido === null) {
    if (conhecida !== null && achados.length > 0) throw margemConhecidoAusente(conhecida);
    return { configuracao, encontrado: null, outros: 0 };
  }
  return { configuracao: { ...configuracao, servidor: escolhido.servidor }, encontrado: escolhido, outros: achados.length - 1 };
}

/** O que a página de opções diz depois do teste: onde o Margem respondeu e com que identificação. */
export function textoDaConexao(conexao: Conexao): string {
  const base = `Conectado ao Margem (importação web v${String(conexao.versao)})`;
  if (conexao.servidor === undefined) return `${base}.`;
  const onde = conexao.servidor.replace(/^https?:\/\//, '');
  const id = conexao.instancia_id ? `, identificação ${conexao.instancia_id}` : '';
  const outros = (conexao.outros ?? 0) > 0 ? ` Há outro Margem respondendo neste computador; confira a identificação na checagem da instalação do Margem que você usa.` : '';
  return `${base} em ${onde}${id}.${outros}`;
}
