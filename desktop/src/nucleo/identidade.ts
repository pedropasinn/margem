/**
 * Identidade da biblioteca (W-02, D-03): um id guardado na própria pasta, em `.margem/biblioteca.json`,
 * localiza o que o app guarda dela fora da pasta (o banco local de uma biblioteca sincronizada, a senha
 * do banco, a cópia de antes das migrações). Assim, renomear ou mover a pasta (ou trocar só maiúsculas no
 * Windows) continua abrindo o mesmo banco.
 *
 * Compatibilidade: biblioteca de antes do marcador ganha como id o hash do caminho atual, o mesmo que o
 * app já usava (`bancos/<hash>`, `banco-<hash>.senha`, `copias/<hash>`); nada muda de lugar. Biblioteca
 * nova ganha um id aleatório (o hash de um caminho pode voltar a ser usado por outra pasta depois).
 *
 * Mover × copiar: o app guarda, por id, o último caminho em que viu a biblioteca (`bibliotecas.json` no
 * userData). Abrir num caminho novo:
 *   - o caminho antigo não existe mais, ou já é outra biblioteca (outro id): a pasta foi movida; o
 *     registro passa a apontar para o caminho novo;
 *   - o caminho antigo ainda existe, com o mesmo id: há duas pastas com a mesma identidade (cópia,
 *     duplicação, restauração ao lado da original). Elas não podem dividir o banco local. O app pergunta
 *     se a pasta foi movida ou copiada; sem resposta (sem janela), trata como cópia, que é o seguro: a
 *     cópia ganha id novo, e nada da original muda.
 * O mesmo diretório visto por outro caminho (maiúsculas no Windows/macOS, link simbólico) é o mesmo: compara
 * o caminho sem caixa nesses sistemas e o par dispositivo/inode.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { renomearComRetentativa } from './disco.js';

export const ARQUIVO_DO_MARCADOR = 'biblioteca.json';

export interface MarcadorDaBiblioteca {
  versao: 1;
  id: string;
  criada_em: string;
}

const ID = /^[0-9a-f]{24}$/u;

export function caminhoDoMarcador(biblioteca: string): string {
  return join(resolve(biblioteca), '.margem', ARQUIVO_DO_MARCADOR);
}

/** O id gravado na pasta; `null` sem marcador (ou marcador ilegível). */
export function lerIdDaPasta(biblioteca: string): string | null {
  try {
    const dados = JSON.parse(readFileSync(caminhoDoMarcador(biblioteca), 'utf8')) as { id?: unknown };
    return typeof dados.id === 'string' && ID.test(dados.id) ? dados.id : null;
  } catch {
    return null;
  }
}

/** O id de antes do marcador: hash do caminho absoluto (o nome do banco local, da senha e da cópia). */
export function idLegadoDaBiblioteca(biblioteca: string): string {
  return createHash('sha256').update(resolve(biblioteca)).digest('hex').slice(0, 24);
}

export function novoIdDeBiblioteca(): string {
  return randomBytes(12).toString('hex');
}

async function gravarAtomico(arquivo: string, conteudo: string): Promise<void> {
  const temporario = `${arquivo}.${String(process.pid)}.${randomBytes(3).toString('hex')}.tmp`;
  await writeFile(temporario, conteudo);
  await renomearComRetentativa(temporario, arquivo);
}

export async function gravarMarcador(biblioteca: string, id: string, agora: Date = new Date()): Promise<void> {
  await mkdir(join(resolve(biblioteca), '.margem'), { recursive: true });
  const marcador: MarcadorDaBiblioteca = { versao: 1, id, criada_em: agora.toISOString() };
  await gravarAtomico(caminhoDoMarcador(biblioteca), `${JSON.stringify(marcador, null, 2)}\n`);
}

// ---------------------------------------------------------------- registro (userData)

export interface EntradaDoRegistro { caminho: string; visto_em: string }
export type RegistroDasBibliotecas = Record<string, EntradaDoRegistro>;

