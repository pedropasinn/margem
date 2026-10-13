/**
 * Voz da leitura comentada (J92). A leitura vira roteiros de fala da fábrica auto-colab (receita
 * `margem-leitura-omnivoice-seed123`, a voz escolhida em 30/09: `docs/audio/omnivoice-seed123.json`,
 * instalada a partir de `colab/benchmark/receitas/`): **uma cena por frase lida e uma por
 * pausa**, em aulas de até `PALAVRAS_POR_AULA` palavras (um capítulo inteiro passa do limite de 60 min
 * de um job; as aulas se dividem em jobs). Na volta, cada aula é conferida (texto de cada cena, hash e
 * duração do MP3) e o capítulo é **montado num MP3 único**: cada cena é recortada pelos tempos do
 * manifesto e recolocada com as pausas da leitura — frase, parágrafo e, em volta do comentário, um
 * silêncio maior e, opcional, um toque curto e baixo (`sinal`) e o comentário levemente mais lento e
 * mais grave (`contraste`). Os tempos de cada fala saem da própria montagem (contagem de amostras).
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { falasDaLeitura, type LeituraComentadaV1, type NarracaoDaLeituraV1 } from '@margem/contratos';

/** Seed 123 por geração e pesos fixados; `MARGEM_RECEITA_LEITURA=margem-poesia-omnivoice` volta à receita anterior. */
export const RECEITA_DA_LEITURA = 'margem-leitura-omnivoice-seed123';
/** ~2 500 palavras ≈ 17 min de voz ≈ 9 min de síntese em T4 (RTF ≈ 0,54 no J91). */
export const PALAVRAS_POR_AULA = 2500;
/** Aulas por job: três aulas ≈ 50 min de voz ≈ 30 min de sessão, dentro do limite de 60 min da fábrica. */
export const AULAS_POR_JOB = 3;
/** Numeração de cena da fábrica: três dígitos. */
const MAXIMO_DE_CENAS = 999;

const normalizar = (texto: string): string => texto.replace(/\s+/gu, ' ').trim();
const linhaSegura = (texto: string): string => normalizar(texto).replace(/-{3,}/gu, '—').replace(/"/gu, '”');

export interface CenaDaAula { cena: string; fala_id: string; falado: string }
export interface AulaDaLeitura { id: string; titulo: string; cenas: CenaDaAula[] }

/** Id da aula na fábrica: `comentada-<leitura>-a01`. */
export const idDaAula = (leituraId: string, n: number): string => `comentada-${leituraId.toLowerCase()}-a${String(n).padStart(2, '0')}`;

/**
 * As aulas da leitura: falas na ordem, cortadas só entre um trecho e o seguinte (a pausa fica junto da
 * frase que ela comenta), com no máximo `palavrasPorAula` palavras e 999 cenas.
 */
export function aulasDaLeitura(leitura: Pick<LeituraComentadaV1, 'id' | 'capitulo' | 'trechos' | 'pausas'>, palavrasPorAula = PALAVRAS_POR_AULA): AulaDaLeitura[] {
  const falas = falasDaLeitura(leitura);
  const aulas: AulaDaLeitura[] = [];
  let atual: { fala_id: string; falado: string }[] = [];
  let palavras = 0;
  const fechar = (): void => {
    if (atual.length === 0) return;
    const n = aulas.length + 1;
    aulas.push({
      id: idDaAula(leitura.id, n), titulo: `Leitura comentada · ${leitura.capitulo.titulo} · parte ${String(n)}`,
      cenas: atual.map((fala, i) => ({ cena: `c${String(i + 1).padStart(3, '0')}`, fala_id: fala.fala_id, falado: fala.falado })),
    });
    atual = [];
    palavras = 0;
  };
  for (const fala of falas) {
    const tamanho = fala.falado.split(/\s+/u).length;
    const cabe = palavras + tamanho <= palavrasPorAula && atual.length + 2 <= MAXIMO_DE_CENAS;
    if (fala.tipo === 'trecho' && !cabe) fechar();
    atual.push({ fala_id: fala.id, falado: normalizar(fala.falado) });
    palavras += tamanho;
  }
  fechar();
  return aulas;
}

/** O roteiro de fala (Markdown da fábrica) de uma aula. */
export function roteiroDeFalaDaAula(aula: AulaDaLeitura): string {
  const linhas = ['---', `titulo: "${linhaSegura(aula.titulo)}"`, `id: ${aula.id}`, '---', ''];
  for (const cena of aula.cenas) {
    if (cena.falado === '' || /<!--|-->/u.test(cena.falado)) throw new Error(`Fala ${cena.fala_id} vazia ou com marcador de cena.`);
    linhas.push(`<!-- cena: ${cena.cena} -->`, cena.falado, '');
  }
  return linhas.join('\n');
}

export interface CenaDoManifesto { cena: string; inicio_s: number; fim_s: number; narracao: string }
export interface ManifestoDaAula { id: string; total_s: number; voz_sha256: string; cenas: CenaDoManifesto[] }

function objeto(valor: unknown, onde: string): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error(`${onde}: objeto esperado.`);
  return valor as Record<string, unknown>;
}

