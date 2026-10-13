import json
from pathlib import Path

import pytest

from margem_motor.contratos import comprimento_utf16, faixas_dos_versos, hash_estrutural, projetar_raw_text, versos_validos

CASOS = Path(__file__).resolve().parents[2] / "contratos/casos"
ESPERADOS = json.loads((CASOS / "esperados.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("esperado", ESPERADOS, ids=lambda item: item["arquivo"])
def test_unicode_hash_e_projecao_iguais_ao_typescript(esperado):
    canonico = json.loads((CASOS / esperado["arquivo"]).read_text(encoding="utf-8"))
    blocos = canonico["blocos"]
    assert hash_estrutural(blocos) == esperado["hash_estrutural"] == canonico["hash_estrutural"]
    assert projetar_raw_text(blocos) == {
        "raw_text": esperado["raw_text"],
        "offsets": esperado["offsets"],
    }
    assert [
        {"id": bloco["id"], "comprimento": comprimento_utf16(bloco["texto"])}
        for bloco in blocos
    ] == esperado["comprimentos_utf16"]
    estrofes = [bloco for bloco in blocos if bloco["tipo"] == "estrofe"]
    assert [{"id": bloco["id"], "faixas": faixas_dos_versos(bloco["texto"])} for bloco in estrofes] == esperado["versos_utf16"]
    for bloco in estrofes:
        utf16 = bloco["texto"].encode("utf-16-le")
        versos = [utf16[f["inicio_utf16"] * 2 : f["fim_utf16"] * 2].decode("utf-16-le") for f in faixas_dos_versos(bloco["texto"])]
        assert versos == bloco["texto"].split("\n")
    # Python não usa índices de code points ao recuperar as faixas do TS.
    raw_utf16 = esperado["raw_text"].encode("utf-16-le")
    for bloco in blocos:
        faixa = esperado["offsets"][bloco["id"]]
        assert raw_utf16[faixa["inicio_utf16"] * 2 : faixa["fim_utf16"] * 2].decode("utf-16-le") == bloco["texto"]


def test_todos_os_canonicos_validos_tem_esperados():
    assert {item["arquivo"] for item in ESPERADOS} == {
        str(caminho.relative_to(CASOS)) for caminho in (CASOS / "Canonico").glob("valido-*.json")
    }


@pytest.mark.parametrize("texto,comprimento", [("🧭", 2), ("café", 5), ("ﬁ", 1), ("\r\n", 2), ("", 0)])
def test_comprimento_utf16(texto, comprimento):
    assert comprimento_utf16(texto) == comprimento


def test_recusa_surrogate_isolado():
    with pytest.raises(UnicodeEncodeError):
        comprimento_utf16("\ud83e")


def test_projecao_vazia_e_ids_duplicados():
    assert projetar_raw_text([]) == {"raw_text": "", "offsets": {}}
    bloco = {"id": "bloco", "tipo": "paragrafo", "texto": "🧭"}
    with pytest.raises(ValueError, match="duplicados"):
        projetar_raw_text([bloco, bloco])


def test_estrofe_com_acento_travessao_e_verso_longo_passa_pela_ponte():
    [esperado] = [item for item in ESPERADOS if item["arquivo"] == "Canonico/valido-estrofe.json"]
    canonico = json.loads((CASOS / esperado["arquivo"]).read_text(encoding="utf-8"))
    [estrofe, *_] = [bloco for bloco in canonico["blocos"] if bloco["tipo"] == "estrofe"]
    versos = estrofe["texto"].split("\n")
    assert "—" in estrofe["texto"] and "é" in estrofe["texto"] and "e\u0301" in estrofe["texto"]
    assert max(comprimento_utf16(verso) for verso in versos) > 120
    assert "\n" in projetar_raw_text(canonico["blocos"])["raw_text"][: comprimento_utf16(estrofe["texto"])]


@pytest.mark.parametrize("texto,valido", [
    ("um\ndois", True), ("  recuado\ndois", True), ("\x85\n\x1c", True), ("🧭\nd", True),
    ("", False), ("um\n", False), ("\num", False), ("um\n\ndois", False), ("um\n \ndois", False),
    ("um\n\ufeff\ndois", False), ("um\n\u3000\ndois", False), ("um\r\ndois", False), ("um\u2028dois", False),
])
def test_regras_do_verso_iguais_ao_typescript(texto, valido):
    assert versos_validos(texto) is valido


def test_faixas_dos_versos_em_utf16():
    assert faixas_dos_versos("🧭\nd") == [{"inicio_utf16": 0, "fim_utf16": 2}, {"inicio_utf16": 3, "fim_utf16": 4}]
    with pytest.raises(ValueError, match="Estrofe"):
        faixas_dos_versos("um\n")
