# Novidades do Margem

O que mudou em cada versão do app. O workflow do app (`.github/workflows/app.yml`) usa a seção
`## vX.Y.Z` da tag como notas do release; a página https://margem.dev/novidades/ conta a mesma história
com mais detalhe. Ao criar uma versão nova, acrescente a seção dela no topo antes de criar a tag.

## v0.2.0

- **macOS a caminho**: o app para Apple Silicon e Intel (macOS 14 ou mais novo) já é montado e testado; sai
  assim que for conferido num Mac de verdade.
- **Sumário dos livros**: o EPUB usa o sumário do próprio livro para os capítulos ("1. The Challenge of the
  Future" em vez de "1" e o título separados). Ao importar, o Margem confere o sumário e, se algo parecer
  errado, sugere outro, que você aplica ou não, sem mexer no texto nem nos grifos.
- **Importação**: TXT e Markdown antigos do Windows (acentos em Windows-1252, UTF-16, BOM); tabelas, imagens e
  notas de rodapé do EPUB (a nota abre no lugar, como nos leitores de livro); PDF grande abre na primeira
  página sem esperar o resto.
- **Leitor**: Ctrl/⌘ Z desfaz grifos; desfazer não se perde numa falha; abrir um livro volta ao capítulo onde
  você parou; erros aparecem em português com "Tentar novamente", sem tela branca.
- **Conta do ChatGPT**: "Conectar ao ChatGPT" (e "Conectar novamente") nas Configurações, sem terminal.
- **Ajuda**: "Relatar um problema…" e "Copiar informações do app" (versão e sistema, sem conteúdo dos livros).
- **Abrir com**: PDF e EPUB podem ser abertos com o Margem pelo sistema (macOS e Linux; no Windows, "Escolher
  outro aplicativo"). Links da extensão e do Obsidian abrem direto no app.
- **Cópia de segurança**: Arquivo → Fazer cópia de segurança… (também em Configurações) copia a biblioteca e
  o banco, com o app parado, para uma pasta que você escolhe, com um LEIA-ME de restauração. Antes de cada
  atualização que muda o banco, o app guarda sozinho uma cópia. As Configurações mostram onde ficam a
  biblioteca e o banco: numa pasta do OneDrive, Dropbox, Google Drive ou iCloud, o banco (marcas, notas,
  leituras) fica fora dela, e a nuvem não o leva.
- **Biblioteca renomeada ou movida** continua abrindo com as mesmas notas, inclusive no OneDrive e com troca
  só de maiúsculas no Windows. Uma cópia da pasta aberta ao lado da original pergunta se você moveu ou copiou,
  e a cópia nunca divide o banco com a original.
- **Privacidade**: o serviço local do Margem exige uma chave guardada no seu computador, então outra conta do
  mesmo computador não lê a sua biblioteca. Para a extensão e o Obsidian, copie a chave em Configurações. No
  Windows, o ChatGPT trabalha sem acesso aos seus arquivos: o conteúdo vai no pedido.
- **Chave da ElevenLabs**: até a 0.1.3 ela ficava dentro da pasta da biblioteca. Se a pasta estava numa
  nuvem, apague a chave antiga no painel da ElevenLabs, crie uma nova e salve em Configurações → Áudio.
- **Mais robusto**: fechar ou travar o app não deixa programas rodando; se o banco não parar, a atualização
  espera; cota do ChatGPT esgotada pausa todos os trabalhos até voltar; disco cheio dá mensagem clara;
  proxy de empresa funciona; quando um antivírus bloqueia um componente, o app diz qual.
- **Banco que não abre** e **biblioteca aberta por versão mais nova**: a mensagem diz o que fazer (preservar
  a pasta e restaurar a última cópia; instalar a versão nova), sem reparo que apague dados.
- **Linux**: testado no Ubuntu 22.04; no Ubuntu 24.04, use o .deb.

## v0.1.3

- **Atualizações**: ao abrir o app, um aviso mostra a versão nova com "Atualizar agora" (com o progresso do
  download; reinicia sozinho ao terminar) ou "Depois" (instala ao fechar); notificação do sistema quando a
  versão fica pronta com o app em segundo plano.
- **Trabalhos parados**: trabalho do Codex parado há mais de 3 horas fica em pausa ao abrir o app, com o
  aviso "N trabalhos do Codex esperando" (Retomar, Ver, Descartar); o que você pede na hora roda normal.
- **PDF**: a dobra entre os dois trechos de uma relação volta a cobrir a página no modo Bolinhas e fica
  aberta com o mouse sobre os recortes.

## v0.1.2

- **Correção**: o instalador não levava o catálogo de tipos de texto, e o reconhecimento do tipo de um
  documento novo falhava ("tentativas esgotadas"); sem o tipo, o botão Analisar dava "falha_interna".
  Depois de atualizar, a leitura pedida dos documentos parados segue com o tipo padrão; para reconhecer o
  tipo, use Reenfileirar no trabalho que falhou.

## v0.1.1

Primeira versão para instalar no computador: o Margem é um app de desktop para Windows e Linux (macOS em breve),
usa a sua conta do ChatGPT pelo Codex e guarda a biblioteca numa pasta sua.

- **Instalação**: tudo dentro do instalador (banco, preparação de textos, Codex); biblioteca numa pasta
  escolhida por você (backup é copiar a pasta); login do ChatGPT pelo navegador; atualização automática
  no Windows e no AppImage do Linux; tela de boas-vindas com um exemplo já marcado.
- **Biblioteca**: PDF, EPUB, Markdown, TXT e texto colado; PDF mostrado como o original; PDF escaneado
  transcrito página por página; vídeos do YouTube pelo link; busca, progresso e retomada.
- **Leitura**: botão Analisar com o modo de leitura do tipo de texto; grifos com modo e função e o
  comentário do Codex na margem; a nota do leitor dentro do grifo; perguntar ao trecho e conectar
  trechos; Perguntar à biblioteca inteira; Notas como central de tudo; apagar com confirmação;
  exercícios passo a passo a partir de um print colado ou de um recorte do PDF.
- **Vídeos**: análise própria, com transcrição passada a limpo, partes, momentos sobre o vídeo e karaokê.
- **Quadros**: a obra identificada em fontes abertas e analisada a partir da imagem.
- **Configurações**: modelo e esforço do Codex por tipo de tarefa.
- **Integrações**: extensão para Chrome, Edge, Brave e Firefox; plugin do Obsidian; narração opcional com
  a sua chave da ElevenLabs.
