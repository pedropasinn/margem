import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ambienteSaneado } from './ambiente.js';
import { conferirResposta, diretorioArtefatosPadrao, escreverSchemaDoCodex, guardarArtefato, sha256 } from './artefato.js';
import { ARQUIVO_PROMPT, PONTEIRO_DO_PROMPT, PROMPT_PELA_ENTRADA, promptCabeNaLinha, promptComOsArquivos } from './entrada.js';
import { classificarSaida, esforcoDaSaida, horarioDeVolta, modeloDaSaida, trechoDecisivo } from './classificacao.js';
import { causaDoStderr, resumirStderr } from './stderr.js';
import { detectarCapacidades } from './capacidades.js';
import {
  ambienteConfinado, confinamentoDisponivel, lerCredencial, montarConfinamento, pastaDoMotor, politicaPadrao, prepararCasa, prepararNativo,
  prepararPoliticaNoBwrap, tipoDoConfinamento, type PoliticaNativa,
} from './confinamento.js';
import { anunciarGrupo, encerrarArvore, opcoesDeProcesso } from '../plataforma/processos.js';
import { codexCli } from '../plataforma/executaveis.js';
import type { Confinamento } from './confinamento.js';
import type { Capacidades } from './capacidades.js';
import { falhou } from './tipos.js';
import type { PedidoExecucao, ResultadoExecutor } from './tipos.js';

/** Nome do arquivo da resposta final dentro do diretório da execução. */
export const ARQUIVO_SAIDA = 'saida.json';
/** Nome do schema copiado para dentro do diretório da execução. */
export const ARQUIVO_SCHEMA = 'schema.json';
/** Prefixo do diretório temporário; o cão de guarda o procura no cmdline. */
export const PREFIXO_TEMPORARIO = 'margem-job-';
/** Prefixo da casa temporária (HOME e CODEX_HOME) do motor confinado. */
export const PREFIXO_CASA = 'margem-casa-';

const CABECALHO_MAX = 16 * 1024;
const CAUDA_MAX = 48 * 1024;

export interface ArgumentosCodex {
  diretorio: string;
  schema: string;
  saida: string;
  prompt: string;
  modelo?: string;
  esforco?: string;
  /** Caminhos das imagens já dentro do diretório da execução. */
  imagens?: string[];
  /** Eventos JSONL no stdout (`--json`): é de onde sai o `thread_id` da sessão (J70). */
  json?: boolean;
  /** V-T2: busca na web do Codex ligada (`web_search="live"`); padrão, desligada. */
  buscaNaWeb?: boolean;
}

/**
 * Monta a linha de comando do motor de leitura. Perfil restrito: só leitura,
 * sem aprovação interativa, sem busca na web (salvo `buscaNaWeb`), sem MCPs e sem documentos de projeto.
 */
export function montarArgumentos(argumentos: ArgumentosCodex): string[] {
  const { diretorio, schema, saida, prompt, modelo, esforco, imagens = [], json = false, buscaNaWeb = false } = argumentos;
  const lista = [
    'exec',
    '--sandbox', 'read-only',
    '-C', diretorio,
    '--skip-git-repo-check',
    '--dangerously-bypass-hook-trust',
    '-c', 'approval_policy="never"',
    '-c', `web_search="${buscaNaWeb ? 'live' : 'disabled'}"`,
    '-c', 'mcp_servers={}',
    '-c', 'project_doc_max_bytes=0',
    // Credencial em arquivo: no confinamento não há chaveiro do sistema.
    '-c', 'cli_auth_credentials_store="file"',
    '--output-schema', schema,
    '--output-last-message', saida,
  ];
  if (json) lista.push('--json');
  if (esforco !== undefined) lista.push('-c', `model_reasoning_effort="${esforco}"`);
  if (modelo !== undefined) lista.push('-m', modelo);
  for (const imagem of imagens) lista.push('--image', imagem);
  // `--image` aceita vários arquivos (codex 0.154+): sem `--`, o prompt vira mais uma imagem.
  lista.push('--', prompt);
  return lista;
}

