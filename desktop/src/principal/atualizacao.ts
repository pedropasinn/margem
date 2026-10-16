/**
 * Atualização automática (electron-updater; `publish` em scripts/empacotar.mjs).
 * Desligada em desenvolvimento, com `MARGEM_SEM_ATUALIZACAO=1` (fumaça, CI) e na cópia empacotada sem
 * feed (`MARGEM_FEED_ATUALIZACAO` ausente no empacotamento; V-W6). Baixa em segundo plano e instala ao
 * fechar o app (`autoInstallOnAppQuit`), ou na hora se a pessoa pedir. As regras de registro, de espera
 * entre procuras e o estado mostrado ficam em `nucleo/atualizacao.ts`.
 *
 * Nada de caixa de diálogo (J146): o estado vai para a janela (Configurações → Sobre e atualizações, e
 * o aviso de versão nova com "Atualizar agora" e "Depois", J151) por `aoMudar`. A procura começa logo ao
 * abrir (`PRIMEIRA_PROCURA_MS`) e se repete de 6 em 6 h. Quando a versão fica pronta com a janela fora de
 * foco, uma notificação do sistema avisa, uma vez por versão.
 *
 * O macOS sem assinatura não se atualiza sozinho (o Squirrel.Mac exige app assinado e um .zip que o
 * release não tem): lá o app só procura e, havendo versão nova, manda baixar no site. O AppImage, o .deb
 * (pede a senha para instalar) e o instalador do Windows se atualizam.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import {
  criarControleDaAtualizacao, criarMaquinaDaAtualizacao, feedDoPacote, linhaDoRegistro, notasDoRelease,
  INTERVALO_NORMAL_MS, PRIMEIRA_PROCURA_MS, type EstadoDaAtualizacao, type FeedDoPacote,
} from '../nucleo/atualizacao.js';
import type { Registro } from '../nucleo/registros.js';

export interface Atualizador {
  verificarAgora: (manual: boolean) => void;
  /** "Atualizar agora" do aviso (e "Tentar de novo"). */
  atualizarAgora: () => void;
  /** "Depois": não reinicia sozinho; instala ao fechar. */
  adiar: () => void;
  estado: () => EstadoDaAtualizacao;
}

