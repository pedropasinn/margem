import { recuperarPublicacoes } from './arquivos-canonizacao.js';
/**
 * Processo do worker, separado da API.
 *
 * Desde o J07 a fila é a do Postgres (`FilaPostgres`) e os manipuladores são os
 * reais: `canonizar` (motor Python) e os dois do J06 (`ler_parte`,
 * `revisar_consistencia`). Nenhuma credencial entra no ambiente do motor
 * (ver `servico/src/executor/ambiente.ts`).
 */
import { pool } from '../db/conexao.js';
import { manipuladoresDasNoticias } from '../noticias/pipeline.js';
import { pedirEdicao } from '../noticias/repositorio.js';
import { join } from 'node:path';
import { manipuladoresDaResolucao } from '../resolucao/pipeline.js';
import { manipuladoresDaRevisao } from '../notas/revisar.js';
import { TIPO_RESPONDER, manipuladorResponder, responderFalso, type Responder } from '../conversa/responder.js';
import { responderCodex } from '../conversa/responder-codex.js';
import { executorAuditado, raizDaAuditoria } from '../executor/auditoria.js';
import type { Executor } from '../executor/tipos.js';
import { manipuladorCanonizar, TIPO_CANONIZAR } from './canonizar.js';
import { manipuladorCanonizarRevisao, TIPO_CANONIZAR_REVISAO } from '../midia/revisao.js';
import { manipuladorImportarYoutube, TIPO_IMPORTAR_YOUTUBE } from '../midia/importacao-youtube.js';
import { manipuladorTranscreverEscaneado, TIPO_TRANSCREVER_ESCANEADO } from '../escaneado/transcricao.js';
import {
  ESFORCO_PADRAO, MODELO_PADRAO, baseDosArtefatos, configuracaoDaCompreensao, configuracaoDaLeitura, escolherExecutor, esforcoDaLeituraComentada, esforcoDaVisita, esforcoDosVisuais,
} from './configuracao.js';
import { manipuladoresDosVisuais } from '../visuais/manipuladores.js';
import { esforcoDoAgente, manipuladoresDoAgente } from '../agente/manipulador.js';
import { manipuladoresDoEsquema } from '../esquema/manipuladores.js';
import { esforcoDosFlashcards, manipuladoresDosFlashcards } from '../flashcards/manipuladores.js';
import { manipuladoresDaVisita } from '../visita/manipuladores.js';
import { manipuladoresDosConceitos } from '../midia/conceitos.js';
import { manipuladoresDaLeituraComentada } from '../leitura-comentada/manipuladores.js';
import { escolherProvedorDeVoz, manipuladoresDaNarracao } from '../audio/narracao.js';
import { FilaPostgres } from './fila-postgres.js';
import type { FilaDeJobs } from './fila.js';
import { manipuladoresDaLeitura } from './manipuladores-leitura.js';
import { manipuladoresDaCompreensao } from '../compreensao/manipuladores.js';
import { SLOTS_PADRAO } from './slots.js';
import { recursosDoAmbiente } from '../recursos.js';
import { Worker } from './worker.js';
import type { Manipulador } from './worker.js';

function inteiroDoAmbiente(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined) return padrao;
  const valor = Number.parseInt(bruto, 10);
  return Number.isInteger(valor) && valor > 0 ? valor : padrao;
}

export function montarWorker(
  fila: FilaDeJobs,
  manipuladores: Record<string, Manipulador>,
): Worker {
  return new Worker({
    fila,
    manipuladores,
    slots: inteiroDoAmbiente('MARGEM_SLOTS', SLOTS_PADRAO),
    heartbeatMs: inteiroDoAmbiente('MARGEM_HEARTBEAT_MS', 30_000),
    prazoEncerramentoMs: inteiroDoAmbiente('MARGEM_PRAZO_ENCERRAMENTO_MS', 30_000),
    // `MARGEM_AUDITORIA=0` desliga a gravação de prompts e respostas (J26).
    ...(process.env.MARGEM_AUDITORIA === '0' ? {} : { auditoria: raizDaAuditoria() }),
    anotar: (anotacao) => {
      // Só fatos: identificador, tentativa e evento. Nunca prompt nem saída do motor.
      console.log(JSON.stringify({ ...anotacao, em: new Date().toISOString() }));
    },
  });
}