/** Fatos registráveis de uma execução. Nunca inclui prompt, stdout ou stderr. */
export interface RegistroExecucao {
  diretorio: string;
  sha256_prompt: string;
  tamanho_prompt: number;
  codigo_saida: number | null;
  bytes_stderr: number;
  duracao_ms: number;
  estado: string;
}

export interface OpcoesExecutor {
  binario?: string;
  capacidades?: Capacidades;
  registrar?: (registro: RegistroExecucao) => void;
  gerar?: typeof spawn;
  /**
   * Roda o motor dentro de um `bwrap` que só enxerga o diretório da execução e uma casa
   * temporária (confinamento.ts). O worker sempre passa; sem ele (testes com `spawn`
   * encenado), o processo roda direto.
   */
  confinamento?: Confinamento;
  /** Sistema para o teto da linha de comando (V-W4); padrão: o do confinamento ou o do processo. */
  plataforma?: NodeJS.Platform;
}

/** Copia para o diretório da execução apenas os arquivos comuns da entrada (sem recursão). */
async function montarEntrada(origem: string, destino: string): Promise<void> {
  let entradas: string[];
  try {
    entradas = await readdir(origem);
  } catch {
    return;
  }
  for (const nome of entradas) {
    const caminho = join(origem, nome);
    const informacao = await stat(caminho);
    if (informacao.isFile()) await copyFile(caminho, join(destino, nome));
  }
}

const NOME_DO_ANEXO = /^[a-z0-9][a-z0-9-]{0,40}$/u;

/**
 * Pastas só de leitura no diretório da execução. Confinado: cria o ponto de montagem (o `bwrap`
 * monta por cima com `--ro-bind`). Sem confinamento: um link simbólico para a origem.
 */
async function prepararAnexos(anexos: readonly { nome: string; origem: string }[], diretorio: string, confinado: boolean): Promise<{ origem: string; destino: string }[]> {
  // No Windows, link simbólico de pasta exige privilégio; a junção não.
  const tipoDoLink = process.platform === 'win32' ? 'junction' : 'dir';
  const montagens: { origem: string; destino: string }[] = [];
  for (const anexo of anexos) {
    if (!NOME_DO_ANEXO.test(anexo.nome)) throw new Error(`Nome de anexo inválido: ${anexo.nome}`);
    const origem = await realpath(anexo.origem);
    if (!(await stat(origem)).isDirectory()) throw new Error('O anexo precisa ser uma pasta.');
    const destino = join(diretorio, anexo.nome);
    if (confinado) await mkdir(destino);
    else await symlink(origem, destino, tipoDoLink);
    montagens.push({ origem, destino });
  }
  return montagens;
}

/** Encerra o Codex e os comandos que ele abriu (grupo no Linux/macOS, `taskkill /T` no Windows). */
function matarArvore(filho: ChildProcess): void {
  void encerrarArvore(filho, 'forcado', { grupo: true });
}

interface FimDoProcesso {
  /** `thread_id` do evento `thread.started`, quando o stdout foi lido (`--json`). */
  sessao?: string;
  codigo: number | null;
  stderr: string;
  bytes_stderr: number;
  motivo: 'fim' | 'timeout' | 'cancelado' | 'erro';
  erro?: string;
}

