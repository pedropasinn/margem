/**
 * Plugin Margem para o Obsidian: traz as marcas, as notas e as perguntas do Margem para uma pasta do
 * cofre, uma nota por documento, sem apagar o que o usuário escreveu fora do bloco gerenciado.
 */
import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, requestUrl } from 'obsidian';
import {
  resumoDoRelatorio, sincronizar, type ClienteDoMargem, type CofreDaSincronizacao, type EstadoDaSincronizacao, type IndiceDoMargem,
} from './sincronizar';

interface Configuracoes {
  /** Endereço do Margem, como se abre no navegador (ex.: http://localhost:8730). */
  servidor: string;
  /** Token pessoal (beta). Hoje a API pessoal não exige; vai no cabeçalho Authorization quando preenchido. */
  token: string;
  pasta: string;
  marcas: 'minhas' | 'todas';
  /** Também os documentos sem nada do leitor (uma nota quase vazia por livro). */
  todos: boolean;
  sincronizarAoAbrir: boolean;
  /** 0 desliga. */
  intervaloMinutos: number;
  estado: EstadoDaSincronizacao;
}

const PADRAO: Configuracoes = {
  servidor: 'http://127.0.0.1:8730', token: '', pasta: 'Margem', marcas: 'minhas', todos: false,
  sincronizarAoAbrir: false, intervaloMinutos: 0, estado: {},
};

function semBarraFinal(endereco: string): string {
  return endereco.trim().replace(/\/+$/, '');
}

export default class PluginDoMargem extends Plugin {
  configuracoes: Configuracoes = { ...PADRAO };
  private emCurso = false;
  private relogio: number | null = null;

  async onload(): Promise<void> {
    await this.carregarConfiguracoes();
    this.addCommand({ id: 'sincronizar', name: 'Sincronizar', callback: () => { void this.sincronizarAgora(); } });
    this.addRibbonIcon('book-open', 'Margem: sincronizar', () => { void this.sincronizarAgora(); });
    this.addSettingTab(new AbaDoMargem(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      if (this.configuracoes.sincronizarAoAbrir) void this.sincronizarAgora(true);
    });
    this.reprogramar();
  }

  onunload(): void {
    if (this.relogio !== null) window.clearInterval(this.relogio);
  }

  async carregarConfiguracoes(): Promise<void> {
    const guardadas = (await this.loadData()) as Partial<Configuracoes> | null;
    this.configuracoes = { ...PADRAO, ...(guardadas ?? {}), estado: { ...(guardadas?.estado ?? {}) } };
  }

  async salvarConfiguracoes(): Promise<void> {
    await this.saveData(this.configuracoes);
  }

  reprogramar(): void {
    if (this.relogio !== null) window.clearInterval(this.relogio);
    this.relogio = null;
    const minutos = this.configuracoes.intervaloMinutos;
    if (minutos > 0) {
      this.relogio = window.setInterval(() => { void this.sincronizarAgora(true); }, minutos * 60_000);
      this.registerInterval(this.relogio);
    }
  }

  private cabecalhos(): Record<string, string> {
    // `X-Margem` é o cabeçalho de mesma origem da API (exigido só nas escritas; o plugin só lê).
    return { 'X-Margem': '1', ...(this.configuracoes.token.trim() === '' ? {} : { Authorization: `Bearer ${this.configuracoes.token.trim()}` }) };
  }