/**
 * Porta `Responder` do worker (J19). `MARGEM_RESPONDER=falso` escolhe a determinística
 * (testes e ensaios sem Codex); sem a variável, ou com `codex`, a real, com o mesmo
 * executor, modelo e esforço das leituras.
 */
export function escolherResponder(executor: Executor, ambiente: NodeJS.ProcessEnv = process.env): Responder {
  const escolha = ambiente.MARGEM_RESPONDER;
  if (escolha === 'falso') return responderFalso();
  if (escolha !== undefined && escolha !== '' && escolha !== 'codex') {
    throw new Error(`MARGEM_RESPONDER aceita falso ou codex, não ${escolha}.`);
  }
  return responderCodex({
    executor,
    modelo: ambiente.MARGEM_MODELO ?? MODELO_PADRAO,
    esforco: ambiente.MARGEM_ESFORCO ?? ESFORCO_PADRAO,
  });
}

/** Todos os tipos de job que o worker sabe processar. */
export function todosOsManipuladores(
  banco: typeof pool, executor: Executor, ambiente: NodeJS.ProcessEnv = process.env,
): Record<string, Manipulador> {
  const base = baseDosArtefatos(ambiente);
  const compreensao = configuracaoDaCompreensao({ banco, executor }, ambiente);
  // Notícias só com o recurso ligado (J102): sem manipulador, o worker nem reserva esses jobs.
  const noticias = recursosDoAmbiente(ambiente).has('noticias')
    ? manipuladoresDasNoticias({ banco, executor, modelo: compreensao.modelo, esforco: compreensao.esforcoDoPlano ?? compreensao.esforco })
    : {};
  return {
    ...noticias,
    [TIPO_CANONIZAR]: manipuladorCanonizar({ banco }),
    // Transcrição de vídeo revisada (J90): versão nova + mídia realinhada.
    [TIPO_CANONIZAR_REVISAO]: manipuladorCanonizarRevisao({ banco }),
    // Vídeo do YouTube por link (J109): legendas do vídeo (ou transcritor local) e só o áudio; nunca o vídeo.
    [TIPO_IMPORTAR_YOUTUBE]: manipuladorImportarYoutube({ banco }),
    // PDF escaneado: transcrição por visão das páginas sem texto, com o esforço dos visuais (medium).
    [TIPO_TRANSCREVER_ESCANEADO]: manipuladorTranscreverEscaneado({
      banco, executor, modelo: compreensao.modelo, esforco: esforcoDosVisuais(ambiente),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'transcricoes') }),
    }),
    ...manipuladoresDaLeitura(configuracaoDaLeitura({ banco, executor })),
    ...manipuladoresDaCompreensao(compreensao),
    // Resolução de exercícios (J34): mesmo modelo; resolver com o esforço das leituras, explicar com o do plano.
    ...manipuladoresDaResolucao({
      banco, executor, modelo: compreensao.modelo, esforco: compreensao.esforco,
      ...(compreensao.esforcoDoPlano === undefined ? {} : { esforcoDaExplicacao: compreensao.esforcoDoPlano }),
    }),
    // Revisão de nota do leitor pelo Codex (J37): o esforço do plano, como as explicações.
    ...manipuladoresDaRevisao({ banco, executor, modelo: compreensao.modelo, esforco: compreensao.esforcoDoPlano ?? compreensao.esforco }),
    // Visuais ancorados (J70): imagem e fluxograma, com esforço próprio (medium por padrão).
    ...manipuladoresDosVisuais({
      banco, executor, modelo: compreensao.modelo, esforco: esforcoDosVisuais(ambiente),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'visuais') }),
    }),
    // Esquema do capítulo (mapa esquemático): a partir do modelo da compreensão, esforço dos visuais (medium).
    ...manipuladoresDoEsquema({
      banco, executor, modelo: compreensao.modelo, esforco: esforcoDosVisuais(ambiente),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'esquemas') }),
    }),
    // Flashcards do capítulo: texto, grifos e notas do leitor → cartões ancorados, esforço `low` por padrão.
    ...manipuladoresDosFlashcards({
      banco, executor, modelo: compreensao.modelo, esforco: esforcoDosFlashcards(ambiente),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'flashcards') }),
    }),
    // Visita guiada do livro (J91): o roteiro narrado de cada capítulo, esforço `medium` por padrão.
    ...manipuladoresDaVisita({
      banco, executor, modelo: compreensao.modelo, esforco: esforcoDaVisita(ambiente),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'visitas') }),
    }),
    // Conceitos programados do vídeo (popups sobre a tela): esforço dos visuais (medium por padrão).
    ...manipuladoresDosConceitos({
      banco, executor, modelo: compreensao.modelo, esforco: esforcoDosVisuais(ambiente),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'conceitos') }),
    }),
    // Leitura comentada integral (J92): uma fala por pausa (grifos e relações), esforço `medium` por padrão.
    ...manipuladoresDaLeituraComentada({
      banco, executor, modelo: compreensao.modelo, esforco: esforcoDaLeituraComentada(ambiente),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'leituras-comentadas') }),
    }),
    // Página "Perguntar" (agente da biblioteca): export em Markdown só para leitura, esforço `medium` por padrão.
    ...manipuladoresDoAgente({
      banco, executor, modelo: compreensao.modelo, esforco: esforcoDoAgente(ambiente),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'agente'), diretorioBiblioteca: join(base, 'biblioteca') }),
    }),
    // Narração com a chave ElevenLabs da pessoa (J106): sem Codex; a chave é lida do arquivo de segredos na hora.
    ...manipuladoresDaNarracao({ banco, criarProvedor: escolherProvedorDeVoz(ambiente) }),
    [TIPO_RESPONDER]: manipuladorResponder({
      banco, responder: escolherResponder(executor, ambiente),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'respostas') }),
    }),
  };
}

