/**
 * Supervisão dos processos do serviço (API e worker) dentro do app.
 *
 * Cada processo é o executável do próprio app com `ELECTRON_RUN_AS_NODE=1` rodando um bundle do
 * serviço, com canal IPC. Caiu sem ninguém pedir: volta com recuo exponencial (1 s, 2 s, 4 s… até
 * 30 s); rodou estável por um minuto, o recuo zera; caiu demais seguidas, o supervisor desiste e
 * avisa o app (que mostra o erro e aponta os registros). Parar é pedir pelo IPC (`margem:parar`, que
 * o serviço trata como o SIGTERM — o worker termina a tarefa atual ou a devolve à fila; J114), esperar
 * o prazo e só então encerrar a árvore à força: o grupo de processos no Linux e no macOS (o filho nasce
 * líder do grupo), `taskkill /T /F` no Windows — assim o motor que o worker rodava sai junto.
 *
 * O Codex nasce líder do próprio grupo (para o prazo e o cancelamento de uma leitura levarem a árvore
 * dele), então não está no grupo do worker: o worker anuncia cada grupo pelo IPC (`margem:grupo`), e,
 * quando o worker sai — caiu, foi morto à força ou parou —, o supervisor encerra os grupos anunciados que
 * sobraram e o grupo do próprio worker, antes de qualquer reinício (L-03).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  ehAvisoDeGrupo, encerrarArvore, encerrarGrupoOrfao, MENSAGEM_DE_PARADA, type Encerrador,
} from '../../../servico/src/plataforma/processos.js';
import { cortadorDeLinhas } from './registros.js';

export interface DefinicaoDoProcesso {
  nome: string;
  /** Script JS que o executável roda. */
  script: string;
  argumentos?: readonly string[];
  ambiente: NodeJS.ProcessEnv;
  cwd?: string;
  /** Padrão: `process.execPath` (o Electron, que vira Node com `ELECTRON_RUN_AS_NODE=1`). */
  executavel?: string;
}

export interface OpcoesDoRecuo { inicialMs: number; maximoMs: number; fator: number }
export const RECUO_PADRAO: OpcoesDoRecuo = { inicialMs: 1_000, maximoMs: 30_000, fator: 2 };

/** Espera antes da tentativa seguinte à `falhas`-ésima queda seguida (1 → inicial). */
export function atrasoDoRecuo(falhas: number, recuo: OpcoesDoRecuo = RECUO_PADRAO): number {
  if (falhas <= 0) return 0;
  return Math.min(recuo.maximoMs, Math.round(recuo.inicialMs * recuo.fator ** (falhas - 1)));
}

export type EstadoDoProcesso = 'parado' | 'rodando' | 'esperando' | 'parando' | 'desistiu';

export interface OpcoesDoSupervisor {
  recuo?: OpcoesDoRecuo;
  /** Rodou pelo menos isto: a queda seguinte conta como a primeira. */
  estavelMs?: number;
  /** Quedas seguidas antes de desistir. */
  maximoDeFalhas?: number;
  /** Quanto esperar pela saída limpa antes de matar. */
  prazoDeParadaMs?: number;
  aoLinha?: (linha: string, fluxo: 'saida' | 'erro') => void;
  anotar?: (evento: string, detalhe?: Record<string, unknown>) => void;
  aoDesistir?: (ultimoCodigo: number | null) => void;
  relogio?: () => number;
  /** Troca o encerramento dos grupos que sobraram (testes). */
  encerrador?: Encerrador;
}

export type ResultadoDaParada = 'ja_parado' | 'limpo' | 'forcado';

export class Supervisor {
  private filho: ChildProcess | null = null;
  private iniciadoEm = 0;
  private falhas = 0;
  private espera: NodeJS.Timeout | null = null;
  private _estado: EstadoDoProcesso = 'parado';
  private aguardandoSaida: (() => void)[] = [];
  /** Grupos próprios (o Codex) que o filho anunciou e que ainda não saíram. */
  private grupos = new Set<number>();
  /** O filho avisou um erro que reiniciar não resolve (D-07): a próxima saída é a última. */
  private semReinicio: string | null = null;
  private readonly relogio: () => number;

  constructor(private readonly definicao: DefinicaoDoProcesso, private readonly opcoes: OpcoesDoSupervisor = {}) {
    this.relogio = opcoes.relogio ?? Date.now;
  }

  get estado(): EstadoDoProcesso { return this._estado; }
  get pid(): number | undefined { return this.filho?.pid; }
  get quedasSeguidas(): number { return this.falhas; }

  iniciar(): void {
    if (this._estado === 'rodando' || this._estado === 'parando') return;
    this.falhas = 0;
    this.semReinicio = null;
    this.subir();
  }

  private anotar(evento: string, detalhe: Record<string, unknown> = {}): void {
    this.opcoes.anotar?.(evento, { processo: this.definicao.nome, ...detalhe });
  }

