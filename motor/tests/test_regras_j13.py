"""Regras do J13: ligaturas em título, hífen em título e no corpo, atribuição de epígrafe."""

import json
from pathlib import Path

import pymupdf

from margem_motor.blocos import (Bloco, Estilo, Fragmento, acao_do_hifen, anexar_atribuicao, juntar,
                                 limites_de_ancoras_legadas, normalizar_ligaturas,
                                 normalizar_ligaturas_do_bloco)
from margem_motor.ingest import canonizar
from test_ingest import validar

DEJAVU = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
ORIGEM = {"tipo": "pdf", "pagina": 1, "bbox": [0, 0, 10, 10]}


def bloco(tipo: str, texto: str) -> Bloco:
    return Bloco(tipo, texto, fragmentos=[Fragmento(dict(ORIGEM), 0, len(texto))])


# ---------------------------------------------------------------- ligaturas_em_titulo

def test_ligaturas_tipograficas_viram_letras():
    assert normalizar_ligaturas("Subclassiﬁcation") == "Subclassification"
    assert normalizar_ligaturas("ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ") == "ff fi fl ffi ffl st st"
    assert normalizar_ligaturas("café 🧭 “aspas”") == "café 🧭 “aspas”"


def test_ligaturas_do_bloco_reposicionam_estilos_e_origens():
    titulo = Bloco("secao", "ﬁ 🧭 Subclassiﬁcation", [Estilo(4, 20, "italico")], [Fragmento(dict(ORIGEM), 0, 20)])
    normalizar_ligaturas_do_bloco(titulo)
    assert titulo.texto == "fi 🧭 Subclassification"
    assert [(e.inicio, e.fim) for e in titulo.estilos] == [(5, 22)]
    assert [(f.inicio, f.fim) for f in titulo.fragmentos] == [(0, 22)]


def test_limite_so_para_ancora_legada_que_muda_de_comprimento():
    limites = limites_de_ancoras_legadas([("05.json", "m01", "Subclassiﬁcation matters"),
                                          ("05.json", "m02", "sem ligatura")])
    assert [(l["tipo"], l["marca"]) for l in limites] == [("ligatura_em_ancora_legada", "m01")]
    assert "de 24 para 25 unidades UTF-16" in limites[0]["descricao"]
    assert limites_de_ancoras_legadas([]) == []


# ---------------------------------------------------------------- hifen_em_titulo

def test_hifen_em_titulo_so_junta_palavra_conhecida():
    titulo = bloco("capitulo", "Difference-")
    for linha in ("in-", "Differences"):
        juntar(titulo, bloco("capitulo", linha), {"difference", "in", "differences"})
    assert titulo.texto == "Difference-in-Differences"
    conhecida = bloco("secao", "Identi-")
    juntar(conhecida, bloco("secao", "fication"), {"identification"})
    assert conhecida.texto == "Identification"


# ---------------------------------------------------------------- hifen_antes_de_maiuscula

def test_hifen_antes_de_maiuscula_no_corpo():
    nome = bloco("paragrafo", "revisited by Mueller-")
    juntar(nome, bloco("paragrafo", "Smith [2015]"), {"mueller", "smith"})
    assert nome.texto == "revisited by Mueller-Smith [2015]"
    palavra = bloco("paragrafo", "UNI-")
    juntar(palavra, bloco("paragrafo", "VERSAL MUSIC"), {"universal"})
    assert palavra.texto == "UNIVERSAL MUSIC"


def test_corpo_com_minuscula_mantem_a_regra_do_j04():
    assert acao_do_hifen("up", "front", set(), titulo=False) == "remover"
    assert acao_do_hifen("well", "being", {"well-being"}, titulo=False) == "manter"
    assert acao_do_hifen("in", "Differences", set(), titulo=True) == "manter"


# ---------------------------------------------------------------- atribuicao_de_epigrafe

def test_atribuicao_vira_ultima_linha_da_epigrafe():
    epigrafe = bloco("epigrafe", "Numbers got limits.")
    autor = Bloco("epigrafe", "Mos Def", [Estilo(0, 7, "negrito")], [Fragmento(dict(ORIGEM), 0, 7)])
    anexar_atribuicao(epigrafe, autor)
    assert epigrafe.texto == "Numbers got limits.\n— Mos Def"
    assert [(e.inicio, e.fim) for e in epigrafe.estilos] == [(22, 29)]
    assert epigrafe.fragmentos[-1].inicio == 22
    pontuada = bloco("epigrafe", "Jump!")
    anexar_atribuicao(pontuada, bloco("epigrafe", "— House of Pain"))
    assert pontuada.texto == "Jump!\n— House of Pain"


def test_pdf_epigrafe_no_corpo_com_autor_titulo_hifenizado_e_ligatura(tmp_path):
    entrada = tmp_path / "epigrafe.pdf"
    corpo = "Um paragrafo comum do corpo com varias palavras para definir a fonte."
    with pymupdf.open() as documento:
        pagina = documento.new_page()
        pagina.insert_font(fontname="dejavu", fontfile=str(DEJAVU))
        pagina.insert_text((40, 60), "Difference-", fontname="hebo", fontsize=28)
        pagina.insert_text((40, 92), "in-", fontname="hebo", fontsize=28)
        pagina.insert_text((40, 124), "Differences", fontname="hebo", fontsize=28)
        pagina.insert_text((220, 170), "Some things will", fontname="heit", fontsize=10)
        pagina.insert_text((220, 184), "never change.", fontname="heit", fontsize=10)
        pagina.insert_text((220, 202), "Tupac Shakur", fontname="hebo", fontsize=12)
        for i in range(6):
            pagina.insert_text((40, 260 + 14 * i), corpo, fontsize=10)
        pagina = documento.new_page()
        pagina.insert_font(fontname="dejavu", fontfile=str(DEJAVU))
        pagina.insert_text((40, 60), "Subclassiﬁcation", fontname="dejavu", fontsize=28)
        pagina.insert_text((40, 120), "A diferença de diferenças é uma estratégia de identiﬁcação.",
                         fontname="dejavu", fontsize=10)
        for i in range(6):
            pagina.insert_text((40, 140 + 14 * i), corpo, fontsize=10)
        documento.save(entrada)
    with pymupdf.open(entrada) as conferencia:
        assert "ﬁ" in conferencia[1].get_text(flags=pymupdf.TEXT_PRESERVE_LIGATURES)
    legado = tmp_path / "legado.json"
    legado.write_text(json.dumps({"marcas": [{"id": "m01", "citacao": "estratégia de identiﬁcação"}]}))
    c, relatorio = canonizar(entrada, "pdf", tmp_path / "saida", marcas_legadas=[legado])
    titulos = [s["titulo"] for s in c["secoes"]]
    assert titulos == ["Difference-in-Differences", "Subclassification"]
    epigrafes = [b["texto"] for b in c["blocos"] if b["tipo"] == "epigrafe"]
    assert epigrafes == ["Some things will never change.\n— Tupac Shakur"]
    # J15: o corpo também perde o glifo de ligatura.
    assert any("identificação" in b["texto"] for b in c["blocos"] if b["tipo"] == "paragrafo")
    assert not any("ﬁ" in b["texto"] for b in c["blocos"])
    assert [l["marca"] for l in relatorio["limites"] if l["tipo"] == "ligatura_em_ancora_legada"] == ["m01"]
    validar(tmp_path / "saida/canonico.json")
    sem_legado, _ = canonizar(entrada, "pdf", tmp_path / "saida2")
    assert not any(l.startswith("ligatura_em_ancora_legada") for l in sem_legado["limites"])
