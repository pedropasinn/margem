import hashlib
import json
from pathlib import Path
import re
import os
import subprocess
import sys

import pymupdf
import pytest

from margem_motor.blocos import Bloco, Estilo, Fragmento, juntar
from margem_motor.contratos import comprimento_utf16
from margem_motor.ids import identificar
from margem_motor.ingest import canonizar
from margem_motor.markdown import extrair_inline

RAIZ = Path(__file__).resolve().parents[2]


def validar(*caminhos):
    resultado = subprocess.run(
        ["node", "--import", "tsx", "motor/tests/validar_canonicos.mjs", *map(str, caminhos)],
        cwd=RAIZ, text=True, capture_output=True, check=False,
    )
    assert resultado.returncode == 0, resultado.stdout + resultado.stderr


def fatiar(texto, inicio, fim):
    return texto.encode("utf-16-le")[inicio * 2:fim * 2].decode("utf-16-le")


def executar(entrada, formato, saida, *opcoes):
    # Com MARGEM_MOTOR (J114), os testes da linha de comando rodam no motor congelado.
    congelado = os.environ.get("MARGEM_MOTOR", "").strip()
    comando = [congelado, "ingest"] if congelado else [sys.executable, "-m", "margem_motor.ingest"]
    return subprocess.run([*comando, "--entrada", str(entrada),
                           "--formato", formato, "--saida", str(saida), *opcoes],
                          cwd=RAIZ / "motor", capture_output=True, check=False)


@pytest.mark.parametrize("formato,arquivo", [("md", "unicode-dificil.md"), ("txt", "colado.txt"), ("colado", "colado.txt")])
def test_cli_determinista_unicode_e_original_intacto(tmp_path, formato, arquivo):
    entrada = RAIZ / "fixtures" / arquivo
    antes = hashlib.sha256(entrada.read_bytes()).hexdigest()
    saidas = [tmp_path / "primeira", tmp_path / "segunda"]
    for saida in saidas:
        processo = executar(entrada, formato, saida)
        assert processo.returncode == 0, processo.stderr.decode()
        assert processo.stdout == (saida / "canonico.json").read_bytes()
        canonico = json.loads(processo.stdout)
        assert canonico["documento"]["sha256_original"] == antes
        assert canonico["documento"]["idioma"] == "pt"
        if formato == "md":
            assert "📖" in canonico["blocos"][0]["texto"]
            assert "café" in canonico["blocos"][1]["texto"]
            assert "ﬁ" in canonico["blocos"][2]["texto"]
            assert canonico["blocos"][-1]["texto"].endswith("uma linha que continua no mesmo parágrafo.")
        assert all("\r" not in b["texto"] and "\n" not in b["texto"] for b in canonico["blocos"])
    for arquivo_saida in ("canonico.json", "relatorio.json"):
        assert (saidas[0] / arquivo_saida).read_bytes() == (saidas[1] / arquivo_saida).read_bytes()
    assert hashlib.sha256(entrada.read_bytes()).hexdigest() == antes
    validar(*(p / "canonico.json" for p in saidas))


def test_markdown_estrutura_inline_utf16_e_codigo_literal(tmp_path):
    entrada = tmp_path / "texto.md"
    codigo = b'\tx = "a  b"\r\n\r\nprint(x)\r\n'
    entrada.write_bytes("# Raiz 🧭\r\n\r\n🧭 *café* e **forte** com `x*y` e _ﬁ_.\r\ncontinuação.\r\n\r\n### Filha\r\n\r\n- item *um*\r\n- item dois\r\n\r\n> uma citação\r\n> em duas linhas\r\n\r\n```python\r\n".encode() + codigo + b'```\r\n\r\n## Irma\r\n\r\nfim\r\n')
    c, _ = canonizar(entrada, "md", tmp_path / "saida", autor="Autora", idioma="en")
    assert c["documento"]["autor"] == "Autora"
    assert c["documento"]["idioma"] == "en"
    assert [s["nivel"] for s in c["secoes"]] == [1, 2, 2]
    p = c["blocos"][1]
    assert p["texto"] == "🧭 café e forte com x*y e ﬁ. continuação."
    assert [(f["estilo"], fatiar(p["texto"], f["inicio"], f["fim"])) for f in p["inline"]] == [
        ("italico", "café"), ("negrito", "forte"), ("codigo", "x*y"), ("italico", "ﬁ")]
    assert p["inline"][0]["inicio"] == 3
    assert p["origens"] == [{"tipo": "texto", "linha_inicio": 3, "linha_fim": 4}]
    assert next(b["texto"] for b in c["blocos"] if b["tipo"] == "lista") == "item um\nitem dois"
    assert next(b["texto"] for b in c["blocos"] if b["tipo"] == "citacao") == "uma citação em duas linhas"
    assert next(b["texto"] for b in c["blocos"] if b["tipo"] == "codigo").encode() == codigo
    validar(tmp_path / "saida/canonico.json")


