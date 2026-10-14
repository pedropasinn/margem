/**
 * Sincronização com o disco nos três sistemas (V-W1, auditoria B-02).
 *
 * Linux e macOS: `fsync` de um descritor só de leitura vale para o arquivo e para a pasta (a
 * pasta precisa dele para o `link`/`rename` sobreviver a uma queda de energia). Garantia mantida.
 *
 * Windows: `fsync` é `FlushFileBuffers`, que exige handle com escrita. Num descritor aberto com
 * `'r'` ele dá EPERM, e foi isso que perdia a imagem gerada, a narração, a mídia enviada, o áudio
 * do YouTube e as capas. O arquivo é aberto com `'r+'`; se ainda assim o sistema recusar (arquivo
 * só de leitura, antivírus segurando o handle), a sincronização vira melhor esforço, porque o
 * conteúdo já foi gravado e conferido pelo hash. Pasta não tem `fsync` no Windows: o NTFS registra
 * os metadados em diário, e não há API para isso; a função não faz nada.
 */
import { open as abrirDoNode, rename as renomearDoNode } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

export interface OpcoesDoDisco {
  /** Injetável nos testes; padrão `process.platform`. */
  plataforma?: NodeJS.Platform;
  /** Injetável nos testes; padrão `fs.promises.open`. */
  abrir?: (caminho: string, modo: string) => Promise<Pick<FileHandle, 'sync' | 'close'>>;
}

/** Códigos que, no Windows, significam "este handle ou este objeto não aceita flush". */
const TOLERADOS_NO_WINDOWS = new Set(['EPERM', 'EACCES', 'EINVAL', 'EISDIR', 'EBUSY']);
/** Fora do Windows, só sistemas de arquivos sem `fsync` de pasta (alguns de rede) dão EINVAL. */
const TOLERADOS_NA_PASTA = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP']);

function codigoDoErro(erro: unknown): string | undefined {
  return typeof erro === 'object' && erro !== null && 'code' in erro && typeof erro.code === 'string' ? erro.code : undefined;
}

async function sincronizarCom(caminho: string, modo: string, abrir: NonNullable<OpcoesDoDisco['abrir']>): Promise<void> {
  const arquivo = await abrir(caminho, modo);
  try { await arquivo.sync(); } finally { await arquivo.close(); }
}

/** Garante que o conteúdo de `caminho` chegou ao disco antes de qualquer referência a ele. */
export async function sincronizarArquivo(caminho: string, opcoes: OpcoesDoDisco = {}): Promise<void> {
  const plataforma = opcoes.plataforma ?? process.platform;
  const abrir = opcoes.abrir ?? abrirDoNode;
  if (plataforma !== 'win32') { await sincronizarCom(caminho, 'r', abrir); return; }
  try {
    await sincronizarCom(caminho, 'r+', abrir);
  } catch (erro) {
    const codigo = codigoDoErro(erro);
    if (codigo === undefined || !TOLERADOS_NO_WINDOWS.has(codigo)) throw erro;
  }
}

/** Garante que a entrada recém-criada na pasta (por `link` ou `rename`) sobrevive a uma queda. */
export async function sincronizarPasta(caminho: string, opcoes: OpcoesDoDisco = {}): Promise<void> {
  const plataforma = opcoes.plataforma ?? process.platform;
  if (plataforma === 'win32') return;
  try {
    await sincronizarCom(caminho, 'r', opcoes.abrir ?? abrirDoNode);
  } catch (erro) {
    const codigo = codigoDoErro(erro);
    if (codigo === undefined || !TOLERADOS_NA_PASTA.has(codigo)) throw erro;
  }
}

export interface OpcoesDoRenomear {
  plataforma?: NodeJS.Platform;
  tentativas?: number;
  /** Espera antes da 1ª nova tentativa; dobra a cada uma (até 1 s). */
  esperaMs?: number;
  renomear?: (origem: string, destino: string) => Promise<void>;
}

const PASSAGEIROS_NO_WINDOWS = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * `rename` com nova tentativa no Windows (V-W8, auditoria B-13): lá o `MoveFileEx` por cima de um
 * arquivo aberto por outro processo (a API lendo `preparo.json`, o antivírus, o indexador) dá EPERM,
 * EBUSY ou EACCES por alguns milissegundos. Nos outros sistemas a primeira falha já é a resposta.
 */
export async function renomearComRetentativa(origem: string, destino: string, opcoes: OpcoesDoRenomear = {}): Promise<void> {
  const plataforma = opcoes.plataforma ?? process.platform;
  const renomear = opcoes.renomear ?? renomearDoNode;
  const tentativas = plataforma === 'win32' ? (opcoes.tentativas ?? 5) : 1;
  let espera = opcoes.esperaMs ?? 50;
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      await renomear(origem, destino);
      return;
    } catch (erro) {
      const codigo = codigoDoErro(erro) ?? '';
      if (tentativa >= tentativas || !PASSAGEIROS_NO_WINDOWS.has(codigo)) throw erro;
      await new Promise((resolver) => setTimeout(resolver, espera));
      espera = Math.min(espera * 2, 1_000);
    }
  }
}
