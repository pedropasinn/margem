# Identidade do Margem

Logo desenhado pelo autor no Figma (13/10/2026): um arco à esquerda, como um parêntese "(", feito de
cinco segmentos, e um "M" maiúsculo, sem serifa e pesado. O arco é a margem do livro; as cinco cores
são as funções que o Margem marca no texto.

## Cores

| Uso | Claro | Escuro |
|---|---|---|
| Arco, de cima para baixo | `#8B6DDA` roxo · `#398FE0` azul · `#ED6158` vermelho · `#EFB13F` amarelo · `#30B8A4` verde-água | as mesmas |
| M e palavra "Margem" | `#2B2B2B` | `#FFFFFF` |
| Lema "Por uma formação integral" | `#6E6E73` | `#A1A1AA` |
| Fundo do ícone de app | `#FFFFFF` | `#16161C` |

No site e no app, a palavra e o lema leem os tokens `--marca-palavra` e `--marca-lema` (no tema sépia
do app, a cor do texto do tema). O arco nunca muda de cor, nem no escuro.

## Arquivos

| Arquivo | O que é |
|---|---|
| `simbolo-figma-escuro.svg`, `arco-figma.svg` | Exportação original do Figma. Não alterar. |
| `simbolo.svg` · `simbolo-claro.svg` · `simbolo-escuro.svg` | Símbolo (arco + M) recortado num quadrado; o primeiro com o M em `currentColor`. |
| `icone-app-claro.svg` · `icone-app-escuro.svg` | Ícone de app: quadrado arredondado (raio 22%) com o símbolo, a tinta em 73,5% da altura. |
| `icone-mac-claro.svg` · `icone-mac-escuro.svg` | O mesmo na grade do macOS (tela 1024, quadrado de 824 com 100 de folga). |
| `assinatura-claro.svg` · `assinatura-escuro.svg` | Assinatura completa: arco + "Margem" + lema. |
| `assinatura-curta-claro.svg` · `assinatura-curta-escuro.svg` | Arco + "Margem", sem o lema (cabeçalhos). |
| `favicon.svg` | Símbolo sem fundo; o M troca de cor com `prefers-color-scheme`. |
| `favicon.ico` | 16, 32 e 48 (ícone escuro). |
| `icone.ico` | Windows: 16 a 256, PNG dentro do ICO. |
| `icone.icns` | macOS: icp4–icp6, ic07–ic14 (16 a 1024, com os @2x), na grade do macOS. |
| `png/icone-{claro,escuro}-{16…1024}.png` | Ícone de app em PNG (também 180 e 192). `png/icone-mac-*-1024.png`, `png/icone-mascaravel-*-512.png` (PWA). |
| `bandeja/bandejaTemplate.png` + `@2x` | Bandeja do macOS: símbolo em preto com alfa (o sistema pinta). |
| `bandeja/bandeja-16.png` · `bandeja-32.png` | Bandeja no Windows e no Linux (ícone escuro pequeno). |
| `assinatura.json` | Paths da assinatura para os componentes (`site/src/componentes/marca-dados.ts`, `web/src/ui/marca-dados.ts`). |
| `fonte/InterVariable.ttf` + `OFL.txt` | Inter 4.001 (SIL Open Font License), usada para pôr o texto em contorno. |

## Como regenerar

```
python3 tools/identidade/assinatura.py      # precisa só do fontTools; texto em contorno, sem depender da fonte instalada
node tools/identidade/rasterizar.mjs        # Chromium do Playwright: PNGs, ICO, ICNS, cópias para site/web/extensão
```

O `rasterizar.mjs` copia os ícones para `site/public/`, `web/public/` e `extensao/icones/` e escreve
os módulos `marca-dados.ts`; o app de desktop copia de `docs/identidade/` ao construir
(`desktop/scripts/construir.mjs`).

## Tipografia da assinatura

- **"Margem"**: o M é o path canônico do símbolo; "argem" é Inter Display ExtraBold (opsz 32, wght 800),
  o corte cujo M coincide com o do símbolo (haste 15,4 e largura 73,2 no corpo 90; o da Inter mede
  15,8 e 73,3). Kerning da própria fonte.
- **Lema**: Inter Regular (opsz 14, wght 400), corpo 26 na mesma escala (29% da altura das versais de "Margem").
- Na assinatura completa, o bloco (versal de "Margem" até a base do lema) fica centrado na altura do arco.
  Na curta, "Margem" fica na mesma altura do M do símbolo.

## Usos

- **Ícone de app** (desktop, PWA, extensão, favicon.ico): o escuro, porque o quadrado `#16161C`
  aparece em barras claras e escuras; o branco some nas claras. Onde dá para seguir o tema (o
  `favicon.svg`), o M acompanha o sistema.
- **Assinatura curta**: cabeçalho do site e barra do app. **Completa**: rodapé do site, boas-vindas do
  app e janela de abertura do desktop. Imagem Open Graph: a curta (o lema já está na frase ao lado).
- Claro sobre fundos claros, escuro sobre fundos escuros. Não recolorir o arco, não separar o M do arco
  no símbolo, não esticar, não pôr sombra nem contorno.

## Área de respiro

Em volta do símbolo e da assinatura, deixar livre no mínimo a largura de um segmento do arco
(≈ 18% da altura do arco; 0,18 × a altura da assinatura). Os SVGs já vêm recortados na tinta, sem
respiro embutido: o respiro é de quem usa.

## Tamanhos mínimos

| Peça | Mínimo |
|---|---|
| Ícone de app | 16 px (até 32 px usa uma versão com a tinta em 84% da altura, gerada pelo `rasterizar.mjs`) |
| Símbolo sem fundo | 16 px de altura |
| Assinatura curta | 24 px de altura (versal de "Margem" ≈ 10 px) |
| Assinatura completa | 64 px de altura (lema ≈ 11 px); abaixo disso, usar a curta |