def test_markdown_que_comeca_em_secao_tem_capitulo_de_nivel_1(tmp_path):
    """V-A8 (v0.1): sem `#`, a primeira seção (`##`) vira capítulo; a compreensão nunca fica sem capítulo."""
    entrada = tmp_path / "secoes.md"
    entrada.write_text("## Seção um\n\nTexto.\n\n### Sub\n\nMais.\n\n## Seção dois\n\nOutro.\n", encoding="utf-8")
    c, _ = canonizar(entrada, "md", tmp_path / "saida")
    assert [(s["nivel"], s["titulo"]) for s in c["secoes"]] == [(1, "Seção um"), (2, "Sub"), (1, "Seção dois")]
    assert [b["tipo"] for b in c["blocos"] if b["tipo"] in {"capitulo", "secao"}] == ["capitulo", "secao", "capitulo"]
    validar(tmp_path / "saida/canonico.json")


@pytest.mark.parametrize("fonte,esperado", [(r"a_b_c e \*literal\*", "a_b_c e *literal*"),
    ("***forte e itálico***", "forte e itálico"), ("`literal **x**`", "literal **x**"),
    ("**forte *dentro* dele**", "forte dentro dele"), ("sem *fechamento", "sem *fechamento")])
def test_inline_nao_corrompe_texto(fonte, esperado):
    texto, estilos = extrair_inline(fonte)
    assert texto == esperado
    assert all(0 <= e.inicio < e.fim <= len(texto) for e in estilos)


def test_sintetico_pdf_proveniencia_notas_assets_e_duplicata(tmp_path, sintetico):
    antes = hashlib.sha256(sintetico.read_bytes()).hexdigest()
    c, r = canonizar(sintetico, "pdf", tmp_path / "saida")
    assert c["secoes"][0]["titulo"] == "Capitulo sintetico"
    assert r["paginas_repetidas"] == [3]
    repetida = next(l for l in r["limites"] if l["tipo"] == "pagina_repetida")
    assert repetida["primeira"] == 2
    assert all("Cabecalho corrente" not in b["texto"] for b in c["blocos"])
    assert all(o["pagina"] != 3 for b in c["blocos"] for o in b["origens"])
    p = next(b for b in c["blocos"] if b["texto"].startswith("Um paragrafo continua"))
    assert p["texto"] == "Um paragrafo continua e termina em upfront sem perder sua origem."
    assert [o["pagina"] for o in p["origens"]] == [1, 2]
    assert [o["impressa"] for o in p["origens"]] == ["1", "2"]
    assert [fatiar(p["texto"], o["inicio"], o["fim"]) for o in p["origens"]] == [
        "Um paragrafo continua e termina em up", "front sem perder sua origem."]
    assert any("well-being nesta" in b["texto"] for b in c["blocos"])
    nota = next(b for b in c["blocos"] if b["tipo"] == "nota_rodape")
    assert nota["texto"] == "1 Esta nota fica separada do corpo. E continua na linha de baixo."
    chamada = next(f for b in c["blocos"] for f in b["inline"] if f["estilo"] == "nota_ref")
    assert chamada["ref"] == nota["id"]
    assert nota["ordem"] > p["ordem"]
    assert {b["tipo"] for b in c["blocos"]} >= {"figura", "equacao", "tabela"}
    figura = next(b for b in c["blocos"] if b["tipo"] == "figura")
    assert "Figura 1. Retangulo vetorial." in figura["texto"]
    assert len(c["assets"]) == 1
    asset = c["assets"][0]
    imagem = (tmp_path / "saida" / asset["caminho"]).read_bytes()
    assert hashlib.sha256(imagem).hexdigest() == asset["sha256"]
    pixmap = pymupdf.Pixmap(imagem)
    with pymupdf.open(sintetico) as pdf:
        referencia = pdf[1].get_pixmap(dpi=110)
        assert (pixmap.width, pixmap.height) == (referencia.width, referencia.height)
    assert len([l for l in r["limites"] if l["tipo"] == "conteudo_nao_textual"]) == 3
    assert hashlib.sha256(sintetico.read_bytes()).hexdigest() == antes
    validar(tmp_path / "saida/canonico.json")
    c2, r2 = canonizar(sintetico, "pdf", tmp_path / "segunda")
    assert c == c2 and r == r2
    assert (tmp_path / "saida/canonico.json").read_bytes() == (tmp_path / "segunda/canonico.json").read_bytes()
    assert imagem == (tmp_path / "segunda" / asset["caminho"]).read_bytes()


