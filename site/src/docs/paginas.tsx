import type { ReactNode } from 'react';
import { Comando } from '../componentes/Comando';
import {
  COMANDO_DE_INSTALACAO, COMANDO_DE_INSTALACAO_WINDOWS, COMANDO_DE_LOGIN, CONFIG, downloadEmPreparacao,
} from '../config';

const N = CONFIG.nome;
const PASTA = CONFIG.pastaDeInstalacao;
const PASTA_WIN = CONFIG.pastaDeInstalacaoWindows;
const CMD = CONFIG.comando;

export type Grupo = 'Começar' | 'Integrações' | 'Manutenção' | 'Ajuda';

export interface PaginaDeDoc {
  slug: string;
  titulo: string;
  resumo: string;
  grupo: Grupo;
  corpo: () => ReactNode;
}

/** Caixa de destaque: fundo e borda completa (nunca faixa lateral). */
function Nota({ tipo = 'info', titulo, children }: { tipo?: 'info' | 'aviso'; titulo: string; children: ReactNode }): ReactNode {
  return (
    <aside className="nota-doc" data-tipo={tipo}>
      <p className="nota-doc-titulo">{titulo}</p>
      {children}
    </aside>
  );
}

function Passos({ children }: { children: ReactNode }): ReactNode {
  return <ol className="passos-doc">{children}</ol>;
}

const instalacao: PaginaDeDoc = {
  slug: 'instalacao',
  titulo: 'Instalação',
  resumo: `Instale o ${N} no Linux, no macOS ou no Windows e entre com a sua conta do ChatGPT.`,
  grupo: 'Começar',
  corpo: () => (
    <>
      <p>O {N} roda no Docker, num pacote que traz o app, o banco de dados e o Codex. Você instala uma vez e abre no navegador, em <code>{CONFIG.enderecoLocal}</code>.</p>
      <nav className="fichas-doc" aria-label="Escolha o sistema">
        <a href="#linux">Linux</a><a href="#macos">macOS</a><a href="#windows">Windows</a><a href="#codex">Entrar no ChatGPT</a>
      </nav>

      <h2 id="requisitos">Antes de começar</h2>
      <ul>
        <li>Linux, macOS ou Windows 10/11, em {CONFIG.arquiteturas}.</li>
        <li>Uns 5 GB livres em disco, mais o espaço dos seus livros (e uns 1 GB a mais se quiser o <a href="/docs/quadros/">acervo de quadros</a>).</li>
        <li>Uma conta do ChatGPT num plano que inclua o Codex.</li>
        <li>Internet durante a instalação, para baixar o pacote.</li>
      </ul>

      <h2 id="linux">Linux</h2>
      <Passos>
        <li>
          <p>Instale o Docker Engine com o plugin Compose, pelo guia oficial da sua distribuição. Confira se funcionou:</p>
          <Comando>docker compose version</Comando>
        </li>
        <li>
          <p>Para usar o Docker sem <code>sudo</code>, entre no grupo <code>docker</code> e saia e entre de novo na sessão:</p>
          <Comando>sudo usermod -aG docker $USER</Comando>
        </li>
        <li>
          <p>Baixe e rode o instalador. Ele fica em <code>instalar.sh</code>, para você ler antes, se quiser:</p>
          <Comando>{COMANDO_DE_INSTALACAO}</Comando>
        </li>
        <li><p>Abra <code>{CONFIG.enderecoLocal}</code> no navegador e siga para <a href="#codex">Entrar no ChatGPT</a>.</p></li>
      </Passos>

      <h2 id="macos">macOS</h2>
      <Passos>
        <li><p>Instale o Docker Desktop para Mac (Apple Silicon ou Intel) e abra-o. Espere o ícone da baleia indicar que está rodando.</p></li>
        <li>
          <p>Abra o Terminal e rode o instalador:</p>
          <Comando>{COMANDO_DE_INSTALACAO}</Comando>
        </li>
        <li><p>Abra <code>{CONFIG.enderecoLocal}</code> no navegador e siga para <a href="#codex">Entrar no ChatGPT</a>.</p></li>
      </Passos>

      <h2 id="windows">Windows</h2>
      <Passos>
        <li><p>Instale o Docker Desktop para Windows. Se ele pedir para ativar o WSL 2, aceite e reinicie o computador. Depois, abra o Docker Desktop e espere ele indicar que está rodando.</p></li>
        <li>
          <p>Abra o PowerShell (não precisa ser como administrador) e rode o instalador:</p>
          <Comando rotulo="PowerShell">{COMANDO_DE_INSTALACAO_WINDOWS}</Comando>
        </li>
        <li><p>Abra <code>{CONFIG.enderecoLocal}</code> no navegador e siga para <a href="#codex">Entrar no ChatGPT</a>.</p></li>
      </Passos>
      <Nota titulo="Prefere o WSL?">
        <p>Se você já usa uma distribuição Linux no WSL 2 com a integração do Docker Desktop ligada, pode seguir os passos do Linux dentro dela.</p>
      </Nota>

      <h2 id="codex">Entrar no ChatGPT</h2>
      <p>O {N} lê os seus textos pelo Codex, com a sua conta do ChatGPT. O login é feito uma vez, dentro do pacote instalado. O instalador cria o comando <code>{CMD}</code>; com ele:</p>
      <Passos>
        <li>
          <p>Rode, de qualquer pasta:</p>
          <Comando>{`${CMD} login`}</Comando>
          <p>Sem o comando, o equivalente na pasta da instalação (<code>{PASTA}</code>; no Windows, <code>{PASTA_WIN}</code>) é:</p>
          <Comando>{`cd ${PASTA}\n${COMANDO_DE_LOGIN}`}</Comando>
        </li>
        <li><p>O terminal mostra um endereço e um código. Abra o endereço no navegador, entre na sua conta do ChatGPT e digite o código.</p></li>
        <li><p>Volte ao {N} e clique em <strong>Verificar de novo</strong> na tela de boas-vindas.</p></li>
      </Passos>

      <h2 id="boas-vindas">A tela de boas-vindas</h2>
      <p>Na primeira vez que você abre <code>{CONFIG.enderecoLocal}</code>, o {N} mostra a tela <strong>Boas-vindas ao {N}</strong>. Ela confere, item por item, o banco de dados, a preparação de textos, se o Codex está instalado e se está conectado à sua conta. O que faltar vem com o comando exato para resolver, com botão de copiar.</p>
      <ul>
        <li><strong>Abrir o exemplo já marcado</strong> abre um conto curto de domínio público, já com as marcas, para você ver o leitor antes de gastar cota.</li>
        <li><strong>Concluir</strong> fecha a tela de vez. <strong>Depois</strong> só a esconde por agora.</li>
      </ul>
      <p>Depois de concluída, a mesma checagem continua em <strong>Primeiros passos</strong>, na barra lateral, e um aviso aparece no topo se o Codex sair da conta ou a cota acabar.</p>
      <Nota titulo="O login fica no seu computador">
        <p>As credenciais do Codex ficam guardadas na instalação, no seu computador. O {N} não as envia para lugar nenhum.</p>
      </Nota>
      <p>Pronto. Continue em <a href="/docs/primeiros-passos/">Primeiros passos</a>.</p>
    </>
  ),
};

