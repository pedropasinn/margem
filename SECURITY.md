# Segurança

Não abra um item público para relatar uma vulnerabilidade. Use o relato privado do GitHub
("Report a vulnerability", na aba **Security** de <https://github.com/pedropasinn/margem>), com os
passos para reproduzir e o impacto esperado.

Respondemos em até sete dias. Corrigimos a última versão publicada; versões antigas não recebem
correções.

O Margem roda no computador de quem o instala: a API escuta só em `localhost` por padrão, e a
credencial do Codex fica num volume local. Relatos sobre exposição da API na rede, leitura de
arquivos fora da pasta de dados, execução de código a partir de documentos importados e vazamento da
credencial do Codex ou da chave da ElevenLabs são especialmente bem-vindos.