def test_igualdade_de_texto_nao_basta_para_omitir_pagina(tmp_path):
    entrada = tmp_path / "distintas.pdf"
    with pymupdf.open() as d:
        for numero in range(2):
            p = d.new_page()
            p.insert_text((40, 100), "O mesmo texto em paginas distintas.")
            p.draw_rect(pymupdf.Rect(50 + numero * 50, 200, 180, 270))
        d.save(entrada)
    c, r = canonizar(entrada, "pdf", tmp_path / "saida")
    assert r["paginas_repetidas"] == []
    assert {o["pagina"] for b in c["blocos"] for o in b["origens"]} == {1, 2}
    validar(tmp_path / "saida/canonico.json")


def test_juncao_ajusta_inline_e_fragmentos_apos_remover_hifen():
    origem = {"tipo": "pdf", "pagina": 1, "bbox": [0, 0, 10, 10]}
    a = Bloco("paragrafo", "🧭 up-", [Estilo(2, 5, "italico")], [Fragmento(origem, 0, 5)])
    b = Bloco("paragrafo", "front", [Estilo(0, 5, "negrito")],
              [Fragmento({**origem, "pagina": 2}, 0, 5)])
    juntar(a, b, set())
    a.id = identificar("0" * 64, "bloco", 0)
    resultado = a.json(0, {})
    assert resultado["texto"] == "🧭 upfront"
    assert [(f["inicio"], f["fim"]) for f in resultado["inline"]] == [(3, 5), (5, 10)]
    assert [(f["inicio"], f["fim"]) for f in resultado["origens"]] == [(0, 5), (5, 10)]


def test_pdf_fontes_viram_inline(tmp_path):
    entrada = tmp_path / "fontes.pdf"
    with pymupdf.open() as d:
        p = d.new_page()
        p.insert_text((40, 100), "Um paragrafo normal com varias palavras para ser o corpo.", fontsize=12)
        p.insert_text((40, 130), "italico", fontname="heit", fontsize=12)
        p.insert_text((90, 130), "negrito", fontname="hebo", fontsize=12)
        p.insert_text((140, 130), "codigo", fontname="cour", fontsize=12)
        d.save(entrada)
    c, _ = canonizar(entrada, "pdf", tmp_path / "saida")
    estilos = {f["estilo"] for b in c["blocos"] for f in b["inline"]}
    assert estilos >= {"italico", "negrito", "codigo"}
    validar(tmp_path / "saida/canonico.json")


def test_pdf_escaneado_com_camada_invisivel_e_corpo_nao_figura(tmp_path):
    entrada = tmp_path / "escaneado.pdf"
    with pymupdf.open() as d:
        p = d.new_page()
        fundo = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 60, 84), False)
        fundo.set_rect(fundo.irect, (250,))
        p.insert_image(p.rect, pixmap=fundo)
        for i in range(3):
            p.insert_text((72, 100 + 14 * i), f"Linha {i} do corpo escaneado com texto de OCR invisivel.",
                          fontsize=10, render_mode=3)
        d.save(entrada)
    c, _ = canonizar(entrada, "pdf", tmp_path / "saida")
    corpo = [b for b in c["blocos"] if b["tipo"] != "capitulo"]
    assert [b["tipo"] for b in corpo] == ["paragrafo"]
    assert corpo[0]["texto"].startswith("Linha 0 do corpo")
    validar(tmp_path / "saida/canonico.json")


