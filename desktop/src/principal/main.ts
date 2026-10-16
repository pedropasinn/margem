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
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, session, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { CANAIS, type AvaliacaoDaPasta, type ResultadoDaConclusao } from '../boas-vindas/contrato.js';
import { estadoDoLogin, iniciarLogin, loginDoApp, type EstadoDoLogin, type EventoDoLogin, type LoginEmAndamento } from '../nucleo/codex.js';
import {
  gravarConfiguracao, lerConfiguracao, pastasDaBiblioteca, pastasDoApp, prepararPastasDoApp,
  type ConfiguracaoDoApp, type PastasDoApp,
} from '../nucleo/configuracao.js';
import { enderecoDeAdicionar, enderecoDasAtualizacoes, enderecoDasConfiguracoes, type AbaDeAdicionar } from '../nucleo/importar.js';
import { exportarParaOCofre, resumoDaExportacao } from '../nucleo/obsidian.js';
import { plataformaAtual } from '../nucleo/plataforma.js';
import { localDosRecursos, resolverRecursos, resumoDosRecursos, type RecursosResolvidos } from '../nucleo/recursos.js';
import { Registro } from '../nucleo/registros.js';
import { ServicoDoMargem, type AcaoDoErro } from '../nucleo/servico.js';
import { chaveDaInstalacao } from '../nucleo/chave-local.js';
import { lerUltimasCopias } from '../nucleo/copia-de-seguranca.js';
import type { RespostaDaCopia } from '../nucleo/identidade.js';
import { arquivosDosArgumentos, ehArquivoAberto, lerArgumentos, linkExterno, mesmaOrigem } from './argumentos.js';
import { criarEncaminhador, linkDosArgumentos, registrarProtocolo } from './protocolo.js';
import { deveNotificar, type EstadoDaAtualizacao, type SituacaoDaAtualizacao } from '../nucleo/atualizacao.js';
import {
  configurarAtualizacao, gravarUltimaNotificada, instalarAtualizacaoAoSair, lerUltimaNotificada, naoInstalarNestaSaida, type Atualizador,
} from './atualizacao.js';
import { encerrarAoFecharTudo, fecharEAguardar, pararServicoQueFalhou, pararServicoQueFicou, reabertura } from './ciclo.js';
import { LINK_DA_DOCUMENTACAO, modeloDoMenu } from './menu.js';
import { linkDoRelato, resumoDoApp, situacaoDoComponente, type DadosDoRelato } from './relato.js';
import {
  ALTURA_DO_TITULO, POSICAO_DO_MENU, coresPadrao, molduraDaPagina, opcoesDaMoldura, posicaoDosSemaforos, proximoEstadoDoAlt,
  type CoresDaMoldura, type MolduraDaPagina,
} from './moldura.js';
import { CANAIS_DA_BIBLIOTECA, type ArquivoAberto, type LocaisDaBibliotecaNaJanela, type ResultadoDaExportacaoNaJanela } from './ponte.js';

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

/**
 * Traz a janela à frente; sem janela (no macOS, fechada com a biblioteca no ar), abre a que couber
 * (J154): a da biblioteca, a de boas-vindas ou a biblioteca configurada.
 */
function trazerParaFrente(): void {
  if (estado === null || !podeReabrir) return;
  const decisao = reabertura({
    temJanela: janelaAtual() !== null, url: estado.url, ligando: abrindoBiblioteca || (estado.servico !== null && estado.url === null),
    temBiblioteca: estado.configuracao.biblioteca !== null, saindo: estado.saindo,
  });
  if (decisao === 'principal' && estado.url !== null) abrirJanelaPrincipal(estado.url);
  else if (decisao === 'boas-vindas') abrirJanelaDeAbertura('boas-vindas');
  else if (decisao === 'abrir-biblioteca') void abrirBiblioteca();
  const janela = janelaAtual();
  if (decisao !== 'trazer' || janela === null) return;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
}

