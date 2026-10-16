import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Bloco, CanonicoV1 } from '@margem/contratos';
import { ChapterContent } from './ChapterContent';
import { textoDaNota } from './NotaDeRodape';
import { linhasDaTabela } from './AnnotatedText';
import { intervaloDoOffset, pontoDoNo, segmentosDoBloco } from './posicao';
import type { MarcaDoLeitor } from './f2';
import type { SnapshotCapitulo } from './tipos';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
// O canônico que o motor tirou do EPUB sintético (`fixtures/epub_sintetico.py`): notas, tabela e figuras.
import livro from './fixtures/epub-sintetico.json';

const canonico = livro as unknown as CanonicoV1;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function capitulo(indice: number, marcas: MarcaDoLeitor[] = []): SnapshotCapitulo {
  const secao = canonico.secoes[indice]!;
  const inicio = canonico.blocos.findIndex((b) => b.id === secao.bloco_inicio);
  const fim = canonico.blocos.findIndex((b) => b.id === secao.bloco_fim);
  return { versao_id: 'V'.repeat(26), formato: 'epub', secao, blocos: canonico.blocos.slice(inicio, fim + 1), marcas,
    assets: Object.fromEntries(canonico.assets.map((a) => [a.id, `/api/assets/V/${a.id}`])) };
}
const bloco = (tipo: Bloco['tipo'], contem = '') => canonico.blocos.find((b) => b.tipo === tipo && b.texto.includes(contem))!;
const texto = (raiz: ParentNode, id: string) => segmentosDoBloco(raiz, id).map((s) => s.textContent ?? '').join('');

