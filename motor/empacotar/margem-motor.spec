# -*- mode: python ; coding: utf-8 -*-
# Motor congelado do Margem (J114): PyInstaller onedir `margem-motor[.exe]`. Rodar pelo construir.py,
# que define MARGEM_EMPACOTAR_RAIZ (raiz do repositório) e MARGEM_EMPACOTAR_FERRAMENTAS (pasta com o
# pacote margem_ferramentas gerado a partir de tools/).
#
# O pacote margem_motor vai como FONTE (.py em _internal/margem_motor/), não no arquivo PYZ: o
# __init__ do motor copia os próprios fontes para uma pasta privada e a identidade da canonização
# (`canonizacao.motor`, versao.py) é o hash desses fontes. Assim o congelado grava a mesma identidade
# do venv, e todo módulo do pacote entra (hiddenimports), importado ou não.
import os
import sys
from pathlib import Path

# Sem `strip` (era só no Linux, J116, ~5 MB a menos): o strip do binutils do Ubuntu 22.04, o runner
# do CI, desalinha os segmentos da libscipy_openblas do numpy ("ELF load command address/offset not
# page-aligned") e o motor não abre. No macOS invalidaria as assinaturas das dylibs; no Windows não se aplica.
TIRAR_SIMBOLOS = False

raiz = Path(os.environ["MARGEM_EMPACOTAR_RAIZ"])
ferramentas = Path(os.environ["MARGEM_EMPACOTAR_FERRAMENTAS"])
modulos_do_motor = sorted(f"margem_motor.{p.stem}" for p in (raiz / "motor" / "margem_motor").glob("*.py") if p.stem != "__init__")
modulos_das_ferramentas = sorted(f"margem_ferramentas.{p.stem}" for p in (ferramentas / "margem_ferramentas").glob("*.py") if p.stem != "__init__")

a = Analysis(
    [str(raiz / "motor" / "empacotar" / "cli.py")],
    pathex=[str(raiz / "motor"), str(ferramentas)],
    binaries=[],
    datas=[],
    hiddenimports=["margem_motor", *modulos_do_motor, "margem_ferramentas", *modulos_das_ferramentas,
                   "pymupdf", "numpy", "concurrent.futures.process", "statistics", "runpy"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "_tkinter", "IPython", "pytest"],
    noarchive=False,
    module_collection_mode={"margem_motor": "py", "margem_ferramentas": "py"},
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="margem-motor",
    debug=False,
    bootloader_ignore_signals=False,
    strip=TIRAR_SIMBOLOS,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=os.environ.get("MARGEM_CODESIGN_IDENTITY") or None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=TIRAR_SIMBOLOS,
    upx=False,
    name="margem-motor",
)
