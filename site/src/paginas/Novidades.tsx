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
    resumo: `Primeira versão para instalar no seu computador. O ${N} é um assistente de estudos, um app de desktop para Windows e Linux (macOS em breve), usa a sua conta do ChatGPT pelo Codex e guarda a biblioteca numa pasta sua.`,
    grupos: [
      { titulo: 'Instalação', itens: [
        'App de desktop com tudo dentro: instalador para Windows (.exe) e Linux (AppImage e .deb). A versão para macOS vem em breve.',
        'Biblioteca numa pasta escolhida por você; backup é copiar a pasta.',
        'Login do ChatGPT pelo navegador, aberto pelo próprio app.',
        'Atualização automática dentro do app.',
        'Tela de boas-vindas que confere o banco, a preparação de textos e o Codex, com um exemplo já marcado para começar sem gastar cota.',
        'Avisos claros quando o Codex sai da conta ou a cota acaba; as leituras esperam na fila e continuam sozinhas.',
      ] },
      { titulo: 'Biblioteca', itens: [
        'Adicionar em três abas, Documento, Vídeo e Quadro: arraste vários arquivos de uma vez, com fila e opções por arquivo.',
        'PDF, EPUB, Markdown, TXT e texto colado.',
        'PDF mostrado como o original, com o texto extraído por trás; PDF escaneado transcrito página por página.',
        'Vídeos do YouTube pelo link, com as legendas do próprio vídeo, tocados pelo player oficial do YouTube.',
        'Vídeo e áudio próprios com transcrição em JSON. Análise própria do vídeo: transcrição passada a limpo, partes por assunto, momentos que aparecem sobre o vídeo e karaokê.',
        'Busca, progresso de leitura e retomada no mesmo parágrafo.',
      ] },
      { titulo: 'Leitura', itens: [
        'Botão Analisar na página do documento: o Codex grifa os trechos e liga uns aos outros, com o modo de leitura do tipo de texto (conto, poesia, ensaio, filosofia, economia, direito e outros).',
        'Cada grifo tem modo e função, e o comentário do Codex fica na margem. No balão, as funções do modo e, em Outros olhares, as dos outros modos.',
        'A sua nota vive dentro do grifo e se salva sozinha. O botão Marcas mostra ou esconde os grifos.',
        'Perguntar ao trecho e conectar trechos, do mesmo documento ou de outro.',
        'Perguntar à biblioteca inteira, em conversa, com as citações de onde vem cada resposta.',
        'Notas como central de tudo o que você grifou, anotou, perguntou e conectou, com busca e exportação.',
        'Apagar grifos, relações ou a análise inteira, sempre com confirmação.',
        'Relações entre os trechos, desenhadas à esquerda do texto, com a explicação de cada uma.',
        'Resolução de exercícios passo a passo a partir de um print colado ou de um recorte do PDF, com a ideia antes da conta e a matemática renderizada.',
      ] },
      { titulo: 'Quadros', itens: [
        'Adicionar obra: envie a imagem de uma obra de arte; o Margem identifica a obra (título, artista, data) em fontes abertas e prepara a análise guiada.',
        'Zoom, regiões na imagem, Percorrer e análise curta com legenda.',
      ] },
      { titulo: 'Integrações', itens: [
        'Extensão para Chrome, Edge, Brave e Firefox, que manda páginas e PDFs para o app.',
        'Plugin do Obsidian que leva grifos, relações e notas para o cofre, um arquivo Markdown por item.',
        'Narração opcional com a sua chave da ElevenLabs, em Configurações → Áudio, com custo estimado antes de gerar.',
        'Configurações → Modelos: escolha o modelo e o esforço do Codex para cada tipo de tarefa.',
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
        <p className="docs-resumo">O que mudou em cada versão do {N}. O app se atualiza sozinho; veja <a href="/docs/atualizacoes/">Atualizações</a>.</p>
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