def test_pdf_recuo_pendente_continua_o_item(tmp_path):
    entrada = tmp_path / "lista.pdf"

    def ate_a_margem(x, inicio):
        # Acrescenta palavras até a linha chegar perto da margem direita (x = 500).
        texto = inicio
        while x + pymupdf.get_text_length(texto + " palavra", fontsize=10) <= 500:
            texto += " palavra"
        while x + pymupdf.get_text_length(texto + "a", fontsize=10) <= 500:
            texto += "a"
        return texto
    with pymupdf.open() as d:
        p = d.new_page()
        linhas = [(72, 100, ate_a_margem(72, "Paragrafo de abertura,")), (72, 113, "e que termina aqui."),
                  (90, 139, ate_a_margem(90, "- Primeiro item,")), (100, 152, ate_a_margem(100, "continua recuado")),
                  (100, 165, "e termina."), (90, 178, "- Segundo item curto.")]
        for x, y, texto in linhas:
            p.insert_text((x, y), texto, fontsize=10)
        d.save(entrada)
    c, _ = canonizar(entrada, "pdf", tmp_path / "saida")
    textos = [b["texto"] for b in c["blocos"]]
    assert any(t.startswith("- Primeiro item") and t.endswith("e termina.") for t in textos), textos
    assert any(t.startswith("- Segundo item curto.") for t in textos), textos
    validar(tmp_path / "saida/canonico.json")


def test_ids_deterministas_por_dominio_e_posicao():
    ids = [identificar("0" * 64, dominio, i) for dominio in ("bloco", "secao", "pagina") for i in range(100)]
    assert len(set(ids)) == len(ids)
    assert all(re.fullmatch(r"[0-7][0-9A-HJKMNP-TV-Z]{25}", id_) for id_ in ids)
    assert identificar("0" * 64, "bloco", 0) == ids[0]


@pytest.mark.parametrize("opcoes", [("--paginas", "2-1"), ("--paginas", "0-1"), ("--paginas", "1-1"), ("--titulo", " ")])
def test_cli_erros_sem_json_parcial(tmp_path, opcoes):
    resultado = executar(RAIZ / "fixtures/colado.txt", "txt", tmp_path / "saida", *opcoes)
    assert resultado.returncode != 0
    assert resultado.stdout == b""
    assert resultado.stderr
    assert not (tmp_path / "saida").exists()


def test_saida_nao_pode_sobrescrever_original(tmp_path):
    entrada = tmp_path / "canonico.json"
    entrada.write_text("texto original")
    with pytest.raises(ValueError, match="vazio"):
        canonizar(entrada, "txt", tmp_path)
    assert entrada.read_text() == "texto original"


def test_sem_estrutura_vazio_e_recorte_invalido(tmp_path, sintetico):
    entrada = tmp_path / "vazio.txt"
    entrada.write_bytes(b"")
    c, r = canonizar(entrada, "txt", tmp_path / "saida", titulo="Vazio")
    assert c["secoes"][0]["titulo"] == "Vazio"
    assert r["limites"][0]["tipo"] == "sem_texto"
    validar(tmp_path / "saida/canonico.json")
    with pytest.raises(ValueError, match="fora do PDF"):
        canonizar(sintetico, "pdf", tmp_path / "invalido", paginas=(1, 4))
    assert not (tmp_path / "invalido").exists()


def test_separadores_unicode_nao_sao_quebras_de_linha(tmp_path):
    entrada = tmp_path / "unicode.txt"
    entrada.write_bytes("The text with\u2028a separator and\u2029another one.\rA continued line.".encode())
    c, _ = canonizar(entrada, "txt", tmp_path / "saida")
    assert c["documento"]["idioma"] == "en"
    assert c["blocos"][1]["texto"] == "The text with\u2028a separator and\u2029another one. A continued line."
    validar(tmp_path / "saida/canonico.json")


def test_texto_colado_que_comeca_pelo_titulo_nao_o_repete(tmp_path):
    entrada = tmp_path / "ensaio.txt"
    entrada.write_text("Sobre ler devagar\n\nHá uma pressa na leitura.\n\nLer devagar não é ler menos.", encoding="utf-8")
    c, _ = canonizar(entrada, "colado", tmp_path / "saida", titulo="Sobre ler  devagar.")
    assert [(b["tipo"], b["texto"]) for b in c["blocos"][:2]] == [
        ("capitulo", "Sobre ler devagar"), ("paragrafo", "Há uma pressa na leitura.")]
    assert len(c["secoes"]) == 1 and c["secoes"][0]["titulo"] == "Sobre ler devagar"
    assert c["blocos"][0]["origens"][0]["tipo"] == "texto"
    validar(tmp_path / "saida/canonico.json")
    outro = tmp_path / "outro.txt"
    outro.write_text("Uma frase qualquer.\n\nOutra.", encoding="utf-8")
    c, _ = canonizar(outro, "colado", tmp_path / "saida2", titulo="Título")
    assert [b["tipo"] for b in c["blocos"]] == ["capitulo", "paragrafo", "paragrafo"]
    assert c["blocos"][0]["texto"] == "Título"


