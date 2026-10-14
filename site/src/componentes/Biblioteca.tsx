import type { ReactNode } from 'react';
import { Icone } from './Icone';
import { IconeDeFormato, type NomeDoFormato } from './IconeDeFormato';
import { CONFIG } from '../config';

/*
 * O que entra na biblioteca, conferido no código do app:
 * - `web/src/biblioteca/importacao.ts` (`POR_EXTENSAO`, `ACEITOS`, limites de 200 MB por documento,
 *   4 GB por mídia e 25 MB por imagem de questão; mídia própria só com a transcrição .json);
 * - `servico/src/http/rotas-importacoes.ts` (YouTube por link; web pela extensão; questão PNG/JPEG);
 * - `servico/src/http/rotas-arte.ts` (obra em Quadros: JPEG, PNG ou WebP até 40 MB; HEIC recusado);
 * - `web/src/biblioteca/OutrasFontes.tsx` (marcas de outro arquivo, em "Avançado").
 */
const PRINCIPAIS: { icone: NomeDoFormato; nome: string; detalhe: string }[] = [
  { icone: 'pdf', nome: 'PDF', detalhe: '.pdf' },
  { icone: 'epub', nome: 'EPUB', detalhe: '.epub' },
  { icone: 'markdown', nome: 'Markdown', detalhe: '.md' },
  { icone: 'texto', nome: 'Texto', detalhe: '.txt' },
  { icone: 'web', nome: 'Página da web', detalhe: 'pela extensão' },
  { icone: 'youtube', nome: 'YouTube', detalhe: 'link' },
  { icone: 'video', nome: 'Vídeo', detalhe: '.mp4 .mov .webm' },
  { icone: 'audio', nome: 'Áudio', detalhe: '.mp3 .m4a .ogg' },
  { icone: 'imagem', nome: 'Print de questão', detalhe: '.png .jpg' },
  { icone: 'quadro', nome: 'Obra de arte', detalhe: '.jpg .png .webp' },
];

const TODOS: { grupo: string; itens: { nome: string; extensoes: string; nota: string }[] }[] = [
  { grupo: 'Textos', itens: [
    { nome: 'PDF', extensoes: '.pdf', nota: 'Aparece como o original. Escaneado também: as páginas sem texto podem ser transcritas por visão.' },
    { nome: 'EPUB', extensoes: '.epub', nota: 'Com os capítulos do próprio livro.' },
    { nome: 'Markdown', extensoes: '.md .markdown', nota: 'Em prosa ou poesia.' },
    { nome: 'Texto', extensoes: '.txt', nota: 'Em prosa ou poesia.' },
    { nome: 'Texto colado', extensoes: '—', nota: 'Cole e adicione; a primeira linha vira o título.' },
  ] },
  { grupo: 'Da internet', itens: [
    { nome: 'Página da web', extensoes: '—', nota: 'Artigo, post ou PDF aberto no navegador, pela extensão (Chrome, Edge, Brave e Firefox).' },
    { nome: 'Vídeo do YouTube', extensoes: 'link', nota: 'O texto vem das legendas do próprio vídeo, que toca no player oficial.' },
  ] },
  { grupo: 'Vídeo e áudio seus', itens: [
    { nome: 'Vídeo', extensoes: '.mp4 .m4v .mov .webm .mkv', nota: 'Junto com a transcrição.' },
    { nome: 'Áudio', extensoes: '.mp3 .m4a .aac .ogg .oga .opus', nota: 'Junto com a transcrição.' },
    { nome: 'Transcrição', extensoes: '.json', nota: 'No formato do Margem (gerada pelo Whisper). O app ainda não transcreve sozinho.' },
  ] },
  { grupo: 'Imagens', itens: [
    { nome: 'Print de questão', extensoes: '.png .jpg .jpeg', nota: 'Cole ou solte: vira uma página e a resolução começa. WebP e HEIC, se o navegador abrir.' },
    { nome: 'Obra de arte', extensoes: '.jpg .png .webp', nota: 'Em Quadros, para a análise guiada. Fotos HEIC: exporte em JPEG.' },
  ] },
  { grupo: 'Avançado', itens: [
    { nome: 'Marcas de outro arquivo', extensoes: '.json', nota: 'Para um documento que já está na biblioteca.' },
  ] },
];

/** "Tudo o que você estuda. Em um só lugar.": formatos, a lista completa e a faixa da pasta local. */
export function Biblioteca(): ReactNode {
  return (
    <section id="biblioteca" className="secao biblioteca secao-painel" aria-labelledby="biblioteca-titulo">
      <div className="container">
        <h2 id="biblioteca-titulo" className="titulo-de-secao">Tudo o que você estuda. Em um só lugar.</h2>
        <p className="texto-de-secao">Livros, artigos, vídeos, áudios e obras de arte. Traga os seus materiais e organize o seu próprio ambiente de estudos.</p>
        <ul className="formatos" role="list">
          {PRINCIPAIS.map((f) => (
            <li key={f.nome}><IconeDeFormato nome={f.icone} /><strong>{f.nome}</strong><span>{f.detalhe}</span></li>
          ))}
        </ul>
        <details className="todos-os-formatos">
          <summary><span>Ver todos os formatos</span><span className="faq-sinal" aria-hidden="true" /></summary>
          <div className="todos-os-formatos-corpo">
            {TODOS.map((g) => (
              <div key={g.grupo} className="formatos-grupo">
                <h3>{g.grupo}</h3>
                <dl>
                  {g.itens.map((i) => (
                    <div key={i.nome}><dt>{i.nome}{i.extensoes !== '—' && <> <code>{i.extensoes}</code></>}</dt><dd>{i.nota}</dd></div>
                  ))}
                </dl>
              </div>
            ))}
            <p className="formatos-limites">Até 200 MB por documento, 4 GB por vídeo ou áudio, 25 MB por print e 40 MB por obra. <a href="/docs/importar/">Como adicionar cada um</a></p>
          </div>
        </details>
        <div className="faixa-privada">
          <span className="faixa-privada-icone"><IconeDeFormato nome="pasta" tamanho={22} /></span>
          <p>
            <strong>A biblioteca fica numa pasta do seu computador, que você escolhe.</strong> Sem conta no {CONFIG.nome} e sem métricas de uso.
            Usam a rede só o Codex, pela sua conta do ChatGPT, e o que você pedir: vídeos do YouTube, a pesquisa de obras no Wikidata e na Wikipédia, a voz da ElevenLabs.
          </p>
          <a className="link-seta" href="/docs/perguntas/#privacidade">Privacidade<Icone nome="seta" tamanho={16} /></a>
        </div>
      </div>
    </section>
  );
}
