/**
 * Ciclo de vida das janelas por sistema (J154), sem Electron, para testar.
 *
 * No macOS fechar a última janela (botão vermelho, Cmd+W) não encerra o app: ele fica no Dock, com a
 * biblioteca, o banco e o processamento em segundo plano no ar, e clicar no Dock reabre a janela. Quem
 * encerra é Margem → Sair (Cmd+Q), que desliga tudo pelo mesmo caminho dos outros sistemas
 * (`before-quit` em main.ts). No Windows e no Linux fechar a janela continua encerrando o app.
 */

/** Fechar a última janela encerra o app? */
export function encerrarAoFecharTudo(sistema: NodeJS.Platform, situacao: { trocando: boolean; semJanela: boolean }): boolean {
  if (situacao.trocando) return false;
  if (sistema === 'darwin' && !situacao.semJanela) return false;
  return true;
}

/** O que fazer quando o app é reativado (Dock, abrir de novo, bandeja, notificação). */
export type Reabertura = 'nada' | 'trazer' | 'principal' | 'boas-vindas' | 'abrir-biblioteca';

export interface SituacaoDaReabertura {
  /** Há janela (principal ou de abertura) aberta. */
  temJanela: boolean;
  /** Endereço da biblioteca no ar, ou null. */
  url: string | null;
  /** O serviço está subindo (a janela principal abre sozinha quando ficar pronto). */
  ligando: boolean;
  /** Há biblioteca escolhida na configuração. */
  temBiblioteca: boolean;
  /** O app está encerrando. */
  saindo: boolean;
}

export function reabertura(s: SituacaoDaReabertura): Reabertura {
  if (s.saindo) return 'nada';
  if (s.temJanela) return 'trazer';
  if (s.url !== null) return 'principal';
  // Fecharam a janela de "abrindo…": a principal aparece quando o serviço ficar pronto.
  if (s.ligando) return 'nada';
  return s.temBiblioteca ? 'abrir-biblioteca' : 'boas-vindas';
}

/** O pedaço da janela do Electron que `fecharEAguardar` usa. */
export interface JanelaQueFecha {
  isDestroyed(): boolean;
  close(): void;
  once(evento: 'closed', ouvinte: () => void): unknown;
  removeListener(evento: 'closed', ouvinte: () => void): unknown;
}

/**
 * R2-8: fecha a janela e espera o fechamento de fato. A página pode segurar o fechamento (envio pendente em
 * Adicionar: "Continuar importando"); quem mostra essa pergunta chama a função guardada em `desistencias`
 * para a janela, e a promessa dá `false`: quem pediu o fechamento (cópia de segurança, trocar de
 * biblioteca) desiste em vez de parar o serviço com a janela ainda viva. Sem janela, `true`.
 */
export function fecharEAguardar(janela: JanelaQueFecha | null | undefined, desistencias: WeakMap<object, () => void>): Promise<boolean> {
  if (janela == null || janela.isDestroyed()) return Promise.resolve(true);
  return new Promise<boolean>((resolver) => {
    const fechou = (): void => { desistencias.delete(janela); resolver(true); };
    janela.once('closed', fechou);
    desistencias.set(janela, () => {
      janela.removeListener('closed', fechou);
      desistencias.delete(janela);
      resolver(false);
    });
    janela.close();
  });
}

/** Quem guarda o serviço da biblioteca (o estado do app em main.ts). */
export interface DonoDoServico<S> { servico: S | null }

/**
 * A abertura falhou e o serviço precisa parar (R-03). Só larga a referência se a parada concluir: com o
 * banco ainda aberto, Sair encontra o serviço, tenta parar de novo e, falhando, pergunta "Tentar novamente /
 * Sair sem atualizar" (L-05) em vez de instalar a atualização por cima do banco aberto.
 * Devolve se parou.
 */
export async function pararServicoQueFalhou<S extends { parar: () => Promise<void> }>(
  dono: DonoDoServico<S>, servico: S, registrar: (erro: unknown) => void,
): Promise<boolean> {
  try {
    await servico.parar();
  } catch (erro) {
    registrar(erro);
    return false;
  }
  if (dono.servico === servico) dono.servico = null;
  return true;
}

/**
 * Antes de abrir uma biblioteca: o serviço que ficou de uma abertura que não parou (R-03) para primeiro.
 * Se ainda não parar, lança: abrir outro por cima deixaria dois serviços na mesma máquina.
 */
export async function pararServicoQueFicou<S extends { parar: () => Promise<void> }>(dono: DonoDoServico<S>, registrar: (erro: unknown) => void): Promise<void> {
  const anterior = dono.servico;
  if (anterior === null) return;
  if (!(await pararServicoQueFalhou(dono, anterior, registrar))) {
    throw new Error('O banco da biblioteca anterior ainda não fechou. Feche e abra o Margem.');
  }
}
