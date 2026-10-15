/**
 * Processo principal do app de computador do Margem (J113).
 *
 * Abre como o Obsidian: na primeira vez, a janela de boas-vindas (pasta da biblioteca → ChatGPT →
 * abrir); depois, direto na biblioteca. O serviço inteiro (Postgres embutido, API e worker) roda dentro
 * do app e é desligado quando a janela fecha. Instância única: abrir de novo só traz a janela à frente.
 *
 *   --biblioteca=<pasta>   usa esta pasta (sem a janela de boas-vindas)
 *   --sem-janela           só o serviço, sem janela (teste de fumaça); eventos JSON na saída padrão
 *   MARGEM_DESKTOP_DADOS_APP=<pasta>   troca o userData (testes)
 *   MARGEM_DESKTOP_ARQUIVO_PARADA=<arquivo>   com --sem-janela, sai quando o arquivo aparece (fumaça no Windows)
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, session, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CANAIS, type AvaliacaoDaPasta, type ResultadoDaConclusao } from '../boas-vindas/contrato.js';
import { estadoDoLogin, iniciarLogin, type LoginEmAndamento } from '../nucleo/codex.js';
import {
  gravarConfiguracao, lerConfiguracao, pastasDaBiblioteca, pastasDoApp, prepararPastasDoApp,
  type ConfiguracaoDoApp, type PastasDoApp,
} from '../nucleo/configuracao.js';
import { enderecoDeAdicionar, enderecoDasAtualizacoes, type AbaDeAdicionar } from '../nucleo/importar.js';
import { exportarParaOCofre, resumoDaExportacao } from '../nucleo/obsidian.js';
import { plataformaAtual } from '../nucleo/plataforma.js';
import { localDosRecursos, resolverRecursos, resumoDosRecursos, type RecursosResolvidos } from '../nucleo/recursos.js';
import { Registro } from '../nucleo/registros.js';
import { ServicoDoMargem } from '../nucleo/servico.js';
import { lerArgumentos, linkExterno, mesmaOrigem } from './argumentos.js';
import { deveNotificar, type EstadoDaAtualizacao, type SituacaoDaAtualizacao } from '../nucleo/atualizacao.js';
import {
  configurarAtualizacao, gravarUltimaNotificada, instalarAtualizacaoAoSair, lerUltimaNotificada, type Atualizador,
} from './atualizacao.js';
import { LINK_DA_DOCUMENTACAO, montarMenu } from './menu.js';
import {
  ALTURA_DO_TITULO, POSICAO_DO_MENU, coresPadrao, molduraDaPagina, opcoesDaMoldura, posicaoDosSemaforos, proximoEstadoDoAlt,
  type CoresDaMoldura, type MolduraDaPagina,
} from './moldura.js';
import { CANAIS_DA_BIBLIOTECA, type ResultadoDaExportacaoNaJanela } from './ponte.js';

const argumentos = lerArgumentos(process.argv.slice(1));
const dadosDoAppForcados = process.env.MARGEM_DESKTOP_DADOS_APP?.trim();
if (dadosDoAppForcados) app.setPath('userData', resolve(dadosDoAppForcados));
if (argumentos.semJanela) app.disableHardwareAcceleration();

interface Estado {
  pastas: PastasDoApp;
  configuracao: ConfiguracaoDoApp;
  registro: Registro;
  recursos: RecursosResolvidos;
  raizApp: string;
  servico: ServicoDoMargem | null;
  url: string | null;
  principal: BrowserWindow | null;
  abertura: BrowserWindow | null;
  bandeja: Tray | null;
  login: LoginEmAndamento | null;
  atualizador: Atualizador | null;
  /** Fechar janelas agora não encerra o app (troca de biblioteca, abertura → principal). */
  trocando: boolean;
  saindo: boolean;
  desligado: boolean;
  instalarAoSair: boolean;
}

let estado: Estado | null = null;

/** Saída para o teste de fumaça (`--sem-janela`): uma linha JSON por evento. */
function emitir(evento: string, detalhe: Record<string, unknown> = {}): void {
  if (argumentos.semJanela) process.stdout.write(`${JSON.stringify({ evento, ...detalhe })}\n`);
}

const pastaDoDesktop = app.getAppPath();
const DIST = join(pastaDoDesktop, 'dist');

const ICONES = join(DIST, 'boas-vindas', 'icones');

/** Ícone da janela (Linux e Windows; o macOS usa o do .app). */
function icone(): Electron.NativeImage {
  return nativeImage.createFromPath(join(ICONES, 'icone-512.png'));
}