describe('notas de rodapé do EPUB', () => {
  test('a chamada vira link; clicar abre a nota do mesmo capítulo no lugar, e o Esc volta ao texto', () => {
    const { container } = render(<ChapterContent snapshot={capitulo(0)} />);
    const chamada = screen.getByRole('link', { name: 'Nota 1' });
    expect(chamada.getAttribute('aria-haspopup')).toBe('dialog');
    expect(chamada.getAttribute('aria-expanded')).toBe('false');
    // Os offsets do parágrafo continuam os do canônico: o link fica por dentro do segmento.
    const paragrafo = bloco('paragrafo', 'Ler devagar');
    expect(texto(container, paragrafo.id)).toBe(paragrafo.texto);
    fireEvent.click(chamada);
    const nota = screen.getByRole('dialog', { name: 'Nota 1' });
    expect(nota.textContent).toContain('A pergunta muda porque o leitor mudou');
    expect(document.activeElement).toBe(nota);
    expect(chamada.getAttribute('aria-expanded')).toBe('true');
    expect(chamada.getAttribute('href')).toBe(`#${nota.id}`);
    fireEvent.keyDown(nota, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(chamada);
    expect(chamada.getAttribute('aria-expanded')).toBe('false');
    // O mesmo link alterna; o botão fecha; o clique fora também.
    fireEvent.click(chamada);
    fireEvent.click(chamada);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(chamada);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar a nota' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(chamada);
    fireEvent.pointerDown(container.querySelector('.bloco-paragrafo')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a nota de outro capítulo é buscada no serviço (uma vez) e aparece no mesmo lugar', async () => {
    const notas = capitulo(1);
    const pedidos: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      pedidos.push(url);
      const corpo = url.includes('/secoes?bloco=') ? { capitulo_do_bloco: notas.secao.id } : { ...notas };
      return Promise.resolve(new Response(JSON.stringify(corpo)));
    });
    render(<ChapterContent snapshot={capitulo(0)} />);
    const chamada = screen.getByRole('link', { name: 'Nota 2' });
    fireEvent.click(chamada);
    expect(screen.getByRole('dialog', { name: 'Nota 2' }).textContent).toContain('Abrindo a nota…');
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('cadernos de lugares-comuns foram comuns'));
    const segunda = bloco('nota_rodape', 'lugares-comuns');
    expect(pedidos).toEqual([`/api/versoes/${'V'.repeat(26)}/secoes?bloco=${segunda.id}`, `/api/versoes/${'V'.repeat(26)}/capitulos/${notas.secao.id}`]);
    fireEvent.click(chamada); fireEvent.click(chamada);
    expect(screen.getByRole('dialog').textContent).toContain('cadernos de lugares-comuns');
    expect(pedidos).toHaveLength(2);
  });

  test('R3-5: nota com vários parágrafos: o popover mostra a nota inteira, e só ela', () => {
    const base = capitulo(0);
    const primeira = bloco('nota_rodape', 'A pergunta muda');
    const indice = base.blocos.findIndex((b) => b.id === primeira.id);
    // Como o motor tira `<aside epub:type="footnote"><p>…</p><p>…</p></aside>`: um bloco por parágrafo.
    const continuacao: Bloco = { ...primeira, id: 'C'.repeat(26), texto: 'Segundo parágrafo da mesma nota.', inline: [],
      origens: [{ tipo: 'epub', arquivo: 'OPS/capitulo.xhtml', xpath: '/html/body/aside[1]/p[2]' }] };
    const outraNota: Bloco = { ...primeira, id: 'O'.repeat(26), texto: 'Outra nota, noutro aside.', inline: [],
      origens: [{ tipo: 'epub', arquivo: 'OPS/capitulo.xhtml', xpath: '/html/body/aside[2]/p[1]' }] };
    const blocos = [...base.blocos.slice(0, indice + 1), continuacao, outraNota, ...base.blocos.slice(indice + 1)];
    render(<ChapterContent snapshot={{ ...base, blocos }} />);
    fireEvent.click(screen.getByRole('link', { name: 'Nota 1' }));
    const nota = screen.getByRole('dialog', { name: 'Nota 1' });
    expect(nota.textContent).toContain('A pergunta muda porque o leitor mudou');
    expect(nota.textContent).toContain('Segundo parágrafo da mesma nota.');
    expect(nota.textContent).not.toContain('Outra nota');
    // Notas soltas no `body` (um parágrafo cada) não se juntam; um bloco que é destino de chamada também não.
    const soltas = [{ ...primeira, origens: [{ tipo: 'epub' as const, arquivo: 'a', xpath: '/html/body/p[1]' }] },
      { ...continuacao, origens: [{ tipo: 'epub' as const, arquivo: 'a', xpath: '/html/body/p[2]' }] }];
    expect(textoDaNota(soltas, primeira.id)).toBe(primeira.texto);
    const chamador = { ...base.blocos[0]!, inline: [{ inicio: 0, fim: 1, estilo: 'nota_ref' as const, ref: continuacao.id }] };
    expect(textoDaNota([chamador, primeira, continuacao], primeira.id)).toBe(primeira.texto);
  });

  test('nota_ref sem destino (ou sem `ref`) continua só o número sobrescrito', () => {
    const { container } = render(<ChapterContent snapshot={capituloExemplo} />);
    expect(container.querySelector('sup.nota-ref')).not.toBeNull();
    const semRef = { ...capituloExemplo, blocos: capituloExemplo.blocos.map((b) => ({ ...b, inline: b.inline.map((faixa) => ({ inicio: faixa.inicio, fim: faixa.fim, estilo: faixa.estilo })) })) };
    cleanup();
    const { container: outro } = render(<ChapterContent snapshot={semRef} />);
    expect(outro.querySelector('sup.nota-ref')).not.toBeNull();
    expect(outro.querySelector('a[data-rodape]')).toBeNull();
  });
});

