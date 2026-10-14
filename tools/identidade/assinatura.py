"""Gera a assinatura do Margem (arco + "Margem" + "Por uma formação integral") em SVG, com o texto em contorno.

Fonte: Inter 4.001 (OFL), variável, em `docs/identidade/fonte/InterVariable.ttf`.
- "argem": Inter Display ExtraBold (opsz 32, wght 800), o corte cujo M coincide com o M canônico do
  símbolo (haste 15,4 e largura 73,2 no corpo 90; o M da Inter nesse corte mede 15,8 e 73,3).
- O "M" da palavra é o path canônico do símbolo, sem troca: a assinatura não repete o M isolado.
- Lema: Inter Text Regular (opsz 14, wght 400).
Kerning lido do GPOS (PairPos formatos 1 e 2, também dentro de Extension).

Precisa só do fontTools (não é dependência do repositório; qualquer Python com fontTools serve):
    python3 tools/identidade/assinatura.py
Saída: docs/identidade/assinatura-{claro,escuro}.svg, assinatura-curta-{claro,escuro}.svg e
docs/identidade/assinatura.json (paths para os componentes do site e do app).
"""
from __future__ import annotations

import json
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

RAIZ = Path(__file__).resolve().parents[2]
IDENT = RAIZ / "docs/identidade"
FONTE = IDENT / "fonte/InterVariable.ttf"

ARCO = [
    ("#8B6DDA", "M76.805 28.957C68.5637 34.7276 61.3363 41.8248 55.417 49.96L78.058 66.434C82.1559 60.8018 87.1594 55.8881 92.865 51.893L76.805 28.957Z"),
    ("#398FE0", "M52.03 54.955C46.663 63.4643 42.7442 72.8046 40.433 82.596L67.685 89.028C69.2848 82.2494 71.9976 75.7831 75.713 69.892L52.03 54.955Z"),
    ("#ED6158", "M39.243 88.512C37.586 98.4353 37.586 108.565 39.243 118.488L66.86 113.876C65.7129 107.006 65.7129 99.9938 66.86 93.124L39.243 88.512Z"),
    ("#EFB13F", "M40.433 124.404C42.7442 134.195 46.663 143.536 52.03 152.045L75.713 137.108C71.9976 131.217 69.2848 124.751 67.685 117.972L40.433 124.404Z"),
    ("#30B8A4", "M55.417 157.04C61.3363 165.175 68.5637 172.272 76.805 178.043L92.865 155.107C87.1594 151.112 82.1559 146.198 78.058 140.566L55.417 157.04Z"),
]
# M canônico do símbolo: x 96.9538..170.143, altura de versal 70.5455..136 (base em y=136).
M_X, M_TOPO, M_BASE = 96.9538, 70.5455, 136.0
M_PONTOS = [(96.9538, 70.5455), (116.545, 70.5455), (133.165, 111.071), (133.932, 111.071), (150.551, 70.5455),
            (170.143, 70.5455), (170.143, 136), (154.738, 136), (154.738, 95.794), (154.195, 95.794), (138.47, 135.585),
            (128.626, 135.585), (112.902, 95.5703), (112.359, 95.5703), (112.359, 136), (96.9538, 136)]
ARCO_Y = (28.957, 178.043)
ARCO_X = (37.586, 92.865)
CORPO = 90.0  # 65,45 de versal / (1490/2048)
LEMA = "Por uma formação integral"
CORPO_LEMA = 26.0
CORES = {
    "claro": {"palavra": "#2B2B2B", "lema": "#6E6E73"},
    "escuro": {"palavra": "#FFFFFF", "lema": "#A1A1AA"},
}


def instancia(eixos: dict[str, float]) -> TTFont:
    return instancer.instantiateVariableFont(TTFont(FONTE), eixos)


def kerning(fonte: TTFont, a: str, b: str) -> int:
    gpos = fonte["GPOS"].table
    indices = {i for fr in gpos.FeatureList.FeatureRecord if fr.FeatureTag == "kern" for i in fr.Feature.LookupListIndex}
    total = 0
    for i in sorted(indices):
        lookup = gpos.LookupList.Lookup[i]
        for sub in lookup.SubTable:
            if lookup.LookupType == 9:
                sub = sub.ExtSubTable
            if getattr(sub, "LookupType", 2) != 2 or not hasattr(sub, "Coverage"):
                continue
            if a not in sub.Coverage.glyphs:
                continue
            valor = None
            if sub.Format == 1:
                conj = sub.PairSet[sub.Coverage.glyphs.index(a)]
                for par in conj.PairValueRecord:
                    if par.SecondGlyph == b:
                        valor = par.Value1
                        break
            else:
                c1 = sub.ClassDef1.classDefs.get(a, 0)
                c2 = sub.ClassDef2.classDefs.get(b, 0)
                valor = sub.Class1Record[c1].Class2Record[c2].Value1
            if valor is not None:
                total += getattr(valor, "XAdvance", 0) or 0
                break  # primeira subtabela que cobre o par decide (regra do OpenType)
    return total


