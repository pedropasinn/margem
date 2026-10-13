import type { ReactNode } from 'react';
import { BotaoDeDownload, detectarSistema, SISTEMAS, type Sistema } from '../componentes/Baixar';
import { Captura } from '../componentes/Captura';
import { Comando } from '../componentes/Comando';
import { Demonstracao } from '../componentes/Demonstracao';
import { Icone, type NomeDoIcone } from '../componentes/Icone';
import { Cabecalho, Rodape } from '../componentes/Moldura';
import { COMANDO_DE_INSTALACAO, COMANDO_DE_INSTALACAO_WINDOWS, CONFIG, downloadEmPreparacao } from '../config';

const N = CONFIG.nome;

const PLATAFORMAS: { sistema: Sistema; requisito: string; comando: string; rotulo: string }[] = [
  { sistema: 'linux', requisito: 'Docker Engine com o plugin Compose.', comando: COMANDO_DE_INSTALACAO, rotulo: 'Terminal' },
  { sistema: 'macos', requisito: 'Docker Desktop para Mac, Apple Silicon ou Intel.', comando: COMANDO_DE_INSTALACAO, rotulo: 'Terminal' },
  { sistema: 'windows', requisito: 'Windows 10 ou 11 com Docker Desktop.', comando: COMANDO_DE_INSTALACAO_WINDOWS, rotulo: 'PowerShell' },
];

const INTEGRACOES: { icone: NomeDoIcone; titulo: string; texto: string; href: string }[] = [
  { icone: 'obsidian', titulo: 'Obsidian', texto: 'Grifos, notas, perguntas e conexões vão para o seu cofre, com link de volta para o trecho.', href: '/docs/obsidian/' },
  { icone: 'extensao', titulo: 'Extensão de navegador', texto: 'Um clique manda o artigo ou o PDF aberto para a biblioteca. Chrome, Edge, Brave e Firefox.', href: '/docs/extensao/' },
  { icone: 'ouvir', titulo: 'Áudio com ElevenLabs', texto: 'Opcional: cole a sua chave e ouça o capítulo com o trecho acompanhando a voz.', href: '/docs/audio/' },
];

function Ideia({ id, sobretitulo, titulo, children, painel = false }: { id: string; sobretitulo: string; titulo: string; children: ReactNode; painel?: boolean }): ReactNode {
  return (
    <section id={id} className={painel ? 'ideia secao-painel' : 'ideia'} aria-labelledby={`${id}-titulo`}>
      <div className="container">
        <p className="sobretitulo">{sobretitulo}</p>
        <h2 id={`${id}-titulo`}>{titulo}</h2>
        {children}
      </div>
    </section>
  );
}

