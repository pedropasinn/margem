/**
 * Harness das rotas de quadros sem banco: as mesmas rotas Hono, lendo o acervo (`MARGEM_ARTE_DIR`) e as
 * fixtures. Para capturas e prévias; não é um segundo backend de produção.
 *
 *   MARGEM_ARTE_PORTA=8746 node --import tsx servico/src/ferramentas/previa-arte.ts
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { registrarRotasDeArte } from '../http/rotas-arte.js';
const app = new Hono();
registrarRotasDeArte(app);
const port = Number(process.env.MARGEM_ARTE_PORTA ?? 8734);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
console.log(`quadros em http://127.0.0.1:${String(port)}/api/arte`);
