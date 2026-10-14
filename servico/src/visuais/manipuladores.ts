/**
 * Jobs `gerar_imagem` e `gerar_diagrama` (J70): o visual pedido pelo leitor vira um job na fila
 * durável; o worker monta o prompt, chama o Codex fora de transação e publica o artefato na
 * transação que fecha a tentativa (publicação única, concessão conferida).
 *
 * - Imagem: o Codex gera com a ferramenta `image_gen`; o executor devolve os PNGs da própria
 *   sessão; o serviço guarda o PNG por hash antes da transação.
 * - Diagrama: o Codex devolve o Mermaid e, por nó, a citação literal; o serviço confere o código
 *   (`conferirFluxograma`) e, se não passar, chama de novo **uma vez** com o erro. As citações são
 *   resolvidas na publicação; ausente ou ambígua vira diagnóstico, nunca a primeira ocorrência.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import {
  MODO_F1, type AncoraV1, type Bloco, type CanonicoV1, type DiagramaDoVisualV1, type Id, type ImagemDoVisualV1,
  type JobResultV1, type NoDoDiagramaV1, type Secao, type VisualV1,
} from '@margem/contratos';
import { ancoraDeSelecao, conferirFluxograma, resolverCitacao } from '@margem/core';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { modoOuNada } from '../modos.js';
import * as camadasRepo from '../repos/camadas.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as visuaisRepo from '../repos/visuais.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { guardarImagem } from './arquivos.js';
import { montarPromptDaImagem, montarPromptDoDiagrama, type ContextoDoVisual, type Correcao } from './prompts.js';

export const TIPO_GERAR_IMAGEM = 'gerar_imagem';
export const TIPO_GERAR_DIAGRAMA = 'gerar_diagrama';
/** Prazo de uma chamada: a imagem leva de 1 a 3 minutos; o diagrama de um capítulo longo, mais. */
export const PRAZO_DO_VISUAL_MS = 900_000;

export interface ConfiguracaoDosVisuais {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoMs?: number;
  /** Onde o artefato da tentativa (JSON) sobrevive entre executar e publicar. Padrão: ~/.cache/margem/visuais. */
  diretorioArtefatos?: string;
}

// ---------------------------------------------------------------- fila

export const chaveDoVisual = (id: Id): string => `visual:${id}`;
export function lerChaveDoVisual(dedupKey: string): Id {
  const [prefixo, id, ...resto] = dedupKey.split(':');
  if (prefixo !== 'visual' || !id || resto.length > 0) throw new Error(`Chave de visual malformada: ${dedupKey}`);
  return id;
}

/** Enfileira o job do visual, na transação que criou a linha. */
export async function enfileirarVisual(cliente: Transacao, visual: { id: Id; versao_id: Id; tipo: VisualV1['tipo'] }): Promise<jobsRepo.Job> {
  const job = await jobsRepo.enfileirar(cliente, {
    tipo: visual.tipo === 'imagem' ? TIPO_GERAR_IMAGEM : TIPO_GERAR_DIAGRAMA,
    dedup_key: chaveDoVisual(visual.id),
    input_snapshot_hash: sha256(`visual:${visual.id}`),
    versao_id: visual.versao_id,
    prioridade: jobsRepo.PRIORIDADE.artefato_pedido,
  });
  await visuaisRepo.ligarJob(cliente, visual.id, job.id);
  return job;
}

// ---------------------------------------------------------------- texto do alvo

/** Os blocos da seção (a mesma fatia do snapshot do capítulo). */
export function blocosDaSecao(canonico: CanonicoV1, secao: Secao): Bloco[] {
  const ordem = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  const inicio = ordem.get(secao.bloco_inicio);
  const fim = ordem.get(secao.bloco_fim);
  if (inicio === undefined || fim === undefined) return [];
  return canonico.blocos.slice(inicio, fim + 1);
}

