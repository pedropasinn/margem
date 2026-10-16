/** Ponte da janela da biblioteca: a exportação para o Obsidian, a chave local (S-01), a moldura da janela (menu e cores), a atualização do app, o login do ChatGPT e os arquivos do "Abrir com". */
import { contextBridge, ipcRenderer } from 'electron';
import { ALTURA_DO_TITULO } from './moldura.js';
import type { SituacaoDaAtualizacao } from '../nucleo/atualizacao.js';
import { CANAIS_DA_BIBLIOTECA, type ArquivoAberto, type ChatGPTDoDesktop, type LocaisDaBibliotecaNaJanela, type PonteDaBiblioteca, type ResultadoDaExportacaoNaJanela } from './ponte.js';

type EventoDoChatGPT = Parameters<Parameters<ChatGPTDoDesktop['aoEvento']>[0]>[0];

const ponte: PonteDaBiblioteca = {
  exportarParaObsidian: (documentoId) =>
    ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.exportarParaObsidian, typeof documentoId === 'string' ? documentoId : null) as Promise<ResultadoDaExportacaoNaJanela>,
  chaveLocal: () => ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.chaveLocal) as Promise<string>,
  janela: {
    sistema: process.platform,
    alturaDoTitulo: ALTURA_DO_TITULO,
    abrirMenu: () => { ipcRenderer.send(CANAIS_DA_BIBLIOTECA.abrirMenu); },
    definirMoldura: (moldura) => {
      ipcRenderer.send(CANAIS_DA_BIBLIOTECA.definirMoldura, {
        fundo: moldura.fundo, simbolo: moldura.simbolo, altura: moldura.altura, menu: { x: moldura.menu.x, y: moldura.menu.y },
      });
    },
    aoDesfazer: (ouvir) => {
      const tratar = (): void => { ouvir(); };
      ipcRenderer.on(CANAIS_DA_BIBLIOTECA.desfazer, tratar);
      return () => { ipcRenderer.removeListener(CANAIS_DA_BIBLIOTECA.desfazer, tratar); };
    },
  },
  atualizacao: {
    situacao: () => ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.situacaoDaAtualizacao) as Promise<SituacaoDaAtualizacao>,
    procurar: () => ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.procurarAtualizacao) as Promise<SituacaoDaAtualizacao>,
    reiniciar: () => { ipcRenderer.send(CANAIS_DA_BIBLIOTECA.reiniciarParaAtualizar); },
    abrirDownload: () => { ipcRenderer.send(CANAIS_DA_BIBLIOTECA.abrirDownload); },
    atualizarAgora: () => { ipcRenderer.send(CANAIS_DA_BIBLIOTECA.atualizarAgora); },
    adiar: () => { ipcRenderer.send(CANAIS_DA_BIBLIOTECA.adiarAtualizacao); },
    abrirNovidades: () => { ipcRenderer.send(CANAIS_DA_BIBLIOTECA.abrirNovidades); },
    aoMudar: (ouvir) => {
      // Só o dado, nunca o evento do Electron (que expõe o `sender`).
      const tratar = (_evento: unknown, situacao: SituacaoDaAtualizacao): void => { ouvir(situacao); };
      ipcRenderer.on(CANAIS_DA_BIBLIOTECA.atualizacaoMudou, tratar);
      return () => { ipcRenderer.removeListener(CANAIS_DA_BIBLIOTECA.atualizacaoMudou, tratar); };
    },
  },
  copia: {
    locais: () => ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.locaisDaBiblioteca) as Promise<LocaisDaBibliotecaNaJanela>,
    fazer: () => { ipcRenderer.send(CANAIS_DA_BIBLIOTECA.fazerCopia); },
    mostrar: (qual) => { ipcRenderer.send(CANAIS_DA_BIBLIOTECA.mostrarPasta, qual === 'banco' || qual === 'ultima' ? qual : 'biblioteca'); },
  },
  chatgpt: {
    estado: () => ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.estadoDoChatGPT) as ReturnType<ChatGPTDoDesktop['estado']>,
    entrar: (dispositivo) => ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.entrarNoChatGPT, dispositivo === true) as Promise<boolean>,
    cancelar: () => ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.cancelarChatGPT) as Promise<void>,
    abrirLink: (url) => ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.abrirLinkDoChatGPT, String(url)) as Promise<void>,
    aoEvento: (ouvir) => {
      const tratar = (_evento: unknown, dado: EventoDoChatGPT): void => { ouvir(dado); };
      ipcRenderer.on(CANAIS_DA_BIBLIOTECA.eventoDoChatGPT, tratar);
      return () => { ipcRenderer.removeListener(CANAIS_DA_BIBLIOTECA.eventoDoChatGPT, tratar); };
    },
  },
  arquivos: {
    pegar: () => ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.pegarArquivosAbertos) as Promise<ArquivoAberto[]>,
    aoChegar: (ouvir) => {
      const tratar = (): void => { ouvir(); };
      ipcRenderer.on(CANAIS_DA_BIBLIOTECA.arquivosChegaram, tratar);
      return () => { ipcRenderer.removeListener(CANAIS_DA_BIBLIOTECA.arquivosChegaram, tratar); };
    },
  },
};

contextBridge.exposeInMainWorld('margemDesktop', ponte);
