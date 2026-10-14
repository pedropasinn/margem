"""margem-motor: o motor do Margem num executável só (PyInstaller onedir, J114).

Uso: margem-motor <subcomando> [argumentos]

  ingest ...                       = python -m margem_motor.ingest ...
  pdf-anotado < pedido.json        = python -m margem_motor.pdf_anotado
  renderizar-paginas PDF PASTA N   = python tools/renderizar-paginas.py ...
  camada-da-transcricao PDF T S    = python tools/camada-da-transcricao.py ...
  exercicios descobrir|recortar .. = python tools/exercicios-do-pdf.py ...
  miniatura ORIGEM DESTINO LADO    = o `-c` do PyMuPDF de servico/src/arte/miniaturas.ts
  imagem --entrada F --saida P     = python -m margem_motor.imagem ... (print de questão → PDF, J119)
  verificar                        importa tudo (motor, PyMuPDF, numpy) e imprime as versões em JSON
  identidade                       imprime o `canonizacao.motor` que a canonização gravaria

O serviço escolhe esta forma quando `MARGEM_MOTOR` aponta para o executável
(`servico/src/plataforma/executaveis.ts`); sem ela, roda os mesmos módulos e scripts pelo venv.
Os scripts de `tools/` entram no executável como o pacote `margem_ferramentas` (gerado pelo
`construir.py`); fora dele, este arquivo os carrega direto de `tools/`.
"""
from __future__ import annotations

import importlib
import importlib.util
import json
import multiprocessing
import runpy
import sys
from pathlib import Path

FERRAMENTAS = {
    "renderizar-paginas": "renderizar_paginas",
    "camada-da-transcricao": "camada_da_transcricao",
    "exercicios": "exercicios_do_pdf",
}


def _no_executavel(modulo: str) -> bool:
    """O módulo está no pacote `margem_ferramentas` do executável?"""
    try:
        return importlib.util.find_spec(modulo) is not None
    except ModuleNotFoundError:
        return False


def _arquivo_de_tools(nome: str) -> Path:
    return Path(__file__).resolve().parents[2] / "tools" / f"{nome.replace('_', '-')}.py"


def _rodar_script(nome: str, argumentos: list[str]) -> int:
    """Scripts que leem `sys.argv` no topo: rodam como `__main__`, como pela linha de comando."""
    modulo = f"margem_ferramentas.{nome}"
    sys.argv = [f"margem-motor {nome}", *argumentos]
    if _no_executavel(modulo):
        runpy.run_module(modulo, run_name="__main__", alter_sys=True)
    else:
        runpy.run_path(str(_arquivo_de_tools(nome)), run_name="__main__")
    return 0


def _exercicios(argumentos: list[str]) -> int:
    modulo = f"margem_ferramentas.{FERRAMENTAS['exercicios']}"
    if _no_executavel(modulo):
        ferramenta = importlib.import_module(modulo)
    else:
        # Fora do executável: carrega tools/exercicios-do-pdf.py com um nome importável pelos filhos do pool.
        spec = importlib.util.spec_from_file_location("exercicios_do_pdf", _arquivo_de_tools("exercicios_do_pdf"))
        assert spec is not None and spec.loader is not None
        ferramenta = importlib.util.module_from_spec(spec)
        sys.modules["exercicios_do_pdf"] = ferramenta
        spec.loader.exec_module(ferramenta)
    ferramenta.principal(argumentos)
    return 0


def _miniatura(argumentos: list[str]) -> int:
    import pymupdf

    origem, destino, lado = argumentos[0], argumentos[1], int(argumentos[2])
    p = pymupdf.Pixmap(origem)
    if p.alpha:
        p = pymupdf.Pixmap(p, 0)
    if p.n != 3:
        p = pymupdf.Pixmap(pymupdf.csRGB, p)
    f = min(1.0, lado / max(p.width, p.height))
    if f < 1:
        p = pymupdf.Pixmap(p, max(1, round(p.width * f)), max(1, round(p.height * f)), None)
    with open(destino, "wb") as arquivo:
        arquivo.write(p.tobytes(output="jpg", jpg_quality=82))
    return 0


def _verificar() -> int:
    import pymupdf

    try:  # a camada da transcrição precisa; o venv do desenvolvimento pode não ter (MARGEM_PYTHON_CAMADA)
        import numpy
        versao_numpy = numpy.__version__
    except ModuleNotFoundError:
        versao_numpy = None

    import margem_motor.ingest  # noqa: F401  (o mesmo teste do venv: o motor importa)
    import margem_motor.pdf_anotado  # noqa: F401

    print(json.dumps({
        "ok": True, "congelado": bool(getattr(sys, "frozen", False)), "python": sys.version.split()[0],
        "pymupdf": pymupdf.VersionBind, "numpy": versao_numpy,
    }))
    return 0


def _identidade() -> int:
    from margem_motor.versao import identificar_motor

    print(identificar_motor())
    return 0


def main(argv: list[str] | None = None) -> int:
    # Filhos do pool de processos (exercícios) no macOS e no Windows reabrem este executável.
    multiprocessing.freeze_support()
    if not getattr(sys, "frozen", False):
        # Fora do executável (testes, desenvolvimento): o pacote do motor está em motor/.
        motor = str(Path(__file__).resolve().parents[1])
        if motor not in sys.path:
            sys.path.insert(0, motor)
    argumentos = sys.argv[1:] if argv is None else argv
    if not argumentos or argumentos[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if argumentos else 2
    subcomando, resto = argumentos[0], argumentos[1:]
    if subcomando == "ingest":
        from margem_motor.ingest import main as ingest

        sys.argv = ["margem-motor ingest", *resto]
        return ingest()
    if subcomando == "pdf-anotado":
        from margem_motor.pdf_anotado import main as pdf_anotado

        return pdf_anotado()
    if subcomando in ("renderizar-paginas", "camada-da-transcricao"):
        return _rodar_script(FERRAMENTAS[subcomando], resto)
    if subcomando == "exercicios":
        return _exercicios(resto)
    if subcomando == "miniatura":
        return _miniatura(resto)
    if subcomando == "imagem":
        from margem_motor.imagem import main as imagem

        return imagem(resto)
    if subcomando == "verificar":
        return _verificar()
    if subcomando == "identidade":
        return _identidade()
    print(f"Subcomando desconhecido: {subcomando}\n\n{__doc__}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
