/**
 * Menu nativo em português, montado por sistema (só o modelo: main.ts passa por `Menu.buildFromTemplate`;
 * assim os testes rodam sem Electron).
 *
 * macOS (J154): o menu do app (Sobre, Ajustes… ⌘,, Serviços, Ocultar, Sair ⌘Q), Arquivo com Fechar janela
 * (⌘W, que não encerra o app), Editar (sem ele ⌘C/⌘V/⌘Z não funcionam no Mac) e Janela. No Windows e no
 * Linux, Configurações… e Sair ficam em Arquivo, e Sobre em Ajuda.
 */
import type { MenuItemConstructorOptions } from 'electron';
import { ITENS_DE_ADICIONAR, type AbaDeAdicionar } from '../nucleo/importar.js';

export interface AcoesDoMenu {
  /** Abre Adicionar na aba do tipo (V-D5). */
  adicionar: (aba: AbaDeAdicionar) => void;
  /** Abre a tela de Configurações da biblioteca. */
  configuracoes: () => void;
  exportarParaObsidian: () => void;
  /** U-03: biblioteca e banco, com o serviço parado, para uma pasta que a pessoa escolhe. */
  fazerCopiaDeSeguranca: () => void;
  abrirPastaDaBiblioteca: () => void;
  trocarBiblioteca: () => void;
  documentacao: () => void;
  /** Ajuda → Relatar um problema… (U-12): a página de novo relato, já com o resumo do app. */
  relatarProblema: () => void;
  /** Ajuda → Copiar informações do app (U-12): o mesmo resumo, para a área de transferência. */
  copiarInformacoes: () => void;
  registros: () => void;
  sobre: () => void;
  verificarAtualizacoes: () => void;
  alternarBandeja: (ligada: boolean) => void;
  bandejaLigada: boolean;
  desenvolvimento: boolean;
  /**
   * Editar → Desfazer pela janela (U-05): o web desfaz o campo em foco ou, fora dele, o último grifo. Sem
   * esta ação, o item fica com o papel nativo `undo`.
   */
  desfazer?: () => void;
}

export const LINK_DA_DOCUMENTACAO = 'https://margem.dev/docs';

const separador = { type: 'separator' } as const;

export function modeloDoMenu(acoes: AcoesDoMenu, sistema: NodeJS.Platform = process.platform): MenuItemConstructorOptions[] {
  const mac = sistema === 'darwin';
  const modelo: MenuItemConstructorOptions[] = [];
  if (mac) {
    modelo.push({
      label: 'Margem',
      submenu: [
        { label: 'Sobre o Margem', click: acoes.sobre },
        { label: 'Procurar atualizações…', click: acoes.verificarAtualizacoes },
        separador,
        // "Ajustes…" é o nome do item no macOS 13 em diante; abre a tela de Configurações.
        { label: 'Ajustes…', accelerator: 'Command+,', click: acoes.configuracoes },
        separador,
        { role: 'services', label: 'Serviços' },
        separador,
        { role: 'hide', label: 'Ocultar o Margem' },
        { role: 'hideOthers', label: 'Ocultar os outros' },
        { role: 'unhide', label: 'Mostrar tudo' },
        separador,
        { role: 'quit', label: 'Sair do Margem' },
      ],
    });
  }
  modelo.push({
    label: 'Arquivo',
    submenu: [
      ...ITENS_DE_ADICIONAR.map(({ aba, rotulo, atalho }) => ({ label: rotulo, ...(atalho ? { accelerator: atalho } : {}), click: () => { acoes.adicionar(aba); } })),
      separador,
      { label: 'Exportar para o Obsidian…', click: acoes.exportarParaObsidian },
      { label: 'Fazer cópia de segurança…', click: acoes.fazerCopiaDeSeguranca },
      separador,
      { label: 'Abrir pasta da biblioteca', click: acoes.abrirPastaDaBiblioteca },
      { label: 'Trocar de biblioteca…', click: acoes.trocarBiblioteca },
      ...(mac
        ? [separador, { role: 'close', label: 'Fechar janela' } as const]
        : [
          separador,
          { label: 'Configurações…', accelerator: 'Ctrl+,', click: acoes.configuracoes },
          separador,
          { role: 'quit', label: 'Sair', accelerator: 'Ctrl+Q' } as const,
        ]),
    ],
  });
  modelo.push({
    label: 'Editar',
    submenu: [
      // O atalho segue com a página (registerAccelerator: false): o campo desfaz a digitação e o leitor, o grifo.
      acoes.desfazer
        ? { label: 'Desfazer', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: acoes.desfazer }
        : { role: 'undo', label: 'Desfazer' },
      { role: 'redo', label: 'Refazer' },
      separador,
      { role: 'cut', label: 'Recortar' },
      { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Colar' },
      ...(mac ? [{ role: 'pasteAndMatchStyle', label: 'Colar sem formatação' } as const, { role: 'delete', label: 'Apagar' } as const] : []),
      { role: 'selectAll', label: 'Selecionar tudo' },
    ],
  });
  modelo.push({
    label: 'Exibir',
    submenu: [
      { role: 'reload', label: 'Recarregar' },
      separador,
      { role: 'resetZoom', label: 'Tamanho real' },
      { role: 'zoomIn', label: 'Aumentar' },
      { role: 'zoomOut', label: 'Diminuir' },
      separador,
      { role: 'togglefullscreen', label: 'Tela cheia' },
      ...(mac ? [] : [{
        label: 'Ícone na bandeja', type: 'checkbox' as const, checked: acoes.bandejaLigada,
        click: (item: { checked: boolean }) => { acoes.alternarBandeja(item.checked); },
      }]),
      ...(acoes.desenvolvimento ? [separador, { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' } as const] : []),
    ],
  });
  if (mac) {
    modelo.push({
      label: 'Janela',
      role: 'window',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        separador,
        { role: 'front', label: 'Trazer tudo para a frente' },
      ],
    });
  }
  modelo.push({
    label: 'Ajuda',
    role: 'help',
    submenu: [
      { label: 'Documentação', click: acoes.documentacao },
      separador,
      { label: 'Relatar um problema…', click: acoes.relatarProblema },
      { label: 'Copiar informações do app', click: acoes.copiarInformacoes },
      { label: 'Abrir registros', click: acoes.registros },
      ...(mac ? [] : [
        { label: 'Procurar atualizações…', click: acoes.verificarAtualizacoes },
        separador,
        { label: 'Sobre o Margem', click: acoes.sobre },
      ]),
    ],
  });
  return modelo;
}
