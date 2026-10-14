/**
 * Regras da atualização automática, sem Electron (V-W6, auditoria B-05). O `principal/atualizacao.ts`
 * liga isto ao electron-updater e manda o estado para a janela (J146).
 *
 * No teste de 14/10 o repositório era privado: cada procura dava 404 em `releases.atom`, e o
 * `app.log` ganhava a pilha e todos os cabeçalhos da resposta (inclusive `set-cookie` do GitHub), duas
 * vezes por sessão. Agora:
 *   - sem feed configurado no empacotamento, a cópia sai com a atualização desligada (`feedDoPacote`);
 *   - "ainda não há versão" e "sem rede" viram um evento `atualizacao_indisponivel`, nível info, uma vez
 *     por execução, sem pilha nem cabeçalhos;
 *   - o registro do electron-updater só guarda a primeira linha de cada mensagem, redigida;
 *   - depois de uma falha, a próxima procura automática espera 24 h em vez de 6 h.
 */

/** O que o empacotamento gravou no package.json do app (`extraMetadata.margem.atualizacao`). */
export type FeedDoPacote = { tipo: 'desligada' } | { tipo: 'github' } | { tipo: 'generic'; url: string };

/**
 * Lê o feed do package.json do app empacotado. Cópias antigas (sem o campo) e `github` usam os releases
 * do GitHub; `desligada` (ou qualquer valor estranho) é a cópia gerada sem `MARGEM_FEED_ATUALIZACAO`.
 */
export function feedDoPacote(pacote: unknown): FeedDoPacote {
  const margem = typeof pacote === 'object' && pacote !== null && 'margem' in pacote ? pacote.margem : undefined;
  const bruto = typeof margem === 'object' && margem !== null && 'atualizacao' in margem ? margem.atualizacao : undefined;
  if (bruto === undefined || bruto === 'github') return { tipo: 'github' };
  if (typeof bruto === 'string' && /^https:\/\/\S+$/u.test(bruto)) return { tipo: 'generic', url: bruto };
  return { tipo: 'desligada' };
}

export type ClasseDoErro = 'sem_versao' | 'sem_rede' | 'outro';

/** Por que a procura falhou: ainda não há versão publicada, não há rede, ou outra coisa. */
export function classificarErroDeAtualizacao(mensagem: string): ClasseDoErro {
  if (/\b404\b|No published versions|Cannot find latest|latest(?:-mac|-linux)?\.yml|Unable to find latest version|releases\.atom/iu.test(mensagem)) return 'sem_versao';
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|net::ERR_|socket hang up|getaddrinfo/iu.test(mensagem)) return 'sem_rede';
  return 'outro';
}

