import { aoPublicarVersao } from '../tipo-de-texto/identificar.js';
import { interpretarJson, lerJsonLimitado, lerTextoLimitado, ORCAMENTOS } from '../entrada-json.js';
import { reconciliarCanonizacao, finalizarArquivos } from './arquivos-canonizacao.js';
/**
 * Job `canonizar`: original no disco → `CanonicoV1` → versão de texto publicada.
 *
 * O motor Python é chamado por subprocesso, sem rede e sem credenciais no ambiente.
 * A publicação (a versão, os blocos, as seções e os assets) acontece na transação
 * que fecha a tentativa, como qualquer outro job.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type pg from 'pg';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CanonicoV1, Id, JobResultV1 } from '@margem/contratos';
import { sha256 } from '../executor/artefato.js';
import type { ExecucaoOk, ResultadoExecutor } from '../executor/tipos.js';
import { falhou } from '../executor/tipos.js';
import { ambienteSaneado } from '../executor/ambiente.js';
import { comandoDoMotor } from '../plataforma/executaveis.js';
import { encerrarArvore, opcoesDeProcesso } from '../plataforma/processos.js';
import { comTransacao, type Transacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import { pastaDaTentativaDeCanonizacao, pastaDoDocumento, raizDoRepositorio } from '../dados.js';
import { entradaDoJob } from './fila-postgres.js';
import type { ContextoPublicacao } from './fila.js';
import type { Manipulador, Tarefa } from './worker.js';
import { conferirGeometria, conferirProveniencia, validarProveniencia, validarCanonico, validarGeometria, type GeometriaV1 } from '@margem/contratos';

export const TIPO_CANONIZAR = 'canonizar';
/** Meia hora: um PDF grande com páginas rasterizadas passa de dez minutos. */
export const PRAZO_CANONIZACAO_MS = 1_800_000;
export const PRAZO_ENCERRAMENTO_MOTOR_MS = 30_000;

export interface OpcoesDaCanonizacao {
  banco: pg.Pool;
  /** Raiz do repositório (onde vivem `motor/.venv` e `motor/margem_motor`). */
  raiz?: string;
  prazoMs?: number;
}


export interface SaidaDoMotor {
  estado: 'ok' | 'falhou';
  cancelado?: boolean;
  /** Caminho de `canonico.json` quando deu certo. */
  caminho?: string;
  mensagem?: string;
  duracao_ms: number;
}

