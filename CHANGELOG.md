# Novidades do Margem

O que mudou em cada versão do app. O workflow do app (`.github/workflows/app.yml`) usa a seção
`## vX.Y.Z` da tag como notas do release; a página https://margem.dev/novidades/ conta a mesma história
com mais detalhe. Ao criar uma versão nova, acrescente a seção dela no topo antes de criar a tag.

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
