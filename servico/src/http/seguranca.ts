/**
 * Segurança mínima de um servidor pessoal em loopback.
 *
 * Não há login próprio: a identidade de quem escreve vem do loopback ou do Tailscale Serve
 * (`autenticacao.ts`). No app de computador, a chave local da instalação (`chave-local.ts`, S-01) separa as
 * contas do mesmo computador, que dividem o loopback. Aqui também se defende o navegador do dono contra uma página de
 * terceiros — daí conferir `Origin`/`Host` e exigir um cabeçalho que só código de mesma
 * origem consegue enviar.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { chaveLocal, hostTailscale, hostsAceitos, origensAceitas, origensDeExtensao } from './ambiente.js';
import { autorizarEscrita } from './autenticacao.js';
import { chaveDoPedido, conferirChaveLocal, rotaSemChave } from './chave-local.js';
import { ErroDaApi } from './erros.js';

const METODOS_DE_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * O que a extensão do navegador pode chamar, por método. Fora disso a origem da extensão é
 * recusada como qualquer outra: ela envia páginas, não lê a biblioteca nem as marcas.
 */
const ROTAS_DA_EXTENSAO: Readonly<Record<string, readonly string[]>> = {
  '/api/importacoes/web': ['GET', 'POST'],
  '/api/documentos': ['POST'],
  // V-W9: a extensão procura o Margem nas portas 8730–8739 e confere a identificação.
  '/api/saude': ['GET'],
};

/** Cabeçalhos que a extensão manda numa escrita; entram na resposta ao preflight do CORS. */
const CABECALHOS_DA_EXTENSAO = 'content-type, x-margem, authorization';

function rotaDaExtensao(metodo: string, caminho: string | undefined): boolean {
  if (caminho === undefined) return false;
  return (ROTAS_DA_EXTENSAO[caminho.replace(/\/+$/, '')] ?? []).includes(metodo);
}

/** A origem é uma das extensões declaradas em `MARGEM_EXTENSOES`. */
export function ehOrigemDeExtensao(origem: string | undefined): boolean {
  return origem !== undefined && origensDeExtensao().includes(origem.toLowerCase());
}

export function conferirOrigem(metodo: string, origem: string | undefined, host: string | undefined, caminho?: string): void {
  const hosts = hostsAceitos();
  if (host === undefined || !hosts.includes(host.toLowerCase())) {
    throw new ErroDaApi(403, 'host_recusado', 'A Margem só atende em loopback ou pelo Tailscale Serve.');
  }
  if (ehOrigemDeExtensao(origem)) {
    if (!rotaDaExtensao(metodo, caminho)) {
      throw new ErroDaApi(403, 'rota_fora_da_extensao', 'A extensão só envia páginas e PDFs para a biblioteca.');
    }
    return;
  }
  if (origem !== undefined && origem !== 'null' && !origensAceitas().includes(origem.toLowerCase())) {
    throw new ErroDaApi(403, 'origem_recusada', 'Origem fora da lista de origens aceitas.');
  }
  // Escrita sem `Origin` (curl, systemd) é permitida; escrita de navegador não é
  // possível sem uma origem declarada, e a origem já foi conferida acima.
  if (METODOS_DE_ESCRITA.has(metodo) && origem === 'null') {
    throw new ErroDaApi(403, 'origem_recusada', 'Origem opaca não pode escrever.');
  }
}

/**
 * CORS só para as extensões declaradas e só nas rotas delas. O leitor web é de mesma origem e
 * não precisa de CORS; nenhuma outra origem recebe `Access-Control-Allow-Origin`.
 */
function permitirExtensao(c: Context, origem: string): void {
  c.header('Access-Control-Allow-Origin', origem);
  c.header('Vary', 'Origin');
}

export function seguranca(chave: string | undefined = chaveLocal()): MiddlewareHandler {
  return async (c, proximo) => {
    // Em produção o `Host` chega no cabeçalho; num `Request` montado à mão ele mora
    // na própria URL. O valor é o mesmo — e é conferido contra a lista de aceitos.
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    const origem = c.req.header('origin');
    const caminho = new URL(c.req.url).pathname;
    if (c.req.method === 'OPTIONS' && origem !== undefined && ehOrigemDeExtensao(origem)) {
      const pedido = (c.req.header('access-control-request-method') ?? '').toUpperCase();
      conferirOrigem(pedido, origem, host, caminho);
      permitirExtensao(c, origem);
      c.header('Access-Control-Allow-Methods', (ROTAS_DA_EXTENSAO[caminho.replace(/\/+$/, '')] ?? []).join(', '));
      c.header('Access-Control-Allow-Headers', CABECALHOS_DA_EXTENSAO);
      c.header('Access-Control-Max-Age', '600');
      return c.body(null, 204);
    }
    conferirOrigem(c.req.method, origem, host, caminho);
    if (origem !== undefined && ehOrigemDeExtensao(origem)) permitirExtensao(c, origem);
    // S-01: com chave local, leitura e escrita exigem a chave (portador ou cookie), depois de Host e Origin.
    if (chave !== undefined && !rotaSemChave(c.req.method, caminho)) conferirChaveLocal(chave, chaveDoPedido(c));
    if (METODOS_DE_ESCRITA.has(c.req.method)) {
      autorizarEscrita({
        margem: c.req.header('x-margem'), autorizacao: c.req.header('authorization'), host,
        loginTailscale: c.req.header('tailscale-user-login'), funil: c.req.header('tailscale-funnel-request'),
        encaminhadoPor: c.req.header('x-forwarded-for'),
      });
    }
    await proximo();
  };
}

