/**
 * Job `responder_agente`: a pergunta do leitor na página "Perguntar" vira um job na fila durável.
 *
 * - Execução (fora de transação): atualiza o export da biblioteca em Markdown (`biblioteca.ts`,
 *   reaproveitado entre perguntas), monta o prompt com o histórico do fio e chama o Codex com a
 *   pasta montada só para leitura em `biblioteca/`. Sem ferramentas (Windows, R2-4) o modelo não abre
 *   a pasta: os trechos relevantes vão no próprio prompt (`contexto.ts`) e não há export nem anexo. Mapa com Mermaid fora da régua do core ganha
 *   **uma** chamada curta de correção; recusado de novo, sai com diagnóstico.
 * - Publicação (na transação que fecha a tentativa): cada citação é conferida no bloco real da
 *   versão atual do documento (`resolverCitacao`: ausente, ambígua ou de versão antiga vira
 *   diagnóstico, nunca a primeira ocorrência); resposta sem citação válida leva um aviso.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import type {
  AncoraV1, ArtefatoDoAgenteV1, Bloco, CanonicoV1, CapituloDoArtefatoV1, CitacaoDoAgenteV1, Id, JobResultV1, MensagemDoAgenteV1, NoDoDiagramaV1,
} from '@margem/contratos';
import { ancoraDeSelecao, resolverCitacao } from '@margem/core';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
import { sha256 } from '../executor/artefato.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { modeloSemFerramentas } from '../executor/confinamento.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { blocosDaSecao, erroDoDiagrama } from '../visuais/manipuladores.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { exportarBiblioteca } from './biblioteca.js';
import { contextoDaPergunta } from './contexto.js';
import { montarPromptDoAgente, montarPromptDoMapa } from './prompt.js';
import * as agenteRepo from './repo.js';

export const TIPO_RESPONDER_AGENTE = 'responder_agente';
/** Ler vários capítulos com `grep` e `sed` leva de 1 a 6 minutos no esforço medium. */
export const PRAZO_DO_AGENTE_MS = 1_200_000;
export const ESFORCO_DO_AGENTE_PADRAO = 'medium';

export interface ConfiguracaoDoAgente {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoMs?: number;
  /** Onde mora o export da biblioteca em Markdown. Padrão: ~/.cache/margem/biblioteca. */
  diretorioBiblioteca?: string;
  /** Onde o artefato da tentativa sobrevive entre executar e publicar. Padrão: ~/.cache/margem/agente. */
  diretorioArtefatos?: string;
  /**
   * R2-4: o modelo roda sem ferramentas e não abre a pasta da biblioteca; o contexto vai no prompt.
   * Padrão: o que o executor desta máquina faz (`modeloSemFerramentas`, Windows por padrão).
   */
  semFerramentas?: boolean;
}

type Diagnostico = MensagemDoAgenteV1['diagnosticos'][number];

// ---------------------------------------------------------------- fila

/** `agente:<conversa>:<pergunta>:<pedido>`: o último segmento muda a cada "tentar de novo". */
export const chaveDoAgente = (conversaId: Id, mensagemId: Id, pedido: Id): string => `agente:${conversaId}:${mensagemId}:${pedido}`;
export function lerChaveDoAgente(dedupKey: string): { conversa_id: Id; mensagem_id: Id } {
  const [prefixo, conversa_id, mensagem_id, pedido, ...resto] = dedupKey.split(':');
  if (prefixo !== 'agente' || !conversa_id || !mensagem_id || !pedido || resto.length > 0) throw new Error(`Chave do agente malformada: ${dedupKey}`);
  return { conversa_id, mensagem_id };
}

export async function enfileirarPergunta(cliente: Transacao, conversaId: Id, mensagemId: Id): Promise<jobsRepo.Job> {
  const dedup_key = chaveDoAgente(conversaId, mensagemId, ulid());
  const job = await jobsRepo.enfileirar(cliente, {
    tipo: TIPO_RESPONDER_AGENTE, dedup_key, input_snapshot_hash: sha256(dedup_key), prioridade: jobsRepo.PRIORIDADE.artefato_pedido,
  });
  await agenteRepo.ligarJob(cliente, mensagemId, job.id);
  return job;
}

// ---------------------------------------------------------------- saída do modelo

export interface NoDaSaida { id: string; rotulo: string; ref: string | null }
export interface SaidaDoAgente {
  resposta: string;
  citacoes: { ref: string; versao_id: string; bloco_id: string; texto: string }[];
  artefatos: {
    tipo: ArtefatoDoAgenteV1['tipo']; titulo: string; versao_id: string | null; secao_id: string | null;
    markdown: string; mermaid: string; nos: NoDaSaida[];
  }[];
}