/** Para um diagrama de trecho: o bloco da âncora e os vizinhos, até ~3000 palavras. */
function blocosEmVolta(capitulo: readonly Bloco[], blocoId: Id): Bloco[] {
  const indice = capitulo.findIndex((bloco) => bloco.id === blocoId);
  if (indice < 0) return [];
  const escolhidos = new Set<number>([indice]);
  let palavras = capitulo[indice]!.texto.split(/\s+/u).length;
  for (let distancia = 1; distancia < capitulo.length && palavras < 3000; distancia += 1) {
    for (const candidato of [indice - distancia, indice + distancia]) {
      const bloco = capitulo[candidato];
      if (!bloco || palavras >= 3000) continue;
      escolhidos.add(candidato);
      palavras += bloco.texto.split(/\s+/u).length;
    }
  }
  return [...escolhidos].sort((a, b) => a - b).map((i) => capitulo[i]!).filter(Boolean);
}

interface Entrada {
  visual: Awaited<ReturnType<typeof visuaisRepo.pedidoDoVisual>>;
  contexto: ContextoDoVisual;
  /** Texto do alvo (imagem) e o bloco em volta, quando o alvo é um trecho. */
  texto: string;
  emVolta: string | null;
  /** Blocos mandados ao modelo (diagrama) e onde as citações podem ser resolvidas. */
  blocos: Bloco[];
}

async function montarEntrada(cliente: Transacao, id: Id): Promise<Entrada> {
  const visual = await visuaisRepo.pedidoDoVisual(cliente, id);
  if (visual.publicado) throw new Error('O visual já foi publicado.');
  const versao = await obterVersao(cliente, visual.versao_id);
  const secao = versao.canonico.secoes.find((candidata) => candidata.id === visual.secao_id);
  if (!secao) throw new Error('A seção do visual não existe na versão.');
  const capitulo = blocosDaSecao(versao.canonico, secao);
  const padrao = await camadasRepo.camadaPadrao(cliente, visual.versao_id);
  const camada = padrao === null ? null : await camadasRepo.obter(cliente, padrao);
  const modo = modoOuNada(camada?.modo ?? MODO_F1) ?? modoOuNada(MODO_F1);
  const poesia = capitulo.some((bloco) => bloco.tipo === 'estrofe');
  const contexto: ContextoDoVisual = {
    documento: versao.canonico.documento.titulo, capitulo: secao.titulo, modo: modo?.nome ?? 'argumentativa',
    alvo: visual.alvo.tipo, poesia, pedido: visual.pedido,
  };
  if (visual.alvo.tipo === 'capitulo') {
    return { visual, contexto, texto: capitulo.map((bloco) => bloco.texto).join('\n\n'), emVolta: null, blocos: capitulo };
  }
  const { ancora } = visual.alvo;
  const bloco = capitulo.find((candidato) => candidato.id === ancora.bloco_id);
  if (!bloco) throw new Error('O trecho do visual não está na seção.');
  return {
    visual, contexto, texto: ancora.citacao, emVolta: bloco.texto,
    blocos: visual.alvo.tipo === 'bloco' ? [bloco] : blocosEmVolta(capitulo, bloco.id),
  };
}

// ---------------------------------------------------------------- execução

/** O que `executar` deixa em disco para `publicar` ler. */
export type ArtefatoDoVisual = {
  visual_id: Id;
  diagnosticos: VisualV1['diagnosticos'];
  modelo: string;
  esforco: string;
} & ({ tipo: 'imagem'; descricao: string; imagem: { sha256: string; bytes: number; largura: number; altura: number } }
  | { tipo: 'diagrama'; blocos: Id[]; saida: SaidaDoDiagrama });

export interface SaidaDoDiagrama {
  titulo: string;
  codigo: string;
  nos: { id: string; rotulo: string; citacao: { bloco_id: string; texto: string } | null }[];
}

function ehSaidaDoDiagrama(valor: unknown): valor is SaidaDoDiagrama {
  const v = valor as Partial<SaidaDoDiagrama> | null;
  return v !== null && typeof v === 'object' && typeof v.titulo === 'string' && typeof v.codigo === 'string' && Array.isArray(v.nos)
    && v.nos.every((no) => typeof no === 'object' && no !== null && typeof no.id === 'string' && typeof no.rotulo === 'string'
      && (no.citacao === null || (typeof no.citacao === 'object' && typeof no.citacao.bloco_id === 'string' && typeof no.citacao.texto === 'string')));
}

