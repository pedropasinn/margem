/** Ponte da janela da biblioteca: a exportação para o Obsidian, a moldura da janela (menu e cores) e a atualização do app. */
import { contextBridge, ipcRenderer } from 'electron';
import { ALTURA_DO_TITULO } from './moldura.js';
import type { SituacaoDaAtualizacao } from '../nucleo/atualizacao.js';
import { CANAIS_DA_BIBLIOTECA, type PonteDaBiblioteca, type ResultadoDaExportacaoNaJanela } from './ponte.js';

const ponte: PonteDaBiblioteca = {
  exportarParaObsidian: (documentoId) =>
    ipcRenderer.invoke(CANAIS_DA_BIBLIOTECA.exportarParaObsidian, typeof documentoId === 'string' ? documentoId : null) as Promise<ResultadoDaExportacaoNaJanela>,
  janela: {
    sistema: process.platform,
    alturaDoTitulo: ALTURA_DO_TITULO,
    abrirMenu: () => { ipcRenderer.send(CANAIS_DA_BIBLIOTECA.abrirMenu); },
    definirMoldura: (moldura) => {
      ipcRenderer.send(CANAIS_DA_BIBLIOTECA.definirMoldura, {
        fundo: moldura.fundo, simbolo: moldura.simbolo, altura: moldura.altura, menu: { x: moldura.menu.x, y: moldura.menu.y },
      });
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
};

contextBridge.exposeInMainWorld('margemDesktop', ponte);
