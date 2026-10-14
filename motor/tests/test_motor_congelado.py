"""Motor congelado (J114): a CLI `motor/empacotar/cli.py` e o executável do PyInstaller produzem
exatamente o que o venv produz.

- Sempre: a CLI rodada pelo Python do venv (sem congelar) reproduz `python -m margem_motor.ingest` e as
  ferramentas de `tools/` byte a byte.
- Com `MARGEM_MOTOR=<…/margem-motor>`: o mesmo para o executável congelado, em PDF (com geometria,
  proveniência e assets), EPUB, Markdown, TXT, colado e poesia, mais PDF anotado, páginas renderizadas,
  camada da transcrição, exercícios e miniatura.

    MARGEM_MOTOR=/caminho/margem-motor motor/.venv/bin/pytest motor/tests/test_motor_congelado.py
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pymupdf
import pytest

from margem_motor.versao import identificar_motor
from test_epub import epub
from test_papers_pdf import paper_duas_colunas

RAIZ = Path(__file__).resolve().parents[2]
CLI = RAIZ / "motor" / "empacotar" / "cli.py"
CONGELADO = os.environ.get("MARGEM_MOTOR", "").strip()


def venv(*argumentos: str, entrada: bytes | None = None, python: str = sys.executable) -> subprocess.CompletedProcess[bytes]:
    """A forma de antes: módulo do pacote (`-m`) ou script de tools/."""
    return subprocess.run([python, *argumentos], cwd=RAIZ / "motor", input=entrada, capture_output=True, check=False)


def python_com_numpy() -> str | None:
    """O Python da camada (com numpy): o do venv, se tiver; senão o de MARGEM_PYTHON_CAMADA, como o worker."""
    if importlib.util.find_spec("numpy") is not None:
        return sys.executable
    return os.environ.get("MARGEM_PYTHON_CAMADA", "").strip() or None


def formas() -> list[tuple[str, list[str]]]:
    lista = [("cli-no-venv", [sys.executable, str(CLI)])]
    if CONGELADO:
        lista.append(("congelado", [CONGELADO]))
    return lista


def rodar(prefixo: list[str], *argumentos: str, entrada: bytes | None = None) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run([*prefixo, *argumentos], cwd=RAIZ, input=entrada, capture_output=True, check=False)


def arvore(pasta: Path) -> dict[str, str]:
    """Hash de cada arquivo da saída, pelo caminho relativo."""
    return {str(p.relative_to(pasta)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(pasta.rglob("*")) if p.is_file()}


@pytest.fixture
def entradas(tmp_path, sintetico):
    pasta = tmp_path / "entradas"
    pasta.mkdir()
    (pasta / "livro.epub").write_bytes(epub(fontes=True))
    paper_duas_colunas(pasta / "paper.pdf")
    return [
        (sintetico, "pdf", []),
        (sintetico, "pdf", ["--paginas", "2-2", "--titulo", "Só a segunda", "--autor", "Autora"]),
        (pasta / "paper.pdf", "pdf", []),
        (pasta / "livro.epub", "epub", []),
        (RAIZ / "fixtures" / "unicode-dificil.md", "md", []),
        (RAIZ / "fixtures" / "colado.txt", "txt", []),
        (RAIZ / "fixtures" / "colado.txt", "colado", ["--titulo-reserva", "Colado"]),
        (RAIZ / "fixtures" / "poesia" / "soneto-de-natal.md", "md", ["--poesia"]),
    ]


@pytest.mark.parametrize("nome,prefixo", formas())
def test_identidade_igual_a_do_venv(nome, prefixo):
    processo = rodar(prefixo, "identidade")
    assert processo.returncode == 0, processo.stderr.decode()
    assert processo.stdout.decode().strip() == identificar_motor(), nome


@pytest.mark.parametrize("nome,prefixo", formas())
def test_ingest_igual_ao_venv_byte_a_byte(tmp_path, entradas, nome, prefixo):
    for indice, (entrada, formato, extras) in enumerate(entradas):
        esperado, obtido = tmp_path / f"venv-{indice}", tmp_path / f"{nome}-{indice}"
        base = ["--entrada", str(entrada), "--formato", formato]
        referencia = venv("-m", "margem_motor.ingest", *base, "--saida", str(esperado), *extras)
        assert referencia.returncode == 0, referencia.stderr.decode()
        processo = rodar(prefixo, "ingest", *base, "--saida", str(obtido), *extras)
        assert processo.returncode == 0, processo.stderr.decode()
        assert processo.stdout == referencia.stdout, f"{nome}: stdout difere em {entrada.name} {formato} {extras}"
        assert arvore(obtido) == arvore(esperado), f"{nome}: saída difere em {entrada.name} {formato} {extras}"
        assert "canonico.json" in arvore(obtido)
    # Entrada inválida: o mesmo código de saída e a mesma mensagem.
    ruim = tmp_path / "ruim.pdf"
    ruim.write_bytes(b"isto nao e pdf")
    referencia = venv("-m", "margem_motor.ingest", "--entrada", str(ruim), "--formato", "pdf", "--saida", str(tmp_path / "r1"))
    processo = rodar(prefixo, "ingest", "--entrada", str(ruim), "--formato", "pdf", "--saida", str(tmp_path / "r2"))
    assert (processo.returncode, processo.stderr.splitlines()[-1:]) == (referencia.returncode, referencia.stderr.splitlines()[-1:])


@pytest.mark.parametrize("nome,prefixo", formas())
def test_ferramentas_iguais_ao_venv(tmp_path, sintetico, nome, prefixo):
    # PDF anotado (stdin).
    pedido = lambda saida: json.dumps({"entrada": str(sintetico), "saida": str(saida), "anotacoes": [  # noqa: E731
        {"tipo": "grifo", "pagina": 1, "quads": [[58, 100, 300, 100, 300, 118, 58, 118]], "cor": "#ffcc00", "autor": "Margem", "assunto": "grifo", "texto": "nota"},
    ]}).encode()
    referencia = venv("-m", "margem_motor.pdf_anotado", entrada=pedido(tmp_path / "a-venv.pdf"))
    assert referencia.returncode == 0, referencia.stderr.decode()
    processo = rodar(prefixo, "pdf-anotado", entrada=pedido(tmp_path / f"a-{nome}.pdf"))
    assert (processo.returncode, processo.stdout) == (referencia.returncode, referencia.stdout), processo.stderr.decode()
    with pymupdf.open(tmp_path / "a-venv.pdf") as a, pymupdf.open(tmp_path / f"a-{nome}.pdf") as b:
        assert [[(x.type, x.info["content"]) for x in p.annots()] for p in a] == [[(x.type, x.info["content"]) for x in p.annots()] for p in b]

    # Páginas renderizadas (script de tools/ com sys.argv no topo).
    referencia = venv(str(RAIZ / "tools" / "renderizar-paginas.py"), str(sintetico), str(tmp_path / "p-venv"), "1,2")
    processo = rodar(prefixo, "renderizar-paginas", str(sintetico), str(tmp_path / f"p-{nome}"), "1,2")
    assert processo.returncode == referencia.returncode == 0, processo.stderr.decode()
    assert arvore(tmp_path / f"p-{nome}") == arvore(tmp_path / "p-venv")

    # Camada da transcrição (numpy): a página 1 do sintético "escaneada" (só imagem) e transcrita.
    escaneado = tmp_path / "escaneado.pdf"
    with pymupdf.open(sintetico) as origem, pymupdf.open() as novo:
        imagem = origem[0].get_pixmap(dpi=150, colorspace=pymupdf.csGRAY)
        novo.new_page(width=origem[0].rect.width, height=origem[0].rect.height).insert_image(origem[0].rect, pixmap=imagem)
        novo.save(escaneado)
    blocos = [{"tipo": "cabecalho", "texto": "Cabecalho corrente 1"}, {"tipo": "titulo", "texto": "Capitulo sintetico"},
              {"tipo": "paragrafo", "texto": "O primeiro paragrafo apresenta o tema.\nA linha seguinte permanece no mesmo paragrafo."}]
    for pasta in (tmp_path / "t-venv", tmp_path / f"t-{nome}"):
        (pasta / "paginas").mkdir(parents=True)
        (pasta / "paginas" / "001.json").write_text(json.dumps({"pagina": {"blocos": blocos}, "modelo": "m", "esforco": "low"}))
    camada = python_com_numpy()
    if camada is not None and (nome == "congelado" or camada == sys.executable):
        referencia = venv(str(RAIZ / "tools" / "camada-da-transcricao.py"), str(escaneado), str(tmp_path / "t-venv"), str(tmp_path / "t-venv.pdf"), python=camada)
        processo = rodar(prefixo, "camada-da-transcricao", str(escaneado), str(tmp_path / f"t-{nome}"), str(tmp_path / f"t-{nome}.pdf"))
        assert referencia.returncode == 0, referencia.stderr.decode()
        assert processo.returncode == 0, processo.stderr.decode()
        with pymupdf.open(tmp_path / "t-venv.pdf") as a, pymupdf.open(tmp_path / f"t-{nome}.pdf") as b:
            assert [p.get_text("words") for p in a] == [p.get_text("words") for p in b]
            assert "Capitulo" in b[0].get_text()
        assert (tmp_path / f"t-{nome}.pdf.relatorio.json").read_bytes() == (tmp_path / "t-venv.pdf.relatorio.json").read_bytes()

    # Exercícios (pool de processos) e miniatura.
    referencia = venv(str(RAIZ / "tools" / "exercicios-do-pdf.py"), "descobrir", str(sintetico), str(tmp_path / "ocr-venv"))
    processo = rodar(prefixo, "exercicios", "descobrir", str(sintetico), str(tmp_path / f"ocr-{nome}"))
    assert (processo.returncode, processo.stdout) == (referencia.returncode, referencia.stdout), processo.stderr.decode()
    imagem = tmp_path / "p-venv" / "001.png"
    processo = rodar(prefixo, "miniatura", str(imagem), str(tmp_path / f"m-{nome}.jpg"), "64")
    assert processo.returncode == 0, processo.stderr.decode()
    miniatura = pymupdf.Pixmap(str(tmp_path / f"m-{nome}.jpg"))
    assert max(miniatura.width, miniatura.height) == 64 and miniatura.n == 3


@pytest.mark.parametrize("nome,prefixo", formas())
def test_verificar_e_subcomando_desconhecido(nome, prefixo):
    processo = rodar(prefixo, "verificar")
    assert processo.returncode == 0, processo.stderr.decode()
    estado = json.loads(processo.stdout)
    assert estado["ok"] is True and estado["congelado"] is (nome == "congelado")
    assert estado["pymupdf"] == pymupdf.VersionBind
    assert rodar(prefixo, "inexistente").returncode == 2
