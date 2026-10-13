/**
 * Ouvinte de `NOTIFY margem_evento` (J14), no lugar da varredura de `evento_job` a cada
 * segundo.
 *
 * Uma conexão dedicada, fora do pool, faz `LISTEN margem_evento`. O gatilho da migração
 * 0003 dispara o `NOTIFY` na mesma transação que grava o evento, então o aviso só chega
 * depois do `COMMIT`. Cada fluxo SSE espera o próximo aviso ou o fim do intervalo de
 * segurança, o que vier primeiro, e aí lê o banco como antes: o aviso só acorda; quem diz
 * o que mudou é sempre a tabela. Caída a conexão, o ouvinte reconecta com espera crescente.
 */
import pg from 'pg';

export const CANAL_DE_EVENTOS = 'margem_evento';

export interface OpcoesDoOuvinte {
  /** Cria a conexão dedicada. Cada reconexão pede uma nova. */
  conectar: () => pg.Client;
  /** Primeira espera antes de reconectar; dobra a cada falha até `esperaMaximaMs`. */
  esperaInicialMs?: number;
  esperaMaximaMs?: number;
  /** Só fatos: nada de URL nem credencial. */
  anotar?: (evento: 'ouvindo' | 'caiu' | 'reconectando', detalhe?: string) => void;
}

export class OuvinteDeEventos {
  private cliente: pg.Client | null = null;
  private readonly esperando = new Set<() => void>();
  private encerrado = false;
  private espera: number;
  private relogio: NodeJS.Timeout | null = null;
  private pronto: Promise<void> | null = null;
  private readonly mortos = new WeakSet<pg.Client>();
  /** Quantos avisos chegaram desde que o ouvinte subiu (usado nos testes). */
  avisos = 0;
  /** Quantas vezes a conexão foi (re)estabelecida. */
  conexoes = 0;

  constructor(private readonly opcoes: OpcoesDoOuvinte) {
    this.espera = opcoes.esperaInicialMs ?? 250;
  }

  /** Abre a conexão e começa a escutar; as falhas seguintes são tratadas por reconexão. */
  iniciar(): Promise<void> {
    this.pronto ??= this.conectar();
    return this.pronto;
  }

  get ouvindo(): boolean {
    return this.cliente !== null;
  }

  private async conectar(): Promise<void> {
    if (this.encerrado) return;
    const cliente = this.opcoes.conectar();
    const caiu = (erro?: Error) => { this.aoCair(cliente, erro); };
    cliente.on('error', caiu);
    cliente.on('end', () => { caiu(); });
    cliente.on('notification', (mensagem) => {
      if (mensagem.channel !== CANAL_DE_EVENTOS) return;
      this.avisos += 1;
      this.acordar();
    });
    try {
      await cliente.connect();
      await cliente.query(`LISTEN ${CANAL_DE_EVENTOS}`);
    } catch (erro) {
      this.aoCair(cliente, erro instanceof Error ? erro : undefined);
      return;
    }
    if (this.encerrado) { await cliente.end().catch(() => undefined); return; }
    this.cliente = cliente;
    this.conexoes += 1;
    this.espera = this.opcoes.esperaInicialMs ?? 250;
    this.opcoes.anotar?.('ouvindo');
    // Avisos perdidos durante a queda: quem espera relê a tabela agora.
    this.acordar();
  }

  private aoCair(cliente: pg.Client, erro?: Error): void {
    // `error` e `end` costumam chegar juntos: cada conexão cai uma vez só.
    if (this.mortos.has(cliente)) return;
    this.mortos.add(cliente);
    if (this.cliente === cliente) this.cliente = null;
    cliente.removeAllListeners('notification');
    void cliente.end().catch(() => undefined);
    if (this.encerrado || this.relogio !== null) return;
    this.opcoes.anotar?.('caiu', erro?.name);
    const espera = this.espera;
    this.espera = Math.min(espera * 2, this.opcoes.esperaMaximaMs ?? 15_000);
    this.relogio = setTimeout(() => {
      this.relogio = null;
      this.opcoes.anotar?.('reconectando');
      void this.conectar();
    }, espera);
    this.relogio.unref?.();
  }

  private acordar(): void {
    const quem = [...this.esperando];
    this.esperando.clear();
    for (const acordar of quem) acordar();
  }

  /**
   * Resolve no próximo aviso, no fim de `limiteMs` (o intervalo de segurança) ou quando
   * `sinal` aborta — o que vier primeiro. Nunca rejeita.
   */
  esperar(limiteMs: number, sinal?: AbortSignal): Promise<'aviso' | 'intervalo' | 'abortado'> {
    return new Promise((resolver) => {
      if (sinal?.aborted || this.encerrado) { resolver('abortado'); return; }
      const terminar = (motivo: 'aviso' | 'intervalo' | 'abortado') => {
        clearTimeout(relogio);
        this.esperando.delete(aoAviso);
        sinal?.removeEventListener('abort', aoAbortar);
        resolver(motivo);
      };
      const aoAviso = () => { terminar('aviso'); };
      const aoAbortar = () => { terminar('abortado'); };
      const relogio = setTimeout(() => { terminar('intervalo'); }, limiteMs);
      this.esperando.add(aoAviso);
      sinal?.addEventListener('abort', aoAbortar, { once: true });
    });
  }

  /** Derruba a conexão como se a rede tivesse caído (só para testes de reconexão). */
  derrubarParaTeste(): void {
    const cliente = this.cliente;
    if (cliente) this.aoCair(cliente, new Error('queda simulada'));
  }

  async encerrar(): Promise<void> {
    this.encerrado = true;
    if (this.relogio !== null) { clearTimeout(this.relogio); this.relogio = null; }
    this.acordar();
    const cliente = this.cliente;
    this.cliente = null;
    if (cliente) {
      cliente.removeAllListeners();
      cliente.on('error', () => undefined);
      await cliente.end().catch(() => undefined);
    }
  }
}

/** Ouvinte cuja conexão dedicada usa a mesma configuração do pool, fora dele. */
export function ouvinteDoPool(banco: pg.Pool, opcoes: Omit<OpcoesDoOuvinte, 'conectar'> = {}): OuvinteDeEventos {
  const { connectionString, connectionTimeoutMillis } = banco.options;
  return new OuvinteDeEventos({
    ...opcoes,
    conectar: () => new pg.Client({
      ...(connectionString === undefined ? {} : { connectionString }),
      ...(connectionTimeoutMillis === undefined ? {} : { connectionTimeoutMillis }),
    }),
  });
}