/** Bandeja: no macOS, a imagem "Template" monocromática (o sistema pinta conforme a barra; o @2x vem junto); nos outros, o ícone pequeno colorido. */
function iconeDaBandeja(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const modelo = nativeImage.createFromPath(join(ICONES, 'bandejaTemplate.png'));
    modelo.setTemplateImage(true);
    return modelo;
  }
  return nativeImage.createFromPath(join(ICONES, 'bandeja-32.png')).resize({ width: 22, height: 22 });
}

function corDeFundo(janela: 'principal' | 'abertura' = 'principal'): string {
  return coresPadrao(nativeTheme.shouldUseDarkColors, janela).fundo;
}

// ---------------------------------------------------------------- moldura (V-U5)

/** O que a página da biblioteca mandou (o tema do app pode não ser o do sistema): ganha do padrão. */
const moldurasDasPaginas = new WeakMap<BrowserWindow, MolduraDaPagina>();

function tipoDaJanela(janela: BrowserWindow): 'principal' | 'abertura' {
  return estado?.abertura === janela ? 'abertura' : 'principal';
}

/** Pinta os botões nativos sobrepostos (Windows e Linux); no macOS só centra os semáforos na altura. */
function pintarMoldura(janela: BrowserWindow, cores: CoresDaMoldura, altura = ALTURA_DO_TITULO): void {
  if (janela.isDestroyed()) return;
  if (process.platform === 'darwin') { janela.setWindowButtonPosition(posicaoDosSemaforos(altura)); return; }
  janela.setTitleBarOverlay({ color: cores.fundo, symbolColor: cores.simbolo, height: altura });
}

/** O tema do sistema mudou: as janelas que ainda não têm as cores da página seguem o sistema. */
function acompanharTemaDoSistema(): void {
  nativeTheme.on('updated', () => {
    for (const janela of BrowserWindow.getAllWindows()) {
      if (moldurasDasPaginas.has(janela)) continue;
      const cores = coresPadrao(nativeTheme.shouldUseDarkColors, tipoDaJanela(janela));
      janela.setBackgroundColor(cores.fundo);
      pintarMoldura(janela, cores);
    }
  });
}

function abrirMenuDaJanela(janela: BrowserWindow): void {
  if (process.platform === 'darwin' || janela.isDestroyed()) return;
  Menu.getApplicationMenu()?.popup({ window: janela, ...(moldurasDasPaginas.get(janela)?.menu ?? POSICAO_DO_MENU) });
}

/** Sem a faixa do menu: Alt sozinho abre o menu como pop-up (Windows e Linux). */
function menuPeloAlt(janela: BrowserWindow): void {
  if (process.platform === 'darwin') return;
  janela.setMenuBarVisibility(false);
  let armado = false;
  janela.webContents.on('before-input-event', (_evento, entrada) => {
    const proximo = proximoEstadoDoAlt(armado, entrada);
    armado = proximo.armado;
    if (proximo.abrir) abrirMenuDaJanela(janela);
  });
  janela.on('blur', () => { armado = false; });
}

function janelaAtual(): BrowserWindow | null {
  return estado?.principal ?? estado?.abertura ?? null;
}

function trazerParaFrente(): void {
  const janela = janelaAtual();
  if (janela === null) return;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
}

async function abrirFora(url: string): Promise<void> {
  if (linkExterno(url)) await shell.openExternal(url);
}

// ---------------------------------------------------------------- janelas

