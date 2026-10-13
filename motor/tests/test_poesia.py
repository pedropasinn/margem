"""J15: estrofe em Markdown, TXT e colado; corpus de Machado de Assis; aviso de página em branco."""

import hashlib
import json
from pathlib import Path

import pymupdf
import pytest

from margem_motor.contratos import comprimento_utf16, faixas_dos_versos, versos_validos
from margem_motor.ingest import canonizar
from margem_motor.pdf import eh_pagina_em_branco_declarada
from test_ingest import RAIZ, executar, fatiar, validar

POESIA = RAIZ / "fixtures" / "poesia"


def canonico_de(tmp_path, texto: str, formato: str = "md", **opcoes) -> dict:
    entrada = tmp_path / f"entrada.{ 'md' if formato == 'md' else 'txt'}"
    entrada.write_text(texto, encoding="utf-8")
    c, _ = canonizar(entrada, formato, tmp_path / "saida", **opcoes)
    validar(tmp_path / "saida" / "canonico.json")
    return c


def estrofes(c: dict) -> list[str]:
    return [b["texto"] for b in c["blocos"] if b["tipo"] == "estrofe"]


# ---------------------------------------------------------------- prosa não muda

# hash_estrutural gerado por `main` (eb3fc67) antes do J15, com os mesmos fixtures.
HASHES_DA_PROSA = {
    ("md", "unicode-dificil.md"): "992eddcd15c455dd1f11475cd48813e8bff899c50d81a63fc19fe3efc1a1df64",
    ("txt", "colado.txt"): "6f3210b1885abe877cf4918181028134e0b9737c04db8b31ecf5c90c41b8da7b",
    ("colado", "colado.txt"): "6f3210b1885abe877cf4918181028134e0b9737c04db8b31ecf5c90c41b8da7b",
}


@pytest.mark.parametrize("formato,arquivo", list(HASHES_DA_PROSA))
def test_prosa_mantem_o_hash_estrutural(tmp_path, formato, arquivo):
    c, _ = canonizar(RAIZ / "fixtures" / arquivo, formato, tmp_path / "saida")
    assert c["hash_estrutural"] == HASHES_DA_PROSA[(formato, arquivo)]
    assert not any(b["tipo"] == "estrofe" for b in c["blocos"])
    assert "poesia" not in c["canonizacao"]["config"]


def test_quebra_em_parte_das_linhas_e_espacos_numa_linha_so_continuam_prosa(tmp_path):
    c = canonico_de(tmp_path, "# T\n\numa linha com quebra  \nsegunda linha\nterceira\n\nlinha única  \n")
    assert [b["tipo"] for b in c["blocos"]] == ["capitulo", "paragrafo", "paragrafo"]
    assert c["blocos"][1]["texto"] == "uma linha com quebra segunda linha terceira"


# ---------------------------------------------------------------- detecção

@pytest.mark.parametrize("fim", ["  ", "\\", "<br>", "<br/>", " <BR />"])
def test_quebra_dura_vira_estrofe(tmp_path, fim):
    texto = f"# Poema\n\nprimeiro verso{fim}\nsegundo verso   \n\nterceiro{fim}\nquarto\n"
    c = canonico_de(tmp_path, texto)
    assert estrofes(c) == ["primeiro verso\nsegundo verso", "terceiro\nquarto"]


def test_br_no_meio_da_linha_separa_versos(tmp_path):
    c = canonico_de(tmp_path, "um<br>dois<br />três\n")
    assert estrofes(c) == ["um\ndois\ntrês"]


def test_quebra_dura_em_txt(tmp_path):
    c = canonico_de(tmp_path, "verso um  \nverso dois\n\nprosa comum\nem duas linhas\n", "txt")
    assert [b["tipo"] for b in c["blocos"]] == ["capitulo", "estrofe", "paragrafo"]


def test_colado_com_poesia(tmp_path):
    texto = "Querida, ao pé do leito derradeiro\nEm que descansas\n\nverso só\n"
    c = canonico_de(tmp_path, texto, "colado", poesia=True)
    assert estrofes(c) == ["Querida, ao pé do leito derradeiro\nEm que descansas", "verso só"]
    assert c["canonizacao"]["config"]["poesia"] is True
    sem, _ = canonizar(tmp_path / "entrada.txt", "colado", tmp_path / "sem")
    assert not any(b["tipo"] == "estrofe" for b in sem["blocos"])


