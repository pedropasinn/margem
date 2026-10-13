/**
 * Execuções do Codex para os avisos da interface:
 *
 *   GET /api/execucoes/ativas    a lista atual (`ExecucoesDoCodexV1`)
 *   GET /api/execucoes/eventos   SSE: um evento `execucoes` com a lista inteira a cada mudança
 *
 * O fluxo acorda com o `NOTIFY margem_evento` (toda mudança de job grava um `evento_job`) ou, na
 * falta dele, a cada intervalo de segurança, e só manda quando a lista muda. Entre mudanças, um
 * comentário SSE a cada intervalo mantém a conexão viva atrás do proxy. Quem não tiver
 * `EventSource` (ou perder o fluxo) consulta `/ativas` periodicamente.
 */
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type pg from 'pg';
import { validarExecucoesDoCodex, type ExecucoesDoCodexV1 } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { listarExecucoes } from '../execucoes/ativas.js';
import type { OuvinteDeEventos } from './ouvinte.js';

export interface ApoioDasExecucoes {
  banco: pg.Pool;
  ouvinte?: OuvinteDeEventos | undefined;
  intervaloMs: number;
}

async function lista(banco: pg.Pool): Promise<ExecucoesDoCodexV1> {
  const valor = await comTransacao(banco, (cliente) => listarExecucoes(cliente));
  // Projeção do próprio serviço: falhar aqui é defeito nosso, e o contrato não pode vazar torto.
  if (!validarExecucoesDoCodex(valor)) throw new Error(`Lista de execuções fora do contrato: ${JSON.stringify(validarExecucoesDoCodex.errors)}`);
  return valor;
}

/** O que muda a lista para quem vê: tudo menos o carimbo da geração. */
function assinatura(valor: ExecucoesDoCodexV1): string {
  return JSON.stringify([valor.execucoes, valor.omitidas]);
}

export function registrarRotasDasExecucoes(api: Hono, apoio: ApoioDasExecucoes): void {
  const { banco, ouvinte, intervaloMs } = apoio;

  api.get('/api/execucoes/ativas', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await lista(banco));
  });

  api.get('/api/execucoes/eventos', (c) => {
    // HEAD chega aqui pelo GET e o Hono descarta o corpo sem cancelá-lo: o laço ficaria pendurado.
    if (c.req.method === 'HEAD') return c.body(null, 200, { 'Content-Type': 'text/event-stream' });
    if (ouvinte) void ouvinte.iniciar();
    // Sem buffer no proxy (nginx/Tailscale Serve respeitam o cabeçalho; os demais ignoram).
    c.header('X-Accel-Buffering', 'no');
    c.header('Cache-Control', 'no-cache');
    return streamSSE(c, async (fluxo) => {
      const parar = new AbortController();
      fluxo.onAbort(() => { parar.abort(); });
      let anterior: string | null = null;
      while (!fluxo.closed && !fluxo.aborted) {
        const proximo = ouvinte?.esperar(intervaloMs, parar.signal);
        const atual = await lista(banco);
        const marca = assinatura(atual);
        if (marca !== anterior) {
          anterior = marca;
          await fluxo.writeSSE({ event: 'execucoes', data: JSON.stringify(atual) });
        } else {
          await fluxo.write(': vivo\n\n');
        }
        if (proximo) await proximo;
        else await fluxo.sleep(intervaloMs);
      }
    });
  });
}
