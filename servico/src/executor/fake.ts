import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { crc32, deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { conferirResposta, diretorioArtefatosPadrao, guardarArtefato, sha256 } from './artefato.js';
import { ARQUIVO_SAIDA, PREFIXO_TEMPORARIO } from './codex.js';
import { falhou } from './tipos.js';
import type { PedidoExecucao, ResultadoExecutor } from './tipos.js';

/** PNG válido e determinístico (RGB, sem entrelaçamento) para os testes das imagens (J70). */
export function pngDeTeste(largura: number, altura: number, semente = 0): Buffer {
  const pedaco = (tipo: string, dados: Buffer): Buffer => {
    const tamanho = Buffer.alloc(4); tamanho.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
    const verificacao = Buffer.alloc(4); verificacao.writeUInt32BE(crc32(corpo));
    return Buffer.concat([tamanho, corpo, verificacao]);
  };
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0); cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8; cabecalho[9] = 2; cabecalho[10] = 0; cabecalho[11] = 0; cabecalho[12] = 0;
  const linhas: number[] = [];
  for (let y = 0; y < altura; y += 1) {
    linhas.push(0);
    for (let x = 0; x < largura; x += 1) linhas.push((x * 31 + semente) % 256, (y * 17 + semente) % 256, (x + y + semente) % 256);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', cabecalho), pedaco('IDAT', deflateSync(Buffer.from(linhas))), pedaco('IEND', Buffer.alloc(0)),
  ]);
}

/** Desfechos que o roteiro sabe encenar. */
export type TipoPasso =
  | 'ok'
  | 'json_truncado'
  | 'fora_do_schema'
  | 'timeout'
  | 'cota'
  | 'auth'
  | 'processo'
  | 'cancelado';

export interface PassoRoteiro {
  /** Casamento por hash do prompt ou por ordem da chamada (1 em diante). */
  quando?: { sha256_prompt?: string; ordem?: number };
  tipo: TipoPasso;
  /** Resposta final para `ok` e `fora_do_schema`. */
  conteudo?: unknown;
  /** Texto cru para `json_truncado`. */
  bruto?: string;
  not_before?: string;
  atraso_ms?: number;
  modelo?: string;
  /** Esforço que o executor falso declara ter usado (J14). */
  esforco?: string;
  mensagem?: string;
  /**
   * J70: quantos PNGs a execução "gera" quando o pedido tem `gerarImagem` (padrão 1; 0 encena o
   * Codex que termina sem imagem). Os PNGs são determinísticos: mesma ordem, mesmos bytes.
   */
  imagens?: number;
}

export interface Roteiro {
  versao: 1;
  passos: PassoRoteiro[];
}

export interface ExecutorFalso {
  (pedido: PedidoExecucao): Promise<ResultadoExecutor>;
  /** Diretórios temporários que o executor usou; servem para provar a limpeza. */
  readonly diretorios: string[];
  readonly chamadas: number;
}

export function roteiroValido(valor: unknown): valor is Roteiro {
  if (typeof valor !== 'object' || valor === null) return false;
  const candidato = valor as { versao?: unknown; passos?: unknown };
  if (candidato.versao !== 1 || !Array.isArray(candidato.passos)) return false;
  return candidato.passos.every((passo) =>
    typeof passo === 'object' && passo !== null && typeof (passo as { tipo?: unknown }).tipo === 'string');
}

export async function carregarRoteiro(caminho: string): Promise<Roteiro> {
  const valor = JSON.parse(await readFile(caminho, 'utf8')) as unknown;
  if (!roteiroValido(valor)) throw new Error(`Roteiro inválido: ${caminho}`);
  return valor;
}

function escolherPasso(roteiro: Roteiro, prompt: string, ordem: number): PassoRoteiro {
  const hash = sha256(prompt);
  const porHash = roteiro.passos.find((passo) => passo.quando?.sha256_prompt === hash);
  if (porHash) return porHash;
  const porOrdem = roteiro.passos.find((passo) => passo.quando?.ordem === ordem);
  if (porOrdem) return porOrdem;
  const livres = roteiro.passos.filter((passo) => passo.quando === undefined);
  const escolhido = livres[(ordem - 1) % Math.max(livres.length, 1)];
  if (!escolhido) throw new Error('Roteiro sem passo aplicável a esta chamada.');
  return escolhido;
}

type Interrupcao = 'atraso' | 'prazo' | 'cancelado';

function esperar(atrasoMs: number, prazoMs: number, sinal: AbortSignal | undefined): Promise<Interrupcao> {
  return new Promise<Interrupcao>((resolver) => {
    if (sinal?.aborted) { resolver('cancelado'); return; }
    const relogios: NodeJS.Timeout[] = [];
    const terminar = (causa: Interrupcao) => {
      for (const relogio of relogios) clearTimeout(relogio);
      sinal?.removeEventListener('abort', aoCancelar);
      resolver(causa);
    };
    const aoCancelar = () => { terminar('cancelado'); };
    sinal?.addEventListener('abort', aoCancelar, { once: true });
    if (atrasoMs < prazoMs) relogios.push(setTimeout(() => { terminar('atraso'); }, atrasoMs));
    relogios.push(setTimeout(() => { terminar('prazo'); }, prazoMs));
  });
}