const texto = (valor: unknown): valor is string => typeof valor === 'string';
const textoOuNulo = (valor: unknown): valor is string | null => valor === null || typeof valor === 'string';
const ehNo = (no: unknown): no is NoDaSaida => typeof no === 'object' && no !== null
  && texto((no as NoDaSaida).id) && texto((no as NoDaSaida).rotulo) && textoOuNulo((no as NoDaSaida).ref);

export function ehSaidaDoAgente(valor: unknown): valor is SaidaDoAgente {
  const v = valor as Partial<SaidaDoAgente> | null;
  return v !== null && typeof v === 'object' && texto(v.resposta) && Array.isArray(v.citacoes) && Array.isArray(v.artefatos)
    && v.citacoes.every((c) => typeof c === 'object' && c !== null && texto(c.ref) && texto(c.versao_id) && texto(c.bloco_id) && texto(c.texto))
    && v.artefatos.every((a) => typeof a === 'object' && a !== null && ['mapa', 'resumo', 'quadro', 'conceitos'].includes(a.tipo) && texto(a.titulo)
      && textoOuNulo(a.versao_id) && textoOuNulo(a.secao_id) && texto(a.markdown) && texto(a.mermaid) && Array.isArray(a.nos) && a.nos.every(ehNo));
}

/** O erro do mapa pela régua dos visuais (subconjunto fechado e nós coincidentes); `null` quando passa. */
export function erroDoMapa(artefato: { mermaid: string; nos: NoDaSaida[] }): string | null {
  return erroDoDiagrama({ titulo: 'mapa', codigo: artefato.mermaid, nos: artefato.nos.map((no) => ({ id: no.id, rotulo: no.rotulo, citacao: null })) });
}

// ---------------------------------------------------------------- execução

interface ArtefatoDaTentativa {
  conversa_id: Id; mensagem_id: Id; saida: SaidaDoAgente; diagnosticos: Diagnostico[];
  modelo: string; esforco: string; duracao_ms: number;
}

