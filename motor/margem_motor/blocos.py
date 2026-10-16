"""Construção intermediária; índices Python só viram UTF-16 na publicação."""

import re
from dataclasses import dataclass, field

from .contratos import comprimento_utf16
from .ids import identificar


@dataclass
class Estilo:
    inicio: int
    fim: int
    estilo: str
    ref: "str | Bloco | None" = None  # Bloco só durante a extração do EPUB, até `finalizar`


@dataclass
class Fragmento:
    origem: dict
    inicio: int
    fim: int


@dataclass
class Bloco:
    tipo: str
    texto: str
    estilos: list[Estilo] = field(default_factory=list)
    fragmentos: list[Fragmento] = field(default_factory=list)
    nivel: int = 0
    recuo: bool = False
    tamanho: float = 0
    pagina_asset: int | None = None
    chamadas: list[tuple[int, int, str, int]] = field(default_factory=list)
    id: str = ""
    transformacoes: list[dict] = field(default_factory=list)

    def json(self, ordem: int, assets: dict[int, str]) -> dict:
        inline = []
        for estilo in self.estilos:
            if estilo.fim <= estilo.inicio:
                continue
            faixa = {"inicio": comprimento_utf16(self.texto[:estilo.inicio]),
                     "fim": comprimento_utf16(self.texto[:estilo.fim]), "estilo": estilo.estilo}
            if estilo.ref:
                faixa["ref"] = estilo.ref
            inline.append(faixa)
        origens = []
        # Uma origem por linha, preservada após normalizações e junções.
        for fragmento in self.fragmentos:
            origem = dict(fragmento.origem)
            if origem["tipo"] == "pdf" and fragmento.fim > fragmento.inicio:
                origem.update(inicio=comprimento_utf16(self.texto[:fragmento.inicio]),
                              fim=comprimento_utf16(self.texto[:fragmento.fim]))
            origens.append(origem)
        resultado = {"id": self.id, "ordem": ordem, "tipo": self.tipo, "texto": self.texto,
                     "inline": sorted(inline, key=lambda x: (x["inicio"], x["fim"], x["estilo"])),
                     "origens": origens}
        if self.pagina_asset is not None:
            resultado["asset_id"] = assets[self.pagina_asset]
        return resultado


def unir_bbox(a, b) -> list[float]:
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


TITULOS = {"capitulo", "secao"}

# Regra `ligaturas_tipograficas`: no PDF, glifos de ligatura viram as letras que representam, nos
# títulos (J13) e no texto corrido (J15). Markdown, TXT e colado preservam o texto como veio.
LIGATURAS = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}
_LIGATURA = re.compile("[" + "".join(LIGATURAS) + "]")


def normalizar_ligaturas(texto: str) -> str:
    """`Subclassiﬁcation` → `Subclassification`; o resto do texto fica intacto."""
    return _LIGATURA.sub(lambda m: LIGATURAS[m[0]], texto)


def normalizar_ligaturas_do_bloco(bloco: Bloco) -> None:
    """Aplica `normalizar_ligaturas` ao texto do bloco e reposiciona estilos, origens e chamadas."""
    if not _LIGATURA.search(bloco.texto):
        return
    novo = ""
    posicoes = []  # índice antigo → índice novo; um elemento a mais para o limite final
    for caractere in bloco.texto:
        posicoes.append(len(novo))
        novo += LIGATURAS.get(caractere, caractere)
    posicoes.append(len(novo))
    bloco.transformacoes.append({"regra": "ligaturas_tipograficas", "antes": bloco.texto, "depois": novo})
    bloco.texto = novo
    for estilo in bloco.estilos:
        estilo.inicio, estilo.fim = posicoes[estilo.inicio], posicoes[estilo.fim]
    for fragmento in bloco.fragmentos:
        fragmento.inicio, fragmento.fim = posicoes[fragmento.inicio], posicoes[fragmento.fim]
    bloco.chamadas = [(posicoes[i], posicoes[f], n, p) for i, f, n, p in bloco.chamadas]


