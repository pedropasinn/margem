/**
 * Limite de requisições em memória: janela fixa de um minuto por IP e por grupo de rotas.
 *
 * Serve para um processo só (a API roda num processo só), sem Redis. Os tetos são folgados para o
 * uso de uma pessoa lendo; o que eles barram é o laço que enfileira IA, sobe arquivo ou abre SSE sem
 * parar. Passou do teto: 429 com `Retry-After` (segundos até a janela virar).
 */
import type { Context, MiddlewareHandler } from 'hono';
import { ErroDaApi } from './erros.js';

export type GrupoDeTaxa = 'ia' | 'envio' | 'eventos';

interface Regra { grupo: GrupoDeTaxa; metodo: string; caminho: RegExp }

const ID = '[^/]+';
/** Rotas que enfileiram trabalho de IA, que recebem arquivos ou importações, e o SSE. */
export const REGRAS_DE_TAXA: readonly Regra[] = [
  ...[
    `/api/documentos/${ID}/leituras`,
    `/api/documentos/${ID}/compreensoes`,
    `/api/compreensoes/${ID}/capitulos/${ID}/(preparar|visita|esquema|leitura-comentada)`,
    `/api/versoes/${ID}/capitulos/${ID}/flashcards`,
    '/api/conversas',
    `/api/conversas/${ID}/mensagens`,
    `/api/anotacoes/${ID}/revisar`,
    '/api/visuais',
    `/api/visuais/${ID}/regenerar`,
    `/api/documentos/${ID}/resolucoes`,
    `/api/resolucoes/${ID}/perguntas`,
    `/api/jobs/${ID}/reenfileirar`,
    `/api/midias/${ID}/conceitos`,
  ].map((caminho) => ({ grupo: 'ia' as const, metodo: 'POST', caminho: new RegExp(`^${caminho}/?$`) })),
  ...[
    '/api/documentos',
    `/api/documentos/${ID}/importar-legado`,
    '/api/importar/horarium',
    `/api/documentos/${ID}/transcricoes-revisadas`,
    `/api/documentos/${ID}/midias`,
  ].map((caminho) => ({ grupo: 'envio' as const, metodo: 'POST', caminho: new RegExp(`^${caminho}/?$`) })),
  { grupo: 'envio', metodo: 'PUT', caminho: /^\/api\/midia\/arquivos\/?$/ },
  { grupo: 'eventos', metodo: 'GET', caminho: /^\/api\/eventos\/?$/ },
];

/** Pedidos por minuto e por IP. */
export const TETOS_POR_MINUTO: Readonly<Record<GrupoDeTaxa, number>> = { ia: 60, envio: 30, eventos: 60 };
/** Conexões SSE abertas ao mesmo tempo por IP. */
export const TETO_DE_EVENTOS_ABERTOS = 20;

const JANELA_MS = 60_000;

/**
 * Endereço de quem pede. Atrás do Tailscale Serve o socket é loopback e o cliente real vem no último
 * `X-Forwarded-For` (o que o proxy acrescentou; os anteriores o cliente pode ter inventado).
 */
export function enderecoDoCliente(c: Context): string {
  const ambiente: unknown = c.env;
  const incoming = typeof ambiente === 'object' && ambiente !== null && 'incoming' in ambiente
    ? (ambiente as { incoming?: { socket?: { remoteAddress?: string } } }).incoming : undefined;
  const socket = incoming?.socket?.remoteAddress ?? 'local';
  const loopback = socket === 'local' || socket === '::1' || socket.startsWith('127.') || socket === '::ffff:127.0.0.1';
  const encaminhado = c.req.header('x-forwarded-for')?.split(',').map((parte) => parte.trim()).filter((parte) => parte !== '').at(-1);
  return loopback && encaminhado !== undefined ? encaminhado : socket;
}

export interface LimiteDeTaxa {
  middleware: MiddlewareHandler;
  /** Conta uma conexão SSE aberta; devolve a função que a desconta. Passou do teto: 429. */
  abrirEventos: (c: Context) => () => void;
}

export function criarLimiteDeTaxa(agora: () => number = Date.now): LimiteDeTaxa {
  const janelas = new Map<string, { inicio: number; total: number }>();
  const abertos = new Map<string, number>();

  function recusar(segundos: number, mensagem: string): never {
    throw new ErroDaApi(429, 'muitas_requisicoes', mensagem, { 'Retry-After': String(Math.max(1, segundos)) });
  }

  const middleware: MiddlewareHandler = async (c, proximo) => {
    const caminho = new URL(c.req.url).pathname;
    const regra = REGRAS_DE_TAXA.find((r) => r.metodo === c.req.method && r.caminho.test(caminho));
    if (regra) {
      const instante = agora();
      if (janelas.size > 10_000) {
        for (const [chave, janela] of janelas) if (instante - janela.inicio >= JANELA_MS) janelas.delete(chave);
      }
      const chave = `${regra.grupo} ${enderecoDoCliente(c)}`;
      let janela = janelas.get(chave);
      if (!janela || instante - janela.inicio >= JANELA_MS) {
        janela = { inicio: instante, total: 0 };
        janelas.set(chave, janela);
      }
      janela.total += 1;
      if (janela.total > TETOS_POR_MINUTO[regra.grupo]) {
        recusar(Math.ceil((janela.inicio + JANELA_MS - instante) / 1000),
          `Muitos pedidos deste tipo (${regra.grupo}) em um minuto. Tente de novo em instantes.`);
      }
    }
    await proximo();
  };

  function abrirEventos(c: Context): () => void {
    const chave = enderecoDoCliente(c);
    const atual = abertos.get(chave) ?? 0;
    if (atual >= TETO_DE_EVENTOS_ABERTOS) recusar(5, 'Conexões de eventos demais abertas ao mesmo tempo.');
    abertos.set(chave, atual + 1);
    let fechado = false;
    return () => {
      if (fechado) return;
      fechado = true;
      const restante = (abertos.get(chave) ?? 1) - 1;
      if (restante <= 0) abertos.delete(chave); else abertos.set(chave, restante);
    };
  }

  return { middleware, abrirEventos };
}
