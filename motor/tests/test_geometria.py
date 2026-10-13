"""Geometria real e retroativa sem escrever no banco nem na biblioteca do usuário."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import pymupdf
import pytest

from margem_motor.blocos import unir_bbox
from margem_motor.contratos import comprimento_utf16, conferir_geometria
from margem_motor.geometria import gerar_geometria
from margem_motor.ingest import canonizar
from test_mixtape import mixtape_inteiro  # noqa: F401: fixture compartilhada de corpus

RAIZ = Path(__file__).resolve().parents[2]


def cobertura(c, g):
    cobertos = {}
    for p in g["palavras"]:
        cobertos.setdefault(p["bloco_id"], set()).update(range(p["inicio_utf16"], p["fim_utf16"]))
    total = acertos = 0
    for b in c["blocos"]:
        if not any(o["tipo"] == "pdf" for o in b["origens"]):
            continue
        offset = 0
        for ch in b["texto"]:
            n = comprimento_utf16(ch)
            if not ch.isspace():
                total += 1
                acertos += all(i in cobertos.get(b["id"], ()) for i in range(offset, offset + n))
            offset += n
    return acertos, total


def test_sintetico_alinhamento_e_backfill_sem_recanonizar(tmp_path, sintetico):
    c, _ = canonizar(sintetico, "pdf", tmp_path / "novo")
    g = json.loads((tmp_path / "novo/geometria.json").read_text())
    assert conferir_geometria(g, c)
    assert cobertura(c, g)[0] / cobertura(c, g)[1] >= .99
    b = next(b for b in c["blocos"] if b["texto"].startswith("Um paragrafo continua"))
    partes = [p for p in g["palavras"] if p["bloco_id"] == b["id"] and
              p["inicio_utf16"] < b["texto"].index("upfront") + 7 and p["fim_utf16"] > b["texto"].index("upfront")]
    assert [p["pagina"] for p in partes] == [1, 2]
    assert partes[0]["fim_utf16"] == partes[1]["inicio_utf16"]
    # Simula o canônico histórico que agrupava todas as linhas por página.
    antigo = copy.deepcopy(c)
    for bloco in antigo["blocos"]:
        origens = {}
        for o in bloco["origens"]:
            if o["pagina"] not in origens:
                origens[o["pagina"]] = copy.deepcopy(o)
            else:
                anterior = origens[o["pagina"]]
                anterior["bbox"] = unir_bbox(anterior["bbox"], o["bbox"])
                if "fim" in o:
                    anterior["fim"] = o["fim"]
        bloco["origens"] = list(origens.values())
    versao = tmp_path / "dados" / "livro" / ("versao-" + "0" * 26)
    versao.mkdir(parents=True)
    shutil.copyfile(sintetico, versao.parent / "original.pdf")
    caminho = versao / "canonico.json"
    caminho.write_text(json.dumps(antigo))
    antes = caminho.read_bytes()
    comando = [str(RAIZ / "tools/gerar-geometria.sh"), str(tmp_path / "dados")]
    subprocess.run(comando, check=True, capture_output=True)
    geometria = versao / "geometria.json"
    derivada = json.loads(geometria.read_text())
    assert derivada["versao_id"] == "0" * 26
    assert conferir_geometria(derivada, antigo)
    assert cobertura(antigo, derivada)[0] / cobertura(antigo, derivada)[1] >= .99
    data = geometria.stat().st_mtime_ns
    subprocess.run(comando, check=True, capture_output=True)
    assert geometria.stat().st_mtime_ns == data
    subprocess.run([*comando, "--forcar"], check=True, capture_output=True)
    assert geometria.stat().st_mtime_ns != data
    assert caminho.read_bytes() == antes
    assert hashlib.sha256((versao.parent / "original.pdf").read_bytes()).digest() == hashlib.sha256(sintetico.read_bytes()).digest()


@pytest.mark.parametrize("rotacao", [0, 90, 180, 270])
def test_cropbox_rotacao_ligatura_emoji_e_combinante(tmp_path, rotacao):
    entrada = tmp_path / "unicode.pdf"
    fonte = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    with pymupdf.open() as pdf:
        p = pdf.new_page(width=400, height=500)
        p.insert_font(fontname="unicode", fontfile=fonte)
        p.insert_text((60, 100), "😀 ﬁ café palavras finais.", fontname="unicode", fontsize=12)
        for ref in {f[0] for f in p.get_fonts()}:
            _, valor = pdf.xref_get_key(ref, "ToUnicode")
            mapa = int(valor.split()[0])
            pdf.update_stream(mapa, pdf.xref_stream(mapa).replace(b"<1f600>", b"<d83dde00>"))
        p.set_cropbox(pymupdf.Rect(20, 30, 380, 480))
        p.set_rotation(rotacao)
        pdf.save(entrada)
    c, _ = canonizar(entrada, "pdf", tmp_path / "saida")
    g = json.loads((tmp_path / "saida/geometria.json").read_text())
    assert g["paginas"] == [{"numero": 1, "largura": 360, "altura": 450, "rotacao": rotacao}]
    b = next(b for b in c["blocos"] if b["texto"].startswith("😀"))
    assert b["texto"].startswith("😀 fi café")
    palavras = [p for p in g["palavras"] if p["bloco_id"] == b["id"]]
    assert palavras[0]["inicio_utf16"] == 0 and palavras[0]["fim_utf16"] == 2
    assert palavras[1]["inicio_utf16"] == 3 and palavras[1]["fim_utf16"] == 5
    assert palavras[0]["quad"][0] == pytest.approx(40, abs=.1)
    assert conferir_geometria(g, c)
    assert cobertura({"blocos": [b]}, g)[0] == cobertura({"blocos": [b]}, g)[1]
    sem_faixa = {bloco["id"] for bloco in c["blocos"] if not any("inicio" in o for o in bloco["origens"])}
    assert not any(p["bloco_id"] in sem_faixa for p in g["palavras"])
    ruim = copy.deepcopy(g); ruim["palavras"][0]["fim_utf16"] = 1
    assert not conferir_geometria(ruim, c)


def test_nao_inventa_posicao_e_recusa_original_errado(tmp_path, sintetico):
    c, _ = canonizar(sintetico, "pdf", tmp_path / "saida")
    b = next(b for b in c["blocos"] if b["tipo"] == "paragrafo")
    b["texto"] = "Z" * len(b["texto"])
    g, limites = gerar_geometria(c, sintetico)
    assert not any(p["bloco_id"] == b["id"] for p in g["palavras"])
    assert any(l["bloco_id"] == b["id"] for l in limites)
    c["documento"]["sha256_original"] = "0" * 64
    with pytest.raises(ValueError, match="sha256_original"):
        gerar_geometria(c, sintetico)


def test_mixtape_cobertura_citacoes_e_tempo(mixtape_inteiro, tmp_path):
    caminho, legados = mixtape_inteiro
    c = json.loads(caminho.read_text())
    manifesto = json.loads((RAIZ / "fixtures/manifest.json").read_text())
    entrada = Path(next(m["caminho"] for m in manifesto["materiais"] if m["papel"] == "corpus_principal"))
    antes = caminho.read_bytes()
    saida = tmp_path / "geometria.json"
    inicio = time.perf_counter()
    processo = subprocess.run([sys.executable, "-m", "margem_motor.geometria", "--canonico", str(caminho),
                              "--entrada", str(entrada), "--saida", str(saida)],
                             cwd=RAIZ / "motor", capture_output=True)
    segundos = time.perf_counter() - inicio
    assert processo.returncode == 0, processo.stderr.decode()
    assert caminho.read_bytes() == antes
    g = json.loads(saida.read_text())
    assert len(g["paginas"]) == 584 and conferir_geometria(g, c)
    cobertos, total = cobertura(c, g)
    assert cobertos / total >= .99
    if len(legados) != 11:
        pytest.skip("Marcas legadas ausentes; cobertura passou, replay indisponível.")
    replay = subprocess.run(["node", "--import", "tsx", "motor/tests/replay_legado.mjs", str(caminho), *legados],
                            cwd=RAIZ, capture_output=True, text=True, env={**os.environ, "GEOMETRIA_REPLAY": str(saida)})
    assert replay.returncode == 0, replay.stderr
    acertos = json.loads(replay.stdout)["geometria"]
    assert acertos["ancoradas"] >= 424
    assert acertos["na_pagina_esperada"] / acertos["ancoradas"] >= .98, acertos
    metricas = {"caracteres_cobertos": cobertos, "caracteres_total": total, "cobertura": cobertos / total,
                "citacoes": acertos, "segundos": segundos, "bytes": saida.stat().st_size, "paginas": 584}
    (tmp_path / "metricas.json").write_text(json.dumps(metricas, indent=2))
    print(json.dumps(metricas))


@pytest.mark.parametrize('rotacao', [0, 90, 180, 270])
def test_ligaturas_em_codigo_literal_e_legado_tem_geometria(tmp_path, rotacao):
    from copy import deepcopy
    from margem_motor.blocos import normalizar_ligaturas
    from margem_motor.contratos import hash_estrutural
    entrada = tmp_path / 'codigo-ligatura.pdf'
    with pymupdf.open() as pdf:
        p = pdf.new_page()
        p.insert_text((60, 100), 'Prosa predominante para explicar a listagem com mais texto.', fontsize=12)
        p.insert_font(fontname='mono', fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
        p.insert_text((60, 150), 'ﬁ + ﬂ + fi + fl', fontname='mono', fontsize=10)
        p.set_rotation(rotacao)
        pdf.save(entrada)
    c, _ = canonizar(entrada, 'pdf', tmp_path / 'saida', titulo='Livro')
    bloco = next(b for b in c['blocos'] if b['tipo'] == 'codigo')
    assert bloco['texto'] == 'ﬁ + ﬂ + fi + fl'
    geometria = json.loads((tmp_path / 'saida/geometria.json').read_text())
    assert cobertura({'blocos': [bloco]}, geometria)[0] == cobertura({'blocos': [bloco]}, geometria)[1]
    assert not any(bloco['id'] in limite for limite in c['limites'])
    # Canônico histórico expandia ligaturas: continua alinhando e mantém offsets próprios.
    legado = deepcopy(c)
    antigo = next(b for b in legado['blocos'] if b['id'] == bloco['id'])
    antigo['texto'] = normalizar_ligaturas(bloco['texto'])
    for origem in antigo['origens']:
        origem['fim'] = len(antigo['texto'])
    for estilo in antigo['inline']:
        estilo['fim'] = len(antigo['texto'])
    legado['hash_estrutural'] = hash_estrutural(legado['blocos'])
    g, avisos = gerar_geometria(legado, entrada)
    assert cobertura({'blocos': [antigo]}, g)[0] == cobertura({'blocos': [antigo]}, g)[1]
    assert not any(l.get('bloco_id') == antigo['id'] for l in avisos)
    assert g['palavras'][next(i for i, p in enumerate(g['palavras']) if p['bloco_id'] == antigo['id'])]['fim_utf16'] == 2


@pytest.mark.parametrize('fonte', ['f', 'fXi', 'f i'])
def test_correspondencia_parcial_nao_certifica_ligatura(tmp_path, fonte):
    entrada = tmp_path / 'parcial.pdf'
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((60, 120), fonte, fontname='cour', fontsize=12)
        pdf.save(entrada)
    c, _ = canonizar(entrada, 'pdf', tmp_path / 'saida', titulo='Livro')
    bloco = next(b for b in c['blocos'] if b['tipo'] == 'codigo')
    bloco['texto'] = 'ﬁ'
    for origem in bloco['origens']:
        origem['fim'] = 1
    for estilo in bloco['inline']:
        estilo['fim'] = 1
    g, avisos = gerar_geometria(c, entrada)
    assert not any(p['bloco_id'] == bloco['id'] for p in g['palavras'])
    assert any(l.get('bloco_id') == bloco['id'] for l in avisos)
