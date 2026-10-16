import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { encerrarAoFecharTudo, fecharEAguardar, pararServicoQueFalhou, pararServicoQueFicou, reabertura, type DonoDoServico, type SituacaoDaReabertura } from '../src/principal/ciclo.js';
import { modeloDoMenu, type AcoesDoMenu } from '../src/principal/menu.js';
import { enderecoDasConfiguracoes } from '../src/nucleo/importar.js';

function acoes(): AcoesDoMenu {
  return {
    adicionar: vi.fn(), configuracoes: vi.fn(), exportarParaObsidian: vi.fn(), fazerCopiaDeSeguranca: vi.fn(), abrirPastaDaBiblioteca: vi.fn(), trocarBiblioteca: vi.fn(),
    documentacao: vi.fn(), relatarProblema: vi.fn(), copiarInformacoes: vi.fn(), registros: vi.fn(), sobre: vi.fn(), verificarAtualizacoes: vi.fn(), alternarBandeja: vi.fn(),
    bandejaLigada: false, desenvolvimento: false,
  };
}

const submenu = (item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] => (Array.isArray(item?.submenu) ? item.submenu : []);
const rotulos = (modelo: MenuItemConstructorOptions[]) => modelo.map((m) => m.label);
const papeis = (itens: MenuItemConstructorOptions[]) => itens.map((i) => i.role).filter(Boolean);
const porRotulo = (itens: MenuItemConstructorOptions[], rotulo: string) => itens.find((i) => i.label === rotulo);