const primeirosPassos: PaginaDeDoc = {
  slug: 'primeiros-passos',
  titulo: 'Primeiros passos',
  resumo: 'Adicione um texto, prepare a leitura, leia com as marcas, anote, pergunte e conecte trechos.',
  grupo: 'Começar',
  corpo: () => (
    <>
      <h2 id="adicionar">1. Adicione um texto</h2>
      <p>Clique em <strong>+</strong> na barra lateral (a página <strong>Adicionar à biblioteca</strong>) e solte os arquivos na área tracejada: PDF, EPUB, Markdown, TXT, vídeo ou áudio, vários de uma vez. Também dá para colar um texto ou um link do YouTube. Os detalhes estão em <a href="/docs/importar/">Adicionar textos e vídeos</a>.</p>
      <p>O PDF aparece como o original. O texto é extraído por trás, invisível, só para marcar e buscar.</p>

      <h2 id="preparar">2. Prepare a leitura</h2>
      <p>No documento, escolha o <strong>modo de leitura</strong> que combina com o texto: argumentativo, filosófico, econômico, literário, matemático, jornalístico, jurídico e outros. Depois, <strong>Preparar leitura</strong>.</p>
      <p>A preparação roda no seu computador e usa o Codex com a sua conta. Um capítulo leva alguns minutos. Você pode ler enquanto isso; as marcas aparecem quando ficam prontas.</p>

      <h2 id="ler">3. Leia com as marcas</h2>
      <ul>
        <li><strong>Atenção:</strong> quatro níveis, de <em>Texto puro</em> (sem marcas) a <em>Aprofundar</em>. Comece pelo <em>Esqueleto</em> para ver só o essencial.</li>
        <li><strong>Estilo:</strong> marca-texto ou sublinhado.</li>
        <li><strong>Notas na margem:</strong> passe o cursor sobre uma marca para ver a nota.</li>
        <li><strong>Primeiro eu:</strong> no painel de informações, faz as marcas da IA esperarem a sua primeira anotação no capítulo.</li>
      </ul>

      <h2 id="marcar">4. Grife e anote</h2>
      <p>Selecione um trecho. Na barra que aparece, <strong>Grifar</strong> marca o trecho; <strong>Anotar</strong> abre uma nota presa a ele. As suas notas ficam na mesma margem das notas da IA.</p>

      <h2 id="perguntar">5. Pergunte ao texto</h2>
      <p>Selecione um trecho e clique em <strong>Perguntar</strong>. A resposta cita os parágrafos em que se apoia e fica guardada junto do trecho.</p>

      <h2 id="conectar">6. Conecte trechos</h2>
      <p>Selecione um trecho, clique em <strong>Conectar</strong> e escolha outro trecho, do mesmo texto ou de outro. As conexões aparecem nos dois lados.</p>

      <h2 id="retomar">7. Retome de onde parou</h2>
      <p>O {N} guarda a posição de cada documento. A página inicial da biblioteca mostra o que está em andamento.</p>

      <h2 id="quadros">8. Quadros</h2>
      <p>Na biblioteca, <strong>Quadros</strong> abre obras de arte em domínio público com análise guiada. Veja <a href="/docs/quadros/">Quadros</a> para baixar o acervo.</p>

      <Nota titulo="Abrir como aplicativo">
        <p>No Chrome ou no Edge, abra <code>{CONFIG.enderecoLocal}</code> e use o ícone de instalar na barra de endereço. O {N} passa a abrir numa janela própria.</p>
      </Nota>
    </>
  ),
};

