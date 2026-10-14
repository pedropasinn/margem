"""Imagem de uma questão → PDF de uma página (J119).

O print ou a foto de uma questão entra na biblioteca como um PDF de uma página com a imagem em
tamanho natural (o PyMuPDF põe 96 pontos por polegada quando a imagem não declara outra resolução
e respeita a orientação EXIF das fotos). O leitor mostra essa página como mostra qualquer PDF: a
imagem original, sem texto extraído no lugar dela. A resolução recebe um PNG da mesma imagem.

Uso (chamado pelo serviço):

    python -m margem_motor.imagem --entrada <imagem> --saida <pasta>

Escreve `<pasta>/questao.pdf` e `<pasta>/questao.png` e imprime no stdout
`{"largura": px, "altura": px, "formato": "png" | "jpeg"}`. Só PNG e JPEG: os outros formatos
(WebP, HEIC) são convertidos para PNG no navegador antes do envio, sem dependência nova aqui.
O PDF sai determinístico: a mesma imagem dá os mesmos bytes (o serviço reconhece o duplicado).
"""

import argparse
import json
import sys
from pathlib import Path

import pymupdf

ASSINATURAS = ((b"\x89PNG\r\n\x1a\n", "png"), (b"\xff\xd8\xff", "jpeg"))
#: Teto de pixels da imagem (a API confere antes pelo cabeçalho; aqui é a segunda trava).
PIXELS_MAXIMOS = 40_000_000
#: Lado maior do PNG que vai para o modelo: um print cabe inteiro; uma foto de 12 MP é reduzida.
LADO_DO_PNG = 3000
#: PNG original até este tamanho vai como está para a resolução (bytes idênticos aos do print).
BYTES_DO_PNG_ORIGINAL = 8 * 1024 * 1024


def formato_da_imagem(conteudo: bytes) -> str | None:
    for assinatura, formato in ASSINATURAS:
        if conteudo.startswith(assinatura):
            return formato
    return None


def converter(conteudo: bytes) -> tuple[bytes, bytes, dict]:
    """Devolve (pdf, png, dados). Recusa com ValueError o que não for PNG ou JPEG de uma imagem só."""
    formato = formato_da_imagem(conteudo)
    if formato is None:
        raise ValueError("A imagem precisa ser PNG ou JPEG.")
    try:
        with pymupdf.open(stream=conteudo, filetype=formato) as imagem:
            if imagem.page_count != 1:
                raise ValueError("A imagem precisa ter um quadro só.")
            imagem.load_page(0)
            pdf = imagem.convert_to_pdf()
    except ValueError:
        raise
    except Exception as erro:  # noqa: BLE001  (o MuPDF levanta erros próprios para imagem corrompida)
        raise ValueError(f"Imagem ilegível: {erro}") from erro
    with pymupdf.open("pdf", pdf) as documento:
        pagina = documento[0]
        imagens = pagina.get_images(full=True)
        if len(imagens) != 1:
            raise ValueError("A conversão não produziu uma imagem só.")
        largura, altura = imagens[0][2], imagens[0][3]
        if largura <= 0 or altura <= 0 or largura * altura > PIXELS_MAXIMOS:
            raise ValueError("A imagem é grande demais.")
        # A orientação EXIF já está aplicada na página: as dimensões do PNG seguem a página.
        if pagina.rect.width < pagina.rect.height and largura > altura:
            largura, altura = altura, largura
        if formato == "png" and len(conteudo) <= BYTES_DO_PNG_ORIGINAL and max(largura, altura) <= LADO_DO_PNG:
            png = conteudo
        else:
            escala = min(largura / pagina.rect.width, LADO_DO_PNG / max(pagina.rect.width, pagina.rect.height))
            pixmap = pagina.get_pixmap(matrix=pymupdf.Matrix(escala, escala), colorspace=pymupdf.csRGB, alpha=False)
            png = pixmap.tobytes(output="png")
    return pdf, png, {"largura": largura, "altura": altura, "formato": formato}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Imagem de questão → PDF de uma página.")
    parser.add_argument("--entrada", required=True, type=Path)
    parser.add_argument("--saida", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        pdf, png, dados = converter(args.entrada.read_bytes())
    except ValueError as erro:
        print(str(erro), file=sys.stderr)
        return 2
    args.saida.mkdir(parents=True, exist_ok=True)
    (args.saida / "questao.pdf").write_bytes(pdf)
    (args.saida / "questao.png").write_bytes(png)
    print(json.dumps(dados))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