def test_cli_poesia_e_recusa_em_pdf(tmp_path, sintetico):
    entrada = tmp_path / "colado.txt"
    entrada.write_text("um\ndois\n", encoding="utf-8")
    processo = executar(entrada, "colado", tmp_path / "saida", "--poesia")
    assert processo.returncode == 0, processo.stderr.decode()
    assert [b["texto"] for b in json.loads(processo.stdout)["blocos"] if b["tipo"] == "estrofe"] == ["um\ndois"]
    recusa = executar(sintetico, "pdf", tmp_path / "pdf", "--poesia")
    assert recusa.returncode == 1 and recusa.stdout == b""
    assert "--poesia" in recusa.stderr.decode()


def test_frontmatter_do_documento(tmp_path):
    c = canonico_de(tmp_path, "---\npoesia: true\nautor: X\n---\n\n# Título\n\n- um\n2. dois\n\n> citação\n")
    assert [b["tipo"] for b in c["blocos"]] == ["capitulo", "estrofe", "citacao"]
    assert estrofes(c) == ["- um\n2. dois"]  # na poesia, marcador de lista é texto do verso
    assert any(l.startswith("frontmatter:") for l in c["limites"])
    assert not any("autor" in b["texto"] for b in c["blocos"])


def test_frontmatter_da_secao_vale_so_na_secao(tmp_path):
    texto = ("# Livro\n\nprosa\nda abertura\n\n## Poema\n\n---\npoesia: true\n---\n\nverso um\nverso dois\n\n"
             "### Parte do poema\n\nainda verso\noutro verso\n\n## Ensaio\n\nprosa\nde novo\n")
    c = canonico_de(tmp_path, texto)
    assert [(b["tipo"], b["texto"]) for b in c["blocos"]] == [
        ("capitulo", "Livro"), ("paragrafo", "prosa da abertura"), ("secao", "Poema"),
        ("estrofe", "verso um\nverso dois"), ("secao", "Parte do poema"),
        ("estrofe", "ainda verso\noutro verso"), ("secao", "Ensaio"), ("paragrafo", "prosa de novo")]


def test_secao_pode_desligar_a_poesia_do_documento(tmp_path):
    c = canonico_de(tmp_path, "---\npoesia: true\n---\n# Poema\n\num\ndois\n\n# Nota\n\n---\npoesia: false\n---\n\nprosa\nsim\n")
    assert [b["tipo"] for b in c["blocos"]] == ["capitulo", "estrofe", "capitulo", "paragrafo"]


def test_tres_tracos_sem_chaves_nao_e_frontmatter(tmp_path):
    c = canonico_de(tmp_path, "---\nisto não é chave\n---\n")
    assert c["blocos"][1]["texto"] == "--- isto não é chave ---"
    assert c["limites"] == []


def test_recuo_preservado_e_registrado(tmp_path):
    texto = "---\npoesia: true\n---\n\nsem recuo  \n    recuado com espaços\n\trecuado com tab\n"
    c = canonico_de(tmp_path, texto)
    assert estrofes(c) == ["sem recuo\n    recuado com espaços\n    recuado com tab"]
    assert [l for l in c["limites"] if l.startswith("recuo_de_verso")] == [
        "recuo_de_verso: Estrofe nas linhas 5–7: 2 verso(s) com recuo inicial preservado como espaços."]


def test_inline_na_estrofe_e_offsets_utf16(tmp_path):
    c = canonico_de(tmp_path, "*Ó* mar 🌊 salgado,  \nquanto do teu **sal**\n")
    bloco = next(b for b in c["blocos"] if b["tipo"] == "estrofe")
    assert bloco["texto"] == "Ó mar 🌊 salgado,\nquanto do teu sal"
    assert [(f["estilo"], fatiar(bloco["texto"], f["inicio"], f["fim"])) for f in bloco["inline"]] == [
        ("italico", "Ó"), ("negrito", "sal")]
    assert faixas_dos_versos(bloco["texto"])[1]["inicio_utf16"] == comprimento_utf16("Ó mar 🌊 salgado,") + 1


# ---------------------------------------------------------------- corpus de Machado de Assis

CORPUS = [
    # arquivo, título, versos por estrofe, palavra acentuada (ou não ASCII) do último verso
    ("circulo-vicioso.md", "Círculo vicioso", [4, 4, 3, 3], "não"),
    ("a-carolina.md", "A Carolina", [4, 4, 3, 3], "São"),
    # O último verso do Soneto de Natal não tem letra acentuada: confere a aspa curva (U+201C).
    ("soneto-de-natal.md", "Soneto de Natal", [4, 4, 3, 3], "“Mudaria"),
]


