/**
 * Processo da API. Sobe em 127.0.0.1:8730 (ou `MARGEM_PORTA`; no modo instalado, 0.0.0.0 dentro do container), serve `web/dist`
 * na mesma origem e fala com o Postgres. Não executa nada demorado: o motor
 * Python e o `codex exec` pertencem ao worker, em outro processo.
 */
import { serve } from '@hono/node-server';
import { pool } from './db/conexao.js';
import { BancoMaisNovo, prepararBanco } from './db/migrar.js';
import { criarApi } from './http/app.js';
import { servirWeb } from './http/estatico.js';
import { servirMigrando, type ServidorDeMigracao } from './http/migrando.js';
import { donos, enderecoDeEscuta, hostTailscale, porta, portaPublica } from './http/ambiente.js';
import { ouvinteDoPool } from './http/ouvinte.js';
import { modoInstalado } from './instalacao.js';
import { aoPedirParada, ehPontoDeEntrada } from './plataforma/processos.js';
import { configuracaoDaCompreensao, configuracaoDaLeitura, escolherExecutor } from './worker/configuracao.js';

/**
 * Migra antes de abrir a API. Com migração pendente, a porta já responde `migrando` (D-02) e o
 * processo anuncia `migracao_inicio`/`migracao_fim` no stdout; banco de versão mais nova
 * (`BancoMaisNovo`, D-07) sai com `banco_mais_novo` antes de qualquer escrita.
 */
async function prepararComSinal(endereco: string, portaDaApi: number): Promise<void> {
  let sinal: ServidorDeMigracao | undefined;
  let inicio: number | undefined;
  try {
    await prepararBanco(pool, process.env, {
      aoMigrar: async (pendentes) => {
        inicio = Date.now();
        console.log(JSON.stringify({ evento: 'migracao_inicio', pendentes: pendentes.length, ultima: pendentes.at(-1) ?? null }));
        // Porta ocupada (outra API ainda saindo) não impede a migração: só não haverá o sinal HTTP.
        sinal = await servirMigrando({ endereco, porta: portaDaApi, pendentes }).catch(() => undefined);
      },
    });
    if (inicio !== undefined) console.log(JSON.stringify({ evento: 'migracao_fim', duracao_ms: Date.now() - inicio }));
  } catch (erro) {
    if (erro instanceof BancoMaisNovo) {
      console.error(JSON.stringify({ evento: 'banco_mais_novo', migracoes: erro.desconhecidas }));
    }
    throw erro;
  } finally {
    await sinal?.fechar();
  }
}

export async function principal(): Promise<void> {
  await prepararComSinal(enderecoDeEscuta(), porta());
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
  let parando = false;
  aoPedirParada(() => {
    if (parando) return;
    parando = true;
    servidor.close(() => {
      void ouvinte.encerrar().then(() => pool.end()).finally(() => process.exit(0));
    });
  });
}

if (ehPontoDeEntrada(['src/api.ts', 'src/api.js'])) {
  principal().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : 'falha desconhecida na API');
    process.exitCode = 1;
  });
}