def limites_de_ancoras_legadas(marcas: list[tuple[str, str, str]]) -> list[dict]:
    """Uma entrada por citação legada (arquivo, id, citação) cujo comprimento a normalização muda."""
    limites = []
    for arquivo, identificador, citacao in marcas:
        normalizada = normalizar_ligaturas(citacao)
        if normalizada != citacao:
            antes, depois = comprimento_utf16(citacao), comprimento_utf16(normalizada)
            limites.append({"tipo": "ligatura_em_ancora_legada", "arquivo": arquivo, "marca": identificador,
                            "descricao": f"Marca legada {identificador} ({arquivo}): a normalização de ligaturas "
                                         f"muda a citação de {antes} para {depois} unidades UTF-16."})
    return limites


def acao_do_hifen(esquerda: str, direita: str, vocabulario: set[str], titulo: bool) -> str:
    """Decide a quebra `esquerda-` + `direita`: `remover` o hífen ou `manter` o hífen, sempre sem espaço.

    Regra `hifen_em_titulo` (e `hifen_antes_de_maiuscula` no corpo): só junta sem hífen quando a
    palavra junta existe no próprio documento; senão mantém o hífen (`Difference-in-Differences`).
    No corpo com minúscula vale a regra do J04: composto testemunhado mantém o hífen, o resto junta.
    """
    if titulo or not direita[0].islower():
        return "remover" if normalizar_ligaturas(esquerda + direita).lower() in vocabulario else "manter"
    return "manter" if normalizar_ligaturas(esquerda + "-" + direita).lower() in vocabulario else "remover"


def juntar(destino: Bloco, proximo: Bloco, vocabulario: set[str]) -> None:
    if destino.tipo == "codigo" or proximo.tipo == "codigo":
        raise ValueError("Código exige composição literal; reflow de prosa não é permitido.")
    separador = " " if destino.texto and proximo.texto else ""
    fim = re.search(r"([^\W\d_]+)-$", destino.texto)
    inicio = re.match(r"([^\W\d_]+)", proximo.texto)
    titulo = destino.tipo in TITULOS
    if fim and inicio:
        acao = acao_do_hifen(fim[1], inicio[1], vocabulario, titulo)
        destino.transformacoes.append({"regra": "hifen_" + acao,
            "antes": fim[1] + "-\n" + inicio[1],
            "depois": fim[1] + ("" if acao == "remover" else "-") + inicio[1]})
        if acao == "remover":
            destino.texto = destino.texto[:-1]
            limite = len(destino.texto)
            for estilo in destino.estilos:
                estilo.fim = min(estilo.fim, limite)
            for fragmento in destino.fragmentos:
                fragmento.fim = min(fragmento.fim, limite)
        separador = ""
    deslocamento = len(destino.texto) + len(separador)
    destino.texto += separador + proximo.texto
    destino.transformacoes.extend(proximo.transformacoes)
    destino.estilos.extend(Estilo(e.inicio + deslocamento, e.fim + deslocamento, e.estilo, e.ref)
                           for e in proximo.estilos)
    destino.fragmentos.extend(Fragmento(f.origem, f.inicio + deslocamento, f.fim + deslocamento)
                             for f in proximo.fragmentos)
    destino.chamadas.extend((i + deslocamento, f + deslocamento, n, p)
                            for i, f, n, p in proximo.chamadas)


def anexar_atribuicao(epigrafe: Bloco, atribuicao: Bloco) -> None:
    """Regra `atribuicao_de_epigrafe`: o autor vira a última linha da epígrafe, nunca uma seção.

    `Mos Def` sob a epígrafe sai `…limits.`, quebra de linha, `— Mos Def`; se o original já começa com pontuação
    (`— Mos Def`, `–Mos Def`), fica como está. O travessão acrescentado não tem origem no PDF.
    """
    prefixo = "\n" if re.match(r"[\W_]", atribuicao.texto) else "\n— "
    deslocamento = len(epigrafe.texto) + len(prefixo)
    epigrafe.texto += prefixo + atribuicao.texto
    epigrafe.transformacoes.extend(atribuicao.transformacoes)
    epigrafe.estilos.extend(Estilo(e.inicio + deslocamento, e.fim + deslocamento, e.estilo, e.ref)
                            for e in atribuicao.estilos)
    epigrafe.fragmentos.extend(Fragmento(f.origem, f.inicio + deslocamento, f.fim + deslocamento)
                              for f in atribuicao.fragmentos)
    epigrafe.chamadas.extend((i + deslocamento, f + deslocamento, n, p)
                             for i, f, n, p in atribuicao.chamadas)


