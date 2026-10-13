"""CLI local: original imutável → CanonicoV1, páginas PNG e relatório JSON."""

import argparse
from contextlib import redirect_stdout
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile

import pymupdf

from .blocos import finalizar, limites_de_ancoras_legadas
from .contratos import hash_estrutural
from .ids import identificar
from .pdf import extrair_pdf
from .epub import extrair_epub
from .relatorio import criar_relatorio, descrever_limite, serializar
from .texto import detectar_idioma, extrair_texto
from .versao import identificar_motor

# Sentinela explícita, não data do documento nem horário real de execução.
GERADO_EM = "1970-01-01T00:00:00Z"


def metadado_util(valor: str | None) -> str | None:
    """Descarta placeholders e títulos automáticos de ferramentas de escritório."""
    texto = " ".join((valor or "").split())
    if not texto or len(texto) > 300 or texto.casefold() in {
            "untitled", "sem título", "sem titulo", "unknown", "anonymous", "none", "null", "title",
            "administrator", "admin", "user", "usuario", "usuário", "owner", "author", "autor", "-"}:
        return None
    if re.match(r"^(microsoft\s+(word|powerpoint|excel)|untitled\b|document\d*$|layout\s*\d+$|"
                r"powerpoint presentation$|slide\s*\d+$)", texto, re.I):
        return None
    if re.search(r"\.(docx?|pptx?|xlsx?|odt|rtf|pdf|tex|dvi|ps|indd|qxd|pages)$", texto, re.I) or "\\" in texto:
        return None
    return texto


def canonizar(entrada: Path, formato: str, saida: Path, *, titulo: str | None = None,
              autor: str | None = None, titulo_reserva: str | None = None, idioma: str | None = None,
              paginas: tuple[int, int] | None = None,
              marcas_legadas: list[Path] | None = None, poesia: bool = False) -> tuple[dict, dict]:
    if formato not in {"pdf", "md", "txt", "colado", "epub"}:
        raise ValueError("Formato não suportado.")
    if idioma is not None and idioma not in {"en", "pt"}:
        raise ValueError("Idioma deve ser en ou pt.")
    if paginas is not None and formato != "pdf":
        raise ValueError("--paginas só se aplica a PDF.")
    if poesia and formato in {"pdf", "epub"}:
        raise ValueError("--poesia só se aplica a Markdown, TXT e texto colado.")
    if (titulo is not None and not titulo.strip()) or (autor is not None and not autor.strip()):
        raise ValueError("Título e autor fornecidos não podem ser vazios.")
    # Não sobrescrever artefatos ou seguir links pré-existentes.
    if saida.exists() and any(saida.iterdir()):
        raise ValueError("O diretório de saída deve estar vazio.")
    # Citações legadas conhecidas: só servem para avisar quando a normalização de ligaturas
    # muda o comprimento de uma delas; não alteram os blocos.
    citacoes_legadas = []
    for arquivo in marcas_legadas or []:
        legado = json.loads(arquivo.read_text(encoding="utf-8"))
        citacoes_legadas.extend((arquivo.name, str(m.get("id", "")), str(m.get("citacao", "")))
                                for m in legado.get("marcas", []))
    conteudo = entrada.read_bytes()
    semente = hashlib.sha256(conteudo).hexdigest()
    limites = []
    assets = []
    proveniencia = {"versao": 1, "sha256_original": semente, "observacoes": [], "transformacoes": []}
    saida.parent.mkdir(parents=True, exist_ok=True)
    # Só publicar quando todos os artefatos estiverem prontos.
    with tempfile.TemporaryDirectory(prefix=".margem-", dir=saida.parent) as temporario:
        pasta = Path(temporario)
        if formato == "pdf":
            with redirect_stdout(sys.stderr):
                blocos, assets, limites = extrair_pdf(conteudo, pasta, semente, paginas, proveniencia)
            with pymupdf.open(stream=conteudo, filetype="pdf") as pdf:
                metadados = pdf.metadata or {}
                titulo = titulo or metadado_util(metadados.get("title"))
                autor = autor or metadado_util(metadados.get("author"))
                try:  # A capa é cortesia: sem ela a biblioteca usa a capa gerada.
                    pagina = pdf[0]
                    escala = min(400 / pagina.rect.width, 800 / pagina.rect.height)
                    pagina.get_pixmap(matrix=pymupdf.Matrix(escala, escala), colorspace=pymupdf.csRGB,
                                      alpha=False).save(pasta / "capa.jpg", jpg_quality=80)
                except Exception as erro:  # noqa: BLE001
                    (pasta / "capa.jpg").unlink(missing_ok=True)
                    print(f"capa não gerada: {erro}", file=sys.stderr)
            limites.extend(limites_de_ancoras_legadas(citacoes_legadas))
        elif formato == "epub":
            blocos, metadados, limites = extrair_epub(conteudo)
            titulo = titulo or metadados.get("titulo")
            autor = autor or metadados.get("autor")
            idioma = idioma or metadados.get("idioma")
        else:
            blocos = extrair_texto(conteudo, formato, poesia, limites)
        titulo = titulo or titulo_reserva or next((b.texto for b in blocos if b.tipo in {"capitulo", "secao"}), entrada.stem)
        if not titulo:
            titulo = "Documento"
        if not blocos:
            limites.append({"tipo": "sem_texto", "descricao": "Nenhum bloco textual extraído do original."})
        if formato == "pdf":
            from .pdf import rebaixar_cabecalho_da_revista
            from .sumario_pdf import aplicar_sumario
            rebaixar_cabecalho_da_revista(blocos, titulo)
            with pymupdf.open(stream=conteudo, filetype="pdf") as pdf:
                aplicar_sumario(blocos, pdf.get_toc(), limites, paginas or (1, len(pdf)))
        blocos, secoes = finalizar(blocos, titulo, semente)
        ids_assets = {n: identificar(semente, "pagina", n) for n in {b.pagina_asset for b in blocos} if n is not None}
        blocos_json = [bloco.json(ordem, ids_assets) for ordem, bloco in enumerate(blocos)]
        documento = {"titulo": titulo, "idioma": idioma or detectar_idioma(" ".join(b.texto for b in blocos)),
                     "formato": formato, "sha256_original": semente}
        if autor is not None:
            documento["autor"] = autor
        config = {"formato": formato, "titulo": titulo, "autor": autor, "idioma": idioma,
                  "paginas": list(paginas) if paginas else None, "dpi": 110,
                  "politica_gerado_em": "sentinela_fixa_para_determinismo"}
        if titulo_reserva:
            config["titulo_reserva"] = titulo_reserva
        if poesia:
            # Só quando pedida: a configuração da prosa continua byte a byte a mesma.
            config["poesia"] = True
        canonico = {"versao": 1, "documento": documento,
                    "canonizacao": {"motor": identificar_motor(),
                                     "gerado_em": GERADO_EM, "config": config},
                    "hash_estrutural": hash_estrutural(blocos_json), "secoes": secoes,
                    "blocos": blocos_json, "assets": assets,
                    "limites": [descrever_limite(l) for l in limites]}
        if formato == "pdf":
            from .geometria import gerar_geometria
            geometria, avisos = gerar_geometria(canonico, entrada)
            limites.extend(avisos)
            canonico["limites"].extend(descrever_limite(l) for l in avisos)
            (pasta / "geometria.json").write_bytes(serializar(geometria))
        if formato == "pdf":
            proveniencia["hash_estrutural"] = canonico["hash_estrutural"]
            proveniencia["extrator"] = {"nome": "PyMuPDF", "versao": pymupdf.VersionBind}
            for bloco in blocos:
                proveniencia["transformacoes"].extend({**t, "bloco_id": bloco.id} for t in bloco.transformacoes)
            (pasta / "proveniencia.json").write_bytes(serializar(proveniencia))
        relatorio = criar_relatorio(canonico, limites)
        (pasta / "canonico.json").write_bytes(serializar(canonico))
        (pasta / "relatorio.json").write_bytes(serializar(relatorio))
        if saida.exists():
            saida.rmdir()  # Só remove diretório vazio; falha se houve escrita concorrente.
        pasta.rename(saida)
    return canonico, relatorio


