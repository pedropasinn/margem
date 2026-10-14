/** Menu nativo em português. */
import { Menu, type MenuItemConstructorOptions } from 'electron';
import { ITENS_DE_ADICIONAR, type AbaDeAdicionar } from '../nucleo/importar.js';

export interface AcoesDoMenu {
  /** Abre Adicionar na aba do tipo (V-D5). */
  adicionar: (aba: AbaDeAdicionar) => void;
  exportarParaObsidian: () => void;
  abrirPastaDaBiblioteca: () => void;
  trocarBiblioteca: () => void;
  documentacao: () => void;
  registros: () => void;
  sobre: () => void;
  verificarAtualizacoes: () => void;
  alternarBandeja: (ligada: boolean) => void;
  bandejaLigada: boolean;
  desenvolvimento: boolean;
}

export const LINK_DA_DOCUMENTACAO = 'https://margem.dev/docs';

export function montarMenu(acoes: AcoesDoMenu, sistema: NodeJS.Platform = process.platform): Menu {
  const mac = sistema === 'darwin';
  const modelo: MenuItemConstructorOptions[] = [];
  if (mac) {
    modelo.push({
      label: 'Margem',
      submenu: [
        { label: 'Sobre o Margem', click: acoes.sobre },
        { label: 'Procurar atualizações…', click: acoes.verificarAtualizacoes },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar o Margem' },
        { role: 'hideOthers', label: 'Ocultar os outros' },
        { role: 'unhide', label: 'Mostrar tudo' },
        { type: 'separator' },
        { role: 'quit', label: 'Sair do Margem' },
      ],
    });
  }
  modelo.push({
    label: 'Arquivo',
    submenu: [
      ...ITENS_DE_ADICIONAR.map(({ aba, rotulo, atalho }) => ({ label: rotulo, ...(atalho ? { accelerator: atalho } : {}), click: () => { acoes.adicionar(aba); } })),
      { type: 'separator' },
      { label: 'Exportar para o Obsidian…', click: acoes.exportarParaObsidian },
      { type: 'separator' },
      { label: 'Abrir pasta da biblioteca', click: acoes.abrirPastaDaBiblioteca },
      { label: 'Trocar de biblioteca…', click: acoes.trocarBiblioteca },
      ...(mac ? [] : [{ type: 'separator' } as const, { role: 'quit', label: 'Sair', accelerator: 'Ctrl+Q' } as const]),
    ],
  });
  modelo.push({
    label: 'Editar',
    submenu: [
      { role: 'undo', label: 'Desfazer' },
      { role: 'redo', label: 'Refazer' },
      { type: 'separator' },
      { role: 'cut', label: 'Recortar' },
      { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Colar' },
      { role: 'selectAll', label: 'Selecionar tudo' },
    ],
  });
  modelo.push({
    label: 'Exibir',
    submenu: [
      { role: 'reload', label: 'Recarregar' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Tamanho real' },
      { role: 'zoomIn', label: 'Aumentar' },
      { role: 'zoomOut', label: 'Diminuir' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Tela cheia' },
      ...(sistema === 'darwin' ? [] : [{
        label: 'Ícone na bandeja', type: 'checkbox' as const, checked: acoes.bandejaLigada,
        click: (item: { checked: boolean }) => { acoes.alternarBandeja(item.checked); },
      }]),
      ...(acoes.desenvolvimento ? [{ type: 'separator' } as const, { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' } as const] : []),
    ],
  });
  modelo.push({
    label: 'Ajuda',
    role: 'help',
    submenu: [
      { label: 'Documentação', click: acoes.documentacao },
      { label: 'Registros', click: acoes.registros },
      ...(mac ? [] : [
        { label: 'Procurar atualizações…', click: acoes.verificarAtualizacoes },
        { type: 'separator' } as const,
        { label: 'Sobre o Margem', click: acoes.sobre },
      ]),
    ],
  });
  return Menu.buildFromTemplate(modelo);
}