const importar: PaginaDeDoc = {
  slug: 'importar',
  titulo: 'Adicionar textos e vídeos',
  resumo: 'Arraste arquivos, cole um texto, traga um vídeo do YouTube ou uma mídia sua com transcrição.',
  grupo: 'Começar',
  corpo: () => (
    <>
      <p>Tudo entra pela página <strong>Adicionar à biblioteca</strong> (o <strong>+</strong> da barra lateral). Ela tem uma área para soltar arquivos, um campo de link, um de texto colado e, recolhido, o <strong>Avançado</strong>.</p>

      <h2 id="arquivos">Arquivos</h2>
      <p>Arraste para a área <strong>Solte arquivos aqui</strong> ou use <strong>Escolher arquivos</strong>. Pode soltar vários de uma vez; o {N} reconhece cada um pela extensão:</p>
      <ul>
        <li><strong>Documentos:</strong> PDF, EPUB, Markdown (<code>.md</code>) e TXT, até 200 MB cada.</li>
        <li><strong>Vídeo e áudio:</strong> mp4, m4v, mov, webm, mkv, mp3, m4a, aac, ogg, opus, até 4 GB (veja <a href="#midia">Vídeo e áudio próprios</a>).</li>
      </ul>
      <p>Cada arquivo entra numa fila com o estado dele. <strong>Mais opções</strong> abre o que vale para aquele arquivo: título e autor (no PDF e no EPUB, em branco, vêm do próprio arquivo), um intervalo de páginas no PDF (como <code>12-25</code>) e prosa ou poesia no Markdown e no TXT. Os arquivos sobem quando você clica em <strong>Adicionar N arquivos</strong>, e a página continua aberta enquanto o texto é preparado: "Texto pronto. As marcas chegam depois." indica que já dá para ler.</p>
      <p>Um arquivo que já está na biblioteca não é duplicado: a fila oferece <strong>Abrir o existente</strong>.</p>

      <h2 id="escaneado">PDF escaneado</h2>
      <p>Quando um PDF tem páginas que são só imagem, sem texto, a linha dele na fila oferece <strong>Transcrever as páginas</strong>. O Codex lê cada página como imagem, pela sua conta, e o texto vira uma camada invisível sobre o original: você continua vendo o PDF como ele é, e pode marcar, buscar e perguntar. Conta na cota como uma leitura.</p>

      <h2 id="colar">Texto colado</h2>
      <p>Em <strong>Colar texto</strong>, cole e adicione. Sem título, a primeira linha vira o título; autor e prosa ou poesia ficam em <strong>Mais opções</strong>.</p>

      <h2 id="youtube">Link do YouTube</h2>
      <p>Cole o link de um vídeo do YouTube no campo <strong>Link</strong> e clique em <strong>Trazer</strong>. O {N} busca o título e as <strong>legendas do próprio vídeo</strong> (as do canal ou, sem elas, as automáticas na língua original, nunca uma tradução automática) e monta o texto. O vídeo não é baixado: no leitor, ele toca pelo <strong>player oficial do YouTube</strong>, embutido ao lado do texto, e a palavra falada acende no texto enquanto ele toca. Clicar num trecho leva o vídeo até ali.</p>
      <ul>
        <li>O {N} guarda só o áudio, para a sincronia com o texto e para ouvir quando o vídeo não pode ser incorporado.</li>
        <li>Se o dono do vídeo não deixa tocar fora do YouTube, o leitor mostra <strong>Assistir no YouTube</strong> e <strong>Ouvir o áudio local</strong>.</li>
        <li>Sem legendas, o vídeo entra "sem transcrição": toca assim mesmo, sem o texto.</li>
        <li>A busca no YouTube usa o <code>yt-dlp</code>, que já vem dentro da instalação. Playlists e canais não são aceitos, só vídeos.</li>
      </ul>
      <p>Artigos e outras páginas da web entram pela <a href="/docs/extensao/">extensão do navegador</a>.</p>

      <h2 id="midia">Vídeo e áudio próprios</h2>
      <p>Um vídeo ou áudio seu entra junto com a transcrição, num arquivo <code>.json</code>. Solte os dois juntos (eles se emparelham pelo nome) ou, se a mídia ficar com "Falta a transcrição", use <strong>Escolher a transcrição</strong>. O texto vira um documento e a mídia toca alinhada a ele, palavra por palavra.</p>
      <p>O {N} ainda não transcreve áudio sozinho: a transcrição vem de fora (por exemplo, do Whisper), no formato do {N}:</p>
      <Comando rotulo="transcricao.json">{`{
  "versao": 1,
  "capitulos": [{ "inicio_s": 0, "titulo": "Abertura" }],
  "paragrafos": ["Bom dia a todos."],
  "palavras": [
    { "texto": "Bom", "inicio_s": 0.0, "fim_s": 0.3 },
    { "texto": "dia", "inicio_s": 0.3, "fim_s": 0.6 },
    { "texto": "a", "inicio_s": 0.6, "fim_s": 0.7 },
    { "texto": "todos.", "inicio_s": 0.7, "fim_s": 1.2 }
  ]
}`}</Comando>
      <p>As palavras com tempo precisam ser, na ordem, as mesmas palavras dos parágrafos, com tempos crescentes.</p>

      <h2 id="avancado">Avançado</h2>
      <p><strong>Marcas de outro arquivo</strong> traz para um documento que já tem texto pronto as marcas guardadas num JSON do {N} (formato <code>MarcasLegadoV1</code>). Escolha o documento, o arquivo e clique em <strong>Importar marcas</strong>; a página diz quantas entraram.</p>
    </>
  ),
};

