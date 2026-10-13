#!/usr/bin/env python3
"""Converte a saída do whisper (segmentos) + whisperx (palavras) no formato de transcrição do Margem.

Este é o passo trocável do J71: qualquer ferramenta de transcrição serve, desde que escreva o
mesmo `transcricao.json` (formato abaixo). O importador (`tools/importar-videos.mjs`) só lê este
arquivo; nada do player depende de qual motor transcreveu.

Formato (`versao: 1`):
    {
      "versao": 1, "id_video": "...", "titulo": "...", "canal": "...", "publicado_em": "AAAA-MM-DD",
      "url": "https://...", "duracao_s": 1234.5, "idioma": "pt", "motor": "descrição do motor",
      "capitulos": [{"inicio_s": 0, "titulo": "..."}],
      "paragrafos": ["texto do parágrafo", ...],           # o texto do documento, na ordem
      "palavras": [{"texto": "...", "inicio_s": 0.0, "fim_s": 0.3, "interpolada": false}, ...]
    }

Regras: `palavras[i].texto` são exatamente os tokens (separados por espaço) dos parágrafos, na
mesma ordem; palavras que o alinhador não temporizou (números, siglas) recebem tempo interpolado
entre as vizinhas e `interpolada: true`.

Uso:
    transcricao_whisper.py --segmentos segments.json --palavras aula.words.jsonl \
        --info video.info.json --motor "faster-whisper large-v3 + whisperx 3.1.5" --saida transcricao.json
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

FIM_DE_FRASE = re.compile(r"[.!?…][\"'”’»)\]]*$")
# Começos que o motor de TXT leria como lista, citação ou cerca: não podem abrir um parágrafo.
COMECO_ESPECIAL = re.compile(r"^(?:[-+*]|\d+[.)]|>|`{3,}|~{3,})(?:\s|$)")
PALAVRAS_POR_PARAGRAFO = 110
PAUSA_DE_PARAGRAFO_S = 2.5


def chave(texto: str) -> str:
    return re.sub(r"[^\w]", "", unicodedata.normalize("NFC", texto).casefold())


def tokens_dos_segmentos(segmentos: list[dict]) -> list[tuple[str, float, float]]:
    """Tokens (texto, início e fim do segmento) de todos os segmentos, na ordem."""
    saida = []
    for s in segmentos:
        for t in str(s.get("text", "")).split():
            saida.append((t, float(s["start"]), float(s["end"])))
    return saida


def temporizar(tokens: list[tuple[str, float, float]], palavras: list[dict]) -> list[dict]:
    """Casa os tokens do texto com as palavras alinhadas (em ordem) e interpola as que faltam."""
    saida: list[dict] = []
    j = 0
    for texto, seg_ini, seg_fim in tokens:
        achada = None
        k = chave(texto)
        # A palavra alinhada correspondente está logo adiante (o alinhador só pula, não reordena).
        for passo in range(0, 4):
            if j + passo < len(palavras) and chave(str(palavras[j + passo].get("palavra", ""))) == k and k:
                achada = palavras[j + passo]
                j = j + passo + 1
                break
        if achada is not None:
            saida.append({"texto": texto, "inicio_s": float(achada["inicio_s"]), "fim_s": float(achada["fim_s"]), "interpolada": False,
                          "_seg": (seg_ini, seg_fim)})
        else:
            saida.append({"texto": texto, "inicio_s": None, "fim_s": None, "interpolada": True, "_seg": (seg_ini, seg_fim)})
    # Interpolação: entre o fim da anterior temporizada e o início da próxima, sem sair do segmento.
    i = 0
    while i < len(saida):
        if not saida[i]["interpolada"]:
            i += 1
            continue
        fim = i
        while fim < len(saida) and saida[fim]["interpolada"]:
            fim += 1
        seg_ini, seg_fim = saida[i]["_seg"][0], saida[fim - 1]["_seg"][1]
        antes = saida[i - 1]["fim_s"] if i > 0 else seg_ini
        if i > 0 and saida[i - 1]["_seg"] != saida[i]["_seg"]:
            antes = max(antes, seg_ini)
        depois = saida[fim]["inicio_s"] if fim < len(saida) else seg_fim
        if fim < len(saida) and saida[fim]["_seg"] != saida[fim - 1]["_seg"]:
            depois = min(depois, seg_fim)
        depois = max(depois, antes)
        n = fim - i
        passo = (depois - antes) / n
        for m in range(n):
            saida[i + m]["inicio_s"] = round(antes + passo * m, 3)
            saida[i + m]["fim_s"] = round(antes + passo * (m + 1), 3)
        i = fim
    anterior = 0.0
    for p in saida:
        p.pop("_seg")
        p["inicio_s"] = round(max(p["inicio_s"], anterior), 3)
        p["fim_s"] = round(max(p["fim_s"], p["inicio_s"]), 3)
        anterior = p["inicio_s"]
    return saida


def paragrafos(palavras: list[dict], capitulos: list[dict]) -> list[list[int]]:
    """Índices das palavras de cada parágrafo: frases inteiras, ~110 palavras, novo parágrafo em
    capítulo novo ou pausa longa."""
    inicios = [c["inicio_s"] for c in capitulos[1:]]
    grupos: list[list[int]] = []
    atual: list[int] = []
    proximo_cap = 0
    pendente = False
    for i, p in enumerate(palavras):
        while proximo_cap < len(inicios) and p["inicio_s"] >= inicios[proximo_cap] - 0.3:
            proximo_cap += 1
            pendente = True
        if i > 0 and p["inicio_s"] - palavras[i - 1]["fim_s"] > PAUSA_DE_PARAGRAFO_S:
            pendente = True
        # Capítulo novo ou pausa longa: o parágrafo fecha no primeiro fim de frase (ou logo, se já está longo).
        if atual and pendente and (FIM_DE_FRASE.search(palavras[i - 1]["texto"]) or len(atual) > 2 * PALAVRAS_POR_PARAGRAFO):
            grupos.append(atual)
            atual = []
            pendente = False
        atual.append(i)
        if len(atual) >= PALAVRAS_POR_PARAGRAFO and FIM_DE_FRASE.search(p["texto"]):
            grupos.append(atual)
            atual = []
            pendente = False
    if atual:
        grupos.append(atual)
    # Um parágrafo não pode abrir como lista ou citação no TXT: junta ao anterior.
    juntos: list[list[int]] = []
    for g in grupos:
        if juntos and COMECO_ESPECIAL.match(palavras[g[0]]["texto"]):
            juntos[-1].extend(g)
        else:
            juntos.append(g)
    return juntos


def converter(segmentos: dict, palavras_alinhadas: list[dict], info: dict, motor: str) -> dict:
    tokens = tokens_dos_segmentos(segmentos["segments"])
    palavras = temporizar(tokens, palavras_alinhadas)
    capitulos = [{"inicio_s": round(float(c["start_time"]), 3), "titulo": str(c["title"]).strip()} for c in (info.get("chapters") or []) if str(c.get("title", "")).strip()]
    grupos = paragrafos(palavras, capitulos)
    data = str(info.get("upload_date") or "")
    return {
        "versao": 1,
        "id_video": info["id"],
        "titulo": info["title"],
        "canal": info.get("channel") or info.get("uploader") or "",
        "publicado_em": f"{data[:4]}-{data[4:6]}-{data[6:8]}" if len(data) == 8 else "",
        "url": f"https://www.youtube.com/watch?v={info['id']}",
        "duracao_s": float(info.get("duration") or segmentos.get("duration") or 0),
        "idioma": segmentos.get("language") or "pt",
        "motor": motor,
        "capitulos": capitulos,
        "paragrafos": [" ".join(palavras[i]["texto"] for i in g) for g in grupos],
        "palavras": palavras,
    }


def principal() -> None:
    args = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    args.add_argument("--segmentos", type=Path, required=True)
    args.add_argument("--palavras", type=Path, required=True)
    args.add_argument("--info", type=Path, required=True)
    args.add_argument("--motor", required=True)
    args.add_argument("--saida", type=Path, required=True)
    a = args.parse_args()
    segmentos = json.loads(a.segmentos.read_text(encoding="utf-8"))
    palavras = [json.loads(linha) for linha in a.palavras.read_text(encoding="utf-8").splitlines() if linha.strip()]
    info = json.loads(a.info.read_text(encoding="utf-8"))
    saida = converter(segmentos, palavras, info, a.motor)
    a.saida.write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
    interpoladas = sum(1 for p in saida["palavras"] if p["interpolada"])
    print(json.dumps({"id": saida["id_video"], "palavras": len(saida["palavras"]), "interpoladas": interpoladas,
                      "paragrafos": len(saida["paragrafos"]), "capitulos": len(saida["capitulos"])}, ensure_ascii=False))


if __name__ == "__main__":
    principal()
