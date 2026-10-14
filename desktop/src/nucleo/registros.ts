/**
 * Registro em arquivo com rotação por tamanho: `api.log`, `api.1.log`, `api.2.log`… na pasta
 * `registros/` do app. Escrita síncrona e curta: o registro tem de sobreviver a uma queda logo depois.
 * Nunca recebe segredos (a URL do banco não é registrada; ver `servico.ts`).
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export interface OpcoesDoRegistro {
  limiteBytes?: number;
  /** Quantos arquivos antigos guardar além do atual. */
  antigos?: number;
  /** Também repete cada linha aqui (o modo `--sem-janela` manda para a saída padrão). */
  eco?: (linha: string) => void;
}

export function nomeDoAntigo(caminho: string, indice: number): string {
  const extensao = extname(caminho);
  return join(dirname(caminho), `${basename(caminho, extensao)}.${String(indice)}${extensao}`);
}

/** Gira `x.log` → `x.1.log` → `x.2.log`…, apagando o mais velho. */
export function girar(caminho: string, antigos: number): void {
  rmSync(nomeDoAntigo(caminho, antigos), { force: true });
  for (let indice = antigos - 1; indice >= 1; indice -= 1) {
    const origem = nomeDoAntigo(caminho, indice);
    if (existsSync(origem)) renameSync(origem, nomeDoAntigo(caminho, indice + 1));
  }
  if (existsSync(caminho)) renameSync(caminho, nomeDoAntigo(caminho, 1));
}

/** Gira antes de entregar o arquivo a outro processo (o log do Postgres, escrito pelo `pg_ctl`). */
export function girarSeGrande(caminho: string, limiteBytes = 5 * 1024 * 1024, antigos = 3): void {
  try {
    if (statSync(caminho).size >= limiteBytes) girar(caminho, antigos);
  } catch {
    // Arquivo ainda não existe.
  }
}

export class Registro {
  private readonly limite: number;
  private readonly antigos: number;
  private tamanho: number;

  constructor(readonly caminho: string, private readonly opcoes: OpcoesDoRegistro = {}) {
    this.limite = opcoes.limiteBytes ?? 5 * 1024 * 1024;
    this.antigos = opcoes.antigos ?? 3;
    mkdirSync(dirname(caminho), { recursive: true });
    try { this.tamanho = statSync(caminho).size; } catch { this.tamanho = 0; }
  }

  escrever(texto: string): void {
    const linha = `${new Date().toISOString()} ${texto.replace(/\s+$/u, '')}\n`;
    this.opcoes.eco?.(linha);
    try {
      if (this.tamanho + Buffer.byteLength(linha) > this.limite && this.tamanho > 0) {
        girar(this.caminho, this.antigos);
        this.tamanho = 0;
      }
      appendFileSync(this.caminho, linha);
      this.tamanho += Buffer.byteLength(linha);
    } catch {
      // Disco cheio ou pasta sumiu: o app continua; o registro é melhor esforço.
    }
  }

  /** Um evento estruturado (uma linha JSON), como o serviço já registra. */
  evento(evento: string, detalhe: Record<string, unknown> = {}): void {
    this.escrever(JSON.stringify({ evento, ...detalhe }));
  }
}

/** Corta um fluxo de bytes em linhas inteiras (os pedaços do `stdout` chegam em qualquer ponto). */
export function cortadorDeLinhas(aoLer: (linha: string) => void): { empurrar: (pedaco: Buffer | string) => void; terminar: () => void } {
  let resto = '';
  return {
    empurrar(pedaco) {
      resto += pedaco.toString();
      const linhas = resto.split(/\r?\n/u);
      resto = linhas.pop() ?? '';
      for (const linha of linhas) if (linha.trim() !== '') aoLer(linha);
    },
    terminar() {
      if (resto.trim() !== '') aoLer(resto);
      resto = '';
    },
  };
}