def linha(fonte: TTFont, texto: str, corpo: float, x0: float, base: float, pular_primeira: bool = False) -> tuple[str, float, float]:
    """Contorno de `texto` com a origem em x0 e a linha de base em `base`. Devolve (d, x_inicial_tinta, x_final_tinta)."""
    cmap = fonte.getBestCmap()
    gs = fonte.getGlyphSet()
    upm = fonte["head"].unitsPerEm
    s = corpo / upm
    nomes = [cmap[ord(c)] for c in texto]
    caneta = 0.0
    partes: list[str] = []
    xmin, xmax = None, None
    for i, nome in enumerate(nomes):
        if i > 0:
            caneta += kerning(fonte, nomes[i - 1], nome)
        if not (pular_primeira and i == 0):
            pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
            gs[nome].draw(TransformPen(pen, (s, 0, 0, -s, x0 + caneta * s, base)))
            partes.append(pen.getCommands())
            bp = BoundsPen(gs)
            gs[nome].draw(bp)
            if bp.bounds:
                gx0, gx1 = x0 + (caneta + bp.bounds[0]) * s, x0 + (caneta + bp.bounds[2]) * s
                xmin = gx0 if xmin is None else min(xmin, gx0)
                xmax = gx1 if xmax is None else max(xmax, gx1)
        caneta += gs[nome].width
    return "".join(partes), xmin or x0, xmax or x0


def m_canonico(dx: float, dy: float) -> str:
    pts = [(x + dx, y + dy) for x, y in M_PONTOS]
    return "M" + "L".join(f"{x:.4f} {y:.4f}".replace(".0000", "") for x, y in pts) + "Z"


def main() -> None:
    display = instancia({"wght": 800, "opsz": 32})
    texto = instancia({"wght": 400, "opsz": 14})
    s = CORPO / display["head"].unitsPerEm
    gs = display.getGlyphSet()
    bp = BoundsPen(gs)
    gs["M"].draw(bp)
    lsb_m = bp.bounds[0] * s

    saidas: dict[str, dict[str, object]] = {}
    for tipo in ("curta", "completa"):
        if tipo == "curta":
            dy = 0.0  # "Margem" na mesma altura do M do símbolo
        else:
            # Bloco (versal de "Margem" até a base do lema) centrado na altura do arco.
            entre = 46.0  # base de "Margem" → base do lema
            altura = (M_BASE - M_TOPO) + entre
            topo = (ARCO_Y[0] + ARCO_Y[1]) / 2 - altura / 2
            dy = topo - M_TOPO
        base = M_BASE + dy
        x0 = M_X - lsb_m
        palavra, _, fim = linha(display, "Margem", CORPO, x0, base, pular_primeira=True)
        palavra = m_canonico(0, dy) + palavra
        lema_d, lema_fim = "", fim
        if tipo == "completa":
            gs_t = texto.getGlyphSet()
            bpp = BoundsPen(gs_t)
            gs_t[texto.getBestCmap()[ord(LEMA[0])]].draw(bpp)
            lsb_p = bpp.bounds[0] * CORPO_LEMA / texto["head"].unitsPerEm
            lema_d, _, lema_fim = linha(texto, LEMA, CORPO_LEMA, M_X - lsb_p, base + entre)
        largura_x = max(fim, lema_fim)
        caixa = (ARCO_X[0], ARCO_Y[0], largura_x - ARCO_X[0], ARCO_Y[1] - ARCO_Y[0])
        saidas[tipo] = {"viewBox": " ".join(f"{v:.2f}" for v in caixa), "palavra": palavra, "lema": lema_d}

        for tema, cores in CORES.items():
            arco = "\n".join(f'  <path d="{d}" fill="{c}"/>' for c, d in ARCO)
            corpo = f'  <path d="{palavra}" fill="{cores["palavra"]}"/>'
            if lema_d:
                corpo += f'\n  <path d="{lema_d}" fill="{cores["lema"]}"/>'
            titulo = "Margem — Por uma formação integral" if lema_d else "Margem"
            svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{saidas[tipo]["viewBox"]}" fill="none" role="img" aria-label="{titulo}">\n'
                   f"  <title>{titulo}</title>\n{arco}\n{corpo}\n</svg>\n")
            nome = "assinatura" if tipo == "completa" else "assinatura-curta"
            (IDENT / f"{nome}-{tema}.svg").write_text(svg, encoding="utf-8")

    saidas["arco"] = {"segmentos": [{"cor": c, "d": d} for c, d in ARCO]}
    saidas["cores"] = CORES
    (IDENT / "assinatura.json").write_text(json.dumps(saidas, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("ok", {k: v["viewBox"] for k, v in saidas.items() if isinstance(v, dict) and "viewBox" in v})


if __name__ == "__main__":
    main()
