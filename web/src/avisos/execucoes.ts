/**
 * Lógica dos avisos das execuções do Codex, sem React: cada lista que chega do serviço
 * (`ExecucoesDoCodexV1`, pelo SSE ou pela consulta) vira o estado dos avisos, e o estado vira o
 * que a pilha mostra.
 *
 * - Uma execução ativa (na fila ou rodando) ganha aviso ao aparecer e o perde se sumir da lista
 *   (cancelada, ou além do teto da lista).
 * - Ao concluir, o aviso fica `AUTO_DISPENSA_MS` e sai sozinho. Uma conclusão que este leitor
 *   nunca viu ativa só aparece se for recente (`CONCLUSAO_RECENTE_MS`): abrir o app não desenterra
 *   o que terminou minutos atrás.
 * - Uma falha fica até ser dispensada, mesmo depois de sair da lista do serviço.
 * - Dispensado não volta: o id fica lembrado enquanto o serviço ainda o listar.
 */
import type { ExecucaoDoCodexV1, ExecucoesDoCodexV1 } from '@margem/contratos';

export const AUTO_DISPENSA_MS = 6_000;
export const CONCLUSAO_RECENTE_MS = 30_000;
export const MAXIMO_VISIVEIS = 3;

export interface Aviso {
  execucao: ExecucaoDoCodexV1;
  /** Relógio do navegador em que este leitor viu a execução terminar. */
  terminouEm: number | null;
  dispensado: boolean;
}

export interface EstadoDosAvisos {
  avisos: Readonly<Record<string, Aviso>>;
  /** Ordem do serviço na última lista (a fila por prioridade). */
  ordem: readonly string[];
  omitidas: number;
  /** Relógio do serviço menos o do navegador, para o tempo decorrido. */
  desvioMs: number;
}

export type AcaoDosAvisos =
  | { tipo: 'lista'; lista: ExecucoesDoCodexV1; recebidaEm: number }
  | { tipo: 'dispensar'; id: string }
  | { tipo: 'expirar'; agora: number };

export const ESTADO_INICIAL: EstadoDosAvisos = { avisos: {}, ordem: [], omitidas: 0, desvioMs: 0 };

const ativa = (e: ExecucaoDoCodexV1) => e.estado === 'na_fila' || e.estado === 'rodando';

export function reduzirAvisos(estado: EstadoDosAvisos, acao: AcaoDosAvisos): EstadoDosAvisos {
  switch (acao.tipo) {
    case 'dispensar': {
      const aviso = estado.avisos[acao.id];
      if (!aviso || aviso.dispensado) return estado;
      return { ...estado, avisos: { ...estado.avisos, [acao.id]: { ...aviso, dispensado: true } } };
    }
    case 'expirar': {
      let mudou = false;
      const avisos: Record<string, Aviso> = {};
      for (const [id, aviso] of Object.entries(estado.avisos)) {
        const vencido = !aviso.dispensado && aviso.execucao.estado === 'concluida'
          && aviso.terminouEm !== null && acao.agora - aviso.terminouEm >= AUTO_DISPENSA_MS;
        avisos[id] = vencido ? { ...aviso, dispensado: true } : aviso;
        mudou ||= vencido;
      }
      return mudou ? { ...estado, avisos } : estado;
    }
    case 'lista': {
      const { lista, recebidaEm } = acao;
      const desvioMs = Date.parse(lista.gerado_em) - recebidaEm;
      const agoraNoServico = recebidaEm + desvioMs;
      const avisos: Record<string, Aviso> = {};
      const presentes = new Set<string>();
      for (const execucao of lista.execucoes) {
        presentes.add(execucao.id);
        const antes = estado.avisos[execucao.id];
        if (antes) {
          const terminouAgora = !ativa(execucao) && antes.terminouEm === null;
          avisos[execucao.id] = { ...antes, execucao, terminouEm: terminouAgora ? recebidaEm : antes.terminouEm };
          continue;
        }
        if (ativa(execucao)) { avisos[execucao.id] = { execucao, terminouEm: null, dispensado: false }; continue; }
        // Terminada e nunca vista ativa: a falha aparece (o serviço só lista as recentes); a conclusão, só se for de agora.
        const recente = execucao.estado === 'falhou'
          || (execucao.fim !== null && agoraNoServico - Date.parse(execucao.fim) <= CONCLUSAO_RECENTE_MS);
        avisos[execucao.id] = { execucao, terminouEm: recebidaEm, dispensado: !recente };
      }
      for (const [id, aviso] of Object.entries(estado.avisos)) {
        if (presentes.has(id)) continue;
        // Sumiu da lista: a falha fica até ser dispensada; a conclusão termina a contagem; o resto sai.
        if (aviso.dispensado) continue;
        if (aviso.execucao.estado === 'falhou') avisos[id] = aviso;
        else if (aviso.execucao.estado === 'concluida') avisos[id] = aviso;
      }
      return { avisos, ordem: lista.execucoes.map((e) => e.id), omitidas: lista.omitidas, desvioMs };
    }
  }
}

