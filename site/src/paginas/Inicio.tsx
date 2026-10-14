import type { ReactNode } from 'react';
import { BotaoDeDownload, Plataformas, RequisitosGerais } from '../componentes/Baixar';
import { Biblioteca } from '../componentes/Biblioteca';
import { Captura } from '../componentes/Captura';
import { Demonstracao } from '../componentes/Demonstracao';
import { Icone } from '../componentes/Icone';
import { Cabecalho, Rodape } from '../componentes/Moldura';
import { OutrasFormas } from '../componentes/OutrasFormas';
import { CONFIG } from '../config';

const N = CONFIG.nome;

/** A galeria do app real: capturas de `servico/src/ferramentas/capturar-readme.ts` (as mesmas do README). */
const GALERIA: { nome: string; titulo: string; texto: string; alt: string }[] = [
  { nome: 'pdf', titulo: 'PDF como foi publicado.', texto: 'Os grifos ficam sobre a página original, cada cor uma função, com o comentário do Codex na margem.',
    alt: 'Um PDF de Machado de Assis com grifos por função e o comentário do Codex na margem.' },
  { nome: 'video', titulo: 'Vídeo com análise própria.', texto: 'Transcrição grifada, palavra falada acesa, partes por assunto e momentos que aparecem sobre o vídeo.',
    alt: 'Um vídeo com a transcrição grifada, as partes, os momentos e um cartão aberto sobre o vídeo.' },
  { nome: 'notas', titulo: 'Notas, a central de tudo.', texto: 'Grifos, notas, perguntas, relações e dificuldades de todos os documentos, com busca, filtros e exportação.',
    alt: 'A página Notas com perguntas, relações e grifos de vários documentos.' },
];

/*
 * A página inicial em cinco partes (J121): a abertura com o recorte do leitor; aprofundar a partir do
 * trecho; outras formas de estudar, com o próprio app em cada aba; a biblioteca (formatos e a pasta
 * local); e o download.
 */
export function Inicio(): ReactNode {
  return (
    <>
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <Cabecalho secao="inicio" />
      <main id="conteudo">
        <section className="heroi" aria-labelledby="heroi-titulo">
          <div className="container heroi-texto">
            <h1 id="heroi-titulo">Tenha uma formação integral.</h1>
            <p className="heroi-sub">
              Um ambiente de estudos para livros, artigos, poemas, vídeos e obras de arte. O {N} mostra o que cada trecho faz
              e como ele se liga aos outros. Não torna o estudo mais rápido: torna-o mais profundo.
            </p>
            <BotaoDeDownload nome={N} />
          </div>
          <div className="heroi-demo"><Demonstracao /></div>
        </section>

        <section id="aprofundar" className="secao aprofundar" aria-labelledby="aprofundar-titulo">
          <div className="container aprofundar-grade">
            <div className="aprofundar-texto">
              <h2 id="aprofundar-titulo" className="titulo-de-secao">Pergunte ao texto, não a um chat.</h2>
              <p className="texto-de-secao">
                Clique num grifo do Codex para ver o que o trecho faz e o comentário na margem. Selecione outro trecho para grifar, com a sua
                nota dentro do grifo, perguntar ou ligá-lo a outro, do mesmo livro ou de outro. A resposta cita os parágrafos em que se apoia e
                fica presa ao trecho de onde a pergunta saiu. O PDF continua como foi publicado.
              </p>
              <a className="link-seta" href="/docs/relacoes/">Grifos e relações<Icone nome="seta" tamanho={16} /></a>
            </div>
            <Captura nome="grifo" className="aprofundar-captura" largura={1600} altura={1000}
              alt="O balão de um grifo no app: as funções do modo de leitura, Outros olhares e a nota do leitor dentro do grifo." />
          </div>
        </section>

        <section id="app" className="secao app-real" aria-labelledby="app-titulo">
          <div className="container">
            <h2 id="app-titulo" className="titulo-de-secao">O app, como ele é.</h2>
            <p className="texto-de-secao">Capturas do {N} de verdade, com textos em domínio público.</p>
            <ul className="galeria-app" role="list">
              {GALERIA.map((g) => (
                <li key={g.nome}>
                  <Captura nome={g.nome} largura={1600} altura={1000} alt={g.alt} />
                  <p><strong>{g.titulo}</strong> {g.texto}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <OutrasFormas />

        <Biblioteca />

        <section id="baixar" className="secao baixar" aria-labelledby="baixar-titulo">
          <div className="container">
            <h2 id="baixar-titulo" className="titulo-de-secao">Baixe o {N}.</h2>
            <p className="texto-de-secao">
              Instale como qualquer app. Na primeira vez, escolha a pasta da biblioteca e entre com a sua conta do ChatGPT. Versão {CONFIG.versao}, de {CONFIG.dataDaVersao}.
            </p>
            <Plataformas />
            <RequisitosGerais />
            <ul className="baixar-fatos" role="list">
              <li><strong>A sua conta de IA.</strong> As leituras saem do Codex, pela sua assinatura do ChatGPT: sem outra mensalidade e sem intermediário. <a href="/docs/perguntas/#cota">Como funciona a cota</a></li>
              <li><strong>Código aberto.</strong> Licença {CONFIG.licenca}: dá para ler o que o app faz com os seus arquivos. <a href={CONFIG.urlDoRepositorio}>Ver o código</a></li>
            </ul>
          </div>
        </section>
      </main>
      <Rodape />
    </>
  );
}
