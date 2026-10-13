#!/usr/bin/env python3
"""Alinhamento palavra a palavra, local, com WhisperX (plano B do J71).

A receita da fábrica (`whisperx-align-pt-v1`) fixa torch 2.4/numpy<2 e falha na imagem atual do
Colab (Python 3.13 com numpy 2 já carregado). Este script faz o mesmo passo na GPU local, sobre o
texto que o large-v3 já transcreveu, e grava o mesmo formato de saída da fábrica
(`aula.words.jsonl`: `{"palavra", "inicio_s", "fim_s", "score"}` por linha), para que o conversor
`transcricao_whisper.py` não dependa de onde o alinhamento rodou.

Roda num venv próprio fora do repositório (whisperx 3.8.6, torch 2.8), por exemplo:
    ~/.local/share/margem/j71-alinhar/venv/bin/python tools/midia/alinhar_whisperx.py \
        --segmentos <id>/segments.json --audio <id>/audio.mp3 --saida <id>/aula.words.jsonl
"""
from __future__ import annotations

import argparse
import gc
import json
import time
from pathlib import Path


def principal() -> None:
    args = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    args.add_argument("--segmentos", type=Path, required=True, action="append")
    args.add_argument("--audio", type=Path, required=True, action="append")
    args.add_argument("--saida", type=Path, required=True, action="append")
    args.add_argument("--idioma", default="pt")
    args.add_argument("--dispositivo", default="cuda")
    a = args.parse_args()
    if not (len(a.segmentos) == len(a.audio) == len(a.saida)):
        raise SystemExit("Passe --segmentos, --audio e --saida o mesmo número de vezes.")

    import torch
    import whisperx

    modelo, metadados = whisperx.load_align_model(language_code=a.idioma, device=a.dispositivo)
    for segmentos_json, audio_mp3, saida in zip(a.segmentos, a.audio, a.saida):
        if saida.exists() and saida.stat().st_size > 0:
            print(json.dumps({"saida": str(saida), "incremental": True}), flush=True)
            continue
        inicio = time.monotonic()
        dados = json.loads(segmentos_json.read_text(encoding="utf-8"))
        segmentos = [{"start": float(s["start"]), "end": float(s["end"]), "text": str(s["text"]).strip()}
                     for s in dados["segments"] if str(s.get("text", "")).strip()]
        audio = whisperx.load_audio(str(audio_mp3))
        alinhado = whisperx.align(segmentos, modelo, metadados, audio, a.dispositivo, return_char_alignments=False)
        linhas = []
        for palavra in alinhado.get("word_segments", []):
            if palavra.get("start") is None:
                continue
            linhas.append({"palavra": palavra["word"], "inicio_s": round(float(palavra["start"]), 3),
                           "fim_s": round(float(palavra["end"]), 3), "score": round(float(palavra.get("score", 0) or 0), 3)})
        temporario = saida.with_suffix(".jsonl.tmp")
        temporario.write_text("".join(json.dumps(l, ensure_ascii=False) + "\n" for l in linhas), encoding="utf-8")
        temporario.replace(saida)
        total = sum(len(s["text"].split()) for s in segmentos)
        print(json.dumps({"saida": str(saida), "palavras": len(linhas), "tokens": total,
                          "cobertura": round(len(linhas) / max(total, 1), 4), "segundos": round(time.monotonic() - inicio, 1),
                          "gpu": torch.cuda.get_device_name(0) if a.dispositivo == "cuda" else "cpu"}), flush=True)
        del audio, alinhado
        gc.collect()
        if a.dispositivo == "cuda":
            torch.cuda.empty_cache()


if __name__ == "__main__":
    principal()