const PESO: Record<ExecucaoDoCodexV1['estado'], number> = { falhou: 0, concluida: 1, rodando: 2, na_fila: 3 };

export interface PilhaOrganizada {
  /** Os que aparecem como avisos, do mais importante ao menos. */
  visiveis: Aviso[];
  /** Os do agrupador "mais N em andamento". */
  agrupados: Aviso[];
  /** Quantos o agrupador anuncia: os agrupados e os que o serviço deixou fora da lista. */
  mais: number;
}

/** Falhas, conclusões, o que roda e por fim a fila; os três primeiros viram avisos. */
export function organizarPilha(estado: EstadoDosAvisos, maximo = MAXIMO_VISIVEIS): PilhaOrganizada {
  const posicao = new Map(estado.ordem.map((id, i) => [id, i]));
  const todos = Object.values(estado.avisos).filter((a) => !a.dispensado).sort((a, b) => {
    const peso = PESO[a.execucao.estado] - PESO[b.execucao.estado];
    if (peso !== 0) return peso;
    if (a.terminouEm !== null && b.terminouEm !== null && a.terminouEm !== b.terminouEm) return b.terminouEm - a.terminouEm;
    if (a.execucao.estado === 'rodando') return Date.parse(a.execucao.inicio) - Date.parse(b.execucao.inicio);
    return (posicao.get(a.execucao.id) ?? Infinity) - (posicao.get(b.execucao.id) ?? Infinity);
  });
  const visiveis = todos.slice(0, maximo);
  const agrupados = todos.slice(maximo);
  return { visiveis, agrupados, mais: agrupados.length + estado.omitidas };
}

/** "8 s", "3 min 05 s", "1 h 04 min". */
export function formatarDuracao(ms: number): string {
  const segundos = Math.max(0, Math.floor(ms / 1000));
  if (segundos < 60) return `${String(segundos)} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${String(minutos)} min ${String(segundos % 60).padStart(2, '0')} s`;
  return `${String(Math.floor(minutos / 60))} h ${String(minutos % 60).padStart(2, '0')} min`;
}

/** O tempo que o aviso mostra ao lado do estado. `agora` é o relógio do navegador. */
export function tempoDoAviso(execucao: ExecucaoDoCodexV1, agora: number, desvioMs: number): string {
  switch (execucao.estado) {
    case 'na_fila': return 'Na fila';
    case 'rodando': return formatarDuracao(agora + desvioMs - Date.parse(execucao.inicio));
    case 'concluida': return `Pronto em ${formatarDuracao(Date.parse(execucao.fim ?? execucao.inicio) - Date.parse(execucao.inicio))}`;
    case 'falhou': return 'Falhou';
  }
}

/** A frase para leitores de tela quando uma execução muda de estado (ou `null`, se nada a dizer). */
export function anuncioDaMudanca(antes: EstadoDosAvisos, depois: EstadoDosAvisos): string | null {
  for (const [id, aviso] of Object.entries(depois.avisos)) {
    if (aviso.dispensado) continue;
    const anterior = antes.avisos[id]?.execucao.estado;
    const atual = aviso.execucao.estado;
    if (anterior === atual) continue;
    if (atual === 'concluida') return `Pronto: ${aviso.execucao.rotulo}.`;
    if (atual === 'falhou') return `Falhou: ${aviso.execucao.rotulo}. ${aviso.execucao.mensagem ?? ''}`.trim();
    if (atual === 'rodando' && anterior === undefined) return `O Codex começou: ${aviso.execucao.rotulo}.`;
  }
  return null;
}

/** Conferência mínima do que veio da rede (o validador completo mora no serviço, que lê os schemas do disco). */
export function pareceLista(valor: unknown): valor is ExecucoesDoCodexV1 {
  if (typeof valor !== 'object' || valor === null) return false;
  const v = valor as Partial<ExecucoesDoCodexV1>;
  return v.versao === 1 && typeof v.gerado_em === 'string' && Array.isArray(v.execucoes) && typeof v.omitidas === 'number'
    && v.execucoes.every((e) => typeof e === 'object' && e !== null && typeof e.id === 'string' && typeof e.rotulo === 'string'
      && ['na_fila', 'rodando', 'concluida', 'falhou'].includes(e.estado));
}