function abrirJanelaDeAbertura(modo: 'boas-vindas' | 'carregando'): BrowserWindow {
  const janela = new BrowserWindow({
    width: 720, height: 640, minWidth: 420, minHeight: 520, show: false, title: 'Margem',
    backgroundColor: corDeFundo('abertura'), icon: icone(),
    ...opcoesDaMoldura(process.platform, coresPadrao(nativeTheme.shouldUseDarkColors, 'abertura')),
    webPreferences: { preload: join(DIST, 'boas-vindas', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  janela.removeMenu();
  janela.once('ready-to-show', () => { janela.show(); });
  janela.webContents.setWindowOpenHandler(({ url }) => { void abrirFora(url); return { action: 'deny' }; });
  janela.webContents.on('will-navigate', (evento) => { evento.preventDefault(); });
  void janela.loadFile(join(DIST, 'boas-vindas', 'index.html'), { query: { modo } });
  janela.on('closed', () => { if (estado?.abertura === janela) estado.abertura = null; });
  if (estado !== null) estado.abertura = janela;
  return janela;
}

function abrirJanelaPrincipal(url: string): BrowserWindow {
  const janela = new BrowserWindow({
    width: 1320, height: 900, minWidth: 720, minHeight: 520, show: false, title: 'Margem',
    backgroundColor: corDeFundo(), icon: icone(),
    ...opcoesDaMoldura(process.platform, coresPadrao(nativeTheme.shouldUseDarkColors)),
    webPreferences: {
      preload: join(DIST, 'principal', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true,
    },
  });
  menuPeloAlt(janela);
  janela.once('ready-to-show', () => { janela.show(); });
  // Links da própria biblioteca abrem no app; o resto vai para o navegador do sistema.
  janela.webContents.setWindowOpenHandler(({ url: destino }) => {
    if (mesmaOrigem(destino, url)) return { action: 'allow' };
    void abrirFora(destino);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (evento, destino) => {
    if (mesmaOrigem(destino, url)) return;
    evento.preventDefault();
    void abrirFora(destino);
  });
  void janela.loadURL(url);
  janela.on('closed', () => { if (estado?.principal === janela) estado.principal = null; });
  if (estado !== null) estado.principal = janela;
  return janela;
}

function configurarPermissoes(): void {
  const permitidas = new Set(['clipboard-sanitized-write', 'fullscreen', 'notifications']);
  session.defaultSession.setPermissionRequestHandler((_conteudo, permissao, responder) => { responder(permitidas.has(permissao)); });
}

function alternarBandeja(ligada: boolean): void {
  if (estado === null) return;
  estado.configuracao.bandeja = ligada;
  void gravarConfiguracao(estado.pastas.configuracao, estado.configuracao);
  if (!ligada) { estado.bandeja?.destroy(); estado.bandeja = null; return; }
  if (estado.bandeja !== null) return;
  const bandeja = new Tray(iconeDaBandeja());
  bandeja.setToolTip('Margem');
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o Margem', click: trazerParaFrente },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.quit(); } },
  ]));
  bandeja.on('click', trazerParaFrente);
  estado.bandeja = bandeja;
}

function instalarMenu(): void {
  if (estado === null || argumentos.semJanela) return;
  Menu.setApplicationMenu(montarMenu({
    adicionar,
    exportarParaObsidian: () => { void exportarParaObsidian(null, true); },
    abrirPastaDaBiblioteca: () => { if (estado?.configuracao.biblioteca) void shell.openPath(estado.configuracao.biblioteca); },
    trocarBiblioteca: () => { void trocarBiblioteca(); },
    documentacao: () => { void abrirFora(LINK_DA_DOCUMENTACAO); },
    registros: () => { if (estado) void shell.openPath(estado.pastas.registros); },
    sobre: mostrarSobre,
    verificarAtualizacoes: procurarAtualizacoesPeloMenu,
    alternarBandeja,
    bandejaLigada: estado.configuracao.bandeja,
    desenvolvimento: !app.isPackaged,
  }));
}

function mostrarSobre(): void {
  const caixa = {
    type: 'info' as const,
    message: `Margem ${app.getVersion()}`,
    detail: [
      'Leitor de textos marcados.',
      `Biblioteca: ${estado?.configuracao.biblioteca ?? 'nenhuma'}`,
      `Electron ${process.versions.electron} · Node ${process.versions.node}`,
      'Licença AGPL-3.0.',
    ].join('\n'),
  };
  const janela = janelaAtual();
  void (janela === null ? dialog.showMessageBox(caixa) : dialog.showMessageBox(janela, caixa));
}

// ---------------------------------------------------------------- serviço

function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Falha desconhecida ao abrir a biblioteca.';
}

/** Sobe o serviço na biblioteca configurada. Devolve a URL, ou lança (com o serviço já desligado). */
async function ligarServico(aoProgresso: (etapa: string) => void): Promise<string> {
  if (estado === null) throw new Error('App não iniciado.');
  const biblioteca = estado.configuracao.biblioteca;
  if (biblioteca === null) throw new Error('Nenhuma biblioteca escolhida.');
  const atual = estado;
  const servico = new ServicoDoMargem({
    recursos: atual.recursos, raizApp: atual.raizApp, pastasDoApp: atual.pastas, biblioteca,
    configuracao: atual.configuracao, registro: atual.registro, aoProgresso,
    aoCair: (processo) => { void avisarQueda(processo); },
    ...(argumentos.semJanela ? { eco: (linha: string) => { process.stderr.write(`${linha}\n`); } } : {}),
  });
  atual.servico = servico;
  try {
    const noAr = await servico.iniciar();
    atual.configuracao.portaDaApi = noAr.portaDaApi;
    atual.configuracao.portaDoBanco = noAr.portaDoBanco;
    await gravarConfiguracao(atual.pastas.configuracao, atual.configuracao);
    atual.url = noAr.url;
    emitir('margem_pronta', {
      url: noAr.url, porta_api: noAr.portaDaApi, porta_banco: noAr.portaDoBanco, banco: noAr.banco,
      pids: servico.pids, biblioteca: servico.biblioteca.biblioteca,
    });
    return noAr.url;
  } catch (erro) {
    atual.registro.evento('servico_falhou', { mensagem: mensagemDoErro(erro), codigo: (erro as { codigo?: string }).codigo ?? null });
    await servico.parar().catch(() => undefined);
    atual.servico = null;
    throw erro;
  }
}

async function desligarServico(): Promise<void> {
  if (estado?.servico) {
    const servico = estado.servico;
    await servico.parar();
    estado.servico = null;
    estado.url = null;
  }
}

async function avisarQueda(processo: 'api' | 'worker'): Promise<void> {
  emitir('margem_processo_desistiu', { processo });
  if (argumentos.semJanela || estado === null) return;
  const nome = processo === 'api' ? 'A biblioteca' : 'O processamento em segundo plano';
  const { response } = await dialog.showMessageBox({
    type: 'error', buttons: ['Abrir registros', 'Fechar'], defaultId: 0,
    message: `${nome} parou de funcionar e não voltou.`,
    detail: 'Feche e abra o Margem. Se continuar, os registros ajudam a entender o que houve.',
  });
  if (response === 0) void shell.openPath(estado.pastas.registros);
}

/** Abre a biblioteca configurada: janela de "abrindo…", serviço, janela principal. */
async function abrirBiblioteca(): Promise<void> {
  if (estado === null) return;
  if (argumentos.semJanela) {
    try {
      await ligarServico((etapa) => { emitir('margem_etapa', { etapa }); });
    } catch (erro) {
      emitir('margem_falhou', { mensagem: mensagemDoErro(erro), codigo: (erro as { codigo?: string }).codigo ?? null });
      process.exitCode = 1;
      app.quit();
    }
    return;
  }
  const biblioteca = estado.configuracao.biblioteca;
  if (biblioteca !== null && !existsSync(biblioteca)) {
    const { response } = await dialog.showMessageBox({
      type: 'warning', buttons: ['Escolher outra pasta', 'Criar de novo', 'Sair'], defaultId: 0, cancelId: 2,
      message: 'A pasta da biblioteca não foi encontrada.',
      detail: `${biblioteca}\n\nSe ela estava num disco externo, conecte-o e abra o Margem de novo.`,
    });
    if (response === 0) { abrirJanelaDeAbertura('boas-vindas'); return; }
    if (response === 2) { app.quit(); return; }
  }
  const abertura = estado.abertura ?? abrirJanelaDeAbertura('carregando');
  try {
    const url = await ligarServico((etapa) => { if (!abertura.isDestroyed()) abertura.webContents.send(CANAIS.progresso, etapa); });
    estado.trocando = true;
    abrirJanelaPrincipal(url);
    if (!abertura.isDestroyed()) abertura.close();
    estado.trocando = false;
  } catch (erro) {
    const { response } = await dialog.showMessageBox({
      type: 'error', buttons: ['Escolher outra pasta', 'Abrir registros', 'Sair'], defaultId: 0, cancelId: 2,
      message: 'Não foi possível abrir a biblioteca.', detail: mensagemDoErro(erro),
    });
    if (response === 1) void shell.openPath(estado.pastas.registros);
    if (response === 0) {
      estado.trocando = true;
      if (!abertura.isDestroyed()) abertura.close();
      abrirJanelaDeAbertura('boas-vindas');
      estado.trocando = false;
      return;
    }
    app.quit();
  }
}

async function trocarBiblioteca(): Promise<void> {
  if (estado === null) return;
  const janela = janelaAtual();
  const opcoes = {
    title: 'Escolher a pasta da biblioteca', buttonLabel: 'Usar esta pasta',
    defaultPath: estado.configuracao.biblioteca ?? app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'] as ('openDirectory' | 'createDirectory' | 'promptToCreate')[],
  };
  const escolha = janela === null ? await dialog.showOpenDialog(opcoes) : await dialog.showOpenDialog(janela, opcoes);
  const pasta = escolha.filePaths[0];
  if (escolha.canceled || pasta === undefined || resolve(pasta) === estado.configuracao.biblioteca) return;
  estado.trocando = true;
  const abertura = abrirJanelaDeAbertura('carregando');
  estado.principal?.close();
  await desligarServico();
  estado.configuracao.biblioteca = resolve(pasta);
  estado.configuracao.portaDoBanco = null;
  await gravarConfiguracao(estado.pastas.configuracao, estado.configuracao);
  estado.trocando = false;
  estado.abertura = abertura;
  await abrirBiblioteca();
}

// ---------------------------------------------------------------- atualização (J146)

const LINK_DO_DOWNLOAD = 'https://margem.dev/download/';
const LINK_DAS_NOVIDADES = 'https://margem.dev/novidades/';

function situacaoDaAtualizacao(): SituacaoDaAtualizacao {
  return { versao: app.getVersion(), atualizacao: estado?.atualizador?.estado() ?? { estado: 'ociosa' } };
}

/** A última versão avisada pela notificação do sistema (lida do disco na primeira vez). */
let ultimaNotificada: string | null | undefined;

/**
 * Notificação do sistema quando a versão nova fica pronta com a janela fora de foco (J151), uma vez por
 * versão (lembrada entre execuções). Clicar traz a janela, onde o aviso tem "Atualizar agora".
 */
function notificarSeFora(atualizacao: EstadoDaAtualizacao): void {
  if (estado === null || !Notification.isSupported()) return;
  const arquivo = join(estado.pastas.dadosDoApp, 'atualizacao.json');
  if (ultimaNotificada === undefined) ultimaNotificada = lerUltimaNotificada(arquivo);
  const janela = estado.principal;
  const emFoco = janela != null && !janela.isDestroyed() && janela.isFocused();
  if (!deveNotificar(atualizacao, ultimaNotificada, emFoco)) return;
  ultimaNotificada = atualizacao.versao;
  gravarUltimaNotificada(arquivo, atualizacao.versao);
  const notificacao = new Notification({
    title: `Margem ${atualizacao.versao} pronto para instalar`,
    body: 'Abra o Margem e clique em "Atualizar agora", ou a versão nova é instalada quando você fechar o app.',
    icon: icone(),
  });
  notificacao.on('click', trazerParaFrente);
  notificacao.show();
}

/** O estado mudou: a janela da biblioteca mostra (Configurações e o aviso de versão nova). */
function avisarAtualizacao(atualizacao: EstadoDaAtualizacao): void {
  notificarSeFora(atualizacao);
  const janela = estado?.principal;
  if (janela == null || janela.isDestroyed()) return;
  janela.webContents.send(CANAIS_DA_BIBLIOTECA.atualizacaoMudou, situacaoDaAtualizacao());
}

/** Fecha o Margem (desligando o serviço) e instala a versão baixada. */
function reiniciarParaAtualizar(): void {
  if (estado === null || estado.atualizador?.estado().estado !== 'pronta') return;
  estado.instalarAoSair = true;
  app.quit();
}

/** Menu → Procurar atualizações…: abre Configurações na seção e procura (a resposta aparece lá). */
function procurarAtualizacoesPeloMenu(): void {
  if (estado?.url != null && estado.principal !== null) {
    void estado.principal.loadURL(enderecoDasAtualizacoes(estado.url));
    trazerParaFrente();
  }
  estado?.atualizador?.verificarAgora(true);
}

/** Arquivo → Adicionar…: a tela Adicionar da biblioteca, na aba do tipo (V-D5). */
function adicionar(aba: AbaDeAdicionar): void {
  if (estado?.url == null || estado.principal === null) return;
  void estado.principal.loadURL(enderecoDeAdicionar(estado.url, aba));
  trazerParaFrente();
}

// ---------------------------------------------------------------- Obsidian

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * "Exportar para o Obsidian…": escolher a pasta do cofre (a última fica lembrada) e gravar nela as notas
 * do Margem, com a mesma mescla do plugin. `documentoId` restringe a um documento (o botão da página
 * dele); `avisar` mostra o resultado numa caixa (pelo menu; a página mostra o dela).
 */
async function exportarParaObsidian(documentoId: string | null, avisar: boolean): Promise<ResultadoDaExportacaoNaJanela> {
  if (estado?.url == null) return { estado: 'falhou', mensagem: 'A biblioteca ainda está abrindo.' };
  const janela = estado.principal;
  const opcoes = {
    title: 'Exportar para o Obsidian: escolha a pasta do cofre', buttonLabel: 'Exportar aqui',
    defaultPath: estado.configuracao.cofreDoObsidian ?? app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'] as ('openDirectory' | 'createDirectory' | 'promptToCreate')[],
  };
  const escolha = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes);
  const pasta = escolha.canceled ? undefined : escolha.filePaths[0];
  if (pasta === undefined || estado.url === null) return { estado: 'cancelada', mensagem: 'Nada foi exportado.' };
  estado.configuracao.cofreDoObsidian = pasta;
  await gravarConfiguracao(estado.pastas.configuracao, estado.configuracao);
  try {
    const resultado = await exportarParaOCofre({ servico: estado.url, cofre: pasta, ...(documentoId === null ? {} : { documentoId }) });
    const resumo = resumoDaExportacao(resultado);
    estado.registro.evento('obsidian_exportado', {
      criadas: resultado.relatorio.criadas.length, atualizadas: resultado.relatorio.atualizadas.length,
      conflitos: resultado.relatorio.conflitos.length, erros: resultado.relatorio.erros.length,
    });
    if (avisar) {
      const caixa = { type: 'info' as const, message: resumo.titulo, detail: resumo.detalhe };
      await (janela === null ? dialog.showMessageBox(caixa) : dialog.showMessageBox(janela, caixa));
    }
    return { estado: 'ok', mensagem: `${resumo.titulo} ${resumo.detalhe.split('\n')[0] ?? ''}`.trim(), pasta: resultado.pasta };
  } catch (erro) {
    const mensagem = `Não foi possível exportar: ${mensagemDoErro(erro)}`;
    if (avisar) {
      const caixa = { type: 'warning' as const, message: mensagem };
      await (janela === null ? dialog.showMessageBox(caixa) : dialog.showMessageBox(janela, caixa));
    }
    return { estado: 'falhou', mensagem };
  }
}

/** O pedido veio da janela da biblioteca, com a página do próprio serviço carregada. */
function daBiblioteca(remetente: Electron.WebContents): BrowserWindow | null {
  const janela = estado?.principal;
  if (janela == null || janela.isDestroyed() || remetente !== janela.webContents) return null;
  if (estado?.url == null || !mesmaOrigem(remetente.getURL(), estado.url)) return null;
  return janela;
}

function registrarIpcDaBiblioteca(): void {
  ipcMain.on(CANAIS_DA_BIBLIOTECA.abrirMenu, (evento) => {
    const janela = daBiblioteca(evento.sender);
    if (janela !== null) abrirMenuDaJanela(janela);
  });
  ipcMain.on(CANAIS_DA_BIBLIOTECA.definirMoldura, (evento, dado: unknown) => {
    const janela = daBiblioteca(evento.sender);
    const moldura = molduraDaPagina(dado);
    if (janela === null || moldura === null) return;
    moldurasDasPaginas.set(janela, moldura);
    pintarMoldura(janela, moldura, moldura.altura);
  });
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.exportarParaObsidian, async (evento, documentoId: unknown) => {
    // Só a janela da biblioteca, e só com a página do próprio serviço carregada.
    if (estado?.principal == null || evento.sender !== estado.principal.webContents) throw new Error('Pedido fora da janela da biblioteca.');
    if (estado.url === null || !mesmaOrigem(evento.sender.getURL(), estado.url)) throw new Error('Pedido de outra origem.');
    return exportarParaObsidian(typeof documentoId === 'string' && ULID.test(documentoId) ? documentoId : null, false);
  });
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.situacaoDaAtualizacao, (evento) => {
    if (daBiblioteca(evento.sender) === null) throw new Error('Pedido fora da janela da biblioteca.');
    return situacaoDaAtualizacao();
  });
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.procurarAtualizacao, (evento) => {
    if (daBiblioteca(evento.sender) === null) throw new Error('Pedido fora da janela da biblioteca.');
    estado?.atualizador?.verificarAgora(true);
    return situacaoDaAtualizacao();
  });
  ipcMain.on(CANAIS_DA_BIBLIOTECA.reiniciarParaAtualizar, (evento) => {
    if (daBiblioteca(evento.sender) !== null) reiniciarParaAtualizar();
  });
  ipcMain.on(CANAIS_DA_BIBLIOTECA.atualizarAgora, (evento) => {
    if (daBiblioteca(evento.sender) !== null) estado?.atualizador?.atualizarAgora();
  });
  ipcMain.on(CANAIS_DA_BIBLIOTECA.adiarAtualizacao, (evento) => {
    if (daBiblioteca(evento.sender) !== null) estado?.atualizador?.adiar();
  });
  ipcMain.on(CANAIS_DA_BIBLIOTECA.abrirNovidades, (evento) => {
    if (daBiblioteca(evento.sender) !== null) void abrirFora(LINK_DAS_NOVIDADES);
  });
  ipcMain.on(CANAIS_DA_BIBLIOTECA.abrirDownload, (evento) => {
    if (daBiblioteca(evento.sender) !== null) void abrirFora(LINK_DO_DOWNLOAD);
  });
}