/** Roda o motor (`margem-motor ingest` ou `python -m margem_motor.ingest`) e devolve o caminho do canônico. */
export async function rodarMotor(
  raiz: string, entrada: string, formato: string, saida: string,
  extras: {
    titulo?: string; tituloReserva?: string; autor?: string | null; prazoMs?: number; sinal?: AbortSignal;
    /** Faixa inclusiva de páginas (só PDF), repassada como `--paginas a-b` (J14). */
    paginas?: { inicio: number; fim: number } | null;
    /** Estrofes em md, txt e colado, repassada como `--poesia` (J15, J19). */
    poesia?: boolean;
  },
): Promise<SaidaDoMotor> {
  const inicio = Date.now();
  const cancelada = (): SaidaDoMotor => ({ estado: 'falhou', cancelado: true,
    mensagem: 'Canonização cancelada.', duracao_ms: Date.now() - inicio });
  if (extras.sinal?.aborted) return cancelada();
  // Caminhos relativos continuam sendo interpretados a partir da raiz do repositório.
  raiz = resolve(raiz);
  entrada = resolve(raiz, entrada);
  saida = resolve(raiz, saida);
  const argumentos = ['--entrada', entrada, '--formato', formato, '--saida', saida];
  if (extras.titulo !== undefined && extras.titulo.trim() !== '') argumentos.push('--titulo', extras.titulo);
  if (extras.tituloReserva) argumentos.push('--titulo-reserva', extras.tituloReserva);
  if (extras.autor !== undefined && extras.autor !== null && extras.autor.trim() !== '') argumentos.push('--autor', extras.autor);
  if (extras.paginas) argumentos.push('--paginas', `${String(extras.paginas.inicio)}-${String(extras.paginas.fim)}`);
  if (extras.poesia === true) argumentos.push('--poesia');
  return new Promise<SaidaDoMotor>((resolver) => {
    const comando = comandoDoMotor('ingest', argumentos, { raiz });
    const processo = spawn(comando.programa, comando.argumentos, {
      cwd: comando.cwd, env: ambienteSaneado(), stdio: ['ignore', 'ignore', 'pipe'], ...opcoesDeProcesso(),
    });
    // Só a cauda do stderr: mensagem de erro sem despejar o texto do usuário no log.
    let erro = '';
    processo.stderr.setEncoding('utf8');
    processo.stderr.on('data', (pedaco: string) => { erro = `${erro}${pedaco}`.slice(-2_000); });
    const prazo = setTimeout(() => { void encerrarArvore(processo, 'forcado'); }, extras.prazoMs ?? PRAZO_CANONIZACAO_MS);
    prazo.unref?.();
    let cancelado = false;
    let encerramento: ReturnType<typeof setTimeout> | undefined;
    const abortar = () => {
      cancelado = true;
      void encerrarArvore(processo, 'suave');
      // Limite de encerramento já adotado pelo worker; não deixar subprocesso
      // que ignore SIGTERM ocupando a máquina até o prazo de canonização.
      encerramento = setTimeout(() => { void encerrarArvore(processo, 'forcado'); }, PRAZO_ENCERRAMENTO_MOTOR_MS);
      encerramento.unref();
    };
    const limpar = () => {
      clearTimeout(prazo);
      clearTimeout(encerramento);
      extras.sinal?.removeEventListener('abort', abortar);
    };
    extras.sinal?.addEventListener('abort', abortar, { once: true });
    if (extras.sinal?.aborted) abortar();
    processo.on('error', (falha: Error) => {
      limpar();
      if (cancelado || extras.sinal?.aborted) { resolver(cancelada()); return; }
      resolver({ estado: 'falhou', mensagem: falha.message, duracao_ms: Date.now() - inicio });
    });
    processo.on('close', (codigo) => {
      limpar();
      if (cancelado || extras.sinal?.aborted) { resolver(cancelada()); return; }
      if (codigo === 0) { resolver({ estado: 'ok', caminho: join(saida, 'canonico.json'), duracao_ms: Date.now() - inicio }); return; }
      resolver({
        estado: 'falhou',
        mensagem: erro.trim().split('\n').at(-1) ?? `motor encerrou com código ${String(codigo)}`,
        duracao_ms: Date.now() - inicio,
      });
    });
  });
}

/** Lê o documento no banco; o cliente nunca informa caminho. */
function dadosDoDocumento(banco: pg.Pool, documentoId: Id): Promise<documentos.Documento> {
  return comTransacao(banco, async (cliente) => {
    const linha = (await cliente.query<documentos.Documento>('SELECT * FROM documento WHERE id=$1', [documentoId])).rows[0];
    if (!linha) throw new Error('Documento inexistente.');
    return linha;
  });
}