/** Confere o Mermaid e a coincidência entre os nós do código e a lista `nos`. `null` quando passa. */
export function erroDoDiagrama(saida: SaidaDoDiagrama): string | null {
  const conferencia = conferirFluxograma(saida.codigo);
  if (!conferencia.ok) return `linha ${String(conferencia.linha)}: ${conferencia.erro}`;
  const doCodigo = new Set(conferencia.nos);
  const daLista = saida.nos.map((no) => no.id);
  if (new Set(daLista).size !== daLista.length) return 'há ids repetidos em `nos`';
  const faltando = conferencia.nos.filter((id) => !daLista.includes(id));
  if (faltando.length > 0) return `nós do código ausentes de \`nos\`: ${faltando.join(', ')}`;
  const sobrando = daLista.filter((id) => !doCodigo.has(id));
  if (sobrando.length > 0) return `nós de \`nos\` ausentes do código: ${sobrando.join(', ')}`;
  return null;
}

async function gravarArtefato(config: ConfiguracaoDosVisuais, tarefa: Tarefa, artefato: ArtefatoDoVisual): Promise<{ caminho: string; hash: string }> {
  const texto = `${JSON.stringify(artefato, null, 2)}\n`;
  const pasta = join(config.diretorioArtefatos ?? join(homedir(), '.cache/margem/visuais'), `visual-${artefato.visual_id}`);
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const caminho = join(pasta, `tentativa-${String(tarefa.job.attempt)}-${ulid()}.json`);
  await writeFile(caminho, texto, { mode: 0o600 });
  return { caminho, hash: sha256(texto) };
}

