import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { dentroDaRaiz, pastaDaVersao, raizDeDados } from '../dados.js';
import { validarGeometria, type GeometriaV1 } from '@margem/contratos';

/** Confere tanto a forma lexical quanto links simbólicos, inclusive nos pais. */
export async function arquivoNosDados(caminho: string): Promise<string | null> {
  const raiz = raizDeDados();
  if (dentroDaRaiz(raiz, relative(raiz, caminho)) === null) return null;
  try {
    const [base, alvo] = await Promise.all([realpath(raiz), realpath(caminho)]);
    return dentroDaRaiz(base, relative(base, alvo)) !== null && (await stat(alvo)).isFile() ? alvo : null;
  } catch (erro) {
    if (erro instanceof Error && 'code' in erro && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(erro.code))) return null;
    throw erro;
  }
}

export function caminhoDaGeometria(documentoId: string, versaoId: string): string {
  return join(pastaDaVersao(documentoId, versaoId), 'geometria.json');
}

/** Os recortes derivados de uma geometria grande demais para o cache (I-06), ao lado dela. */
export function pastaDosRecortes(documentoId: string, versaoId: string): string {
  return join(pastaDaVersao(documentoId, versaoId), 'geometria-recortes');
}

export async function geometriaDisponivel(documentoId: string, versaoId: string): Promise<boolean> {
  return await arquivoNosDados(caminhoDaGeometria(documentoId, versaoId)) !== null;
}

/** Páginas por arquivo de recorte: um pedido de 60 páginas lê no máximo três recortes. */
export const PAGINAS_POR_RECORTE = 30;

/** O índice dos recortes; `tamanho` e `modificado` amarram os recortes ao `geometria.json` de onde vieram. */
interface IndiceDosRecortes { versao: 1; versao_id: string; tamanho: number; modificado: number; total_de_paginas: number; recortes: number[] }
type Cabecalho = Pick<GeometriaV1, 'versao' | 'versao_id' | 'fonte' | 'motor'>;
/** Um recorte tem a mesma forma da geometria, só com parte das páginas. */
type Recorte = GeometriaV1;

function pesoDe(texto: string, geometria: Pick<GeometriaV1, 'paginas' | 'palavras'>): number {
  return texto.length * 2 + geometria.palavras.length * 256 + geometria.paginas.length * 128;
}

const recorteDaPagina = (numero: number) => Math.floor((numero - 1) / PAGINAS_POR_RECORTE);

/** Só as páginas pedidas (e as palavras delas), com o cabeçalho da geometria. */
function filtrar(geometria: Recorte, inicio: number, fim: number): Recorte {
  const paginas = geometria.paginas.filter((pagina) => pagina.numero >= inicio && pagina.numero <= fim);
  const numeros = new Set(paginas.map((pagina) => pagina.numero));
  return { versao: geometria.versao, versao_id: geometria.versao_id, fonte: geometria.fonte, motor: geometria.motor,
    paginas, palavras: geometria.palavras.filter((palavra) => numeros.has(palavra.pagina)) };
}

async function gravarAtomico(caminho: string, texto: string): Promise<void> {
  const temporario = `${caminho}.${String(process.pid)}.${String(Date.now())}.tmp`;
  await writeFile(temporario, texto);
  await rename(temporario, caminho);
}

/**
 * LRU por arquivo imutável. Peso conservador inclui strings UTF-16 e objetos.
 *
 * Uma geometria acima do teto não fica na memória (I-06). Para não reler e validar o arquivo inteiro a
 * cada faixa de páginas, a primeira leitura grava recortes de `PAGINAS_POR_RECORTE` páginas em
 * `geometria-recortes/` (derivados, refeitos se o original mudar) e os pedidos seguintes leem só os
 * recortes da faixa, que entram no mesmo LRU.
 */
export class CacheDeGeometria {
  private readonly entradas = new Map<string, { geometria: Recorte; peso: number }>();
  private peso = 0;
  private readonly emPreparo = new Map<string, Promise<unknown>>();
  /** Quantas vezes o `geometria.json` inteiro foi lido e validado (para os testes e a medição do I-06). */
  leiturasIntegrais = 0;
  constructor(
    private readonly teto = 64 * 1024 * 1024,
    /** Como os recortes vão ao disco (os testes simulam o disco cheio). */
    private readonly gravar: (caminho: string, texto: string) => Promise<void> = gravarAtomico,
  ) {}

