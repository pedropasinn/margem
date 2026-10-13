"""Identificadores Crockford de 128 bits, sem relógio ou estado global.

Exceção de ingestão prevista em J04: o serviço recebe os IDs do manifesto.
Não são ULIDs cronológicos; a semente inclui hash do original e posição.
"""

import hashlib

ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def identificar(sha256_original: str, dominio: str, ordem: int) -> str:
    digest = hashlib.sha256(f"{sha256_original}:{dominio}:{ordem}".encode()).digest()
    valor = int.from_bytes(digest[:16], "big")
    return "".join(ALFABETO[(valor >> (5 * posicao)) & 31] for posicao in range(25, -1, -1))
