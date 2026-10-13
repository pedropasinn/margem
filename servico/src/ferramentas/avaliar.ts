/**
 * Avaliação (J32, `docs/desenho/10-MODELO-DO-CAPITULO.md` §12).
 *
 *   npm run avaliar -- medir --referencia avaliacao/referencias/mixtape-cap3.md --camada <ULID> [--camada <ULID> …]
 *   npm run avaliar -- cega --camadas <A>,<B>
 *   npm run avaliar -- escolher <id> "Leitura 1" ["comentário"]
 *   npm run avaliar -- revelar <id>
 *
 * `medir` compara cada camada com a referência do leitor e, com duas ou mais camadas, mede a
 * estabilidade (use três execuções iguais). `cega` troca o nome das camadas no leitor por “Leitura 1”
 * e “Leitura 2”, sorteados, e guarda o sorteio fora da vista; `revelar` mostra o que era o quê.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import type { Id, LoteDoModeloV1, MarcaV2, ModeloDoCapituloV1 } from '@margem/contratos';
import { capituloDe } from '../compreensao/pipeline.js';
import { comTransacao } from '../db/transacao.js';
import { obterVersao } from '../repos/documentos.js';
import * as marcasRepo from '../repos/marcas.js';
import * as repo from '../repos/compreensao.js';
import { estabilidade, medir, relatorio, type Metricas } from '../avaliacao/metricas.js';
import { lerReferencia, resolverReferencia } from '../avaliacao/referencia.js';

export function raizDaAvaliacao(ambiente: NodeJS.ProcessEnv = process.env): string {
  const base = ambiente.MARGEM_ARTEFATOS;
  return join(base === undefined || base.trim() === '' ? join(homedir(), '.cache/margem') : base, 'avaliacao');
}

interface Camada { id: Id; versao_id: Id; execucao_id: Id | null; rotulo: string | null }

async function camada(banco: pg.Pool, id: Id): Promise<Camada> {
  const linha = (await banco.query<Camada>('SELECT id, versao_id, execucao_id, rotulo FROM camada WHERE id=$1', [id])).rows[0];
  if (!linha) throw new Error(`Camada ${id} não encontrada.`);
  return linha;
}

export interface LeituraDoCapitulo {
  marcas: MarcaV2[];
  revisoes: ModeloDoCapituloV1[];
  lotes: LoteDoModeloV1[];
  custo: { chamadas: number; segundos: number };
}

/** O que uma camada produziu num capítulo: marcas e, se for compreensão, revisões, lotes e custo. */
export async function leituraDoCapitulo(banco: pg.Pool, camadaId: Id, secaoId: Id): Promise<LeituraDoCapitulo> {
  const dados = await camada(banco, camadaId);
  return comTransacao(banco, async (cliente) => {
    const versao = await obterVersao(cliente, dados.versao_id);
    const blocos = new Set(capituloDe(versao.canonico, secaoId).blocos.map((bloco) => bloco.id));
    const marcas = (await marcasRepo.listarV2PorVersao(cliente, dados.versao_id, { camada_id: camadaId })).filter((marca) => blocos.has(marca.ancora.bloco_id));
    const revisoes = dados.execucao_id === null ? [] : await repo.revisoesDoCapitulo(cliente, dados.execucao_id, secaoId);
    const lotes = dados.execucao_id === null ? [] : await repo.lotesDoCapitulo(cliente, dados.execucao_id, secaoId);
    const custo = (await cliente.query<{ chamadas: number; segundos: number }>(`
      SELECT count(DISTINCT j.id)::int AS chamadas,
        COALESCE(sum(EXTRACT(EPOCH FROM (j.atualizado_em - r.quando))), 0)::float8 AS segundos
      FROM job j
      JOIN LATERAL (SELECT max(quando) AS quando FROM evento_job e WHERE e.job_id=j.id AND e.tipo='reservado') r ON true
      LEFT JOIN parte p ON p.id = j.parte_id
      WHERE j.estado='ok' AND j.versao_id=$1 AND (p.execucao_id=$2 OR j.dedup_key LIKE $3)`,
    [dados.versao_id, dados.execucao_id, `%:${dados.execucao_id ?? '-'}:${secaoId}%`])).rows[0] ?? { chamadas: 0, segundos: 0 };
    return { marcas, revisoes, lotes, custo };
  });
}