function rodarProcesso(
  binario: string,
  argumentos: string[],
  diretorio: string,
  prazoMs: number,
  sinal: AbortSignal | undefined,
  gerar: typeof spawn,
  lerSessao: boolean,
  ambiente: Record<string, string>,
  /** O prompt pela entrada padrão (política sem ferramentas); sem ele, a entrada fica fechada. */
  entradaPadrao?: string,
): Promise<FimDoProcesso> {
  return new Promise<FimDoProcesso>((resolver) => {
    let cabecalho = '';
    let cauda = '';
    let bytes = 0;
    let motivo: FimDoProcesso['motivo'] = 'fim';
    let sessao: string | undefined;
    let pendente = '';
    const filho = gerar(binario, argumentos, {
      cwd: diretorio,
      // stdin fechado quando o prompt vai por argumento; sem ferramentas, ele vai pela entrada.
      stdio: [entradaPadrao === undefined ? 'ignore' : 'pipe', lerSessao ? 'pipe' : 'ignore', 'pipe'],
      env: ambiente,
      // Líder de grupo (fora do Windows) para o prazo e o cancelamento levarem a árvore inteira.
      ...opcoesDeProcesso(process.platform, true),
    });
    // J157 (L-03): grupo próprio não morre com o worker; anunciado, o supervisor o encerra se o worker cair.
    anunciarGrupo(filho);
    if (entradaPadrao !== undefined) {
      // A CLI que morre antes de ler tudo fecha o tubo: o erro de escrita não derruba o worker.
      filho.stdin?.on('error', () => undefined);
      filho.stdin?.end(entradaPadrao);
    }
    // Do stdout só interessa o `thread_id`; nada dele é guardado (as mensagens do modelo passam por aqui).
    filho.stdout?.on('data', (pedaco: Buffer) => {
      if (sessao !== undefined) return;
      pendente = (pendente + pedaco.toString('utf8')).slice(-CABECALHO_MAX);
      const linhas = pendente.split('\n');
      pendente = linhas.pop() ?? '';
      for (const linha of linhas) {
        sessao ??= sessaoDoEvento(linha);
        if (sessao !== undefined) { pendente = ''; break; }
      }
    });
    filho.stderr?.on('data', (pedaco: Buffer) => {
      const trecho = pedaco.toString('utf8');
      bytes += pedaco.byteLength;
      // Só em memória: stderr pode conter credencial e nunca vai para log persistente.
      cabecalho = (cabecalho + trecho).slice(0, CABECALHO_MAX);
      cauda = (cauda + trecho).slice(-CAUDA_MAX);
    });
    const relogio = setTimeout(() => {
      motivo = 'timeout';
      matarArvore(filho);
    }, prazoMs);
    const cancelar = () => {
      motivo = 'cancelado';
      matarArvore(filho);
    };
    sinal?.addEventListener('abort', cancelar, { once: true });
    const encerrar = (codigo: number | null, erro?: string) => {
      clearTimeout(relogio);
      sinal?.removeEventListener('abort', cancelar);
      sessao ??= sessaoDoEvento(pendente);
      resolver({ codigo, stderr: `${cabecalho}\n${cauda}`, bytes_stderr: bytes, motivo, erro, ...(sessao === undefined ? {} : { sessao }) });
    };
    filho.on('error', (erro: Error) => {
      motivo = 'erro';
      encerrar(null, erro.message);
    });
    filho.on('close', (codigo) => { encerrar(codigo); });
    if (sinal?.aborted) cancelar();
  });
}

/** Falha do `spawn` (a CLI nem começou), em frase para a pessoa; `null` quando não se sabe. */
function causaDoErroDeInicio(erro: string | undefined): string | null {
  if (erro === undefined) return null;
  if (/ENAMETOOLONG|E2BIG/u.test(erro)) return 'A linha de comando do Codex ficou longa demais para este sistema.';
  if (/ENOENT/u.test(erro)) return 'O Codex não foi encontrado neste computador.';
  if (/EACCES|EPERM/u.test(erro)) return 'O sistema não deixou o Margem abrir o Codex (permissão ou antivírus).';
  return null;
}

/** Uma sessão do Codex tem id no formato UUID; nada mais entra no caminho da pasta de imagens. */
const SESSAO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** `thread_id` de uma linha JSONL `{"type":"thread.started",...}`; qualquer outra coisa, nada. */
export function sessaoDoEvento(linha: string): string | undefined {
  const texto = linha.trim();
  if (!texto.startsWith('{') || !texto.includes('thread.started')) return undefined;
  try {
    const evento = JSON.parse(texto) as { type?: unknown; thread_id?: unknown };
    return evento.type === 'thread.started' && typeof evento.thread_id === 'string' && SESSAO.test(evento.thread_id) ? evento.thread_id : undefined;
  } catch {
    return undefined;
  }
}

