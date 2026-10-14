"""Constrói o motor congelado `margem-motor[.exe]` (PyInstaller onedir, J114) para o sistema em que roda.

Uso (qualquer Python 3.12 do sistema; rede só para o pip do venv de construção):

  python motor/empacotar/construir.py --saida PASTA [--venv PASTA] [--trabalho PASTA]

1. cria (ou reaproveita) um venv de construção e instala nele `motor/requirements.txt` e
   `motor/empacotar/requirements-build.txt`, tudo com versões fixadas;
2. gera o pacote `margem_ferramentas` com os scripts de `tools/` que o serviço roda (renderizar-paginas,
   camada-da-transcricao, exercicios-do-pdf), byte a byte, com nomes importáveis;
3. roda o PyInstaller com `margem-motor.spec` e confere o resultado com `margem-motor verificar`.

O resultado fica em PASTA/margem-motor/ (o executável e `_internal/`); o `desktop/recursos/preparar.mjs`
copia essa pasta para `recursos/<plataforma>/motor/`. Cada sistema constrói o seu (não há construção
cruzada no PyInstaller).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
EMPACOTAR = RAIZ / "motor" / "empacotar"
FERRAMENTAS = {
    "renderizar-paginas.py": "renderizar_paginas.py",
    "camada-da-transcricao.py": "camada_da_transcricao.py",
    "exercicios-do-pdf.py": "exercicios_do_pdf.py",
}


def python_do_venv(pasta: Path) -> Path:
    return pasta / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def rodar(*comando: str | Path, **opcoes) -> None:
    print("+", " ".join(map(str, comando)), flush=True)
    subprocess.run([str(c) for c in comando], check=True, **opcoes)


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    argumentos.add_argument("--saida", type=Path, required=True)
    argumentos.add_argument("--venv", type=Path)
    argumentos.add_argument("--trabalho", type=Path)
    opcoes = argumentos.parse_args()
    if sys.version_info[:2] != (3, 12):
        print(f"Aviso: o motor foi validado com Python 3.12; este é {sys.version.split()[0]}.", file=sys.stderr)
    saida = opcoes.saida.resolve()
    trabalho = (opcoes.trabalho or saida.parent / "trabalho-motor").resolve()
    pasta_venv = (opcoes.venv or trabalho / "venv").resolve()

    if not python_do_venv(pasta_venv).exists():
        venv.EnvBuilder(with_pip=True, clear=False).create(pasta_venv)
    python = python_do_venv(pasta_venv)
    rodar(python, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-q",
          "-r", RAIZ / "motor" / "requirements.txt", "-r", EMPACOTAR / "requirements-build.txt")

    fontes = trabalho / "fontes"
    pacote = fontes / "margem_ferramentas"
    shutil.rmtree(fontes, ignore_errors=True)
    pacote.mkdir(parents=True)
    (pacote / "__init__.py").write_text('"""Scripts de tools/ que o serviço roda, empacotados no motor congelado (J114)."""\n', encoding="utf-8")
    for origem, destino in FERRAMENTAS.items():
        shutil.copyfile(RAIZ / "tools" / origem, pacote / destino)

    ambiente = {**os.environ, "MARGEM_EMPACOTAR_RAIZ": str(RAIZ), "MARGEM_EMPACOTAR_FERRAMENTAS": str(fontes)}
    if os.name != "nt":
        ambiente["LC_ALL"] = "C"  # o PyInstaller lê a saída do ldconfig em inglês
    rodar(python, "-m", "PyInstaller", "--noconfirm", "--clean", "--log-level", "WARN",
          "--distpath", saida, "--workpath", trabalho / "build", EMPACOTAR / "margem-motor.spec", env=ambiente)

    executavel = saida / "margem-motor" / ("margem-motor.exe" if os.name == "nt" else "margem-motor")
    verificacao = subprocess.run([str(executavel), "verificar"], check=True, capture_output=True, text=True)
    estado = json.loads(verificacao.stdout)
    if not estado.get("ok") or not estado.get("congelado") or not estado.get("numpy"):
        raise SystemExit(f"O executável não se verificou: {verificacao.stdout}")
    print(json.dumps({"executavel": str(executavel), **estado}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
