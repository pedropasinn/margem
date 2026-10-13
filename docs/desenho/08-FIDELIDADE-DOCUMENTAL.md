# Margem · Fidelidade documental

24 de setembro de 2026. Decisão arquitetural: **PDF original na frente; texto extraído trabalhando por trás.**

## Princípio

> Quando existir um documento-fonte com representação visual própria e relevante, o Margem não deve substituir essa representação por uma reconstrução textual. Extração, OCR, parsing, chunking e embeddings são camadas computacionais invisíveis. Sempre que tecnicamente possível, a interação deve acontecer sobre o documento original. **Para PDF, isso é obrigatório.**

O Margem unifica a **interação** com os documentos (seleção, marcas, notas, conversa, conexões, IA), e não a **aparência** deles.

| Formato | Representação visual | Representação semântica |
|---|---|---|
| PDF com texto | o próprio PDF, pela PDF.js (tipografia, paginação, figuras, equações, tabelas, notas, cabeçalhos) | `CanonicoV1` (blocos) + `GeometriaV1` (palavras → posição na página) |
| PDF escaneado | a imagem da página, pela PDF.js | OCR → `CanonicoV1` + `GeometriaV1` com `fonte: 'ocr'` (mesmo formato) |
| EPUB, Markdown, TXT, colado, HTML | leitor próprio do Margem (reflow, tipografia e Aparência nossas) | `CanonicoV1` |

O texto extraído **não** é um segundo documento para o usuário escolher: ele fica vinculado ao original como a sua camada semântica.

## O que já existe e é reaproveitado

- O original fica guardado em `MARGEM_DADOS/<documento>/original.pdf`.
- O canônico já liga cada **linha** à página: `blocos[].origens[] = { tipo: 'pdf', pagina, impressa?, bbox, inicio, fim }` (PyMuPDF, pontos PDF, origem no canto superior esquerdo). Falta a posição **dentro** da linha, e é isso que a `GeometriaV1` acrescenta.
- `AncoraV1` (versão, bloco, offsets UTF-16, citação, prefixo, sufixo) continua sendo a âncora semântica de marcas, anotações, conversas e conexões. Os contratos de marca e anotação **não mudam**: a geometria é derivada da âncora pela `GeometriaV1`, e não gravada solta em cada marca.
- O `Marcador` (traços SVG determinísticos), a margem de notas, o toolbar de seleção, a conversa, as camadas e a atenção são a camada de interação comum; o leitor de PDF só troca o **renderizador**.

## Leitor de PDF: três camadas por página

```
Camada de anotação  ← SVG do Marcador: marcas da IA, do leitor, citação ativa, hover, seleção
Camada de texto     ← TextLayer da PDF.js, transparente: seleção, cópia, busca
Página original     ← canvas da PDF.js (sem rasterização prévia no servidor)
```

- As páginas são renderizadas sob demanda (as visíveis e as vizinhas), com zoom (ajustar à largura, − / +). A página fica **centrada na viewport** pela mesma regra do texto (07), e a margem de notas fica à direita dela.
- Uma marca vira quads: `quadsDaAncora(ancora, palavras)` escolhe as palavras cujo intervalo cruza a âncora, interpola a borda de palavras cortadas pela proporção do offset, e junta palavras vizinhas na mesma linha. Os quads estão em pontos PDF e são multiplicados pela escala do viewport: **o zoom não quebra nada**, porque nada é gravado em pixels.
- A seleção no PDF volta para a semântica por `ancoraDaSelecao(pagina, retangulos, palavras, blocos)`: as palavras dentro dos retângulos da seleção (convertidos para pontos PDF) dão o bloco e os offsets. A seleção que cruza blocos é aparada ao primeiro bloco, como no leitor de texto. A âncora sai conferida (`conferirAncora`) e segue o caminho de hoje (anotar, perguntar, conectar).
- A unidade de leitura continua sendo o capítulo do canônico: o leitor mostra as páginas do capítulo (da primeira à última página tocada pelos seus blocos), com Anterior/Próximo e a lista de capítulos. A página impressa (`impressa`) aparece como referência.
- Figura, tabela ou equação sem texto marcável continuam visíveis, porque são a própria página.

## `GeometriaV1` (contrato novo)

Um arquivo por versão de texto de PDF, `MARGEM_DADOS/<documento>/versao-<id>/geometria.json`:

```ts
interface GeometriaV1 {
  versao: 1;
  versao_id: Id;
  fonte: 'pdf_texto' | 'ocr';
  motor: string;                         // ex.: "margem-geometria/1; PyMuPDF/1.28.2"
  paginas: { numero: number; largura: number; altura: number; rotacao: 0 | 90 | 180 | 270 }[];
  palavras: {
    bloco_id: Id;
    inicio_utf16: number;                // offsets no texto FINAL do bloco (depois das normalizações do motor)
    fim_utf16: number;
    pagina: number;                      // 1 = primeira página do PDF (a mesma numeração de origens.pagina)
    quad: [number, number, number, number, number, number, number, number]; // x1..y4 em pontos, sup-esq, sup-dir, inf-dir, inf-esq
  }[];
}
```

Regras: toda palavra de um bloco com origem PDF é coberta; as palavras de um bloco não se sobrepõem e vêm em ordem; `bloco.texto.slice(inicio, fim)` é a palavra normalizada (uma ligatura desfeita vira `fi`, e a palavra cobre os dois caracteres); o hífen de quebra de linha desfeito pertence à palavra, que pode ter **dois quads**, e nesse caso ela aparece duas vezes, uma por pedaço, com os offsets de cada parte. Documentos sem origem PDF não têm geometria.

## Escaneados

A mesma filosofia: a página continua sendo a imagem original, e o OCR em segundo plano produz o canônico e a `GeometriaV1` com `fonte: 'ocr'`. **A máquina não tem OCR instalado** (nem Tesseract, nem tessdata). O contrato e o leitor já ficam prontos para ele; o motor OCR entra quando o leitor instalar `tesseract-ocr` com os idiomas `por` e `eng`.

## Jobs

| Job | Executor | Assunto |
|---|---|---|
| J22 | Opus | `GeometriaV1` em `contratos/`; `quadsDaAncora`, `ancoraDaSelecao` e `paginasDoCapitulo` em `core/`; o motor gera `geometria.json` na ingestão e também **a partir de um canônico existente** (sem recanonizar, com o mesmo `hash_estrutural`); backfill dos PDFs já na biblioteca |
| J23 | Opus | Serviço: `GET /api/documentos/:id/original` (PDF, com Range), `GET /api/versoes/:v/geometria?paginas=a-b`; o snapshot do capítulo traz `formato`, `paginas` e `geometria_disponivel`; a ingestão grava a geometria |
| J24 | Codex | Web: `DocumentReader` → `PdfReader` (PDF.js: canvas + TextLayer + camada do Marcador, zoom, páginas do capítulo, seleção → âncora, margem alinhada aos quads) e `TextoReader` (o leitor atual, para os demais formatos), com a camada de interação comum |

J22 e J23 rodam em paralelo sobre o contrato acima. J24 começa quando os dois estiverem mesclados.
