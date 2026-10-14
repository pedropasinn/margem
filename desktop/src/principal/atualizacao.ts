/**
 * Atualização automática (electron-updater; `publish` em scripts/empacotar.mjs).
 * Desligada em desenvolvimento, com `MARGEM_SEM_ATUALIZACAO=1` (fumaça, CI) e na cópia empacotada sem
 * feed (`MARGEM_FEED_ATUALIZACAO` ausente no empacotamento; V-W6). Baixa em segundo plano e instala ao
 * fechar o app (`autoInstallOnAppQuit`), ou na hora se a pessoa pedir. As regras de registro, de espera
 * entre procuras e o estado mostrado ficam em `nucleo/atualizacao.ts`.
 *
 * Nada de caixa de diálogo (J146): o estado vai para a janela (Configurações → Sobre e atualizações, e
 * um aviso discreto quando a versão nova está pronta) por `aoMudar`.
 *
 * O macOS sem assinatura não se atualiza sozinho (o Squirrel.Mac exige app assinado e um .zip que o
 * release não tem): lá o app só procura e, havendo versão nova, manda baixar no site. O AppImage, o .deb
 * (pede a senha para instalar) e o instalador do Windows se atualizam.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import {
  criarControleDaAtualizacao, feedDoPacote, linhaDoRegistro, proximoEstado, INTERVALO_NORMAL_MS,
  type EstadoDaAtualizacao, type EventoDoAtualizador, type FeedDoPacote,
} from '../nucleo/atualizacao.js';
import type { Registro } from '../nucleo/registros.js';

export interface Atualizador {
  verificarAgora: (manual: boolean) => void;
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

export function configurarAtualizacao(opcoes: {
  empacotado: boolean; registro: Registro; aoMudar: (estado: EstadoDaAtualizacao) => void;
}): Atualizador {
  const feed = opcoes.empacotado ? feedDoApp() : null;
  const motivo = !opcoes.empacotado ? 'desenvolvimento'
    : process.env.MARGEM_SEM_ATUALIZACAO === '1' ? 'ambiente'
      : feed?.tipo === 'desligada' ? 'sem_feed' : null;
  if (motivo !== null) {
    opcoes.registro.evento('atualizacao_desligada', { motivo });
    const desligada: EstadoDaAtualizacao = { estado: 'desligada', motivo };
    return { verificarAgora: () => undefined, estado: () => desligada };
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
  let estado: EstadoDaAtualizacao = { estado: 'ociosa' };
  const mudar = (evento: EventoDoAtualizador): void => {
    const novo = proximoEstado(estado, evento);
    if (JSON.stringify(novo) === JSON.stringify(estado)) return;
    estado = novo;
    opcoes.aoMudar(estado);
  };
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const agendar = (ms: number): void => {
    if (relogio !== undefined) clearTimeout(relogio);
    relogio = setTimeout(verificar, ms);
    relogio.unref();
  };
  autoUpdater.on('update-not-available', () => {
    manual = false;
    mudar({ tipo: 'sem_novidade' });
    agendar(controle.aoTerminarBem());
  });
  autoUpdater.on('update-available', (info) => {
    manual = false;
    mudar({ tipo: 'disponivel', versao: info.version, baixa });
    agendar(controle.aoTerminarBem());
  });
  autoUpdater.on('download-progress', (progresso) => { mudar({ tipo: 'progresso', porcentagem: progresso.percent }); });
  autoUpdater.on('error', (erro: Error) => {
    // `manual` só muda o que o registro guarda; a tela mostra o motivo curto de qualquer jeito.
    const decisao = controle.aoFalhar(erro.message, manual);
    if (decisao.evento !== null) opcoes.registro.evento(decisao.evento.nome, decisao.evento.dados);
    manual = false;
    mudar({ tipo: 'falhou', mensagem: erro.message });
    agendar(decisao.proximaMs);
  });
  autoUpdater.on('update-downloaded', (info) => {
    manual = false;
    mudar({ tipo: 'baixada', versao: info.version });
    if (avisada === info.version) return;
    avisada = info.version;
    opcoes.registro.evento('atualizacao_baixada', { versao: info.version });
  });
  function verificar(): void {
    // A próxima procura já fica marcada; os eventos de desfecho a remarcam (24 h depois de falha).
    agendar(INTERVALO_NORMAL_MS);
    mudar({ tipo: 'procurar' });
    // A promessa também rejeita no erro; quem registra é o evento `error`.
    void autoUpdater.checkForUpdates().catch(() => undefined);
  }
  agendar(15_000);
  return {
    verificarAgora: (pedido) => {
      // Já baixada: nada a procurar até reiniciar. Baixando: a procura recomeçaria o download.
      if (estado.estado === 'pronta' || estado.estado === 'baixando') { opcoes.aoMudar(estado); return; }
      manual = pedido;
      verificar();
    },
    estado: () => estado,
  };
}

/** Sai e instala a atualização baixada (depois de o app desligar o serviço). */
export function instalarAtualizacaoAoSair(): void {
  electronUpdater.autoUpdater.quitAndInstall(false, true);
}