/** Abre um endereço da biblioteca na janela principal (reaberta se estiver fechada, no macOS). */
function abrirNaBiblioteca(endereco: string): void {
  if (estado?.url == null) return;
  if (estado.principal === null) abrirJanelaPrincipal(estado.url, endereco);
  else void estado.principal.loadURL(endereco);
  trazerParaFrente();
}

/** R2-6: links `margem://` (extensão, Obsidian) levam a rota à janela; com a biblioteca fechando ou abrindo, esperam por ela. */
const linksDoMargem = criarEncaminhador((rota) => {
  if (estado?.url == null) return false;
  abrirNaBiblioteca(new URL(rota, estado.url).toString());
  return true;
});

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

/** R2-8: quem espera o fechamento de uma janela (`fecharEAguardar`) e precisa saber se a pessoa desistiu. */
const desistenciasDoFechamento = new WeakMap<object, () => void>();

/** A janela da biblioteca em `url` (a origem do serviço), abrindo em `endereco` (padrão: o início). */
function abrirJanelaPrincipal(url: string, pedido: string = url): BrowserWindow {
  const pendente = pedido === url ? linksDoMargem.pendente() : null;
  const endereco = pendente === null ? pedido : new URL(pendente, url).toString();
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
  // U-02: a página segura a saída (fechar, recarregar, o menu trocar de tela) com envio pendente em Adicionar.
  // O Electron não mostra a caixa do navegador: a pergunta é esta, e "Sair mesmo assim" deixa sair.
  janela.webContents.on('will-prevent-unload', (evento) => {
    const escolha = dialog.showMessageBoxSync(janela, {
      type: 'warning', buttons: ['Continuar importando', 'Sair mesmo assim'], defaultId: 0, cancelId: 0,
      message: 'Alguns arquivos ainda não foram enviados.', detail: 'Se sair agora, eles não terminam de entrar na biblioteca.',
    });
    if (escolha === 1) evento.preventDefault();
    else desistenciasDoFechamento.get(janela)?.();
  });
  void janela.loadURL(endereco);
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
  Menu.setApplicationMenu(Menu.buildFromTemplate(modeloDoMenu({
    adicionar,
    configuracoes: () => { if (estado?.url != null) abrirNaBiblioteca(enderecoDasConfiguracoes(estado.url)); },
    exportarParaObsidian: () => { void exportarParaObsidian(null, true); },
    fazerCopiaDeSeguranca: () => { void fazerCopiaDeSeguranca(); },
    abrirPastaDaBiblioteca: () => { if (estado?.configuracao.biblioteca) void shell.openPath(estado.configuracao.biblioteca); },
    trocarBiblioteca: () => { void trocarBiblioteca(); },
    documentacao: () => { void abrirFora(LINK_DA_DOCUMENTACAO); },
    relatarProblema: () => { void dadosDoRelato().then((dados) => abrirFora(linkDoRelato(dados))); },
    copiarInformacoes: () => { void copiarInformacoes(); },
    registros: () => { if (estado) void shell.openPath(estado.pastas.registros); },
    sobre: mostrarSobre,
    verificarAtualizacoes: procurarAtualizacoesPeloMenu,
    alternarBandeja,
    bandejaLigada: estado.configuracao.bandeja,
    desenvolvimento: !app.isPackaged,
    // Na janela da biblioteca, o web decide (campo ou grifo, U-05); na de abertura, o desfazer nativo de antes.
    desfazer: () => {
      const janela = BrowserWindow.getFocusedWindow();
      if (!janela || janela.isDestroyed()) return;
      if (tipoDaJanela(janela) === 'principal') janela.webContents.send(CANAIS_DA_BIBLIOTECA.desfazer); else janela.webContents.undo();
    },
  })));
}

// ---------------------------------------------------------------- relatar um problema (U-12)