export async function lerRegistro(arquivo: string): Promise<RegistroDasBibliotecas> {
  try {
    const bruto = JSON.parse(await readFile(arquivo, 'utf8')) as { bibliotecas?: unknown };
    const lista = bruto.bibliotecas;
    if (typeof lista !== 'object' || lista === null) return {};
    const registro: RegistroDasBibliotecas = {};
    for (const [id, valor] of Object.entries(lista as Record<string, unknown>)) {
      const entrada = valor as { caminho?: unknown; visto_em?: unknown };
      if (ID.test(id) && typeof entrada.caminho === 'string') {
        registro[id] = { caminho: entrada.caminho, visto_em: typeof entrada.visto_em === 'string' ? entrada.visto_em : '' };
      }
    }
    return registro;
  } catch {
    return {};
  }
}

export async function gravarRegistro(arquivo: string, registro: RegistroDasBibliotecas): Promise<void> {
  await mkdir(dirname(arquivo), { recursive: true });
  await gravarAtomico(arquivo, `${JSON.stringify({ versao: 1, bibliotecas: registro }, null, 2)}\n`);
}

/** As duas formas apontam para a mesma pasta? (caixa no Windows/macOS, link simbólico, ponto de montagem) */
export function mesmaPasta(a: string, b: string, plataforma: NodeJS.Platform = process.platform): boolean {
  const ra = resolve(a);
  const rb = resolve(b);
  if (ra === rb) return true;
  if ((plataforma === 'win32' || plataforma === 'darwin') && ra.toLowerCase() === rb.toLowerCase()) return true;
  try {
    const sa = statSync(ra);
    const sb = statSync(rb);
    return sa.ino !== 0 && sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

/**
 * R2-1: o que este computador guarda pelo id legado (banco local, senha, cópia do D-06) passa a atender
 * pelo id do marcador. Cada parte só vai se o destino ainda não existe: repetir depois de uma falha no
 * meio continua de onde parou, e nada que já é do id do marcador é coberto. O banco local só conta se
 * for um cluster (`PG_VERSION`). Devolve se o banco foi adotado.
 */
export async function adotarDoLegado(
  locais: { bancosLocais: string; segredos: string; copias: string }, legado: string, id: string,
  opcoes: { antesDeMoverOBanco?: (pasta: string) => Promise<unknown> } = {},
): Promise<boolean> {
  const bancoLegado = join(locais.bancosLocais, legado);
  const banco = join(locais.bancosLocais, id);
  if (!existsSync(join(bancoLegado, 'PG_VERSION')) || existsSync(banco)) return false;
  await opcoes.antesDeMoverOBanco?.(bancoLegado);
  // O banco vai por último: uma falha antes dele deixa a condição de partida intacta para a próxima vez.
  const pares: [string, string][] = [
    [join(locais.segredos, `banco-${legado}.senha`), join(locais.segredos, `banco-${id}.senha`)],
    [join(locais.copias, legado), join(locais.copias, id)],
  ];
  for (const [origem, destino] of pares) {
    if (existsSync(origem) && !existsSync(destino)) await renomearComRetentativa(origem, destino);
  }
  await renomearComRetentativa(bancoLegado, banco);
  return true;
}

// ---------------------------------------------------------------- decisão

export type Desfecho =
  /** Primeira vez com esta pasta: marcador novo (id aleatório, ou o hash antigo se já havia banco). */
  | 'nova'
  /** Marcador e registro conferem. */
  | 'mesma'
  /** Não havia registro desta identidade neste computador (a pasta veio de outro, ou o app é anterior). */
  | 'registrada'
  /** A pasta mudou de caminho (renomeada, movida); o registro foi atualizado. */
  | 'movida'
  /** Cópia de outra pasta que ainda existe: ganhou id novo (`anterior` é o id da original). */
  | 'copia'
  /** A pasta não aceitou o marcador (só leitura): fica o hash do caminho, como antes. */
  | 'sem_marcador';

export interface Identidade {
  id: string;
  desfecho: Desfecho;
  /** Na cópia, o id da original; na mudança de lugar, o caminho antigo vai em `caminhoAnterior`. */
  anterior?: string;
  caminhoAnterior?: string;
  /** R2-1: o id legado (hash do caminho) cujo banco local passou a atender pelo id do marcador. */
  legadoAdotado?: string;
}

export type RespostaDaCopia = 'movida' | 'copia' | 'cancelar';

export interface OpcoesDaIdentidade {
  /** `bibliotecas.json` no userData. */
  registro: string;
  /** Já há banco desta pasta (dentro dela ou no banco local pelo hash do caminho)? Decide o id da primeira vez. */
  temBancoAntigo: (idLegado: string) => boolean;
  /**
   * R2-1: marcador que chegou de outro computador (pasta sincronizada) sem registro aqui. Se este
   * computador já tinha o banco local da pasta pelo hash do caminho (de antes do marcador), ele passa a
   * atender pelo id do marcador antes de qualquer coisa: a biblioteca não abre vazia com os dados no
   * lugar antigo. Devolve se adotou. Uma falha lança e nada é registrado (a próxima abertura tenta de novo).
   */
  adotarLegado?: (legado: string, id: string) => Promise<boolean>;
  /**
   * R2-5: a cópia vai ganhar o id `id` (o da original é `anterior`). Roda ANTES de o id novo ser gravado
   * no marcador e no registro: se falha (a cópia do banco não coube, a pasta estava presa), nada muda e a
   * próxima abertura volta à mesma pergunta, em vez de achar a cópia já "registrada" e sem banco.
   */
  prepararCopia?: (copia: { id: string; anterior: string }) => Promise<void>;
  /** Duas pastas com a mesma identidade: a pessoa diz se moveu ou copiou. Sem isto, é cópia. */
  perguntar?: (pergunta: { biblioteca: string; outra: string }) => Promise<RespostaDaCopia>;
  plataforma?: NodeJS.Platform;
  agora?: Date;
}

export class IdentidadeCancelada extends Error {
  constructor() {
    super('A abertura da biblioteca foi cancelada.');
    this.name = 'IdentidadeCancelada';
  }
}

/**
 * Lê (ou cria) o marcador da pasta e confere com o registro do app. Devolve o id que localiza o banco
 * local, a senha e as cópias. Nunca apaga nada; no pior caso, grava o marcador e o registro (e, com
 * `adotarLegado`, renomeia o banco local legado desta pasta para o id do marcador).
 */
export async function identificarBiblioteca(biblioteca: string, opcoes: OpcoesDaIdentidade): Promise<Identidade> {
  const raiz = resolve(biblioteca);
  const plataforma = opcoes.plataforma ?? process.platform;
  const agora = opcoes.agora ?? new Date();
  const registro = await lerRegistro(opcoes.registro);
  const registrar = async (id: string): Promise<void> => {
    registro[id] = { caminho: raiz, visto_em: agora.toISOString() };
    await gravarRegistro(opcoes.registro, registro);
  };

  let id = lerIdDaPasta(raiz);
  if (id === null) {
    const legado = idLegadoDaBiblioteca(raiz);
    id = opcoes.temBancoAntigo(legado) ? legado : novoIdDeBiblioteca();
    try {
      await gravarMarcador(raiz, id, agora);
    } catch {
      return { id: legado, desfecho: 'sem_marcador' };
    }
    await registrar(id);
    return { id, desfecho: 'nova' };
  }

  const visto = registro[id];
  if (visto === undefined) {
    const legado = idLegadoDaBiblioteca(raiz);
    const adotou = legado !== id && opcoes.adotarLegado !== undefined && await opcoes.adotarLegado(legado, id);
    await registrar(id);
    return { id, desfecho: 'registrada', ...(adotou ? { legadoAdotado: legado } : {}) };
  }
  if (mesmaPasta(visto.caminho, raiz, plataforma)) {
    if (visto.caminho !== raiz) await registrar(id);
    return { id, desfecho: 'mesma' };
  }
  const outraAindaE = existsSync(visto.caminho) && lerIdDaPasta(visto.caminho) === id;
  if (!outraAindaE) {
    await registrar(id);
    return { id, desfecho: 'movida', caminhoAnterior: visto.caminho };
  }
  const resposta = opcoes.perguntar === undefined ? 'copia' : await opcoes.perguntar({ biblioteca: raiz, outra: visto.caminho });
  if (resposta === 'cancelar') throw new IdentidadeCancelada();
  if (resposta === 'movida') {
    await registrar(id);
    return { id, desfecho: 'movida', caminhoAnterior: visto.caminho };
  }
  const novo = novoIdDeBiblioteca();
  await opcoes.prepararCopia?.({ id: novo, anterior: id });
  await gravarMarcador(raiz, novo, agora);
  await registrar(novo);
  return { id: novo, desfecho: 'copia', anterior: id };
}