/** Mede cada camada contra a referência; com duas ou mais, a estabilidade entre elas. */
export async function medirCamadas(banco: pg.Pool, textoDaReferencia: string, camadas: readonly Id[]): Promise<{ texto: string; metricas: Metricas[] }> {
  const referencia = lerReferencia(textoDaReferencia);
  if (referencia.secao_id === null) throw new Error('A referência precisa da linha “secao: <ULID>”.');
  const secaoId = referencia.secao_id;
  const primeira = camadas[0];
  if (primeira === undefined) throw new Error('Informe ao menos uma camada.');
  const versaoId = (await camada(banco, primeira)).versao_id;
  const blocos = await comTransacao(banco, async (cliente) => capituloDe((await obterVersao(cliente, versaoId)).canonico, secaoId).blocos);
  const resolvida = resolverReferencia(referencia, versaoId, blocos);
  const partes: string[] = [`Referência: ${referencia.titulo} · ${String(resolvida.essenciais.length)} essenciais, ${String(resolvida.relacoes.length)} relações, ${String(resolvida.nao_marcar.length)} a não marcar`];
  const metricas: Metricas[] = [];
  const marcasPorCamada: MarcaV2[][] = [];
  for (const id of camadas) {
    const dados = await camada(banco, id);
    if (dados.versao_id !== versaoId) throw new Error(`A camada ${id} é de outra versão do texto.`);
    const leitura = await leituraDoCapitulo(banco, id, secaoId);
    const medida = medir(resolvida, leitura);
    metricas.push(medida);
    marcasPorCamada.push(leitura.marcas);
    partes.push('', relatorio(dados.rotulo ?? id, medida), `Custo: ${String(leitura.custo.chamadas)} chamadas, ${leitura.custo.segundos.toFixed(0)} s`);
  }
  if (camadas.length >= 2) {
    const estavel = estabilidade(marcasPorCamada);
    partes.push('', `Estabilidade (Jaccard das marcas de saliência ≤ 2): média ${estavel.media === null ? '—' : estavel.media.toFixed(2)}, mínimo ${estavel.minimo === null ? '—' : estavel.minimo.toFixed(2)}${camadas.length < 3 ? ' · meça com três execuções iguais' : ''}`);
  }
  return { texto: partes.join('\n'), metricas };
}

interface Sorteio { id: string; criada_em: string; camadas: Record<string, Id>; escolha?: { rotulo: string; comentario: string; em: string } }

function caminhoDoSorteio(raiz: string, id: string): string { return join(raiz, `cega-${id}.json`); }

/** Sorteia “Leitura 1” e “Leitura 2” entre as camadas, grava os rótulos e guarda o sorteio fora da vista. */
export async function comecarComparacaoCega(banco: pg.Pool, camadas: readonly Id[], raiz: string, sortear: (n: number) => number = randomInt): Promise<Sorteio> {
  if (camadas.length < 2 || new Set(camadas).size !== camadas.length) throw new Error('A comparação cega precisa de duas ou mais camadas diferentes.');
  const versoes = new Set<string>();
  for (const id of camadas) versoes.add((await camada(banco, id)).versao_id);
  if (versoes.size !== 1) throw new Error('As camadas precisam ser da mesma versão do texto.');
  const embaralhadas = [...camadas];
  for (let i = embaralhadas.length - 1; i > 0; i -= 1) {
    const j = sortear(i + 1);
    [embaralhadas[i], embaralhadas[j]] = [embaralhadas[j] ?? '', embaralhadas[i] ?? ''];
  }
  const sorteio: Sorteio = { id: randomUUID().slice(0, 8), criada_em: new Date().toISOString(), camadas: {} };
  await comTransacao(banco, async (cliente) => {
    for (const [indice, id] of embaralhadas.entries()) {
      const rotulo = `Leitura ${String(indice + 1)}`;
      sorteio.camadas[rotulo] = id;
      await cliente.query('UPDATE camada SET rotulo=$2 WHERE id=$1', [id, rotulo]);
    }
  });
  await mkdir(raiz, { recursive: true, mode: 0o700 });
  await writeFile(caminhoDoSorteio(raiz, sorteio.id), JSON.stringify(sorteio, null, 2), { mode: 0o600 });
  return sorteio;
}