async function chamar(config: ConfiguracaoDosVisuais, prompt: { prompt: string; schema: unknown }, sinal: AbortSignal, imagem: boolean): Promise<ResultadoExecutor> {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-visual-'));
  try {
    const preparada = await prepararEntrada(raiz, prompt.prompt, prompt.schema);
    return await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? PRAZO_DO_VISUAL_MS, modelo: config.modelo, esforco: config.esforco, sinal,
      ...(imagem ? { gerarImagem: true } : {}),
      ...(config.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: join(config.diretorioArtefatos, 'saidas') }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

async function executarImagem(config: ConfiguracaoDosVisuais, tarefa: Tarefa, entrada: Entrada, inicio: number): Promise<ResultadoExecutor> {
  const resultado = await chamar(config, montarPromptDaImagem(entrada.contexto, entrada.texto, entrada.emVolta), tarefa.sinal, true);
  if (resultado.estado !== 'ok') return resultado;
  const geradas = resultado.imagens ?? [];
  const escolhida = geradas.at(-1);
  if (escolhida === undefined) return falhou('sem_imagem', 'O Codex terminou sem gerar imagem.', Date.now() - inicio);
  const saida = JSON.parse(await readFile(resultado.artefato, 'utf8')) as { descricao?: unknown };
  if (typeof saida.descricao !== 'string' || saida.descricao.trim() === '') return falhou('schema', 'Resposta sem a descrição da imagem.', Date.now() - inicio);
  let imagem: Awaited<ReturnType<typeof guardarImagem>>;
  try {
    imagem = await guardarImagem(escolhida);
  } catch (erro) {
    // A imagem foi gerada; o que falhou foi guardá-la. Código próprio para não confundir com "o Codex não gerou".
    const causa = erro instanceof Error ? erro.message : 'erro desconhecido';
    return falhou('publicacao', `A imagem foi gerada, mas não pôde ser guardada: ${causa}`.slice(0, 800), Date.now() - inicio);
  }
  const diagnosticos = geradas.length > 1
    ? [{ codigo: 'varias_imagens', mensagem: `O Codex gerou ${String(geradas.length)} imagens; ficou a última.` }] : [];
  const artefato = await gravarArtefato(config, tarefa, {
    visual_id: entrada.visual.id, tipo: 'imagem', descricao: saida.descricao.trim().slice(0, 1000), imagem, diagnosticos,
    modelo: resultado.modelo, esforco: resultado.esforco ?? config.esforco,
  });
  return { estado: 'ok', artefato: artefato.caminho, sha256: artefato.hash, duracao_ms: Date.now() - inicio, modelo: resultado.modelo, esforco: resultado.esforco ?? config.esforco };
}

async function executarDiagrama(config: ConfiguracaoDosVisuais, tarefa: Tarefa, entrada: Entrada, inicio: number): Promise<ResultadoExecutor> {
  let correcao: Correcao | null = null;
  const diagnosticos: VisualV1['diagnosticos'] = [];
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    const resultado = await chamar(config, montarPromptDoDiagrama(entrada.contexto, entrada.blocos, correcao), tarefa.sinal, false);
    if (resultado.estado !== 'ok') return resultado;
    const bruto: unknown = JSON.parse(await readFile(resultado.artefato, 'utf8'));
    if (!ehSaidaDoDiagrama(bruto)) return falhou('schema', 'Resposta fora do schema do fluxograma.', Date.now() - inicio);
    const erro = erroDoDiagrama(bruto);
    if (erro === null) {
      if (correcao !== null) diagnosticos.push({ codigo: 'mermaid_corrigido', mensagem: `O primeiro código foi recusado (${correcao.erro}); valeu a segunda tentativa.` });
      const artefato = await gravarArtefato(config, tarefa, {
        visual_id: entrada.visual.id, tipo: 'diagrama', blocos: entrada.blocos.map((bloco) => bloco.id), saida: bruto, diagnosticos,
        modelo: resultado.modelo, esforco: resultado.esforco ?? config.esforco,
      });
      return { estado: 'ok', artefato: artefato.caminho, sha256: artefato.hash, duracao_ms: Date.now() - inicio, modelo: resultado.modelo, esforco: resultado.esforco ?? config.esforco };
    }
    await registrarNaAuditoria(`mermaid-recusado-${String(tentativa)}.json`, { erro, codigo: bruto.codigo });
    if (correcao !== null) return falhou('schema', `O fluxograma veio inválido duas vezes. Último erro: ${erro}.`, Date.now() - inicio);
    correcao = { codigo: bruto.codigo, erro };
  }
  return falhou('desconhecido', 'Fluxograma sem desfecho.', Date.now() - inicio);
}

export async function executarVisual(config: ConfiguracaoDosVisuais, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const id = lerChaveDoVisual(entradaDoJob(tarefa.job.entrada).dedup_key);
  const entrada = await comTransacao(config.banco, (cliente) => montarEntrada(cliente, id));
  if (entrada.visual.apagado) return falhou('cancelado', 'O visual foi excluído antes de ser gerado.', Date.now() - inicio);
  if (tarefa.sinal.aborted) return falhou('cancelado', 'Job cancelado.', Date.now() - inicio);
  return entrada.visual.tipo === 'imagem' ? executarImagem(config, tarefa, entrada, inicio) : executarDiagrama(config, tarefa, entrada, inicio);
}

// ---------------------------------------------------------------- publicação

type Diagnostico = VisualV1['diagnosticos'][number];

/** Citação do nó → âncora no bloco real. Só entre os blocos mandados; ausente ou ambígua vira diagnóstico. */
export function resolverNos(saida: SaidaDoDiagrama, blocos: ReadonlyMap<Id, Bloco>, enviados: ReadonlySet<Id>, versaoId: Id): {
  nos: NoDoDiagramaV1[]; diagnosticos: Diagnostico[];
} {
  const diagnosticos: Diagnostico[] = [];
  const nos = saida.nos.map((no): NoDoDiagramaV1 => {
    const base = { id: no.id, rotulo: no.rotulo.trim() || no.id };
    if (no.citacao === null) return base;
    const bloco = enviados.has(no.citacao.bloco_id) ? blocos.get(no.citacao.bloco_id) : undefined;
    if (!bloco) {
      diagnosticos.push({ codigo: 'citacao_fora_do_texto', mensagem: `Nó ${no.id}: a citação aponta um bloco que não estava no texto enviado; ficou sem trecho.` });
      return base;
    }
    const resolvida = resolverCitacao({ ...bloco, versao_id: versaoId }, { citacao: no.citacao.texto });
    if (!resolvida.ok) {
      diagnosticos.push(resolvida.motivo === 'ambigua'
        ? { codigo: 'citacao_ambigua', mensagem: `Nó ${no.id}: a citação aparece ${String(resolvida.ocorrencias)} vezes no bloco; ficou sem trecho.` }
        : { codigo: 'citacao_ausente', mensagem: `Nó ${no.id}: a citação não está literalmente no bloco; ficou sem trecho.` });
      return base;
    }
    const ancora: AncoraV1 = ancoraDeSelecao({ ...bloco, versao_id: versaoId }, resolvida.ancora.inicio_utf16, resolvida.ancora.fim_utf16);
    return { ...base, ancora };
  });
  return { nos, diagnosticos };
}

function lerArtefato(bruto: unknown): ArtefatoDoVisual {
  const a = bruto as Partial<ArtefatoDoVisual> | null;
  if (!a || typeof a.visual_id !== 'string' || !Array.isArray(a.diagnosticos) || typeof a.modelo !== 'string' || typeof a.esforco !== 'string'
    || (a.tipo !== 'imagem' && a.tipo !== 'diagrama')) throw new Error('Artefato do visual incompleto.');
  return a as ArtefatoDoVisual;
}

export async function publicarVisual(cliente: Transacao, execucao: ExecucaoOk): Promise<Diagnostico[]> {
  const artefato = lerArtefato(JSON.parse(await readFile(execucao.artefato, 'utf8')));
  const pedido = await visuaisRepo.pedidoDoVisual(cliente, artefato.visual_id);
  if (pedido.tipo !== artefato.tipo) throw new Error('O artefato não é do tipo do visual.');
  let publicado: ImagemDoVisualV1 | DiagramaDoVisualV1;
  const diagnosticos = [...artefato.diagnosticos];
  if (artefato.tipo === 'imagem') {
    publicado = { tipo: 'png', ...artefato.imagem, descricao: artefato.descricao };
  } else {
    const versao = await obterVersao(cliente, pedido.versao_id);
    const resolvidos = resolverNos(artefato.saida, new Map(versao.canonico.blocos.map((bloco) => [bloco.id, bloco])), new Set(artefato.blocos), pedido.versao_id);
    diagnosticos.push(...resolvidos.diagnosticos);
    publicado = { tipo: 'mermaid', codigo: artefato.saida.codigo, titulo: artefato.saida.titulo.trim() || 'Fluxograma', nos: resolvidos.nos };
  }
  await visuaisRepo.publicar(cliente, artefato.visual_id, { artefato: publicado, diagnosticos, execucao: { modelo: artefato.modelo, esforco: artefato.esforco } });
  // Relê pelo contrato: o que foi gravado precisa ser um VisualV1 válido (lança e desfaz a transação se não for).
  await visuaisRepo.obter(cliente, artefato.visual_id, { apagados: true });
  await registrarNaAuditoria('visual.publicado.json', { visual_id: artefato.visual_id, artefato: publicado, diagnosticos });
  return diagnosticos;
}

export function manipuladoresDosVisuais(config: ConfiguracaoDosVisuais): Record<string, Manipulador> {
  const manipulador: Manipulador = {
    executar: (tarefa) => executarVisual(config, tarefa),
    publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
      const diagnosticos = await publicarVisual(exigirTransacao(contexto), execucao);
      return {
        job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
        estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
        diagnosticos: diagnosticos.map((d) => ({ nivel: 'aviso' as const, codigo: d.codigo, mensagem: d.mensagem })),
      };
    },
  };
  return { [TIPO_GERAR_IMAGEM]: manipulador, [TIPO_GERAR_DIAGRAMA]: manipulador };
}
