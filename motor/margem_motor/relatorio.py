"""Relatório separado do contrato: limitações tipadas e contagens auditáveis."""

from collections import Counter
import json


def serializar(dado: object) -> bytes:
    return (json.dumps(dado, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def descrever_limite(limite: dict) -> str:
    return f"{limite['tipo']}: {limite['descricao']}"


def criar_relatorio(canonico: dict, limites: list[dict]) -> dict:
    return {"sha256_original": canonico["documento"]["sha256_original"],
            "hash_estrutural": canonico["hash_estrutural"],
            "blocos_por_tipo": dict(sorted(Counter(b["tipo"] for b in canonico["blocos"]).items())),
            "secoes": len(canonico["secoes"]), "assets": len(canonico["assets"]),
            "paginas_repetidas": [l["pagina"] for l in limites if l["tipo"] == "pagina_repetida"],
            "limites": limites}
