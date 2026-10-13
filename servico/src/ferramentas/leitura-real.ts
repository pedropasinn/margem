/**
 * Leitura de **uma** parte por vez, para gastar uma chamada só do Codex.
 *
 * `POST /api/documentos/:id/leituras` planeja o livro inteiro: no Mixtape isso seriam
 * vinte e uma chamadas. Esta ferramenta cria a mesma execução, mas grava apenas as
 * partes de um capítulo escolhido, mais o job de revisão de consistência que depende
 * delas. Daí em diante quem trabalha é o worker de sempre — nada aqui executa o Codex.
 *
 *   node --import tsx servico/src/ferramentas/leitura-real.ts --versao <ULID> --capitulo <ULID> [--seco] [--refazer]
 *
 * `--seco` mostra o plano e não grava nada. `--refazer` devolve à fila o job de uma
 * parte que já existe e terminou em `falhou` ou `cancelado`: o `dedup_key` é o hash da
 * entrada, então repetir o comando sozinho não cria job novo (e não deve mesmo criar).
 */
import { ulid } from 'ulid';
import type { ExecucaoLeituraV1, Id, ParteV1 } from '@margem/contratos';
import { pool } from '../db/conexao.js';
import { comTransacao } from '../db/transacao.js';
import { obterVersao } from '../repos/documentos.js';
import * as execucoesRepo from '../repos/execucoes.js';
import * as jobsRepo from '../repos/jobs.js';
import * as partesRepo from '../repos/partes.js';
import { planejarLeitura } from '../leitura/partes.js';
import { TIPO_LER_PARTE, TIPO_REVISAR } from '../leitura/manipuladores.js';
import { configuracaoDaLeitura } from '../worker/configuracao.js';
import { sha256 } from '../executor/artefato.js';

function argumento(nome: string): string | undefined {
  const indice = process.argv.indexOf(`--${nome}`);
  if (indice === -1) return undefined;
  return process.argv[indice + 1];
}

async function principal(): Promise<void> {
  const versaoId = argumento('versao');
  const capituloId = argumento('capitulo');
  const seco = process.argv.includes('--seco');
  const refazer = process.argv.includes('--refazer');
  if (versaoId === undefined || capituloId === undefined) {
    throw new Error('uso: --versao <ULID> --capitulo <ULID> [--seco]');
  }

  // O executor não é montado aqui: esta ferramenta só escreve no banco.
  const config = configuracaoDaLeitura({ banco: pool, executor: () => { throw new Error('sem executor'); } });

  const resumo = await comTransacao(pool, async (cliente) => {
    const versao = await obterVersao(cliente, versaoId);
    const execucaoId = ulid();
    const plano = planejarLeitura(versao.canonico, {
      execucao_id: execucaoId, versoes: config.versoes, textos: config.textos,
      ...(config.tamanho_parte_tokens === undefined ? {} : { tamanho_parte_tokens: config.tamanho_parte_tokens }),
    });
    const escolhidas: ParteV1[] = plano.partes
      .filter((parte) => plano.capituloDaParte.get(parte.ordem) === capituloId)
      .map((parte, ordem) => ({ ...parte, ordem }));
    if (escolhidas.length === 0) throw new Error(`nenhuma parte do plano cai no capítulo ${capituloId}`);

    // Quando os jobs daquelas partes já existem (o `dedup_key` é o hash da entrada),
    // a execução também já existe: criar outra deixaria uma execução órfã, com partes
    // sem job e um job de revisão que adia para sempre.
    const existentes = (await cliente.query<{ id: Id; estado: string; parte_id: Id | null }>(
      'SELECT id, estado, parte_id FROM job WHERE dedup_key = ANY($1::text[])',
      [escolhidas.map((parte) => parte.hash_entrada)])).rows;
    const jaExiste = existentes.length === escolhidas.length && escolhidas.length > 0;

    const secao = versao.canonico.secoes.find((candidata) => candidata.id === capituloId);
    const blocos = new Set(escolhidas.flatMap((parte) => parte.blocos_responsaveis));
    const caracteres = versao.canonico.blocos
      .filter((bloco) => blocos.has(bloco.id))
      .reduce((total, bloco) => total + bloco.texto.length, 0);

    if (seco) {
      return {
        seco: true, execucao_id: null, capitulo: secao?.titulo ?? '?', reaproveitada: jaExiste,
        partes: escolhidas.length, blocos: blocos.size, caracteres, jobs: [] as string[],
      };
    }

    if (jaExiste) {
      const primeiro = existentes[0];
      const dona = primeiro?.parte_id === undefined || primeiro.parte_id === null ? null
        : (await cliente.query<{ execucao_id: Id }>(
          'SELECT execucao_id FROM parte WHERE id=$1', [primeiro.parte_id])).rows[0]?.execucao_id ?? null;
      const jobs: string[] = [];
      for (const job of existentes) {
        let estado = job.estado;
        if (refazer && (job.estado === 'falhou' || job.estado === 'cancelado')) {
          await cliente.query(
            `UPDATE job SET estado='fila', attempt=attempt+1, error_code=NULL, not_before=NULL,
               cancel_requested_at=NULL, atualizado_em=clock_timestamp() WHERE id=$1`, [job.id]);
          await cliente.query(
            `INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,'refeito','{}'::jsonb)`, [job.id]);
          estado = 'fila';
        }
        jobs.push(`ler_parte ${job.id} (${estado})`);
      }
      if (dona !== null) {
        // A revisão de consistência da execução original volta a poder rodar.
        await cliente.query(
          `UPDATE job SET not_before=NULL WHERE tipo=$2 AND dedup_key=$1 AND estado='adiado'`,
          [`revisao:${dona}`, TIPO_REVISAR]);
      }
      return {
        seco: false, execucao_id: dona, capitulo: secao?.titulo ?? '?', reaproveitada: true,
        partes: escolhidas.length, blocos: blocos.size, caracteres, jobs,
      };
    }

    const execucao: ExecucaoLeituraV1 = {
      id: execucaoId, versao_id: versaoId,
      metodo_versao: config.versoes.metodo_versao,
      prompt_versao: config.versoes.prompt_versao,
      schema_versao: 1,
      modelo: config.modelo, esforco: config.esforco,
      tamanho_parte_tokens: config.tamanho_parte_tokens ?? 45_000,
      concorrencia: 1,
      plano_partes: escolhidas.map((parte) => parte.id),
      criada_em: new Date().toISOString(),
    };
    await execucoesRepo.criar(cliente, execucao);
    await partesRepo.criar(cliente, execucaoId, escolhidas);
    const jobs: string[] = [];
    for (const parte of escolhidas) {
      const job = await jobsRepo.enfileirar(cliente, {
        tipo: TIPO_LER_PARTE, dedup_key: parte.hash_entrada,
        input_snapshot_hash: parte.hash_entrada, parte_id: parte.id,
      });
      jobs.push(`${job.tipo} ${job.id} (${job.estado})`);
    }
    const revisao = await jobsRepo.enfileirar(cliente, {
      tipo: TIPO_REVISAR, dedup_key: `revisao:${execucaoId}`,
      input_snapshot_hash: sha256(execucaoId), versao_id: versaoId,
    });
    jobs.push(`${revisao.tipo} ${revisao.id}`);
    return {
      seco: false, execucao_id: execucaoId, capitulo: secao?.titulo ?? '?', reaproveitada: false,
      partes: escolhidas.length, blocos: blocos.size, caracteres, jobs,
    };
  });

  console.log(JSON.stringify(resumo, null, 2));
}

try {
  await principal();
} finally {
  await pool.end();
}