async function chamar(config: ConfiguracaoDoAgente, montado: { prompt: string; schema: unknown }, sinal: AbortSignal, biblioteca: string | null): Promise<ResultadoExecutor> {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-agente-'));
  try {
    const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
    return await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? PRAZO_DO_AGENTE_MS, modelo: config.modelo, esforco: config.esforco, sinal,
      ...(biblioteca === null ? {} : { anexos: [{ nome: 'biblioteca', origem: biblioteca }] }),
      ...(config.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: join(config.diretorioArtefatos, 'saidas') }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

/** Mapas fora da régua: uma correção curta cada; recusado de novo, sai com diagnóstico. */
async function corrigirMapas(config: ConfiguracaoDoAgente, saida: SaidaDoAgente, sinal: AbortSignal, diagnosticos: Diagnostico[]): Promise<ResultadoExecutor | null> {
  const mantidos: SaidaDoAgente['artefatos'] = [];
  for (const artefato of saida.artefatos) {
    if (artefato.tipo !== 'mapa') { mantidos.push(artefato); continue; }
    const erro = erroDoMapa(artefato);
    if (erro === null) { mantidos.push(artefato); continue; }
    await registrarNaAuditoria('agente-mapa-recusado.json', { erro, mermaid: artefato.mermaid });
    const resultado = await chamar(config, montarPromptDoMapa(artefato.mermaid, artefato.nos, erro), sinal, null);
    if (resultado.estado === 'adiado' || (resultado.estado === 'falhou' && resultado.codigo === 'cancelado')) return resultado;
    const corrigido = resultado.estado === 'ok' ? await lerJsonLimitado(resultado.artefato, ORCAMENTOS.resposta) as { mermaid?: unknown; nos?: unknown } : null;
    const candidato = corrigido && texto(corrigido.mermaid) && Array.isArray(corrigido.nos) && corrigido.nos.every(ehNo)
      ? { ...artefato, mermaid: corrigido.mermaid, nos: corrigido.nos } : null;
    const segundo = candidato === null ? 'a correção não veio' : erroDoMapa(candidato);
    if (candidato !== null && segundo === null) {
      diagnosticos.push({ codigo: 'mermaid_corrigido', mensagem: `O mapa “${artefato.titulo}” veio fora da régua (${erro}); valeu a correção.` });
      mantidos.push(candidato);
    } else {
      diagnosticos.push({ codigo: 'mapa_recusado', mensagem: `O mapa “${artefato.titulo}” veio fora da régua duas vezes (${segundo ?? erro}) e ficou de fora.` });
    }
  }
  saida.artefatos = mantidos;
  return null;
}

export async function executarAgente(config: ConfiguracaoDoAgente, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const { conversa_id, mensagem_id } = lerChaveDoAgente(entradaDoJob(tarefa.job.entrada).dedup_key);
  const raizDaBiblioteca = config.diretorioBiblioteca ?? join(homedir(), '.cache/margem/biblioteca');
  const semFerramentas = config.semFerramentas ?? modeloSemFerramentas();
  const preparo = await comTransacao(config.banco, async (cliente) => {
    const conversa = await agenteRepo.obterConversa(cliente, conversa_id);
    if (!conversa) return null;
    const fio = await agenteRepo.mensagens(cliente, conversa_id);
    const indice = fio.findIndex((mensagem) => mensagem.id === mensagem_id);
    const pergunta = fio[indice];
    if (!pergunta || pergunta.autor !== 'leitor') throw new Error('Pergunta inexistente na conversa.');
    if (pergunta.estado === 'respondida') return null;
    const anteriores = fio.slice(0, indice);
    if (semFerramentas) return { pergunta: pergunta.texto, anteriores, contexto: (await contextoDaPergunta(cliente, pergunta.texto, anteriores)).texto };
    await exportarBiblioteca(cliente, raizDaBiblioteca);
    return { pergunta: pergunta.texto, anteriores, contexto: undefined };
  });
  if (preparo === null) return falhou('cancelado', 'A conversa foi apagada ou a pergunta já tem resposta.', Date.now() - inicio);
  if (tarefa.sinal.aborted) return falhou('cancelado', 'Job cancelado.', Date.now() - inicio);

  const resultado = await chamar(config, montarPromptDoAgente(preparo.pergunta, preparo.anteriores, preparo.contexto), tarefa.sinal,
    semFerramentas ? null : raizDaBiblioteca);
  if (resultado.estado !== 'ok') return resultado;
  const bruto: unknown = await lerJsonLimitado(resultado.artefato, ORCAMENTOS.resposta);
  if (!ehSaidaDoAgente(bruto) || bruto.resposta.trim() === '') return falhou('schema', 'Resposta fora do schema do agente.', Date.now() - inicio);
  const diagnosticos: Diagnostico[] = [];
  const interrompido = await corrigirMapas(config, bruto, tarefa.sinal, diagnosticos);
  if (interrompido !== null) return interrompido;

  const esforco = resultado.esforco ?? config.esforco;
  const artefato: ArtefatoDaTentativa = {
    conversa_id, mensagem_id, saida: bruto, diagnosticos, modelo: resultado.modelo, esforco, duracao_ms: Date.now() - inicio,
  };
  const conteudo = `${JSON.stringify(artefato, null, 2)}\n`;
  const pasta = join(config.diretorioArtefatos ?? join(homedir(), '.cache/margem/agente'), `conversa-${conversa_id}`);
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const caminho = join(pasta, `resposta-${mensagem_id}-${String(tarefa.job.attempt)}-${ulid()}.json`);
  await writeFile(caminho, conteudo, { mode: 0o600 });
  return { estado: 'ok', artefato: caminho, sha256: sha256(conteudo), duracao_ms: Date.now() - inicio, modelo: resultado.modelo, esforco };
}

// ---------------------------------------------------------------- publicação

interface VersaoConhecida { canonico: CanonicoV1; documento_id: Id; atual: boolean; blocos: Map<Id, Bloco> }

/** O capítulo (seção de nível 1) que contém o bloco. */
function capituloDoBloco(canonico: CanonicoV1, blocoId: Id): { id: Id; titulo: string } | null {
  for (const secao of canonico.secoes.filter((candidata) => candidata.nivel === 1)) {
    if (blocosDaSecao(canonico, secao).some((bloco) => bloco.id === blocoId)) return { id: secao.id, titulo: secao.titulo };
  }
  return null;
}

async function versaoConhecida(cliente: Transacao, cache: Map<Id, VersaoConhecida | null>, versaoId: Id): Promise<VersaoConhecida | null> {
  if (cache.has(versaoId)) return cache.get(versaoId) ?? null;
  const linha = (await cliente.query<{ documento_id: Id; atual: Id }>(`SELECT v.documento_id,
      (SELECT id FROM versao_texto o WHERE o.documento_id = v.documento_id ORDER BY numero DESC LIMIT 1) AS atual
    FROM versao_texto v JOIN documento d ON d.id = v.documento_id WHERE v.id=$1`, [versaoId])).rows[0];
  const conhecida = linha ? await obterVersao(cliente, versaoId).then((versao) => ({
    canonico: versao.canonico, documento_id: linha.documento_id, atual: linha.atual === versaoId,
    blocos: new Map(versao.canonico.blocos.map((bloco) => [bloco.id, bloco])),
  })) : null;
  cache.set(versaoId, conhecida);
  return conhecida;
}

export async function resolverCitacoes(cliente: Transacao, saida: SaidaDoAgente, cache: Map<Id, VersaoConhecida | null> = new Map()): Promise<{
  citacoes: CitacaoDoAgenteV1[]; diagnosticos: Diagnostico[];
}> {
  const citacoes: CitacaoDoAgenteV1[] = [];
  const diagnosticos: Diagnostico[] = [];
  const vistas = new Set<string>();
  for (const pedida of saida.citacoes) {
    if (vistas.has(pedida.ref)) { diagnosticos.push({ codigo: 'citacao_repetida', mensagem: `A referência ${pedida.ref} veio duas vezes; valeu a primeira.` }); continue; }
    vistas.add(pedida.ref);
    const versao = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(pedida.versao_id) ? await versaoConhecida(cliente, cache, pedida.versao_id) : null;
    if (!versao) { diagnosticos.push({ codigo: 'citacao_fora_da_biblioteca', mensagem: `${pedida.ref}: a versão citada não existe na biblioteca.` }); continue; }
    if (!versao.atual) { diagnosticos.push({ codigo: 'citacao_versao_antiga', mensagem: `${pedida.ref}: a citação é de uma versão antiga do documento.` }); continue; }
    const bloco = versao.blocos.get(pedida.bloco_id);
    if (!bloco) { diagnosticos.push({ codigo: 'citacao_fora_do_texto', mensagem: `${pedida.ref}: o bloco citado não existe nesse documento.` }); continue; }
    const resolvida = resolverCitacao({ ...bloco, versao_id: pedida.versao_id }, { citacao: pedida.texto });
    if (!resolvida.ok) {
      diagnosticos.push(resolvida.motivo === 'ambigua'
        ? { codigo: 'citacao_ambigua', mensagem: `${pedida.ref}: o trecho aparece ${String(resolvida.ocorrencias)} vezes no bloco.` }
        : { codigo: 'citacao_ausente', mensagem: `${pedida.ref}: o trecho não está literalmente no bloco.` });
      continue;
    }
    const ancora: AncoraV1 = ancoraDeSelecao({ ...bloco, versao_id: pedida.versao_id }, resolvida.ancora.inicio_utf16, resolvida.ancora.fim_utf16);
    const capitulo = capituloDoBloco(versao.canonico, bloco.id);
    citacoes.push({
      ref: pedida.ref, documento_id: versao.documento_id, documento: versao.canonico.documento.titulo,
      capitulo: capitulo?.titulo ?? null, secao_id: capitulo?.id ?? null, ancora,
    });
  }
  return { citacoes, diagnosticos };
}

async function capituloDoArtefato(cliente: Transacao, cache: Map<Id, VersaoConhecida | null>, versaoId: string | null, secaoId: string | null): Promise<CapituloDoArtefatoV1 | null> {
  if (versaoId === null || secaoId === null || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(versaoId)) return null;
  const versao = await versaoConhecida(cliente, cache, versaoId);
  const secao = versao?.canonico.secoes.find((candidata) => candidata.id === secaoId && candidata.nivel === 1);
  if (!versao || !versao.atual || !secao) return null;
  return { documento_id: versao.documento_id, versao_id: versaoId, secao_id: secao.id, titulo: secao.titulo, documento: versao.canonico.documento.titulo };
}

export async function montarArtefatos(cliente: Transacao, saida: SaidaDoAgente, citacoes: readonly CitacaoDoAgenteV1[], cache: Map<Id, VersaoConhecida | null>, diagnosticos: Diagnostico[]): Promise<ArtefatoDoAgenteV1[]> {
  const porRef = new Map(citacoes.map((citacao) => [citacao.ref, citacao]));
  const artefatos: ArtefatoDoAgenteV1[] = [];
  for (const artefato of saida.artefatos) {
    const titulo = artefato.titulo.replace(/\s+/gu, ' ').trim().slice(0, 200) || artefato.tipo;
    const capitulo = await capituloDoArtefato(cliente, cache, artefato.versao_id, artefato.secao_id);
    if (artefato.versao_id !== null && artefato.secao_id !== null && capitulo === null) {
      diagnosticos.push({ codigo: 'capitulo_desconhecido', mensagem: `“${titulo}”: o capítulo indicado não existe na versão atual; o artefato fica sem capítulo.` });
    }
    if (artefato.tipo === 'mapa') {
      if (erroDoMapa(artefato) !== null) continue; // já diagnosticado na execução
      const nos: NoDoDiagramaV1[] = artefato.nos.map((no) => {
        const citacao = no.ref === null ? undefined : porRef.get(no.ref);
        return { id: no.id, rotulo: no.rotulo.trim() || no.id, ...(citacao ? { ancora: citacao.ancora } : {}) };
      });
      artefatos.push({ tipo: 'mapa', titulo, codigo: artefato.mermaid, nos, capitulo });
      continue;
    }
    if (artefato.markdown.trim() === '') { diagnosticos.push({ codigo: 'artefato_vazio', mensagem: `“${titulo}” veio vazio e ficou de fora.` }); continue; }
    artefatos.push({ tipo: artefato.tipo, titulo, markdown: artefato.markdown.trim(), capitulo });
  }
  return artefatos;
}

export async function publicarAgente(cliente: Transacao, jobId: Id, execucao: ExecucaoOk): Promise<Diagnostico[]> {
  const artefato = await lerJsonLimitado(execucao.artefato, ORCAMENTOS.resposta) as ArtefatoDaTentativa;
  if (!artefato || typeof artefato.conversa_id !== 'string' || typeof artefato.mensagem_id !== 'string' || !ehSaidaDoAgente(artefato.saida)) {
    throw new Error('Artefato do agente incompleto.');
  }
  const conversa = await agenteRepo.obterConversa(cliente, artefato.conversa_id, { travar: true });
  if (!conversa) throw new Error('A conversa foi apagada.');
  const pergunta = await agenteRepo.obterMensagem(cliente, artefato.mensagem_id);
  if (!pergunta || pergunta.autor !== 'leitor' || pergunta.conversa_id !== conversa.id) throw new Error('Pergunta inexistente na conversa.');
  const cache = new Map<Id, VersaoConhecida | null>();
  const { citacoes, diagnosticos } = await resolverCitacoes(cliente, artefato.saida, cache);
  diagnosticos.unshift(...artefato.diagnosticos);
  const artefatos = await montarArtefatos(cliente, artefato.saida, citacoes, cache, diagnosticos);
  if (citacoes.length === 0) {
    diagnosticos.push({ codigo: 'sem_citacao', mensagem: 'Nenhuma citação desta resposta conferiu com o texto da biblioteca; leia-a com cautela.' });
  }
  const id = await agenteRepo.publicarResposta(cliente, {
    conversa_id: conversa.id, em_resposta_a: pergunta.id, texto: artefato.saida.resposta.trim(), citacoes, artefatos, diagnosticos,
    execucao: { modelo: execucao.modelo, esforco: execucao.esforco ?? artefato.esforco, duracao_ms: artefato.duracao_ms },
  });
  await registrarNaAuditoria('agente.publicado.json', { mensagem_id: id, citacoes: citacoes.length, artefatos: artefatos.length, diagnosticos });
  await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [jobId, 'resposta_publicada', JSON.stringify({
    conversa_id: conversa.id, pergunta_id: pergunta.id, resposta_id: id, citacoes: citacoes.length, artefatos: artefatos.length,
  })]);
  return diagnosticos;
}

export function manipuladoresDoAgente(config: ConfiguracaoDoAgente): Record<string, Manipulador> {
  return {
    [TIPO_RESPONDER_AGENTE]: {
      executar: (tarefa) => executarAgente(config, tarefa),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
        const diagnosticos = await publicarAgente(exigirTransacao(contexto), contexto.job.id, execucao);
        return {
          job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
          estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
          diagnosticos: diagnosticos.map((d) => ({ nivel: 'aviso' as const, codigo: d.codigo, mensagem: d.mensagem })),
        };
      },
    },
  };
}

/** Esforço do agente: `MARGEM_ESFORCO_AGENTE`, padrão `medium` (regra do projeto: medium salvo justificativa). */
export function esforcoDoAgente(ambiente: NodeJS.ProcessEnv = process.env): string {
  const valor = ambiente.MARGEM_ESFORCO_AGENTE;
  return valor === undefined || valor.trim() === '' ? ESFORCO_DO_AGENTE_PADRAO : valor.trim();
}
