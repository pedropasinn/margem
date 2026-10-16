/**
 * S-01 · Chave local por instalação. Loopback não separa as contas de um mesmo computador: sem chave,
 * um processo de outra conta lia a biblioteca e apagava marcas pela porta local. Com
 * `MARGEM_CHAVE_LOCAL` (o app de computador sempre define), toda rota `/api/*` exige a chave, inclusive
 * os GETs, menos a saúde (a extensão e o app procuram o Margem por ela; ela só diz quem responde) e a
 * própria troca da chave pelo cookie. Host, Origin e `X-Margem` continuam conferidos antes.
 *
 * Onde a chave vem:
 * - `Authorization: Bearer <chave>`: a extensão do navegador, o plugin do Obsidian e o processo
 *   principal do app (exportação para o Obsidian). A chave aparece nas Configurações para copiar.
 * - Cookie `margem_chave`: a janela do app. O processo principal entrega a chave à página pelo preload, e
 *   a página faz `POST /api/sessao` com ela; a API responde com o cookie `HttpOnly; SameSite=Strict`
 *   para a própria origem. Daí em diante tudo que a página carrega sem `fetch` (o PDF original, o
 *   `EventSource` do SSE, que não manda cabeçalho, imagens, áudio e vídeo) leva a chave sozinho. Foi a
 *   escolha mais simples que cobre tudo: parâmetro de consulta só para o SSE deixaria de fora mídia e
 *   PDF, e a chave numa URL acaba em histórico e registros. O cookie não é legível pelo JavaScript da
 *   página, e `SameSite=Strict` não o manda em pedidos iniciados por outro site.
 *
 * Sem a variável, nada muda (desenvolvimento, Docker, um servidor pessoal).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { ErroDaApi } from './erros.js';

export const COOKIE_DA_CHAVE = 'margem_chave';

/** Sem chave: a saúde (descoberta) e a troca da chave pelo cookie, que confere a chave ela mesma. */
const ROTAS_SEM_CHAVE: Readonly<Record<string, readonly string[]>> = {
  '/api/saude': ['GET', 'HEAD'],
  '/api/sessao': ['POST'],
};

export function rotaSemChave(metodo: string, caminho: string): boolean {
  return (ROTAS_SEM_CHAVE[caminho.replace(/\/+$/, '')] ?? []).includes(metodo);
}

function iguais(recebida: string, chave: string): boolean {
  const a = createHash('sha256').update(recebida).digest();
  const b = createHash('sha256').update(chave).digest();
  return timingSafeEqual(a, b);
}

function doPortador(autorizacao: string | undefined): string | undefined {
  const achado = /^Bearer\s+(\S+)\s*$/iu.exec(autorizacao ?? '');
  return achado?.[1];
}

/** A chave do pedido (portador ou cookie) confere? Lança 401 `chave_local` quando não. */
export function conferirChaveLocal(chave: string, pedido: { autorizacao: string | undefined; cookie: string | undefined }): void {
  const recebida = doPortador(pedido.autorizacao) ?? pedido.cookie;
  if (recebida === undefined || recebida === '' || !iguais(recebida, chave)) {
    throw new ErroDaApi(401, 'chave_local', 'Este Margem exige a chave da biblioteca (Configurações → Chave para a extensão e o Obsidian).');
  }
}

/** Lê a chave do pedido de um contexto do Hono. */
export function chaveDoPedido(c: Parameters<typeof getCookie>[0]): { autorizacao: string | undefined; cookie: string | undefined } {
  return { autorizacao: c.req.header('authorization'), cookie: getCookie(c, COOKIE_DA_CHAVE) };
}

/**
 * `POST /api/sessao` com `Authorization: Bearer <chave>` (e o `X-Margem` de toda escrita): devolve o
 * cookie da chave para a origem da página. Sem chave configurada, 404 (não há o que trocar).
 */
export function registrarSessao(api: Hono, chave: string | undefined): void {
  api.post('/api/sessao', (c) => {
    if (chave === undefined) throw new ErroDaApi(404, 'sem_chave_local', 'Este Margem não usa chave local.');
    conferirChaveLocal(chave, { autorizacao: c.req.header('authorization'), cookie: undefined });
    setCookie(c, COOKIE_DA_CHAVE, chave, { path: '/api', httpOnly: true, sameSite: 'Strict' });
    return c.body(null, 204);
  });
}