describe('menu do macOS (J154)', () => {
  const a = acoes();
  const modelo = modeloDoMenu(a, 'darwin');

  it('Margem, Arquivo, Editar, Exibir, Janela e Ajuda, nessa ordem', () => {
    expect(rotulos(modelo)).toEqual(['Margem', 'Arquivo', 'Editar', 'Exibir', 'Janela', 'Ajuda']);
  });

  it('menu do app: Sobre, Ajustes… com ⌘, (abre Configurações), Serviços, Ocultar e Sair (⌘Q pelo papel quit)', () => {
    const app = submenu(modelo[0]);
    expect(app[0]?.label).toBe('Sobre o Margem');
    const ajustes = porRotulo(app, 'Ajustes…');
    expect(ajustes?.accelerator).toBe('Command+,');
    (ajustes?.click as () => void)();
    expect(a.configuracoes).toHaveBeenCalledOnce();
    expect(papeis(app)).toEqual(['services', 'hide', 'hideOthers', 'unhide', 'quit']);
    expect(app.at(-1)).toMatchObject({ role: 'quit', label: 'Sair do Margem' });
  });

  it('Arquivo fecha a janela (⌘W pelo papel close) e não tem Sair; Editar tem copiar, colar e desfazer', () => {
    const arquivo = submenu(modelo[1]);
    expect(arquivo.at(-1)).toMatchObject({ role: 'close', label: 'Fechar janela' });
    expect(papeis(arquivo)).not.toContain('quit');
    expect(porRotulo(arquivo, 'Adicionar documento…')?.accelerator).toBe('CmdOrCtrl+O');
    expect(papeis(submenu(modelo[2]))).toEqual(expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll']));
  });

  it('Janela com o papel window (o macOS põe ali a lista das janelas); sem ícone na bandeja', () => {
    expect(modelo[4]).toMatchObject({ role: 'window' });
    expect(papeis(submenu(modelo[4]))).toEqual(['minimize', 'zoom', 'front']);
    expect(porRotulo(submenu(modelo[3]), 'Ícone na bandeja')).toBeUndefined();
    expect(rotulos(submenu(modelo[5]))).toEqual(['Documentação', undefined, 'Relatar um problema…', 'Copiar informações do app', 'Abrir registros']);
  });
});

describe('menu do Windows e do Linux', () => {
  for (const sistema of ['win32', 'linux'] as const) {
    it(`${sistema}: sem menu do app nem Janela; Configurações… (Ctrl+,) e Sair (Ctrl+Q) em Arquivo; Sobre em Ajuda`, () => {
      const modelo = modeloDoMenu(acoes(), sistema);
      expect(rotulos(modelo)).toEqual(['Arquivo', 'Editar', 'Exibir', 'Ajuda']);
      const arquivo = submenu(modelo[0]);
      expect(porRotulo(arquivo, 'Configurações…')?.accelerator).toBe('Ctrl+,');
      expect(arquivo.at(-1)).toMatchObject({ role: 'quit', accelerator: 'Ctrl+Q' });
      expect(papeis(arquivo)).not.toContain('close');
      expect(porRotulo(submenu(modelo[2]), 'Ícone na bandeja')).toBeDefined();
      expect(submenu(modelo[3]).at(-1)?.label).toBe('Sobre o Margem');
    });
  }
});

describe('U-03: Fazer cópia de segurança… no menu Arquivo', () => {
  for (const sistema of ['darwin', 'win32', 'linux'] as const) {
    it(`${sistema}: logo depois de Exportar para o Obsidian…`, () => {
      const a = acoes();
      const arquivo = submenu(modeloDoMenu(a, sistema).find((m) => m.label === 'Arquivo'));
      const nomes = rotulos(arquivo);
      expect(nomes.indexOf('Fazer cópia de segurança…')).toBe(nomes.indexOf('Exportar para o Obsidian…') + 1);
      (porRotulo(arquivo, 'Fazer cópia de segurança…')?.click as () => void)();
      expect(a.fazerCopiaDeSeguranca).toHaveBeenCalledOnce();
    });
  }
});

describe('fechar a última janela e reabrir (J154)', () => {
  it('no macOS fechar tudo não encerra (só o Cmd+Q); nos outros encerra; trocando de janela, nunca', () => {
    expect(encerrarAoFecharTudo('darwin', { trocando: false, semJanela: false })).toBe(false);
    expect(encerrarAoFecharTudo('win32', { trocando: false, semJanela: false })).toBe(true);
    expect(encerrarAoFecharTudo('linux', { trocando: false, semJanela: false })).toBe(true);
    expect(encerrarAoFecharTudo('linux', { trocando: true, semJanela: false })).toBe(false);
    // A fumaça (--sem-janela) encerra como antes também no macOS.
    expect(encerrarAoFecharTudo('darwin', { trocando: false, semJanela: true })).toBe(true);
  });

  const base: SituacaoDaReabertura = { temJanela: false, url: null, ligando: false, temBiblioteca: false, saindo: false };
  it('Dock: traz a janela aberta, reabre a biblioteca no ar, as boas-vindas ou a biblioteca configurada', () => {
    expect(reabertura({ ...base, temJanela: true, url: 'http://127.0.0.1:1' })).toBe('trazer');
    expect(reabertura({ ...base, url: 'http://127.0.0.1:1', temBiblioteca: true })).toBe('principal');
    expect(reabertura(base)).toBe('boas-vindas');
    expect(reabertura({ ...base, temBiblioteca: true })).toBe('abrir-biblioteca');
  });
  it('subindo o serviço ou encerrando: nada (a janela principal abre sozinha quando ficar pronto)', () => {
    expect(reabertura({ ...base, ligando: true, temBiblioteca: true })).toBe('nada');
    expect(reabertura({ ...base, saindo: true, url: 'http://127.0.0.1:1' })).toBe('nada');
  });
  it('Ajustes… abre as Configurações da biblioteca', () => {
    expect(enderecoDasConfiguracoes('http://127.0.0.1:8730/')).toBe('http://127.0.0.1:8730/configuracoes');
  });
});

describe('abertura que falha com a parada que também falha (R-03)', () => {
  const servicoFalso = (falhas: number) => {
    let restantes = falhas;
    return { parar: vi.fn(() => (restantes-- > 0 ? Promise.reject(Object.assign(new Error('o banco não fechou'), { codigo: 'banco_nao_parou' })) : Promise.resolve())) };
  };

  it('com a parada falhando, o serviço continua no estado: o Sair o encontra e tenta de novo', async () => {
    const servico = servicoFalso(1);
    const dono: DonoDoServico<typeof servico> = { servico };
    const registrar = vi.fn();
    expect(await pararServicoQueFalhou(dono, servico, registrar)).toBe(false);
    expect(dono.servico).toBe(servico);
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ codigo: 'banco_nao_parou' }));
    // O Sair (desligarServico) ainda tem o que parar; agora para.
    await dono.servico?.parar();
    expect(servico.parar).toHaveBeenCalledTimes(2);
  });

  it('parou: larga a referência', async () => {
    const servico = servicoFalso(0);
    const dono: DonoDoServico<typeof servico> = { servico };
    expect(await pararServicoQueFalhou(dono, servico, vi.fn())).toBe(true);
    expect(dono.servico).toBeNull();
  });

  it('abrir outra biblioteca para antes o serviço que ficou; se ele ainda não parar, não abre outro por cima', async () => {
    const teimoso = servicoFalso(2);
    const dono: DonoDoServico<typeof teimoso> = { servico: teimoso };
    await expect(pararServicoQueFicou(dono, vi.fn())).rejects.toThrow(/ainda não fechou/);
    expect(dono.servico).toBe(teimoso);
    await expect(pararServicoQueFicou(dono, vi.fn())).rejects.toThrow();
    await pararServicoQueFicou(dono, vi.fn());
    expect(dono.servico).toBeNull();
    await pararServicoQueFicou({ servico: null }, vi.fn());
  });
});

