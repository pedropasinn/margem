"""Capítulos do sumário do PDF, sem depender da tipografia da camada OCR."""

import re

from .blocos import Bloco, Fragmento


def entradas_elegiveis(sumario: list) -> list[tuple[str, int]]:
    """Mesma política para barreiras antecipadas e aplicação posterior do TOC."""
    entradas = [(str(titulo).strip(), pagina) for nivel, titulo, pagina, *_ in sumario
                if nivel == 1 and type(pagina) is int and pagina > 0 and str(titulo).strip()]
    # Alguns scans trazem um marcador por imagem: não são capítulos.
    if not entradas or all(re.fullmatch(r"\d+_[12][LR]", titulo) for titulo, _ in entradas):
        return []
    return entradas


def aplicar_sumario(blocos: list[Bloco], sumario: list, limites: list[dict] | None = None,
                    recorte: tuple[int, int] | None = None) -> bool:
    entradas = entradas_elegiveis(sumario)
    if not entradas:
        return False
    limites = limites if limites is not None else []
    paginas = [min((f.origem["pagina"] for f in b.fragmentos if f.origem["tipo"] == "pdf"), default=0)
               for b in blocos]
    validas = [f.origem["pagina"] for b in blocos for f in b.fragmentos
               if f.origem["tipo"] == "pdf"]
    intervalo = recorte or ((min(validas), max(validas)) if validas else None)
    inicios = []
    for titulo, pagina in entradas:
        if intervalo is not None and not intervalo[0] <= pagina <= intervalo[1]:
            continue
        indice = next((i for i, p in enumerate(paginas) if p == pagina), None)
        if indice is not None and (not inicios or indice > inicios[-1][0]):
            inicios.append((indice, titulo))
        else:
            limites.append({"tipo": "sumario_destino_nao_resolvido", "pagina": pagina,
                            "descricao": f"TOC '{titulo}', página PDF {pagina}: destino ausente, coincidente ou fora "
                                         "da ordem de leitura; estrutura do sumário requer revisão."})
    if not inicios:
        return False
    if inicios[0][0] > 0:
        inicios.insert(0, (0, "Elementos iniciais"))
    # Títulos do sumário são metadados da fonte. Inserimos cabeçalhos antes de
    # finalizar IDs; não reescrevemos nenhum trecho ou offset do corpo extraído.
    for bloco in blocos:
        if bloco.tipo in {"capitulo", "secao"}:
            bloco.tipo, bloco.nivel = "secao", 2
    for inicio, titulo in reversed(inicios):
        origem = dict(blocos[inicio].fragmentos[0].origem)
        cabecalho = Bloco("capitulo", titulo, nivel=1,
                          fragmentos=[Fragmento(origem, 0, 0)])
        blocos.insert(inicio, cabecalho)
    return True
