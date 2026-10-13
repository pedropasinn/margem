import { readFile } from 'node:fs/promises';
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1 } from '@margem/contratos';
import { validarAnaliseCurtaDaObra, validarModeloDaObra } from '../../../contratos/src/validadores.js';
import { conferirAnaliseCurta, conferirModeloDaObra } from '../../../core/src/arte.js';
export interface ObraDoCatalogo { modelo: ModeloDaObraV1; curta: AnaliseCurtaDaObraV1 }
/** Catálogo curado e imutável do experimento. Sem escrita ou dependência do banco de livros. */
export async function lerCatalogoDeArte(): Promise<ObraDoCatalogo[]> {
  return Promise.all(['educacao', 'tolo'].map(async nome => {
    const ler = async (tipo: string): Promise<unknown> => JSON.parse(await readFile(new URL(`../../../fixtures/arte/${nome}.${tipo}.json`, import.meta.url), 'utf8'));
    const [modelo, curta] = await Promise.all([ler('modelo'), ler('curta')]);
    if (!validarModeloDaObra(modelo) || !validarAnaliseCurtaDaObra(curta)) throw new Error(`Contrato de arte inválido: ${nome}`);
    const erros = [...conferirModeloDaObra(modelo), ...conferirAnaliseCurta(curta, modelo)];
    if (erros.length) throw new Error(`Obra inválida ${nome}: ${erros.join(', ')}`);
    return { modelo, curta };
  }));
}
