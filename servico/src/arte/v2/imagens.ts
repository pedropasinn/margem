/**
 * Imagens que o algoritmo v2 mostra ao Codex: a obra reduzida com uma grade de coordenadas, ladrilhos
 * ampliados e recortes de cada região. Toda grade é rotulada em coordenadas **da obra inteira** (0..1),
 * para que o modelo leia a posição direto na figura em vez de estimar proporções de cabeça. É o ponto em
 * que o v1 falhava (regiões largas e aproximadas). Feito com o ffmpeg do sistema (crop, scale, drawbox,
 * drawtext); nenhuma dependência nova.
 */
import { spawn } from 'node:child_process';
import type { RetanguloDaObra } from '@margem/contratos';

export interface Dimensoes { largura: number; altura: number }
export interface PedidoDeImagem {
  /** Parte da obra a mostrar, normalizada. */
  recorte: RetanguloDaObra;
  /** Lado maior da saída em pixels. */
  ladoMax: number;
  /** Mostrar a grade de coordenadas (passo escolhido pelo tamanho do recorte). */
  grade: boolean;
  /** Retângulos desenhados por cima (regiões candidatas), com rótulo curto. */
  caixas: { retangulo: RetanguloDaObra; rotulo: string }[];
}
export type PrepararImagem = (origem: string, destino: string, pedido: PedidoDeImagem, dimensoes: Dimensoes) => Promise<void>;

export const FONTE_DOS_ROTULOS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const par = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** Passo da grade: o maior entre 0,1/0,05/0,02/0,01 que ainda dá seis linhas no menor lado do recorte. */
export function passoDaGrade(recorte: RetanguloDaObra): number {
  const menor = Math.min(recorte.largura, recorte.altura);
  return [0.1, 0.05, 0.02, 0.01].find((p) => menor / p >= 6) ?? 0.01;
}

function rotuloDaCoordenada(valor: number, passo: number): string {
  return valor.toFixed(passo >= 0.1 ? 1 : 2);
}

