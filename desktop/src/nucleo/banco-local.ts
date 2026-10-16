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
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, readdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import type { PastasDaBiblioteca } from './configuracao.js';
import { renomearComRetentativa } from './disco.js';
import { ErroDoBanco, tratarLockVelho, versaoDoCluster, type Executar, type IdentificarProcesso } from './postgres.js';
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
  /** Restauração de uma cópia de segurança: onde ficou o banco local que havia antes. */
  localAnterior?: string;
}

/**
 * R2-2: registro, dentro do banco local, de que a restauração de uma marca já foi feita (o hash da marca).
 * É gravado no temporário antes do `rename` que põe o banco no lugar: a restauração fica concluída no
 * mesmo passo atômico. Se a marca não puder sair da pasta sincronizada, a abertura seguinte a reconhece e
 * não restaura de novo por cima das notas feitas depois.
 */
export const RESTAURACAO_CONCLUIDA = 'margem-restauracao-concluida.json';

/** Arquivos do cluster que não viajam (estado de um servidor no ar; o registro da restauração é deste computador). */
export const FORA_DA_COPIA = new Set(['postmaster.pid', RESTAURACAO_CONCLUIDA]);

/**
 * Marca que a "cópia de segurança" (U-03) deixa dentro do `banco` copiado. Restaurada em
 * `<biblioteca>/.margem/banco`, ela ganha do banco local que o computador já tinha para a biblioteca
 * (que fica guardado ao lado, como `<id>.anterior-<data>`); depois da abertura, a marca sai.
 */
export const MARCA_DE_RESTAURACAO = 'margem-copia-de-seguranca.json';

