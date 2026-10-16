/**
 * "Fazer cópia de segurança…" (U-03, W-01, D-01): com o serviço PARADO, copia para uma pasta que a pessoa
 * escolhe a biblioteca inteira (originais, versões, mídia, áudio, imagens, Quadros: tudo o que o banco
 * referencia mora nela) e o banco (o cluster do Postgres, esteja ele na pasta ou no banco local de uma
 * biblioteca sincronizada), com um manifesto e um LEIA-ME de restauração. Sem zip e sem assistente: a
 * restauração é copiar duas pastas (ver o LEIA-ME e margem.dev/docs/backup).
 *
 *   <pasta escolhida>/Cópia do Margem 2026-10-16 14h05/
 *     LEIA-ME.txt        como restaurar
 *     manifesto.json     versão do app, data, sistema, migrações, contagens
 *     biblioteca/        a pasta da biblioteca (sem `.margem/banco*` e sem `segredos/`)
 *     banco/             o cluster, conferido arquivo a arquivo, com a marca de restauração
 *
 * Fica de fora: o login do ChatGPT, a senha do banco e a chave da ElevenLabs (moram no app, não na
 * biblioteca); bancos antigos já migrados (`.margem/banco.migrado-*`); e uma pasta `segredos/` que tenha
 * sobrado na biblioteca. A cópia é montada numa pasta temporária ao lado e só ganha o nome final inteira.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readdir, readFile, rm, statfs, utimes, writeFile } from 'node:fs/promises';
import { arch } from 'node:os';
import { dirname, join, posix, relative, sep, win32 } from 'node:path';
import type { PastasDaBiblioteca } from './configuracao.js';
import { FORA_DA_COPIA, MARCA_DE_RESTAURACAO } from './banco-local.js';
import { renomearComRetentativa } from './disco.js';
import { mesmaPasta } from './identidade.js';

export class ErroDaCopia extends Error {
  constructor(readonly codigo: 'destino' | 'espaco' | 'copia' | 'conferencia', mensagem: string, readonly detalhe?: string) {
    super(mensagem);
    this.name = 'ErroDaCopia';
  }
}

export interface ManifestoDaCopiaDeSeguranca {
  formato: 1;
  criada_em: string;
  versao_do_app: string | null;
  sistema: NodeJS.Platform;
  arquitetura: string;
  biblioteca: { caminho: string; id: string; sincronizada: string | null; arquivos: number; bytes: number };
  banco: { caminho: string; versao_postgres: number | null; migracoes_aplicadas: number; ultima_migracao: string | null; arquivos: number; bytes: number };
  /** O que não foi copiado de propósito (relativo à biblioteca). */
  fora_da_copia: string[];
  /** Itens que não são arquivo comum nem pasta (links simbólicos), deixados de fora. */
  ignorados: string[];
}

export interface DadosDaCopiaDeSeguranca {
  versaoDoApp: string | null;
  versaoPostgres: number | null;
  migracoesAplicadas: readonly string[] | null;
}

export interface OpcoesDaCopiaDeSeguranca {
  agora?: Date;
  /** Etapas e porcentagem, para a janela de "abrindo". */
  aoProgresso?: (etapa: string) => void;
  livres?: (pasta: string) => Promise<number | null>;
  /** Troca a cópia de um arquivo (testes: falha no meio). */
  copiarArquivo?: (origem: string, destino: string) => Promise<void>;
  sistema?: NodeJS.Platform;
}

/** Folga além do tamanho para a cópia começar. */
const FOLGA = 64 * 1024 * 1024;

/** O que não vai para `biblioteca/` (caminhos relativos à biblioteca, com `/`). */
function foraDaBiblioteca(relativo: string): boolean {
  const partes = relativo.split(sep).join('/');
  if (partes === 'segredos' || partes.startsWith('segredos/')) return true;
  // O banco vai à parte (`banco/`); os antigos já migrados e temporários de migração não vão.
  return /^\.margem\/banco(?:$|[./-])/u.test(partes);
}

interface Item { relativo: string; tamanho: number; mtime: Date; atime: Date }

