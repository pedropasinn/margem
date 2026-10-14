/**
 * Atualização do app de computador (J146), vista da página. Só existe no app: no navegador
 * `ponteDaAtualizacao()` é null, e a seção e o aviso somem.
 *
 * Espelho de `desktop/src/nucleo/atualizacao.ts` (`EstadoDaAtualizacao`, `SituacaoDaAtualizacao`) e de
 * `desktop/src/principal/ponte.ts` (`AtualizacaoDoDesktop`).
 */
export type EstadoDaAtualizacao =
  | { estado: 'desligada'; motivo: 'desenvolvimento' | 'ambiente' | 'sem_feed' }
  | { estado: 'ociosa' }
  | { estado: 'procurando' }
  | { estado: 'atualizada'; quando: string }
  | { estado: 'baixando'; versao: string | null; porcentagem: number }
  | { estado: 'pronta'; versao: string }
  | { estado: 'manual'; versao: string }
  | { estado: 'indisponivel'; motivo: string };

export interface SituacaoDaAtualizacao {
  versao: string;
  atualizacao: EstadoDaAtualizacao;
}

export interface PonteDaAtualizacao {
  situacao: () => Promise<SituacaoDaAtualizacao>;
  procurar: () => Promise<SituacaoDaAtualizacao>;
  reiniciar: () => void;
  abrirDownload: () => void;
  aoMudar: (ouvir: (situacao: SituacaoDaAtualizacao) => void) => () => void;
}

export function ponteDaAtualizacao(): PonteDaAtualizacao | null {
  const ponte = (window as { margemDesktop?: { atualizacao?: Partial<PonteDaAtualizacao> } }).margemDesktop?.atualizacao;
  return typeof ponte?.situacao === 'function' && typeof ponte.procurar === 'function' && typeof ponte.aoMudar === 'function'
    && typeof ponte.reiniciar === 'function' && typeof ponte.abrirDownload === 'function'
    ? ponte as PonteDaAtualizacao : null;
}

/** "agora há pouco", "às 14:05", "em 12/10 às 09:30". */
export function quandoProcurou(iso: string, agora: Date = new Date()): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  const minutos = (agora.getTime() - data.getTime()) / 60_000;
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (minutos < 1) return 'agora há pouco';
  if (data.toDateString() === agora.toDateString()) return `às ${hora}`;
  return `em ${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
}

const DESLIGADA: Record<'desenvolvimento' | 'ambiente' | 'sem_feed', string> = {
  desenvolvimento: 'Esta é uma cópia de desenvolvimento: ela não se atualiza sozinha.',
  ambiente: 'A atualização automática está desligada neste computador.',
  sem_feed: 'Esta cópia foi instalada sem atualização automática. Baixe a versão nova em margem.dev e instale uma vez; depois ela se atualiza sozinha.',
};

/** A frase do estado, para a seção das Configurações. */
export function frase(estado: EstadoDaAtualizacao, agora?: Date): string {
  switch (estado.estado) {
    case 'desligada': return DESLIGADA[estado.motivo];
    case 'ociosa': return 'O Margem procura atualizações sozinho, de tempos em tempos.';
    case 'procurando': return 'Procurando atualização…';
    case 'atualizada': return `O Margem está atualizado. Última procura ${quandoProcurou(estado.quando, agora)}.`.replace(' .', '.');
    case 'baixando': return `Baixando ${estado.versao === null ? 'a versão nova' : `o Margem ${estado.versao}`}: ${estado.porcentagem}%.`;
    case 'pronta': return `O Margem ${estado.versao} está pronto. Ele é instalado quando você reiniciar ou fechar o Margem.`;
    case 'manual': return `O Margem ${estado.versao} está disponível. Neste sistema, baixe e instale pelo site; a biblioteca continua onde está.`;
    case 'indisponivel': return `Atualização indisponível: ${estado.motivo.charAt(0).toLowerCase()}${estado.motivo.slice(1)}`;
  }
}
