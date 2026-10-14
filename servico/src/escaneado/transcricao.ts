/**
 * PDF escaneado: transcrição por visão pelo app. Antes, só pelo operador (`tools/camada-da-transcricao.py`,
 * 27/09). Uma página sem camada de texto vira o limite `sem_texto` do motor; o botão "transcrever" do
 * documento enfileira o job `transcrever_escaneado`, que faz o que o operador fazia:
 *
 * 1. renderiza as páginas sem texto (`tools/renderizar-paginas.py`, 150 dpi em cinza);
 * 2. pede a transcrição de cada página ao executor Codex com a imagem anexada (`transcrever-pagina@1`),
 *    guardando cada resposta em `paginas/NNN.json` (uma nova tentativa não repete as páginas prontas);
 * 3. grava a camada invisível alinhada sobre o original (`tools/camada-da-transcricao.py`, sem mudança
 *    no algoritmo), num PDF novo endereçado pelo hash: `<documento>/transcricao/<sha>.pdf`;
 * 4. canoniza esse PDF com o motor e publica uma versão NOVA do mesmo documento (versões são imutáveis;
 *    a anterior fica, como na transcrição revisada do J90).
 *
 * A imagem das páginas é a mesma do original; `GET /api/documentos/:id/original` passa a servir o PDF
 * com a camada quando a última versão vem dele, para a seleção da PDF.js achar o texto.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { renomearComRetentativa } from '../plataforma/disco.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { validarCanonico, type CanonicoV1, type Id, type JobResultV1 } from '@margem/contratos';
import { pastaDaTentativaDeCanonizacao, pastaDoDocumento, raizDoRepositorio } from '../dados.js';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { interpretarJson, lerJsonLimitado, lerTextoLimitado, ORCAMENTOS } from '../entrada-json.js';
import { sha256 } from '../executor/artefato.js';
import { ambienteSaneado } from '../executor/ambiente.js';
import { comandoDoMotor, type ComandoDoMotor } from '../plataforma/executaveis.js';
import { encerrarArvore, opcoesDeProcesso } from '../plataforma/processos.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { corpoDoModelo, ehObjeto, lerPrompt } from '../leitura/v2/prompt.js';
import * as documentos from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { reconciliarCanonizacao } from '../worker/arquivos-canonizacao.js';
import { exigirTransacao, publicarCanonizacao, rodarMotor } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';

export const TIPO_TRANSCREVER_ESCANEADO = 'transcrever_escaneado';
export const VERSAO_PROMPT_TRANSCRICAO = 'transcrever-pagina@1';
const ARQUIVO_DA_PAGINA = 'pagina.png';

/** Páginas que o motor relatou sem texto extraível ("sem_texto: Página PDF 3 sem texto…"). */
export function paginasSemTexto(limites: readonly string[]): number[] {
  return limites.flatMap((limite) => {
    const achado = /^sem_texto: Página PDF (\d+) /u.exec(limite);
    return achado ? [Number(achado[1])] : [];
  });
}

/** O PDF com a camada de texto, ao lado do original, pelo hash dos bytes. */
export function caminhoDaCamada(documentoId: Id, sha: string): string {
  if (!/^[0-9a-f]{64}$/u.test(sha)) throw new Error('Hash da camada inválido.');
  return join(pastaDoDocumento(documentoId), 'transcricao', `${sha}.pdf`);
}

/** Trabalho de um job (imagens e respostas por página): estável entre tentativas, para não pagar de novo. */
function pastaDoTrabalho(documentoId: Id, jobId: Id): string {
  return join(pastaDoDocumento(documentoId), 'transcricao', `job-${jobId}`);
}

export type CodigoDaTranscricao = 'documento_inexistente' | 'nao_e_pdf' | 'sem_versao' | 'nada_a_transcrever';
export class ErroDaTranscricao extends Error {
  constructor(readonly codigo: CodigoDaTranscricao, mensagem: string) { super(mensagem); }
}