export async function principal(): Promise<void> {
  const executor = executorAuditado(await escolherExecutor());
  const fila = new FilaPostgres(pool, { concessaoMs: inteiroDoAmbiente('MARGEM_CONCESSAO_MS', 60_000) });
  const worker = montarWorker(fila, todosOsManipuladores(pool, executor));
  let agendando = false;
  const comNoticias = recursosDoAmbiente().has('noticias');
  const agendarNoticias = async () => {
    if (agendando || !comNoticias) return;
    agendando = true;
    try { await pedirEdicao(pool, new Date(), true); }
    catch { console.error(JSON.stringify({ evento: 'agenda_noticias_falhou' })); }
    finally { agendando = false; }
  };
  // A agenda diária das Notícias só existe com o recurso ligado (J102).
  const agendaNoticias = comNoticias ? setInterval(() => { void agendarNoticias(); }, 60_000) : undefined;
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sinal, () => {
      console.log(JSON.stringify({ evento: 'parada_pedida', sinal, em: new Date().toISOString() }));
      worker.pedirParada();
    });
  }
  try {
    await agendarNoticias();
    await recuperarPublicacoes(pool);
    await worker.rodar();
  } finally {
    clearInterval(agendaNoticias);
    await pool.end();
  }
}

const caminho = process.argv[1] ?? '';
if (caminho.endsWith('worker/main.ts') || caminho.endsWith('worker/main.js')) {
  principal().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : 'falha desconhecida no worker');
    process.exitCode = 1;
  });
}
