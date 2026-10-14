/**
 * Banco de biblioteca em pasta sincronizada (V-W8, auditoria B-10): o cluster sai de
 * `<biblioteca>/.margem/banco` para a pasta local do app, uma vez, com cópia conferida.
 *
 * Ordem segura: o Postgres antigo é parado (se um órfão ainda roda com aquela pasta), a pasta é copiada
 * para um temporário ao lado do destino, a cópia é conferida arquivo a arquivo (nome e tamanho), o
 * temporário vira o destino por `rename` e só então a pasta antiga ganha o nome `banco.migrado-<data>`
 * (nunca é apagada aqui: um LEIA-ME explica que dá para apagá-la depois de conferir a biblioteca). Uma
 * queda no meio deixa, no pior caso, um temporário órfão; o banco antigo continua inteiro e a próxima
 * abertura tenta de novo.
 */
import { randomBytes } from 'node:crypto';
import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { PastasDaBiblioteca } from './configuracao.js';
import { renomearComRetentativa } from './disco.js';
import { ErroDoBanco, tratarLockVelho, versaoDoCluster, type Executar, type ProcessoEhPostgres } from './postgres.js';
import type { BinariosDoPostgres } from './recursos.js';

export type DesfechoDaMigracao =
  /** Biblioteca fora de pasta sincronizada, ou sem banco antigo: nada a mover. */
  | 'nada'
  /** O banco foi copiado para a pasta local; o antigo ficou como `banco.migrado-<data>`. */
  | 'migrado'
  /** Já há banco local (de uma migração anterior); o antigo, se ainda existe, fica intocado. */
  | 'local_ja_existe';

export interface ResultadoDaMigracao {
  desfecho: DesfechoDaMigracao;
  /** Onde ficou a pasta antiga renomeada, quando houve migração e o rename deu certo. */
  antigoRenomeado?: string;
}

/** Arquivos do cluster que não viajam (estado de um servidor no ar). */
const FORA_DA_COPIA = new Set(['postmaster.pid']);

async function inventario(raiz: string): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const visitar = async (pasta: string): Promise<void> => {
    for (const item of await readdir(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, item.name);
      if (item.isDirectory()) await visitar(caminho);
      else if (!FORA_DA_COPIA.has(item.name)) mapa.set(relative(raiz, caminho), (await stat(caminho)).size);
    }
  };
  await visitar(raiz);
  return mapa;
}

/** `AAAAMMDD-HHMMSS` (UTC), para o nome da pasta antiga. */
function carimbo(agora: Date): string {
  return agora.toISOString().replace(/[-:]/gu, '').replace('T', '-').slice(0, 15);
}

const LEIA_ME = [
  'Esta pasta é o banco antigo desta biblioteca do Margem.',
  '',
  'A biblioteca está numa pasta sincronizada (OneDrive, Dropbox, Google Drive ou iCloud), e um banco de dados',
  'dentro de uma pasta assim pode se corromper. O Margem copiou o banco para uma pasta local deste computador',
  'e passou a usar a cópia. Os livros continuam aqui.',
  '',
  'Depois de abrir a biblioteca e conferir que está tudo lá, você pode apagar esta pasta.',
  '',
].join('\n');

export async function migrarBancoParaLocal(
  binarios: BinariosDoPostgres,
  pastas: PastasDaBiblioteca,
  opcoes: { executar?: Executar; ehPostgres?: ProcessoEhPostgres; agora?: Date; plataforma?: NodeJS.Platform } = {},
): Promise<ResultadoDaMigracao> {
  const antigo = pastas.bancoNaBiblioteca;
  const destino = pastas.banco;
  if (pastas.sincronizada === null || destino === antigo) return { desfecho: 'nada' };
  if (await versaoDoCluster(destino) !== null) return { desfecho: 'local_ja_existe' };
  if (await versaoDoCluster(antigo) === null) return { desfecho: 'nada' };

  // Um Postgres órfão (queda do app) ainda escrevendo na pasta antiga estragaria a cópia.
  await tratarLockVelho(binarios, antigo, {
    ...(opcoes.executar === undefined ? {} : { executar: opcoes.executar }),
    ...(opcoes.ehPostgres === undefined ? {} : { ehPostgres: opcoes.ehPostgres }),
  });
  await mkdir(dirname(destino), { recursive: true });
  const temporario = `${destino}.migrando-${randomBytes(4).toString('hex')}`;
  try {
    await cp(antigo, temporario, {
      recursive: true, errorOnExist: true, force: false, preserveTimestamps: true,
      filter: (origem) => !FORA_DA_COPIA.has(relative(antigo, origem)),
    });
    const [deLa, daqui] = await Promise.all([inventario(antigo), inventario(temporario)]);
    const faltando = [...deLa].filter(([nome, tamanho]) => daqui.get(nome) !== tamanho).map(([nome]) => nome);
    if (faltando.length > 0 || deLa.size !== daqui.size) {
      throw new ErroDoBanco('migracao', 'A cópia do banco para a pasta local saiu diferente do original. Nada foi mudado na biblioteca.',
        `diferentes: ${faltando.slice(0, 10).join(', ')} (${String(deLa.size)} × ${String(daqui.size)} arquivos)`);
    }
    // O Postgres exige a pasta de dados só do dono (0700) fora do Windows.
    if ((opcoes.plataforma ?? process.platform) !== 'win32') await chmod(temporario, 0o700);
    await renomearComRetentativa(temporario, destino);
  } catch (erro) {
    await rm(temporario, { recursive: true, force: true });
    if (erro instanceof ErroDoBanco) throw erro;
    throw new ErroDoBanco('migracao', 'Não foi possível copiar o banco da biblioteca para a pasta local. Nada foi mudado na biblioteca.', (erro as Error).message);
  }
  const renomeado = join(pastas.interna, `banco.migrado-${carimbo(opcoes.agora ?? new Date())}`);
  try {
    await renomearComRetentativa(antigo, renomeado);
    await writeFile(join(renomeado, 'LEIA-ME.txt'), LEIA_ME);
    return { desfecho: 'migrado', antigoRenomeado: renomeado };
  } catch {
    // O sincronizador segurou a pasta: o banco local já vale; a antiga fica com o nome de antes.
    return { desfecho: 'migrado' };
  }
}

/** Aviso para a tela de estado (`MARGEM_AVISOS`), em frase curta. */
export function avisoDaPastaSincronizada(pastas: PastasDaBiblioteca): string | null {
  if (pastas.sincronizada === null || pastas.banco === pastas.bancoNaBiblioteca) return null;
  return `A biblioteca está numa pasta do ${pastas.sincronizada}. Para não corromper, o banco (marcas, notas e leituras) `
    + `fica neste computador, em ${pastas.banco}, e não sincroniza; os livros continuam na pasta.`;
}
