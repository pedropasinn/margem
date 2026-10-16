/**
 * Enquanto a API migra o banco (D-02), a porta já responde: `GET /api/saude` devolve 503 com
 * `estado: 'migrando'` e a identificação de sempre, e o resto devolve 503 `migrando`. Quem espera a
 * API (o app de computador, a extensão) sabe que ela está viva e trabalhando, em vez de desistir no
 * prazo de subida. Terminada a migração, este servidor fecha e a API de verdade ocupa a porta.
 */
import { createServer, type Server } from 'node:http';
import { identidadeDaSaude } from '../instancia.js';

export interface ServidorDeMigracao {
  /** Porta em que respondeu (útil com porta 0). */
  readonly porta: number;
  fechar(): Promise<void>;
}

export async function servirMigrando(opcoes: {
  endereco: string; porta: number; pendentes: readonly string[]; ambiente?: NodeJS.ProcessEnv;
}): Promise<ServidorDeMigracao> {
  const identidade = identidadeDaSaude(opcoes.ambiente);
  const desde = new Date().toISOString();
  const servidor: Server = createServer((pedido, resposta) => {
    const saude = (pedido.url ?? '').split('?')[0] === '/api/saude';
    const corpo = saude
      ? { ok: false, estado: 'migrando', desde, migracoes: opcoes.pendentes.length, ...identidade }
      : { erro: 'migrando', detalhe: 'A biblioteca está sendo atualizada. Aguarde alguns instantes.' };
    // Sem CORS: nenhuma origem de fora recebe nada enquanto migra.
    resposta.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '2' });
    resposta.end(JSON.stringify(corpo));
  });
  await new Promise<void>((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(opcoes.porta, opcoes.endereco, () => { servidor.off('error', rejeitar); resolver(); });
  });
  const endereco = servidor.address();
  return {
    porta: typeof endereco === 'object' && endereco !== null ? endereco.port : opcoes.porta,
    fechar: () => new Promise<void>((resolver) => {
      servidor.closeAllConnections();
      servidor.close(() => { resolver(); });
    }),
  };
}
