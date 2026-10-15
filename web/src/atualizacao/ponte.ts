/**
 * Atualização do app de computador (J146, J151), vista da página. Só existe no app: no navegador
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
  | { estado: 'disponivel'; versao: string; notas: string | null }
  /** `pedida`: a pessoa clicou em "Atualizar agora"; o Margem reinicia sozinho ao terminar. */
  | { estado: 'baixando'; versao: string | null; porcentagem: number; notas: string | null; pedida: boolean }
  | { estado: 'pronta'; versao: string; notas: string | null }
  | { estado: 'manual'; versao: string; notas: string | null }
  /** `versao`: a versão que não deu para baixar (null quando a falha foi na procura). */
  | { estado: 'indisponivel'; motivo: string; versao: string | null; pedida: boolean };

export interface SituacaoDaAtualizacao {
  versao: string;
  atualizacao: EstadoDaAtualizacao;
}

export interface PonteDaAtualizacao {
  situacao: () => Promise<SituacaoDaAtualizacao>;
  procurar: () => Promise<SituacaoDaAtualizacao>;
  reiniciar: () => void;
  abrirDownload: () => void;
  /** Instala se já baixou; baixando, reinicia ao terminar; sem download, começa; no macOS, abre o site. */
  atualizarAgora: () => void;
  /** "Depois": não reinicia sozinho; instala quando a pessoa fechar o Margem. */
  adiar: () => void;
  abrirNovidades: () => void;
  aoMudar: (ouvir: (situacao: SituacaoDaAtualizacao) => void) => () => void;
}

export function ponteDaAtualizacao(): PonteDaAtualizacao | null {
  const ponte = (window as { margemDesktop?: { atualizacao?: Partial<PonteDaAtualizacao> } }).margemDesktop?.atualizacao;
  return typeof ponte?.situacao === 'function' && typeof ponte.procurar === 'function' && typeof ponte.aoMudar === 'function'
    && typeof ponte.reiniciar === 'function' && typeof ponte.abrirDownload === 'function'
    && typeof ponte.atualizarAgora === 'function' && typeof ponte.adiar === 'function' && typeof ponte.abrirNovidades === 'function'
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
    case 'disponivel': return `O Margem ${estado.versao} está disponível.`;
    case 'baixando': return `Baixando ${estado.versao === null ? 'a versão nova' : `o Margem ${estado.versao}`}: ${estado.porcentagem}%.${estado.pedida ? ' O Margem reinicia sozinho ao terminar.' : ''}`;
    case 'pronta': return `O Margem ${estado.versao} está pronto. Ele é instalado quando você reiniciar ou fechar o Margem.`;
    case 'manual': return `O Margem ${estado.versao} está disponível. Neste sistema, baixe e instale pelo site; a biblioteca continua onde está.`;
    case 'indisponivel': return `Atualização indisponível: ${estado.motivo.charAt(0).toLowerCase()}${estado.motivo.slice(1)}`;
  }
}

/** O que o aviso de versão nova mostra (J151); null quando não há aviso. */
export type VistaDoAviso =
  /** Há versão nova. `porcentagem`: o download em segundo plano (null se não começou); `manual`: só pelo site. */
  | { tipo: 'disponivel'; versao: string; notas: string | null; porcentagem: number | null; manual: boolean }
  /** A pessoa pediu: baixando, e reinicia ao terminar. */
  | { tipo: 'baixando'; versao: string | null; notas: string | null; porcentagem: number }
  | { tipo: 'pronta'; versao: string; notas: string | null }
  /** Falhou o download de uma versão encontrada, ou a procura que a pessoa pediu. */
  | { tipo: 'erro'; versao: string | null; motivo: string };

export function vistaDoAviso(estado: EstadoDaAtualizacao | undefined): VistaDoAviso | null {
  switch (estado?.estado) {
    case 'disponivel': return { tipo: 'disponivel', versao: estado.versao, notas: estado.notas, porcentagem: null, manual: false };
    case 'manual': return { tipo: 'disponivel', versao: estado.versao, notas: estado.notas, porcentagem: null, manual: true };
    case 'baixando':
      if (estado.pedida) return { tipo: 'baixando', versao: estado.versao, notas: estado.notas, porcentagem: estado.porcentagem };
      // Sem versão conhecida (progresso sem o "disponível" antes) não há o que anunciar.
      return estado.versao === null ? null
        : { tipo: 'disponivel', versao: estado.versao, notas: estado.notas, porcentagem: estado.porcentagem, manual: false };
    case 'pronta': return { tipo: 'pronta', versao: estado.versao, notas: estado.notas };
    // Uma procura automática sem rede não vira aviso: só a falha de um download ou de um pedido da pessoa.
    case 'indisponivel': return estado.versao !== null || estado.pedida ? { tipo: 'erro', versao: estado.versao, motivo: estado.motivo } : null;
    default: return null;
  }
}