/** Enfileira a transcrição das páginas sem texto da última versão. Idempotente pela versão. */
export async function enfileirarTranscricao(cliente: Transacao, documentoId: Id): Promise<{ job: jobsRepo.Job; paginas: number }> {
  const documento = (await cliente.query<{ formato: string }>('SELECT formato FROM documento WHERE id=$1', [documentoId])).rows[0];
  if (!documento) throw new ErroDaTranscricao('documento_inexistente', 'Documento inexistente.');
  if (documento.formato !== 'pdf') throw new ErroDaTranscricao('nao_e_pdf', 'Só PDF tem páginas a transcrever.');
  const versao = (await cliente.query<{ id: Id; limites: string[] }>(`SELECT id, canonico->'limites' AS limites
    FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1`, [documentoId])).rows[0];
  if (!versao) throw new ErroDaTranscricao('sem_versao', 'O documento ainda não foi canonizado.');
  const paginas = paginasSemTexto(versao.limites);
  if (paginas.length === 0) throw new ErroDaTranscricao('nada_a_transcrever', 'Todas as páginas já têm texto.');
  const job = await jobsRepo.enfileirar(cliente, {
    tipo: TIPO_TRANSCREVER_ESCANEADO, dedup_key: `${TIPO_TRANSCREVER_ESCANEADO}:${versao.id}`,
    input_snapshot_hash: sha256(`${versao.id}:${paginas.join(',')}`),
    documento_id: documentoId, versao_id: versao.id, prioridade: jobsRepo.PRIORIDADE.artefato_pedido,
  });
  return { job, paginas: paginas.length };
}

export interface OpcoesDaTranscricao {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  raiz?: string;
  /** Prazo de cada chamada ao Codex e de cada subprocesso Python. */
  prazoMs?: number;
  /** Python com numpy e pymupdf para a camada (testes). Sem ele: o motor congelado (`MARGEM_MOTOR`), `MARGEM_PYTHON_CAMADA` ou o do motor. */
  python?: string;
  /** Script da camada (padrão `tools/camada-da-transcricao.py`); os testes trocam por um sem numpy. */
  scriptDaCamada?: string;
  diretorioArtefatos?: string;
}

/** Roda um subcomando do motor (script de `tools/`) e devolve a cauda do stderr quando falha. */
function rodarPython(comando: ComandoDoMotor, prazoMs: number, sinal: AbortSignal): Promise<string | null> {
  return new Promise((resolver) => {
    const processo = spawn(comando.programa, comando.argumentos, { cwd: comando.cwd, env: ambienteSaneado(), stdio: ['ignore', 'ignore', 'pipe'], ...opcoesDeProcesso() });
    let erro = '';
    processo.stderr.setEncoding('utf8');
    processo.stderr.on('data', (pedaco: string) => { erro = `${erro}${pedaco}`.slice(-2_000); });
    const matar = () => { void encerrarArvore(processo, 'forcado'); };
    const prazo = setTimeout(matar, prazoMs);
    sinal.addEventListener('abort', matar, { once: true });
    const fim = (mensagem: string | null) => { clearTimeout(prazo); sinal.removeEventListener('abort', matar); resolver(mensagem); };
    processo.on('error', (falha) => { fim(falha.message); });
    processo.on('close', (codigo) => {
      fim(codigo === 0 ? null : (erro.trim().split('\n').at(-1) ?? `saiu com código ${String(codigo)}`));
    });
  });
}

function schemaDaTranscricao(): Record<string, unknown> {
  const valor: unknown = JSON.parse(lerPrompt(`${VERSAO_PROMPT_TRANSCRICAO}.schema.json`));
  if (!ehObjeto(valor)) throw new Error('Schema da transcrição não é um objeto.');
  return valor;
}

async function existe(caminho: string): Promise<boolean> {
  try { return (await stat(caminho)).isFile(); } catch { return false; }
}