  private lembrar(chave: string, geometria: Recorte, peso: number): void {
    if (peso > this.teto) return;
    while (this.peso + peso > this.teto) {
      const primeiro = this.entradas.entries().next().value;
      if (!primeiro) break;
      this.entradas.delete(primeiro[0]);
      this.peso -= primeiro[1].peso;
    }
    this.entradas.set(chave, { geometria, peso });
    this.peso += peso;
  }

  private lembrado(chave: string): Recorte | null {
    const anterior = this.entradas.get(chave);
    if (!anterior) return null;
    this.entradas.delete(chave);
    this.entradas.set(chave, anterior);
    return anterior.geometria;
  }

  /** Lê e valida o arquivo inteiro; guarda no LRU quando cabe. */
  private async lerInteira(caminho: string, versaoId: string): Promise<{ geometria: GeometriaV1; peso: number }> {
    const texto = await readFile(caminho, 'utf8');
    this.leiturasIntegrais += 1;
    const geometria: unknown = JSON.parse(texto);
    if (!validarGeometria(geometria) || geometria.versao_id !== versaoId) throw new Error('Geometria inválida ou de outra versão.');
    const peso = pesoDe(texto, geometria);
    this.lembrar(caminho, geometria, peso);
    return { geometria, peso };
  }

  async ler(documentoId: string, versaoId: string): Promise<GeometriaV1 | null> {
    const caminho = await arquivoNosDados(caminhoDaGeometria(documentoId, versaoId));
    if (caminho === null) return null;
    return this.lembrado(caminho) ?? (await this.lerInteira(caminho, versaoId)).geometria;
  }

  /** O índice dos recortes, se existir e ainda corresponder ao `geometria.json` atual. */
  private async indice(documentoId: string, versaoId: string, caminho: string): Promise<IndiceDosRecortes | null> {
    const arquivo = await arquivoNosDados(join(pastaDosRecortes(documentoId, versaoId), 'indice.json'));
    if (arquivo === null) return null;
    try {
      const indice = JSON.parse(await readFile(arquivo, 'utf8')) as IndiceDosRecortes;
      const original = await stat(caminho);
      return indice.versao === 1 && indice.versao_id === versaoId && indice.tamanho === original.size && indice.modificado === original.mtimeMs ? indice : null;
    } catch { return null; }
  }

  /** Grava um recorte por bloco de páginas e, por último, o índice que os torna válidos. */
  private async derivar(documentoId: string, versaoId: string, caminho: string, geometria: GeometriaV1): Promise<IndiceDosRecortes> {
    const original = await stat(caminho);
    const pasta = pastaDosRecortes(documentoId, versaoId);
    await rm(pasta, { recursive: true, force: true });
    await mkdir(pasta, { recursive: true });
    const porRecorte = new Map<number, Recorte>();
    const cabecalho: Cabecalho = { versao: geometria.versao, versao_id: geometria.versao_id, fonte: geometria.fonte, motor: geometria.motor };
    const recorte = (numero: number) => {
      const chave = recorteDaPagina(numero);
      let alvo = porRecorte.get(chave);
      if (!alvo) { alvo = { ...cabecalho, paginas: [], palavras: [] }; porRecorte.set(chave, alvo); }
      return alvo;
    };
    for (const pagina of geometria.paginas) recorte(pagina.numero).paginas.push(pagina);
    for (const palavra of geometria.palavras) recorte(palavra.pagina).palavras.push(palavra);
    for (const [chave, conteudo] of porRecorte) await this.gravar(join(pasta, `${String(chave)}.json`), JSON.stringify(conteudo));
    const indice: IndiceDosRecortes = { versao: 1, versao_id: versaoId, tamanho: original.size, modificado: original.mtimeMs,
      total_de_paginas: geometria.paginas.length, recortes: [...porRecorte.keys()].sort((a, b) => a - b) };
    await this.gravar(join(pasta, 'indice.json'), JSON.stringify(indice));
    return indice;
  }