/** O resumo do app para um relato: versões, sistema e estado dos componentes; nada de caminhos nem conteúdo. */
async function dadosDoRelato(): Promise<DadosDoRelato> {
  const r = estado?.recursos;
  const login = estado === null ? null : await estadoDoChatGPT().catch(() => null);
  const biblioteca = estado?.configuracao.biblioteca ?? null;
  return {
    versao: app.getVersion(), sistema: process.platform, versaoDoSistema: process.getSystemVersion(), arquitetura: process.arch,
    electron: process.versions.electron, empacotado: app.isPackaged,
    componentes: r === undefined ? {} : {
      banco: situacaoDoComponente(r.postgres), codex: situacaoDoComponente(r.codex), motor: situacaoDoComponente(r.motor),
      ffmpeg: situacaoDoComponente(r.ffmpeg), 'yt-dlp': situacaoDoComponente(r.ytDlp),
    },
    servico: estado?.url != null ? 'no ar' : estado?.servico != null || abrindoBiblioteca ? 'abrindo' : 'parado',
    chatgpt: login === null ? 'não verificado' : !login.encontrado ? 'sem o Codex' : login.logado === true ? 'conectado' : login.logado === false ? 'não conectado' : 'não verificado',
    bibliotecaSincronizada: biblioteca === null ? null : pastasDaBiblioteca(biblioteca).sincronizada !== null,
  };
}

async function copiarInformacoes(): Promise<void> {
  const resumo = resumoDoApp(await dadosDoRelato());
  await clipboard.writeText(resumo);
  const caixa = { type: 'info' as const, message: 'Informações do app copiadas.', detail: `${resumo}\n\nCole no relato do problema. Nada dos seus livros, notas ou pastas vai junto.` };
  const janela = janelaAtual();
  await (janela === null ? dialog.showMessageBox(caixa) : dialog.showMessageBox(janela, caixa));
}

