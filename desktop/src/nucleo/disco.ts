/**
 * `rename` com nova tentativa no Windows (V-W8, auditoria B-13). Lá o `MoveFileEx` por cima de um
 * arquivo que outro processo tem aberto (o antivírus, o indexador, o OneDrive, a API lendo o arquivo)
 * dá EPERM, EBUSY ou EACCES por alguns milissegundos. Nos outros sistemas o `rename` é atômico e não
 * esbarra em arquivo aberto: a primeira falha já é a resposta.
 */
import { rename } from 'node:fs/promises';

export interface OpcoesDoRenomear {
  plataforma?: NodeJS.Platform;
  tentativas?: number;
  /** Espera antes da 1ª nova tentativa; dobra a cada uma. */
  esperaMs?: number;
  renomear?: (origem: string, destino: string) => Promise<void>;
}

const PASSAGEIROS_NO_WINDOWS = new Set(['EPERM', 'EBUSY', 'EACCES']);

export async function renomearComRetentativa(origem: string, destino: string, opcoes: OpcoesDoRenomear = {}): Promise<void> {
  const plataforma = opcoes.plataforma ?? process.platform;
  const renomear = opcoes.renomear ?? rename;
  const tentativas = plataforma === 'win32' ? (opcoes.tentativas ?? 5) : 1;
  let espera = opcoes.esperaMs ?? 50;
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      await renomear(origem, destino);
      return;
    } catch (erro) {
      const codigo = (erro as NodeJS.ErrnoException).code ?? '';
      if (tentativa >= tentativas || !PASSAGEIROS_NO_WINDOWS.has(codigo)) throw erro;
      await new Promise((resolver) => setTimeout(resolver, espera));
      espera = Math.min(espera * 2, 1_000);
    }
  }
}
