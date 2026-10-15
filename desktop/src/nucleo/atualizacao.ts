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


/**
 * Frase curta do motivo de uma falha, para a tela de Configurações e o aviso (sempre, pedida ou não).
 * `noDownload`: a falha foi ao baixar uma versão já encontrada, não ao procurar.
 */
export function motivoCurto(mensagem: string, noDownload = false): string {
  const classe = classificarErroDeAtualizacao(mensagem);
  if (classe === 'sem_rede') return 'Sem conexão com a internet.';
  if (noDownload) return 'Não foi possível baixar a versão nova.';
  return classe === 'sem_versao' ? 'Ainda não há versões publicadas.' : 'Não foi possível procurar agora.';
}

/**
 * Uma linha do que mudou, tirada das notas do release (`releaseNotes` do electron-updater: texto, HTML ou
 * uma lista por versão). Os `latest*.yml` de hoje não trazem notas; aí é `null` e o aviso só leva o link
 * "O que mudou".
 */
export function notasDoRelease(bruto: unknown): string | null {
  const texto = typeof bruto === 'string' ? bruto
    : Array.isArray(bruto) ? bruto.map((item: unknown) => (typeof item === 'object' && item !== null && 'note' in item && typeof item.note === 'string' ? item.note : '')).join('\n')
      : '';
  const linhas = texto
    .replace(/<\/(?:p|li|h\d|div)>|<br\s*\/?>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
    .replace(/&nbsp;/gu, ' ').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'")
    .split(/\r?\n/u)
    .map((linha) => linha.replace(/^\s*(?:#+|[-*•]|\d+[.)])\s*/u, '').replace(/[*_`]/gu, '').trim())
    .filter((linha) => linha !== '');
  const primeira = linhas[0];
  if (primeira === undefined) return null;
  return primeira.length > 140 ? `${primeira.slice(0, 139).trimEnd()}…` : primeira;
}

// ---------------------------------------------------------------- estado mostrado no app (J146, J151)

/** Por que a atualização está desligada nesta cópia. */
export type MotivoDaAtualizacaoDesligada = 'desenvolvimento' | 'ambiente' | 'sem_feed';

/**
 * O que a seção "Sobre e atualizações" das Configurações e o aviso de versão nova mostram. Espelho em
 * `web/src/atualizacao/ponte.ts`.
 *
 * `pedida`: a pessoa clicou em "Atualizar agora" e o Margem reinicia sozinho quando o download terminar.
 */
export type EstadoDaAtualizacao =
  | { estado: 'desligada'; motivo: MotivoDaAtualizacaoDesligada }
  | { estado: 'ociosa' }
  | { estado: 'procurando' }
  | { estado: 'atualizada'; quando: string }
  /** Há versão nova e o download ainda não começou (só quando o download automático está desligado). */
  | { estado: 'disponivel'; versao: string; notas: string | null }
  | { estado: 'baixando'; versao: string | null; porcentagem: number; notas: string | null; pedida: boolean }
  | { estado: 'pronta'; versao: string; notas: string | null }
  /** Há versão nova, mas este sistema não se atualiza sozinho (macOS sem assinatura): baixar no site. */
  | { estado: 'manual'; versao: string; notas: string | null }
  /** `versao`: a versão que não deu para baixar (null quando a falha foi na procura). */
  | { estado: 'indisponivel'; motivo: string; versao: string | null; pedida: boolean };

/** Versão instalada e estado, como a janela recebe. */
export interface SituacaoDaAtualizacao {
  versao: string;
  atualizacao: EstadoDaAtualizacao;
}

export type EventoDoAtualizador =
  | { tipo: 'procurar' }
  | { tipo: 'sem_novidade' }
  /** `baixa`: este sistema se atualiza; `sozinho`: o download começa sem pedir (autoDownload, padrão). */
  | { tipo: 'disponivel'; versao: string; baixa: boolean; sozinho?: boolean; notas?: string | null }
  | { tipo: 'comecar_download' }
  | { tipo: 'progresso'; porcentagem: number }
  | { tipo: 'baixada'; versao: string; notas?: string | null }
  | { tipo: 'falhou'; mensagem: string };

function notasDe(estado: EstadoDaAtualizacao): string | null {
  return 'notas' in estado ? estado.notas : null;
}

/**
 * O próximo estado. Desligada não muda; "pronta" só dá lugar a outra versão pronta (a procura de 6 em 6 h
 * continua e não pode apagar o "Reiniciar e atualizar"); uma procura no meio do download não zera a barra.
 * `pedida` sai sempre falsa daqui: quem a liga é a máquina (`criarMaquinaDaAtualizacao`).
 */
export function proximoEstado(atual: EstadoDaAtualizacao, evento: EventoDoAtualizador, agora: Date = new Date()): EstadoDaAtualizacao {
  if (atual.estado === 'desligada') return atual;
  if (atual.estado === 'pronta' && evento.tipo !== 'baixada') return atual;
  switch (evento.tipo) {
    case 'procurar': return atual.estado === 'baixando' ? atual : { estado: 'procurando' };
    case 'sem_novidade': return { estado: 'atualizada', quando: agora.toISOString() };
    case 'disponivel': {
      const notas = evento.notas ?? null;
      if (!evento.baixa) return { estado: 'manual', versao: evento.versao, notas };
      return evento.sozinho === false ? { estado: 'disponivel', versao: evento.versao, notas }
        : { estado: 'baixando', versao: evento.versao, porcentagem: 0, notas, pedida: false };
    }
    case 'comecar_download':
      return atual.estado === 'disponivel' ? { estado: 'baixando', versao: atual.versao, porcentagem: 0, notas: atual.notas, pedida: false } : atual;
    case 'progresso': {
      const porcentagem = Math.max(0, Math.min(100, Math.floor(Number.isFinite(evento.porcentagem) ? evento.porcentagem : 0)));
      const versao = atual.estado === 'baixando' || atual.estado === 'disponivel' ? atual.versao : null;
      return { estado: 'baixando', versao, porcentagem, notas: notasDe(atual), pedida: false };
    }
    case 'baixada': return { estado: 'pronta', versao: evento.versao, notas: evento.notas ?? notasDe(atual) };
    case 'falhou': {
      const versao = atual.estado === 'baixando' || atual.estado === 'disponivel' ? atual.versao : null;
      return { estado: 'indisponivel', motivo: motivoCurto(evento.mensagem, atual.estado === 'baixando'), versao, pedida: false };
    }
  }
}

/** O que a máquina manda o electron-updater (ou o sistema) fazer. */
export interface AcoesDaAtualizacao {
  /** Procura agora (pedida pela pessoa). */
  procurar: () => void;
  /** Começa o download de uma versão já encontrada (`autoUpdater.downloadUpdate`). */
  baixar: () => void;
  /** Fecha o Margem e instala a versão baixada. */
  instalar: () => void;
  /** Abre a página de download no navegador (macOS sem assinatura, cópia sem atualização). */
  abrirSite: () => void;
}

export interface MaquinaDaAtualizacao {
  estado: () => EstadoDaAtualizacao;
  receber: (evento: EventoDoAtualizador) => void;
  /** "Atualizar agora" (e "Tentar de novo"): instala, espera o download terminar, começa ou procura. */
  atualizarAgora: () => void;
  /** "Depois": não reinicia sozinho; a versão é instalada quando a pessoa fechar o Margem. */
  adiar: () => void;
}

/**
 * Estado + o pedido da pessoa (J151). "Atualizar agora":
 *   - pronta: instala e reinicia;
 *   - baixando: marca o pedido, o aviso mostra a porcentagem e o Margem reinicia ao terminar;
 *   - disponível (download não começou): começa o download, com o pedido marcado;
 *   - manual (macOS sem assinatura) ou desligada: abre o site;
 *   - falhou, atualizada, ociosa: procura de novo, com o pedido marcado.
 * O pedido cai com "Depois", com "sem novidade" e com uma falha (uma procura automática horas depois não
 * pode reiniciar o app no meio da leitura).
 */
export function criarMaquinaDaAtualizacao(opcoes: {
  acoes: AcoesDaAtualizacao;
  aoMudar: (estado: EstadoDaAtualizacao) => void;
  inicial?: EstadoDaAtualizacao;
  agora?: () => Date;
}): MaquinaDaAtualizacao {
  let estado: EstadoDaAtualizacao = opcoes.inicial ?? { estado: 'ociosa' };
  let pedida = false;
  const comPedido = (novo: EstadoDaAtualizacao): EstadoDaAtualizacao =>
    novo.estado === 'baixando' || novo.estado === 'indisponivel' ? { ...novo, pedida } : novo;
  const definir = (novo: EstadoDaAtualizacao): void => {
    const final = comPedido(novo);
    if (JSON.stringify(final) === JSON.stringify(estado)) return;
    estado = final;
    opcoes.aoMudar(estado);
  };
  const receber = (evento: EventoDoAtualizador): void => {
    const novo = proximoEstado(estado, evento, opcoes.agora?.() ?? new Date());
    if (evento.tipo === 'falhou') {
      // A falha mostra se a pessoa tinha pedido (o aviso diz "Tentar de novo"), e o pedido cai.
      definir(novo);
      pedida = false;
      return;
    }
    if (evento.tipo === 'sem_novidade') pedida = false;
    if (novo.estado === 'manual' && pedida) {
      pedida = false;
      definir(novo);
      opcoes.acoes.abrirSite();
      return;
    }
    if (novo.estado === 'pronta' && evento.tipo === 'baixada' && pedida) {
      pedida = false;
      definir(novo);
      opcoes.acoes.instalar();
      return;
    }
    definir(novo);
  };
  return {
    estado: () => estado,
    receber,
    atualizarAgora: () => {
      switch (estado.estado) {
        case 'pronta': pedida = false; opcoes.acoes.instalar(); return;
        case 'baixando': pedida = true; definir(estado); return;
        case 'disponivel': pedida = true; receber({ tipo: 'comecar_download' }); opcoes.acoes.baixar(); return;
        case 'manual': case 'desligada': opcoes.acoes.abrirSite(); return;
        case 'procurando': pedida = true; return;
        case 'ociosa': case 'atualizada': case 'indisponivel': pedida = true; opcoes.acoes.procurar(); return;
      }
    },
    adiar: () => { pedida = false; definir(estado); },
  };
}

/**
 * Notificação do sistema (J151): só quando a versão ficou pronta, a janela não está em foco e esta versão
 * ainda não foi notificada (nem nesta execução, nem numa anterior).
 */
export function deveNotificar(estado: EstadoDaAtualizacao, ultimaNotificada: string | null, janelaEmFoco: boolean): estado is Extract<EstadoDaAtualizacao, { estado: 'pronta' }> {
  return estado.estado === 'pronta' && !janelaEmFoco && ultimaNotificada !== estado.versao;
}

/** Espera até a primeira procura depois de abrir: logo, mas sem disputar o início do serviço. */
export const PRIMEIRA_PROCURA_MS = 3_000;
