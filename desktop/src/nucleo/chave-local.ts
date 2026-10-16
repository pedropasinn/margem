/**
 * S-01 · A chave local desta instalação do Margem: 32 bytes aleatórios (base64url), gerados na primeira
 * abertura e guardados em `<userData>/segredos/chave-local` (0600, pasta 0700), fora da biblioteca: uma
 * biblioteca no Dropbox não leva a chave junto. O serviço a recebe por `MARGEM_CHAVE_LOCAL` e passa a
 * exigi-la em toda a API (`servico/src/http/chave-local.ts`); a janela a recebe pelo preload; a extensão e
 * o plugin do Obsidian, pelo campo de token, copiada das Configurações.
 */
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ARQUIVO = 'chave-local';
const CHAVE = /^[A-Za-z0-9_-]{32,}$/u;

/** Lê a chave da instalação; na primeira vez (ou se o arquivo estiver estragado), cria uma nova. */
export async function chaveDaInstalacao(segredos: string): Promise<string> {
  const caminho = join(segredos, ARQUIVO);
  const ler = async (): Promise<string | null> => {
    try {
      const chave = (await readFile(caminho, 'utf8')).trim();
      return CHAVE.test(chave) ? chave : null;
    } catch {
      return null;
    }
  };
  const existente = await ler();
  if (existente !== null) return existente;
  const nova = randomBytes(32).toString('base64url');
  try {
    // `wx`: duas aberturas ao mesmo tempo não geram duas chaves; quem perde lê a do outro.
    await writeFile(caminho, `${nova}\n`, { mode: 0o600, flag: 'wx' });
    return nova;
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'EEXIST') throw erro;
    const outra = await ler();
    if (outra !== null) return outra;
    // Arquivo estragado: troca por uma chave nova (a extensão e o Obsidian precisam da nova).
    await writeFile(caminho, `${nova}\n`, { mode: 0o600 });
    return nova;
  }
}