const quadros: PaginaDeDoc = {
  slug: 'quadros',
  titulo: 'Quadros',
  resumo: 'Obras de arte em domínio público com análise guiada: o que é e como baixar o acervo.',
  grupo: 'Começar',
  corpo: () => (
    <>
      <p><strong>Quadros</strong> é a parte da biblioteca com obras de arte: pinturas e algumas esculturas, em reproduções de domínio público ou com licença livre. Cada quadro abre em tela cheia, com zoom, regiões destacadas na própria imagem e uma análise guiada que explica o que olhar e por quê, separando o que é documentado do que é interpretação.</p>

      <h2 id="baixar">Baixar o acervo</h2>
      <p>O acervo vem num pacote à parte, para a instalação não carregar meio gigabyte que nem todo mundo quer: cerca de 137 obras, uns 490 MB. Antes de instalar, Quadros mostra duas obras de exemplo e a mensagem "Nenhum quadro ainda.", com o botão <strong>Baixar o acervo de quadros</strong> e o comando para instalar.</p>
      <p>Para baixar e instalar de uma vez:</p>
      <Comando>{`${CMD} arte instalar`}</Comando>
      <p>Se você baixou o pacote pelo navegador (o arquivo <code>acervo-de-quadros-&lt;versão&gt;.tar.gz</code>, na <a href={CONFIG.urlDoRelease}>página do release</a>), passe o caminho dele:</p>
      <Comando>{`${CMD} arte instalar ~/Downloads/acervo-de-quadros-<versão>.tar.gz`}</Comando>
      {downloadEmPreparacao && <Nota titulo="Pacote em preparação"><p>O primeiro release ainda não foi publicado. Até lá, o botão aparece indisponível e o comando sem arquivo avisa que o pacote não existe.</p></Nota>}
      <p>O instalador confere o pacote inteiro antes de mexer em qualquer coisa: o SHA-256 de cada arquivo e a licença de cada obra. Rodar de novo não muda nada, e uma obra que você mesmo tenha posto no acervo nunca é sobrescrita. Recarregue a página no fim.</p>
      <p>As obras ficam no volume de dados da instalação: entram no <a href="/docs/manutencao/#backup">backup</a> e continuam depois de atualizar.</p>

      <h2 id="creditos">Créditos e licenças</h2>
      <p>Só entram obras cuja reprodução pode ser redistribuída: domínio público, CC0, ou CC BY e CC BY-SA com o autor da fotografia identificado. Cada quadro mostra a <strong>Licença</strong> e o <strong>Crédito</strong> da imagem no painel ao lado, com o link da fonte (quase sempre o Wikimedia Commons). O pacote traz também a lista completa de créditos, que fica na instalação em <code>/dados/arte/obras/.pacote/CREDITOS.md</code>.</p>

      <Nota titulo="Para desligar">
        <p>Quem não quiser a área de Quadros pode tirá-la com <code>MARGEM_RECURSOS=-arte</code> no arquivo <code>.env</code> da pasta da instalação, seguido de <code>{`${CMD} iniciar`}</code>.</p>
      </Nota>
    </>
  ),
};

