#!/usr/bin/env python3
"""Transcritor local do Margem (J109): `MARGEM_TRANSCRITOR` aponta para este script (ou outro que siga o formato).

Uso (o worker chama assim):
    transcrever_local.py <áudio> <saída.json>

Saída:
    {"motor": "faster-whisper <modelo>", "idioma": "pt", "palavras": [{"texto": "...", "inicio_s": 0.0, "fim_s": 0.3}, ...]}

Usa o faster-whisper com tempo por palavra. O modelo vem de `MARGEM_WHISPER_MODELO` (padrão `small`;
`large-v3` é melhor e bem mais lento sem GPU) e precisa já estar no cache do Hugging Face: o worker
roda sem rede para o modelo (HF_HUB_OFFLINE=1). Para usar, aponte para um Python que tenha o pacote:

    MARGEM_TRANSCRITOR=/caminho/do/venv/bin/transcrever-margem   # um envoltório que chama este arquivo

O worker só passa PATH, HOME, LANG e MARGEM_WHISPER_MODELO para o processo.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def principal() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    audio, saida = Path(sys.argv[1]), Path(sys.argv[2])
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    try:
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]
    except ImportError:
        print("faster-whisper não está instalado neste Python.", file=sys.stderr)
        return 3
    modelo = os.environ.get("MARGEM_WHISPER_MODELO", "small")
    whisper = WhisperModel(modelo, device="auto", compute_type="auto")
    segmentos, info = whisper.transcribe(str(audio), word_timestamps=True, vad_filter=True)
    palavras = []
    for segmento in segmentos:
        for p in segmento.words or []:
            texto = p.word.strip()
            if texto:
                palavras.append({"texto": texto, "inicio_s": round(float(p.start), 3), "fim_s": round(float(p.end), 3)})
    saida.write_text(json.dumps({"motor": f"faster-whisper {modelo}", "idioma": info.language or "und", "palavras": palavras}, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
