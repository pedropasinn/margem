/**
 * HTML → Markdown no dialeto que o motor do Margem lê.
 *
 * O motor (motor/margem_motor/texto.py e markdown.py) entende títulos ATX, parágrafos, listas,
 * citações, cercas de código, ênfase (`*`, `**`), código em linha e escapes com barra invertida.
 * Ele **não** entende links, imagens, tabelas nem notas `[^n]`: o que viesse nessa sintaxe
 * apareceria literalmente no texto do leitor. Por isso, no estilo padrão (`referencias`):
 *
 * - um link vira só o seu texto no corpo, e o endereço entra na seção final "Links da página";
 * - uma imagem vira `[Imagem: alt]` no lugar e o endereço também vai para a lista final;
 * - a chamada de nota (`<sup>` com âncora interna, como na Wikipédia) vira `[1]`;
 * - `<br>` vira espaço (dois espaços no fim da linha fariam o motor ver um poema);
 * - `<hr>` some (o motor leria `---` como frontmatter e `* * *` como lista);
 * - tabela vira uma linha por registro, com as células separadas por " · ".
 *
 * O estilo `inline` devolve o Markdown comum (`[texto](url)`, `![alt](url)`), para quem quiser
 * o arquivo fora do Margem.
 */
import TurndownService from 'turndown';

export type EstiloDeLinks = 'referencias' | 'inline';

export interface OpcoesDeConversao {
  /** Endereço da página, para resolver links relativos. */
  base: string;
  links?: EstiloDeLinks;
}

interface Referencia {
  rotulo: string;
  url: string;
}

const TITULO_DA_LISTA = 'Links da página';