// ---------------------------------------------------------------- boas-vindas (IPC)

function daAbertura(evento: IpcMainInvokeEvent): boolean {
  return estado?.abertura !== null && estado?.abertura !== undefined && evento.sender === estado.abertura.webContents;
}

function avaliarPasta(caminho: string): AvaliacaoDaPasta {
  const absoluto = resolve(caminho);
  const existe = existsSync(absoluto);
  // Em pasta sincronizada o banco mora na pasta local do app (V-W8); vale também o lugar antigo.
  const pastas = pastasDaBiblioteca(absoluto, estado === null ? {} : { bancosLocais: estado.pastas.bancosLocais });
  let itens: string[] = [];
  try { itens = existe ? readdirSync(absoluto) : []; } catch { itens = []; }
  return {
    caminho: absoluto, existe,
    temBiblioteca: [pastas.banco, pastas.bancoNaBiblioteca].some((banco) => existsSync(join(banco, 'PG_VERSION'))),
    temOutrosArquivos: itens.some((nome) => nome !== '.margem' && nome !== '.DS_Store'),
  };
}

function registrarIpcDaAbertura(): void {
  const tratar = <A extends unknown[], R>(canal: string, fazer: (...args: A) => Promise<R> | R): void => {
    ipcMain.handle(canal, async (evento, ...args: unknown[]) => {
      if (!daAbertura(evento)) throw new Error('Pedido fora da janela de abertura.');
      return fazer(...(args as A));
    });
  };
  tratar(CANAIS.pastaPadrao, () => estado?.configuracao.biblioteca ?? join(app.getPath('documents'), 'Margem'));
  tratar(CANAIS.escolherPasta, async (atual: string) => {
    const janela = estado?.abertura;
    const opcoes = {
      title: 'Escolher a pasta da biblioteca', buttonLabel: 'Usar esta pasta', defaultPath: atual,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'] as ('openDirectory' | 'createDirectory' | 'promptToCreate')[],
    };
    const escolha = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes);
    return escolha.canceled ? null : (escolha.filePaths[0] ?? null);
  });
  tratar(CANAIS.avaliarPasta, (caminho: string) => avaliarPasta(String(caminho)));
  tratar(CANAIS.estadoDoLogin, () => (estado === null
    ? { encontrado: false, logado: null, conta: null }
    : estadoDoLogin(estado.recursos.codex?.caminho ?? null, estado.pastas.codexHome)));
  tratar(CANAIS.entrar, async (dispositivo: boolean) => {
    if (estado === null || estado.recursos.codex === null) return false;
    estado.login?.cancelar();
    const login = iniciarLogin(estado.recursos.codex.caminho, estado.pastas.codexHome, dispositivo === true, (evento) => {
      estado?.abertura?.webContents.send(CANAIS.login, evento);
    });
    estado.login = login;
    const ok = await login.resultado;
    if (estado.login === login) estado.login = null;
    estado.registro.evento('codex_login', { ok, dispositivo: dispositivo === true });
    return ok;
  });
  tratar(CANAIS.cancelarLogin, () => { estado?.login?.cancelar(); if (estado) estado.login = null; });
  tratar(CANAIS.abrirLink, async (url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url);
  });
  tratar(CANAIS.concluir, async (pasta: string): Promise<ResultadoDaConclusao> => {
    if (estado === null) return { ok: false, mensagem: 'App não iniciado.' };
    estado.configuracao.biblioteca = resolve(String(pasta));
    estado.configuracao.portaDoBanco = null;
    await gravarConfiguracao(estado.pastas.configuracao, estado.configuracao);
    const abertura = estado.abertura;
    try {
      const url = await ligarServico((etapa) => { abertura?.webContents.send(CANAIS.progresso, etapa); });
      estado.trocando = true;
      abrirJanelaPrincipal(url);
      abertura?.close();
      estado.trocando = false;
      return { ok: true };
    } catch (erro) {
      return { ok: false, mensagem: mensagemDoErro(erro) };
    }
  });
}

