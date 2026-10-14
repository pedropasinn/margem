/**
 * Supervisão dos processos do serviço (API e worker) dentro do app.
 *
 * Cada processo é o executável do próprio app com `ELECTRON_RUN_AS_NODE=1` rodando um bundle do
 * serviço, com canal IPC. Caiu sem ninguém pedir: volta com recuo exponencial (1 s, 2 s, 4 s… até
 * 30 s); rodou estável por um minuto, o recuo zera; caiu demais seguidas, o supervisor desiste e
 * avisa o app (que mostra o erro e aponta os registros). Parar é pedir pelo IPC (`margem:parar`, que
 * o serviço trata como o SIGTERM — o worker termina a tarefa atual ou a devolve à fila; J114), esperar
 * o prazo e só então encerrar a árvore à força: o grupo de processos no Linux e no macOS (o filho nasce
 * líder do grupo), `taskkill /T /F` no Windows — assim o Codex e o motor que o worker rodava saem juntos.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { encerrarArvore, MENSAGEM_DE_PARADA } from '../../../servico/src/plataforma/processos.js';
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
}

export type ResultadoDaParada = 'ja_parado' | 'limpo' | 'forcado';

export class Supervisor {
  private filho: ChildProcess | null = null;
  private iniciadoEm = 0;
  private falhas = 0;
  private espera: NodeJS.Timeout | null = null;
  private _estado: EstadoDoProcesso = 'parado';
  private aguardandoSaida: (() => void)[] = [];
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
    const esperando = this.aguardandoSaida;
    this.aguardandoSaida = [];
    for (const avisar of esperando) avisar();
    if (this._estado === 'parando' || this._estado === 'parado') { this._estado = 'parado'; return; }
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