async function listar(raiz: string, excluir: (relativo: string) => boolean): Promise<{ arquivos: Item[]; pastas: string[]; ignorados: string[] }> {
  const arquivos: Item[] = [];
  const pastas: string[] = [];
  const ignorados: string[] = [];
  const visitar = async (pasta: string): Promise<void> => {
    for (const nome of await readdir(pasta)) {
      const caminho = join(pasta, nome);
      const relativo = relative(raiz, caminho);
      if (excluir(relativo)) continue;
      const info = await lstat(caminho);
      if (info.isDirectory()) { pastas.push(relativo); await visitar(caminho); }
      else if (info.isFile()) arquivos.push({ relativo, tamanho: info.size, mtime: info.mtime, atime: info.atime });
      else ignorados.push(relativo);
    }
  };
  await visitar(raiz);
  return { arquivos, pastas, ignorados };
}

const soma = (itens: readonly Item[]): number => itens.reduce((total, item) => total + item.tamanho, 0);
const mb = (n: number): string => `${String(Math.ceil(n / (1024 * 1024)))} MB`;

/** "Cópia do Margem 2026-10-16 14h05" (hora local), com " (2)", " (3)"… se já existir. */
export function nomeDaCopia(pasta: string, agora: Date): string {
  const d2 = (n: number) => String(n).padStart(2, '0');
  const base = `Cópia do Margem ${String(agora.getFullYear())}-${d2(agora.getMonth() + 1)}-${d2(agora.getDate())} ${d2(agora.getHours())}h${d2(agora.getMinutes())}`;
  let nome = base;
  for (let n = 2; existsSync(join(pasta, nome)); n += 1) nome = `${base} (${String(n)})`;
  return nome;
}

/** A pasta escolhida não pode estar dentro da biblioteca nem do banco (a cópia se copiaria). */
export function destinoProibido(destino: string, pastas: PastasDaBiblioteca, sistema: NodeJS.Platform = process.platform): string | null {
  const caminhos = sistema === 'win32' ? win32 : posix;
  const dentro = (pasta: string, raiz: string): boolean => {
    if (mesmaPasta(pasta, raiz, sistema)) return true;
    const normal = (texto: string) => (sistema === 'win32' || sistema === 'darwin' ? texto.toLowerCase() : texto);
    const rel = caminhos.relative(normal(caminhos.resolve(raiz)), normal(caminhos.resolve(pasta)));
    return rel === '' || (!rel.startsWith('..') && !caminhos.isAbsolute(rel));
  };
  if (dentro(destino, pastas.biblioteca)) return 'Escolha uma pasta fora da biblioteca: a cópia não pode ficar dentro dela.';
  if (dentro(destino, pastas.banco)) return 'Escolha uma pasta fora do banco da biblioteca.';
  return null;
}

export function textoDoLeiaMe(manifesto: ManifestoDaCopiaDeSeguranca): string {
  return [
    'Cópia de segurança do Margem',
    '',
    `Feita em ${new Date(manifesto.criada_em).toLocaleString('pt-BR')} pelo Margem ${manifesto.versao_do_app ?? '(desenvolvimento)'}.`,
    `Biblioteca de origem: ${manifesto.biblioteca.caminho}`,
    `Banco de origem: ${manifesto.banco.caminho}`,
    '',
    'O que tem aqui',
    '  biblioteca/  a pasta da biblioteca: livros, arquivos originais, mídia, áudio, imagens e Quadros.',
    '  banco/       o banco de dados: marcas, notas, conversas, progresso de leitura.',
    '',
    'Como restaurar (também em https://margem.dev/docs/backup/#restaurar)',
    '  1. Feche o Margem (Arquivo → Sair; fechar só a janela pode deixá-lo aberto).',
    '  2. Copie a pasta "biblioteca" daqui para onde quiser e dê a ela o nome que quiser.',
    '     Se for pôr no lugar de uma biblioteca estragada, tire a estragada do caminho antes',
    '     (renomeie; não apague até conferir a restaurada).',
    '  3. Copie a pasta "banco" daqui para dentro da pasta ".margem" da biblioteca restaurada,',
    '     substituindo a "banco" que estiver lá. A pasta ".margem" fica escondida: no Windows,',
    '     Exibir → Mostrar → Itens ocultos; no Linux, Ctrl+H; no macOS, Cmd+Shift+Ponto.',
    '  4. Abra o Margem e escolha a pasta restaurada (Arquivo → Trocar de biblioteca…, ou na',
    '     primeira tela, num computador novo). Se a pasta estiver no OneDrive, Dropbox, Google Drive',
    '     ou iCloud, o Margem leva o banco para uma pasta deste computador na primeira abertura.',
    '  5. Num computador novo, entre de novo no ChatGPT; a chave da ElevenLabs, se você usa, também',
    '     precisa ser informada de novo (ela não vai na cópia).',
    '',
    'Restaure com o Margem desta versão ou de uma mais nova, no mesmo sistema (Windows, macOS ou',
    'Linux) em que a cópia foi feita.',
    '',
  ].join('\n');
}

