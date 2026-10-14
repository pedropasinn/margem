import { useState, type ReactNode } from 'react';
import { NOTA } from '../demo/obsidian';

/** O papel de cada linha do Markdown, só para a cor (o texto é o que o exportador escreveu, intacto). */
function classeDaLinha(linha: string): string | undefined {
  if (/^%%.*%%$/.test(linha) || /^\^margem-/.test(linha)) return 'md-discreto';
  if (/^#{1,6} /.test(linha)) return 'md-titulo';
  if (/^> \[!/.test(linha)) return 'md-callout';
  if (linha.startsWith('>')) return 'md-citacao';
  return undefined;
}

/**
 * A nota que chega ao cofre do Obsidian, gerada agora, no navegador, pelo exportador do app
 * (`demo/obsidian.ts`), a partir do recorte do herói. Mostrada como o arquivo é: Markdown.
 */
export default function DemoDoObsidian(): ReactNode {
  const [propriedades, mostrarPropriedades] = useState(false);
  const todas = NOTA.conteudo.trimEnd().split('\n');
  // As propriedades (frontmatter YAML) ficam recolhidas, como o Obsidian as mostra; o resto, linha a linha.
  const fim = todas.indexOf('---', 1);
  const cabeca = todas.slice(0, fim + 1);
  const corpo = todas.slice(fim + 1);
  return (
    <figure className="demo-obsidian">
      <div className="md-arquivo">
        <span className="md-caminho">Margem/{NOTA.arquivo}</span>
        <span className="md-itens">{NOTA.itens} trechos</span>
      </div>
      <pre className="md-corpo" tabIndex={0} aria-label={`A nota ${NOTA.arquivo}, em Markdown`}>
        <code>
          {propriedades
            ? cabeca.map((linha, i) => <span key={`p${i}`} className="md-meta">{linha}{'\n'}</span>)
            : <><button type="button" className="md-propriedades" onClick={() => { mostrarPropriedades(true); }}>--- {cabeca.length - 2} propriedades (titulo, autor, fonte, tags…) ---</button>{'\n'}</>}
          {corpo.map((linha, i) => <span key={i} className={classeDaLinha(linha)}>{linha}{'\n'}</span>)}
        </code>
      </pre>
    </figure>
  );
}