def test_pdf_que_abre_por_titulo_menor_que_o_de_capitulo_usa_esse_titulo(tmp_path):
    def gerar(caminho, abertura):
        with pymupdf.open() as d:
            pagina = d.new_page()
            y = 80
            if abertura:
                pagina.insert_text((72, y), "Introduction", fontsize=21)
                y += 50
            for paragrafo in range(3):
                for linha in range(3):
                    pagina.insert_text((72, y), f"Linha {linha} do paragrafo {paragrafo} com texto corrido suficiente", fontsize=15)
                    y += 20
                y += 16
            d.save(caminho)
    gerar(tmp_path / "com.pdf", True)
    c, _ = canonizar(tmp_path / "com.pdf", "pdf", tmp_path / "saida", titulo="Livro")
    assert [s["titulo"] for s in c["secoes"]] == ["Introduction"]
    assert c["blocos"][0]["tipo"] == "capitulo" and c["blocos"][0]["origens"][0]["tipo"] == "pdf"
    validar(tmp_path / "saida/canonico.json")
    gerar(tmp_path / "sem.pdf", False)
    c, _ = canonizar(tmp_path / "sem.pdf", "pdf", tmp_path / "saida2", titulo="Livro")
    assert [s["titulo"] for s in c["secoes"]] == ["Livro"]


def test_pdf_sem_texto_nao_inventa_proveniencia(tmp_path):
    entrada = tmp_path / "vazio.pdf"
    with pymupdf.open() as d:
        d.new_page()
        d.save(entrada)
    c, r = canonizar(entrada, "pdf", tmp_path / "saida")
    assert all(o["tipo"] == "pdf" for b in c["blocos"] for o in b["origens"])
    assert r["limites"][0]["tipo"] == "sem_texto"
    validar(tmp_path / "saida/canonico.json")


def test_pdf_unicode_entre_paginas(tmp_path):
    entrada = tmp_path / "unicode.pdf"
    fonte = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    assert fonte.is_file(), "Fonte local DejaVuSans necessária para a fixture PDF Unicode."
    with pymupdf.open() as d:
        p = d.new_page()
        p.insert_font(fontname="unicode", fontfile=str(fonte))
        p.insert_text((40, 100), "😀 A frase continua na", fontname="unicode", fontsize=12)
        p = d.new_page()
        p.insert_font(fontname="unicode", fontfile=str(fonte))
        p.insert_text((40, 100), "outra pagina e termina aqui.", fontname="unicode", fontsize=12)
        # PyMuPDF 1.28.2 escreve U+1F600 como escalar no ToUnicode da fonte.
        # PDF exige UTF-16BE: corrigir apenas a fixture antes de salvar o original.
        for referencia in {f[0] for pagina in d for f in pagina.get_fonts()}:
            _, valor = d.xref_get_key(referencia, "ToUnicode")
            mapa = int(valor.split()[0])
            d.update_stream(mapa, d.xref_stream(mapa).replace(b"<1f600>", b"<d83dde00>"))
        d.save(entrada)
    with pymupdf.open(entrada) as d:
        assert d[0].get_text().startswith("😀 A frase")
    c, _ = canonizar(entrada, "pdf", tmp_path / "saida")
    b = next(b for b in c["blocos"] if b["tipo"] == "paragrafo")
    assert b["texto"] == "😀 A frase continua na outra pagina e termina aqui."
    assert b["origens"][0]["fim"] == comprimento_utf16("😀 A frase continua na")
    assert fatiar(b["texto"], b["origens"][1]["inicio"], b["origens"][1]["fim"]) == "outra pagina e termina aqui."
    validar(tmp_path / "saida/canonico.json")


def test_referencia_ambigua_nao_escolhe_primeira_nota():
    from margem_motor.blocos import finalizar
    origem = {"tipo": "pdf", "pagina": 1, "bbox": [1, 1, 30, 30]}
    blocos = [Bloco("paragrafo", "Texto1", fragmentos=[Fragmento(origem, 0, 6)], chamadas=[(5, 6, "1", 1)]),
              Bloco("nota_rodape", "1 Primeira", fragmentos=[Fragmento(origem, 0, 10)]),
              Bloco("nota_rodape", "1 Segunda", fragmentos=[Fragmento(origem, 0, 9)])]
    finalizados, _ = finalizar(blocos, "Título", "0" * 64)
    assert not any(e.estilo == "nota_ref" for b in finalizados for e in b.estilos)
