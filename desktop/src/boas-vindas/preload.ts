/** Ponte da janela de abertura: só estas funções, nada de Node no renderer. */
import { contextBridge, ipcRenderer } from 'electron';
import { CANAIS, type ApiDaAbertura, type EventoDoLoginNaJanela } from './contrato.js';

const api: ApiDaAbertura = {
  pastaPadrao: () => ipcRenderer.invoke(CANAIS.pastaPadrao) as Promise<string>,
  escolherPasta: (atual) => ipcRenderer.invoke(CANAIS.escolherPasta, atual) as Promise<string | null>,
  avaliarPasta: (caminho) => ipcRenderer.invoke(CANAIS.avaliarPasta, caminho) as ReturnType<ApiDaAbertura['avaliarPasta']>,
  estadoDoLogin: () => ipcRenderer.invoke(CANAIS.estadoDoLogin) as ReturnType<ApiDaAbertura['estadoDoLogin']>,
  entrar: (dispositivo) => ipcRenderer.invoke(CANAIS.entrar, dispositivo) as Promise<boolean>,
  cancelarLogin: () => ipcRenderer.invoke(CANAIS.cancelarLogin) as Promise<void>,
  abrirLink: (url) => ipcRenderer.invoke(CANAIS.abrirLink, url) as Promise<void>,
  concluir: (pasta) => ipcRenderer.invoke(CANAIS.concluir, pasta) as ReturnType<ApiDaAbertura['concluir']>,
  aoLogin: (ouvir) => { ipcRenderer.on(CANAIS.login, (_evento, dado: EventoDoLoginNaJanela) => { ouvir(dado); }); },
  aoProgresso: (ouvir) => { ipcRenderer.on(CANAIS.progresso, (_evento, etapa: string) => { ouvir(etapa); }); },
};

contextBridge.exposeInMainWorld('margem', api);