/** Cadeia de filtros do ffmpeg para um pedido; pura, testável sem ffmpeg. */
export function filtroDaImagem(dim: Dimensoes, pedido: PedidoDeImagem): { filtro: string; saida: Dimensoes } {
  const r = pedido.recorte;
  const cx = Math.round(r.x * dim.largura), cy = Math.round(r.y * dim.altura);
  const cw = Math.max(2, Math.min(dim.largura - cx, Math.round(r.largura * dim.largura)));
  const ch = Math.max(2, Math.min(dim.altura - cy, Math.round(r.altura * dim.altura)));
  const escala = Math.min(3, pedido.ladoMax / Math.max(cw, ch));
  const saida = { largura: par(cw * escala), altura: par(ch * escala) };
  const filtros = [`crop=${String(cw)}:${String(ch)}:${String(cx)}:${String(cy)}`, `scale=${String(saida.largura)}:${String(saida.altura)}`];
  const corpo = Math.max(12, Math.round(Math.max(saida.largura, saida.altura) / 70));
  const texto = (t: string, x: number, y: number, cor = 'white') =>
    `drawtext=fontfile=${FONTE_DOS_ROTULOS}:text='${t}':x=${String(Math.round(x))}:y=${String(Math.round(y))}:fontsize=${String(corpo)}:fontcolor=${cor}:box=1:boxcolor=black@0.6:boxborderw=2`;
  if (pedido.grade) {
    const passo = passoDaGrade(r);
    const linhas = (inicio: number, tamanho: number) => {
      const valores: number[] = [];
      for (let k = Math.ceil((inicio + 1e-9) / passo); k * passo < inicio + tamanho - 1e-9; k += 1) valores.push(Math.round(k * passo * 1000) / 1000);
      return valores;
    };
    for (const gx of linhas(r.x, r.largura)) {
      const px = ((gx - r.x) / r.largura) * saida.largura;
      filtros.push(`drawbox=x=${String(Math.round(px) - 1)}:y=0:w=3:h=ih:color=black@0.35:t=fill`, `drawbox=x=${String(Math.round(px))}:y=0:w=1:h=ih:color=white@0.75:t=fill`, texto(rotuloDaCoordenada(gx, passo), px + 3, 3));
    }
    for (const gy of linhas(r.y, r.altura)) {
      const py = ((gy - r.y) / r.altura) * saida.altura;
      filtros.push(`drawbox=x=0:y=${String(Math.round(py) - 1)}:w=iw:h=3:color=black@0.35:t=fill`, `drawbox=x=0:y=${String(Math.round(py))}:w=iw:h=1:color=white@0.75:t=fill`, texto(rotuloDaCoordenada(gy, passo), 3, py + 3));
    }
  }
  for (const caixa of pedido.caixas) {
    const b = caixa.retangulo;
    const x = ((b.x - r.x) / r.largura) * saida.largura, y = ((b.y - r.y) / r.altura) * saida.altura;
    const w = (b.largura / r.largura) * saida.largura, h = (b.altura / r.altura) * saida.altura;
    const t = Math.max(2, Math.round(corpo / 5));
    filtros.push(`drawbox=x=${String(Math.round(x))}:y=${String(Math.round(y))}:w=${String(Math.max(2, Math.round(w)))}:h=${String(Math.max(2, Math.round(h)))}:color=yellow@0.95:t=${String(t)}`);
    filtros.push(texto(caixa.rotulo.replace(/[^\p{L}\p{N} #-]/gu, ''), Math.max(0, x) + t + 2, Math.max(0, y) + t + 2, 'yellow'));
  }
  return { filtro: filtros.join(','), saida };
}

function rodar(comando: string, argumentos: string[]): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(comando, argumentos, { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '', erro = '';
    filho.stdout.on('data', (b: Buffer) => { saida += b.toString(); });
    filho.stderr.on('data', (b: Buffer) => { erro = (erro + b.toString()).slice(-4000); });
    filho.on('error', rejeitar);
    filho.on('close', (codigo) => { if (codigo === 0) resolver(saida); else rejeitar(new Error(`${comando} saiu com ${String(codigo)}: ${erro}`)); });
  });
}

export async function dimensoesDaImagem(caminho: string): Promise<Dimensoes> {
  const saida = await rodar('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', caminho]);
  const [largura, altura] = saida.trim().split(',').map(Number);
  if (!largura || !altura) throw new Error('dimensoes_ilegiveis');
  return { largura, altura };
}

export const prepararComFfmpeg: PrepararImagem = async (origem, destino, pedido, dim) => {
  const { filtro } = filtroDaImagem(dim, pedido);
  await rodar('ffmpeg', ['-v', 'error', '-y', '-i', origem, '-vf', filtro, '-frames:v', '1', '-q:v', '3', destino]);
};

/** Quatro ladrilhos de 0,6 × 0,6 que se sobrepõem no centro: cada canto da obra visto de perto. */
export const LADRILHOS: { nome: string; recorte: RetanguloDaObra }[] = [
  { nome: 'ladrilho-sup-esq', recorte: { x: 0, y: 0, largura: 0.6, altura: 0.6 } },
  { nome: 'ladrilho-sup-dir', recorte: { x: 0.4, y: 0, largura: 0.6, altura: 0.6 } },
  { nome: 'ladrilho-inf-esq', recorte: { x: 0, y: 0.4, largura: 0.6, altura: 0.6 } },
  { nome: 'ladrilho-inf-dir', recorte: { x: 0.4, y: 0.4, largura: 0.6, altura: 0.6 } },
];

/** Recorte ampliado em volta de uma região: folga de 35% de cada lado (mínimo 0,04) e lado mínimo 0,12. */
export function recorteEmVolta(l: RetanguloDaObra): RetanguloDaObra {
  const fx = Math.max(0.04, l.largura * 0.35), fy = Math.max(0.04, l.altura * 0.35);
  let largura = Math.max(0.12, l.largura + 2 * fx), altura = Math.max(0.12, l.altura + 2 * fy);
  largura = Math.min(1, largura); altura = Math.min(1, altura);
  const x = Math.max(0, Math.min(1 - largura, l.x + l.largura / 2 - largura / 2));
  const y = Math.max(0, Math.min(1 - altura, l.y + l.altura / 2 - altura / 2));
  return { x, y, largura, altura };
}
