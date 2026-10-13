/**
 * Fundo da extensão (service worker no Chrome, página de fundo no Firefox).
 *
 * Extrai sob demanda (o script de extração só entra na aba quando a pessoa pede: `activeTab` +
 * `scripting`; as únicas permissões de host são as do servidor do Margem) e envia para a API.
 * O envio sai daqui, nunca do script na página: a página não vê o token nem o endereço do servidor.
 */
import browser from 'webextension-polyfill';
import { lerConfiguracao } from './configuracao';
import { ErroDoServidor, definirVerificadorDeAcesso, enviarPdf, enviarTexto, padraoDeHost, testarConexao } from './servidor';
import type { Captura, CapturaDePdf, CapturaDeTexto, Configuracao, Enviado, Pedido, Resposta } from './tipos';

// Com permissão de host o navegador não aplica CORS: falha de rede passa a significar Margem fechado.
definirVerificadorDeAcesso(async (servidor) => {
  const padrao = padraoDeHost(servidor);
  return padrao !== null && await browser.permissions.contains({ origins: [padrao] });
});

const MENU_PAGINA = 'margem-enviar-pagina';
const MENU_SELECAO = 'margem-enviar-selecao';

class ErroDeCaptura extends Error {}

function mensagemDe(erro: unknown): string {
  if (erro instanceof ErroDoServidor || erro instanceof ErroDeCaptura) return erro.message;
  return erro instanceof Error ? `Falha inesperada: ${erro.message}` : 'Falha inesperada.';
}