/** Onde a ferramenta `image_gen` do Codex grava os PNGs de uma sessão: `$CODEX_HOME/generated_images/<sessão>/`. */
export function pastaDasImagensDaSessao(sessao: string, ambiente: Record<string, string> = ambienteSaneado()): string {
  if (!SESSAO.test(sessao)) throw new Error('Sessão do Codex com id inesperado.');
  const casa = ambiente.CODEX_HOME ?? join(ambiente.HOME ?? homedir(), '.codex');
  return join(casa, 'generated_images', sessao);
}

/** Os PNGs da sessão, do mais antigo para o mais novo. Pasta ausente: nenhum. */
export async function imagensDaSessao(pasta: string): Promise<string[]> {
  let nomes: string[];
  try {
    nomes = await readdir(pasta);
  } catch {
    return [];
  }
  const imagens: { caminho: string; quando: number }[] = [];
  for (const nome of nomes.filter((candidato) => /^[A-Za-z0-9_.-]+\.png$/u.test(candidato))) {
    const caminho = join(pasta, nome);
    const informacao = await stat(caminho);
    if (informacao.isFile() && informacao.size > 0) imagens.push({ caminho, quando: informacao.mtimeMs });
  }
  return imagens.sort((a, b) => a.quando - b.quando || a.caminho.localeCompare(b.caminho)).map((imagem) => imagem.caminho);
}

/**
 * Executa uma leitura com o `codex exec` da conta ChatGPT.
 * Monta um diretório temporário só com a entrada, aplica o prazo, valida a resposta
 * contra o schema e remove o temporário em qualquer desfecho.
 */
