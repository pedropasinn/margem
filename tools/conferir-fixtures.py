"""Confere bytes e hashes; referências externas ausentes geram aviso."""
import hashlib
import json
from pathlib import Path

raiz = Path(__file__).resolve().parents[1]
falhas = 0
try:
    manifesto = json.loads((raiz / "fixtures/manifest.json").read_text())
    materiais = manifesto["materiais"]
    if not isinstance(materiais, list) or not materiais:
        raise ValueError("lista vazia")
    for material in materiais:
        caminho = Path(material["caminho"])
        arquivo = caminho if caminho.is_absolute() else raiz / caminho
        if not material["presente"] or not arquivo.is_file():
            estado = "aviso" if caminho.is_absolute() else "falta"
            print(f"{estado} | fixture ausente: {caminho}")
            falhas += estado == "falta"
            continue
        with arquivo.open("rb") as entrada:
            sha256 = hashlib.file_digest(entrada, "sha256").hexdigest()
        if sha256 != material["sha256"] or arquivo.stat().st_size != material["tamanho_bytes"]:
            print(f"falta | fixture com hash ou tamanho divergente: {caminho}")
            falhas += 1
        else:
            print(f"ok | fixture: {caminho} (SHA-256 e tamanho conferidos)")
except (OSError, ValueError, KeyError, TypeError):
    print("falta | manifesto ilegível ou inválido")
    falhas += 1
raise SystemExit(1 if falhas else 0)
