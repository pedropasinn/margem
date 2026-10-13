import { readFile, realpath, stat } from 'node:fs/promises';
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

export async function geometriaDisponivel(documentoId: string, versaoId: string): Promise<boolean> {
  return await arquivoNosDados(caminhoDaGeometria(documentoId, versaoId)) !== null;
}

/** LRU por arquivo imutável. Peso conservador inclui strings UTF-16 e objetos. */
export class CacheDeGeometria {
  private readonly entradas = new Map<string, { geometria: GeometriaV1; peso: number }>();
  private peso = 0;
  constructor(private readonly teto = 64 * 1024 * 1024) {}

  async ler(documentoId: string, versaoId: string): Promise<GeometriaV1 | null> {
    const caminho = await arquivoNosDados(caminhoDaGeometria(documentoId, versaoId));
    if (caminho === null) return null;
    const anterior = this.entradas.get(caminho);
    if (anterior) {
      this.entradas.delete(caminho);
      this.entradas.set(caminho, anterior);
      return anterior.geometria;
    }
    const texto = await readFile(caminho, 'utf8');
    const geometria: unknown = JSON.parse(texto);
    if (!validarGeometria(geometria) || geometria.versao_id !== versaoId) throw new Error('Geometria inválida ou de outra versão.');
    const peso = texto.length * 2 + geometria.palavras.length * 256 + geometria.paginas.length * 128;
    if (peso <= this.teto) {
      while (this.peso + peso > this.teto) {
        const primeiro = this.entradas.entries().next().value;
        if (!primeiro) break;
        this.entradas.delete(primeiro[0]);
        this.peso -= primeiro[1].peso;
      }
      this.entradas.set(caminho, { geometria, peso });
      this.peso += peso;
    }
    return geometria;
  }
}
