/**
 * Processo da API. Sobe em 127.0.0.1:8730 (ou `MARGEM_PORTA`; no modo instalado, 0.0.0.0 dentro do container), serve `web/dist`
 * na mesma origem e fala com o Postgres. Não executa nada demorado: o motor
 * Python e o `codex exec` pertencem ao worker, em outro processo.
 */
import { serve } from '@hono/node-server';
import { pool } from './db/conexao.js';
import { prepararBanco } from './db/migrar.js';
import { criarApi } from './http/app.js';
import { servirWeb } from './http/estatico.js';
import { donos, enderecoDeEscuta, hostTailscale, porta, portaPublica } from './http/ambiente.js';
import { ouvinteDoPool } from './http/ouvinte.js';
import { modoInstalado } from './instalacao.js';
import { configuracaoDaCompreensao, configuracaoDaLeitura, escolherExecutor } from './worker/configuracao.js';

export async function principal(): Promise<void> {
  await prepararBanco(pool);
  const executor = await escolherExecutor();
  // SSE por LISTEN/NOTIFY (J14): uma conexão dedicada, fora do pool, com reconexão.
  const ouvinte = ouvinteDoPool(pool, {
    anotar: (evento, detalhe) => {
      console.log(JSON.stringify({ evento: `ouvinte_${evento}`, ...(detalhe ? { detalhe } : {}) }));
    },
  });
  await ouvinte.iniciar();
  const app = criarApi({
    banco: pool, ouvinte, leitura: () => configuracaoDaLeitura({ banco: pool, executor }),
    compreensao: () => configuracaoDaCompreensao({ banco: pool, executor }),
  });
  servirWeb(app);
  const endereco = enderecoDeEscuta();
  const servidor = serve({ fetch: app.fetch, hostname: endereco, port: porta() }, (info) => {
    console.log(JSON.stringify({
      evento: 'api_no_ar', endereco: `http://${endereco}:${String(info.port)}`,
      ...(modoInstalado() ? { modo: 'instalado', abrir: `http://localhost:${String(portaPublica())}` } : {}),
    }));
    if (hostTailscale() !== undefined && donos().length === 0) {
      console.warn(JSON.stringify({ evento: 'sem_donos', detalhe: 'MARGEM_DONOS vazio: nenhuma escrita pelo Tailscale Serve' }));
    }
  });
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sinal, () => {
      servidor.close(() => {
        void ouvinte.encerrar().then(() => pool.end()).finally(() => process.exit(0));
      });
    });
  }
}

const caminho = process.argv[1] ?? '';
if (caminho.endsWith('src/api.ts') || caminho.endsWith('src/api.js')) {
  principal().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : 'falha desconhecida na API');
    process.exitCode = 1;
  });
}