/** Nome relativo → tamanho, de todos os arquivos do cluster (menos o `postmaster.pid`). */
export async function inventario(raiz: string): Promise<Map<string, number>> {
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
  opcoes: { executar?: Executar; identificar?: IdentificarProcesso; agora?: Date; plataforma?: NodeJS.Platform } = {},
): Promise<ResultadoDaMigracao> {
  const antigo = pastas.bancoNaBiblioteca;
  const destino = pastas.banco;
  if (pastas.sincronizada === null || destino === antigo) return { desfecho: 'nada' };
  const hashDaMarca = await hashDaMarcaDeRestauracao(antigo);
  const restauracao = hashDaMarca !== null && await versaoDoCluster(antigo) !== null;
  let localAnterior: string | undefined;
  if (await versaoDoCluster(destino) !== null) {
    if (!restauracao) return { desfecho: 'local_ja_existe' };
    if (await restauracaoJaConcluida(destino, hashDaMarca)) {
      // R2-2: esta marca já foi restaurada (o rename da pasta antiga falhou da outra vez); só tenta tirá-la.
      await consumirMarca(antigo, destino);
      return { desfecho: 'local_ja_existe' };
    }
    // Uma cópia de segurança posta em `.margem/banco` (U-03): ela vale; o banco local de antes fica guardado.
    localAnterior = `${destino}.anterior-${carimbo(opcoes.agora ?? new Date())}`;
    await renomearComRetentativa(destino, localAnterior);
  }
  if (await versaoDoCluster(antigo) === null) return { desfecho: 'nada' };

  // Um Postgres órfão (queda do app) ainda escrevendo na pasta antiga estragaria a cópia.
  await tratarLockVelho(binarios, antigo, {
    ...(opcoes.executar === undefined ? {} : { executar: opcoes.executar }),
    ...(opcoes.identificar === undefined ? {} : { identificar: opcoes.identificar }),
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
    if (hashDaMarca !== null) await writeFile(join(temporario, RESTAURACAO_CONCLUIDA), `${JSON.stringify({ marca: hashDaMarca })}\n`);
    await renomearComRetentativa(temporario, destino);
  } catch (erro) {
    await rm(temporario, { recursive: true, force: true });
    if (localAnterior !== undefined && !existsSync(destino)) await renomearComRetentativa(localAnterior, destino).catch(() => undefined);
    if (erro instanceof ErroDoBanco) throw erro;
    throw new ErroDoBanco('migracao', 'Não foi possível copiar o banco da biblioteca para a pasta local. Nada foi mudado na biblioteca.', (erro as Error).message);
  }
  // A marca sai da origem antes do rename (que o sincronizador pode segurar); sem ela, nada a repetir.
  if (hashDaMarca !== null) await consumirMarca(antigo, destino);
  const renomeado = join(pastas.interna, `banco.migrado-${carimbo(opcoes.agora ?? new Date())}`);
  try {
    await renomearComRetentativa(antigo, renomeado);
    await writeFile(join(renomeado, 'LEIA-ME.txt'), LEIA_ME);
    await rm(join(renomeado, MARCA_DE_RESTAURACAO), { force: true });
    await rm(join(destino, RESTAURACAO_CONCLUIDA), { force: true });
    return { desfecho: 'migrado', antigoRenomeado: renomeado, ...(localAnterior === undefined ? {} : { localAnterior }) };
  } catch {
    // O sincronizador segurou a pasta: o banco local já vale; a antiga fica com o nome de antes.
    return { desfecho: 'migrado', ...(localAnterior === undefined ? {} : { localAnterior }) };
  }
}

async function hashDaMarcaDeRestauracao(banco: string): Promise<string | null> {
  try {
    return createHash('sha256').update(await readFile(join(banco, MARCA_DE_RESTAURACAO))).digest('hex');
  } catch {
    return null;
  }
}

/**
 * R3-1: tira a marca da origem; saindo, o registro de restauração concluída também sai do banco local. Ele só
 * existe para a marca que ficou presa na pasta sincronizada: sem ela, restaurar a mesma cópia de novo é deliberado.
 */
async function consumirMarca(antigo: string, destino: string): Promise<void> {
  const marca = join(antigo, MARCA_DE_RESTAURACAO);
  await rm(marca, { force: true }).catch(() => undefined);
  if (!existsSync(marca)) await rm(join(destino, RESTAURACAO_CONCLUIDA), { force: true }).catch(() => undefined);
}

async function restauracaoJaConcluida(banco: string, hash: string): Promise<boolean> {
  try {
    return (JSON.parse(await readFile(join(banco, RESTAURACAO_CONCLUIDA), 'utf8')) as { marca?: unknown }).marca === hash;
  } catch {
    return false;
  }
}

/** Aviso para a tela de estado (`MARGEM_AVISOS`), em frase curta. */
export function avisoDaPastaSincronizada(pastas: PastasDaBiblioteca): string | null {
  if (pastas.banco === pastas.bancoNaBiblioteca) return null;
  if (pastas.sincronizada === null) {
    // A biblioteca saiu de uma pasta sincronizada: o banco continua onde estava, neste computador.
    return `O banco desta biblioteca (marcas, notas e leituras) fica neste computador, em ${pastas.banco}, fora da pasta `
      + 'da biblioteca. Para guardar tudo junto, use Arquivo → Fazer cópia de segurança…';
  }
  return `A biblioteca está numa pasta do ${pastas.sincronizada}. Para não corromper, o banco (marcas, notas e leituras) `
    + `fica neste computador, em ${pastas.banco}, e não sincroniza; os livros continuam na pasta. `
    + 'Para guardar tudo junto, use Arquivo → Fazer cópia de segurança…';
}

/**
 * Copia um cluster PARADO para `destino` (que não pode existir), conferido arquivo a arquivo; sem o
 * `postmaster.pid`. Para a biblioteca copiada (W-02), que ganha um banco local próprio com os dados da original.
 */
export async function copiarCluster(origem: string, destino: string, opcoes: { plataforma?: NodeJS.Platform } = {}): Promise<void> {
  await mkdir(dirname(destino), { recursive: true });
  const temporario = `${destino}.copiando-${randomBytes(4).toString('hex')}`;
  try {
    await cp(origem, temporario, {
      recursive: true, errorOnExist: true, force: false, preserveTimestamps: true,
      filter: (caminho) => !FORA_DA_COPIA.has(relative(origem, caminho)),
    });
    if (!mesmoInventario(await inventario(origem), await inventario(temporario))) throw new Error('a cópia não confere com o banco');
    if ((opcoes.plataforma ?? process.platform) !== 'win32') await chmod(temporario, 0o700);
    await renomearComRetentativa(temporario, destino);
  } catch (erro) {
    await rm(temporario, { recursive: true, force: true });
    throw new ErroDoBanco('migracao', 'Não foi possível copiar o banco da biblioteca original para a cópia. Nada foi mudado na original.', (erro as Error).message);
  }
}

// ---------------------------------------------------------------- cópia antes de migrar (D-06)

/** O que fica ao lado da cópia: de onde veio, de quando é e em que ponto das migrações o banco estava. */
export interface ManifestoDaCopia {
  versao_do_app: string | null;
  criada_em: string;
  biblioteca: string;
  banco: string;
  versao_postgres: number;
  migracoes_aplicadas: number;
  ultima_aplicada: string | null;
  pendentes: string[];
  arquivos: number;
  bytes: number;
}

export type DadosDoManifesto = Omit<ManifestoDaCopia, 'criada_em' | 'arquivos' | 'bytes'>;

/** Folga além do tamanho do banco para a cópia começar. */
const FOLGA_DA_COPIA = 64 * 1024 * 1024;

export function mesmoInventario(a: Map<string, number>, b: Map<string, number>): boolean {
  return a.size === b.size && [...a].every(([nome, tamanho]) => b.get(nome) === tamanho);
}

/**
 * Copia o cluster PARADO para `destino` (`<copias>/<id da biblioteca>`), com `manifesto.json`. Só a última
 * cópia válida fica: a nova é montada ao lado, conferida arquivo a arquivo (nome e tamanho) e só então
 * toma o lugar da anterior. Sem espaço, ou com a cópia que não confere, lança `copia` e a anterior fica.
 */
export async function copiarAntesDeMigrar(
  origem: string, destino: string, dados: DadosDoManifesto,
  opcoes: { agora?: Date; livres?: (pasta: string) => Promise<number | null>; copiar?: typeof cp } = {},
): Promise<{ pasta: string; manifesto: ManifestoDaCopia }> {
  const inv = await inventario(origem);
  const bytes = [...inv.values()].reduce((soma, tamanho) => soma + tamanho, 0);
  const pastaDasCopias = dirname(destino);
  await mkdir(pastaDasCopias, { recursive: true });
  const mb = (n: number) => `${String(Math.ceil(n / (1024 * 1024)))} MB`;
  const livres = await (opcoes.livres ?? (async (pasta) => {
    try { const info = await statfs(pasta); return Number(info.bavail) * Number(info.bsize); } catch { return null; }
  }))(pastaDasCopias);
  const semEspaco = (): ErroDoBanco => new ErroDoBanco('copia',
    `Antes de atualizar o banco desta biblioteca, o Margem guarda uma cópia dele, e não há espaço para ela em ${pastaDasCopias} `
    + `(o banco ocupa ${mb(bytes)}). Nada foi alterado. Libere espaço nesse disco e abra o Margem de novo.`);
  if (livres !== null && livres < bytes + FOLGA_DA_COPIA) throw semEspaco();

  const sufixo = randomBytes(4).toString('hex');
  const nova = `${destino}.nova-${sufixo}`;
  const velha = `${destino}.velha-${sufixo}`;
  try {
    await mkdir(nova, { recursive: true });
    await (opcoes.copiar ?? cp)(origem, join(nova, 'banco'), {
      recursive: true, filter: (caminho) => !FORA_DA_COPIA.has(basename(caminho)),
    });
    if (!mesmoInventario(inv, await inventario(join(nova, 'banco')))) throw new Error('a cópia não confere com o banco');
    const manifesto: ManifestoDaCopia = { ...dados, criada_em: (opcoes.agora ?? new Date()).toISOString(), arquivos: inv.size, bytes };
    await writeFile(join(nova, 'manifesto.json'), `${JSON.stringify(manifesto, null, 2)}\n`);
    if (existsSync(destino)) await renomearComRetentativa(destino, velha);
    await renomearComRetentativa(nova, destino);
    await rm(velha, { recursive: true, force: true });
    return { pasta: destino, manifesto };
  } catch (erro) {
    await rm(nova, { recursive: true, force: true }).catch(() => undefined);
    // Falha entre os dois renames: a anterior volta para o lugar.
    if (!existsSync(destino) && existsSync(velha)) await renomearComRetentativa(velha, destino).catch(() => undefined);
    if (erro instanceof ErroDoBanco) throw erro;
    const codigo = (erro as NodeJS.ErrnoException).code;
    if (codigo === 'ENOSPC') throw semEspaco();
    throw new ErroDoBanco('copia',
      `Antes de atualizar o banco desta biblioteca, o Margem guarda uma cópia dele, e a cópia não deu certo (${(erro as Error).message}). `
      + 'Nada foi alterado. Feche outros programas que possam estar usando a pasta e abra o Margem de novo.');
  }
}

/** As migrações que o app traz (`servico/src/db/migrations` dentro da raiz); `null` se a pasta não existe. */
export async function migracoesEmpacotadas(pasta: string): Promise<string[] | null> {
  try {
    return (await readdir(pasta)).filter((nome) => /^\d{4}_.+\.sql$/u.test(nome)).sort();
  } catch {
    return null;
  }
}

/**
 * Pendentes que pedem cópia: as que o app traz e o banco ainda não aplicou. Banco sem tabela de migrações
 * (ou vazia) não tem dados a proteger: nada. Mesma regra de `migracoesPendentes` do serviço (J156), sem a
 * conferência de hash (a API recusa migração alterada antes de tocar no banco).
 */
export function pendentesQuePedemCopia(empacotadas: readonly string[] | null, aplicadas: readonly string[] | null): string[] {
  if (empacotadas === null || aplicadas === null || aplicadas.length === 0) return [];
  const feitas = new Set(aplicadas);
  return empacotadas.filter((nome) => !feitas.has(nome));
}
