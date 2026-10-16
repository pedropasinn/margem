import type { ReactNode } from 'react';
import { Comando } from '../componentes/Comando';
import { CONFIG, INSTALADORES, REQUISITOS, downloadEmPreparacao } from '../config';

const N = CONFIG.nome;

/** Nome fixo do arquivo de um instalador (de `config.ts`). */
const arquivo = (id: string): string => INSTALADORES.find((i) => i.id === id)?.arquivo ?? id;

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

/**
 * Instalação no macOS sem a assinatura da Apple (J154). O app tem assinatura ad hoc (o Mac roda), mas não
 * o Developer ID nem a notarização: na primeira vez o macOS diz que não pôde verificá-lo. Do macOS 15 em
 * diante a liberação é só por Ajustes do Sistema → Privacidade e Segurança; no 14 também pelo botão direito.
 */
function InstalarNoMac({ arquivoArm64, arquivoX64 }: { arquivoArm64: string; arquivoX64: string }): ReactNode {
  return (
    <>
      <Passos>
        <li><p>Baixe o arquivo do seu Mac: <code>{arquivoArm64}</code> para Apple Silicon (M1 em diante) ou <code>{arquivoX64}</code> para Intel. Para saber qual é o seu, abra o menu Apple → <strong>Sobre Este Mac</strong>: "Chip Apple M…" é Apple Silicon; "Processador Intel" é Intel.</p></li>
        <li><p>Abra o <code>.dmg</code> e arraste o {N} para a pasta <strong>Aplicativos</strong>. Depois, ejete o disco do {N} no Finder.</p></li>
        <li><p>Abra o {N} pela pasta Aplicativos (ou pelo Launchpad). Na primeira vez, o macOS avisa que <strong>não foi possível verificar</strong> o app. Clique em <strong>OK</strong> (não em "Mover para o Lixo").</p></li>
        <li><p>Abra <strong>Ajustes do Sistema → Privacidade e Segurança</strong> e role até <strong>Segurança</strong>. Ao lado do aviso de que o {N} foi bloqueado, clique em <strong>Abrir Mesmo Assim</strong>, confirme com a sua senha (ou o Touch ID) e clique em <strong>Abrir</strong>.</p></li>
      </Passos>
      <p>Só na primeira vez. Depois, o {N} abre como qualquer app, pelo Dock ou pela pasta Aplicativos.</p>
      <Nota titulo="No macOS 14 (Sonoma)">
        <p>Também dá para clicar no {N} com o botão direito (ou Control + clique) na pasta Aplicativos, escolher <strong>Abrir</strong> e confirmar em <strong>Abrir</strong>. No macOS 15 esse atalho não libera mais o app: use os Ajustes do Sistema.</p>
      </Nota>
      <Nota tipo="aviso" titulo="Por que o macOS avisa">
        <p>O {N} ainda não tem a assinatura da Apple (o certificado de desenvolvedor e a verificação da Apple). Ele tem só uma assinatura própria, que basta para o Mac rodá-lo, mas não é a verificação da Apple. O código é aberto: você pode conferir o que ele faz.</p>
      </Nota>
      <h3 id="mac-no-dia-a-dia">No dia a dia</h3>
      <ul>
        <li>Fechar a janela não encerra o {N}: ele continua no Dock, com a biblioteca aberta e as leituras em preparação andando. Clique no ícone do Dock para voltar. Para encerrar, use <strong>Margem → Sair</strong> (<kbd>⌘</kbd> <kbd>Q</kbd>).</li>
        <li>As configurações ficam em <strong>Margem → Ajustes…</strong> (<kbd>⌘</kbd> <kbd>,</kbd>).</li>
        <li>Abra o {N} sempre da pasta Aplicativos, não de dentro do <code>.dmg</code> nem da pasta Downloads.</li>
      </ul>
      <Nota titulo="Se o macOS disser que o app está danificado ou não abrir mesmo assim">
        <p>Confira se baixou o arquivo do seu processador e se o {N} está na pasta Aplicativos. Se ainda assim não abrir, você pode tirar a marca de "baixado da internet" do app, no Terminal, e abrir de novo:</p>
        <Comando>{'xattr -dr com.apple.quarantine /Applications/Margem.app'}</Comando>
        <p>Só faça isso com o arquivo baixado da <a href="/download/">página de download</a> ou do <a href={CONFIG.urlDoRelease}>release no GitHub</a>.</p>
      </Nota>
    </>
  );
}

const instalacao: PaginaDeDoc = {
  slug: 'instalacao',
  titulo: 'Instalação',
  resumo: `Baixe o ${N} para o seu sistema, instale como qualquer app e passe pelo aviso de app sem assinatura.`,
  grupo: 'Começar',
  corpo: () => (
    <>
      <p>O {N} é um app de desktop com tudo dentro: o leitor, o banco de dados e o Codex. Não é preciso instalar mais nada nem usar o terminal. Baixe o instalador do seu sistema na <a href="/download/">página de download</a>.</p>
      <nav className="fichas-doc" aria-label="Escolha o sistema">
        <a href="#windows">Windows</a><a href="#macos">macOS</a><a href="#linux">Linux</a><a href="#primeira-vez">Primeira vez</a>
      </nav>
      {downloadEmPreparacao && <Nota titulo="Download em preparação"><p>O primeiro release ainda não foi publicado. Os passos abaixo valem quando os instaladores saírem.</p></Nota>}

      <h2 id="requisitos">Antes de começar</h2>
      <ul>
        <li><strong>Windows:</strong> {REQUISITOS.windows}</li>
        <li><strong>macOS:</strong> {REQUISITOS.macos}</li>
        <li><strong>Linux:</strong> {REQUISITOS.linux}</li>
        <li>Uma conta do ChatGPT num plano que inclua o Codex.</li>
        <li>Espaço em disco para o app (veja o tamanho de cada instalador na <a href="/download/">página de download</a>) e para os seus livros.</li>
      </ul>

      <h2 id="windows">Windows</h2>
      <Passos>
        <li><p>Baixe <code>{arquivo('windows')}</code> e abra o arquivo.</p></li>
        <li>
          <p>Se aparecer a tela azul <strong>"O Windows protegeu o computador"</strong> (o SmartScreen), clique em <strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>.</p>
        </li>
        <li><p>O instalador põe o {N} na sua conta do Windows, sem pedir senha de administrador, e cria um atalho no menu Iniciar.</p></li>
      </Passos>
      <Nota tipo="aviso" titulo="Por que o Windows avisa">
        <p>O {N} ainda não tem assinatura digital da Microsoft. O aviso aparece para todo app novo sem assinatura e some quando o app ganhar uma. O código é aberto: você pode conferir o que ele faz.</p>
      </Nota>

      <h2 id="macos">macOS</h2>
      {CONFIG.macPublicado
        ? <InstalarNoMac arquivoArm64={arquivo('mac-arm64')} arquivoX64={arquivo('mac-x64')} />
        : (
          <Nota titulo="Em breve">
            <p>A primeira versão do {N} é para Windows e Linux. A versão para macOS está em preparação e aparece na <a href="/download/">página de download</a> quando sair.</p>
          </Nota>
        )}

      <h2 id="linux">Linux</h2>
      <p>Cada versão do {N} para Linux é testada no <strong>Ubuntu 22.04</strong>. Deve rodar também no Ubuntu mais novo e em distribuições equivalentes (glibc 2.35 ou mais nova, 64 bits), mas elas não são testadas a cada versão; se algo não funcionar na sua, conte em <a href={CONFIG.urlDeProblemas}>problemas</a>.</p>
      <p>Há dois formatos. O <strong>.deb</strong> instala pelo gerenciador de pacotes do Debian, do Ubuntu e derivados, e é o recomendado no <strong>Ubuntu 24.04 ou mais novo</strong>. O <strong>AppImage</strong> é um arquivo só, que se atualiza sozinho.</p>
      <Nota tipo="aviso" titulo="No Ubuntu 24.04, prefira o .deb">
        <p>O Ubuntu 24.04 restringe um recurso do sistema (os <em>namespaces</em> de usuário) que a proteção interna do {N} usa, e o AppImage pode não abrir, mesmo com a FUSE instalada. O <code>.deb</code> não tem esse problema. Não desligue a proteção do app para contornar.</p>
      </Nota>
      <h3 id="appimage">AppImage</h3>
      <Passos>
        <li><p>Baixe <code>{arquivo('linux-appimage')}</code> e guarde numa pasta que vai ficar (por exemplo, <code>~/Aplicativos</code>).</p></li>
        <li>
          <p>Torne o arquivo executável: no gerenciador de arquivos, <strong>Propriedades → Permissões → Permitir executar como programa</strong>. Ou, no terminal:</p>
          <Comando>{`chmod +x ${arquivo('linux-appimage')}`}</Comando>
        </li>
        <li><p>Dê dois cliques no arquivo para abrir.</p></li>
      </Passos>
      <Nota titulo="Se o AppImage não abrir">
        <p>O AppImage usa a biblioteca FUSE 2, que algumas distribuições novas não trazem. No Ubuntu 22.04, instale o pacote <code>libfuse2</code>:</p>
        <Comando>{'sudo apt install libfuse2'}</Comando>
        <p>No Ubuntu 24.04 ou mais novo, o pacote é o <code>libfuse2t64</code>, mas lá o AppImage pode não abrir também pelo motivo acima: use o <code>.deb</code>.</p>
      </Nota>
      <h3 id="deb">Pacote .deb</h3>
      <Passos>
        <li><p>Baixe <code>{arquivo('linux-deb')}</code> e abra com a central de programas da sua distribuição. Ou, no terminal, na pasta do download:</p>
          <Comando>{`sudo apt install ./${arquivo('linux-deb')}`}</Comando>
        </li>
        <li><p>Abra o {N} pelo menu de aplicativos.</p></li>
      </Passos>

      <h2 id="primeira-vez">Primeira vez</h2>
      <p>Ao abrir pela primeira vez, o {N} pede duas coisas:</p>
      <Passos>
        <li><p><strong>A pasta da biblioteca.</strong> Escolha onde os seus livros, marcas e notas vão morar, como o cofre do Obsidian. Pode ser uma pasta nova.</p></li>
        <li><p><strong>Entrar no ChatGPT.</strong> O app abre o navegador na página de login da OpenAI. Entre com a sua conta e volte ao {N}: ele percebe sozinho que o login deu certo.</p></li>
      </Passos>
      <p>Pronto. Continue em <a href="/docs/primeiros-passos/">Primeiros passos</a>.</p>
    </>
  ),
};