/**
 * Executor determinístico usado por todos os testes do repositório.
 * Nunca chama o Codex; encena o roteiro e exercita o mesmo caminho de conferência
 * e de limpeza do temporário que o executor real.
 */
export function criarExecutorFalso(roteiro: Roteiro): ExecutorFalso {
  const diretorios: string[] = [];
  let chamadas = 0;

  const executar = async (pedido: PedidoExecucao): Promise<ResultadoExecutor> => {
    const inicio = Date.now();
    chamadas += 1;
    Object.defineProperty(executar, 'chamadas', { value: chamadas, configurable: true });
    const passo = escolherPasso(roteiro, pedido.prompt, chamadas);
    const diretorio = await mkdtemp(join(tmpdir(), PREFIXO_TEMPORARIO));
    diretorios.push(diretorio);
    try {
      const atraso = passo.atraso_ms ?? (passo.tipo === 'timeout' || passo.tipo === 'cancelado' ? pedido.prazoMs + 1 : 0);
      const causa = await esperar(atraso, pedido.prazoMs, pedido.sinal);
      const duracao_ms = Date.now() - inicio;
      if (causa === 'cancelado') return falhou('cancelado', 'Cancelamento pedido para o job.', duracao_ms);
      if (causa === 'prazo') return falhou('timeout', `Prazo de ${String(pedido.prazoMs)} ms estourado; árvore de processos encerrada.`, duracao_ms);

      switch (passo.tipo) {
        case 'cota':
          return {
            estado: 'adiado', codigo: 'cota',
            not_before: new Date(passo.not_before ?? Date.now() + 3_600_000),
            mensagem: passo.mensagem ?? 'Cota da conta esgotada; execução adiada.',
            duracao_ms,
          };
        case 'auth':
          return falhou('auth', passo.mensagem ?? 'Conta do Codex sem sessão válida.', duracao_ms);
        case 'processo':
          return falhou('processo', passo.mensagem ?? 'A CLI terminou com código 137.', duracao_ms);
        case 'timeout':
          return falhou('timeout', passo.mensagem ?? 'Prazo estourado.', duracao_ms);
        case 'cancelado':
          return falhou('cancelado', passo.mensagem ?? 'Cancelamento pedido para o job.', duracao_ms);
        default: {
          const saida = join(diretorio, ARQUIVO_SAIDA);
          const bytes = passo.tipo === 'json_truncado'
            ? passo.bruto ?? '{"marcas": [{"funcao": "tese",'
            : JSON.stringify(passo.conteudo ?? {});
          await writeFile(saida, bytes, { mode: 0o600 });
          const conferencia = await conferirResposta(saida, pedido.schema);
          if (conferencia.estado !== 'ok') {
            return falhou(conferencia.estado, conferencia.mensagem, Date.now() - inicio);
          }
          const artefato = await guardarArtefato(
            conferencia.bytes,
            pedido.diretorioArtefatos ?? diretorioArtefatosPadrao(),
            basename(diretorio),
          );
          const esforco = passo.esforco ?? pedido.esforco;
          let imagens: string[] | undefined;
          if (pedido.gerarImagem === true) {
            const quantas = passo.imagens ?? 1;
            if (quantas === 0) return falhou('sem_imagem', 'O Codex terminou sem gerar imagem.', Date.now() - inicio);
            const pasta = join(pedido.diretorioArtefatos ?? diretorioArtefatosPadrao(), `imagens-${basename(diretorio)}`);
            await mkdir(pasta, { recursive: true, mode: 0o700 });
            imagens = [];
            for (let i = 0; i < quantas; i += 1) {
              const caminho = join(pasta, `exec-${String(i)}.png`);
              await writeFile(caminho, pngDeTeste(8 + chamadas, 6 + i, chamadas * 10 + i), { mode: 0o600 });
              imagens.push(caminho);
            }
          }
          return {
            estado: 'ok', artefato, sha256: conferencia.sha256,
            duracao_ms: Date.now() - inicio,
            modelo: passo.modelo ?? pedido.modelo ?? 'executor-falso',
            ...(esforco === undefined ? {} : { esforco }),
            ...(imagens === undefined ? {} : { imagens }),
          };
        }
      }
    } finally {
      await rm(diretorio, { recursive: true, force: true });
    }
  };

  Object.defineProperty(executar, 'diretorios', { value: diretorios });
  Object.defineProperty(executar, 'chamadas', { value: 0, configurable: true });
  return executar as ExecutorFalso;
}
