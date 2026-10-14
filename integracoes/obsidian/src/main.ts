/**
 * Plugin Margem para o Obsidian: traz os grifos, as anotações, as perguntas, as relações, os flashcards
 * e os exercícios do Margem para uma pasta do cofre, uma pasta por documento e uma nota por item
 * (formato 2, `servico/src/obsidian/FORMATO.md`), sem apagar o que o usuário escreveu fora do bloco
 * gerenciado.
 */
import { App, Notice, Plugin, addIcon, PluginSettingTab, Setting, TFile, normalizePath, requestUrl } from 'obsidian';
import {
  clienteDoMargem, resumoDoRelatorio, sincronizarV2, type CofreDaSincronizacao, type EstadoDaSincronizacao,
} from './sincronizar';

/** Símbolo do Margem (docs/identidade/simbolo.svg: arco de cinco segmentos + M) num ícone de 100×100, na cor do tema, como os do Obsidian. */
const ICONE_DO_MARGEM = '<g fill="currentColor" transform="scale(0.6667) translate(-29.06 -28.5)"><path d="M76.805 28.957C68.5637 34.7276 61.3363 41.8248 55.417 49.96L78.058 66.434C82.1559 60.8018 87.1594 55.8881 92.865 51.893L76.805 28.957Z"/><path d="M52.03 54.955C46.663 63.4643 42.7442 72.8046 40.433 82.596L67.685 89.028C69.2848 82.2494 71.9976 75.7831 75.713 69.892L52.03 54.955Z"/><path d="M39.243 88.512C37.586 98.4353 37.586 108.565 39.243 118.488L66.86 113.876C65.7129 107.006 65.7129 99.9938 66.86 93.124L39.243 88.512Z"/><path d="M40.433 124.404C42.7442 134.195 46.663 143.536 52.03 152.045L75.713 137.108C71.9976 131.217 69.2848 124.751 67.685 117.972L40.433 124.404Z"/><path d="M55.417 157.04C61.3363 165.175 68.5637 172.272 76.805 178.043L92.865 155.107C87.1594 151.112 82.1559 146.198 78.058 140.566L55.417 157.04Z"/><path d="M96.9538 70.5455H116.545L133.165 111.071H133.932L150.551 70.5455H170.143V136H154.738V95.794H154.195L138.47 135.585H128.626L112.902 95.5703H112.359V136H96.9538V70.5455Z"/></g>';

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
  /** Por nota (`margem_id`): o sha256 e o caminho da última sincronização. O da V1 (por documento) é aproveitado. */
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
    addIcon('margem', ICONE_DO_MARGEM);
    this.addRibbonIcon('margem', 'Margem: sincronizar', () => { void this.sincronizarAgora(); });
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

  private async pedir(url: string): Promise<string> {
    const resposta = await requestUrl({ url, headers: this.cabecalhos(), throw: false });
    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error(`O Margem recusou o pedido (${String(resposta.status)}). Confira o token e, se o servidor recusar a origem do Obsidian, inclua-a em MARGEM_ORIGENS.`);
    }
    if (resposta.status === 404 && url.includes('/api/obsidian/v2/')) {
      throw new Error('Este servidor do Margem é anterior às notas por item. Atualize o Margem.');
    }
    if (resposta.status >= 400) throw new Error(`O Margem respondeu ${String(resposta.status)} em ${new URL(url).pathname}.`);
    return resposta.text;
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
      const cliente = clienteDoMargem({
        servidor: semBarraFinal(this.configuracoes.servidor), marcas: this.configuracoes.marcas, todos: this.configuracoes.todos,
      }, (url) => this.pedir(url));
      const { relatorio, estado } = await sincronizarV2({
        cofre: this.cofre(), cliente, pasta: this.configuracoes.pasta, estado: this.configuracoes.estado,
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
    new Setting(containerEl).setName('Pasta').setDesc('Onde as notas do Margem ficam no cofre: uma pasta por documento, com uma nota por grifo, anotação, pergunta e relação.')
      .addText((campo) => campo.setPlaceholder('Margem').setValue(c.pasta).onChange(async (valor) => { c.pasta = valor.trim(); await salvar(); }));
    new Setting(containerEl).setName('Marcas da leitura').setDesc('Além dos seus grifos e das marcas que você confirmou ou comentou, trazer as marcas visíveis da leitura do Codex.')
      .addToggle((chave) => chave.setValue(c.marcas === 'todas').onChange(async (valor) => { c.marcas = valor ? 'todas' : 'minhas'; await salvar(); }));
    new Setting(containerEl).setName('Documentos sem notas').setDesc('Criar a nota do documento também quando você ainda não marcou nada nele.')
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