def comparavel(texto: str) -> str:
    return re.sub(r"[\W_]+", " ", texto).strip().casefold()


def titulo_repetido(bloco: Bloco, titulo: str) -> bool:
    """O primeiro parágrafo é só o título (texto colado que começa pelo nome): vira o título, sem duplicar."""
    return bloco.tipo == "paragrafo" and comparavel(bloco.texto) != "" and comparavel(bloco.texto) == comparavel(titulo)


def titulo_de_abertura(blocos: list[Bloco]) -> bool:
    """PDF que abre por uma linha curta bem maior que o corpo ("Introduction" a 1,4× o texto, abaixo do
    limiar de capítulo): é o título da abertura, e não um parágrafo sob um título inventado."""
    # O corpo é o menor tamanho dos parágrafos seguintes: o primeiro pode vir inflado pela capitular.
    corpo = min((b.tamanho for b in blocos[1:4] if b.tamanho > 0), default=0)
    abertura = blocos[0]
    texto = abertura.texto.strip()
    return (abertura.tipo == "paragrafo" and abertura.tamanho > 0 and corpo > 0
            and abertura.tamanho >= corpo * 1.25 and 0 < len(texto) <= 80
            and "\n" not in texto and re.search(r"[.,;:]$", texto) is None)


def finalizar(blocos: list[Bloco], titulo: str, semente: str) -> tuple[list[Bloco], list[dict]]:
    if blocos and (titulo_repetido(blocos[0], titulo) or titulo_de_abertura(blocos)):
        blocos[0].tipo, blocos[0].nivel = "capitulo", 1
    elif not blocos or blocos[0].tipo not in {"capitulo", "secao"}:
        origem = dict(blocos[0].fragmentos[0].origem) if blocos else {
            "tipo": "texto", "linha_inicio": 1, "linha_fim": 1}
        blocos.insert(0, Bloco("capitulo", titulo, fragmentos=[Fragmento(origem, 0, 0)], nivel=1))
    for ordem, bloco in enumerate(blocos):
        bloco.id = identificar(semente, "bloco", ordem)
    # EPUB (I-05): a chamada guarda o próprio bloco da nota até haver ids; vira o id aqui.
    presentes = {id(bloco) for bloco in blocos}
    for bloco in blocos:
        for estilo in [e for e in bloco.estilos if isinstance(e.ref, Bloco)]:
            if id(estilo.ref) in presentes and estilo.ref.tipo == "nota_rodape" and estilo.fim <= len(bloco.texto):
                estilo.ref = estilo.ref.id
            else:
                bloco.estilos[:] = [e for e in bloco.estilos if e is not estilo]
    secoes = []
    pilha: list[tuple[int, dict]] = []
    for posicao, bloco in enumerate(blocos):
        if bloco.tipo not in {"capitulo", "secao"}:
            continue
        nivel_fonte = bloco.nivel or 1
        while pilha and pilha[-1][0] >= nivel_fonte:
            _, fechada = pilha.pop()
            fechada["bloco_fim"] = blocos[posicao - 1].id
        if len(pilha) >= 6:
            _, fechada = pilha.pop()
            fechada["bloco_fim"] = blocos[posicao - 1].id
        nivel = len(pilha) + 1
        bloco.tipo = "capitulo" if nivel == 1 else "secao"
        secao = {"id": identificar(semente, "secao", len(secoes)), "nivel": nivel,
                 "titulo": bloco.texto, "ordem": len(secoes), "bloco_inicio": bloco.id,
                 "bloco_fim": blocos[-1].id}
        secoes.append(secao)
        pilha.append((nivel_fonte, secao))
    notas: dict[tuple[int, str], list[str]] = {}
    for bloco in blocos:
        numero = re.match(r"^(\d+)\s", bloco.texto)
        if (bloco.tipo == "nota_rodape" and numero and bloco.fragmentos
                and bloco.fragmentos[0].origem["tipo"] == "pdf"):
            pagina = bloco.fragmentos[0].origem["pagina"]
            notas.setdefault((pagina, numero[1]), []).append(bloco.id)
    for bloco in blocos:
        for inicio, fim, numero, pagina in bloco.chamadas:
            referencias = notas.get((pagina, numero), [])
            if len(referencias) == 1:
                bloco.estilos.append(Estilo(inicio, fim, "nota_ref", referencias[0]))
    return blocos, secoes