export function manipuladorCanonizar(opcoes: OpcoesDaCanonizacao): Manipulador {
  const raiz = opcoes.raiz ?? raizDoRepositorio();
  return {
    async executar(tarefa: Tarefa): Promise<ResultadoExecutor> {
      if (tarefa.sinal.aborted) return falhou('cancelado', 'Canonização cancelada.', 0);
      const entrada = entradaDoJob(tarefa.job.entrada);
      if (entrada.documento_id === null) return falhou('desconhecido', 'Job de canonização sem documento.', 0);
      const documento = await dadosDoDocumento(opcoes.banco, entrada.documento_id);
      await comTransacao(opcoes.banco, cliente => reconciliarCanonizacao(cliente, documento.id));
      const saida = pastaDaTentativaDeCanonizacao(documento.id, tarefa.job.id, tarefa.lease_token);
      // Uma tentativa anterior pode ter deixado a pasta pela metade; o motor exige vazio.
      await rm(saida, { recursive: true, force: true });
      let tituloReserva: string | undefined;
      try {
        const importacao = await lerJsonLimitado(join(pastaDoDocumento(documento.id), 'importacao.json'), ORCAMENTOS.canonico);
        if (importacao && typeof importacao === 'object' && 'titulo_reserva' in importacao
          && importacao.titulo_reserva === documento.titulo) tituloReserva = documento.titulo;
      } catch (erro) {
        if (!(erro instanceof Error && 'code' in erro && erro.code === 'ENOENT')) throw erro;
      }
      const motor = await rodarMotor(raiz, documento.origem_caminho, documento.formato, saida, {
        ...(tituloReserva ? { tituloReserva } : { titulo: documento.titulo }), autor: documento.autor,
        paginas: documento.paginas_inicio !== null && documento.paginas_fim !== null
          ? { inicio: documento.paginas_inicio, fim: documento.paginas_fim } : null,
        poesia: documento.poesia,
        ...(opcoes.prazoMs === undefined ? {} : { prazoMs: opcoes.prazoMs }),
        sinal: tarefa.sinal,
      });
      if (motor.estado !== 'ok' || motor.caminho === undefined) {
        return falhou(tarefa.sinal.aborted ? 'cancelado' : 'processo',
          motor.mensagem ?? 'O motor não produziu canônico.', motor.duracao_ms);
      }
      const conteudo = await lerTextoLimitado(motor.caminho, ORCAMENTOS.canonico);
      const canonico: unknown = interpretarJson(conteudo, ORCAMENTOS.canonico);
      if (!validarCanonico(canonico)) return falhou('schema', 'Canônico inválido produzido pelo motor.', motor.duracao_ms);
      return {
        estado: 'ok', artefato: motor.caminho, sha256: sha256(conteudo),
        duracao_ms: motor.duracao_ms, modelo: canonico.canonizacao.motor,
      };
    },
    publicar: (tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> =>
      publicarCanonizacao(tarefa, execucao, contexto),
  };
}

/** Publica a versão e dá à pasta da canonização o nome definitivo (`versao-<ULID>`). */
export async function publicarCanonizacao(
  tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao, opcoes: { fonteDerivada?: string } = {},
): Promise<JobResultV1> {
  const cliente = exigirTransacao(contexto);
  const entrada = entradaDoJob(tarefa.job.entrada);
  if (entrada.documento_id === null) throw new Error('Job de canonização sem documento.');
  const origem = pastaDaTentativaDeCanonizacao(entrada.documento_id, tarefa.job.id, tarefa.lease_token);
  if (execucao.artefato !== join(origem, 'canonico.json')) throw new Error('Artefato fora da tentativa de canonização.');
  const texto = await lerTextoLimitado(execucao.artefato, ORCAMENTOS.canonico);
  if (sha256(texto) !== execucao.sha256) throw new Error('Artefato de canonização alterado.');
  const canonico = interpretarJson(texto, ORCAMENTOS.canonico) as CanonicoV1;
  await reconciliarCanonizacao(cliente, entrada.documento_id);
  const versao = await documentos.criarVersao(cliente, entrada.documento_id, canonico, opcoes);
  // Documento ainda sem tipo de texto: o Codex o reconhece (job leve), para a leitura sair no modo certo.
  await aoPublicarVersao(cliente, entrada.documento_id, versao.id, canonico);
  // EPUB e PDF sem título explícito: o título dos metadados substitui o de reserva (nome do arquivo).
  await cliente.query(`UPDATE documento SET
    titulo=CASE WHEN titulo=$2 THEN $3 ELSE titulo END, autor=coalesce(autor,$4)
    WHERE id=$1`, [entrada.documento_id, canonico.canonizacao.config?.titulo_reserva ?? null,
    canonico.documento.titulo, canonico.documento.autor ?? null]);
  await prepararManifestoDaVersao(origem, versao.id);
  // Questão por imagem (J119): a resolução da página inteira nasce com a versão. Import dinâmico: o
  // módulo da questão usa a resolução, que usa este arquivo.
  const { resolverQuestaoPublicada } = await import('../questao/questao.js');
  await resolverQuestaoPublicada(cliente, entrada.documento_id, versao.id);
  const destino = await finalizarArquivos(origem, entrada.documento_id, versao.id, tarefa.job.id);
  // Depois do renomeio o artefato mora na pasta definitiva; é esse caminho que fica no job.
  const artefato = join(destino, 'canonico.json');
  await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [
    tarefa.job.id, 'versao_publicada',
    JSON.stringify({
      documento_id: entrada.documento_id, versao_id: versao.id, numero: versao.numero,
      blocos: canonico.blocos.length, secoes: canonico.secoes.length,
      assets: canonico.assets.length, limites: canonico.limites.length,
    }),
  ]);
  return {
    job_id: tarefa.job.id, attempt: tarefa.job.attempt, lease_token: contexto.lease_token,
    estado: 'ok', duracao_ms: execucao.duracao_ms, modelo: execucao.modelo,
    artefato: { caminho: artefato, sha256: execucao.sha256 },
    diagnosticos: canonico.limites.map((limite) => ({
      nivel: 'aviso' as const, codigo: 'limite_da_canonizacao', mensagem: limite,
    })),
  };
}