// ---------------------------------------------------------------- ciclo de vida

async function iniciarApp(): Promise<void> {
  // Windows: as notificações do sistema (aviso de atualização, J151) precisam do mesmo id do atalho que o
  // instalador cria (`appId` em scripts/empacotar.mjs).
  if (process.platform === 'win32') app.setAppUserModelId('dev.margem.app');
  const pastas = pastasDoApp(app.getPath('userData'));
  await prepararPastasDoApp(pastas);
  const registro = new Registro(join(pastas.registros, 'app.log'));
  const configuracao = await lerConfiguracao(pastas.configuracao);
  const plataforma = plataformaAtual();
  const local = localDosRecursos({ empacotado: app.isPackaged, resourcesPath: process.resourcesPath, pastaDoDesktop, plataforma });
  const recursos = resolverRecursos({ local });
  estado = {
    pastas, configuracao, registro, recursos, raizApp: local.raizApp,
    servico: null, url: null, principal: null, abertura: null, bandeja: null, login: null, atualizador: null,
    trocando: false, saindo: false, desligado: false, instalarAoSair: false,
  };
  registro.evento('app_iniciado', {
    versao: app.getVersion(), plataforma, empacotado: app.isPackaged, sem_janela: argumentos.semJanela,
    raiz: local.raizApp, recursos: resumoDosRecursos(recursos),
  });
  emitir('margem_iniciado', { versao: app.getVersion(), dados_do_app: pastas.dadosDoApp, recursos: resumoDosRecursos(recursos) });

  if (argumentos.biblioteca !== null) {
    configuracao.biblioteca = resolve(argumentos.biblioteca);
    await gravarConfiguracao(pastas.configuracao, configuracao);
  }
  if (!argumentos.semJanela) {
    configurarPermissoes();
    registrarIpcDaAbertura();
    registrarIpcDaBiblioteca();
    instalarMenu();
    acompanharTemaDoSistema();
    if (configuracao.bandeja && process.platform !== 'darwin') alternarBandeja(true);
    estado.atualizador = configurarAtualizacao({
      empacotado: app.isPackaged, registro, aoMudar: avisarAtualizacao,
      // Adiado: a máquina chama `instalar` já com o estado "pronta" gravado no atualizador.
      instalar: () => { setImmediate(reiniciarParaAtualizar); },
      abrirSite: () => { void abrirFora(LINK_DO_DOWNLOAD); },
    });
  }
  if (configuracao.biblioteca === null) {
    if (argumentos.semJanela) {
      emitir('margem_falhou', { mensagem: 'Sem biblioteca: use --biblioteca=<pasta>.', codigo: 'sem_biblioteca' });
      process.exitCode = 2;
      app.quit();
      return;
    }
    abrirJanelaDeAbertura('boas-vindas');
    return;
  }
  await abrirBiblioteca();
}