const extensao: PaginaDeDoc = {
  slug: 'extensao',
  titulo: 'Extensão do navegador',
  resumo: `Mande artigos da web, seleções e PDFs abertos no navegador para a sua biblioteca.`,
  grupo: 'Integrações',
  corpo: () => (
    <>
      <p>A extensão manda a página aberta (artigo, post, notícia ou PDF) para a biblioteca do {N}. Funciona no Chrome, Edge, Brave e Firefox.</p>

      <h2 id="usar">Como usar</h2>
      <ul>
        <li><strong>Ícone da extensão:</strong> mostra título, autor, site, palavras e uma prévia. Clique em <strong>Enviar para o {N}</strong> ou <strong>Enviar e abrir</strong>. Atalho: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>.</li>
        <li><strong>Menu do botão direito:</strong> <em>Enviar página</em> ou, com texto selecionado, <em>Enviar seleção</em>.</li>
        <li><strong>PDF:</strong> se a aba é um PDF, a extensão envia o arquivo original.</li>
      </ul>
      <p>A extensão só lê a página quando você pede. Ela não tem acesso aos sites que você visita.</p>

      <h2 id="instalar">Instalar no Chrome, Edge ou Brave</h2>
      <Passos>
        <li><p>Baixe <code>margem-chrome.zip</code> na <a href={CONFIG.urlDoRelease}>página do release</a> e descompacte numa pasta que vai ficar.</p></li>
        <li><p>Abra <code>chrome://extensions</code> (no Edge, <code>edge://extensions</code>; no Brave, <code>brave://extensions</code>).</p></li>
        <li><p>Ligue o <strong>Modo do desenvolvedor</strong>, clique em <strong>Carregar sem compactação</strong> e escolha a pasta.</p></li>
        <li><p>Fixe o ícone na barra. Nas opções da extensão, clique em <strong>Testar conexão</strong>.</p></li>
      </Passos>

      <h2 id="firefox">Instalar no Firefox</h2>
      <Passos>
        <li><p>Abra <code>about:debugging#/runtime/this-firefox</code> e clique em <strong>Carregar extensão temporária</strong>. Escolha o arquivo <code>margem-firefox.zip</code>.</p></li>
        <li><p>No Firefox, a extensão carregada assim some quando o navegador fecha. A versão assinada virá depois.</p></li>
      </Passos>

      <h2 id="servidor">Servidor</h2>
      <p>O servidor padrão é <code>{CONFIG.enderecoLocal}</code>, o endereço da sua instalação. Só mude se você trocou a porta.</p>
      <Nota tipo="aviso" titulo="Se o teste de conexão falhar">
        <p>A instalação precisa conhecer a origem da extensão. A página de opções mostra essa origem (<code>chrome-extension://…</code> ou <code>moz-extension://…</code>). Veja como liberar em <a href="/docs/problemas/#extensao">Solução de problemas</a>.</p>
      </Nota>
      <p>PDFs abertos do disco (<code>file://</code>) exigem, no Chrome, ligar <em>Permitir acesso a URLs de arquivo</em> nos detalhes da extensão.</p>
    </>
  ),
};

const obsidian: PaginaDeDoc = {
  slug: 'obsidian',
  titulo: 'Obsidian',
  resumo: 'Leve grifos, notas, perguntas e conexões para o seu cofre, com link de volta para o trecho.',
  grupo: 'Integrações',
  corpo: () => (
    <>
      <p>O plugin do Obsidian traz para o cofre o que você faz no {N}: grifos, marcas que você confirmou ou comentou, notas, perguntas e respostas, e conexões. Cada documento vira uma nota, com uma seção por capítulo.</p>

      <h2 id="instalar">Instalar o plugin</h2>
      <Passos>
        <li><p>Baixe <code>main.js</code> e <code>manifest.json</code> do plugin na <a href={CONFIG.urlDoRelease}>página do release</a>.</p></li>
        <li><p>Copie os dois para <code>&lt;seu cofre&gt;/.obsidian/plugins/margem/</code>.</p></li>
        <li><p>No Obsidian, abra <strong>Configurações → Plugins da comunidade</strong>, desligue o modo restrito, recarregue a lista e ative o plugin.</p></li>
      </Passos>

      <h2 id="configurar">Configurar</h2>
      <ul>
        <li><strong>Servidor:</strong> <code>{CONFIG.enderecoLocal}</code>. Os links de volta usam este endereço.</li>
        <li><strong>Pasta:</strong> onde as notas novas são criadas (padrão <code>Margem</code>).</li>
        <li><strong>Marcas da leitura:</strong> desligado, vêm só os seus grifos e as marcas que você confirmou ou comentou. Ligado, vêm também as marcas visíveis da IA.</li>
        <li><strong>Sincronizar ao abrir</strong> ou <strong>a cada N minutos</strong>, se quiser automático.</li>
      </ul>
      <p>Para sincronizar à mão, use o comando <strong>Sincronizar</strong> do plugin ou o ícone de livro na barra lateral. Dentro do {N}, cada documento também tem <strong>Enviar para o Obsidian</strong>.</p>

      <h2 id="nota">Como a nota fica</h2>
      <ul>
        <li>Cada trecho vira um callout com a citação, a função da marca (tese, objeção…) e um link de volta para o trecho.</li>
        <li>Tags como <code>#margem/tese</code> e <code>#margem/ia</code> (nas marcas da IA).</li>
        <li>Cada trecho tem um bloco estável <code>^margem-…</code>: dá para linkar de outras notas.</li>
      </ul>
      <Nota tipo="aviso" titulo="Escreva fora do bloco do app">
        <p>O conteúdo do {N} fica entre <code>%% margem:inicio %%</code> e <code>%% margem:fim %%</code> e é trocado a cada sincronização. Escreva antes ou depois desse bloco: o que estiver fora continua.</p>
      </Nota>
      <p>O plugin só lê do {N}; nunca escreve na sua biblioteca. Nada é apagado do cofre.</p>
    </>
  ),
};

const audio: PaginaDeDoc = {
  slug: 'audio',
  titulo: 'Áudio com ElevenLabs',
  resumo: 'Opcional: gere a narração dos seus textos com a sua própria chave da ElevenLabs.',
  grupo: 'Integrações',
  corpo: () => (
    <>
      <p>O {N} pode narrar um capítulo em voz alta, com o trecho acompanhando a leitura. A narração usa a ElevenLabs, com uma chave sua. É opcional: sem a chave, nada muda no resto do app.</p>

      <h2 id="chave">Obter a chave</h2>
      <Passos>
        <li><p>Crie uma conta em <a href="https://elevenlabs.io">elevenlabs.io</a> e escolha um plano.</p></li>
        <li><p>No painel da ElevenLabs, abra a área de chaves de API e crie uma chave nova. Se puder, limite a chave ao uso de texto para fala.</p></li>
        <li><p>Copie a chave. Ela só aparece inteira uma vez.</p></li>
      </Passos>

      <h2 id="colar">Colar no {N}</h2>
      <Passos>
        <li><p>No {N}, abra <strong>Configurações</strong> (no pé da barra lateral) e vá à seção <strong>Áudio</strong>.</p></li>
        <li><p>Cole a chave em <strong>Chave da API da ElevenLabs</strong> e clique em <strong>Salvar chave</strong>. <strong>Testar chave</strong> confere se ela funciona. Depois de salva, a tela mostra só o fim da chave ("Configurada · termina em …"), com <strong>Trocar</strong> e <strong>Remover</strong>.</p></li>
        <li><p>Escolha a <strong>Voz</strong> (as vozes da sua conta) e o <strong>Modelo</strong>.</p></li>
        <li><p>No leitor, abra o menu <strong>Ouvir</strong> (o ícone de fone) e escolha <strong>Gerar narração</strong>. O painel mostra a voz, o modelo, quantos caracteres vão ser gastos e o custo estimado; com um trecho selecionado, dá para narrar <strong>Só o trecho selecionado</strong> em vez do <strong>Capítulo inteiro</strong>.</p></li>
        <li><p>A narração entra na fila e é gerada por partes. Quando termina, clique em <strong>Ouvir agora</strong>: o trecho falado acende no texto.</p></li>
      </Passos>

      <h2 id="custos">Custos</h2>
      <p>Cada narração consome caracteres do seu plano na ElevenLabs. A cobrança é feita por eles, direto na sua conta. O {N} não cobra nada e não vê o seu pagamento. Acompanhe o consumo no painel da ElevenLabs.</p>

      <h2 id="privacidade">Privacidade</h2>
      <ul>
        <li>A chave fica guardada só no seu computador, na sua instalação.</li>
        <li>Com o áudio ligado, o texto que você manda narrar vai para a ElevenLabs, que gera o áudio. O resto da biblioteca não vai.</li>
        <li>O áudio pronto fica salvo no seu computador.</li>
      </ul>
      <Nota titulo="Para desligar">
        <p>Em Configurações → Áudio, clique em <strong>Remover</strong>. Os áudios já gerados continuam na biblioteca.</p>
      </Nota>
    </>
  ),
};

const manutencao: PaginaDeDoc = {
  slug: 'manutencao',
  titulo: 'Atualizar, backup e desinstalar',
  resumo: 'Mantenha a instalação em dia, guarde uma cópia da biblioteca e remova o app se quiser.',
  grupo: 'Manutenção',
  corpo: () => (
    <>
      <p>O instalador cria o comando <code>{CMD}</code> (no Windows, <code>{CMD}.cmd</code>), que funciona de qualquer pasta. Os mesmos comandos existem como <code>docker compose</code>, rodados na pasta da instalação: <code>{PASTA}</code> (no Windows, <code>{PASTA_WIN}</code>).</p>

      <h2 id="comandos">Os comandos</h2>
      <Comando>{`${CMD} iniciar       # sobe o app (e instala na primeira vez)
${CMD} parar         # para o app; os dados ficam
${CMD} estado        # mostra os serviços, o endereço e se o Codex está logado
${CMD} login         # entra na sua conta do ChatGPT pelo Codex
${CMD} logs          # acompanha os registros (Ctrl+C sai)
${CMD} atualizar     # backup, versão nova e sobe de novo
${CMD} backup        # copia o banco e os arquivos
${CMD} restaurar <pasta>
${CMD} arte instalar [arquivo|link]   # acervo de quadros
${CMD} desinstalar [--apagar-dados]`}</Comando>
      <p>No Windows, os mesmos comandos funcionam no PowerShell; as opções com dois traços viram <code>-ApagarDados</code> e <code>-Sha256</code>.</p>

      <h2 id="atualizar">Atualizar</h2>
      <p>Veja o que mudou em <a href="/novidades/">Novidades</a>. Para atualizar:</p>
      <Comando>{`${CMD} atualizar`}</Comando>
      <p>O comando faz um backup antes, baixa a versão nova e sobe o app de novo. A biblioteca continua como estava; se a versão nova mudar o banco, a atualização é feita sozinha ao subir. Sem o comando, o equivalente é:</p>
      <Comando>{`cd ${PASTA}\ndocker compose pull\ndocker compose up -d`}</Comando>

      <h2 id="backup">Backup</h2>
      <p>A biblioteca tem duas partes, e o backup leva as duas: o <strong>banco de dados</strong> (marcas, notas, conversas, progresso) e os <strong>arquivos</strong> (os originais, o que foi gerado a partir deles e o acervo de quadros). As duas ficam em volumes do Docker, não soltas na pasta; por isso o backup é um comando:</p>
      <Comando>{`${CMD} backup`}</Comando>
      <p>Ele grava <code>banco.dump</code> e <code>dados.tar</code> em <code>{PASTA}/backups/&lt;data&gt;/</code>. Copie essa pasta para um disco externo ou outro lugar seguro. O login do ChatGPT não entra no backup.</p>
      <p>Para restaurar, num computador novo ou neste, instale o {N} e rode <code>{`${CMD} restaurar <pasta do backup>`}</code>. Ele pede confirmação e substitui o banco e os arquivos atuais.</p>

      <h2 id="parar">Parar e iniciar</h2>
      <Comando>{`${CMD} parar      # para o app\n${CMD} iniciar    # inicia de novo\n${CMD} estado     # mostra se está no ar e se o Codex está logado`}</Comando>

      <h2 id="desinstalar">Desinstalar</h2>
      <p>Para remover o app e <strong>manter</strong> a biblioteca (nos volumes do Docker):</p>
      <Comando>{`${CMD} desinstalar`}</Comando>
      <p>Para apagar <strong>tudo</strong>, inclusive livros, notas e o login do Codex:</p>
      <Comando>{`${CMD} desinstalar --apagar-dados\ncd ~ && rm -rf ${PASTA}`}</Comando>
      <Nota tipo="aviso" titulo="Não tem volta">
        <p>Apagar a pasta remove a biblioteca para sempre. Faça um backup antes se houver algo que você queira guardar.</p>
      </Nota>
    </>
  ),
};

const perguntas: PaginaDeDoc = {
  slug: 'perguntas',
  titulo: 'Perguntas frequentes',
  resumo: 'Cota do ChatGPT, privacidade, custos e o que o app faz com os seus textos.',
  grupo: 'Ajuda',
  corpo: () => (
    <>
      <h2 id="custo">Quanto custa?</h2>
      <p>O {N} é gratuito e de código aberto. As leituras usam a sua assinatura do ChatGPT, pelo Codex. O áudio é opcional e é pago direto à ElevenLabs, se você usar.</p>

      <h2 id="cota">Ele gasta a minha cota do ChatGPT?</h2>
      <p>Sim. Preparar a leitura e responder perguntas usam o Codex, que conta na cota da sua conta, como qualquer uso do Codex. Um livro inteiro pede bem mais do que um artigo. Prepare primeiro os capítulos que vai ler.</p>

      <h2 id="cota-acabou">E se a cota acabar?</h2>
      <p>As leituras pedidas esperam na fila e continuam sozinhas quando a cota voltar; o app avisa e mostra a previsão. Não é preciso pedir de novo. Tudo o que já foi preparado continua disponível: ler, grifar e anotar não usam cota.</p>

      <h2 id="privacidade">Para onde vão os meus textos?</h2>
      <p>Os arquivos, as marcas e as notas ficam no seu computador. Para marcar e responder, o Codex manda ao ChatGPT os trechos necessários, pela sua conta. As regras de uso e de privacidade desse envio são as da OpenAI para a sua conta. Se você ligar o áudio, o texto a narrar vai para a ElevenLabs.</p>

      <h2 id="conta">Preciso criar conta no {N}?</h2>
      <p>Não. Não existe conta no {N}. O único login é o do ChatGPT, dentro da sua instalação.</p>

      <h2 id="internet">Funciona sem internet?</h2>
      <p>Ler, grifar e anotar o que já está na biblioteca, sim. Preparar leituras e perguntar precisam de internet, porque passam pelo ChatGPT.</p>

      <h2 id="outro-computador">Posso usar no celular ou em outro computador?</h2>
      <p>O {N} atende em <code>{CONFIG.enderecoLocal}</code>, só no computador onde foi instalado. Para levar a biblioteca para outra máquina, faça um <a href="/docs/manutencao/#backup">backup</a> e restaure lá.</p>

      <h2 id="formatos">Que formatos posso ler?</h2>
      <p>PDF, EPUB, Markdown, TXT, texto colado, páginas da web pela extensão, vídeos do YouTube pelo link e vídeo ou áudio seus com a transcrição. Um PDF escaneado, só com imagens, pode ser transcrito pelo Codex página por página. Veja <a href="/docs/importar/">Adicionar textos e vídeos</a>.</p>

      <h2 id="idiomas">Funciona com textos em inglês?</h2>
      <p>Sim. O {N} nasceu para textos em português e também lê em inglês.</p>

      <h2 id="erros">A IA pode errar?</h2>
      <p>Pode. Marcas, notas e respostas são uma camada sobre o texto, não o texto. Toda marca aponta o trecho de onde saiu, para você conferir.</p>
    </>
  ),
};

const problemas: PaginaDeDoc = {
  slug: 'problemas',
  titulo: 'Solução de problemas',
  resumo: 'O que fazer quando o app não abre, o Codex não entra ou a extensão não conecta.',
  grupo: 'Ajuda',
  corpo: () => (
    <>
      <p>Os comandos rodam na pasta da instalação (<code>{PASTA}</code>). Para ver o estado dos serviços:</p>
      <Comando>{`cd ${PASTA}\ndocker compose ps`}</Comando>

      <h2 id="nao-abre">A página não abre</h2>
      <ul>
        <li>Confira se o Docker está rodando (no macOS e no Windows, abra o Docker Desktop).</li>
        <li>Suba o app de novo: <code>{`${CMD} iniciar`}</code> (ou <code>docker compose up -d</code> na pasta da instalação).</li>
        <li>Veja os registros: <code>docker compose logs --tail 100</code>.</li>
        <li>Se outra coisa usa a porta 8730, o app não sobe. Feche o outro programa ou troque a porta: <code>PORTA=8731</code> no arquivo <code>.env</code> da pasta da instalação, depois <code>{`${CMD} iniciar`}</code> (e o mesmo endereço nas opções da extensão).</li>
      </ul>

      <h2 id="docker-permissao">“permission denied” ao rodar o Docker (Linux)</h2>
      <p>O seu usuário não está no grupo <code>docker</code>. Rode <code>sudo usermod -aG docker $USER</code>, saia da sessão e entre de novo.</p>

      <h2 id="codex">O app diz que o Codex não está logado</h2>
      <p>Faça o login de novo:</p>
      <Comando>{`${CMD} login`}</Comando>
      <p>Se o código expirar, rode o comando outra vez para receber um novo.</p>

      <h2 id="cota">“Limite de uso” ou leitura parada na fila</h2>
      <p>A cota do Codex na sua conta acabou por enquanto. O app avisa na tela, com a previsão de volta. Nada se perde: as leituras na fila continuam sozinhas quando a cota voltar.</p>

      <h2 id="leitura-falhou">A preparação de um capítulo falhou</h2>
      <p>Abra os trabalhos do documento para ver a mensagem. Na maior parte dos casos, basta pedir de novo. Se o erro se repetir no mesmo texto, relate em <a href={CONFIG.urlDeProblemas}>problemas conhecidos</a>, sem anexar o livro.</p>

      <h2 id="pdf">O PDF abre, mas não aparece texto para marcar</h2>
      <p>O PDF provavelmente é só imagem, sem camada de texto. Na página de adicionar, use <strong>Transcrever as páginas</strong> na linha dele (veja <a href="/docs/importar/#escaneado">PDF escaneado</a>).</p>

      <h2 id="youtube">O vídeo do YouTube entrou sem texto</h2>
      <p>O vídeo não tem legendas, nem as automáticas na língua original. Ele toca assim mesmo, sem o texto ao lado. Se o leitor diz que o dono não permite assistir fora do YouTube, use <strong>Assistir no YouTube</strong> ou <strong>Ouvir o áudio local</strong>.</p>

      <h2 id="quadros">"Pacote recusado" ao instalar o acervo de quadros</h2>
      <p>O arquivo veio incompleto ou diferente do publicado: o instalador confere cada arquivo e não instala nada pela metade. Baixe de novo da <a href={CONFIG.urlDoRelease}>página do release</a> e rode <code>{`${CMD} arte instalar <arquivo>`}</code> outra vez.</p>

      <h2 id="extensao">A extensão não conecta</h2>
      <ul>
        <li>Confira, nas opções da extensão, se o servidor é <code>{CONFIG.enderecoLocal}</code>.</li>
        <li>A instalação precisa aceitar a origem da extensão. Copie a origem que aparece nas opções e acrescente à variável <code>MARGEM_EXTENSOES</code> da instalação, separada por vírgula. Depois, reinicie: <code>docker compose up -d</code>.</li>
        <li>No Firefox, a origem muda a cada instalação da extensão.</li>
      </ul>

      <h2 id="obsidian">O Obsidian recebe “origem recusada”</h2>
      <p>Acrescente <code>app://obsidian.md</code> à variável <code>MARGEM_ORIGENS</code> da instalação e reinicie o app.</p>

      <h2 id="ajuda">Ainda com problema?</h2>
      <p>Relate em <a href={CONFIG.urlDeProblemas}>{CONFIG.urlDeProblemas}</a> com o sistema, a versão e as últimas linhas de <code>docker compose logs</code>. Revise os registros antes: eles podem citar títulos dos seus documentos.</p>
    </>
  ),
};

const contribuir: PaginaDeDoc = {
  slug: 'contribuir',
  titulo: 'Contribuir',
  resumo: `O ${N} é código aberto. Relate problemas, sugira melhorias ou mande código.`,
  grupo: 'Ajuda',
  corpo: () => (
    <>
      <p>O código do {N} está em <a href={CONFIG.urlDoRepositorio}>{CONFIG.urlDoRepositorio}</a>, sob a licença {CONFIG.licenca}.</p>

      <h2 id="relatar">Relatar um problema</h2>
      <p>Abra um item em <a href={CONFIG.urlDeProblemas}>problemas</a> com: o sistema, a versão do {N}, o que você fez, o que esperava e o que aconteceu. Não anexe livros nem textos protegidos por direitos autorais.</p>

      <h2 id="sugerir">Sugerir uma melhoria</h2>
      <p>Conte o que você estava tentando ler e onde o app atrapalhou. Exemplos reais ajudam mais do que listas de recursos.</p>

      <h2 id="codigo">Mandar código</h2>
      <Passos>
        <li><p>Abra antes um item descrevendo a mudança, para combinar o caminho.</p></li>
        <li><p>Leia o <code>README.md</code> e o <code>AGENTS.md</code> do repositório: eles explicam a estrutura e as regras do projeto.</p></li>
        <li><p>Faça mudanças pequenas, com testes, e rode <code>npm run typecheck</code> e <code>npm test</code> antes de enviar.</p></li>
        <li><p>No primeiro envio, assine o acordo de contribuição (CLA). É um passo só, feito pelo próprio GitHub. Ele permite que o projeto continue podendo mudar de licença ou oferecer licenças comerciais, sem tirar de ninguém os direitos da {CONFIG.licenca}.</p></li>
      </Passos>

      <h2 id="modos">Modos de leitura</h2>
      <p>Os modos de leitura (as funções que cada um marca e as suas cores) ficam em <code>contratos/</code>, e as instruções da IA em <code>prompts/</code>. Propostas de modos novos são bem-vindas, com textos de exemplo de domínio público.</p>
    </>
  ),
};

export const PAGINAS_DE_DOCS: readonly PaginaDeDoc[] = [
  instalacao, primeirosPassos, importar, quadros, extensao, obsidian, audio, manutencao, perguntas, problemas, contribuir,
];

export const GRUPOS: readonly Grupo[] = ['Começar', 'Integrações', 'Manutenção', 'Ajuda'];