def intervalo(valor: str) -> tuple[int, int]:
    if not re.fullmatch(r"[1-9]\d*-[1-9]\d*", valor):
        raise argparse.ArgumentTypeError("Use --paginas a-b, com páginas positivas e inclusivas.")
    inicio, fim = map(int, valor.split("-"))
    if fim < inicio:
        raise argparse.ArgumentTypeError("A página final precede a inicial.")
    return inicio, fim


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--entrada", type=Path, required=True)
    argumentos.add_argument("--formato", choices=["pdf", "md", "txt", "colado", "epub"], required=True)
    argumentos.add_argument("--saida", type=Path, required=True)
    argumentos.add_argument("--titulo")
    argumentos.add_argument("--autor")
    argumentos.add_argument("--titulo-reserva")
    argumentos.add_argument("--idioma", choices=["en", "pt"])
    argumentos.add_argument("--paginas", type=intervalo)
    argumentos.add_argument("--marcas-legadas", type=Path, action="append", dest="marcas_legadas",
                            help="Arquivo de marcas legadas (repetível); avisa em limites quando a "
                                 "normalização de ligaturas muda o comprimento de uma citação.")
    argumentos.add_argument("--poesia", action="store_true",
                            help="Texto é poema: cada grupo de linhas separado por linha em branco "
                                 "vira um bloco estrofe (Markdown, TXT e colado).")
    opcoes = argumentos.parse_args()
    try:
        with redirect_stdout(sys.stderr):
            canonico, _ = canonizar(**vars(opcoes))
        sys.stdout.buffer.write(serializar(canonico))
        return 0
    except (OSError, ValueError, RuntimeError) as erro:
        sys.stderr.write(f"Falha na canonização: {erro}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