function ehPdfPeloEndereco(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function tituloDoPdf(aba: browser.Tabs.Tab, url: string): string {
  const titulo = (aba.title ?? '').trim();
  // O visor de PDF costuma usar o endereço (ou o caminho) como título: aí vale o nome do arquivo.
  const pareceEndereco = titulo === url || (titulo.includes('/') && /\.pdf$/i.test(titulo));
  if (titulo !== '' && !pareceEndereco) return titulo.slice(0, 500);
  try {
    const nome = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(/\.pdf$/i, '').trim();
    return nome === '' ? 'Documento PDF' : nome.slice(0, 500);
  } catch {
    return 'Documento PDF';
  }
}

function capturaDePdf(aba: browser.Tabs.Tab, url: string): CapturaDePdf {
  const site = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  return { tipo: 'pdf', titulo: tituloDoPdf(aba, url), url, ...(site === '' ? {} : { site }) };
}

/** Tipo do documento da aba, ou `null` se o navegador não deixar injetar (visor de PDF, página interna). */
async function tipoDoDocumento(abaId: number): Promise<string | null> {
  try {
    const [resultado] = await browser.scripting.executeScript({ target: { tabId: abaId }, func: () => document.contentType });
    return typeof resultado?.result === 'string' ? resultado.result : null;
  } catch {
    return null;
  }
}

async function capturar(abaId: number, modo: 'pagina' | 'selecao'): Promise<Captura> {
  const aba = await browser.tabs.get(abaId);
  const url = aba.url ?? '';
  if (!/^(https?|file):/i.test(url)) {
    throw new ErroDeCaptura('Esta aba não pode ser enviada (página interna do navegador ou da loja de extensões).');
  }
  const tipo = await tipoDoDocumento(abaId);
  if (tipo === 'application/pdf' || (tipo === null && ehPdfPeloEndereco(url))) {
    if (modo === 'selecao') throw new ErroDeCaptura('Num PDF a extensão envia o arquivo inteiro: use "Enviar página para o Margem".');
    return capturaDePdf(aba, url);
  }
  if (tipo === null) throw new ErroDeCaptura('O navegador não deixou a extensão ler esta aba.');
  await browser.scripting.executeScript({ target: { tabId: abaId }, files: ['conteudo.js'] });
  const [resultado] = await browser.scripting.executeScript({
    target: { tabId: abaId },
    args: [modo],
    func: (qual: 'pagina' | 'selecao') => {
      const extrator = globalThis.__margemExtrator;
      if (extrator === undefined) return null;
      return qual === 'pagina' ? extrator.pagina(document) : extrator.selecao(document);
    },
  });
  const captura = resultado?.result as CapturaDeTexto | null | undefined;
  if (captura === null || captura === undefined) {
    throw new ErroDeCaptura(modo === 'selecao' ? 'Nada selecionado nesta página.' : 'Não foi possível extrair o texto desta página.');
  }
  if (captura.markdown.trim() === '') throw new ErroDeCaptura('A página não tem texto para enviar.');
  return captura;
}

function base64ParaBytes(base64: string): ArrayBuffer {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

/** Os bytes do PDF: primeiro daqui (o `activeTab` cobre a origem da aba); senão, de dentro da aba. */
async function bytesDoPdf(abaId: number, url: string): Promise<ArrayBuffer> {
  try {
    const resposta = await fetch(url, { credentials: 'include' });
    if (resposta.ok) return await resposta.arrayBuffer();
  } catch {
    // Segue para a leitura de dentro da aba.
  }
  try {
    const [resultado] = await browser.scripting.executeScript({
      target: { tabId: abaId },
      func: async () => {
        const resposta = await fetch(location.href, { credentials: 'include' });
        if (!resposta.ok) return null;
        const bytes = new Uint8Array(await resposta.arrayBuffer());
        let binario = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binario);
      },
    });
    if (typeof resultado?.result === 'string') return base64ParaBytes(resultado.result);
  } catch {
    // Cai no erro abaixo.
  }
  throw new ErroDeCaptura('Não foi possível baixar o PDF desta aba. Baixe o arquivo e envie pela biblioteca do Margem.');
}

async function enviar(captura: Captura, abaId: number | undefined, configuracao?: Configuracao): Promise<Enviado> {
  const config = configuracao ?? await lerConfiguracao();
  if (captura.tipo === 'pdf') {
    if (abaId === undefined) throw new ErroDeCaptura('A aba do PDF não está mais aberta.');
    return enviarPdf(config, captura, await bytesDoPdf(abaId, captura.url));
  }
  return enviarTexto(config, captura);
}

async function responder<T>(trabalho: () => Promise<T>): Promise<Resposta<T>> {
  try {
    return { ok: true, valor: await trabalho() };
  } catch (erro) {
    return { ok: false, erro: mensagemDe(erro) };
  }
}

function ehPedido(valor: unknown): valor is Pedido {
  return typeof valor === 'object' && valor !== null && typeof (valor as { tipo?: unknown }).tipo === 'string';
}

browser.runtime.onMessage.addListener((mensagem: unknown, remetente: browser.Runtime.MessageSender) => {
  // Só as telas da própria extensão (popup, opções) conversam com o fundo; o script na página, não.
  const daExtensao = remetente.id === browser.runtime.id && (remetente.url ?? '').startsWith(browser.runtime.getURL(''));
  if (!ehPedido(mensagem) || !daExtensao) return undefined;
  switch (mensagem.tipo) {
    case 'capturar': return responder(() => capturar(mensagem.aba, mensagem.modo ?? 'pagina'));
    case 'enviar': return responder(async () => {
      const resultado = await enviar(mensagem.captura, mensagem.aba);
      if (mensagem.abrir) await browser.tabs.create({ url: resultado.endereco });
      return resultado;
    });
    case 'testar': return responder(() => testarConexao(mensagem.configuracao));
    default: return undefined;
  }
});

// ------------------------------------------------------------------ menu de contexto e aviso

const enderecosDosAvisos = new Map<string, string>();

async function avisar(titulo: string, mensagem: string, endereco?: string): Promise<void> {
  try {
    const id = await browser.notifications.create({
      type: 'basic', iconUrl: browser.runtime.getURL('icones/icone-128.png'), title: titulo, message: mensagem,
    });
    if (endereco !== undefined) enderecosDosAvisos.set(id, endereco);
  } catch {
    // Sem permissão de notificação: o selo no ícone já diz o resultado.
  }
}

async function selo(abaId: number | undefined, ok: boolean): Promise<void> {
  try {
    await browser.action.setBadgeBackgroundColor({ color: ok ? '#1f7a3d' : '#a82a2a' });
    await browser.action.setBadgeText({ text: ok ? '✓' : '!', ...(abaId === undefined ? {} : { tabId: abaId }) });
  } catch {
    // Selo é só um extra.
  }
}

browser.notifications.onClicked.addListener((id: string) => {
  const endereco = enderecosDosAvisos.get(id);
  if (endereco !== undefined) void browser.tabs.create({ url: endereco });
});

browser.runtime.onInstalled.addListener(() => {
  void (async () => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({ id: MENU_PAGINA, title: 'Enviar página para o Margem', contexts: ['page'] });
    browser.contextMenus.create({ id: MENU_SELECAO, title: 'Enviar seleção para o Margem', contexts: ['selection'] });
  })();
});

browser.contextMenus.onClicked.addListener((info: browser.Menus.OnClickData, aba?: browser.Tabs.Tab) => {
  if (aba?.id === undefined || (info.menuItemId !== MENU_PAGINA && info.menuItemId !== MENU_SELECAO)) return;
  const abaId = aba.id;
  void (async () => {
    try {
      const captura = await capturar(abaId, info.menuItemId === MENU_SELECAO ? 'selecao' : 'pagina');
      const resultado = await enviar(captura, abaId);
      await selo(abaId, true);
      await avisar('Enviado para o Margem', `${captura.titulo} — clique para abrir.`, resultado.endereco);
    } catch (erro) {
      await selo(abaId, false);
      await avisar('Não foi enviado', mensagemDe(erro));
    }
  })();
});