describe('R2-8: fechar a janela e esperar (cópia de segurança, trocar de biblioteca)', () => {
  /** Janela falsa: `close()` mostra a pergunta da página (como o will-prevent-unload de main.ts). */
  function janelaFalsa(resposta: 'continuar' | 'sair' | 'sem_pendencia', desistencias: WeakMap<object, () => void>) {
    const ouvintes = new Set<() => void>();
    let destruida = false;
    const janela = {
      isDestroyed: () => destruida,
      once: (_e: 'closed', ouvinte: () => void) => { ouvintes.add(ouvinte); return janela; },
      removeListener: (_e: 'closed', ouvinte: () => void) => { ouvintes.delete(ouvinte); return janela; },
      close: () => {
        setTimeout(() => {
          if (resposta === 'continuar') { desistencias.get(janela)?.(); return; }
          destruida = true;
          for (const ouvinte of [...ouvintes]) ouvinte();
        }, 5);
      },
    };
    return { janela, ouvintes };
  }

  it('"Continuar importando" dá false: quem chamou desiste e a janela continua viva', async () => {
    const desistencias = new WeakMap<object, () => void>();
    const { janela, ouvintes } = janelaFalsa('continuar', desistencias);
    expect(await fecharEAguardar(janela, desistencias)).toBe(false);
    expect(janela.isDestroyed()).toBe(false);
    expect(ouvintes.size).toBe(0);
    expect(desistencias.has(janela)).toBe(false);
  });

  it('fechada de fato (sem pendência ou "Sair mesmo assim") dá true só depois do closed; sem janela, true', async () => {
    const desistencias = new WeakMap<object, () => void>();
    for (const resposta of ['sair', 'sem_pendencia'] as const) {
      const { janela } = janelaFalsa(resposta, desistencias);
      const fechando = fecharEAguardar(janela, desistencias);
      expect(janela.isDestroyed()).toBe(false);
      expect(await fechando).toBe(true);
      expect(janela.isDestroyed()).toBe(true);
      expect(desistencias.has(janela)).toBe(false);
    }
    expect(await fecharEAguardar(null, desistencias)).toBe(true);
  });
});