  private subir(): void {
    this.espera = null;
    const { definicao } = this;
    const filho = spawn(definicao.executavel ?? process.execPath, [definicao.script, ...(definicao.argumentos ?? [])], {
      env: { ...definicao.ambiente, ELECTRON_RUN_AS_NODE: '1' },
      ...(definicao.cwd === undefined ? {} : { cwd: definicao.cwd }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      // Fora do Windows, líder do próprio grupo: a parada forçada leva os netos junto.
      detached: process.platform !== 'win32',
    });
    this.filho = filho;
    this.iniciadoEm = this.relogio();
    this._estado = 'rodando';
    this.anotar('processo_iniciado', { pid: filho.pid ?? null });
    const saida = cortadorDeLinhas((linha) => this.opcoes.aoLinha?.(linha, 'saida'));
    const erro = cortadorDeLinhas((linha) => this.opcoes.aoLinha?.(linha, 'erro'));
    filho.stdout?.on('data', (pedaco: Buffer) => { saida.empurrar(pedaco); });
    filho.stderr?.on('data', (pedaco: Buffer) => { erro.empurrar(pedaco); });
    this.grupos = new Set();
    filho.on('message', (mensagem: unknown) => {
      if (!ehAvisoDeGrupo(mensagem) || this.filho !== filho) return;
      if (mensagem.acao === 'abrir') this.grupos.add(mensagem.pid);
      else this.grupos.delete(mensagem.pid);
    });
    // Erro de spawn (executável inexistente): o `exit` pode não vir; tratamos como queda.
    filho.on('error', (falha) => {
      this.anotar('processo_erro', { mensagem: falha.message });
      if (filho.exitCode === null && filho.pid === undefined) this.aoSair(filho, null, null);
    });
    filho.on('exit', (codigo, sinal) => {
      saida.terminar();
      erro.terminar();
      this.aoSair(filho, codigo, sinal);
    });
  }

  private aoSair(filho: ChildProcess, codigo: number | null, sinal: NodeJS.Signals | null): void {
    if (this.filho !== filho) return;
    this.filho = null;
    this.anotar('processo_saiu', { codigo, sinal });
    this.recolherDescendentes(filho);
    const esperando = this.aguardandoSaida;
    this.aguardandoSaida = [];
    for (const avisar of esperando) avisar();
    if (this._estado === 'parando' || this._estado === 'parado') { this._estado = 'parado'; return; }
    if (this.semReinicio !== null) {
      // Quem pediu (o serviço) já cuida da mensagem: sem reinício e sem o aviso de queda genérico.
      this._estado = 'desistiu';
      this.anotar('processo_desistiu', { motivo: this.semReinicio });
      return;
    }
    const rodou = this.relogio() - this.iniciadoEm;
    this.falhas = rodou >= (this.opcoes.estavelMs ?? 60_000) ? 1 : this.falhas + 1;
    if (this.falhas > (this.opcoes.maximoDeFalhas ?? 8)) {
      this._estado = 'desistiu';
      this.anotar('processo_desistiu', { quedas: this.falhas });
      this.opcoes.aoDesistir?.(codigo);
      return;
    }
    const atraso = atrasoDoRecuo(this.falhas, this.opcoes.recuo ?? RECUO_PADRAO);
    this._estado = 'esperando';
    this.anotar('processo_reinicio_agendado', { em_ms: atraso, quedas: this.falhas });
    this.espera = setTimeout(() => { this.subir(); }, atraso);
  }

  /**
   * O filho saiu: o que ele deixou (grupos anunciados, netos no grupo dele) não tem mais dono e sai à força.
   * Numa saída limpa não sobra nada, e o encerramento não acha ninguém.
   */
  private recolherDescendentes(filho: ChildProcess): void {
    const grupos = [...this.grupos];
    this.grupos = new Set();
    const encerrador = this.opcoes.encerrador ?? {};
    for (const pid of grupos) void encerrarGrupoOrfao(pid, encerrador);
    // O grupo do próprio filho (nasceu líder fora do Windows): netos comuns, como o motor.
    if (process.platform !== 'win32' && filho.pid !== undefined) void encerrarGrupoOrfao(filho.pid, encerrador);
    if (grupos.length > 0) this.anotar('processo_descendentes_encerrados', { grupos: grupos.length });
  }

  private esperarSaida(prazoMs: number): Promise<boolean> {
    if (this.filho === null) return Promise.resolve(true);
    return new Promise((resolver) => {
      const relogio = setTimeout(() => {
        this.aguardandoSaida = this.aguardandoSaida.filter((f) => f !== avisar);
        resolver(false);
      }, prazoMs);
      const avisar = (): void => { clearTimeout(relogio); resolver(true); };
      this.aguardandoSaida.push(avisar);
    });
  }

  /**
   * O filho disse que não adianta tentar de novo (ex.: `banco_mais_novo`, D-07): quando ele sair, fica
   * `desistiu`, sem reinício e sem `aoDesistir`. Se já saiu e espera o reinício, desiste agora.
   */
  naoReiniciar(motivo: string): void {
    this.semReinicio = motivo;
    if (this._estado === 'esperando') {
      if (this.espera !== null) { clearTimeout(this.espera); this.espera = null; }
      this._estado = 'desistiu';
      this.anotar('processo_desistiu', { motivo });
    }
  }

  /** Para de vez (sem reinício). Pede com educação, espera o prazo e só então mata. */
  async parar(): Promise<ResultadoDaParada> {
    if (this.espera !== null) { clearTimeout(this.espera); this.espera = null; }
    const filho = this.filho;
    if (filho === null) { this._estado = 'parado'; return 'ja_parado'; }
    this._estado = 'parando';
    this.anotar('processo_parada_pedida');
    let pedido = false;
    if (filho.connected) {
      try { pedido = filho.send(MENSAGEM_DE_PARADA); } catch { pedido = false; }
    }
    if (!pedido) await encerrarArvore(filho, 'suave', { grupo: process.platform !== 'win32' });
    if (await this.esperarSaida(this.opcoes.prazoDeParadaMs ?? 40_000)) return 'limpo';
    this.anotar('processo_morto_a_forca');
    await encerrarArvore(filho, 'forcado', { grupo: process.platform !== 'win32' });
    await this.esperarSaida(10_000);
    return 'forcado';
  }
}
