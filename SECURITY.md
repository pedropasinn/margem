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

## Chave local do app de computador

Num computador com mais de uma conta, o `localhost` é dividido entre todas elas. Por isso o app de
computador gera, na primeira abertura, uma chave só desta instalação. Ela fica em
`<dados do app>/segredos/chave-local` (0600), fora da pasta da biblioteca. O serviço a recebe por
`MARGEM_CHAVE_LOCAL` e passa a exigi-la em todas as rotas `/api/*`, leituras inclusive (sem ela, 401
`chave_local`). Só a rota de saúde (`/api/saude`) fica aberta. A janela do app recebe a chave pelo
preload e a troca por um cookie `HttpOnly; SameSite=Strict` (`POST /api/sessao`). A extensão do navegador e
o plugin do Obsidian usam o campo Token, com a chave copiada em Configurações → "Chave para a extensão e o
Obsidian". Sem `MARGEM_CHAVE_LOCAL` (desenvolvimento, Docker, servidor pelo Tailscale Serve), a API se
comporta como antes: Host, Origin e `X-Margem` continuam conferidos nos dois casos.

## Isolamento dos comandos do Codex

- **Linux:** um `bwrap` externo esconde o disco. Por dentro, os comandos do modelo usam um perfil de
  permissões que só lê o diretório da execução, e não a casa temporária com a credencial.
- **macOS:** o mesmo perfil, aplicado pelo sandbox do sistema (Seatbelt).
- **Windows:** sem administrador, o sandbox do Codex (`unelevated`) não nega leitura; `read-only` **não**
  protege os arquivos pessoais. O padrão (`MARGEM_CODEX_SANDBOX=sem-ferramentas`) tira as ferramentas do
  modelo: ele só lê o que o Margem põe no prompt. A geração de imagem roda com `read-only`. O agente da
  página Perguntar não abre a biblioteca: o serviço põe no prompt o índice e os trechos mais relevantes
  para a pergunta (busca no texto, capítulos e livros nomeados), até cerca de 120 mil caracteres.