const primeirosPassos: PaginaDeDoc = {
  slug: 'primeiros-passos',
  titulo: 'Primeiros passos',
  resumo: 'Escolha a pasta da biblioteca, entre no ChatGPT, adicione um texto e leia com as marcas.',
  grupo: 'Começar',
  corpo: () => (
    <>
      <p>O {N} é um assistente de estudos: para livros, artigos, poemas, vídeos e obras de arte, ele mostra o que cada trecho faz, como os trechos se ligam e o que vale perguntar. A ideia não é ler mais depressa, e sim entender melhor. Estes são os primeiros passos.</p>
      <h2 id="pasta">1. Escolha a pasta da biblioteca</h2>
      <p>Na primeira vez que abre, o {N} pergunta onde guardar a biblioteca. Nessa pasta ficam os arquivos originais, o que é gerado a partir deles e, em geral, o banco de dados com as marcas, as notas, as conversas e o progresso de leitura. Para guardar tudo, use <strong>Arquivo → Fazer cópia de segurança…</strong> (veja <a href="/docs/backup/">Backup</a>).</p>
      <ul>
        <li>Prefira uma pasta no disco do computador. Numa pasta sincronizada (OneDrive, iCloud, Dropbox, Google Drive), o {N} guarda o banco fora dela, numa pasta do computador, para a sincronização não o corromper: a nuvem leva os livros, mas não as notas.</li>
        <li>Para trocar de pasta depois, use <strong>Arquivo → Trocar de biblioteca…</strong>.</li>
      </ul>

      <h2 id="chatgpt">2. Entre com a sua conta do ChatGPT</h2>
      <p>O {N} lê os seus textos pelo Codex, com a sua conta do ChatGPT. O app abre o navegador na página de login da OpenAI; entre e volte ao app. O login fica guardado no seu computador e só é pedido de novo se você sair da conta.</p>
      <p>Na tela de boas-vindas, <strong>Abrir o exemplo já marcado</strong> abre um conto curto de domínio público, já com as marcas, para você ver o leitor antes de gastar cota.</p>

      <h2 id="adicionar">3. Adicione um texto</h2>
      <p>Clique em <strong>+</strong> na barra lateral (a página <strong>Adicionar à biblioteca</strong>) e solte os arquivos na área tracejada: PDF, EPUB, Markdown, TXT, vídeo ou áudio, vários de uma vez. Também dá para colar um texto ou um link do YouTube. Os detalhes estão em <a href="/docs/importar/">Adicionar textos e vídeos</a>.</p>
      <p>O PDF aparece como o original. O texto é extraído por trás, invisível, só para marcar e buscar.</p>

      <h2 id="preparar">4. Analise o texto</h2>
      <p>Na página do documento, clique em <strong>Analisar</strong>. O Codex reconhece o tipo de texto (conto, poema, ensaio, artigo científico, texto de filosofia, de economia, de direito e outros) e lê com o modo de leitura certo para ele; se quiser, troque o tipo antes. Ele grifa os trechos que importam, diz a função de cada um, liga os trechos entre si e aponta as passagens difíceis.</p>
      <p>A preparação roda no seu computador e usa o Codex com a sua conta. Um capítulo leva alguns minutos. Você pode ler enquanto isso; as marcas aparecem quando ficam prontas. O app precisa ficar aberto (pode estar minimizado) para a preparação andar.</p>

      <h2 id="ler">5. Leia com as marcas</h2>
      <ul>
        <li><strong>Comentários na margem:</strong> cada grifo do Codex tem um comentário curto, que abre na margem, ao lado do trecho.</li>
        <li><strong>Marcas:</strong> o botão <strong>Marcas</strong> mostra ou esconde os grifos, para ler o texto limpo.</li>
        <li><strong>Estilo:</strong> marca-texto ou sublinhado.</li>
      </ul>

      <h2 id="marcar">6. Grife, pergunte e conecte</h2>
      <p>Quando o capítulo é compreendido, as relações entre os trechos aparecem à esquerda do texto; veja <a href="/docs/relacoes/">Grifos e relações</a>.</p>
      <p>Selecione um trecho. Na barra que aparece, <strong>Grifar</strong> marca o trecho e abre o balão do grifo: escolha a função (as do modo do texto, ou as de outros modos em <strong>Outros olhares</strong>) e escreva a sua nota, que vive dentro do grifo e se salva sozinha. <strong>Perguntar</strong> faz uma pergunta ao trecho, e a resposta cita os parágrafos em que se apoia. <strong>Conectar</strong> liga o trecho a outro, do mesmo texto ou de outro.</p>
      <p>Tudo isso fica reunido em <strong>Notas</strong>, a central do que você e o Codex fizeram nos textos, com busca, filtros e exportação. E <strong>Perguntar</strong>, na barra lateral, abre uma conversa sobre a biblioteca inteira, com as citações de onde vem cada resposta.</p>

      <h2 id="retomar">7. Retome de onde parou</h2>
      <p>O {N} guarda a posição de cada documento. A página inicial da biblioteca mostra o que está em andamento.</p>

      <h2 id="quadros">8. Quadros</h2>
      <p>Em <strong>Adicionar → Quadro</strong>, envie a imagem de uma obra de arte: o {N} identifica a obra e prepara uma análise guiada. Veja <a href="/docs/quadros/">Quadros</a>.</p>
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
      <p>Tudo entra pela página <strong>Adicionar</strong> (o <strong>+</strong> da barra lateral), em três abas: <strong>Documento</strong> (arquivos, texto colado e, recolhido, o <strong>Avançado</strong>), <strong>Vídeo</strong> (link do YouTube, ou vídeo e áudio seus) e <strong>Quadro</strong> (a imagem de uma obra de arte).</p>

      <h2 id="tipos">O que dá para adicionar</h2>
      <div className="tabela-doc">
        <table>
          <thead><tr><th>Tipo</th><th>Arquivos ou origem</th><th>Por onde</th></tr></thead>
          <tbody>
            <tr><td>PDF</td><td><code>.pdf</code>, inclusive escaneado</td><td>Área de soltar</td></tr>
            <tr><td>Livro digital</td><td><code>.epub</code></td><td>Área de soltar</td></tr>
            <tr><td>Texto</td><td><code>.md</code>, <code>.markdown</code>, <code>.txt</code></td><td>Área de soltar</td></tr>
            <tr><td>Texto colado</td><td>Qualquer texto</td><td>Colar texto</td></tr>
            <tr><td>Página da web</td><td>Artigo, post, notícia ou PDF aberto no navegador</td><td><a href="/docs/extensao/">Extensão</a></td></tr>
            <tr><td>Vídeo do YouTube</td><td>Link de um vídeo (não playlist nem canal)</td><td>Link</td></tr>
            <tr><td>Vídeo seu</td><td><code>.mp4</code>, <code>.m4v</code>, <code>.mov</code>, <code>.webm</code>, <code>.mkv</code> + transcrição <code>.json</code></td><td>Área de soltar</td></tr>
            <tr><td>Áudio seu</td><td><code>.mp3</code>, <code>.m4a</code>, <code>.aac</code>, <code>.ogg</code>, <code>.oga</code>, <code>.opus</code> + transcrição <code>.json</code></td><td>Área de soltar</td></tr>
            <tr><td>Marcas de outro arquivo</td><td><code>.json</code> do {N}</td><td>Avançado</td></tr>
            <tr><td>Print de questão</td><td><code>.png</code>, <code>.jpg</code></td><td>Colar com <kbd>Ctrl</kbd>+<kbd>V</kbd> (veja <a href="/docs/questoes/">Resolver questões</a>)</td></tr>
            <tr><td>Obra de arte</td><td>Imagem da obra</td><td>Aba <a href="/docs/quadros/">Quadro</a></td></tr>
          </tbody>
        </table>
      </div>
      <p>Uma questão colada como print vira uma página e a resolução começa sozinha; veja <a href="/docs/questoes/">Resolver questões</a>.</p>

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
        <li>A busca no YouTube usa o <code>yt-dlp</code>, que já vem dentro do app. Playlists e canais não são aceitos, só vídeos.</li>
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
  resumo: 'Adicione imagens de obras de arte e leia cada uma com uma análise guiada.',
  grupo: 'Começar',
  corpo: () => (
    <>
      <p><strong>Quadros</strong> é a parte da biblioteca para obras de arte. Você traz as imagens das obras que quer estudar, e o {N} prepara para cada uma uma análise guiada: o que olhar, onde e por quê, separando o que é documentado do que é interpretação. O {N} traz duas obras de exemplo; o resto da coleção é a sua.</p>

      <h2 id="adicionar">Adicionar uma obra</h2>
      <Passos>
        <li><p>Abra <strong>Adicionar</strong> e escolha a aba <strong>Quadro</strong>.</p></li>
        <li><p>Envie a imagem da obra (JPEG, PNG ou WebP). Se souber, preencha o <strong>título</strong> e o <strong>artista</strong>: ajudam a achar a obra certa.</p></li>
        <li><p>O {N} identifica a obra (título, artista e data) em fontes abertas, como o Wikidata, a Wikipédia e o Wikimedia Commons, e prepara a análise pelo Codex, com a sua conta. Se não reconhecer a obra, a análise segue só pela imagem e diz isso.</p></li>
      </Passos>
      <p>Use imagens que você tem o direito de usar: fotos suas, reproduções em domínio público ou com licença livre. As imagens ficam na pasta da biblioteca, entram no <a href="/docs/backup/">backup</a> e não saem do seu computador, a não ser o que o Codex precisa ler para a análise.</p>

      <h2 id="ler">Ler um quadro</h2>
      <ul>
        <li><strong>Palco:</strong> a obra inteira, com zoom pela roda, pela pinça ou pelos botões, e arrasto para andar por ela.</li>
        <li><strong>Regiões:</strong> as partes da obra de que a análise fala aparecem desenhadas sobre a imagem; passar o cursor numa delas a acende.</li>
        <li><strong>Painel:</strong> as abas <strong>Info</strong> (a obra, onde está, a imagem), <strong>Análise</strong> (as afirmações por tema, como composição, técnica, iconografia e contexto, cada uma com o tipo, de fato documentado a inferência da IA, e o grau de confiança) e <strong>Fontes</strong> (de onde veio cada informação).</li>
        <li><strong>Percorrer</strong> (tecla <kbd>P</kbd>): a câmera vai de afirmação em afirmação, enquadra as regiões dela e mostra o texto ao lado.</li>
        <li><strong>Análise curta</strong> (<kbd>Espaço</kbd>): um passeio pela obra com a legenda acendendo palavra por palavra e, quando há narração, em voz.</li>
      </ul>
    </>
  ),
};

const relacoes: PaginaDeDoc = {
  slug: 'relacoes',
  titulo: 'Grifos e relações',
  resumo: 'Os grifos por função, a nota na margem e as relações entre os trechos, desenhadas à esquerda do texto.',
  grupo: 'Começar',
  corpo: () => (
    <>
      <h2 id="grifos">Grifos</h2>
      <p>Cada grifo tem um modo de leitura e uma função dentro dele: tese e objeção num ensaio, voz narrativa e virada num conto, imagem e ritmo num poema. A cor vem da função. O texto nunca muda de fonte nem de peso: o grifo é desenhado por trás das letras. Na margem fica o número do grifo; clique nele para abrir o comentário do Codex.</p>
      <p>Clique num grifo para abrir o balão: as funções do modo do texto, as dos outros modos em <strong>Outros olhares</strong>, a sua nota (que vive dentro do grifo) e <strong>Perguntar</strong>. Os grifos do Codex também se corrigem ou se apagam ali; apagar sempre pede confirmação.</p>
      <ul>
        <li><strong>Marcas:</strong> o botão <strong>Marcas</strong> mostra ou esconde os grifos.</li>
        <li><strong>Estilo:</strong> grifo (faixa com a linha de base, o padrão), marca-texto, sublinhado ou só na margem; traço de régua ou à mão; e a intensidade, em <strong>Aa</strong>.</li>
      </ul>

      <h2 id="relacoes">Relações entre os trechos</h2>
      <p>Quando você clica em <strong>Analisar</strong> na página do documento, o {N} lê o capítulo como um todo e liga os trechos que conversam entre si. Cada relação aparece à esquerda do texto como uma chave de uma cor: um colchete em cada trecho e uma linha que os une, com um círculo no meio.</p>
      <ul>
        <li>Pare o cursor no círculo: a relação acende, os dois trechos ficam em destaque, o resto esmaece e um cartão diz o que a relação é (<em>sustenta</em>, <em>desenvolve</em>, <em>pressupõe</em>, <em>contrasta com</em>, <em>exemplifica</em>, <em>retoma</em>, <em>responde a</em>, <em>tensiona</em>, <em>ecoa</em>) e por quê.</li>
        <li>Se os dois trechos estão longe, o texto entre eles se recolhe para eles ficarem lado a lado; no PDF, uma janela mostra um em cima do outro.</li>
        <li>Em <strong>Aa</strong>, as relações aparecem como chaves ou como bolinhas; <kbd>[</kbd> esconde e mostra.</li>
      </ul>

      <h2 id="conexoes">Suas conexões</h2>
      <p>Selecione um trecho e clique em <strong>Conectar</strong> para ligar a outro trecho, a outro documento da biblioteca ou a uma nota externa. Escolha a relação (<em>Semelhança</em>, <em>Contraste</em>, <em>Tensão</em>, <em>Pré-requisito</em>, <em>Desenvolve</em>, <em>Exemplo</em>) e escreva o que conecta os dois. Conexões sugeridas pela IA podem ser aceitas ou rejeitadas. Todas vão para o <a href="/docs/obsidian/">Obsidian</a>.</p>
    </>
  ),
};

const videos: PaginaDeDoc = {
  slug: 'videos',
  titulo: 'Vídeos',
  resumo: 'Vídeos do YouTube no player oficial, com a transcrição marcada e a palavra falada acesa no texto.',
  grupo: 'Começar',
  corpo: () => (
    <>
      <p>Um vídeo do YouTube entra pelo link (veja <a href="/docs/importar/#youtube">Adicionar textos e vídeos</a>). O {N} monta o texto com as legendas do próprio vídeo, e esse texto é um documento como os outros: dá para preparar a leitura, grifar, anotar, perguntar e conectar.</p>

      <h2 id="analisar">Analisar um vídeo</h2>
      <p>Na página do vídeo, <strong>Analisar</strong> faz a análise própria do vídeo: a transcrição é passada a limpo (pontuação e maiúsculas, sem perder o tempo de cada palavra), o Codex grifa e liga os trechos como num texto, divide o vídeo em <strong>partes</strong> por assunto e escolhe alguns <strong>momentos</strong> (um conceito, um dado, um contexto, uma pergunta) que aparecem sobre o vídeo no instante certo.</p>

      <h2 id="assistir">Assistir</h2>
      <ul>
        <li>O vídeo toca no <strong>player oficial do YouTube</strong>, embutido ao lado do texto (no celular, acima). Cada reprodução conta para o canal, como no YouTube.</li>
        <li>A palavra falada acende no texto, e a página acompanha a fala. Se você rolar para outro lugar, <strong>Voltar ao trecho atual</strong> traz de volta.</li>
        <li>Clique numa palavra e o vídeo vai até ali.</li>
        <li>Ao lado do vídeo, as <strong>partes</strong> e os <strong>momentos</strong>, clicáveis; um momento abre um cartão curto com a explicação e <strong>Ir ao trecho</strong>.</li>
        <li>Barra do player: tocar e pausar, voltar e avançar 10 segundos, velocidade, capítulos e o tempo que falta.</li>
        <li>Teclado: <kbd>Espaço</kbd> ou <kbd>K</kbd> toca e pausa; <kbd>←</kbd> e <kbd>→</kbd> ou <kbd>J</kbd> e <kbd>L</kbd> voltam e avançam.</li>
      </ul>
      <Nota titulo="Quando o vídeo não pode ser incorporado">
        <p>Se o dono do vídeo não deixa tocar fora do YouTube, o leitor oferece <strong>Assistir no YouTube</strong> e, quando há, <strong>Ouvir o áudio local</strong>, que continua acendendo o texto.</p>
      </Nota>

      <h2 id="seus">Vídeo e áudio seus</h2>
      <p>Um vídeo ou áudio seu, com a transcrição em <code>.json</code>, toca do mesmo jeito, com o texto alinhado palavra por palavra. Veja <a href="/docs/importar/#midia">Vídeo e áudio próprios</a>.</p>
    </>
  ),
};

const questoes: PaginaDeDoc = {
  slug: 'questoes',
  titulo: 'Resolver questões',
  resumo: 'Cole o print de uma questão, ou recorte-a na página do PDF, e receba a resolução passo a passo, com a matemática bem escrita.',
  grupo: 'Começar',
  corpo: () => (
    <>
      <p>O {N} resolve exercícios de livros, listas e provas: matemática, física, economia, o que vier. A resolução vem em passos, para você acompanhar e conferir, não só a resposta.</p>

      <h2 id="print">Resolver a partir de um print</h2>
      <Passos>
        <li><p>Tire o print da questão (ou uma foto) e cole com <kbd>Ctrl</kbd>+<kbd>V</kbd> (<kbd>Cmd</kbd>+<kbd>V</kbd> no Mac) no Início, na Biblioteca ou em <strong>Adicionar</strong>. Também dá para arrastar o arquivo ou usar <strong>Resolver questão → Escolher imagem</strong>. Aceita PNG e JPEG; outros formatos que o navegador abre são convertidos na hora.</p></li>
        <li><p>A questão entra na biblioteca como "Questão de" e a data, e o {N} abre a resolução sozinho quando ela fica pronta. O mesmo print colado de novo abre a questão que já estava lá.</p></li>
      </Passos>

      <h2 id="recortar">Resolver uma questão num PDF</h2>
      <Passos>
        <li><p>Abra o PDF em que a questão está. Pode ser escaneado: o Codex lê a imagem.</p></li>
        <li><p>No leitor, use <strong>Resolver exercício</strong> (no menu do documento ou com <kbd>Shift</kbd>+<kbd>Ctrl</kbd>+<kbd>S</kbd>) e arraste um retângulo sobre a questão, como num print. Ajuste pelas alças e clique em <strong>Resolver</strong>.</p></li>
        <li><p>O retângulo fica desenhado na página e, na margem, a nota mostra <strong>Resolvendo…</strong>; depois, <strong>Exercício resolvido</strong>. Passe o cursor na nota para ver o enunciado e a ideia; clique para abrir.</p></li>
      </Passos>
      <p>Num texto que não é PDF, selecione a questão e clique em <strong>Resolver</strong> na barra da seleção.</p>

      <h2 id="ler">Ler a resolução</h2>
      <ul>
        <li>Para cada item: a <strong>ideia</strong>, os <strong>passos</strong> com as contas destacadas, a <strong>resposta</strong> e a <strong>conferência</strong>.</li>
        <li><strong>Próximo passo</strong> mostra um passo de cada vez, para você tentar antes; <strong>Mostrar todos</strong> e <strong>Ver a resposta</strong> pulam.</li>
        <li>Não entendeu um passo? Pergunte no campo embaixo: a resposta continua presa à questão.</li>
        <li>A janela pode ficar ao lado, flutuante ou em tela cheia.</li>
      </ul>

      <h2 id="livro">Um livro inteiro</h2>
      <p><strong>Exercícios resolvidos</strong> lista as resoluções do documento. A <strong>Página de exercícios</strong> acha os exercícios do livro, resolve em lotes pequenos (a cota é finita) e exporta tudo em LaTeX e PDF.</p>
      <Nota tipo="aviso" titulo="Confira">
        <p>A resolução é feita por IA e pode errar. A conferência no fim de cada item ajuda; para nota de prova, confira os passos.</p>
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
      <p>A extensão fala com o app de desktop no seu computador, em <code>{CONFIG.enderecoLocal}</code>. É o endereço padrão: não precisa mudar. O {N} precisa estar aberto (pode estar minimizado) para receber o que você envia.</p>
      <Nota tipo="aviso" titulo="Se o teste de conexão falhar">
        <p>Confira se o app está aberto e veja <a href="/docs/problemas/#extensao">Solução de problemas</a>.</p>
      </Nota>
      <p>PDFs abertos do disco (<code>file://</code>) exigem, no Chrome, ligar <em>Permitir acesso a URLs de arquivo</em> nos detalhes da extensão.</p>
    </>
  ),
};

const obsidian: PaginaDeDoc = {
  slug: 'obsidian',
  titulo: 'Obsidian',
  resumo: 'Leve grifos, notas, perguntas e relações para o seu cofre, uma nota por item, com link de volta para o trecho.',
  grupo: 'Integrações',
  corpo: () => (
    <>
      <p>Tudo o que você faz no {N} pode ir para o seu cofre do Obsidian: grifos, marcas que você confirmou ou comentou, anotações, perguntas e respostas, relações, flashcards e exercícios resolvidos. Cada documento vira uma pasta, com a nota do documento e uma nota para cada item. Há três caminhos: o <a href="#instalar">plugin</a>, que mantém o cofre em dia sozinho; no app de computador, <a href="#sem-plugin">exportar direto para o cofre</a>; e, no navegador, <a href="#sem-plugin">baixar a pasta</a> em .zip.</p>

      <h2 id="instalar">Instalar o plugin</h2>
      <Passos>
        <li><p>Baixe <code>main.js</code> e <code>manifest.json</code> do plugin na <a href={CONFIG.urlDoRelease}>página do release</a>.</p></li>
        <li><p>Copie os dois para <code>&lt;seu cofre&gt;/.obsidian/plugins/margem/</code>.</p></li>
        <li><p>No Obsidian, abra <strong>Configurações → Plugins da comunidade</strong>, desligue o modo restrito, recarregue a lista e ative o plugin.</p></li>
      </Passos>

      <h2 id="configurar">Configurar</h2>
      <ul>
        <li><strong>Servidor:</strong> <code>{CONFIG.enderecoLocal}</code>, o app de desktop no seu computador. Ele precisa estar aberto para sincronizar, e os links de volta abrem o trecho nele.</li>
        <li><strong>Pasta:</strong> onde as notas novas são criadas (padrão <code>Margem</code>).</li>
        <li><strong>Marcas da leitura:</strong> desligado, vêm só os seus grifos e as marcas que você confirmou ou comentou. Ligado, vêm também as marcas visíveis da IA.</li>
        <li><strong>Sincronizar ao abrir</strong> ou <strong>a cada N minutos</strong>, se quiser automático.</li>
      </ul>
      <p>Para sincronizar à mão, use o comando <strong>Sincronizar</strong> do plugin ou o ícone de livro na barra lateral.</p>

      <h2 id="sem-plugin">Exportar sem o plugin</h2>
      <p>No documento, abra o menu <strong>•••</strong> e escolha <strong>Exportar para o Obsidian</strong>. Escolha se quer <strong>Incluir as marcas da leitura</strong> (as da IA). Depois:</p>
      <ul>
        <li><strong>Exportar para o cofre…</strong> (no app de computador): escolha a pasta do cofre e as notas são gravadas em <code>Margem/</code>, dentro dela. Exportar de novo atualiza as notas sem apagar o que você escreveu nelas. Para a biblioteca inteira, use <strong>Arquivo → Exportar para o Obsidian…</strong>.</li>
        <li><strong>Baixar a pasta (.zip):</strong> a pasta do documento, para descompactar no cofre.</li>
        <li><strong>Baixar a biblioteca inteira (.zip):</strong> uma pasta por documento, de uma vez.</li>
      </ul>

      <h2 id="nota">Como as notas ficam</h2>
      <ul>
        <li><strong>Uma pasta por documento</strong>, com a nota do documento (o índice, capítulo a capítulo) e as subpastas <code>Grifos</code>, <code>Anotações</code>, <code>Perguntas</code>, <code>Relações</code>, <code>Flashcards</code> e <code>Exercícios</code>.</li>
        <li><strong>Cada grifo</strong> é uma nota com a citação inteira, a função (tese, objeção…), o capítulo e a página, e a lista das anotações, perguntas e relações ligadas a ele.</li>
        <li><strong>Cada relação</strong> é uma nota com os dois trechos inteiros, o porquê e links para as notas das duas pontas, mesmo quando uma delas está em outro documento.</li>
        <li>O que você escreveu no {N} chega como Markdown: ênfase, links e listas continuam valendo.</li>
        <li>As propriedades de cada nota (documento, autor, capítulo, página, função, cor, datas) servem para buscar e filtrar no Obsidian. Tags como <code>#margem/tese</code> e <code>#margem/ia</code> (nas marcas da IA).</li>
        <li>Pode renomear e mover as notas: o {N} acha cada uma pelo <code>margem_id</code> e não cria cópia. Os links <code>^margem-…</code> da nota do documento continuam valendo.</li>
        <li>Os flashcards seguem o formato do plugin Spaced Repetition.</li>
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
        <li>A chave fica guardada só no seu computador, nas configurações do app (fora da pasta da biblioteca), uma por biblioteca. Ela não vai na cópia de segurança: num computador novo, informe-a de novo.</li>
        <li>Com o áudio ligado, o texto que você manda narrar vai para a ElevenLabs, que gera o áudio. O resto da biblioteca não vai.</li>
        <li>O áudio pronto fica salvo no seu computador.</li>
      </ul>
      <Nota titulo="Para desligar">
        <p>Em Configurações → Áudio, clique em <strong>Remover</strong>. Os áudios já gerados continuam na biblioteca.</p>
      </Nota>
      <Nota tipo="aviso" titulo="Troque a chave se a biblioteca estava numa pasta sincronizada">
        <p>Até a versão 0.1.3, a chave ficava dentro da pasta da biblioteca (em <code>segredos</code>). Se essa pasta estava no OneDrive, Dropbox, Google Drive ou iCloud, a chave pode ter ido para a nuvem e para o histórico de versões do serviço. A partir da 0.2, o {N} a tira da biblioteca sozinho. Por segurança, no painel da ElevenLabs apague a chave antiga e crie uma nova; depois, em Configurações → Áudio, clique em <strong>Trocar</strong> e salve a nova.</p>
        <p>Se você usa a mesma biblioteca em dois computadores, informe a chave em cada um.</p>
      </Nota>
    </>
  ),
};

const atualizacoes: PaginaDeDoc = {
  slug: 'atualizacoes',
  titulo: 'Atualizações',
  resumo: `O ${N} se atualiza sozinho. Veja como funciona e o que fazer se a atualização não chegar.`,
  grupo: 'Manutenção',
  corpo: () => (
    <>
      <p>Com o app aberto, o {N} confere de tempos em tempos se há uma versão nova (em <code>margem.dev/atualizacoes</code>, que entrega os arquivos publicados no <a href={CONFIG.urlDoRelease}>GitHub</a>). Se houver, baixa em segundo plano e mostra um aviso discreto no pé da janela: <strong>Reiniciar agora</strong> instala na hora; <strong>Depois</strong> instala quando você fechar o app.</p>
      <p>Para procurar na hora e ver a versão instalada, abra <strong>Configurações → Sobre e atualizações</strong> e clique em <strong>Procurar atualização</strong>.</p>
      <ul>
        <li>A biblioteca continua como estava. Se a versão nova mudar o banco de dados, a mudança é feita sozinha ao abrir, depois de o {N} guardar uma cópia do banco de antes (veja <a href="/docs/backup/#automatica">Cópia automática</a>).</li>
        <li>Leituras em preparação esperam o app voltar e continuam de onde pararam.</li>
        <li>O que mudou em cada versão está em <a href="/novidades/">Novidades</a>.</li>
      </ul>

      <h2 id="formatos">Por formato</h2>
      <ul>
        <li><strong>Windows:</strong> automático.</li>
        <li><strong>Linux, AppImage:</strong> automático; o próprio arquivo é trocado pela versão nova.</li>
        <li><strong>Linux, .deb:</strong> o app baixa a versão nova e pede a senha do sistema para instalar. Se não der, baixe o <code>.deb</code> novo e instale por cima.</li>
        <li><strong>macOS:</strong> enquanto o app não tiver assinatura da Apple, ele só avisa que há versão nova; baixe o <code>.dmg</code> e troque o app na pasta Aplicativos.</li>
      </ul>

      <h2 id="manual">Atualizar à mão</h2>
      <p>Se a atualização automática não funcionar no seu sistema, baixe o instalador da versão nova na <a href="/download/">página de download</a> e instale por cima. A pasta da biblioteca não é tocada.</p>
      <Nota titulo="Faça uma cópia de segurança antes de pular muitas versões">
        <p>Não é obrigatório, mas é barato: <strong>Arquivo → Fazer cópia de segurança…</strong>. Veja <a href="/docs/backup/">Backup</a>.</p>
      </Nota>
      <h2 id="versao-anterior">Voltar para uma versão anterior</h2>
      <p>Uma versão mais antiga não abre uma biblioteca que uma mais nova já atualizou: ela avisa e não mexe em nada. Instale de novo a versão mais nova ou, se precisa mesmo da anterior, restaure a <a href="/docs/backup/#automatica">cópia automática</a> do banco de antes da atualização.</p>
    </>
  ),
};

const backup: PaginaDeDoc = {
  slug: 'backup',
  titulo: 'Backup',
  resumo: 'A cópia de segurança leva a biblioteca e o banco, para uma pasta que você escolhe. Restaurar é copiar de volta.',
  grupo: 'Manutenção',
  corpo: () => (
    <>
      <p>O que é seu no {N} fica em <strong>dois lugares</strong>:</p>
      <ul>
        <li><strong>A pasta da biblioteca</strong>, a que você escolheu: os arquivos originais, o que foi gerado a partir deles (áudios, imagens, vídeos), as obras de Quadros.</li>
        <li><strong>O banco de dados</strong>: marcas, notas, conversas e progresso de leitura. Em geral ele fica dentro da biblioteca, na pasta escondida <code>.margem/banco</code>. Mas se a biblioteca está numa <strong>pasta sincronizada</strong> (OneDrive, Dropbox, Google Drive, iCloud), o banco fica <strong>fora dela</strong>, numa pasta deste computador, para a sincronização não o corromper.</li>
      </ul>
      <p>Os dois caminhos aparecem em <strong>Configurações → Cópia de segurança</strong>.</p>
      <Nota tipo="aviso" titulo="Biblioteca no OneDrive, Dropbox, Google Drive ou iCloud">
        <p>A nuvem guarda os livros, mas <strong>não as notas</strong>: o banco não está na pasta sincronizada. Copiar só a pasta da biblioteca também não leva as notas. Use a cópia de segurança do app, que leva os dois.</p>
      </Nota>

      <h2 id="fazer">Fazer uma cópia de segurança</h2>
      <Passos>
        <li><p>No {N}, abra <strong>Arquivo → Fazer cópia de segurança…</strong> (ou <strong>Configurações → Cópia de segurança</strong>).</p></li>
        <li><p>Escolha onde guardar: um disco externo, um pendrive, outra pasta. Não pode ser dentro da própria biblioteca.</p></li>
        <li><p>O {N} fecha a biblioteca por alguns instantes (preparações em andamento voltam para a fila), copia tudo e abre de novo. No fim, ele diz onde ficou a cópia.</p></li>
      </Passos>
      <p>A cópia é uma pasta com nome e data, por exemplo <code>Cópia do Margem 2026-10-16 14h05</code>, com:</p>
      <ul>
        <li><code>biblioteca</code>: a pasta da biblioteca inteira;</li>
        <li><code>banco</code>: o banco de dados, copiado com o {N} parado e conferido arquivo por arquivo;</li>
        <li><code>LEIA-ME.txt</code>: como restaurar; e <code>manifesto.json</code>: a versão do {N}, a data e o estado do banco.</li>
      </ul>
      <p>Não vão na cópia: o login do ChatGPT, a chave da ElevenLabs e a senha interna do banco. Eles ficam nas configurações do app, no computador.</p>

      <h2 id="restaurar">Restaurar ou levar para outro computador</h2>
      <Passos>
        <li><p><strong>Feche o {N}</strong> de verdade: <strong>Arquivo → Sair</strong> (ou, na bandeja, <strong>Sair</strong>). Fechar só a janela pode deixá-lo aberto. Num computador novo, instale o {N} antes.</p></li>
        <li><p>Copie a pasta <code>biblioteca</code> da cópia para onde quiser, com o nome que quiser. Se for pôr no lugar de uma biblioteca estragada, tire a estragada do caminho antes (renomeie; não apague até conferir a restaurada).</p></li>
        <li><p>Copie a pasta <code>banco</code> da cópia para <strong>dentro da pasta <code>.margem</code></strong> da biblioteca restaurada, substituindo a <code>banco</code> que estiver lá. A <code>.margem</code> é escondida: no Windows, <strong>Exibir → Mostrar → Itens ocultos</strong>; no Linux, <kbd>Ctrl</kbd> <kbd>H</kbd>; no macOS, <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>.</kbd>.</p></li>
        <li><p>Abra o {N} e escolha a pasta restaurada: na primeira tela, num computador novo, ou em <strong>Arquivo → Trocar de biblioteca…</strong>. Se a pasta estiver no OneDrive, Dropbox, Google Drive ou iCloud, o {N} leva o banco para uma pasta do computador na primeira abertura (o banco de antes, se havia um, fica guardado ao lado, com <code>.anterior</code> no nome).</p></li>
        <li><p>Num computador novo, entre de novo no ChatGPT e, se usa o áudio, informe de novo a chave da ElevenLabs.</p></li>
      </Passos>
      <p>Restaure com o {N} da mesma versão da cópia ou de uma mais nova, no mesmo sistema (Windows, macOS ou Linux) em que ela foi feita. De um sistema para outro, o banco não é garantido.</p>
      <Nota titulo="Restaurar ao lado da original">
        <p>Se a biblioteca original ainda estiver no computador, o {N} pergunta: <strong>Você moveu ou copiou esta biblioteca?</strong> <strong>Movi para cá</strong> continua com as mesmas notas; <strong>É uma cópia</strong> faz da pasta uma biblioteca separada, que começa com uma cópia das notas, e a original não muda. Duas pastas nunca dividem o mesmo banco.</p>
      </Nota>

      <h2 id="mao">Cópia à mão</h2>
      <p>Também dá para copiar sem o app: feche o {N} de verdade e copie a pasta da biblioteca. Se nas <strong>Configurações → Cópia de segurança</strong> o banco aparece fora da biblioteca, copie também essa pasta. Os bancos que ficam fora da biblioteca moram em:</p>
      <ul>
        <li>Windows: <code>{`${CONFIG.pastaDosBancos.windows}\\bancos`}</code></li>
        {CONFIG.macPublicado && <li>macOS: <code>{CONFIG.pastaDosBancos.macos}/bancos</code></li>}
        <li>Linux: <code>{CONFIG.pastaDosBancos.linux}/bancos</code></li>
      </ul>
      <p>Para restaurar uma cópia à mão num computador novo, siga os passos acima, pondo a pasta do banco em <code>.margem/banco</code>. No mesmo computador, com a biblioteca numa pasta sincronizada, troque a pasta do banco que as Configurações mostram pela da cópia, com o app fechado.</p>
      <Nota tipo="aviso" titulo="Com o app fechado">
        <p>Copiar o banco com o app aberto pode pegá-lo no meio de uma gravação, e a cópia não abrir depois. A cópia de segurança do app já fecha a biblioteca antes de copiar.</p>
      </Nota>

      <h2 id="automatica">Cópia automática antes de atualizar o banco</h2>
      <p>Quando uma versão nova do {N} precisa mudar o banco, ele guarda antes uma cópia do banco como estava, numa pasta do computador. Fica só a última (a de antes da atualização mais recente), em:</p>
      <ul>
        <li>Windows: <code>{`${CONFIG.pastaDosBancos.windows}\\copias`}</code></li>
        {CONFIG.macPublicado && <li>macOS: <code>{CONFIG.pastaDosBancos.macos}/copias</code></li>}
        <li>Linux: <code>{CONFIG.pastaDosBancos.linux}/copias</code></li>
      </ul>
      <p>Cada biblioteca tem a sua pasta lá, com a pasta <code>banco</code> e um <code>manifesto.json</code> que diz a data e a versão. Para voltar a ela (por exemplo, para usar de novo uma versão anterior do {N}): feche o app, guarde em outro lugar a pasta do banco atual (o caminho está nas Configurações) e ponha no lugar dela a pasta <code>banco</code> da cópia automática.</p>

      <h2 id="nao-abre">Se o banco não abrir</h2>
      <p>Se o {N} disser que o banco da biblioteca não subiu, <strong>não apague nada</strong>: os dados continuam na pasta do banco. Reinicie o computador e abra o {N} de novo. Se continuar, copie a pasta do banco (o caminho aparece na mensagem) para outro lugar, como garantia, e restaure a última cópia de segurança, como acima. Se puder, conte o que houve em <a href={CONFIG.urlDeProblemas}>problemas</a>.</p>

      <h2 id="sincronizar">Pastas sincronizadas</h2>
      <p>Não use a mesma pasta da biblioteca em dois computadores ao mesmo tempo. Numa pasta sincronizada, cada computador tem o seu banco: as notas feitas num não aparecem no outro. Para levar as notas de um computador para outro, use a cópia de segurança.</p>
    </>
  ),
};

const desinstalar: PaginaDeDoc = {
  slug: 'desinstalar',
  titulo: 'Desinstalar',
  resumo: 'Remova o app. A biblioteca fica onde está, até você apagá-la.',
  grupo: 'Manutenção',
  corpo: () => (
    <>
      <p>Desinstalar remove o programa. A <strong>pasta da biblioteca não é apagada</strong>, nem o banco de dados, onde quer que ele esteja: outra instalação do {N} pode abrir a biblioteca. Antes de desinstalar para sempre, faça uma <a href="/docs/backup/">cópia de segurança</a>.</p>

      <h2 id="windows">Windows</h2>
      <p>Abra <strong>Configurações → Aplicativos → Aplicativos instalados</strong>, procure o {N}, clique nos três pontos e em <strong>Desinstalar</strong>.</p>

      {CONFIG.macPublicado && (
        <>
          <h2 id="macos">macOS</h2>
          <p>Encerre o {N} (<strong>Margem → Sair</strong>, ou <kbd>⌘</kbd> <kbd>Q</kbd>) e arraste o app da pasta <strong>Aplicativos</strong> para o Lixo.</p>
        </>
      )}

      <h2 id="linux">Linux</h2>
      <ul>
        <li><strong>AppImage:</strong> feche o app e apague o arquivo <code>.AppImage</code>.</li>
        <li><strong>.deb:</strong> remova pela central de programas ou com <code>{`sudo apt remove ${CONFIG.pacoteDeb}`}</code>.</li>
      </ul>

      <h2 id="o-que-fica">O que fica no computador</h2>
      <ul>
        <li><strong>A pasta da biblioteca</strong>, onde você a escolheu.</li>
        <li><strong>As configurações do app</strong> (qual é a pasta da biblioteca, preferências, o login do ChatGPT feito pelo app e a chave da ElevenLabs), numa pasta própria:
          <ul>
            <li>Windows: <code>{CONFIG.pastaDeConfiguracoes.windows}</code></li>
            {CONFIG.macPublicado && <li>macOS: <code>{CONFIG.pastaDeConfiguracoes.macos}</code> (no Finder, <strong>Ir → Ir para a Pasta…</strong>)</li>}
            <li>Linux: <code>{CONFIG.pastaDeConfiguracoes.linux}</code></li>
          </ul>
        </li>
        <li><strong>O banco das bibliotecas em pasta sincronizada</strong> (marcas, notas e leituras) e a <a href="/docs/backup/#automatica">cópia automática</a> de antes das atualizações, nas pastas <code>bancos</code> e <code>copias</code>:
          <ul>
            <li>Windows: <code>{CONFIG.pastaDosBancos.windows}</code></li>
            {CONFIG.macPublicado && <li>macOS: <code>{CONFIG.pastaDosBancos.macos}</code></li>}
            <li>Linux: <code>{CONFIG.pastaDosBancos.linux}</code></li>
          </ul>
        </li>
      </ul>
      <p>Para remover tudo, apague também essas pastas.</p>
      <Nota tipo="aviso" titulo="Não tem volta">
        <p>Apagar a pasta da biblioteca ou a pasta <code>bancos</code> remove livros, marcas e notas para sempre. Com a biblioteca numa pasta sincronizada, as notas estão em <code>bancos</code>, não na nuvem. Faça uma <a href="/docs/backup/">cópia de segurança</a> antes se houver algo que você queira guardar.</p>
      </Nota>
    </>
  ),
};

const perguntas: PaginaDeDoc = {
  slug: 'perguntas',
  titulo: 'Perguntas frequentes',
  resumo: 'Privacidade, cota do ChatGPT, custos e o que o app faz com os seus textos.',
  grupo: 'Ajuda',
  corpo: () => (
    <>
      <h2 id="custo">Quanto custa?</h2>
      <p>O {N} é gratuito e de código aberto. As leituras usam a sua assinatura do ChatGPT, pelo Codex. O áudio é opcional e é pago direto à ElevenLabs, se você usar.</p>

      <h2 id="privacidade">Para onde vão os meus textos?</h2>
      <p>Para lugar nenhum além do seu computador, com uma exceção que você controla. Os arquivos, as marcas, as notas e o banco de dados ficam no seu computador, na pasta da biblioteca (ou, se ela estiver numa pasta sincronizada, o banco numa pasta do app). Não há servidor do {N} guardando nada, nem métricas de uso.</p>
      <p id="openai">A exceção é a leitura por IA: para marcar o texto, escrever as notas e responder às suas perguntas, o Codex manda à OpenAI <strong>só o que ele lê</strong> para fazer aquilo que você pediu (os trechos do capítulo em preparação, ou o trecho e o contexto de uma pergunta), <strong>pela sua conta</strong>. Valem as regras de uso e de privacidade da OpenAI para a sua conta. Se você ligar o áudio, o texto a narrar vai para a ElevenLabs.</p>

      <h2 id="atualizacoes">O app se conecta a mais alguma coisa?</h2>
      <p>Para se atualizar, o app consulta <code>margem.dev/atualizacoes</code>, que encaminha para o GitHub, onde os instaladores são publicados, e baixa a versão nova de lá. Essa consulta não leva nada da sua biblioteca.</p>

      <h2 id="cota">Ele gasta a minha cota do ChatGPT?</h2>
      <p>Sim. Preparar a leitura e responder perguntas usam o Codex, que conta na cota da sua conta, como qualquer uso do Codex. Um livro inteiro pede bem mais do que um artigo. Prepare primeiro os capítulos que vai ler.</p>

      <h2 id="cota-acabou">E se a cota acabar?</h2>
      <p>As leituras pedidas esperam na fila e continuam sozinhas quando a cota voltar; o app avisa e mostra a previsão. Não é preciso pedir de novo. Tudo o que já foi preparado continua disponível: ler, grifar e anotar não usam cota.</p>

      <h2 id="conta">Preciso criar conta no {N}?</h2>
      <p>Não. Não existe conta no {N}. O único login é o do ChatGPT, feito pelo app no seu navegador.</p>

      <h2 id="internet">Funciona sem internet?</h2>
      <p>Ler, grifar e anotar o que já está na biblioteca, sim. Preparar leituras e perguntar precisam de internet, porque passam pelo ChatGPT.</p>

      <h2 id="outro-computador">Posso usar no celular ou em outro computador?</h2>
      <p>O {N} é um app de desktop {CONFIG.macPublicado ? 'para Windows, macOS e Linux' : 'para Windows e Linux (macOS em breve)'}; não há versão para celular. Para levar a biblioteca para outro computador, faça uma cópia de segurança e restaure no outro (veja <a href="/docs/backup/#restaurar">Backup</a>).</p>

      <h2 id="formatos">Que formatos posso ler?</h2>
      <p>PDF, EPUB, Markdown, TXT, texto colado, páginas da web pela extensão, vídeos do YouTube pelo link e vídeo ou áudio seus com a transcrição. Um PDF escaneado, só com imagens, pode ser transcrito pelo Codex página por página. Veja <a href="/docs/importar/">Adicionar textos e vídeos</a>.</p>

      <h2 id="idiomas">Funciona com textos em inglês?</h2>
      <p>Sim. O {N} nasceu para textos em português e também lê em inglês.</p>

      <h2 id="erros">A IA pode errar?</h2>
      <p>Pode. Marcas, notas e respostas são uma camada sobre o texto, não o texto. Toda marca aponta o trecho de onde saiu, para você conferir.</p>

      <h2 id="assinatura">Por que o Windows avisa ao instalar?</h2>
      <p>O {N} ainda não tem assinatura digital da Microsoft. O Windows avisa sobre todo app novo sem assinatura. A <a href="/docs/instalacao/">Instalação</a> mostra como seguir.</p>
    </>
  ),
};

const problemas: PaginaDeDoc = {
  slug: 'problemas',
  titulo: 'Solução de problemas',
  resumo: 'O que fazer quando o app não abre, o Codex não entra, a cota acaba ou a extensão não conecta.',
  grupo: 'Ajuda',
  corpo: () => (
    <>
      <nav className="fichas-doc" aria-label="Problemas comuns">
        <a href="#nao-abre">Não abre</a><a href="#banco">Banco não subiu</a><a href="#codex">Codex sem login</a><a href="#cota">Cota</a><a href="#porta">Porta ocupada</a><a href="#antivirus">Antivírus</a><a href="#extensao">Extensão</a>
      </nav>

      <h2 id="nao-abre">O app não abre</h2>
      <ul>
        <li><strong>Windows:</strong> se o SmartScreen bloqueou, veja <a href="/docs/instalacao/#windows">Instalação no Windows</a>.</li>
        <li><strong>Linux:</strong> confira se o AppImage está marcado como executável e se a biblioteca FUSE 2 está instalada (veja <a href="/docs/instalacao/#appimage">AppImage</a>). No Ubuntu 24.04 ou mais novo, use o <a href="/docs/instalacao/#deb">.deb</a>: lá o AppImage pode não abrir.</li>
        <li>O {N} abre uma janela só. Se ele já estiver rodando (por exemplo, minimizado na bandeja), abrir de novo traz a janela existente para a frente.</li>
      </ul>

      <h2 id="banco">“O banco da biblioteca não subiu”</h2>
      <p>Não apague nem mexa na pasta do banco: os dados continuam nela. Reinicie o computador e abra o {N} de novo. Se continuar, guarde uma cópia da pasta do banco e restaure a última cópia de segurança (veja <a href="/docs/backup/#nao-abre">Se o banco não abrir</a>).</p>

      <h2 id="versao-mais-nova">“Esta biblioteca foi aberta por uma versão mais nova”</h2>
      <p>Você está abrindo, com uma versão antiga do {N}, uma biblioteca que uma versão mais nova já atualizou. Nada foi alterado. Instale a versão mais nova pela <a href="/download/">página de download</a>; se precisa mesmo da antiga, veja <a href="/docs/atualizacoes/#versao-anterior">Voltar para uma versão anterior</a>.</p>

      <h2 id="codex">O app diz que o Codex não está logado</h2>
      <p>O login do ChatGPT expirou ou foi desfeito. Use o botão de entrar que aparece no aviso do app: ele abre o navegador na página de login da OpenAI. Entre e volte ao {N}.</p>
      <p>Se o navegador não abrir, confira se há um navegador padrão definido no sistema e tente de novo.</p>

      <h2 id="cota">“Limite de uso” ou leitura parada na fila</h2>
      <p>A cota do Codex na sua conta acabou por enquanto. O app avisa na tela, com a previsão de volta. Nada se perde: as leituras na fila continuam sozinhas quando a cota voltar. Ler, grifar e anotar continuam funcionando.</p>

      <h2 id="porta">Porta {CONFIG.porta} ocupada</h2>
      <p>O {N} atende no seu computador em <code>{CONFIG.enderecoLocal}</code>, que a extensão do navegador e o plugin do Obsidian usam. Se outro programa já ocupa essa porta, o app avisa ao abrir. Feche o outro programa (ou outra cópia do {N} rodando, por exemplo, de outra conta do computador) e abra o app de novo.</p>

      <h2 id="antivirus">O antivírus bloqueou ou apagou o app</h2>
      <p>Alguns antivírus desconfiam de apps novos sem assinatura digital, ou de programas que o {N} traz dentro (o banco de dados e o Codex). Baixe o instalador só da <a href="/download/">página de download</a> ou da <a href={CONFIG.urlDoRelease}>página do release</a> e, se o antivírus bloquear, libere a pasta do {N} nas exceções dele. Se puder, relate o caso em <a href={CONFIG.urlDeProblemas}>problemas</a>, com o nome do antivírus.</p>

      <h2 id="leitura-falhou">A preparação de um capítulo falhou</h2>
      <p>Abra os trabalhos do documento para ver a mensagem. Na maior parte dos casos, basta pedir de novo. Se o erro se repetir no mesmo texto, relate em <a href={CONFIG.urlDeProblemas}>problemas conhecidos</a>, sem anexar o livro.</p>

      <h2 id="pdf">O PDF abre, mas não aparece texto para marcar</h2>
      <p>O PDF provavelmente é só imagem, sem camada de texto. Na página de adicionar, use <strong>Transcrever as páginas</strong> na linha dele (veja <a href="/docs/importar/#escaneado">PDF escaneado</a>).</p>

      <h2 id="youtube">O vídeo do YouTube entrou sem texto</h2>
      <p>O vídeo não tem legendas, nem as automáticas na língua original. Ele toca assim mesmo, sem o texto ao lado. Se o leitor diz que o dono não permite assistir fora do YouTube, use <strong>Assistir no YouTube</strong> ou <strong>Ouvir o áudio local</strong>.</p>

      <h2 id="extensao">A extensão não conecta</h2>
      <ul>
        <li>O {N} precisa estar aberto (pode estar minimizado): a extensão fala com ele em <code>{CONFIG.enderecoLocal}</code>.</li>
        <li>Confira, nas opções da extensão, se o servidor é <code>{CONFIG.enderecoLocal}</code>, e clique em <strong>Testar conexão</strong>.</li>
        <li>Se a porta estiver ocupada por outro programa, veja <a href="#porta">Porta ocupada</a>.</li>
      </ul>

      <h2 id="ajuda">Ainda com problema?</h2>
      <p>Relate em <a href={CONFIG.urlDeProblemas}>{CONFIG.urlDeProblemas}</a> com o sistema, a versão do {N} e o que aconteceu. Se anexar registros do app, revise antes: eles podem citar títulos dos seus documentos.</p>
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

      <h2 id="fonte">Rodar a partir do código-fonte</h2>
      <p>Quem quiser compilar o {N} ou rodá-lo como servidor encontra as instruções de desenvolvimento no <code>README.md</code> do <a href={CONFIG.urlDoRepositorio}>repositório</a>.</p>

      <h2 id="modos">Modos de leitura</h2>
      <p>Os modos de leitura (as funções que cada um marca e as suas cores) ficam em <code>contratos/</code>, e as instruções da IA em <code>prompts/</code>. Propostas de modos novos são bem-vindas, com textos de exemplo de domínio público.</p>
    </>
  ),
};

export const PAGINAS_DE_DOCS: readonly PaginaDeDoc[] = [
  instalacao, primeirosPassos, importar, relacoes, videos, questoes, quadros, extensao, obsidian, audio, atualizacoes, backup, desinstalar, perguntas, problemas, contribuir,
];

export const GRUPOS: readonly Grupo[] = ['Começar', 'Integrações', 'Manutenção', 'Ajuda'];
