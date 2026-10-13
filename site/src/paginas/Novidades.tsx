import type { ReactNode } from 'react';
import { Cabecalho, Rodape } from '../componentes/Moldura';
import { CONFIG } from '../config';

const N = CONFIG.nome;

interface Versao { nome: string; data: string; dataIso: string; resumo: string; grupos: { titulo: string; itens: string[] }[] }

const VERSOES: readonly Versao[] = [
  {
    nome: CONFIG.versao,
    data: CONFIG.dataDaVersao,
    dataIso: '2026-10-12',
    resumo: `Primeira versão para instalar no seu computador. O ${N} roda no Docker, usa a sua conta do ChatGPT pelo Codex e guarda a biblioteca com você.`,
    grupos: [
      { titulo: 'Instalação', itens: [
        'Instalador para Linux e macOS (instalar.sh) e para Windows (instalar.ps1), com Docker.',
        `Comando ${CONFIG.comando} para iniciar, parar, ver o estado, entrar no ChatGPT, atualizar, fazer backup, restaurar, ver os registros e desinstalar.`,
        'Login do Codex pelo código de dispositivo, uma vez por instalação.',
        'Tela de boas-vindas que confere o banco, a preparação de textos e o Codex, com um exemplo já marcado para começar sem gastar cota.',
        'Avisos claros quando o Codex sai da conta ou a cota acaba; as leituras esperam na fila e continuam sozinhas.',
      ] },
      { titulo: 'Biblioteca', itens: [
        'Página de adicionar refeita: arraste vários arquivos de uma vez, com fila, opções por arquivo e o texto preparado à vista.',
        'PDF, EPUB, Markdown, TXT e texto colado.',
        'PDF mostrado como o original, com o texto extraído por trás; PDF escaneado transcrito página por página.',
        'Vídeos do YouTube pelo link, com as legendas do próprio vídeo, tocados pelo player oficial do YouTube.',
        'Vídeo e áudio próprios com transcrição em JSON, tocados alinhados ao texto.',
        'Busca, progresso de leitura e retomada no mesmo parágrafo.',
      ] },
      { titulo: 'Leitura', itens: [
        'Modos de leitura: argumentativo, filosófico, econômico, literário, matemático, jornalístico, jurídico e outros.',
        'Marcas por função com nota na margem, em marca-texto ou sublinhado.',
        'Quatro níveis de atenção, de Texto puro a Aprofundar, e a opção Primeiro eu.',
        'Grifar, anotar, perguntar ao texto e conectar trechos.',
      ] },
      { titulo: 'Quadros', itens: [
        'Obras de arte em domínio público com zoom, regiões na imagem e análise guiada.',
        `Acervo de cerca de 137 obras num pacote à parte, instalado com ${CONFIG.comando} arte instalar, com licença e crédito de cada imagem.`,
      ] },
      { titulo: 'Integrações', itens: [
        'Extensão para Chrome, Edge, Brave e Firefox, apontando para a sua instalação.',
        'Plugin do Obsidian que leva grifos, notas, perguntas e conexões para o cofre.',
        'Narração opcional com a sua chave da ElevenLabs, em Configurações → Áudio, com custo estimado antes de gerar.',
      ] },
    ],
  },
];

export function Novidades(): ReactNode {
  return (
    <>
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <Cabecalho secao="novidades" />
      <main id="conteudo" className="container novidades">
        <h1>Novidades</h1>
        <p className="docs-resumo">O que mudou em cada versão do {N}. Para atualizar, veja <a href="/docs/manutencao/#atualizar">Atualizar</a>.</p>
        {VERSOES.map((v) => (
          <article key={v.nome} className="cartao versao" aria-labelledby={`versao-${v.nome}`}>
            <header className="versao-cabeca">
              <h2 id={`versao-${v.nome}`}>{v.nome}</h2>
              <time dateTime={v.dataIso}>{v.data}</time>
              <span className="selo" data-disponivel="true">Atual</span>
            </header>
            <p className="versao-resumo">{v.resumo}</p>
            {v.grupos.map((g) => (
              <section key={g.titulo} className="versao-grupo">
                <h3>{g.titulo}</h3>
                <ul>{g.itens.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ))}
          </article>
        ))}
      </main>
      <Rodape />
    </>
  );
}