  /**
   * Prepara a geometria para pedidos por faixa: ou ela inteira no LRU, ou o índice dos recortes.
   * Pedidos simultâneos da mesma versão esperam a mesma leitura.
   */
  private async preparar(documentoId: string, versaoId: string, caminho: string): Promise<{ inteira: Recorte } | { indice: IndiceDosRecortes }> {
    const inteira = this.lembrado(caminho);
    if (inteira) return { inteira };
    const indice = await this.indice(documentoId, versaoId, caminho);
    if (indice) return { indice };
    const pendente = this.emPreparo.get(caminho) as Promise<{ inteira: Recorte } | { indice: IndiceDosRecortes }> | undefined;
    if (pendente) return pendente;
    const tarefa = (async () => {
      const { geometria, peso } = await this.lerInteira(caminho, versaoId);
      if (peso <= this.teto) return { inteira: geometria };
      try {
        return { indice: await this.derivar(documentoId, versaoId, caminho, geometria) };
      } catch {
        // R3-3: os recortes são cache. Sem espaço (ou sem permissão) para gravá-los, serve a geometria já lida
        // e validada, e tira os recortes pela metade; o próximo pedido tenta de novo.
        await rm(pastaDosRecortes(documentoId, versaoId), { recursive: true, force: true }).catch(() => undefined);
        return { inteira: geometria };
      }
    })().finally(() => this.emPreparo.delete(caminho));
    this.emPreparo.set(caminho, tarefa);
    return tarefa;
  }

  private async lerRecorte(documentoId: string, versaoId: string, chave: number): Promise<Recorte> {
    const arquivo = await arquivoNosDados(join(pastaDosRecortes(documentoId, versaoId), `${String(chave)}.json`));
    if (arquivo === null) throw new Error('Recorte da geometria ausente.');
    const lembrado = this.lembrado(arquivo);
    if (lembrado) return lembrado;
    const texto = await readFile(arquivo, 'utf8');
    const recorte = JSON.parse(texto) as Recorte;
    if (recorte.versao_id !== versaoId || !Array.isArray(recorte.paginas) || !Array.isArray(recorte.palavras)) throw new Error('Recorte da geometria inválido.');
    this.lembrar(arquivo, recorte, pesoDe(texto, recorte));
    return recorte;
  }

  /** As páginas `inicio..fim` (e as palavras delas), sem reler o arquivo inteiro quando ele passa do teto. */
  async paginas(documentoId: string, versaoId: string, inicio: number, fim: number): Promise<GeometriaV1 | null> {
    const caminho = await arquivoNosDados(caminhoDaGeometria(documentoId, versaoId));
    if (caminho === null) return null;
    const preparo = await this.preparar(documentoId, versaoId, caminho);
    if ('inteira' in preparo) return filtrar(preparo.inteira, inicio, fim);
    const chaves = preparo.indice.recortes.filter((chave) => chave >= recorteDaPagina(inicio) && chave <= recorteDaPagina(fim));
    // Faixa sem nenhuma página: o cabeçalho vem do primeiro recorte, como viria do arquivo inteiro.
    const lidos = await Promise.all((chaves.length > 0 ? chaves : preparo.indice.recortes.slice(0, 1)).map((chave) => this.lerRecorte(documentoId, versaoId, chave)));
    const base: Recorte = lidos[0] ?? { versao: 1, versao_id: versaoId, fonte: 'pdf_texto', motor: '', paginas: [], palavras: [] };
    return filtrar({ ...base, paginas: lidos.flatMap((r) => r.paginas), palavras: lidos.flatMap((r) => r.palavras) }, inicio, fim);
  }

  /** Quantas páginas a geometria tem, sem manter nem reler o arquivo inteiro quando ele é grande. */
  async totalDePaginas(documentoId: string, versaoId: string): Promise<number | null> {
    const caminho = await arquivoNosDados(caminhoDaGeometria(documentoId, versaoId));
    if (caminho === null) return null;
    const preparo = await this.preparar(documentoId, versaoId, caminho);
    return 'inteira' in preparo ? preparo.inteira.paginas.length : preparo.indice.total_de_paginas;
  }
}