/** Uma página: a imagem vai anexada; a resposta fica em `paginas/NNN.json` no formato que a camada lê. */
async function transcreverPagina(opcoes: OpcoesDaTranscricao, imagem: string, destino: string, sinal: AbortSignal): Promise<ResultadoExecutor> {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-transcricao-'));
  try {
    const preparada = await prepararEntrada(raiz, corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_TRANSCRICAO}.md`)), schemaDaTranscricao());
    await copyFile(imagem, join(preparada.diretorioEntrada, ARQUIVO_DA_PAGINA));
    const resultado = await opcoes.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: opcoes.prazoMs ?? 600_000, modelo: opcoes.modelo, esforco: opcoes.esforco, imagens: [ARQUIVO_DA_PAGINA], sinal,
      ...(opcoes.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: opcoes.diretorioArtefatos }),
    });
    if (resultado.estado !== 'ok') return resultado;
    const pagina: unknown = await lerJsonLimitado(resultado.artefato, ORCAMENTOS.resposta);
    const provisorio = `${destino}.parcial`;
    await writeFile(provisorio, JSON.stringify({ pagina, modelo: resultado.modelo, esforco: resultado.esforco ?? opcoes.esforco }), { mode: 0o600 });
    await renomearComRetentativa(provisorio, destino);
    return resultado;
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

/** Job `transcrever_escaneado`: páginas → Codex com imagem → camada invisível → canônico do PDF com camada. */
export function manipuladorTranscreverEscaneado(opcoes: OpcoesDaTranscricao): Manipulador {
  const raiz = opcoes.raiz ?? raizDoRepositorio();
  // Os testes trocam o Python e o script da camada; o resto passa pela resolução do motor (J114).
  const comandoDaCamada = (argumentos: string[]): ComandoDoMotor => opcoes.python === undefined && opcoes.scriptDaCamada === undefined
    ? comandoDoMotor('camada-da-transcricao', argumentos, { raiz })
    : { ...comandoDoMotor('camada-da-transcricao', argumentos, { raiz, ...(opcoes.python === undefined ? {} : { python: opcoes.python }) }),
      ...(opcoes.scriptDaCamada === undefined ? {} : { argumentos: [opcoes.scriptDaCamada, ...argumentos] }) };
  const prazo = opcoes.prazoMs ?? 1_800_000;
  return {
    async executar(tarefa: Tarefa): Promise<ResultadoExecutor> {
      const inicio = Date.now();
      const decorrido = () => Date.now() - inicio;
      if (tarefa.sinal.aborted) return falhou('cancelado', 'Transcrição cancelada.', 0);
      const { documento_id: documentoId, versao_id: versaoId } = entradaDoJob(tarefa.job.entrada);
      if (documentoId === null || versaoId === null) return falhou('desconhecido', 'Job de transcrição sem documento ou versão.', 0);
      const documento = (await opcoes.banco.query<documentos.Documento>('SELECT * FROM documento WHERE id=$1', [documentoId])).rows[0];
      if (!documento) return falhou('desconhecido', 'Documento inexistente.', 0);
      const versao = await comTransacao(opcoes.banco, (cliente) => documentos.obterVersao(cliente, versaoId));
      const paginas = paginasSemTexto(versao.canonico.limites);
      if (paginas.length === 0) return falhou('desconhecido', 'A versão não tem página sem texto.', 0);

      const trabalho = pastaDoTrabalho(documentoId, tarefa.job.id);
      const imagens = join(trabalho, 'imagens');
      const respostas = join(trabalho, 'paginas');
      await mkdir(respostas, { recursive: true, mode: 0o700 });
      const renderizacao = await rodarPython(comandoDoMotor('renderizar-paginas', [documento.origem_caminho, imagens, paginas.join(',')], { raiz }),
        prazo, tarefa.sinal);
      if (renderizacao !== null) return falhou(tarefa.sinal.aborted ? 'cancelado' : 'processo', `Renderização das páginas: ${renderizacao}`, decorrido());

      let modelo = opcoes.modelo;
      for (const numero of paginas) {
        const nome = `${String(numero).padStart(3, '0')}`;
        const destino = join(respostas, `${nome}.json`);
        if (await existe(destino)) continue;
        const resultado = await transcreverPagina(opcoes, join(imagens, `${nome}.png`), destino, tarefa.sinal);
        // Cota (adiado), login ou falha: o job para aqui; as páginas prontas ficam para a próxima tentativa.
        if (resultado.estado !== 'ok') return resultado.estado === 'adiado' ? resultado : { ...resultado, mensagem: `Página ${String(numero)}: ${resultado.mensagem}` };
        modelo = resultado.modelo;
      }

      const camada = join(trabalho, 'camada.pdf');
      const gravacao = await rodarPython(comandoDaCamada([documento.origem_caminho, trabalho, camada]), prazo, tarefa.sinal);
      if (gravacao !== null) return falhou(tarefa.sinal.aborted ? 'cancelado' : 'processo', `Camada de texto: ${gravacao}`, decorrido());
      const sha = createHash('sha256').update(await readFile(camada)).digest('hex');
      const final = caminhoDaCamada(documentoId, sha);
      await copyFile(camada, final);

      await comTransacao(opcoes.banco, (cliente) => reconciliarCanonizacao(cliente, documentoId));
      const saida = pastaDaTentativaDeCanonizacao(documentoId, tarefa.job.id, tarefa.lease_token);
      await rm(saida, { recursive: true, force: true });
      const motor = await rodarMotor(raiz, final, 'pdf', saida, {
        titulo: documento.titulo, autor: documento.autor, prazoMs: prazo, sinal: tarefa.sinal,
        paginas: documento.paginas_inicio !== null && documento.paginas_fim !== null ? { inicio: documento.paginas_inicio, fim: documento.paginas_fim } : null,
      });
      if (motor.estado !== 'ok' || motor.caminho === undefined) {
        return falhou(tarefa.sinal.aborted ? 'cancelado' : 'processo', motor.mensagem ?? 'O motor não produziu canônico.', decorrido());
      }
      const conteudo = await lerTextoLimitado(motor.caminho, ORCAMENTOS.canonico);
      const canonico: unknown = interpretarJson(conteudo, ORCAMENTOS.canonico);
      if (!validarCanonico(canonico)) return falhou('schema', 'Canônico inválido produzido pelo motor.', decorrido());
      if (canonico.documento.sha256_original !== sha) return falhou('schema', 'O canônico não é do PDF com a camada.', decorrido());
      return { estado: 'ok', artefato: motor.caminho, sha256: sha256(conteudo), duracao_ms: decorrido(), modelo: `${modelo}; ${canonico.canonizacao.motor}`, esforco: opcoes.esforco };
    },
    async publicar(tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> {
      const cliente = exigirTransacao(contexto);
      const entrada = entradaDoJob(tarefa.job.entrada);
      if (entrada.documento_id === null || entrada.versao_id === null) throw new Error('Job de transcrição sem documento ou versão.');
      const documentoId = entrada.documento_id;
      const canonico = interpretarJson(await lerTextoLimitado(execucao.artefato, ORCAMENTOS.canonico), ORCAMENTOS.canonico) as CanonicoV1;
      const sha = canonico.documento.sha256_original;
      // A fonte nova só vale se o PDF com a camada estiver mesmo ao lado do original.
      if (!(await existe(caminhoDaCamada(documentoId, sha)))) throw new Error('PDF com a camada ausente.');
      const resultado = await publicarCanonizacao(tarefa, execucao, contexto, { fonteDerivada: sha });
      const nova = (await cliente.query<{ id: Id; numero: number; limites: string[] }>(`SELECT id, numero, canonico->'limites' AS limites
        FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1`, [documentoId])).rows[0]!;
      const base = await documentos.obterVersao(cliente, entrada.versao_id);
      await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [tarefa.job.id, 'transcricao_publicada', JSON.stringify({
        versao_base_id: base.id, versao_id: nova.id, numero: nova.numero, sha256_camada: sha,
        paginas_transcritas: paginasSemTexto(base.canonico.limites).length, paginas_ainda_sem_texto: paginasSemTexto(nova.limites).length,
      })]);
      return resultado;
    },
  };
}
