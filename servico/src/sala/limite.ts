/**
 * Limite de tentativas de entrada na sala, em memória do processo do portão: janela deslizante
 * por chave (`ip:<endereço>` e `sala:<slug>`). Só as falhas contam; o acerto limpa a chave do IP.
 *
 * Em memória por decisão: o portão é um processo só; reiniciá-lo zera as janelas, o que é
 * aceitável para um beta pequeno e evita escrever no banco a cada tentativa errada.
 */
export interface OpcoesDoLimite {
  maximo: number;
  janelaMs: number;
  agora?: () => number;
}

export class LimiteDeTentativas {
  private readonly falhas = new Map<string, number[]>();
  private readonly maximo: number;
  private readonly janelaMs: number;
  private readonly agora: () => number;

  constructor(opcoes: OpcoesDoLimite) {
    this.maximo = opcoes.maximo;
    this.janelaMs = opcoes.janelaMs;
    this.agora = opcoes.agora ?? Date.now;
  }

  private recentes(chave: string): number[] {
    const limiar = this.agora() - this.janelaMs;
    const lista = (this.falhas.get(chave) ?? []).filter((quando) => quando > limiar);
    if (lista.length === 0) this.falhas.delete(chave); else this.falhas.set(chave, lista);
    return lista;
  }

  /** Alguma das chaves já gastou as tentativas da janela. */
  bloqueado(chaves: readonly string[]): boolean {
    return chaves.some((chave) => this.recentes(chave).length >= this.maximo);
  }

  registrarFalha(chaves: readonly string[]): void {
    const agora = this.agora();
    for (const chave of chaves) {
      const lista = this.recentes(chave);
      lista.push(agora);
      this.falhas.set(chave, lista.slice(-this.maximo * 2));
    }
    // Não cresce sem fim: com muitas chaves, varre as vencidas.
    if (this.falhas.size > 10_000) for (const chave of [...this.falhas.keys()]) this.recentes(chave);
  }

  /**
   * Conta a tentativa ANTES de conferir a senha e devolve como retirá-la se ela acertar. Sem isso, uma
   * rajada de pedidos simultâneos passa toda por `bloqueado()` antes que a primeira falha seja registrada
   * (cada conferência é um scrypt assíncrono) e o teto não vale nada.
   */
  reservar(chaves: readonly string[]): () => void {
    const instante = this.agora();
    this.registrarFalha(chaves);
    let desfeita = false;
    return () => {
      if (desfeita) return;
      desfeita = true;
      for (const chave of chaves) {
        const lista = this.falhas.get(chave);
        const indice = lista?.lastIndexOf(instante) ?? -1;
        if (lista && indice >= 0) lista.splice(indice, 1);
      }
    };
  }

  limpar(chave: string): void {
    this.falhas.delete(chave);
  }
}

/** Padrão do portão: 10 falhas por 15 minutos, por IP e por sala. */
export const LIMITE_PADRAO: OpcoesDoLimite = { maximo: 10, janelaMs: 15 * 60 * 1000 };
