"""Regressão no corpus real; não faz downloads nem importa o extrator legado."""

import hashlib
import json
import re
from pathlib import Path
import subprocess
import sys

import pytest

RAIZ = Path(__file__).resolve().parents[2]


def test_capitulo_tres_mixtape(tmp_path):
    manifesto = json.loads((RAIZ / "fixtures/manifest.json").read_text())
    material = next(m for m in manifesto["materiais"] if m["papel"] == "corpus_principal")
    entrada = Path(material["caminho"])
    if not material["presente"] or not entrada.is_file():
        pytest.skip("PDF Mixtape ausente; consulte fixtures/manifest.json")
    antes = hashlib.sha256(entrada.read_bytes()).hexdigest()
    assert antes == material["sha256"]
    saida = tmp_path / "mixtape"
    processo = subprocess.run([sys.executable, "-m", "margem_motor.ingest", "--entrada", str(entrada),
                              "--formato", "pdf", "--paginas", "108-130", "--saida", str(saida)],
                             cwd=RAIZ / "motor", capture_output=True, check=False)
    assert processo.returncode == 0, processo.stderr.decode()
    assert processo.stdout == (saida / "canonico.json").read_bytes()
    c = json.loads(processo.stdout)
    assert any(b["tipo"] == "capitulo" and b["texto"] == "Directed Acyclic Graphs" for b in c["blocos"])
    paragrafos = [b for b in c["blocos"] if b["tipo"] == "paragrafo"]
    # O legado conta fragmentos por página; J04 exige reuni-los. Ver RESULTADO:
    # 90 legados - número de página - equação = 88 fragmentos; 12 uniões = 76 blocos.
    fragmentos = sum(len({o["pagina"] for o in b["origens"]}) for b in paragrafos)
    assert 80 <= fragmentos <= 100
    assert (len(paragrafos), fragmentos) == (76, 88)
    assert sum(len({o["pagina"] for o in b["origens"]}) > 1 for b in paragrafos) == 12
    assert all("Directed Acyclic Graphs" not in b["texto"] for b in c["blocos"] if b["tipo"] != "capitulo")
    assert all(not b["texto"].isdigit() for b in paragrafos)
    notas = [b for b in c["blocos"] if b["tipo"] == "nota_rodape"]
    assert len(notas) == 10
    assert {b["texto"].split()[0] for b in notas} == {str(n) for n in range(1, 11)}
    assert any(f["estilo"] == "nota_ref" for b in paragrafos for f in b["inline"])
    citacao = "Using directed acyclic graphical (DAG) notation requires some upfront statements."
    assert sum(b["texto"].count(citacao) for b in c["blocos"]) == 1
    assert sum(citacao in b["texto"] for b in paragrafos) == 1
    assert hashlib.sha256(entrada.read_bytes()).hexdigest() == antes
    validacao = subprocess.run(["node", "--import", "tsx", "motor/tests/validar_canonicos.mjs", str(saida / "canonico.json")],
                              cwd=RAIZ, capture_output=True, text=True, check=False)
    assert validacao.returncode == 0, validacao.stdout + validacao.stderr
    for asset in c["assets"]:
        assert hashlib.sha256((saida / asset["caminho"]).read_bytes()).hexdigest() == asset["sha256"]


# ---------------------------------------------------------------- J13: livro inteiro

def _materiais(papel):
    manifesto = json.loads((RAIZ / "fixtures/manifest.json").read_text())
    return [m for m in manifesto["materiais"] if m["papel"] == papel]


@pytest.fixture(scope="session")
def mixtape_inteiro(tmp_path_factory):
    entrada = Path(_materiais("corpus_principal")[0]["caminho"])
    if not entrada.is_file():
        pytest.skip("PDF Mixtape ausente; consulte fixtures/manifest.json")
    legados = [m["caminho"] for m in _materiais("marcas_legadas") if Path(m["caminho"]).is_file()]
    saida = tmp_path_factory.mktemp("mixtape-inteiro") / "saida"
    opcoes = [arg for caminho in legados for arg in ("--marcas-legadas", caminho)]
    processo = subprocess.run([sys.executable, "-m", "margem_motor.ingest", "--entrada", str(entrada),
                              "--formato", "pdf", "--saida", str(saida), *opcoes],
                             cwd=RAIZ / "motor", capture_output=True, check=False)
    assert processo.returncode == 0, processo.stderr.decode()
    return saida / "canonico.json", legados


def test_mixtape_titulos_limpos_e_epigrafes_no_lugar(mixtape_inteiro):
    caminho, _ = mixtape_inteiro
    c = json.loads(caminho.read_text())
    titulos = [s["titulo"] for s in c["secoes"]]
    # atribuicao_de_epigrafe: o autor não abre seção e fecha a própria epígrafe.
    assert "Tupac Shakur" not in titulos and "Dr. Dre" not in titulos
    epigrafes = [b["texto"] for b in c["blocos"] if b["tipo"] == "epigrafe"]
    for autor in ("Mos Def", "Jay-Z", "Notorious B.I.G.", "House of Pain", "Chance the Rapper",
                  "Tupac Shakur", "Dr. Dre"):
        assert sum(t.endswith("\n— " + autor) for t in epigrafes) == 1, autor
    assert not any(b["texto"] in {"Mos Def", "Dr. Dre", "Tupac Shakur"} for b in c["blocos"])
    # hifen_em_titulo e ligaturas_tipograficas.
    assert "Difference-in-Differences" in titulos
    assert {"Matching and Subclassification", "Subclassification", "Challenges to Identification"} <= set(titulos)
    assert not any(ch in t for t in titulos for ch in "ﬀﬁﬂﬃﬄﬅﬆ")
    # J15: o corpo também perde os glifos de ligatura.
    assert any("identification" in b["texto"] for b in c["blocos"] if b["tipo"] == "paragrafo")
    assert not any(ch in b["texto"] for b in c["blocos"] for ch in "ﬀﬁﬂﬃﬄﬅﬆ")
    # J15: o aviso de página em branco não vira epígrafe nem bloco nenhum.
    assert not any("intentionally left blank" in b["texto"].lower() for b in c["blocos"])
    assert sum(l.startswith("pagina_em_branco_declarada") for l in c["limites"]) == 4
    # hifen_antes_de_maiuscula no corpo.
    assert any("Mueller-Smith [2015], who used Harris County" in b["texto"] for b in c["blocos"])
    assert not any(re.search(r"Mueller- Smith|Goodman- Bacon|UNI- VERSAL", b["texto"]) for b in c["blocos"])
    # Nenhuma citação legada tem ligatura: a normalização não muda o comprimento de nenhuma.
    assert not any(l.startswith("ligatura_em_ancora_legada") for l in c["limites"])


def test_mixtape_replay_legado_nao_piora(mixtape_inteiro):
    caminho, legados = mixtape_inteiro
    if len(legados) != 11:
        pytest.skip("marcas legadas do Mixtape ausentes; consulte fixtures/manifest.json")
    replay = subprocess.run(["node", "--import", "tsx", "motor/tests/replay_legado.mjs", str(caminho), *legados],
                            cwd=RAIZ, capture_output=True, text=True, check=False)
    assert replay.returncode == 0, replay.stderr
    contagem = json.loads(replay.stdout)
    assert contagem["total"] == 429
    # J10 localizou 424 de 429; as correções de título e epígrafe não podem piorar isso.
    assert contagem["gravadas"] >= 424, contagem["nao_resolvidas"]