export interface ResultadoDaCopiaDeSeguranca { pasta: string; manifesto: ManifestoDaCopiaDeSeguranca }

/**
 * Copia biblioteca e banco (que TEM de estar parado: quem chama para o serviço antes) para uma pasta nova
 * dentro de `destino`. Confere cada arquivo copiado (nome e tamanho). Qualquer falha apaga o que foi
 * montado; a biblioteca e o banco nunca são tocados.
 */
export async function fazerCopiaDeSeguranca(
  pastas: PastasDaBiblioteca, destino: string, dados: DadosDaCopiaDeSeguranca, opcoes: OpcoesDaCopiaDeSeguranca = {},
): Promise<ResultadoDaCopiaDeSeguranca> {
  const sistema = opcoes.sistema ?? process.platform;
  const agora = opcoes.agora ?? new Date();
  const progresso = opcoes.aoProgresso ?? (() => undefined);
  const proibido = destinoProibido(destino, pastas, sistema);
  if (proibido !== null) throw new ErroDaCopia('destino', proibido);
  try {
    await mkdir(destino, { recursive: true });
  } catch (erro) {
    throw new ErroDaCopia('destino', `Não foi possível usar a pasta ${destino}.`, (erro as Error).message);
  }

  progresso('Conferindo o que copiar');
  const daBiblioteca = await listar(pastas.biblioteca, foraDaBiblioteca);
  const doBanco = await listar(pastas.banco, (relativo) => FORA_DA_COPIA.has(relativo));
  const bytesDaBiblioteca = soma(daBiblioteca.arquivos);
  const bytesDoBanco = soma(doBanco.arquivos);
  const total = bytesDaBiblioteca + bytesDoBanco;
  const livres = await (opcoes.livres ?? (async (pasta) => {
    try { const info = await statfs(pasta); return Number(info.bavail) * Number(info.bsize); } catch { return null; }
  }))(destino);
  if (livres !== null && livres < total + FOLGA) {
    throw new ErroDaCopia('espaco', `Não há espaço em ${destino}: a cópia precisa de ${mb(total + FOLGA)} e há ${mb(livres)} livres. Escolha outro disco ou libere espaço.`);
  }

  const nome = nomeDaCopia(destino, agora);
  const final = join(destino, nome);
  const montando = join(destino, `.${nome}.parcial-${randomBytes(4).toString('hex')}`);
  const copiar = opcoes.copiarArquivo ?? ((origem: string, alvo: string) => copyFile(origem, alvo));
  let copiados = 0;
  let ultimo = -1;
  const avisar = (etapa: string) => {
    const porcento = total === 0 ? 100 : Math.floor((copiados / total) * 100);
    if (porcento !== ultimo) { ultimo = porcento; progresso(`${etapa} (${String(porcento)}%)`); }
  };
  const copiarArvore = async (origem: string, alvo: string, lista: { arquivos: Item[]; pastas: string[] }, etapa: string): Promise<void> => {
    await mkdir(alvo, { recursive: true });
    for (const pasta of lista.pastas) await mkdir(join(alvo, pasta), { recursive: true });
    for (const item of lista.arquivos) {
      const destinoDoItem = join(alvo, item.relativo);
      await mkdir(dirname(destinoDoItem), { recursive: true });
      await copiar(join(origem, item.relativo), destinoDoItem);
      await utimes(destinoDoItem, item.atime, item.mtime).catch(() => undefined);
      copiados += item.tamanho;
      avisar(etapa);
    }
  };
  const conferir = async (alvo: string, lista: { arquivos: Item[] }, rotulo: string): Promise<void> => {
    const copia = await listar(alvo, () => false);
    const tamanhos = new Map(copia.arquivos.map((item) => [item.relativo, item.tamanho]));
    const diferentes = lista.arquivos.filter((item) => tamanhos.get(item.relativo) !== item.tamanho).map((item) => item.relativo);
    if (diferentes.length > 0 || copia.arquivos.length !== lista.arquivos.length) {
      throw new ErroDaCopia('conferencia', `A cópia ${rotulo} saiu diferente do original. Nada foi mudado na biblioteca; tente de novo.`,
        `diferentes: ${diferentes.slice(0, 10).join(', ')} (${String(lista.arquivos.length)} × ${String(copia.arquivos.length)} arquivos)`);
    }
  };

  try {
    await copiarArvore(pastas.banco, join(montando, 'banco'), doBanco, 'Copiando o banco');
    // R2-3: o Postgres só abre a pasta de dados do dono (0700); a criada pela cópia sairia com o umask (0755).
    if (sistema !== 'win32') await chmod(join(montando, 'banco'), 0o700);
    await conferir(join(montando, 'banco'), doBanco, 'do banco');
    await copiarArvore(pastas.biblioteca, join(montando, 'biblioteca'), daBiblioteca, 'Copiando a biblioteca');
    await conferir(join(montando, 'biblioteca'), daBiblioteca, 'da biblioteca');
    const foraDaCopia = (await readdir(pastas.interna).catch(() => [] as string[]))
      .filter((item) => item !== 'banco' && foraDaBiblioteca(join('.margem', item))).map((item) => `.margem/${item}`);
    if (existsSync(join(pastas.biblioteca, 'segredos'))) foraDaCopia.push('segredos');
    const aplicadas = dados.migracoesAplicadas ?? [];
    const manifesto: ManifestoDaCopiaDeSeguranca = {
      formato: 1, criada_em: agora.toISOString(), versao_do_app: dados.versaoDoApp, sistema, arquitetura: arch(),
      biblioteca: { caminho: pastas.biblioteca, id: pastas.id, sincronizada: pastas.sincronizada, arquivos: daBiblioteca.arquivos.length, bytes: bytesDaBiblioteca },
      banco: {
        caminho: pastas.banco, versao_postgres: dados.versaoPostgres, migracoes_aplicadas: aplicadas.length,
        ultima_migracao: aplicadas.at(-1) ?? null, arquivos: doBanco.arquivos.length, bytes: bytesDoBanco,
      },
      fora_da_copia: foraDaCopia,
      ignorados: [...daBiblioteca.ignorados, ...doBanco.ignorados.map((item) => `banco/${item}`)],
    };
    const json = `${JSON.stringify(manifesto, null, 2)}\n`;
    await writeFile(join(montando, 'manifesto.json'), json);
    await writeFile(join(montando, 'banco', MARCA_DE_RESTAURACAO), json);
    await writeFile(join(montando, 'LEIA-ME.txt'), textoDoLeiaMe(manifesto));
    progresso('Concluindo a cópia');
    await renomearComRetentativa(montando, final);
    return { pasta: final, manifesto };
  } catch (erro) {
    await rm(montando, { recursive: true, force: true }).catch(() => undefined);
    if (erro instanceof ErroDaCopia) throw erro;
    const codigo = (erro as NodeJS.ErrnoException).code;
    if (codigo === 'ENOSPC') throw new ErroDaCopia('espaco', `O disco de ${destino} encheu durante a cópia. Nada foi mudado na biblioteca; escolha outro disco ou libere espaço.`);
    throw new ErroDaCopia('copia', `A cópia não deu certo (${(erro as Error).message}). Nada foi mudado na biblioteca.`);
  }
}

// ---------------------------------------------------------------- a última cópia (para as Configurações)

export interface UltimaCopia { pasta: string; criada_em: string }

export async function lerUltimasCopias(arquivo: string): Promise<Record<string, UltimaCopia>> {
  try {
    const bruto = JSON.parse(await readFile(arquivo, 'utf8')) as Record<string, unknown>;
    const saida: Record<string, UltimaCopia> = {};
    for (const [id, valor] of Object.entries(bruto)) {
      const item = valor as { pasta?: unknown; criada_em?: unknown };
      if (typeof item.pasta === 'string' && typeof item.criada_em === 'string') saida[id] = { pasta: item.pasta, criada_em: item.criada_em };
    }
    return saida;
  } catch {
    return {};
  }
}

export async function gravarUltimaCopia(arquivo: string, id: string, copia: UltimaCopia): Promise<void> {
  const todas = await lerUltimasCopias(arquivo);
  todas[id] = copia;
  const temporario = `${arquivo}.${String(process.pid)}.tmp`;
  await writeFile(temporario, `${JSON.stringify(todas, null, 2)}\n`);
  await renomearComRetentativa(temporario, arquivo);
}
