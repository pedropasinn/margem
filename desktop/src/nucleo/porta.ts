/**
 * Escolha de porta em 127.0.0.1. A API tenta 8730 primeiro (a extensão do navegador fala com
 * http://localhost:8730); ocupada, as seguintes até 8739, onde a extensão também procura (V-W9);
 * depois a última usada e, por fim, uma livre dada pelo sistema.
 */
import { createServer } from 'node:net';

export const PORTA_DA_EXTENSAO = 8730;
/** As portas em que a extensão procura o Margem, em ordem (8730 a 8739). */
export const FAIXA_DA_EXTENSAO: readonly number[] = Array.from({ length: 10 }, (_, i) => PORTA_DA_EXTENSAO + i);
export const ENDERECO = '127.0.0.1';

/** `reservada`: o sistema recusa o `listen` por permissão (no Windows, faixas reservadas por Hyper-V/WSL). */
export type SituacaoDaPorta = 'livre' | 'ocupada' | 'reservada';

/** Tenta um `listen` exclusivo e fecha na hora (quem chamar sobe o serviço logo em seguida). */
export function situacaoDaPorta(porta: number, endereco = ENDERECO): Promise<SituacaoDaPorta> {
  return new Promise((resolver) => {
    const servidor = createServer();
    servidor.unref();
    servidor.once('error', (erro: NodeJS.ErrnoException) => { resolver(erro.code === 'EACCES' || erro.code === 'EPERM' ? 'reservada' : 'ocupada'); });
    servidor.listen({ port: porta, host: endereco, exclusive: true }, () => {
      servidor.close(() => { resolver('livre'); });
    });
  });
}

/** A porta aceita um `listen` agora? */
export async function portaLivre(porta: number, endereco = ENDERECO): Promise<boolean> {
  return (await situacaoDaPorta(porta, endereco)) === 'livre';
}

/** Por que a 8730 não serviu: outro Margem responde nela, outro programa a usa, ou o sistema a reservou. */
export type MotivoDaPortaOcupada = { motivo: 'outro_margem'; instancia_id: string | null } | { motivo: 'outro_programa' | 'reservada' };

export async function motivoDaPortaOcupada(
  porta: number,
  opcoes: { situacao?: (porta: number) => Promise<SituacaoDaPorta>; buscar?: typeof fetch } = {},
): Promise<MotivoDaPortaOcupada> {
  if ((await (opcoes.situacao ?? situacaoDaPorta)(porta)) === 'reservada') return { motivo: 'reservada' };
  try {
    const resposta = await (opcoes.buscar ?? fetch)(`http://${ENDERECO}:${String(porta)}/api/saude`, { signal: AbortSignal.timeout(1_500) });
    const corpo = await resposta.json() as { servico?: unknown; instancia_id?: unknown };
    // Margem antigo (sem `servico` na saúde) ainda responde `{ ok }`: também é "outro Margem".
    if (corpo.servico === 'margem' || typeof (corpo as { ok?: unknown }).ok === 'boolean') {
      return { motivo: 'outro_margem', instancia_id: typeof corpo.instancia_id === 'string' ? corpo.instancia_id : null };
    }
  } catch { /* não é HTTP, ou não respondeu: outro programa */ }
  return { motivo: 'outro_programa' };
}

/**
 * O aviso da checagem quando a API não ficou na 8730 (`null` quando ficou). Dentro da faixa, a extensão
 * acha este Margem sozinha; fora dela, não.
 */
export function avisoDaPorta(portaDaApi: number, ocupada: MotivoDaPortaOcupada): string | null {
  if (portaDaApi === PORTA_DA_EXTENSAO) return null;
  const porque = ocupada.motivo === 'outro_margem'
    ? `outro Margem responde nela${ocupada.instancia_id ? ` (identificação ${ocupada.instancia_id})` : ''}`
    : ocupada.motivo === 'reservada' ? 'o sistema reservou essa porta (no Windows, Hyper-V ou WSL costumam fazer isso)' : 'outro programa está usando essa porta';
  if (!FAIXA_DA_EXTENSAO.includes(portaDaApi)) {
    return `A porta ${String(PORTA_DA_EXTENSAO)} está ocupada: ${porque}. Este Margem abriu na porta ${String(portaDaApi)}, e a extensão do navegador não vai encontrá-lo. Feche o programa que usa a porta ${String(PORTA_DA_EXTENSAO)} e abra o Margem de novo.`;
  }
  const outro = ocupada.motivo === 'outro_margem' ? ' Nas opções da extensão, confira se a identificação é a deste Margem, mostrada abaixo.' : '';
  return `A porta ${String(PORTA_DA_EXTENSAO)} está ocupada: ${porque}. Este Margem abriu na porta ${String(portaDaApi)}; a extensão do navegador procura nas portas ${String(PORTA_DA_EXTENSAO)} a ${String(FAIXA_DA_EXTENSAO.at(-1))} e o encontra.${outro}`;
}

/** Uma porta livre qualquer, escolhida pelo sistema. */
export function portaDoSistema(endereco = ENDERECO): Promise<number> {
  return new Promise((resolver, rejeitar) => {
    const servidor = createServer();
    servidor.unref();
    servidor.once('error', rejeitar);
    servidor.listen({ port: 0, host: endereco, exclusive: true }, () => {
      const endereco_ = servidor.address();
      const porta = typeof endereco_ === 'object' && endereco_ !== null ? endereco_.port : 0;
      servidor.close(() => { if (porta > 0) resolver(porta); else rejeitar(new Error('O sistema não deu porta livre.')); });
    });
  });
}

export interface OpcoesDaEscolha {
  /** Na ordem de preferência; repetidas e inválidas são ignoradas. */
  preferidas: readonly (number | undefined | null)[];
  testar?: (porta: number) => Promise<boolean>;
  sortear?: () => Promise<number>;
  /** Portas que não servem (por exemplo, a que o Postgres acabou de pegar). */
  evitar?: readonly number[];
}

export async function escolherPorta(opcoes: OpcoesDaEscolha): Promise<number> {
  const testar = opcoes.testar ?? ((porta: number) => portaLivre(porta));
  const sortear = opcoes.sortear ?? (() => portaDoSistema());
  const evitar = new Set(opcoes.evitar ?? []);
  const vistas = new Set<number>();
  for (const porta of opcoes.preferidas) {
    if (porta === undefined || porta === null || !Number.isInteger(porta) || porta <= 0 || porta > 65_535) continue;
    if (vistas.has(porta) || evitar.has(porta)) continue;
    vistas.add(porta);
    if (await testar(porta)) return porta;
  }
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    const porta = await sortear();
    if (!evitar.has(porta)) return porta;
  }
  throw new Error('Não foi possível achar uma porta livre em 127.0.0.1.');
}