export function lerManifestoDaAula(bruto: unknown): ManifestoDaAula {
  const m = objeto(bruto, 'manifesto da aula');
  if (typeof m.id !== 'string' || typeof m.total_s !== 'number' || typeof m.voz_sha256 !== 'string' || !Array.isArray(m.cenas)) throw new Error('Manifesto da aula incompleto.');
  const cenas = m.cenas.map((bruta) => {
    const c = objeto(bruta, 'cena');
    if (typeof c.cena !== 'string' || typeof c.inicio_s !== 'number' || typeof c.fim_s !== 'number' || typeof c.narracao !== 'string') throw new Error('Cena incompleta no manifesto.');
    return { cena: c.cena, inicio_s: c.inicio_s, fim_s: c.fim_s, narracao: c.narracao };
  });
  return { id: m.id, total_s: m.total_s, voz_sha256: m.voz_sha256, cenas };
}

/** Confere a aula contra o que se pediu: mesmas cenas, mesmo texto, na ordem, tempos dentro do MP3. */
export function conferirAula(aula: AulaDaLeitura, manifesto: ManifestoDaAula, duracaoMedida: number, taxa: number): CenaDoManifesto[] {
  if (manifesto.id !== aula.id) throw new Error(`A aula ${manifesto.id} não é a ${aula.id}.`);
  if (manifesto.cenas.length !== aula.cenas.length) throw new Error(`A aula ${aula.id} tem ${String(manifesto.cenas.length)} cenas; eram ${String(aula.cenas.length)}.`);
  // MP3 tem quadros de 1152 amostras: folga de dois quadros e do arredondamento do manifesto (como J64/J91).
  const tolerancia = 2 * 1152 / taxa + 0.01;
  if (Math.abs(duracaoMedida - manifesto.total_s) > tolerancia) throw new Error(`A duração do MP3 de ${aula.id} não corresponde ao manifesto.`);
  return aula.cenas.map((esperada, i) => {
    const cena = manifesto.cenas[i]!;
    if (cena.cena !== esperada.cena) throw new Error(`Cena fora de ordem em ${aula.id}: ${cena.cena}.`);
    if (normalizar(cena.narracao) !== normalizar(esperada.falado)) throw new Error(`A cena ${cena.cena} de ${aula.id} não diz a fala ${esperada.fala_id}.`);
    if (!(cena.fim_s > cena.inicio_s) || cena.fim_s > duracaoMedida + tolerancia) throw new Error(`Tempos inválidos na cena ${cena.cena} de ${aula.id}.`);
    return { ...cena, fim_s: Math.min(cena.fim_s, duracaoMedida) };
  });
}

// ---------------------------------------------------------------- montagem do MP3

export interface OpcoesDaTransicao {
  /** Silêncio entre frases do mesmo bloco (o `gap_cena_s` da receita). */
  entre_frases_s: number;
  /** Silêncio quando a leitura passa de um bloco (parágrafo) a outro. */
  entre_blocos_s: number;
  /** Silêncio antes do comentário (com o toque dentro dele, quando há toque). */
  silencio_antes_s: number;
  silencio_depois_s: number;
  /** Toque curto e baixo no começo do silêncio antes do comentário. */
  sinal: boolean;
  /** Comentário ~3 % mais grave e ~5 % mais lento (ffmpeg), para contrastar com a leitura. */
  contraste: boolean;
}
export const TRANSICAO_PADRAO: OpcoesDaTransicao = { entre_frases_s: 0.35, entre_blocos_s: 0.7, silencio_antes_s: 0.9, silencio_depois_s: 0.7, sinal: true, contraste: false };

