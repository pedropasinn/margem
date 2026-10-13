"""Cópia do PDF original com anotações padrão (Highlight e Text), legíveis em qualquer leitor.

Entrada: um JSON no stdin, montado pelo serviço (que é quem lê o banco e a geometria):

    {"entrada": "<original.pdf>", "saida": "<cópia.pdf>",
     "anotacoes": [{"tipo": "grifo" | "nota", "pagina": 1, "quads": [[x0,y0, x1,y0, x1,y1, x0,y1], ...],
                    "cor": "#RRGGBB", "autor": "...", "assunto": "...", "texto": "..."}]}

Os quads vêm da GeometriaV1: pontos da página não rotacionada, origem no canto superior
esquerdo, na ordem sup-esq, sup-dir, inf-dir, inf-esq. O motor não inventa posição: anotação
sem quad válido é recusada. Saída no stdout: {"grifos": n, "notas": m}.
"""

import json
import re
import sys

import pymupdf

COR = re.compile(r"#[0-9A-Fa-f]{6}")


def _cor(valor: str) -> tuple[float, float, float]:
    if not isinstance(valor, str) or not COR.fullmatch(valor):
        raise ValueError(f"Cor inválida: {valor!r}")
    return tuple(int(valor[i:i + 2], 16) / 255 for i in (1, 3, 5))


def _quad(valores: list, pagina: pymupdf.Page) -> pymupdf.Quad:
    if not isinstance(valores, list) or len(valores) != 8 or not all(isinstance(v, (int, float)) for v in valores):
        raise ValueError("Quad deve ter 8 números.")
    x0, y0, x1, y1, x2, y2, x3, y3 = valores
    quad = pymupdf.Quad((x0, y0), (x1, y1), (x3, y3), (x2, y2))
    # A mesma folga de 1 pt que as invariantes da GeometriaV1 aceitam.
    limite = pymupdf.Rect(-1, -1, pagina.cropbox.width + 1, pagina.cropbox.height + 1)
    if quad.is_empty or not limite.contains(quad.rect):
        raise ValueError("Quad fora da página.")
    return quad


def anotar(pedido: dict) -> dict:
    contagem = {"grifos": 0, "notas": 0}
    with pymupdf.open(pedido["entrada"]) as pdf:
        if pdf.needs_pass:
            raise ValueError("O PDF original exige senha.")
        for item in pedido["anotacoes"]:
            numero = item["pagina"]
            if not isinstance(numero, int) or not 1 <= numero <= len(pdf):
                raise ValueError(f"Página inexistente: {numero!r}")
            pagina = pdf[numero - 1]
            quads = [_quad(q, pagina) for q in item["quads"]]
            if not quads:
                raise ValueError("Anotação sem quads.")
            cor = _cor(item["cor"])
            informacao = {"title": item.get("autor", "Margem"), "subject": item.get("assunto", ""),
                          "content": item.get("texto", "")}
            if item["tipo"] == "grifo":
                anotacao = pagina.add_highlight_annot(quads)
                contagem["grifos"] += 1
            elif item["tipo"] == "nota":
                # O ícone fica no começo do trecho, um pouco acima da linha.
                inicio = quads[0].ul
                anotacao = pagina.add_text_annot(pymupdf.Point(max(0, inicio.x - 2), max(0, inicio.y - 14)),
                                                 informacao["content"], icon="Comment")
                contagem["notas"] += 1
            else:
                raise ValueError(f"Tipo desconhecido: {item['tipo']!r}")
            anotacao.set_colors(stroke=cor)
            anotacao.set_info(**informacao)
            anotacao.update()
        pdf.save(pedido["saida"], garbage=1, deflate=True)
    return contagem


def main() -> int:
    try:
        pedido = json.load(sys.stdin)
        print(json.dumps(anotar(pedido)))
        return 0
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as erro:
        print(f"Falha no PDF anotado: {erro}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
