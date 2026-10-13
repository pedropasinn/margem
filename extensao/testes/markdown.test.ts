import { describe, expect, test } from 'vitest';
import { contarPalavras, escaparMarkdown, htmlParaMarkdown } from '../src/extracao/markdown';
import { documentoDeHtml } from './apoio';

const BASE = 'https://exemplo.com.br/2026/artigo';

function converter(html: string, links: 'referencias' | 'inline' = 'referencias'): string {
  return htmlParaMarkdown(documentoDeHtml(`<body>${html}</body>`, BASE).body, { base: BASE, links });
}

describe('htmlParaMarkdown', () => {
  test('títulos, parágrafos, ênfase, listas, citação e código', () => {
    expect(converter(`
      <h2>Seção</h2><p>Texto com <em>ênfase</em>, <strong>negrito</strong> e <code>codigo()</code>.</p>
      <ul><li>um</li><li>dois</li></ul><ol><li>primeiro</li><li>segundo</li></ol>
      <blockquote><p>Citação.</p></blockquote>
      <pre><code class="language-go">fmt.Println("oi")</code></pre>`)).toBe([
      '## Seção', '', 'Texto com *ênfase*, **negrito** e `codigo()`.', '',
      '- um', '- dois', '', '1. primeiro', '2. segundo', '', '> Citação.', '',
      '```go', 'fmt.Println("oi")', '```',
    ].join('\n'));
  });

  test('links viram texto no corpo e endereço na lista final, sem repetir nem levar âncoras internas', () => {
    const markdown = converter('<p>Veja <a href="/outra">a outra página</a>, <a href="#secao">a seção</a> e '
      + '<a href="https://b.org/x_y">um site</a>, de novo <a href="/outra">aqui</a>. <a href="javascript:void(0)">nada</a></p>');
    expect(markdown).toBe([
      'Veja a outra página, a seção e um site, de novo aqui. nada', '', '## Links da página', '',
      '- a outra página: https://exemplo.com.br/outra', '- um site: https://b.org/x\\_y',
    ].join('\n'));
  });

  test('estilo inline devolve Markdown comum', () => {
    expect(converter('<p><a href="/a(b)">link</a> <img src="/f.png" alt="foto"></p>', 'inline'))
      .toBe('[link](https://exemplo.com.br/a(b%29) ![foto](https://exemplo.com.br/f.png)');
  });

  test('imagem fica marcada no lugar e o endereço vai para a lista', () => {
    expect(converter('<figure><img src="foto.jpg" alt="Uma foto"><figcaption>Legenda da foto</figcaption></figure>')).toBe([
      '\\[Imagem: Uma foto\\]', '', '*Legenda da foto*', '', '## Links da página', '',
      '- Imagem: Uma foto: https://exemplo.com.br/2026/foto.jpg',
    ].join('\n'));
  });

  test('chamada de nota vira [n]; voltar da nota some; br vira espaço; hr some', () => {
    const markdown = converter('<p>Frase<sup class="reference"><a href="#cite_note-1">[1]</a></sup> e linha<br>quebrada.</p><hr>'
      + '<ol class="references"><li><span class="mw-cite-backlink"><a href="#cite_ref-1">↑</a></span> Fonte, p. 3.</li></ol>');
    expect(markdown).toBe('Frase\\[1\\] e linha quebrada.\n\n1. Fonte, p. 3.');
  });

  test('tabela vira uma linha por registro', () => {
    expect(converter('<table><tr><th>Autor</th><td>Machado</td></tr><tr><th>Ano</th><td>1899</td></tr></table>'))
      .toBe('Autor · Machado\n\nAno · 1899');
  });

  test('texto que pareceria sintaxe é escapado como o motor desfaz', () => {
    expect(converter('<p># não é título</p><p>1. não é lista</p><p>---</p><p>a*b*c e [x]</p>'))
      .toBe('\\# não é título\n\n1\\. não é lista\n\n\\---\n\na\\*b\\*c e \\[x\\]');
    expect(escaparMarkdown('> citação falsa\n- item falso')).toBe('\\> citação falsa\n\\- item falso');
  });
});

test('contarPalavras conta palavras com acento, hífen e números', () => {
  expect(contarPalavras('Pé-de-moleque custa R$ 3,50 — é “barato”.')).toBe(7);
});