describe('tabelas do EPUB', () => {
  test('linhas e células viram grade; a legenda fica em cima e o texto do bloco não muda', () => {
    const tabela = bloco('tabela');
    const { container } = render(<ChapterContent snapshot={capitulo(0)} />);
    const grade = screen.getByRole('table');
    expect(container.querySelector('.tabela-legenda')?.textContent?.trim()).toBe('Tabela 1. Horas de leitura por semana');
    const linhas = within(grade).getAllByRole('row');
    expect(linhas.map((linha) => within(linha).getAllByRole('cell').map((celula) => (celula.textContent ?? '').replace(/ \| $|\n$/, '')))).toEqual([
      ['Leitor', 'Manhã', 'Noite'], ['Ana', '3 h', '5 h'], ['Bruno', '1 h', '6 h'], ['Carla', '4 h', '2 h']]);
    expect(texto(container, tabela.id)).toBe(tabela.texto);
    // Os separadores ficam no DOM (os offsets dependem deles), escondidos e fora da leitura em voz.
    for (const separador of container.querySelectorAll('.separador-da-tabela')) expect(separador.getAttribute('aria-hidden')).toBe('true');
  });

  test('um grifo que atravessa células continua ancorado e só abre um alvo de teclado', () => {
    const tabela = bloco('tabela');
    const inicio = tabela.texto.indexOf('Ana');
    const fim = tabela.texto.indexOf('5 h') + 3;
    const marca = { id: 'M'.repeat(26), ancora: { versao_id: 'V'.repeat(26), bloco_id: tabela.id, inicio_utf16: inicio, fim_utf16: fim, citacao: tabela.texto.slice(inicio, fim), prefixo: '', sufixo: '' },
      origem: 'manual', funcao: 'nenhuma', comentario: null, visivel: true, validade: 'resolvida', subfaixas: [], saliencia: 2 } as unknown as MarcaDoLeitor;
    const snapshot = capitulo(0, [marca]);
    const { container } = render(<ChapterContent snapshot={snapshot} />);
    expect(texto(container, tabela.id)).toBe(tabela.texto);
    const marcados = [...container.querySelectorAll<HTMLElement>(`[data-marcas="${marca.id}"]`)];
    expect(marcados.map((s) => s.textContent).join('')).toBe(tabela.texto.slice(inicio, fim));
    expect(marcados.filter((s) => s.tabIndex === 0)).toHaveLength(1);
    expect(marcados[0]!.tabIndex).toBe(0);
    // DOM → offset e offset → DOM, numa célula do meio.
    const alvo = tabela.texto.indexOf('3 h');
    const intervalo = intervaloDoOffset(container, tabela.id, alvo)!;
    expect(pontoDoNo(intervalo.startContainer, intervalo.startOffset, snapshot)).toEqual({ bloco_id: tabela.id, offset_utf16: alvo });
  });

  test('sem grade inequívoca, a tabela fica como texto com as quebras de linha', () => {
    expect(linhasDaTabela('Legenda\nA | B\nC')).toBeNull();
    expect(linhasDaTabela('Um\nDois\nA | B')).toBeNull();
    expect(linhasDaTabela('A | B\n | C')).toEqual({ legenda: 0 });
    const tabela = { ...bloco('tabela'), texto: 'Lista\nUm\nDois' };
    const snapshot = capitulo(0);
    const { container } = render(<ChapterContent snapshot={{ ...snapshot, blocos: snapshot.blocos.map((b) => b.id === tabela.id ? tabela : b) }} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.querySelector(`[data-bloco="${tabela.id}"] figcaption.legenda`)?.textContent).toBe('Lista\nUm\nDois');
  });
});

describe('figuras do EPUB', () => {
  test('com a imagem, o marcador vira o texto alternativo e sai da legenda; sem imagem, fica visível', () => {
    const { container } = render(<ChapterContent snapshot={capitulo(0)} />);
    const [grafico, ornamento] = canonico.assets;
    const imagem = container.querySelector<HTMLImageElement>(`img[src$="${grafico!.id}"]`)!;
    expect(imagem.alt).toBe('Gráfico de barras com anotações por página');
    expect((imagem.nextElementSibling as HTMLElement).hidden).toBe(true);
    const decorativa = container.querySelector<HTMLImageElement>(`img[src$="${ornamento!.id}"]`)!;
    expect(decorativa.getAttribute('alt')).toBe('');
    expect((decorativa.nextElementSibling as HTMLElement).hidden).toBe(true);
    const semImagem = bloco('figura', 'vetorial');
    const figura = container.querySelector(`[data-bloco="${semImagem.id}"]`)!;
    expect(figura.querySelector('img')).toBeNull();
    expect((figura.querySelector('figcaption') as HTMLElement).hidden).toBe(false);
    expect(figura.textContent).toBe('[Imagem: Esquema vetorial do caderno]');
    // O texto do bloco continua inteiro no DOM (grifos e posições contam com ele).
    expect(texto(container, bloco('figura', 'Gráfico').id)).toBe('[Imagem: Gráfico de barras com anotações por página]');
  });

  test('uma legenda de verdade, com a imagem, continua visível', () => {
    const snapshot = capitulo(0);
    const figura = { ...bloco('figura', 'Gráfico'), texto: 'Figura 1. Anotações por página.' };
    const { container } = render(<ChapterContent snapshot={{ ...snapshot, blocos: snapshot.blocos.map((b) => b.id === figura.id ? figura : b) }} />);
    const legenda = container.querySelector<HTMLElement>(`[data-bloco="${figura.id}"] figcaption`)!;
    expect(legenda.hidden).toBe(false);
    expect(container.querySelector<HTMLImageElement>(`[data-bloco="${figura.id}"] img`)!.alt).toBe('Figura 1. Anotações por página.');
  });
});