/** Uma cena já conferida, com o MP3 da aula de onde ela sai. */
export interface CenaParaMontar { fala_id: string; tipo: 'trecho' | 'pausa'; bloco_id: string | null; mp3: string; inicio_s: number; fim_s: number }

function rodar(comando: string, argumentos: readonly string[], entrada?: Buffer): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(comando, argumentos, { stdio: ['pipe', 'pipe', 'pipe'] });
    const saida: Buffer[] = [];
    const erro: Buffer[] = [];
    filho.stdout.on('data', (d: Buffer) => saida.push(d));
    filho.stderr.on('data', (d: Buffer) => erro.push(d));
    filho.once('error', rejeitar);
    filho.once('close', (codigo) => {
      if (codigo === 0) resolver(Buffer.concat(saida));
      else rejeitar(new Error(`${comando} saiu com ${String(codigo)}: ${Buffer.concat(erro).toString('utf8').slice(-600)}`));
    });
    filho.stdin.end(entrada ?? Buffer.alloc(0));
  });
}

/** PCM s16le mono na taxa pedida. */
async function decodificar(mp3: string, taxa: number): Promise<Buffer> {
  return rodar('ffmpeg', ['-v', 'error', '-i', mp3, '-f', 's16le', '-ac', '1', '-ar', String(taxa), '-']);
}

function silencio(segundos: number, taxa: number): Buffer {
  return Buffer.alloc(Math.round(segundos * taxa) * 2);
}

/** O toque: duas notas curtas e baixas (uma quinta), com ataque e queda suaves. */
export function sinal(taxa: number): Buffer {
  const notas = [{ f: 659.25, d: 0.11 }, { f: 987.77, d: 0.16 }];
  const partes = notas.map(({ f, d }) => {
    const n = Math.round(d * taxa);
    const buffer = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i += 1) {
      const t = i / taxa;
      const envelope = Math.min(1, t / 0.008) * Math.exp(-t * 18);
      buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * t) * envelope * 0.07 * 32767), i * 2);
    }
    return buffer;
  });
  return Buffer.concat([partes[0]!, silencio(0.03, taxa), partes[1]!]);
}

async function contrastar(pcm: Buffer, taxa: number): Promise<Buffer> {
  return rodar('ffmpeg', ['-v', 'error', '-f', 's16le', '-ac', '1', '-ar', String(taxa), '-i', '-',
    '-af', `asetrate=${String(Math.round(taxa * 0.97))},aresample=${String(taxa)},atempo=0.98`, '-f', 's16le', '-ac', '1', '-ar', String(taxa), '-'], pcm);
}

/**
 * Monta o MP3 do capítulo e devolve os tempos de cada fala, contados em amostras. As cenas vêm na
 * ordem da leitura; cada uma é recortada do MP3 da sua aula pelos tempos do manifesto.
 */
export async function montarMp3(cenas: readonly CenaParaMontar[], destino: string, opcoes: OpcoesDaTransicao = TRANSICAO_PADRAO, taxa = 24_000):
  Promise<{ falas: NarracaoDaLeituraV1['falas']; duracao_s: number }> {
  const aulas = new Map<string, Buffer>();
  for (const mp3 of new Set(cenas.map((c) => c.mp3))) aulas.set(mp3, await decodificar(mp3, taxa));
  const pedacos: Buffer[] = [];
  const falas: NarracaoDaLeituraV1['falas'] = [];
  let amostras = 0;
  const por = (buffer: Buffer): void => { pedacos.push(buffer); amostras += buffer.length / 2; };
  for (const [i, cena] of cenas.entries()) {
    const anterior = cenas[i - 1];
    if (anterior) {
      if (cena.tipo === 'pausa') {
        if (opcoes.sinal) { const toque = sinal(taxa); por(silencio(0.15, taxa)); por(toque); por(silencio(Math.max(0.1, opcoes.silencio_antes_s - 0.15 - toque.length / 2 / taxa), taxa)); }
        else por(silencio(opcoes.silencio_antes_s, taxa));
      } else if (anterior.tipo === 'pausa') por(silencio(opcoes.silencio_depois_s, taxa));
      else por(silencio(anterior.bloco_id === cena.bloco_id ? opcoes.entre_frases_s : opcoes.entre_blocos_s, taxa));
    }
    const pcm = aulas.get(cena.mp3)!;
    const de = Math.max(0, Math.round(cena.inicio_s * taxa)) * 2;
    const ate = Math.min(pcm.length, Math.round(cena.fim_s * taxa) * 2);
    let recorte = pcm.subarray(de, ate);
    if (cena.tipo === 'pausa' && opcoes.contraste) recorte = await contrastar(recorte, taxa);
    const inicio = amostras / taxa;
    por(recorte);
    falas.push({ fala_id: cena.fala_id, inicio_s: Math.round(inicio * 1000) / 1000, fim_s: Math.round((amostras / taxa) * 1000) / 1000 });
  }
  por(silencio(0.4, taxa));
  const pcm = Buffer.concat(pedacos);
  await rodar('ffmpeg', ['-v', 'error', '-y', '-f', 's16le', '-ac', '1', '-ar', String(taxa), '-i', '-', '-c:a', 'libmp3lame', '-b:a', '96k', destino], pcm);
  return { falas, duracao_s: amostras / taxa };
}

