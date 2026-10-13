"""Conversor whisper + whisperx → transcricao.json (J71). Roda com motor/.venv/bin/pytest tools/tests."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("conversor", Path(__file__).parents[1] / "midia" / "transcricao_whisper.py")
conversor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conversor)


def test_interpola_palavras_sem_tempo_e_preserva_os_tokens():
    segmentos = {"language": "pt", "segments": [
        {"start": 0.0, "end": 3.0, "text": " O governo gastou R$ 174 bi."},
        {"start": 5.0, "end": 6.0, "text": " - Isto é outro."},
    ]}
    # O alinhador não temporiza "R$" nem "174" (fora do vocabulário) e devolve pontuação colada.
    palavras = [{"palavra": "O", "inicio_s": 0.1, "fim_s": 0.2}, {"palavra": "governo", "inicio_s": 0.2, "fim_s": 0.6},
                {"palavra": "gastou", "inicio_s": 0.7, "fim_s": 1.0}, {"palavra": "bi.", "inicio_s": 2.0, "fim_s": 2.4},
                {"palavra": "Isto", "inicio_s": 5.2, "fim_s": 5.4}, {"palavra": "é", "inicio_s": 5.4, "fim_s": 5.5}, {"palavra": "outro.", "inicio_s": 5.5, "fim_s": 5.9}]
    info = {"id": "abc", "title": "Título", "channel": "Canal", "upload_date": "20260927", "duration": 6.5,
            "chapters": [{"start_time": 0, "title": "Início"}, {"start_time": 4.8, "title": "Outro"}]}
    t = conversor.converter(segmentos, palavras, info, "teste")
    assert [p["texto"] for p in t["palavras"]] == ["O", "governo", "gastou", "R$", "174", "bi.", "-", "Isto", "é", "outro."]
    r, n = t["palavras"][3], t["palavras"][4]
    assert r["interpolada"] and n["interpolada"]
    assert 1.0 <= r["inicio_s"] < n["inicio_s"] < 2.0
    # Capítulo novo abre parágrafo; um parágrafo que começaria com "- " (lista no TXT) junta ao anterior.
    assert t["paragrafos"] == ["O governo gastou R$ 174 bi. - Isto é outro."]
    assert " ".join(t["paragrafos"]).split() == [p["texto"] for p in t["palavras"]]
    assert t["publicado_em"] == "2026-09-27" and t["url"].endswith("v=abc") and len(t["capitulos"]) == 2
    tempos = [p["inicio_s"] for p in t["palavras"]]
    assert tempos == sorted(tempos)


def test_capitulo_quebra_paragrafo_no_fim_da_frase():
    segmentos = {"segments": [{"start": 0, "end": 2, "text": "Primeira frase. Segunda"}, {"start": 2, "end": 4, "text": "continua aqui. Terceira."}]}
    palavras = [{"palavra": w, "inicio_s": i * 0.5, "fim_s": i * 0.5 + 0.4} for i, w in enumerate("Primeira frase. Segunda continua aqui. Terceira.".split())]
    info = {"id": "x", "title": "T", "duration": 4, "chapters": [{"start_time": 0, "title": "A"}, {"start_time": 1.4, "title": "B"}]}
    t = conversor.converter(segmentos, palavras, info, "teste")
    assert t["paragrafos"] == ["Primeira frase. Segunda continua aqui.", "Terceira."]