export async function registrarEscolha(raiz: string, id: string, rotulo: string, comentario = ''): Promise<void> {
  const sorteio = JSON.parse(await readFile(caminhoDoSorteio(raiz, id), 'utf8')) as Sorteio;
  if (!(rotulo in sorteio.camadas)) throw new Error(`Use um destes rótulos: ${Object.keys(sorteio.camadas).join(', ')}.`);
  sorteio.escolha = { rotulo, comentario, em: new Date().toISOString() };
  await writeFile(caminhoDoSorteio(raiz, id), JSON.stringify(sorteio, null, 2), { mode: 0o600 });
}

/** Mostra o sorteio e a escolha e devolve os nomes normais às camadas. */
export async function revelar(banco: pg.Pool, raiz: string, id: string): Promise<string> {
  const sorteio = JSON.parse(await readFile(caminhoDoSorteio(raiz, id), 'utf8')) as Sorteio;
  await comTransacao(banco, async (cliente) => {
    for (const camadaId of Object.values(sorteio.camadas)) await cliente.query('UPDATE camada SET rotulo=NULL WHERE id=$1', [camadaId]);
  });
  const linhas = Object.entries(sorteio.camadas).map(([rotulo, camadaId]) => `${rotulo} = ${camadaId}${sorteio.escolha?.rotulo === rotulo ? '  ← a escolhida' : ''}`);
  if (sorteio.escolha?.comentario) linhas.push(`Comentário: ${sorteio.escolha.comentario}`);
  if (!sorteio.escolha) linhas.push('Nenhuma escolha registrada.');
  return linhas.join('\n');
}

function valor(argv: readonly string[], nome: string): string[] {
  const valores: string[] = [];
  argv.forEach((item, indice) => { if (item === `--${nome}`) { const proximo = argv[indice + 1]; if (proximo !== undefined) valores.push(proximo); } });
  return valores;
}

export async function principal(argv: readonly string[] = process.argv.slice(2)): Promise<string> {
  const { pool } = await import('../db/conexao.js');
  const raiz = raizDaAvaliacao();
  try {
    const [comando, a, b, c] = argv;
    switch (comando) {
      case 'medir': {
        const [referencia] = valor(argv, 'referencia');
        if (referencia === undefined) throw new Error('uso: medir --referencia <arquivo.md> --camada <id> [--camada <id> …]');
        return (await medirCamadas(pool, await readFile(referencia, 'utf8'), valor(argv, 'camada'))).texto;
      }
      case 'cega': {
        const [lista] = valor(argv, 'camadas');
        const sorteio = await comecarComparacaoCega(pool, (lista ?? '').split(',').filter((item) => item !== ''), raiz);
        return `Comparação ${sorteio.id}: no leitor, escolha entre ${Object.keys(sorteio.camadas).join(' e ')}. Depois: avaliar escolher ${sorteio.id} "Leitura N" "comentário".`;
      }
      case 'escolher':
        if (a === undefined || b === undefined) throw new Error('uso: escolher <id> "Leitura N" ["comentário"]');
        await registrarEscolha(raiz, a, b, c);
        return `Escolha registrada. Para ver qual era qual: avaliar revelar ${a}`;
      case 'revelar':
        if (a === undefined) throw new Error('uso: revelar <id>');
        return await revelar(pool, raiz, a);
      default:
        return 'uso: avaliar medir | cega | escolher | revelar (veja o cabeçalho de servico/src/ferramentas/avaliar.ts)';
    }
  } finally {
    await pool.end();
  }
}

const caminho = process.argv[1] ?? '';
if (caminho.endsWith('ferramentas/avaliar.ts') || caminho.endsWith('ferramentas/avaliar.js')) {
  principal().then((texto) => { console.log(texto); }, (erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : 'falha desconhecida na avaliação');
    process.exitCode = 1;
  });
}