  private async pedir(caminho: string): Promise<{ status: number; text: string }> {
    const servidor = semBarraFinal(this.configuracoes.servidor);
    const consulta = new URLSearchParams({ marcas: this.configuracoes.marcas, base: servidor });
    if (this.configuracoes.todos) consulta.set('todos', '1');
    const resposta = await requestUrl({ url: `${servidor}${caminho}?${consulta.toString()}`, headers: this.cabecalhos(), throw: false });
    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error(`O Margem recusou o pedido (${String(resposta.status)}). Confira o token e, se o servidor recusar a origem do Obsidian, inclua-a em MARGEM_ORIGENS.`);
    }
    if (resposta.status >= 400) throw new Error(`O Margem respondeu ${String(resposta.status)} em ${caminho}.`);
    return { status: resposta.status, text: resposta.text };
  }

  private cliente(): ClienteDoMargem {
    return {
      indice: async () => JSON.parse((await this.pedir('/api/obsidian/indice')).text) as IndiceDoMargem,
      nota: async (documentoId) => (await this.pedir(`/api/documentos/${encodeURIComponent(documentoId)}/obsidian.md`)).text,
    };
  }

  private cofre(): CofreDaSincronizacao {
    const { vault, metadataCache } = this.app;
    return {
      ler: async (caminho) => {
        const arquivo = vault.getAbstractFileByPath(normalizePath(caminho));
        return arquivo instanceof TFile ? vault.read(arquivo) : null;
      },
      escrever: async (caminho, conteudo) => {
        const alvo = normalizePath(caminho);
        const arquivo = vault.getAbstractFileByPath(alvo);
        if (arquivo instanceof TFile) { await vault.modify(arquivo, conteudo); return; }
        const pasta = alvo.includes('/') ? alvo.slice(0, alvo.lastIndexOf('/')) : '';
        if (pasta !== '' && vault.getAbstractFileByPath(pasta) === null) await vault.createFolder(pasta);
        await vault.create(alvo, conteudo);
      },
      notasDoMargem: () => {
        const mapa = new Map<string, string>();
        for (const arquivo of vault.getMarkdownFiles()) {
          const id: unknown = metadataCache.getFileCache(arquivo)?.frontmatter?.['margem_id'];
          if (typeof id === 'string' && id !== '') mapa.set(id, arquivo.path);
        }
        return Promise.resolve(mapa);
      },
    };
  }

  async sincronizarAgora(silencioso = false): Promise<void> {
    if (this.emCurso) return;
    this.emCurso = true;
    const aviso = silencioso ? null : new Notice('Margem: sincronizando…', 0);
    try {
      const { relatorio, estado } = await sincronizar({
        cofre: this.cofre(), cliente: this.cliente(), pasta: this.configuracoes.pasta, estado: this.configuracoes.estado,
      });
      this.configuracoes.estado = estado;
      await this.salvarConfiguracoes();
      const mudou = relatorio.criadas.length + relatorio.atualizadas.length + relatorio.conflitos.length + relatorio.erros.length > 0;
      if (!silencioso || mudou) new Notice(resumoDoRelatorio(relatorio), 8000);
      for (const conflito of relatorio.conflitos) console.warn(`[margem] ${conflito.caminho}: ${conflito.motivo}`);
      for (const erro of relatorio.erros) console.warn(`[margem] ${erro.titulo}: ${erro.motivo}`);
    } catch (erro) {
      new Notice(`Margem: ${erro instanceof Error ? erro.message : String(erro)}`, 10000);
    } finally {
      aviso?.hide();
      this.emCurso = false;
    }
  }
}

class AbaDoMargem extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PluginDoMargem) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const c = this.plugin.configuracoes;
    const salvar = async () => { await this.plugin.salvarConfiguracoes(); };

    new Setting(containerEl).setName('Servidor').setDesc('Endereço do Margem, como você abre no navegador (loopback ou o nome do Tailscale).')
      .addText((campo) => campo.setPlaceholder(PADRAO.servidor).setValue(c.servidor).onChange(async (valor) => { c.servidor = valor.trim(); await salvar(); }));
    new Setting(containerEl).setName('Token').setDesc('Token pessoal do Margem. Hoje o servidor pessoal não pede; deixe vazio.')
      .addText((campo) => { campo.inputEl.type = 'password'; campo.setValue(c.token).onChange(async (valor) => { c.token = valor; await salvar(); }); });
    new Setting(containerEl).setName('Pasta').setDesc('Onde as notas do Margem ficam no cofre.')
      .addText((campo) => campo.setPlaceholder('Margem').setValue(c.pasta).onChange(async (valor) => { c.pasta = valor.trim(); await salvar(); }));
    new Setting(containerEl).setName('Marcas da leitura').setDesc('Além dos seus grifos e das marcas que você confirmou ou comentou, trazer as marcas visíveis da leitura do Codex.')
      .addToggle((chave) => chave.setValue(c.marcas === 'todas').onChange(async (valor) => { c.marcas = valor ? 'todas' : 'minhas'; await salvar(); }));
    new Setting(containerEl).setName('Documentos sem notas').setDesc('Criar nota também para os documentos em que você ainda não marcou nada.')
      .addToggle((chave) => chave.setValue(c.todos).onChange(async (valor) => { c.todos = valor; await salvar(); }));
    new Setting(containerEl).setName('Sincronizar ao abrir o Obsidian')
      .addToggle((chave) => chave.setValue(c.sincronizarAoAbrir).onChange(async (valor) => { c.sincronizarAoAbrir = valor; await salvar(); }));
    new Setting(containerEl).setName('Sincronizar a cada (minutos)').setDesc('0 desliga.')
      .addText((campo) => campo.setValue(String(c.intervaloMinutos)).onChange(async (valor) => {
        const minutos = Number.parseInt(valor, 10);
        c.intervaloMinutos = Number.isFinite(minutos) && minutos > 0 ? Math.min(minutos, 24 * 60) : 0;
        await salvar();
        this.plugin.reprogramar();
      }));
    new Setting(containerEl).setName('Sincronizar agora')
      .addButton((botao) => botao.setButtonText('Sincronizar').setCta().onClick(() => { void this.plugin.sincronizarAgora(); }));
    new Setting(containerEl).setName('Esquecer o estado').setDesc('Na próxima sincronização, baixa todas as notas de novo (o que você escreveu fora do bloco do Margem continua).')
      .addButton((botao) => botao.setButtonText('Esquecer').onClick(async () => { c.estado = {}; await salvar(); new Notice('Margem: estado esquecido.'); }));
  }
}