export function exigirTransacao(contexto: ContextoPublicacao): Transacao {
  if (contexto.transacao === null) throw new Error('Este manipulador exige a fila do Postgres.');
  return contexto.transacao;
}

/** Finaliza os derivados depois de alocar o id no serviço, antes da publicação. */
export async function prepararManifestoDaVersao(pasta: string, versaoId: Id): Promise<void> {
  const arquivos = [{ caminho: 'canonico.json', sha256: sha256(await lerTextoLimitado(join(pasta, 'canonico.json'), ORCAMENTOS.canonico)) }];
  let geometria: GeometriaV1 | null = null;
  try {
    const valor: unknown = await lerJsonLimitado(join(pasta, 'geometria.json'), ORCAMENTOS.geometria);
    if (!validarGeometria(valor)) throw new Error('Geometria inválida.');
    geometria = valor;
  }
  catch (erro) {
    if (!(erro instanceof Error && 'code' in erro && erro.code === 'ENOENT')) throw erro;
  }
  if (geometria !== null) {
    const canonico = await lerJsonLimitado(join(pasta, 'canonico.json'), ORCAMENTOS.canonico) as CanonicoV1;
    if (!conferirGeometria(geometria, canonico)) throw new Error('Geometria não corresponde ao canônico.');
    geometria.versao_id = versaoId;
    const texto = JSON.stringify(geometria);
    await writeFile(join(pasta, 'geometria.json'), texto);
    arquivos.push({ caminho: 'geometria.json', sha256: sha256(texto) });
  }
  try {
    const texto = await lerTextoLimitado(join(pasta, 'proveniencia.json'), ORCAMENTOS.proveniencia);
    const observacao = interpretarJson(texto, ORCAMENTOS.proveniencia);
    if (!validarProveniencia(observacao)) throw new Error('Proveniência inválida.');
    const canonico = await lerJsonLimitado(join(pasta, 'canonico.json'), ORCAMENTOS.canonico) as CanonicoV1;
    if (!conferirProveniencia(observacao, canonico)) throw new Error('Proveniência não corresponde ao canônico.');
    arquivos.push({ caminho: 'proveniencia.json', sha256: sha256(texto) });
  } catch (erro) {
    if (!(erro instanceof Error && 'code' in erro && erro.code === 'ENOENT')) throw erro;
  }
  try {
    arquivos.push({ caminho: 'capa.jpg', sha256: createHash('sha256').update(await readFile(join(pasta, 'capa.jpg'))).digest('hex') });
  } catch (erro) {
    if (!(erro instanceof Error && 'code' in erro && erro.code === 'ENOENT')) throw erro;
  }
  await writeFile(join(pasta, 'manifesto.json'), JSON.stringify({ versao: 1, versao_id: versaoId, arquivos }));
}