/** Primeira linha não vazia, sem token nem cookie, com no máximo 200 caracteres. */
export function linhaDoRegistro(mensagem: unknown): string {
  const texto = mensagem instanceof Error ? mensagem.message : String(mensagem);
  const primeira = texto.split(/\r?\n/u).map((linha) => linha.trim()).find((linha) => linha !== '') ?? '';
  return primeira
    .replace(/\b(set-cookie|cookie|authorization)\s*:.*$/iu, '$1: [redigido]')
    .replace(/\b(?:Bearer|token)\s+\S+/giu, '[redigido]')
    .replace(/([?&](?:token|access_token|X-Amz-Signature|sig)=)[^&\s"]+/giu, '$1[redigido]')
    .slice(0, 200);
}

export const INTERVALO_NORMAL_MS = 6 * 60 * 60 * 1000;
export const INTERVALO_DEPOIS_DE_FALHA_MS = 24 * 60 * 60 * 1000;

export interface EventoDaAtualizacao {
  nome: 'atualizacao_indisponivel' | 'atualizacao_falhou';
  dados: Record<string, unknown>;
}

/** O que fazer com um erro da procura. */
export interface DecisaoDoErro {
  /** Evento para o registro; `null` quando o mesmo motivo já foi registrado nesta execução. */
  evento: EventoDaAtualizacao | null;
  /** Mensagem para a caixa de diálogo, só quando a pessoa pediu a procura. */
  aviso: string | null;
  /** Espera até a próxima procura automática. */
  proximaMs: number;
}

/** Estado de uma execução do app: registra cada motivo uma vez e alarga a espera depois de falha. */
export function criarControleDaAtualizacao(): {
  aoFalhar: (mensagem: string, manual: boolean) => DecisaoDoErro;
  aoTerminarBem: () => number;
} {
  const registrados = new Set<string>();
  return {
    aoFalhar: (mensagem, manual) => {
      const classe = classificarErroDeAtualizacao(mensagem);
      const linha = linhaDoRegistro(mensagem);
      const chave = classe === 'outro' ? `outro:${linha}` : classe;
      const nova = !registrados.has(chave);
      registrados.add(chave);
      const evento: EventoDaAtualizacao | null = !nova ? null
        : classe === 'outro' ? { nome: 'atualizacao_falhou', dados: { mensagem: linha } }
          : { nome: 'atualizacao_indisponivel', dados: { motivo: classe } };
      const aviso = !manual ? null
        : classe === 'sem_versao' ? 'Ainda não há versões publicadas do Margem para atualizar.'
          : classe === 'sem_rede' ? 'Sem conexão para procurar atualizações agora. Tente de novo mais tarde.'
            : 'Não foi possível procurar atualizações agora.';
      return { evento, aviso, proximaMs: INTERVALO_DEPOIS_DE_FALHA_MS };
    },
    aoTerminarBem: () => INTERVALO_NORMAL_MS,
  };
}

/** Frase curta do motivo de uma falha, para a tela de Configurações (sempre, pedida ou não). */
export function motivoCurto(mensagem: string): string {
  const classe = classificarErroDeAtualizacao(mensagem);
  return classe === 'sem_versao' ? 'Ainda não há versões publicadas.'
    : classe === 'sem_rede' ? 'Sem conexão com a internet.'
      : 'Não foi possível procurar agora.';
}

// ---------------------------------------------------------------- estado mostrado no app (J146)

/** Por que a atualização está desligada nesta cópia. */
export type MotivoDaAtualizacaoDesligada = 'desenvolvimento' | 'ambiente' | 'sem_feed';

/**
 * O que a seção "Sobre e atualizações" das Configurações mostra (e o aviso de "pronta"). Espelho em
 * `web/src/configuracoes/atualizacao.ts`.
 */
export type EstadoDaAtualizacao =
  | { estado: 'desligada'; motivo: MotivoDaAtualizacaoDesligada }
  | { estado: 'ociosa' }
  | { estado: 'procurando' }
  | { estado: 'atualizada'; quando: string }
  | { estado: 'baixando'; versao: string | null; porcentagem: number }
  | { estado: 'pronta'; versao: string }
  /** Há versão nova, mas este sistema não se atualiza sozinho (macOS sem assinatura): baixar no site. */
  | { estado: 'manual'; versao: string }
  | { estado: 'indisponivel'; motivo: string };

/** Versão instalada e estado, como a janela recebe. */
export interface SituacaoDaAtualizacao {
  versao: string;
  atualizacao: EstadoDaAtualizacao;
}

export type EventoDoAtualizador =
  | { tipo: 'procurar' }
  | { tipo: 'sem_novidade' }
  | { tipo: 'disponivel'; versao: string; baixa: boolean }
  | { tipo: 'progresso'; porcentagem: number }
  | { tipo: 'baixada'; versao: string }
  | { tipo: 'falhou'; mensagem: string };

/**
 * O próximo estado. Desligada não muda; "pronta" só dá lugar a outra versão pronta (a procura de 6 em 6 h
 * continua e não pode apagar o "Reiniciar e atualizar"); uma procura no meio do download não zera a barra.
 */
export function proximoEstado(atual: EstadoDaAtualizacao, evento: EventoDoAtualizador, agora: Date = new Date()): EstadoDaAtualizacao {
  if (atual.estado === 'desligada') return atual;
  if (atual.estado === 'pronta' && evento.tipo !== 'baixada') return atual;
  switch (evento.tipo) {
    case 'procurar': return atual.estado === 'baixando' ? atual : { estado: 'procurando' };
    case 'sem_novidade': return { estado: 'atualizada', quando: agora.toISOString() };
    case 'disponivel': return evento.baixa ? { estado: 'baixando', versao: evento.versao, porcentagem: 0 } : { estado: 'manual', versao: evento.versao };
    case 'progresso': {
      const porcentagem = Math.max(0, Math.min(100, Math.floor(Number.isFinite(evento.porcentagem) ? evento.porcentagem : 0)));
      return { estado: 'baixando', versao: atual.estado === 'baixando' ? atual.versao : null, porcentagem };
    }
    case 'baixada': return { estado: 'pronta', versao: evento.versao };
    case 'falhou': return { estado: 'indisponivel', motivo: motivoCurto(evento.mensagem) };
  }
}
