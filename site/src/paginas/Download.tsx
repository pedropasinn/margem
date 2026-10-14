import type { ReactNode } from 'react';
import { Plataformas, RequisitosGerais } from '../componentes/Baixar';
import { Icone, type NomeDoIcone } from '../componentes/Icone';
import { Cabecalho, Rodape } from '../componentes/Moldura';
import { CONFIG } from '../config';

const N = CONFIG.nome;

const PASSOS: { titulo: string; texto: string }[] = [
  { titulo: 'Escolha a pasta da biblioteca', texto: 'Seus livros, marcas e notas moram nela, no seu computador. Pode ser uma pasta nova ou uma que já sincroniza com o seu backup.' },
  { titulo: 'Entre com a sua conta do ChatGPT', texto: 'O app abre o navegador para você entrar. As leituras usam a sua assinatura, pelo Codex.' },
  { titulo: 'Adicione o primeiro texto', texto: 'Arraste um PDF, um EPUB ou um Markdown, ou abra o exemplo já marcado para ver o leitor antes de gastar cota.' },
];

const COMPLEMENTOS: { icone: NomeDoIcone; titulo: string; texto: string; href: string }[] = [
  { icone: 'extensao', titulo: 'Extensão do navegador', texto: 'Mande artigos e PDFs abertos no Chrome, Edge, Brave ou Firefox para a biblioteca.', href: '/docs/extensao/' },
  { icone: 'obsidian', titulo: 'Plugin do Obsidian', texto: 'Leve grifos, notas, perguntas e conexões para o seu cofre.', href: '/docs/obsidian/' },
  { icone: 'conectar', titulo: 'Código-fonte', texto: `O ${N} é aberto, sob a licença ${CONFIG.licenca}. Leia, compile e contribua.`, href: '/docs/contribuir/' },
];

export function Download(): ReactNode {
  return (
    <>
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <Cabecalho secao="download" />
      <main id="conteudo" className="download">
        <section className="container download-topo" aria-labelledby="download-titulo">
          <p className="sobretitulo">Versão {CONFIG.versao} · {CONFIG.dataDaVersao}</p>
          <h1 id="download-titulo">Baixe o {N}.</h1>
          <p className="docs-resumo">
            Para Windows e Linux; macOS em breve. Gratuito, de código aberto e com tudo dentro: instale, escolha a pasta da biblioteca e comece a ler.
          </p>
          <Plataformas detalhado />
          <RequisitosGerais />
        </section>

        <section className="secao-painel download-secao" aria-labelledby="depois-titulo">
          <div className="container">
            <h2 id="depois-titulo">Depois de instalar</h2>
            <ol className="download-passos" role="list">
              {PASSOS.map((p, i) => (
                <li key={p.titulo} className="cartao">
                  <span className="download-numero" aria-hidden="true">{i + 1}</span>
                  <h3>{p.titulo}</h3>
                  <p>{p.texto}</p>
                </li>
              ))}
            </ol>
            <a className="link-seta" href="/docs/primeiros-passos/">Primeiros passos<Icone nome="seta" tamanho={16} /></a>
          </div>
        </section>

        <section className="container download-secao" aria-labelledby="aviso-titulo">
          <h2 id="aviso-titulo">Na primeira vez que você abrir</h2>
          <p className="ideia-texto">
            O {N} ainda não tem assinatura digital da Microsoft. Por isso, o Windows pode avisar que o app é de um
            desenvolvedor desconhecido. É esperado: a instalação mostra como seguir em cada sistema.
          </p>
          <ul className="fichas-doc" role="list" aria-label="Avisos por sistema">
            <li><a href="/docs/instalacao/#windows">Windows: SmartScreen</a></li>
            <li><a href="/docs/instalacao/#linux">Linux: AppImage executável</a></li>
          </ul>
        </section>

        <section className="container download-secao" aria-labelledby="mais-titulo">
          <h2 id="mais-titulo">Complementos</h2>
          <ul className="integracoes" role="list">
            {COMPLEMENTOS.map((c) => (
              <li key={c.titulo} className="cartao integracao">
                <span className="recurso-icone"><Icone nome={c.icone} /></span>
                <h3>{c.titulo}</h3>
                <p>{c.texto}</p>
                <a className="link-seta" href={c.href}>Como usar<Icone nome="seta" tamanho={16} /></a>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <Rodape />
    </>
  );
}