/** O feed gravado no package.json do app; ilegível conta como desligada. */
function feedDoApp(): FeedDoPacote {
  try {
    return feedDoPacote(JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')));
  } catch {
    return { tipo: 'desligada' };
  }
}

/** A última versão avisada por notificação do sistema (`<userData>/atualizacao.json`), para não repetir. */
export function lerUltimaNotificada(arquivo: string): string | null {
  try {
    const dado: unknown = JSON.parse(readFileSync(arquivo, 'utf8'));
    return typeof dado === 'object' && dado !== null && 'notificada' in dado && typeof dado.notificada === 'string' ? dado.notificada : null;
  } catch {
    return null;
  }
}

export function gravarUltimaNotificada(arquivo: string, versao: string): void {
  try { writeFileSync(arquivo, `${JSON.stringify({ notificada: versao })}\n`); } catch { /* só perde o "não repetir" */ }
}

export function configurarAtualizacao(opcoes: {
  empacotado: boolean; registro: Registro; aoMudar: (estado: EstadoDaAtualizacao) => void;
  /** Fecha o Margem e instala (o serviço é desligado antes). */
  instalar: () => void;
  /** Abre a página de download no navegador. */
  abrirSite: () => void;
}): Atualizador {
  const feed = opcoes.empacotado ? feedDoApp() : null;
  const motivo = !opcoes.empacotado ? 'desenvolvimento'
    : process.env.MARGEM_SEM_ATUALIZACAO === '1' ? 'ambiente'
      : feed?.tipo === 'desligada' ? 'sem_feed' : null;
  if (motivo !== null) {
    opcoes.registro.evento('atualizacao_desligada', { motivo });
    const desligada: EstadoDaAtualizacao = { estado: 'desligada', motivo };
    return { verificarAgora: () => undefined, atualizarAgora: opcoes.abrirSite, adiar: () => undefined, estado: () => desligada };
  }
  const { autoUpdater } = electronUpdater;
  // macOS: só procurar (ver o cabeçalho).
  const baixa = process.platform !== 'darwin';
  autoUpdater.autoDownload = baixa;
  autoUpdater.autoInstallOnAppQuit = true;
  // Só a primeira linha: as mensagens do electron-updater trazem pilha e os cabeçalhos da resposta.
  autoUpdater.logger = {
    info: (m: unknown) => { opcoes.registro.escrever(`[atualizacao] ${linhaDoRegistro(m)}`); },
    warn: (m: unknown) => { opcoes.registro.escrever(`[atualizacao] aviso: ${linhaDoRegistro(m)}`); },
    // Os erros chegam também pelo evento `error`, que os registra uma vez e sem detalhes.
    error: () => undefined,
    debug: () => undefined,
  };
  const controle = criarControleDaAtualizacao();
  let manual = false;
  let avisada: string | null = null;
  const maquina = criarMaquinaDaAtualizacao({
    aoMudar: opcoes.aoMudar,
    acoes: {
      procurar: () => { manual = true; verificar(); },
      baixar: () => { void autoUpdater.downloadUpdate().catch(() => undefined); },
      instalar: () => {
        const atual = maquina.estado();
        opcoes.registro.evento('atualizacao_instalar_agora', { versao: atual.estado === 'pronta' ? atual.versao : null });
        opcoes.instalar();
      },
      abrirSite: opcoes.abrirSite,
    },
  });
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const agendar = (ms: number): void => {
    if (relogio !== undefined) clearTimeout(relogio);
    relogio = setTimeout(verificar, ms);
    relogio.unref();
  };
  autoUpdater.on('update-not-available', () => {
    manual = false;
    maquina.receber({ tipo: 'sem_novidade' });
    agendar(controle.aoTerminarBem());
  });
  autoUpdater.on('update-available', (info) => {
    manual = false;
    maquina.receber({ tipo: 'disponivel', versao: info.version, baixa, sozinho: autoUpdater.autoDownload, notas: notasDoRelease(info.releaseNotes) });
    agendar(controle.aoTerminarBem());
  });
  autoUpdater.on('download-progress', (progresso) => { maquina.receber({ tipo: 'progresso', porcentagem: progresso.percent }); });
  autoUpdater.on('error', (erro: Error) => {
    // `manual` só muda o que o registro guarda; a tela mostra o motivo curto de qualquer jeito.
    const decisao = controle.aoFalhar(erro.message, manual);
    if (decisao.evento !== null) opcoes.registro.evento(decisao.evento.nome, decisao.evento.dados);
    manual = false;
    maquina.receber({ tipo: 'falhou', mensagem: erro.message });
    agendar(decisao.proximaMs);
  });
  autoUpdater.on('update-downloaded', (info) => {
    manual = false;
    if (avisada !== info.version) {
      avisada = info.version;
      opcoes.registro.evento('atualizacao_baixada', { versao: info.version });
    }
    maquina.receber({ tipo: 'baixada', versao: info.version, notas: notasDoRelease(info.releaseNotes) });
  });
  function verificar(): void {
    // A próxima procura já fica marcada; os eventos de desfecho a remarcam (24 h depois de falha).
    agendar(INTERVALO_NORMAL_MS);
    maquina.receber({ tipo: 'procurar' });
    // A promessa também rejeita no erro; quem registra é o evento `error`.
    void autoUpdater.checkForUpdates().catch(() => undefined);
  }
  agendar(PRIMEIRA_PROCURA_MS);
  return {
    verificarAgora: (pedido) => {
      const atual = maquina.estado();
      // Já baixada: nada a procurar até reiniciar. Baixando: a procura recomeçaria o download.
      if (atual.estado === 'pronta' || atual.estado === 'baixando') { opcoes.aoMudar(atual); return; }
      manual = pedido;
      verificar();
    },
    atualizarAgora: maquina.atualizarAgora,
    adiar: maquina.adiar,
    estado: maquina.estado,
  };
}

/** Sai e instala a atualização baixada (depois de o app desligar o serviço). */
export function instalarAtualizacaoAoSair(): void {
  electronUpdater.autoUpdater.quitAndInstall(false, true);
}

/**
 * O banco não fechou (L-05): esta saída não instala nada. Sem isso o `autoInstallOnAppQuit` instalaria a
 * versão baixada por cima de arquivos em uso; a próxima saída limpa instala.
 */
export function naoInstalarNestaSaida(): void {
  electronUpdater.autoUpdater.autoInstallOnAppQuit = false;
}
