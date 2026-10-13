# Motor de canonização

## Dependências e instalação

O motor usa Python >= 3.12 e PyMuPDF 1.28.2. A versão validada do pytest é 9.1.1.
`pyproject.toml` declara as dependências diretas; `requirements.txt` fixa execução e
`requirements-dev.txt` fixa também os testes e suas dependências transitivas.

Em uma máquina nova, durante o provisionamento (não durante build/testes):

```sh
python3.12 -m venv motor/.venv
motor/.venv/bin/python -m pip install -r motor/requirements-dev.txt
motor/.venv/bin/python -m pip check
```

Sem rede, provisione os mesmos pacotes a partir de um diretório de wheels local com
`--no-index --find-links <diretorio>`. Nesta máquina o ambiente já existe; não é necessário
reinstalá-lo. Não copie `.venv` para o Git. Para execução sem testes, use `requirements.txt`.

## Texto e geometria do PDF

Na ingestão de PDF, o motor também gera `geometria.json`, relacionando palavras e posições
na página ao texto canônico. O serviço valida esse artefato e publica um manifesto da versão;
o leitor usa o original para desenhar a página e a geometria para posicionar marcas e seleção.
`tools/gerar-geometria.sh` permite preparar essa geometria para versões anteriores sem
recanonizar o texto. O motor não escreve no banco. Consulte
`docs/desenho/08-FIDELIDADE-DOCUMENTAL.md` e `docs/jobs/J22-RESULTADO.md`.

## PDF anotado

`margem_motor.pdf_anotado` copia o PDF original e grava os grifos e as notas como anotações
padrão PDF (Highlight e Text), que abrem no Acrobat, Preview, Okular e Zotero. O serviço monta
o pedido (marcas, notas e quads tirados da `geometria.json`) e o passa em JSON pelo stdin
(`GET /api/versoes/:id/pdf-anotado`); o motor não lê o banco nem inventa posição.

## Comandos

Execute as CLIs dentro de `motor/`, com o venv já disponível. Caminhos relativos
de entrada e saída são relativos a esse diretório:

```sh
cd motor
.venv/bin/python -m margem_motor.ingest \
  --entrada ../fixtures/unicode-dificil.md --formato md --saida /tmp/margem-md

.venv/bin/python -m margem_motor.ingest \
  --entrada /caminho/para/livro.pdf --formato pdf --paginas 108-130 \
  --titulo 'Título' --autor 'Autor' --idioma en --saida /tmp/margem-pdf

cd ..
motor/.venv/bin/pytest -q motor/tests
node --import tsx motor/tests/validar_canonicos.mjs /tmp/margem-md/canonico.json
```

`--formato` aceita `pdf`, `md`, `txt` e `colado`; texto é UTF-8. O diretório de
saída deve estar ausente ou vazio. A saída contém `canonico.json`, `relatorio.json`, `geometria.json` para PDF
e `assets/pagina-NNN.png` apenas para páginas com conteúdo não textual detectado.
A saída padrão é o próprio `CanonicoV1`; mensagens e erros vão para stderr.
As páginas são numeradas a partir de 1, com extremos inclusivos. Sem `--idioma`,
stopwords escolhem `pt` ou `en` (empate: `pt`). Nenhuma escrita no banco.

O serviço também executa o Python dentro de `motor/`, com caminhos absolutos de
entrada e saída. Não é necessário um link na raiz nem instalar o pacote no venv.
Assim, worktrees podem compartilhar as dependências do venv e executar o código
Python da própria worktree.

IDs são 128 bits derivados do SHA-256 original, domínio e posição, codificados
como ULID; não representam um horário. É a exceção de ingestão prevista no J04;
o serviço recebe o manifesto, e nenhum modelo gera IDs. `gerado_em` usa a
sentinela `1970-01-01T00:00:00Z`, declarada na config: não é a data de execução ou
da obra. Isso atende ao campo obrigatório de V1 e à reprodução byte a byte.
O serviço deve registrar o horário real da importação no seu envelope.

Markdown reconhece títulos ATX, listas, citações, cercas e inline básico de
itálico, negrito e código. TXT/colado mantêm marcadores inline literais; listas,
citações e cercas também são reconhecidas. Parágrafos unem linhas com espaços;
listas usam LF entre itens. O conteúdo dentro de cercas mantém inclusive CRLF,
indentação e quebras finais. Não há normalização Unicode, execução de HTML ou
carregamento de links/imagens remotos. Não é um parser CommonMark completo.