/** Tamanho declarado, conferido antes de ler o corpo. */
export function conferirTamanho(declarado: string | undefined, limite: number): void {
  if (declarado === undefined) return;
  const bytes = Number.parseInt(declarado, 10);
  if (Number.isInteger(bytes) && bytes > limite) {
    throw new ErroDaApi(413, 'corpo_grande_demais', `O limite é de ${String(limite)} bytes.`);
  }
}

/**
 * Formulário multipart com teto real: os bytes são contados no fluxo, e o envio que passa do limite é
 * abortado com 413 sem ser lido até o fim — com ou sem `Content-Length` (transferência em pedaços).
 */
export async function lerFormularioLimitado(requisicao: Request, limite: number): Promise<FormData> {
  conferirTamanho(requisicao.headers.get('content-length') ?? undefined, limite);
  if (requisicao.body === null) throw new ErroDaApi(400, 'formulario_invalido', 'Envie um formulário multipart.');
  let recebidos = 0;
  let excedeu = false;
  const contador = new TransformStream<Uint8Array, Uint8Array>({
    transform(pedaco, controle) {
      recebidos += pedaco.byteLength;
      if (recebidos > limite) {
        excedeu = true;
        controle.error(new Error('corpo grande demais'));
        return;
      }
      controle.enqueue(pedaco);
    },
  });
  const limitada = new Request(requisicao.url, {
    method: requisicao.method, headers: requisicao.headers, body: requisicao.body.pipeThrough(contador), duplex: 'half',
  });
  try {
    return await limitada.formData();
  } catch {
    if (excedeu) throw new ErroDaApi(413, 'corpo_grande_demais', `O limite é de ${String(limite)} bytes.`);
    throw new ErroDaApi(400, 'formulario_invalido', 'Envie um formulário multipart.');
  }
}

/** Um PDF começa por `%PDF-` (o padrão tolera lixo antes, até 1024 bytes). */
export function pareceUmPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-', 0, 'latin1');
}

/**
 * CSP da interface. Conferida no Chromium com a interface construída (PDF.js e o worker dele, KaTeX,
 * Mermaid, áudio e vídeo: `node --import tsx tools/conferir-csp.mjs`). `style-src 'unsafe-inline'` é
 * inevitável: o próprio bundle injeta `<style>` e `style="…"`, o KaTeX escreve `style="…"` em cada
 * fórmula e o Mermaid põe um `<style>` dentro do SVG. Script inline continua proibido; o
 * `'wasm-unsafe-eval'` só libera compilar WebAssembly (o PDF.js decodifica JBIG2, JPEG 2000 e ICC em wasm).
 *
 * J109 · Vídeos do YouTube tocam pelo player oficial embutido (a reprodução conta para o canal). O que
 * isso abre é o mínimo: o script da IFrame Player API (`/iframe_api`) e o do widget que ela carrega
 * (`/s/player/…`), ambos em `www.youtube.com`, e a moldura `www.youtube.com/embed/`. Nenhum outro
 * script, nem `connect-src`, nem imagens de fora; o que roda dentro da moldura é do YouTube, isolado
 * pela origem. A interface é uma página só (o roteador é da web), então a regra vale para a página
 * toda; os caminhos é que a restringem.
 */
export const ORIGENS_DO_YOUTUBE = {
  script: ['https://www.youtube.com/iframe_api', 'https://www.youtube.com/s/player/'],
  moldura: ['https://www.youtube.com/embed/'],
} as const;

export const CSP_DA_PAGINA = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${ORIGENS_DO_YOUTUBE.script.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  `frame-src 'self' ${ORIGENS_DO_YOUTUBE.moldura.join(' ')}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** CSP de respostas JSON da API: nada carrega, nada emoldura. */
const CSP_DA_API = "default-src 'none'; frame-ancestors 'none'";

/**
 * Cabeçalhos de segurança de toda resposta: `nosniff`, sem moldura de terceiros, `Referrer-Policy`
 * e, quando o pedido veio por HTTPS (Tailscale Serve), HSTS. A CSP vai na página (HTML) e no JSON;
 * quem já pôs a sua (ilustrações, assets) fica com ela.
 */
export function cabecalhosDeSeguranca(): MiddlewareHandler {
  return async (c, proximo) => {
    await proximo();
    const cabecalhos = c.res.headers;
    cabecalhos.set('X-Content-Type-Options', 'nosniff');
    cabecalhos.set('X-Frame-Options', 'DENY');
    cabecalhos.set('Referrer-Policy', 'same-origin');
    const host = (c.req.header('host') ?? new URL(c.req.url).host).toLowerCase().replace(/:443$/, '');
    const tailscale = hostTailscale();
    if (c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:'
      || (tailscale !== undefined && host === tailscale)) {
      cabecalhos.set('Strict-Transport-Security', 'max-age=31536000');
    }
    if (!cabecalhos.has('Content-Security-Policy')) {
      const tipo = cabecalhos.get('Content-Type') ?? '';
      if (tipo.startsWith('text/html')) cabecalhos.set('Content-Security-Policy', CSP_DA_PAGINA);
      else if (tipo.startsWith('application/json')) cabecalhos.set('Content-Security-Policy', CSP_DA_API);
    }
  };
}
