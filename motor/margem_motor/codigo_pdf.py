"""Composição literal de uma região de código; não usa o reflow de prosa."""

from copy import deepcopy
from typing import TYPE_CHECKING

from .blocos import Bloco, Estilo, Fragmento

if TYPE_CHECKING:
    from .pdf import Linha


def compor_codigo(linhas: list["Linha"], limites: list[dict], *, esquerda: float | None = None) -> Bloco:
    resultado = Bloco("codigo", "", tamanho=linhas[0].tamanho)
    esquerda = min(l.bbox[0] for l in linhas) if esquerda is None else esquerda
    anterior = None
    for linha in linhas:
        # O literal vem dos spans antes do strip. O fallback mantém compatibilidade
        # com linhas construídas por consumidores/testes antigos.
        literal = deepcopy(linha.literal or linha.bloco)
        impressa = linha.bloco.fragmentos[0].origem.get("impressa")
        if impressa:
            for fragmento in literal.fragmentos:
                fragmento.origem["impressa"] = impressa
        mesma_linha = anterior is not None and abs(linha.bbox[1] - anterior.bbox[1]) < linha.tamanho * .25
        separador = "" if anterior is None else " " if mesma_linha else "\n"
        deslocamento_x = linha.bbox[0] - (anterior.bbox[2] if mesma_linha else esquerda)
        recuo = ""
        # Espaços explícitos já estão em literal.texto. Só inferimos o deslocamento
        # que antecede o primeiro span, em fonte monoespaçada, pelo avanço médio observado.
        # Outras fontes podem ter métricas diferentes: o diagnóstico declara a inferência.
        if linha.mono and deslocamento_x > linha.tamanho * .3:
            largura = (linha.bbox[2] - linha.bbox[0]) / max(len(literal.texto), 1)
            quantidade = max(0, round(deslocamento_x / largura)) if largura > 0 else 0
            recuo = " " * quantidade
            if mesma_linha:
                separador = ""  # o espaço entre spans já foi estimado
        if deslocamento_x > linha.tamanho * .3:
            pagina = literal.fragmentos[0].origem["pagina"]
            limites.append({"tipo": "recuo_codigo_inferido" if recuo else "recuo_codigo_nao_resolvido",
                            "pagina": pagina, "bbox": list(linha.bbox),
                            "descricao": f"Código na página PDF {pagina}: " + (
                                f"{len(recuo)} espaços inferidos da geometria; o PDF não informa tabs/recuo original."
                                if recuo else "deslocamento horizontal sem recuo recuperável; caracteres observados preservados.")})
        prefixo = separador + recuo
        deslocamento = len(resultado.texto) + len(prefixo)
        resultado.texto += prefixo + literal.texto
        resultado.estilos.extend(Estilo(e.inicio + deslocamento, e.fim + deslocamento, e.estilo, e.ref)
                                 for e in literal.estilos)
        resultado.fragmentos.extend(Fragmento(dict(f.origem), f.inicio + deslocamento, f.fim + deslocamento)
                                    for f in literal.fragmentos)
        anterior = linha
    return resultado