Poemas (J15) viram blocos `estrofe`: um por grupo de linhas separado por linha em
branco, com os versos unidos por LF. O poema é reconhecido quando todas as linhas
de um grupo, menos a última, terminam em quebra dura (dois espaços, `\` ou `<br>`;
`<br>` no meio da linha também separa versos), quando o frontmatter do documento
ou da seção (`---`, `poesia: true`, `---`, logo depois do título) o declara, ou
com `--poesia` (md, txt e colado; recusado em PDF). Numa seção com poesia
declarada, marcador de lista é texto do verso. A marca de quebra e os espaços do
fim saem; o recuo inicial fica como espaços (tab = 4) e é registrado em
`limites` (`recuo_de_verso`). O frontmatter não vira bloco e também é registrado.
Um grupo de uma linha só vira estrofe por quebra dura se tiver `<br>` no meio;
senão precisa de poesia declarada. Prosa sem quebra dura sai idêntica.

PDF usa fonte predominante, recuo e distância entre linhas. Hífens de fim de
linha são removidos, exceto compostos testemunhados no documento. Em títulos, e no
corpo quando a linha seguinte começa com maiúscula, o hífen só sai se a palavra
junta existir no documento; senão fica, sem espaço (`Difference-in-Differences`,
`Mueller-Smith`). Títulos e corpo têm as ligaturas tipográficas desfeitas (`ﬁ` → `fi`;
no corpo desde o J15). Markdown e TXT preservam o texto como veio. Avisos
editoriais como `This page intentionally left blank` ou `Esta página foi deixada
em branco intencionalmente` não viram bloco e ficam em `limites`
(`pagina_em_branco_declarada`). O autor logo abaixo de uma epígrafe vira a última linha dela,
precedido de travessão, e nunca abre seção. `--marcas-legadas arquivo.json`
(repetível) registra em `limites` cada citação legada cujo comprimento a
normalização de ligaturas mudaria. As regras estão nomeadas em `blocos.py` e
`pdf.py` e descritas em `docs/jobs/J13-RESULTADO.md`. Notas têm
blocos próprios; referências só são associadas quando há uma nota inequívoca
na mesma página. Parágrafos entre páginas preservam os fragmentos em UTF-16.
Duplicatas consecutivas exigem igualdade de texto e de pixels renderizados a
60 dpi, inclusive páginas sem texto. Cabeçalhos repetidos não entram no corpo.

Figuras rasterizadas e vetoriais, tabelas com grade ou legenda e equações
reconhecíveis recebem PNG da página inteira a 110 dpi e limite visível. A
classificação é heurística: layouts complexos, múltiplas colunas, fórmulas e
figuras não têm reconstrução integral garantida. O relatório contém limites
tipados; `CanonicoV1.limites` contém as descrições, conforme o contrato congelado.
F1 não faz recorte de regiões, OCR, visão, EPUB ou busca na rede. PDFs sem texto
são diagnosticados; páginas com imagem continuam acessíveis como assets.

Os testes geram `fixtures/sintetico.pdf` em uma pasta temporária, com três páginas,
nota, continuação, figura, equação, tabela e duplicata. O Mixtape é localizado pelo
manifesto local e só é pulado se estiver ausente. A contagem do capítulo 3 distingue
76 parágrafos reunidos de 88 fragmentos por página; a divergência com os 80–100
blocos pedidos no SPEC está detalhada em `docs/jobs/J04-RESULTADO.md`.

## Fidelidade: barreiras e conteúdo literal (J58)

A extração consulta bookmarks elegíveis de nível 1 antes de unir parágrafos entre
páginas. O mesmo critério é usado na aplicação posterior do sumário. Marcadores de
scan não são capítulos; destinos coincidentes ou fora da ordem recebem diagnóstico.
A resolução vertical de dois capítulos na mesma página ainda não está implementada.

Blocos classificados como código PDF têm composição própria: preservam caracteres,
espaços observados e quebras entre linhas, sem deshifenização ou expansão de
ligaturas. Espaços inferidos da geometria monoespaçada são diagnosticados; fontes
proporcionais com deslocamento não recuperável também recebem aviso. Isso não garante
classificação perfeita de código nem recuperação de linhas vazias ausentes do extrator.
`juntar`, usada para prosa, recusa blocos do tipo código.

A identificação `canonizacao.motor` inclui revisão 2, SHA-256 dos fontes Python
efetivos e versão PyMuPDF. Assim mudanças locais do algoritmo também são distinguíveis,
sem depender de commit Git ou horário. O hash não certifica fidelidade nem captura
todas as diferenças de ambiente entre plataformas. O serviço conserva essa identidade
no resultado da execução. Novas saídas exigem diretório vazio e nova publicação;
versões existentes não são regravadas.

Após a revisão J58, o literal também conserva sobrescritos anexados, e a geometria
alinha tanto ligaturas literais quanto expansões legadas sem alterar o canônico.
Fronteiras explícitas impedem também o descarte de páginas repetidas. Destinos do
TOC sem bloco na página pedida geram aviso, sem deslocamento para a página seguinte.
Intervalos verticais entre grupos consecutivos de código preservam a referência
horizontal e recebem diagnóstico de separação.

Na inicialização, o pacote captura seus fontes Python numa cópia privada somente
leitura em /tmp; todos os submódulos, inclusive imports tardios, vêm dessa cópia.
O hash identifica os fontes congelados daquele processo. Atualizações do checkout
valem para processos novos. Dependências do venv/interpretador não fazem parte da
cópia e devem permanecer estáveis durante uma execução. O encerramento normal limpa
a cópia; interrupção abrupta pode deixar arquivos temporários.