function mostrarSobre(): void {
  const caixa = {
    type: 'info' as const,
    message: `Margem ${app.getVersion()}`,
    detail: [
      'Leitor de textos marcados.',
      `Biblioteca: ${estado?.configuracao.biblioteca ?? 'nenhuma'}`,
      // W-01: o banco pode morar fora da biblioteca (pasta sincronizada).
      ...(estado?.servico == null ? [] : [`Banco: ${estado.servico.locais.banco}`]),
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

/** O serviço não parou (R-03): fica nos registros, com o código. */
function registrarParadaQueFalhou(erro: unknown): void {
  estado?.registro.evento('servico_nao_parou', { mensagem: mensagemDoErro(erro), codigo: (erro as { codigo?: string }).codigo ?? null });
}

/**
 * Sobe o serviço na biblioteca configurada. Devolve a URL, ou lança, com o serviço parado; se nem a parada
 * concluir (R-03), ele continua em `estado.servico` para o Sair tentar de novo e perguntar (L-05).
 */
async function ligarServico(aoProgresso: (etapa: string) => void): Promise<string> {
  if (estado === null) throw new Error('App não iniciado.');
  const biblioteca = estado.configuracao.biblioteca;
  if (biblioteca === null) throw new Error('Nenhuma biblioteca escolhida.');
  const atual = estado;
  await pararServicoQueFicou(atual, registrarParadaQueFalhou);
  const servico = new ServicoDoMargem({
    recursos: atual.recursos, raizApp: atual.raizApp, pastasDoApp: atual.pastas, biblioteca,
    configuracao: atual.configuracao, registro: atual.registro, aoProgresso,
    aoCair: (processo) => { void avisarQueda(processo); },
    ...(argumentos.semJanela ? { eco: (linha: string) => { process.stderr.write(`${linha}\n`); } } : { perguntarSeCopiou: perguntarSeMoveuOuCopiou }),
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
    await pararServicoQueFalhou(atual, servico, registrarParadaQueFalhou);
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

/** Abrindo a biblioteca (inclusive nas caixas de diálogo do caminho): o Dock não abre outra. */
let abrindoBiblioteca = false;
/** O início já decidiu a primeira janela: antes disso, o `activate` do macOS não abre nada. */
let podeReabrir = false;

/** Abre a biblioteca configurada: janela de "abrindo…", serviço, janela principal. */
async function abrirBiblioteca(): Promise<void> {
  if (estado === null || abrindoBiblioteca) return;
  abrindoBiblioteca = true;
  try {
    await abrirBibliotecaAgora();
  } finally {
    abrindoBiblioteca = false;
  }
}

async function abrirBibliotecaAgora(): Promise<void> {
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
    // L-02: fechar o app durante a abertura interrompe a abertura; não é erro para mostrar.
    if (estado.saindo) return;
    // W-02: a pessoa cancelou a pergunta "moveu ou copiou?": de volta à escolha da pasta.
    const cancelada = (erro as { codigo?: string }).codigo === 'identidade_cancelada';
    // W-06: antivírus, lock incerto, banco que não parou… se resolvem sem trocar de pasta: "Tentar novamente".
    // R-06/D-14: o erro pode trazer um botão (baixar a versão nova, como restaurar), que não fecha a caixa.
    const acao = (erro as { acao?: AcaoDoErro }).acao;
    let response = cancelada ? 1 : -1;
    while (response < 0) {
      const escolha = await dialog.showMessageBox({
        type: 'error', buttons: ['Tentar novamente', 'Escolher outra pasta', 'Abrir registros', 'Sair', ...(acao ? [acao.rotulo] : [])], defaultId: 0, cancelId: 3,
        message: 'Não foi possível abrir a biblioteca.', detail: mensagemDoErro(erro),
      });
      if (acao && escolha.response === 4) void abrirFora(acao.url);
      else response = escolha.response;
    }
    if (response === 0) { estado.abertura = abertura.isDestroyed() ? null : abertura; await abrirBibliotecaAgora(); return; }
    if (response === 2) void shell.openPath(estado.pastas.registros);
    if (response === 1) {
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
  // R2-8: a pessoa pode segurar o fechamento ("Continuar importando"): fica a biblioteca atual.
  if (!(await fecharEAguardar(estado.principal, desistenciasDoFechamento))) { estado.trocando = false; return; }
  const abertura = abrirJanelaDeAbertura('carregando');
  try {
    await desligarServico();
  } catch (erro) {
    // L-05: o banco da biblioteca atual não fechou; trocar agora poria dois bancos no ar. Fica a atual.
    dialog.showErrorBox('Não foi possível trocar de biblioteca', mensagemDoErro(erro));
    estado.trocando = false;
    estado.abertura = abertura;
    await abrirBiblioteca();
    return;
  }
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
  if (estado?.url != null) abrirNaBiblioteca(enderecoDasAtualizacoes(estado.url));
  estado?.atualizador?.verificarAgora(true);
}

/** Arquivo → Adicionar…: a tela Adicionar da biblioteca, na aba do tipo (V-D5). */
function adicionar(aba: AbaDeAdicionar): void {
  if (estado?.url != null) abrirNaBiblioteca(enderecoDeAdicionar(estado.url, aba));
}

// ---------------------------------------------------------------- identidade e cópia de segurança (W-02, U-03; J155)

/** A mesma biblioteca (mesmo id) está em outra pasta que ainda existe: a pessoa diz se moveu ou copiou. */
async function perguntarSeMoveuOuCopiou(pergunta: { biblioteca: string; outra: string }): Promise<RespostaDaCopia> {
  const janela = janelaAtual();
  const caixa = {
    type: 'question' as const, buttons: ['Movi para cá', 'É uma cópia', 'Cancelar'], defaultId: 1, cancelId: 2,
    message: 'Você moveu ou copiou esta biblioteca?',
    detail: `A mesma biblioteca também está em:\n${pergunta.outra}\n\n`
      + 'Movi para cá: esta pasta continua com as mesmas notas e leituras.\n'
      + 'É uma cópia: esta pasta vira uma biblioteca separada, que começa com uma cópia das notas; a outra não muda.',
  };
  const { response } = await (janela === null ? dialog.showMessageBox(caixa) : dialog.showMessageBox(janela, caixa));
  return response === 0 ? 'movida' : response === 1 ? 'copia' : 'cancelar';
}

async function locaisDaBiblioteca(): Promise<LocaisDaBibliotecaNaJanela> {
  if (estado?.servico == null) throw new Error('A biblioteca ainda está abrindo.');
  const locais = estado.servico.locais;
  const ultima = (await lerUltimasCopias(estado.pastas.copiasDeSeguranca))[estado.servico.biblioteca.id] ?? null;
  return { ...locais, ultimaCopia: ultima !== null && existsSync(ultima.pasta) ? ultima : null };
}

let copiando = false;

/**
 * Arquivo → Fazer cópia de segurança… (e o botão das Configurações): escolher a pasta; a biblioteca fecha
 * (serviço parado, como ao sair), a cópia anda na janela de "abrindo" e a biblioteca abre de novo.
 */
async function fazerCopiaDeSeguranca(): Promise<void> {
  if (estado?.servico == null || estado.url === null || copiando) return;
  const anterior = (await lerUltimasCopias(estado.pastas.copiasDeSeguranca))[estado.servico.biblioteca.id];
  const janela = estado.principal;
  const opcoes = {
    title: 'Fazer cópia de segurança: escolha onde guardar', buttonLabel: 'Copiar aqui',
    defaultPath: anterior !== undefined ? dirname(anterior.pasta) : app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'] as ('openDirectory' | 'createDirectory' | 'promptToCreate')[],
  };
  const escolha = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes);
  const destino = escolha.canceled ? undefined : escolha.filePaths[0];
  if (destino === undefined || estado.servico === null) return;
  copiando = true;
  const servico = estado.servico;
  estado.trocando = true;
  // R2-8: "Continuar importando" na pergunta do fechamento desiste da cópia; o serviço nem é tocado.
  if (!(await fecharEAguardar(estado.principal, desistenciasDoFechamento))) {
    estado.trocando = false;
    copiando = false;
    estado.registro.evento('copia_de_seguranca_desistiu', { motivo: 'envio_pendente' });
    return;
  }
  const abertura = abrirJanelaDeAbertura('carregando');
  estado.trocando = false;
  let resultado: Awaited<ReturnType<ServicoDoMargem['fazerCopiaDeSeguranca']>> | null = null;
  let falha: unknown = null;
  try {
    resultado = await servico.fazerCopiaDeSeguranca(destino, (etapa) => { if (!abertura.isDestroyed()) abertura.webContents.send(CANAIS.progresso, etapa); });
  } catch (erro) {
    falha = erro;
    estado.registro.evento('copia_de_seguranca_falhou', { mensagem: mensagemDoErro(erro), codigo: (erro as { codigo?: string }).codigo ?? null });
  }
  // R-03 (ciclo.ts): o serviço só é largado se parou; senão a abertura seguinte para primeiro (ou avisa).
  if (resultado !== null) { if (estado.servico === servico) estado.servico = null; }
  else await pararServicoQueFalhou(estado, servico, registrarParadaQueFalhou);
  estado.url = null;
  estado.abertura = abertura.isDestroyed() ? null : abertura;
  copiando = false;
  await abrirBiblioteca();
  const caixa = resultado !== null
    ? {
      type: 'info' as const, buttons: ['Mostrar a cópia', 'OK'], defaultId: 1, cancelId: 1, message: 'Cópia de segurança feita.',
      detail: `Em ${resultado.pasta}\n\nA biblioteca (${String(resultado.manifesto.biblioteca.arquivos)} arquivos) e o banco, com as marcas, notas e leituras. `
        + 'Para restaurar, siga o LEIA-ME.txt que está nela.',
    }
    : { type: 'warning' as const, buttons: ['OK'], message: 'A cópia de segurança não foi feita.', detail: mensagemDoErro(falha) };
  const pai = estado.principal;
  const { response } = await (pai === null || pai.isDestroyed() ? dialog.showMessageBox(caixa) : dialog.showMessageBox(pai, caixa));
  if (resultado !== null && response === 0) shell.showItemInFolder(join(resultado.pasta, 'LEIA-ME.txt'));
}

// ---------------------------------------------------------------- "Abrir com" (U-08)

/** PDFs e EPUBs que o sistema mandou abrir e a página ainda não pegou (caminhos absolutos, sem repetir). */
const arquivosAbertos: string[] = [];
/** O mesmo teto da tela Adicionar (`LIMITE_DOCUMENTO_BYTES`): maior que isso nem é lido. */
const LIMITE_DO_ARQUIVO_ABERTO = 200 * 1024 * 1024;

/** Guarda os arquivos e avisa a página (que os leva para Adicionar, para a pessoa confirmar). */
function receberArquivos(caminhos: readonly string[], trazer = true): void {
  const novos = caminhos.filter((caminho) => ehArquivoAberto(caminho) && !arquivosAbertos.includes(caminho));
  if (novos.length === 0 || argumentos.semJanela) return;
  arquivosAbertos.push(...novos);
  estado?.registro.evento('arquivos_abertos', { quantos: novos.length });
  const janela = estado?.principal;
  if (janela != null && !janela.isDestroyed()) janela.webContents.send(CANAIS_DA_BIBLIOTECA.arquivosChegaram);
  if (trazer) trazerParaFrente();
}

/** Lê os arquivos guardados (e os esquece): só os comuns, legíveis e dentro do limite. */
async function entregarArquivosAbertos(): Promise<ArquivoAberto[]> {
  const caminhos = arquivosAbertos.splice(0);
  const lidos: ArquivoAberto[] = [];
  for (const caminho of caminhos) {
    try {
      const info = await stat(caminho);
      if (!info.isFile() || info.size > LIMITE_DO_ARQUIVO_ABERTO) { estado?.registro.evento('arquivo_aberto_recusado', { motivo: info.isFile() ? 'grande' : 'nao_arquivo' }); continue; }
      const nome = basename(caminho);
      lidos.push({ nome, tipo: nome.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/epub+zip', dados: new Uint8Array(await readFile(caminho)) });
    } catch {
      estado?.registro.evento('arquivo_aberto_recusado', { motivo: 'ilegivel' });
    }
  }
  return lidos;
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
    const resultado = await exportarParaOCofre({
      servico: estado.url, cofre: pasta, chave: await chaveDaInstalacao(estado.pastas.segredos), ...(documentoId === null ? {} : { documentoId }),
    });
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

// ---------------------------------------------------------------- login do ChatGPT

/** O estado do login com o Codex do app e o CODEX_HOME do app (o mesmo que o serviço usa). */
function estadoDoChatGPT(): Promise<EstadoDoLogin> {
  const login = estado === null ? null : loginDoApp(estado.recursos, estado.pastas);
  if (login === null) return Promise.resolve({ encontrado: false, logado: null, conta: null });
  return estadoDoLogin(login.codex, login.codexHome);
}

/**
 * Roda o login do ChatGPT e conta os eventos a `avisar`. Um caminho só para a janela de abertura e para a
 * da biblioteca (U-01/W-05): o Codex embutido e o CODEX_HOME do app, nunca o `codex` do terminal.
 */
async function entrarNoChatGPT(dispositivo: boolean, janela: 'abertura' | 'biblioteca', avisar: (evento: EventoDoLogin) => void): Promise<boolean> {
  const dados = estado === null ? null : loginDoApp(estado.recursos, estado.pastas);
  if (estado === null || dados === null) return false;
  estado.login?.cancelar();
  const login = iniciarLogin(dados.codex, dados.codexHome, dispositivo, (evento) => {
    avisar(evento);
    // W-06: a CLI não rodou (antivírus, política); o código do sistema fica nos registros.
    if (evento.codigo !== undefined) estado?.registro.evento('codex_login_nao_rodou', { codigo: evento.codigo, executavel: dados.codex });
  });
  estado.login = login;
  const ok = await login.resultado;
  if (estado.login === login) estado.login = null;
  estado.registro.evento('codex_login', { ok, dispositivo, janela });
  return ok;
}

function cancelarLogin(): void {
  estado?.login?.cancelar();
  if (estado) estado.login = null;
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
  // S-01 (J161): a chave local só para a janela da biblioteca com a página do próprio serviço.
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.chaveLocal, (evento) => {
    if (daBiblioteca(evento.sender) === null || estado === null) throw new Error('Pedido fora da janela da biblioteca.');
    return chaveDaInstalacao(estado.pastas.segredos);
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
  // U-03 (J155): Configurações → Cópia de segurança.
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.locaisDaBiblioteca, (evento) => {
    if (daBiblioteca(evento.sender) === null) throw new Error('Pedido fora da janela da biblioteca.');
    return locaisDaBiblioteca();
  });
  ipcMain.on(CANAIS_DA_BIBLIOTECA.fazerCopia, (evento) => {
    if (daBiblioteca(evento.sender) !== null) void fazerCopiaDeSeguranca();
  });
  ipcMain.on(CANAIS_DA_BIBLIOTECA.mostrarPasta, (evento, qual: unknown) => {
    if (daBiblioteca(evento.sender) === null) return;
    void locaisDaBiblioteca().then((locais) => {
      if (qual === 'banco') void shell.openPath(locais.banco);
      else if (qual === 'ultima' && locais.ultimaCopia !== null) shell.showItemInFolder(join(locais.ultimaCopia.pasta, 'LEIA-ME.txt'));
      else void shell.openPath(locais.biblioteca);
    }, () => undefined);
  });
  // Conectar ao ChatGPT pelas Configurações e pelo aviso (U-01/W-05): só a janela da biblioteca, com a página do serviço.
  const daBibliotecaOuRecusa = (remetente: Electron.WebContents): BrowserWindow => {
    const janela = daBiblioteca(remetente);
    if (janela === null) throw new Error('Pedido fora da janela da biblioteca.');
    return janela;
  };
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.estadoDoChatGPT, (evento) => {
    daBibliotecaOuRecusa(evento.sender);
    return estadoDoChatGPT();
  });
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.entrarNoChatGPT, (evento, dispositivo: unknown) => {
    const janela = daBibliotecaOuRecusa(evento.sender);
    return entrarNoChatGPT(dispositivo === true, 'biblioteca', (aviso) => {
      if (!janela.isDestroyed()) janela.webContents.send(CANAIS_DA_BIBLIOTECA.eventoDoChatGPT, aviso);
    });
  });
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.cancelarChatGPT, (evento) => {
    daBibliotecaOuRecusa(evento.sender);
    cancelarLogin();
  });
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.pegarArquivosAbertos, (evento) => {
    daBibliotecaOuRecusa(evento.sender);
    return entregarArquivosAbertos();
  });
  ipcMain.handle(CANAIS_DA_BIBLIOTECA.abrirLinkDoChatGPT, async (evento, url: unknown) => {
    daBibliotecaOuRecusa(evento.sender);
    if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url);
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
  tratar(CANAIS.estadoDoLogin, estadoDoChatGPT);
  tratar(CANAIS.entrar, (dispositivo: boolean) => entrarNoChatGPT(dispositivo === true, 'abertura', (evento) => {
    estado?.abertura?.webContents.send(CANAIS.login, evento);
  }));
  tratar(CANAIS.cancelarLogin, cancelarLogin);
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
    // macOS sem assinatura (J154): aberto fora de Aplicativos (do .dmg, de Downloads) o sistema roda o app
    // de uma cópia só de leitura num caminho aleatório (App Translocation); o registro diz se foi o caso.
    ...(process.platform === 'darwin' && app.isPackaged
      ? { mac: { em_aplicativos: app.isInApplicationsFolder(), transladado: process.execPath.includes('/AppTranslocation/') } } : {}),
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
    podeReabrir = true;
    return;
  }
  podeReabrir = true;
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

/**
 * Desliga; se o banco não fechar (L-05), conta à pessoa e oferece tentar de novo. Sair mesmo assim deixa
 * o banco para a próxima abertura recuperar e não instala a atualização.
 */
async function desligarOuPerguntar(): Promise<boolean> {
  for (;;) {
    try {
      await desligar();
      return true;
    } catch (erro) {
      estado?.registro.evento('desligamento_falhou', { mensagem: mensagemDoErro(erro), codigo: (erro as { codigo?: string }).codigo ?? null });
      emitir('margem_desligamento_falhou', { mensagem: mensagemDoErro(erro) });
      if (argumentos.semJanela || estado === null) return false;
      const atualizando = estado.instalarAoSair || estado.atualizador?.estado().estado === 'pronta';
      const { response } = await dialog.showMessageBox({
        type: 'error', buttons: ['Tentar novamente', atualizando ? 'Sair sem atualizar' : 'Sair assim mesmo'], defaultId: 0, cancelId: 1,
        message: 'O Margem não conseguiu fechar o banco da biblioteca.',
        detail: `${mensagemDoErro(erro)}${atualizando ? '\n\nA atualização fica para a próxima vez que o Margem fechar.' : ''}`,
      });
      if (response !== 0) return false;
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // "Abrir com" (U-08): com o app fechado, os caminhos vêm na linha de comando; aberto, no second-instance;
  // no macOS, sempre pelo open-file (que pode chegar antes do ready).
  receberArquivos(arquivosDosArgumentos(process.argv.slice(1), process.cwd(), resolve), false);
  // R2-6: links margem:// (extensão, Obsidian). Windows e Linux: na linha de comando e no second-instance; macOS: open-url.
  if (!argumentos.semJanela) registrarProtocolo(app, process.defaultApp ? { execPath: process.execPath, app: resolve(process.argv[1] ?? '.') } : null);
  linksDoMargem.receber(linkDosArgumentos(process.argv.slice(1)));
  app.on('second-instance', (_evento, argv, pasta) => {
    receberArquivos(arquivosDosArgumentos(argv.slice(1), pasta, resolve), false);
    linksDoMargem.receber(linkDosArgumentos(argv.slice(1)));
    trazerParaFrente();
  });
  app.on('open-file', (evento, caminho) => {
    evento.preventDefault();
    receberArquivos([resolve(caminho)], app.isReady());
  });
  app.on('open-url', (evento, link) => {
    evento.preventDefault();
    linksDoMargem.receber(link);
  });
  // No macOS fechar a última janela não encerra: o app fica no Dock com a biblioteca no ar (J154).
  app.on('window-all-closed', () => {
    if (encerrarAoFecharTudo(process.platform, { trocando: estado?.trocando === true, semJanela: argumentos.semJanela })) app.quit();
  });
  // Clique no ícone do Dock (macOS): reabre a janela, se nenhuma estiver aberta.
  app.on('activate', () => { if (app.isReady()) trazerParaFrente(); });
  app.on('before-quit', (evento) => {
    if (estado === null || estado.desligado) return;
    evento.preventDefault();
    if (estado.saindo) return;
    estado.saindo = true;
    void desligarOuPerguntar().then((limpo) => {
      if (estado === null) { app.exit(0); return; }
      estado.desligado = true;
      if (!limpo) {
        // L-05: com o banco aberto, nada de instalar (nem pelo autoInstallOnAppQuit).
        naoInstalarNestaSaida();
        process.exitCode = 1;
        app.quit();
        return;
      }
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