/** Fecha janelas (derruba o SSE da biblioteca), para worker, API e Postgres. */
async function desligar(): Promise<void> {
  if (estado === null) return;
  estado.login?.cancelar();
  for (const janela of BrowserWindow.getAllWindows()) janela.destroy();
  const prazo = setTimeout(() => {
    estado?.registro.evento('desligamento_estourou');
    app.exit(1);
  }, 400_000);
  try {
    await desligarServico();
  } finally {
    clearTimeout(prazo);
  }
  estado.bandeja?.destroy();
  estado.registro.evento('app_encerrado');
  emitir('margem_encerrada');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', trazerParaFrente);
  app.on('window-all-closed', () => {
    if (estado?.trocando) return;
    app.quit();
  });
  app.on('before-quit', (evento) => {
    if (estado === null || estado.desligado) return;
    evento.preventDefault();
    if (estado.saindo) return;
    estado.saindo = true;
    void desligar().finally(() => {
      if (estado === null) { app.exit(0); return; }
      estado.desligado = true;
      if (estado.instalarAoSair) instalarAtualizacaoAoSair();
      else app.quit();
    });
  });
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) process.on(sinal, () => { app.quit(); });
  // Parada por arquivo, só com --sem-janela (teste de fumaça no CI, J116): no Windows não há SIGTERM
  // entre processos (o kill do Node é TerminateProcess e deixaria o Postgres órfão). Quando o arquivo
  // aparece, o app sai pelo mesmo caminho do SIGTERM.
  const arquivoDeParada = argumentos.semJanela ? process.env.MARGEM_DESKTOP_ARQUIVO_PARADA?.trim() : undefined;
  if (arquivoDeParada) {
    const relogio = setInterval(() => {
      if (!existsSync(arquivoDeParada)) return;
      clearInterval(relogio);
      app.quit();
    }, 500);
  }
  app.whenReady().then(iniciarApp).catch((erro: unknown) => {
    emitir('margem_falhou', { mensagem: mensagemDoErro(erro), codigo: 'inicio' });
    if (!argumentos.semJanela) dialog.showErrorBox('O Margem não abriu', mensagemDoErro(erro));
    process.exitCode = 1;
    app.quit();
  });
}