export async function executarCodex(
  pedido: PedidoExecucao,
  opcoes: OpcoesExecutor = {},
): Promise<ResultadoExecutor> {
  const { binario = codexCli(), registrar, gerar = spawn } = opcoes;
  const inicio = Date.now();
  const capacidades = opcoes.capacidades ?? await detectarCapacidades({ binario });
  if (capacidades.faltando.length > 0) {
    return falhou(
      'cli_incompativel',
      `A CLI local não oferece: ${capacidades.faltando.join(', ')}.`,
      Date.now() - inicio,
    );
  }
  if (pedido.gerarImagem === true && capacidades.flags['--json'] !== true) {
    return falhou('cli_incompativel', 'A CLI local não oferece --json, de onde sai a sessão das imagens geradas.', Date.now() - inicio);
  }
  if (pedido.sinal?.aborted) return falhou('cancelado', 'Cancelado antes de começar.', Date.now() - inicio);

  const { confinamento } = opcoes;
  if (confinamento !== undefined) {
    const ausente = await confinamentoDisponivel(confinamento);
    if (ausente !== null) return falhou('cli_incompativel', ausente, Date.now() - inicio);
  }

  const diretorio = await mkdtemp(join(tmpdir(), PREFIXO_TEMPORARIO));
  const casa = confinamento === undefined ? undefined : await mkdtemp(join(tmpdir(), PREFIXO_CASA));
  const registroBase = {
    diretorio,
    sha256_prompt: sha256(pedido.prompt),
    tamanho_prompt: pedido.prompt.length,
  };
  try {
    await montarEntrada(pedido.diretorioEntrada, diretorio);
    const comBwrap = confinamento !== undefined && tipoDoConfinamento(confinamento) === 'bwrap';
    const anexos = await prepararAnexos(pedido.anexos ?? [], diretorio, comBwrap);
    // O schema que viaja para a CLI perde as palavras-chave que a API recusa; a
    // conferência da resposta continua sendo feita contra o schema original.
    const schema = join(diretorio, ARQUIVO_SCHEMA);
    await escreverSchemaDoCodex(pedido.schema, schema);
    const saida = join(diretorio, ARQUIVO_SAIDA);
    const montar = (prompt: string) => montarArgumentos({
      diretorio, schema, saida, prompt,
      modelo: pedido.modelo,
      esforco: pedido.esforco,
      // As imagens só vão se a CLI local conhecer `--image`; o prompt traz sempre o texto do recorte.
      imagens: capacidades.flags['--image'] === true ? (pedido.imagens ?? []).map((nome) => join(diretorio, basename(nome))) : [],
      json: pedido.gerarImagem === true,
      buscaNaWeb: pedido.buscaNaWeb === true,
    });
    let argumentos = montar(pedido.prompt);
    const plataforma = opcoes.plataforma ?? confinamento?.plataforma ?? process.platform;
    // S-04: sem ferramentas (padrão no Windows) o modelo só lê o prompt. A geração de imagem passa pelo
    // modo de código, que essa política desliga: ela roda com o `read-only` (o prompt é do Margem).
    const politicaPedida: PoliticaNativa | undefined = confinamento === undefined
      ? undefined : confinamento.politica ?? politicaPadrao(confinamento.plataforma ?? process.platform);
    const politica = politicaPedida === 'sem-ferramentas' && pedido.gerarImagem === true ? 'somente-leitura' : politicaPedida;
    let entradaPadrao: string | undefined;
    const motorDaLinha = confinamento !== undefined && !comBwrap ? confinamento.motor : binario;
    if (politica === 'sem-ferramentas') {
      if (capacidades.flags['--disable'] !== true) {
        return falhou('cli_incompativel', 'A CLI local não oferece --disable, que desliga as ferramentas do modelo.', Date.now() - inicio);
      }
      // Sem teto de linha: o prompt, com os arquivos da entrada, vai pela entrada padrão.
      entradaPadrao = await promptComOsArquivos(diretorio, pedido.prompt, [ARQUIVO_SCHEMA, ...(pedido.imagens ?? []).map((nome) => basename(nome))]);
      argumentos = montar(PROMPT_PELA_ENTRADA);
    } else if (!promptCabeNaLinha(pedido.prompt, [motorDaLinha, ...argumentos], plataforma)) {
      // V-W4: acima do teto da plataforma (no Windows, a linha inteira), o prompt vai para
      // `prompt.md` no diretório da execução e o argumento só aponta para ele.
      await writeFile(join(diretorio, ARQUIVO_PROMPT), pedido.prompt, { flag: 'wx', mode: 0o600 });
      argumentos = montar(PONTEIRO_DO_PROMPT);
    }
    let comando = binario;
    let linha = argumentos;
    let ambiente = ambienteSaneado();
    let credencialAntes: string | null = null;
    if (confinamento !== undefined && casa !== undefined) {
      const casaCodex = await prepararCasa(casa, confinamento);
      credencialAntes = await lerCredencial(casaCodex);
      if (comBwrap) {
        const motor = await pastaDoMotor(confinamento.motor);
        comando = confinamento.bwrap;
        // S-05: a casa (com o auth.json) está montada; o perfil deixa os comandos do modelo só no diretório.
        const doMotor = await prepararPoliticaNoBwrap({ casa, diretorio, pastaDoMotor: motor.pasta, politica: politica ?? 'perfil', argumentos });
        linha = [...montarConfinamento({ motor: motor.real, pastaDoMotor: motor.pasta, diretorio, casa, somenteLeitura: anexos }), ...doMotor];
        ambiente = ambienteConfinado(casa, ambiente);
      } else {
        // Sem bwrap (macOS, Windows): o sandbox do próprio Codex, com a política escrita na casa.
        const nativo = await prepararNativo({
          confinamento, casa, diretorio: await realpath(diretorio), leituras: anexos.map((anexo) => anexo.origem), argumentos,
          ...(politica === undefined ? {} : { politica }),
        });
        comando = nativo.comando;
        linha = nativo.argumentos;
        ambiente = nativo.ambiente;
      }
    }
    const fim = await rodarProcesso(comando, linha, diretorio, pedido.prazoMs, pedido.sinal, gerar, pedido.gerarImagem === true, ambiente, entradaPadrao);
    // Se o Codex renovou o token na casa temporária, a renovação volta ao login comum.
    if (confinamento !== undefined && casa !== undefined && await lerCredencial(join(casa, '.codex')) !== credencialAntes) {
      await confinamento.sincronizar?.(join(casa, '.codex'));
    }
    const duracao_ms = Date.now() - inicio;
    const anotar = (estado: string) => {
      registrar?.({
        ...registroBase,
        codigo_saida: fim.codigo,
        bytes_stderr: fim.bytes_stderr,
        duracao_ms,
        estado,
      });
    };

    if (fim.motivo === 'cancelado') { anotar('cancelado'); return falhou('cancelado', 'Cancelamento pedido para o job.', duracao_ms); }
    if (fim.motivo === 'timeout') {
      anotar('timeout');
      return {
        ...falhou('timeout', `Prazo de ${String(pedido.prazoMs)} ms estourado; árvore de processos encerrada.`, duracao_ms),
        detalhe: { codigo_saida: fim.codigo, classe: 'timeout', stderr_resumo: resumirStderr(fim.stderr), causa: null },
      };
    }
    if (fim.motivo === 'erro') {
      anotar('processo');
      const causa = causaDoErroDeInicio(fim.erro);
      return {
        ...falhou('processo', causa ?? fim.erro ?? 'Falha ao iniciar a CLI.', duracao_ms),
        detalhe: { codigo_saida: null, classe: 'processo', stderr_resumo: resumirStderr(fim.erro ?? ''), causa },
      };
    }

    if (fim.codigo !== 0) {
      const classe = classificarSaida(fim.stderr, fim.codigo);
      const detalhe = { codigo_saida: fim.codigo, classe, stderr_resumo: resumirStderr(fim.stderr), causa: causaDoStderr(fim.stderr) };
      if (classe === 'cota') {
        anotar('adiado');
        return {
          estado: 'adiado', codigo: 'cota',
          // Só o desfecho anunciado: os registros internos com hora não são o horário de volta.
          not_before: horarioDeVolta(trechoDecisivo(fim.stderr)),
          mensagem: 'Cota da conta esgotada; execução adiada.',
          duracao_ms, detalhe,
        };
      }
      if (classe === 'auth') { anotar('auth'); return { ...falhou('auth', 'Conta do Codex sem sessão válida.', duracao_ms), detalhe }; }
      anotar('processo');
      return { ...falhou('processo', detalhe.causa ?? `A CLI terminou com código ${String(fim.codigo)}.`, duracao_ms), detalhe };
    }

    const conferencia = await conferirResposta(saida, pedido.schema);
    if (conferencia.estado !== 'ok') {
      anotar(conferencia.estado);
      return falhou(conferencia.estado, conferencia.mensagem, duracao_ms);
    }
    // Imagem (J70): os PNGs da própria sessão, identificada pelo `thread_id` desta execução.
    let geradas: string[] = [];
    if (pedido.gerarImagem === true) {
      if (fim.sessao === undefined) { anotar('sem_imagem'); return falhou('sem_imagem', 'O Codex não informou a sessão; não há como achar a imagem gerada.', duracao_ms); }
      geradas = await imagensDaSessao(pastaDasImagensDaSessao(fim.sessao, ambiente));
      if (geradas.length === 0) { anotar('sem_imagem'); return falhou('sem_imagem', 'O Codex terminou sem gerar imagem.', duracao_ms); }
      // A casa temporária some no fim; os PNGs vão antes para junto dos artefatos.
      if (casa !== undefined) {
        const destino = join(pedido.diretorioArtefatos ?? diretorioArtefatosPadrao(), `${basename(diretorio)}-imagens`);
        await mkdir(destino, { recursive: true });
        const copiadas: string[] = [];
        for (const imagem of geradas) {
          const copia = join(destino, basename(imagem));
          await copyFile(imagem, copia);
          copiadas.push(copia);
        }
        geradas = copiadas;
      }
    }
    const artefato = await guardarArtefato(
      conferencia.bytes,
      pedido.diretorioArtefatos ?? diretorioArtefatosPadrao(),
      basename(diretorio),
    );
    anotar('ok');
    const esforco = esforcoDaSaida(fim.stderr) ?? pedido.esforco;
    return {
      estado: 'ok', artefato, sha256: conferencia.sha256, duracao_ms,
      modelo: modeloDaSaida(fim.stderr) ?? pedido.modelo ?? 'padrão da conta',
      ...(esforco === undefined ? {} : { esforco }),
      ...(pedido.gerarImagem === true ? { imagens: geradas } : {}),
    };
  } finally {
    await rm(diretorio, { recursive: true, force: true });
    if (casa !== undefined) await rm(casa, { recursive: true, force: true });
  }
}