/** Onde a fábrica deixa a aula: `<base>/audio/<aula>/{aula.mp3,manifest.json}`. */
export const pastaDaAula = (base: string, aula: string): string => join(base, 'audio', aula);

// ---------------------------------------------------------------- palavras

/** Palavra do alinhamento forçado sobre o MP3 montado (`aula.words.jsonl` do J71). */
export interface PalavraAlinhada { palavra: string; inicio_s: number; fim_s: number }

/**
 * Os segmentos para o alinhador: um por frase lida, com o texto falado e o intervalo dela no MP3. Os
 * comentários não entram (o texto do livro é o que recebe karaokê).
 */
export function segmentosParaAlinhar(leitura: Pick<LeituraComentadaV1, 'trechos'>, falas: NarracaoDaLeituraV1['falas']): { start: number; end: number; text: string }[] {
  const tempos = new Map(falas.map((f) => [f.fala_id, f]));
  return leitura.trechos.flatMap((t) => {
    const tempo = tempos.get(t.id);
    return tempo ? [{ start: tempo.inicio_s, end: tempo.fim_s, text: t.falado }] : [];
  });
}

/**
 * Leva as palavras alinhadas (que dizem o texto falado) ao texto do livro, frase a frase, por
 * `alinharPalavras` (J71): o que a normalização de pronúncia trocou fica sem par e sem tempo.
 */
export function palavrasDosTrechos(
  leitura: Pick<LeituraComentadaV1, 'trechos'>, falas: NarracaoDaLeituraV1['falas'], alinhadas: readonly PalavraAlinhada[],
  alinhar: (blocos: { id: string; texto: string }[], palavras: { texto: string; inicio_s: number; fim_s: number }[]) => { palavras: { bloco_id: string; inicio_utf16: number; fim_utf16: number; inicio_s: number; fim_s: number }[] },
): NarracaoDaLeituraV1['palavras'] {
  const tempos = new Map(falas.map((f) => [f.fala_id, f]));
  const ordenadas = [...alinhadas].sort((a, b) => a.inicio_s - b.inicio_s);
  const resultado: NarracaoDaLeituraV1['palavras'] = [];
  let cursor = 0;
  for (const trecho of leitura.trechos) {
    const tempo = tempos.get(trecho.id);
    if (!tempo) continue;
    while (cursor < ordenadas.length && ordenadas[cursor]!.inicio_s < tempo.inicio_s - 0.05) cursor += 1;
    const daFrase: { texto: string; inicio_s: number; fim_s: number }[] = [];
    let i = cursor;
    while (i < ordenadas.length && ordenadas[i]!.inicio_s <= tempo.fim_s + 0.05) { const p = ordenadas[i]!; daFrase.push({ texto: p.palavra, inicio_s: p.inicio_s, fim_s: p.fim_s }); i += 1; }
    cursor = i;
    if (daFrase.length === 0) continue;
    const { palavras } = alinhar([{ id: trecho.bloco_id, texto: trecho.texto }], daFrase);
    for (const p of palavras) {
      const inicio = Math.max(tempo.inicio_s, p.inicio_s);
      const fim = Math.min(tempo.fim_s, Math.max(inicio, p.fim_s));
      const anterior = resultado.at(-1);
      if (anterior && inicio < anterior.inicio_s) continue;
      resultado.push({ bloco_id: trecho.bloco_id, inicio_utf16: trecho.inicio_utf16 + p.inicio_utf16, fim_utf16: trecho.inicio_utf16 + p.fim_utf16, inicio_s: Math.round(inicio * 1000) / 1000, fim_s: Math.round(fim * 1000) / 1000 });
    }
  }
  return resultado;
}