export function Inicio(): ReactNode {
  const detectado = detectarSistema();
  return (
    <>
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <Cabecalho secao="inicio" />
      <main id="conteudo">
        <section className="heroi" aria-labelledby="heroi-titulo">
          <div className="container heroi-texto">
            <h1 id="heroi-titulo">Leia mais fundo.</h1>
            <p className="heroi-sub">
              O {N} marca o que cada trecho faz no seu texto e deixa uma nota na margem.
              No seu computador, com a sua conta do ChatGPT.
            </p>
            <BotaoDeDownload nome={N} />
          </div>
          <div className="container heroi-captura">
            <Captura nome="nota-aberta" className="captura-grande"
              alt="O leitor do app com um conto de Machado de Assis: trechos marcados em cores e, na margem, a nota da marca 2 aberta." />
          </div>
        </section>

        <Ideia id="leitura" sobretitulo="Leitura aumentada" titulo="O texto continua no centro. A compreensão fica em volta.">
          <p className="ideia-texto">
            Tese, argumento, objeção, definição: cada modo de leitura marca o que importa naquele tipo de texto.
            Você escolhe quanto ver, do texto puro ao detalhe. O PDF aparece como foi publicado.
          </p>
          <div className="ideia-demo"><Demonstracao /></div>
        </Ideia>

        <Ideia id="privacidade" sobretitulo="Privado" titulo="Seus livros ficam no seu computador." painel>
          <p className="ideia-texto">
            O {N} não é um serviço na nuvem. Você instala, e a biblioteca mora numa pasta sua.
            Não há conta para criar, servidor nosso guardando nada nem métricas de uso.
          </p>
          <ul className="fatos" role="list">
            <li><Icone nome="cadeado" /><strong>Sem nuvem</strong><span>Arquivos, marcas e notas ficam com você.</span></li>
            <li><Icone nome="proibido" /><strong>Sem rastreio</strong><span>O app não manda dados de uso para ninguém.</span></li>
            <li><Icone nome="extensao" /><strong>Sem prisão</strong><span>Backup numa pasta, exportação para o Obsidian.</span></li>
          </ul>
        </Ideia>

        <Ideia id="conta" sobretitulo="Sua IA" titulo="Use a sua própria conta de IA.">
          <p className="ideia-texto">
            As leituras saem do ChatGPT, pela sua assinatura, via Codex. Sem outra mensalidade de IA e sem intermediário:
            o texto vai da sua máquina para a sua conta.
          </p>
          <a className="link-seta" href="/docs/perguntas/#cota">Como funciona a cota<Icone nome="seta" tamanho={16} /></a>
        </Ideia>

        <Ideia id="perguntar" sobretitulo="Perguntar, anotar, conectar" titulo="Pergunte ao texto, não a um chat." painel>
          <p className="ideia-texto">
            Selecione um trecho para grifar, anotar, perguntar ou ligar a outro. A resposta cita os parágrafos em que se apoia
            e fica presa ao trecho de onde a pergunta saiu.
          </p>
          <Captura nome="selecao" className="captura-media" largura={2000} altura={880}
            alt="Um trecho selecionado no leitor, com a barra de ações: Grifar, Anotar, Perguntar e Conectar." />
        </Ideia>

        <Ideia id="integracoes" sobretitulo="Integrações" titulo="Leve para onde quiser.">
          <ul className="integracoes" role="list">
            {INTEGRACOES.map((item) => (
              <li key={item.titulo} className="cartao integracao">
                <span className="recurso-icone"><Icone nome={item.icone} /></span>
                <h3>{item.titulo}</h3>
                <p>{item.texto}</p>
                <a className="link-seta" href={item.href}>Como usar<Icone nome="seta" tamanho={16} /></a>
              </li>
            ))}
          </ul>
        </Ideia>

        <Ideia id="codigo-aberto" sobretitulo="Código aberto" titulo="Aberto, para ler como você lê." painel>
          <p className="ideia-texto">
            O código do {N} é aberto, sob a licença {CONFIG.licenca}. Confira o que ele faz com os seus arquivos,
            adapte ao seu jeito e ajude a melhorar.
          </p>
          <div className="ideia-acoes">
            <a className="botao" href={CONFIG.urlDoRepositorio}>Ver o código</a>
            <a className="link-seta" href="/docs/contribuir/">Como contribuir<Icone nome="seta" tamanho={16} /></a>
          </div>
        </Ideia>

        <section id="baixar" className="ideia baixar" aria-labelledby="baixar-titulo">
          <div className="container">
            <p className="sobretitulo">Versão {CONFIG.versao} · {CONFIG.dataDaVersao}</p>
            <h2 id="baixar-titulo">Baixe o {N}.</h2>
            <p className="ideia-texto">
              Um comando instala tudo com o Docker. Depois, abra <code>{CONFIG.enderecoLocal}</code> e entre uma vez com a sua conta do ChatGPT.
            </p>
            {downloadEmPreparacao && (
              <p className="aviso-provisorio" role="note"><strong>Download em preparação.</strong> O primeiro release ainda não foi publicado; os comandos abaixo passam a funcionar quando ele sair.</p>
            )}
            <ul className="plataformas" role="list">
              {PLATAFORMAS.map((p) => (
                <li key={p.sistema} id={`baixar-${p.sistema}`} className="cartao plataforma" data-detectado={p.sistema === detectado}>
                  <div className="plataforma-topo">
                    <h3>{SISTEMAS[p.sistema]}</h3>
                    {p.sistema === detectado && <span className="selo" data-disponivel="true">Seu sistema</span>}
                  </div>
                  <p>{p.requisito}</p>
                  <Comando rotulo={p.rotulo}>{p.comando}</Comando>
                  <a className="link-seta" href={`/docs/instalacao/#${p.sistema}`}>Passo a passo<Icone nome="seta" tamanho={16} /></a>
                </li>
              ))}
            </ul>
            <p className="baixar-requisitos">
              Você vai precisar de uma conta do ChatGPT com acesso ao Codex e de uns 5 GB livres. Processadores {CONFIG.arquiteturas}.
              {' '}<a href={CONFIG.urlDoRelease}>Página do release</a> · <a href="/novidades/">O que há de novo</a>
            </p>
          </div>
        </section>
      </main>
      <Rodape />
    </>
  );
}
