"""Revisão de transcrição pelo Codex (J90): localização, decisão e tempos. Sem Codex: as respostas são dadas."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("revisor", Path(__file__).parents[1] / "midia" / "revisar_transcricao.py")
revisor = importlib.util.module_from_spec(spec)
sys.modules["revisor"] = revisor  # @dataclass procura o módulo pelo nome
spec.loader.exec_module(revisor)


def transcricao(*paragrafos: str) -> dict:
    palavras, t = [], 0.0
    for paragrafo in paragrafos:
        for token in paragrafo.split():
            palavras.append({"texto": token, "inicio_s": round(t, 3), "fim_s": round(t + 0.4, 3), "interpolada": False})
            t += 0.5
    return {"versao": 1, "id_video": "abc", "titulo": "IA", "canal": "Canal", "url": "https://www.youtube.com/watch?v=abc",
            "motor": "whisper", "idioma": "pt", "capitulos": [], "paragrafos": list(paragrafos), "palavras": palavras}


def proposta(paragrafo, original, correcao, confianca="alta", tipo="termo"):
    return revisor.Proposta("correcao", paragrafo, original, correcao, tipo, "motivo", confianca)


def revisar(t, *propostas):
    faixas = revisor.faixas_dos_paragrafos(t)
    for p in propostas:
        revisor.classificar(p, t, faixas)
    r = revisor.aplicar_propostas(t, list(propostas))
    revisor.faixas_dos_paragrafos(r)
    return r


def test_substituicao_1_para_1_mantem_os_tempos():
    t = transcricao("os modelos de A avançam", "a Antropic lançou")
    a, b = proposta(0, "modelos de A", "modelos de IA"), proposta(1, "Antropic", "Anthropic", tipo="nome_proprio")
    r = revisar(t, a, b)
    assert r["paragrafos"] == ["os modelos de IA avançam", "a Anthropic lançou"]
    assert [p["inicio_s"] for p in r["palavras"]] == [p["inicio_s"] for p in t["palavras"]]
    assert not any(p["interpolada"] for p in r["palavras"])
    assert a.estado == b.estado == "aplicada"
    assert t["paragrafos"][0] == "os modelos de A avançam"  # o original não muda


def test_1_para_n_redistribui_no_intervalo_e_marca_interpolada():
    t = transcricao("modelos Open Waits chegaram")
    r = revisar(t, proposta(0, "Open Waits", "open weights"))
    assert r["paragrafos"] == ["modelos open weights chegaram"]
    t2 = transcricao("o REC-da OpenAI")
    r2 = revisar(t2, proposta(0, "REC-da", "hack da"))
    novas = r2["palavras"][1:3]
    assert [p["texto"] for p in novas] == ["hack", "da"]
    assert all(p["interpolada"] for p in novas)
    assert novas[0]["inicio_s"] == t2["palavras"][1]["inicio_s"] and novas[-1]["fim_s"] == t2["palavras"][1]["fim_s"]
    assert novas[0]["fim_s"] <= novas[1]["inicio_s"]


def test_insercao_usa_a_pausa_ou_divide_a_vizinha():
    t = transcricao("o presidente que vai")
    t["palavras"][2]["inicio_s"] = 2.0  # pausa de 1,1 s depois de "presidente"
    r = revisar(t, proposta(0, "presidente que", "presidente disse que", tipo="palavra_perdida"))
    disse = r["palavras"][2]
    assert disse["texto"] == "disse" and disse["interpolada"] and 0.9 <= disse["inicio_s"] < disse["fim_s"] <= 2.0
    t2 = transcricao("o presidente que vai")
    t2["palavras"][2]["inicio_s"] = t2["palavras"][1]["fim_s"]  # sem pausa
    r2 = revisar(t2, proposta(0, "presidente que", "presidente disse que", tipo="palavra_perdida"))
    assert [p["texto"] for p in r2["palavras"]] == ["o", "presidente", "disse", "que", "vai"]
    assert r2["palavras"][1]["interpolada"] and r2["palavras"][2]["fim_s"] <= r2["palavras"][3]["inicio_s"]
    tempos = [p["inicio_s"] for p in r2["palavras"]]
    assert tempos == sorted(tempos)


def test_so_confianca_alta_entra_e_o_resto_fica_listado():
    t = transcricao("é o princípio. Dentro da república eleita hoje")
    alucinacao = proposta(0, "princípio. Dentro da república eleita", "presidente da República eleito", "media", "alucinacao")
    r = revisar(t, alucinacao)
    assert r["paragrafos"] == t["paragrafos"] and alucinacao.estado == "pendente" and "media" in alucinacao.detalhe


def test_citacao_ausente_ou_repetida_nunca_e_escolhida_em_silencio():
    t = transcricao("de A e de A de novo")
    repetida, ausente = proposta(0, "de A", "de IA"), proposta(0, "modelos de A", "modelos de IA")
    r = revisar(t, repetida, ausente)
    assert repetida.estado == "ambigua" and ausente.estado == "nao_localizada"
    assert r["paragrafos"] == t["paragrafos"]


def test_sobreposicao_vira_conflito_e_mudanca_grande_vai_para_revisao_manual():
    t = transcricao("um dois tres quatro cinco seis sete oito nove dez")
    a, b = proposta(0, "dois tres", "dois três"), proposta(0, "tres quatro", "três quatro")
    grande = proposta(0, "cinco seis sete oito nove dez", "a b c d e f g")
    revisar(t, a, b, grande)
    assert a.estado == "aplicada" and b.estado == "conflito" and grande.estado == "pendente"


def test_nao_deixa_paragrafo_comecar_como_lista():
    t = transcricao("menos cinco por cento", "outro")
    p = proposta(0, "menos cinco", "- cinco")
    revisar(t, p)
    assert p.estado == "recusada"


def test_aplicar_le_as_respostas_e_escreve_revisada_relatorio_e_registro(tmp_path: Path):
    t = transcricao("os modelos de A avançam", "a Antropic lançou o modelo")
    (tmp_path / "transcricao.json").write_text(json.dumps(t), encoding="utf-8")
    trechos = tmp_path / revisor.PASTA / "trechos"
    trechos.mkdir(parents=True)
    resposta = {"correcoes": [
        {"paragrafo": 0, "trecho_original": "modelos de A", "correcao": "modelos de IA", "tipo": "termo", "motivo": "IA", "confianca": "alta"},
        {"paragrafo": 1, "trecho_original": "lançou o modelo", "correcao": "lançou um modelo", "tipo": "palavra_perdida", "motivo": "x", "confianca": "baixa"},
        {"paragrafo": 7, "trecho_original": "x", "correcao": "y", "tipo": "termo", "motivo": "x", "confianca": "alta"}],
        "duvidas": [{"paragrafo": 1, "trecho_original": "Antropic", "sugestao": "", "motivo": "?"}],
        "_chamada": {"paragrafos": [0, 1], "tokens": 1234, "segundos": 10}}
    (trechos / "00.json").write_text(json.dumps(resposta), encoding="utf-8")
    assert revisor.aplicar(tmp_path) == 0
    revisada = json.loads((tmp_path / "transcricao.revisada.json").read_text(encoding="utf-8"))
    assert revisada["paragrafos"] == ["os modelos de IA avançam", "a Antropic lançou o modelo"]
    assert "revisão de deslizes" in revisada["motor"] and revisada["revisao"]["aplicadas"] == 1
    assert json.loads((tmp_path / "transcricao.json").read_text(encoding="utf-8")) == t
    registro = json.loads((tmp_path / revisor.PASTA / "revisao.json").read_text(encoding="utf-8"))
    assert sorted(p["estado"] for p in registro["propostas"]) == ["aplicada", "duvida", "nao_localizada", "pendente"]
    md = (tmp_path / revisor.PASTA / "REVISAO.md").read_text(encoding="utf-8")
    assert "modelos de IA" in md and "&t=" in md and "1.234 tokens" in md


def test_resposta_fora_do_schema_e_recusada():
    with pytest.raises(ValueError):
        revisor.validar_resposta({"correcoes": [{"paragrafo": 0}], "duvidas": []})


def test_prompt_traz_contexto_e_o_trecho_numerado():
    t = transcricao("primeiro parágrafo", "segundo parágrafo", "terceiro parágrafo")
    prompt = revisor.montar_prompt(t, {"description": "Anthropic e OpenAI\nhttps://link"}, {"termos": ["Anthropic"], "sobre_o_canal": "Fala."}, [1])
    assert "[1] segundo parágrafo" in prompt and "primeiro parágrafo" in prompt and "terceiro parágrafo" in prompt
    assert "[0]" not in prompt and "https://link" not in prompt and "{{" not in prompt


def test_citacao_sem_a_pontuacao_colada_e_fronteira_de_palavra():
    t = transcricao("modelos abertos, ou Open Waits, de pesos", "a Antropic e a A.")
    waits = proposta(0, "Open Waits", "open weights")
    dentro = proposta(1, "A", "IA")  # "A" dentro de "Antropic" não conta; só o "A." do fim casa
    r = revisar(t, waits, dentro)
    assert r["paragrafos"] == ["modelos abertos, ou open weights, de pesos", "a Antropic e a IA."]
    assert waits.estado == dentro.estado == "aplicada"
    assert [p["inicio_s"] for p in r["palavras"]] == [p["inicio_s"] for p in t["palavras"]]


def test_numero_trocado_nunca_entra_sozinho():
    t = transcricao("ele falou isso lá em 2002 e depois")
    ano = proposta(0, "em 2002", "em 2022", tipo="palavra_perdida")
    revisar(t, ano)
    assert ano.estado == "pendente" and "número" in ano.detalhe