/** Escapes que o motor desfaz (`\\`*_{}[]()#+-.!>`), no mínimo necessário para o texto não virar sintaxe. */
export function escaparMarkdown(texto: string): string {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/([*_`[\]])/g, '\\$1')
    .replace(/^(\s*)(#{1,6}\s)/gm, '$1\\$2')
    .replace(/^(\s*)>/gm, '$1\\>')
    .replace(/^(\s*)([-+])(\s)/gm, '$1\\$2$3')
    .replace(/^(\s*)(\d+)([.)])(\s)/gm, '$1$2\\$3$4')
    .replace(/^(\s*)---/gm, '$1\\---');
}

function absoluto(endereco: string, base: string): string | null {
  try {
    const url = new URL(endereco, base);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Link para dentro da mesma página (âncora): não leva endereço para a lista. */
function interno(endereco: string, base: string): boolean {
  if (endereco.startsWith('#')) return true;
  try {
    const alvo = new URL(endereco, base);
    const pagina = new URL(base);
    return alvo.hash !== '' && alvo.origin === pagina.origin && alvo.pathname === pagina.pathname && alvo.search === pagina.search;
  } catch {
    return false;
  }
}

function textoLimpo(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

function elemento(no: Node): Element | null {
  return no.nodeType === 1 ? no as Element : null;
}

export function criarConversor(opcoes: OpcoesDeConversao): { converter: (raiz: Node | string) => string } {
  const estilo = opcoes.links ?? 'referencias';
  const referencias: Referencia[] = [];
  const vistos = new Set<string>();
  const anotar = (rotulo: string, url: string): void => {
    if (vistos.has(url)) return;
    vistos.add(url);
    referencias.push({ rotulo, url });
  };

  const servico = new TurndownService({
    headingStyle: 'atx',
    hr: '',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    br: ' ',
  });
  servico.escape = escaparMarkdown;
  servico.remove(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'form', 'button', 'input', 'select', 'textarea', 'template']);
  // Voltar da nota ("↑") e marcadores de edição da Wikipédia não são texto do artigo.
  servico.remove((no) => {
    const el = elemento(no);
    return el !== null && (el.classList.contains('mw-cite-backlink') || el.classList.contains('mw-editsection'));
  });

  servico.addRule('regua', { filter: 'hr', replacement: () => '\n\n' });
  servico.addRule('quebra', { filter: 'br', replacement: () => ' ' });

  servico.addRule('chamadaDeNota', {
    filter: (no) => {
      if (no.nodeName !== 'SUP') return false;
      const link = (no as Element).querySelector('a[href]');
      return link !== null && interno(link.getAttribute('href') ?? '', opcoes.base);
    },
    replacement: (_conteudo, no) => {
      const rotulo = textoLimpo(no.textContent ?? '').replace(/^\[|\]$/g, '');
      return rotulo === '' ? '' : `\\[${escaparMarkdown(rotulo)}\\]`;
    },
  });

  servico.addRule('link', {
    filter: (no) => no.nodeName === 'A' && (no as Element).getAttribute('href') !== null,
    replacement: (conteudo, no) => {
      const href = (no as Element).getAttribute('href') ?? '';
      const url = absoluto(href, opcoes.base);
      const texto = conteudo.trim();
      if (url === null || interno(href, opcoes.base)) return conteudo;
      if (estilo === 'inline') return texto === '' ? '' : `[${texto}](${url.replace(/\)/g, '%29')})`;
      const rotulo = textoLimpo(no.textContent ?? '') || url;
      anotar(rotulo, url);
      return conteudo;
    },
  });

  servico.addRule('imagem', {
    filter: 'img',
    replacement: (_conteudo, no) => {
      const el = no as Element;
      const fonte = el.getAttribute('src') ?? el.getAttribute('data-src') ?? '';
      const url = absoluto(fonte, opcoes.base);
      const alt = textoLimpo(el.getAttribute('alt') ?? '');
      if (url === null || url.startsWith('data:')) return alt === '' ? '' : `\\[Imagem: ${escaparMarkdown(alt)}\\]`;
      if (estilo === 'inline') return `![${escaparMarkdown(alt)}](${url.replace(/\)/g, '%29')})`;
      anotar(alt === '' ? 'Imagem' : `Imagem: ${alt}`, url);
      return alt === '' ? '' : `\\[Imagem: ${escaparMarkdown(alt)}\\]`;
    },
  });

  servico.addRule('tabela', {
    filter: 'table',
    replacement: (_conteudo, no) => {
      const linhas = Array.from((no as Element).querySelectorAll('tr')).map((linha) => Array.from(linha.children)
        .map((celula) => escaparMarkdown(textoLimpo(celula.textContent ?? '')))
        .filter((celula) => celula !== '')
        .join(' · '))
        .filter((linha) => linha !== '');
      return linhas.length === 0 ? '' : `\n\n${linhas.join('\n\n')}\n\n`;
    },
  });

  // Itens com marcador curto ("- ", "1. ") e sem espaço sobrando no começo; continuação recuada.
  servico.addRule('itemDeLista', {
    filter: 'li',
    replacement: (conteudo, no) => {
      const pai = no.parentNode as Element | null;
      let prefixo = '- ';
      if (pai?.nodeName === 'OL') {
        const inicio = Number.parseInt(pai.getAttribute('start') ?? '1', 10);
        prefixo = `${String((Number.isNaN(inicio) ? 1 : inicio) + Array.prototype.indexOf.call(pai.children, no))}. `;
      }
      const texto = conteudo.replace(/^\s+/, '').replace(/\n+$/, '\n').replace(/\n/gm, `\n${' '.repeat(prefixo.length)}`);
      return `${prefixo}${texto}${no.nextSibling !== null && !texto.endsWith('\n') ? '\n' : ''}`;
    },
  });

  // Legenda e figura: a legenda é um parágrafo próprio, em itálico.
  servico.addRule('legenda', {
    filter: 'figcaption',
    replacement: (conteudo) => {
      const texto = conteudo.trim();
      return texto === '' ? '' : `\n\n*${texto}*\n\n`;
    },
  });

  return {
    converter(raiz) {
      const corpo = servico.turndown(raiz as HTMLElement)
        .replace(/[ \t\u00a0]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (estilo === 'inline' || referencias.length === 0) return corpo;
      const lista = referencias.map(({ rotulo, url }) => `- ${escaparMarkdown(rotulo)}: ${escaparMarkdown(url)}`).join('\n');
      return `${corpo}\n\n## ${TITULO_DA_LISTA}\n\n${lista}`;
    },
  };
}

/** Conversão de uma vez só. */
export function htmlParaMarkdown(raiz: Node | string, opcoes: OpcoesDeConversao): string {
  return criarConversor(opcoes).converter(raiz);
}

/** Palavras do texto, contando só sequências com letra ou dígito. */
export function contarPalavras(texto: string): number {
  return (texto.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}
