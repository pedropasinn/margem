"""Ponte V1.1: mesmas tuplas JSON/UTF-8 e coordenadas UTF-16 do TypeScript, com a estrofe."""

import hashlib
import json
import re
from typing import TypedDict


class BlocoEstrutural(TypedDict):
    id: str
    tipo: str
    texto: str


class Faixa(TypedDict):
    inicio_utf16: int
    fim_utf16: int


class ProjecaoRawText(TypedDict):
    raw_text: str
    offsets: dict[str, Faixa]


def comprimento_utf16(texto: str) -> int:
    """Recusa surrogates isolados, assim como os validadores TS novos."""
    return len(texto.encode("utf-16-le")) // 2


def hash_estrutural(blocos: list[BlocoEstrutural]) -> str:
    """SHA-256 do JSON compacto [[id,tipo,texto],...], em ordem, sem NFC."""
    tuplas = [[bloco["id"], bloco["tipo"], bloco["texto"]] for bloco in blocos]
    texto = json.dumps(tuplas, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def projetar_raw_text(blocos: list[BlocoEstrutural]) -> ProjecaoRawText:
    offsets: dict[str, Faixa] = {}
    inicio = 0
    for bloco in blocos:
        if bloco["id"] in offsets:
            raise ValueError("Blocos duplicados.")
        fim = inicio + comprimento_utf16(bloco["texto"])
        offsets[bloco["id"]] = {"inicio_utf16": inicio, "fim_utf16": fim}
        inicio = fim + 2
    return {"raw_text": "\n\n".join(bloco["texto"] for bloco in blocos), "offsets": offsets}


# O \s do JavaScript, explícito: o \s do Python inclui U+001C–U+001F e U+0085 e exclui U+FEFF.
_NAO_ESPACO = re.compile("[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]")


def versos_validos(texto: str) -> bool:
    """Regra da estrofe (V1.1): versos só por LF, nenhum vazio ou só de espaços, sem LF nas pontas; CR, U+2028 e U+2029 recusados."""
    if not texto or re.search("[\r\u2028\u2029]", texto):
        return False
    return all(_NAO_ESPACO.search(verso) for verso in texto.split("\n"))


def faixas_dos_versos(texto: str) -> list[Faixa]:
    """Faixas UTF-16 de cada verso, relativas ao texto do bloco."""
    if not versos_validos(texto):
        raise ValueError("Estrofe inválida.")
    faixas: list[Faixa] = []
    inicio = 0
    for verso in texto.split("\n"):
        fim = inicio + comprimento_utf16(verso)
        faixas.append({"inicio_utf16": inicio, "fim_utf16": fim})
        inicio = fim + 1
    return faixas


def conferir_geometria(geometria: dict, canonico: dict) -> bool:
    """Mesmas referências, fronteiras UTF-16, ordem e tolerância de 1 pt do contrato TS."""
    import math
    paginas = {p["numero"]: p for p in geometria["paginas"]}
    if len(paginas) != len(geometria["paginas"]):
        return False
    blocos = {b["id"]: b for b in canonico["blocos"]}
    fins = {}
    for palavra in geometria["palavras"]:
        bloco = blocos.get(palavra["bloco_id"])
        pagina = paginas.get(palavra["pagina"])
        inicio, fim = palavra["inicio_utf16"], palavra["fim_utf16"]
        if not bloco or not pagina or not (0 <= inicio < fim <= comprimento_utf16(bloco["texto"])):
            return False
        if inicio < fins.get(bloco["id"], 0):
            return False
        if not any(o["tipo"] == "pdf" and o["pagina"] == palavra["pagina"] for o in bloco["origens"]):
            return False
        try:
            trecho = bloco["texto"].encode("utf-16-le")[inicio * 2:fim * 2].decode("utf-16-le")
        except UnicodeDecodeError:
            return False
        if not trecho or not _NAO_ESPACO.match(trecho[0]) or not _NAO_ESPACO.match(trecho[-1]):
            return False
        if len(palavra["quad"]) != 8 or any(not math.isfinite(v) or v < -1 or v >
            (pagina["altura"] if i % 2 else pagina["largura"]) + 1 for i, v in enumerate(palavra["quad"])):
            return False
        fins[bloco["id"]] = fim
    return True