@pytest.mark.parametrize("arquivo,titulo,versos,palavra", CORPUS)
def test_poema_de_machado(tmp_path, arquivo, titulo, versos, palavra):
    entrada = POESIA / arquivo
    manifesto = json.loads((RAIZ / "fixtures/manifest.json").read_text())
    material = next(m for m in manifesto["materiais"] if m["caminho"] == f"fixtures/poesia/{arquivo}")
    assert hashlib.sha256(entrada.read_bytes()).hexdigest() == material["sha256"]
    c, _ = canonizar(entrada, "md", tmp_path / "saida")
    validar(tmp_path / "saida" / "canonico.json")
    assert c["documento"]["titulo"] == titulo and c["documento"]["idioma"] == "pt"
    assert [s["titulo"] for s in c["secoes"]] == [titulo]
    assert [b["tipo"] for b in c["blocos"]] == ["capitulo"] + ["estrofe"] * len(versos)
    blocos = [b for b in c["blocos"] if b["tipo"] == "estrofe"]
    assert [b["texto"].count("\n") + 1 for b in blocos] == versos
    assert sum(versos) == 14
    assert all(versos_validos(b["texto"]) for b in blocos)
    assert not any("Machado" in b["texto"] or "edicao" in b["texto"] for b in c["blocos"])
    # Âncora UTF-16 numa palavra do último verso, conferida pela faixa do verso.
    ultimo = blocos[-1]
    faixa = faixas_dos_versos(ultimo["texto"])[-1]
    verso = fatiar(ultimo["texto"], faixa["inicio_utf16"], faixa["fim_utf16"])
    assert verso == ultimo["texto"].split("\n")[-1]
    inicio = faixa["inicio_utf16"] + comprimento_utf16(verso[:verso.index(palavra)])
    fim = inicio + comprimento_utf16(palavra)
    assert fatiar(ultimo["texto"], inicio, fim) == palavra
    assert inicio == comprimento_utf16(ultimo["texto"][:ultimo["texto"].index(palavra)])
    assert not palavra.isascii()


# ---------------------------------------------------------------- página em branco declarada

@pytest.mark.parametrize("texto", [
    "This page intentionally left blank", "THIS PAGE IS INTENTIONALLY LEFT BLANK.", "[Intentionally left blank]",
    "This page left intentionally blank", "Esta página foi deixada em branco intencionalmente",
    "Página intencionalmente deixada em branco", "Esta página foi intencionalmente deixada em branco",
    "Página deixada em branco propositalmente", "Esta página está intencionalmente em branco"])
def test_avisos_de_pagina_em_branco(texto):
    assert eh_pagina_em_branco_declarada(texto)


@pytest.mark.parametrize("texto", ["Página em branco", "A página em branco do poeta", "blank",
                                   "This page left me blank", "The page was intentionally left blank by him"])
def test_nao_sao_avisos_de_pagina_em_branco(texto):
    assert not eh_pagina_em_branco_declarada(texto)


def test_pdf_pagina_em_branco_vira_nada_com_limite(tmp_path):
    entrada = tmp_path / "branco.pdf"
    corpo = "Um paragrafo comum do corpo com varias palavras para definir a fonte."
    with pymupdf.open() as documento:
        pagina = documento.new_page()
        pagina.insert_text((40, 60), "Capitulo", fontname="hebo", fontsize=28)
        for i in range(6):
            pagina.insert_text((40, 120 + 14 * i), corpo, fontsize=10)
        pagina = documento.new_page()
        pagina.insert_text((200, 400), "This page intentionally left blank", fontname="heit", fontsize=12)
        pagina = documento.new_page()
        pagina.insert_text((200, 400), "Esta pagina foi deixada em branco intencionalmente", fontname="heit",
                           fontsize=12)
        documento.save(entrada)
    c, relatorio = canonizar(entrada, "pdf", tmp_path / "saida")
    validar(tmp_path / "saida" / "canonico.json")
    assert [b["tipo"] for b in c["blocos"]] == ["capitulo"] + ["paragrafo"]
    assert not any("blank" in b["texto"] or "branco" in b["texto"] for b in c["blocos"])
    assert [(l["tipo"], l["pagina"]) for l in relatorio["limites"]] == [
        ("pagina_em_branco_declarada", 2), ("pagina_em_branco_declarada", 3)]
