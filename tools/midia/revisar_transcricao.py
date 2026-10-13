#!/usr/bin/env python3
"""Revisão dos deslizes de reconhecimento de fala de uma transcrição de vídeo pelo Codex (J90).

O Whisper erra pouco, mas erra em lugares que importam: "modelos de A" no lugar de "modelos de IA",
"Antropic" por "Anthropic", "Open Waits" por "open weights", às vezes uma frase deformada. Esta
ferramenta divide a transcrição em trechos com contexto (título, canal, descrição, capítulos,
glossário), pede ao Codex as correções em JSON (`prompts/revisar-transcricao@2`), localiza cada uma
pela citação literal e aplica sozinha só as de confiança alta. O resto fica listado para quem revisa.

Nada do modelo vira escolha silenciosa: citação ausente ou repetida no parágrafo, correções que se
sobrepõem e mudanças grandes demais ficam registradas e não são aplicadas.

Arquivos, na pasta do vídeo (`~/dados/margem/fontes/ulrich/<id>/`):
    transcricao.json            o original; nunca é regravado
    revisao-j90/trechos/NN.*    prompt, resposta e log de cada chamada ao Codex (retomável)
    revisao-j90/revisao.json    todas as propostas, com o estado de cada uma
    revisao-j90/REVISAO.md      o diff legível (antes → depois, motivo, confiança, minuto do vídeo)
    transcricao.revisada.json   mesmo formato (versao 1), com as correções aplicadas

Tempos por palavra: a substituição 1:1 mantém os tempos; 1→N, N→1 e inserções redistribuem dentro do
intervalo original (ou da pausa entre as vizinhas) e marcam `interpolada: true`.

Uso:
    revisar_transcricao.py rodar   <pasta-do-video> [--paralelo 4] [--palavras-por-trecho 900]
    revisar_transcricao.py aplicar <pasta-do-video>
    revisar_transcricao.py revisar <pasta-do-video>     # rodar + aplicar

`rodar` chama o Codex só para os trechos que ainda não têm resposta; se aparecer "usage limit",
para tudo e sai com código 3.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PROMPT = RAIZ / "prompts" / "revisar-transcricao@2.md"
SCHEMA = RAIZ / "prompts" / "revisar-transcricao@2.schema.json"
GLOSSARIO = Path(__file__).resolve().parent / "glossario-ulrich.json"
PASTA = "revisao-j90"
VERSAO_PROMPT = "revisar-transcricao@2"

TIPOS = {"termo", "nome_proprio", "palavra_perdida", "alucinacao", "pontuacao"}
CONFIANCAS = {"alta", "media", "baixa"}
# Mesma regra de tools/midia/transcricao_whisper.py: o motor de TXT leria isto como lista/citação.
COMECO_ESPECIAL = re.compile(r"^(?:[-+*]|\d+[.)]|>|`{3,}|~{3,})(?:\s|$)")
MAX_PALAVRAS_TRECHO = 12
# Acima disto a correção muda mais do que um deslize e não entra sozinha.
MAX_PALAVRAS_TROCADAS_AUTO = 6
PAUSA_MINIMA_S = 0.06


class LimiteDeUso(RuntimeError):
    """O Codex respondeu com "usage limit": parar tudo."""


# ------------------------------------------------------------------------------------------------ trechos

def faixas_dos_paragrafos(transcricao: dict) -> list[tuple[int, int]]:
    """[inicio, fim) de cada parágrafo no vetor de palavras; confere o invariante tokens = palavras."""
    faixas, i = [], 0
    for paragrafo in transcricao["paragrafos"]:
        n = len(paragrafo.split())
        faixas.append((i, i + n))
        i += n
    if i != len(transcricao["palavras"]):
        raise ValueError("As palavras não são os tokens dos parágrafos.")
    return faixas


def dividir_em_trechos(transcricao: dict, palavras_por_trecho: int) -> list[list[int]]:
    """Grupos de parágrafos consecutivos com até ~`palavras_por_trecho` palavras (nunca parte um parágrafo)."""
    trechos, atual, contagem = [], [], 0
    for indice, paragrafo in enumerate(transcricao["paragrafos"]):
        n = len(paragrafo.split())
        if atual and contagem + n > palavras_por_trecho:
            trechos.append(atual)
            atual, contagem = [], 0
        atual.append(indice)
        contagem += n
    if atual:
        trechos.append(atual)
    return trechos


def _minuto(segundos: float) -> str:
    s = int(segundos)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def _cauda(texto: str, palavras: int) -> str:
    tokens = texto.split()
    return ("… " if len(tokens) > palavras else "") + " ".join(tokens[-palavras:])


def _cabeca(texto: str, palavras: int) -> str:
    tokens = texto.split()
    return " ".join(tokens[:palavras]) + (" …" if len(tokens) > palavras else "")


def montar_prompt(transcricao: dict, info: dict | None, glossario: dict, trecho: list[int]) -> str:
    modelo = PROMPT.read_text(encoding="utf-8").split("\n---\n", 1)[1].strip()
    paragrafos = transcricao["paragrafos"]
    descricao = (info or {}).get("description") or "(sem descrição)"
    # A descrição traz links de patrocínio no começo; o que interessa são os nomes e os capítulos.
    descricao = "\n".join(l for l in descricao.splitlines() if "http" not in l).strip()[:2500]
    capitulos = "\n".join(f"- {_minuto(c['inicio_s'])} {c['titulo']}" for c in transcricao.get("capitulos", [])) or "(sem capítulos)"
    antes = _cauda(paragrafos[trecho[0] - 1], 80) if trecho[0] > 0 else "(início do vídeo)"
    depois = _cabeca(paragrafos[trecho[-1] + 1], 80) if trecho[-1] + 1 < len(paragrafos) else "(fim do vídeo)"
    campos = {
        "titulo": transcricao.get("titulo", ""), "canal": transcricao.get("canal", ""),
        "publicado_em": transcricao.get("publicado_em", ""), "descricao": descricao, "capitulos": capitulos,
        "glossario": ", ".join(glossario["termos"]), "sobre_o_canal": glossario.get("sobre_o_canal", ""), "contexto_antes": antes, "contexto_depois": depois,
        "trecho": "\n\n".join(f"[{i}] {paragrafos[i]}" for i in trecho),
    }
    return re.sub(r"\{\{(\w+)\}\}", lambda m: campos[m.group(1)], modelo)


# ------------------------------------------------------------------------------------------------ Codex

def _tokens_usados(log: str) -> int | None:
    achado = re.search(r"tokens used\s*\n?\s*([\d.,]+)", log)
    return int(re.sub(r"[.,]", "", achado.group(1))) if achado else None


def chamar_codex(prompt: str, saida: Path, log: Path, esforco: str = "medium") -> dict:
    """Uma chamada `codex exec` em sandbox só-leitura, numa pasta vazia, sem `-m` (modelo da conta)."""
    with tempfile.TemporaryDirectory(prefix="margem-j90-") as vazia:
        inicio = time.monotonic()
        comando = ["codex", "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--dangerously-bypass-hook-trust",
                   "-c", f'model_reasoning_effort="{esforco}"', "-c", 'web_search="disabled"', "--cd", vazia,
                   "--output-schema", str(SCHEMA), "-o", str(saida), prompt]
        processo = subprocess.run(comando, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=1800)
        duracao = time.monotonic() - inicio
    texto_log = f"$ codex exec … (código {processo.returncode}, {duracao:.0f} s)\n--- stderr ---\n{processo.stderr[-20000:]}\n--- stdout ---\n{processo.stdout[-4000:]}"
    log.write_text(texto_log, encoding="utf-8")
    if "usage limit" in (processo.stderr + processo.stdout).lower():
        saida.unlink(missing_ok=True)
        raise LimiteDeUso("O Codex respondeu com usage limit.")
    if processo.returncode != 0 or not saida.exists():
        saida.unlink(missing_ok=True)
        raise RuntimeError(f"codex exec falhou (código {processo.returncode}); ver {log}")
    return {"segundos": round(duracao, 1), "tokens": _tokens_usados(processo.stderr)}


def validar_resposta(bruto: object) -> dict:
    if not isinstance(bruto, dict) or set(bruto) != {"correcoes", "duvidas"}:
        raise ValueError("Resposta fora do schema.")
    for c in bruto["correcoes"]:
        if set(c) != {"paragrafo", "trecho_original", "correcao", "tipo", "motivo", "confianca"} or c["tipo"] not in TIPOS or c["confianca"] not in CONFIANCAS:
            raise ValueError(f"Correção fora do schema: {c}")
    for d in bruto["duvidas"]:
        if set(d) != {"paragrafo", "trecho_original", "sugestao", "motivo"}:
            raise ValueError(f"Dúvida fora do schema: {d}")
    return bruto


def rodar(pasta: Path, paralelo: int, palavras_por_trecho: int, esforco: str) -> int:
    transcricao = json.loads((pasta / "transcricao.json").read_text(encoding="utf-8"))
    faixas_dos_paragrafos(transcricao)
    info_arquivo = pasta / "video.info.json"
    info = json.loads(info_arquivo.read_text(encoding="utf-8")) if info_arquivo.exists() else None
    glossario = json.loads(GLOSSARIO.read_text(encoding="utf-8"))
    destino = pasta / PASTA / "trechos"
    destino.mkdir(parents=True, exist_ok=True)
    trechos = dividir_em_trechos(transcricao, palavras_por_trecho)
    (pasta / PASTA / "trechos.json").write_text(json.dumps({"palavras_por_trecho": palavras_por_trecho, "trechos": trechos}), encoding="utf-8")
    pendentes = [(n, t) for n, t in enumerate(trechos) if not (destino / f"{n:02d}.json").exists()]
    print(f"{transcricao['id_video']}: {len(trechos)} trechos, {len(pendentes)} por chamar", flush=True)
    parar = False

    def um(item: tuple[int, list[int]]) -> str:
        nonlocal parar
        n, trecho = item
        if parar:
            return f"  {n:02d} pulado (limite de uso)"
        prompt = montar_prompt(transcricao, info, glossario, trecho)
        (destino / f"{n:02d}.prompt.md").write_text(prompt, encoding="utf-8")
        bruto = destino / f"{n:02d}.bruto.json"
        try:
            uso = chamar_codex(prompt, bruto, destino / f"{n:02d}.log", esforco)
        except LimiteDeUso:
            parar = True
            return f"  {n:02d} USAGE LIMIT"
        resposta = validar_resposta(json.loads(bruto.read_text(encoding="utf-8")))
        resposta["_chamada"] = {**uso, "paragrafos": trecho, "prompt": VERSAO_PROMPT, "esforco": esforco}
        (destino / f"{n:02d}.json").write_text(json.dumps(resposta, ensure_ascii=False, indent=1), encoding="utf-8")
        bruto.unlink()
        return f"  {n:02d} ok · {len(resposta['correcoes'])} correções, {len(resposta['duvidas'])} dúvidas · {uso['segundos']} s · {uso['tokens']} tokens"

    falhas = 0
    with ThreadPoolExecutor(max_workers=paralelo) as fila:
        for futuro in [fila.submit(um, item) for item in pendentes]:
            try:
                print(futuro.result(), flush=True)
            except Exception as erro:  # noqa: BLE001 — uma chamada ruim não derruba as outras
                falhas += 1
                print(f"  falhou: {erro}", flush=True)
    if parar:
        print("PARADO: usage limit do Codex. Rode de novo depois que a cota voltar (retoma do que falta).", flush=True)
        return 3
    return 1 if falhas else 0


# ------------------------------------------------------------------------------------------------ aplicação

@dataclass
class Proposta:
    tipo_registro: str  # correcao | duvida
    paragrafo: int
    trecho_original: str
    correcao: str
    tipo: str
    motivo: str
    confianca: str
    estado: str = "pendente"
    detalhe: str = ""
    inicio: int = -1  # índice da primeira palavra do trecho no vetor de palavras
    fim: int = -1
    inicio_s: float | None = None
    novos: list[str] | None = None  # os tokens que substituem [inicio, fim), com a pontuação colada


def localizar(tokens: list[str], citacao: str) -> list[tuple[int, int, str, str]]:
    """Ocorrências da citação no parágrafo, em fronteira de palavra (a pontuação colada pode ficar de fora).

    Devolve (primeiro token, fim exclusivo, prefixo do primeiro token antes da citação, sufixo do último
    depois dela): "Open Waits" casa com os tokens "Open" "Waits," e deixa "," como sufixo.
    """
    alvo = " ".join(citacao.split())
    if not alvo:
        return []
    texto = " ".join(tokens)
    inicios, cursor = [], 0
    for token in tokens:
        inicios.append(cursor)
        cursor += len(token) + 1
    achados, de = [], 0
    while (c0 := texto.find(alvo, de)) >= 0:
        de = c0 + 1
        c1 = c0 + len(alvo)
        if (c0 > 0 and texto[c0 - 1].isalnum() and alvo[0].isalnum()) or (c1 < len(texto) and texto[c1].isalnum() and alvo[-1].isalnum()):
            continue  # no meio de uma palavra: "A" dentro de "Antropic" não conta
        i = max(k for k, ini in enumerate(inicios) if ini <= c0)
        j = max(k for k, ini in enumerate(inicios) if ini < c1) + 1
        achados.append((i, j, texto[inicios[i]:c0], texto[c1:inicios[j - 1] + len(tokens[j - 1])]))
    return achados


def classificar(proposta: Proposta, transcricao: dict, faixas: list[tuple[int, int]]) -> None:
    """Localiza a citação e decide se a correção pode entrar sozinha. Não mexe na transcrição."""
    if not 0 <= proposta.paragrafo < len(faixas):
        proposta.estado, proposta.detalhe = "nao_localizada", "parágrafo inexistente"
        return
    a, b = faixas[proposta.paragrafo]
    tokens = [p["texto"] for p in transcricao["palavras"][a:b]]
    achados = localizar(tokens, proposta.trecho_original)
    if not achados:
        proposta.estado, proposta.detalhe = "nao_localizada", "a citação não aparece literalmente no parágrafo"
        return
    if len(achados) > 1:
        proposta.estado, proposta.detalhe = "ambigua", f"a citação aparece {len(achados)} vezes no parágrafo"
        return
    i, j, prefixo, sufixo = achados[0]
    proposta.inicio, proposta.fim = a + i, a + j
    proposta.inicio_s = transcricao["palavras"][proposta.inicio]["inicio_s"]
    if proposta.tipo_registro == "duvida":
        proposta.estado = "duvida"
        return
    alvo = tokens[i:j]
    correcao = " ".join(proposta.correcao.split())
    novos = f"{prefixo}{correcao}{sufixo}".split()
    proposta.novos = novos
    if novos == alvo:
        proposta.estado, proposta.detalhe = "recusada", "a correção é igual ao original"
        return
    if len(alvo) > MAX_PALAVRAS_TRECHO:
        proposta.estado, proposta.detalhe = "pendente", "citação mais longa que o limite do prompt"
        return
    trocadas = sum(max(i2 - i1, j2 - j1) for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=alvo, b=novos, autojunk=False).get_opcodes() if op != "equal")
    if proposta.confianca != "alta":
        proposta.estado, proposta.detalhe = "pendente", f"confiança {proposta.confianca}"
    elif re.findall(r"\d+", " ".join(alvo)) != re.findall(r"\d+", " ".join(novos)) and not proposta.tipo == "nome_proprio":
        # Número só se confere ouvindo: "2002" → "2022" pode estar certo, mas não entra sozinho.
        proposta.estado, proposta.detalhe = "pendente", "muda um número"
    elif trocadas > MAX_PALAVRAS_TROCADAS_AUTO:
        proposta.estado, proposta.detalhe = "pendente", f"muda {trocadas} palavras (limite automático: {MAX_PALAVRAS_TROCADAS_AUTO})"
    elif proposta.inicio == a and novos and COMECO_ESPECIAL.match(" ".join(novos)):
        proposta.estado, proposta.detalhe = "recusada", "o parágrafo passaria a começar como lista/citação"
    elif not novos and proposta.fim - proposta.inicio == b - a:
        proposta.estado, proposta.detalhe = "recusada", "apagaria o parágrafo inteiro"
    else:
        proposta.estado = "aplicar"


def _redistribuir(textos: list[str], inicio_s: float, fim_s: float) -> list[dict]:
    """Divide [inicio_s, fim_s] entre as palavras em proporção ao número de letras."""
    pesos = [max(len(t), 1) for t in textos]
    total, acumulado, saida = sum(pesos), 0, []
    for texto, peso in zip(textos, pesos):
        a = inicio_s + (fim_s - inicio_s) * acumulado / total
        acumulado += peso
        b = inicio_s + (fim_s - inicio_s) * acumulado / total
        saida.append({"texto": texto, "inicio_s": round(a, 3), "fim_s": round(b, 3), "interpolada": True})
    return saida


def substituir(palavras: list[dict], inicio: int, fim: int, novos: list[str]) -> list[dict]:
    """As palavras novas para o intervalo [inicio, fim), preservando os tempos do que não mudou."""
    antigas = palavras[inicio:fim]
    saida: list[dict] = []
    matcher = difflib.SequenceMatcher(a=[p["texto"] for p in antigas], b=novos, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            saida.extend(dict(p) for p in antigas[i1:i2])
        elif op == "replace" and i2 - i1 == j2 - j1:
            saida.extend({**antigas[i1 + k], "texto": novos[j1 + k]} for k in range(i2 - i1))
        elif op == "replace":
            saida.extend(_redistribuir(novos[j1:j2], antigas[i1]["inicio_s"], antigas[i2 - 1]["fim_s"]))
        elif op == "insert":
            # Entre a palavra anterior e a seguinte; sem pausa, divide o tempo da anterior com ela.
            anterior = saida[-1] if saida else (palavras[inicio - 1] if inicio > 0 else None)
            seguinte = antigas[i1] if i1 < len(antigas) else (palavras[fim] if fim < len(palavras) else None)
            a = anterior["fim_s"] if anterior else (seguinte["inicio_s"] if seguinte else 0.0)
            b = seguinte["inicio_s"] if seguinte else a
            if b - a >= PAUSA_MINIMA_S:
                saida.extend(_redistribuir(novos[j1:j2], a, b))
            elif saida:
                divididas = _redistribuir([saida[-1]["texto"], *novos[j1:j2]], saida[-1]["inicio_s"], saida[-1]["fim_s"])
                saida[-1:] = divididas
            else:
                # A inserção abre o intervalo: divide o tempo da primeira palavra antiga com ela.
                primeira = antigas[i1]
                divididas = _redistribuir([*novos[j1:j2], primeira["texto"]], primeira["inicio_s"], primeira["fim_s"])
                saida.extend(divididas[:-1])
                antigas[i1] = divididas[-1]
        # "delete": as palavras somem com o tempo delas (a vizinha não é esticada).
    return saida


def aplicar_propostas(transcricao: dict, propostas: list[Proposta]) -> dict:
    """Nova transcrição (formato versao 1) com as propostas `aplicar`; marca conflitos de sobreposição."""
    faixas = faixas_dos_paragrafos(transcricao)
    escolhidas: list[Proposta] = []
    for p in sorted((p for p in propostas if p.estado == "aplicar"), key=lambda p: (p.inicio, p.fim)):
        if escolhidas and p.inicio < escolhidas[-1].fim:
            p.estado, p.detalhe = "conflito", "sobrepõe outra correção aplicada"
            continue
        escolhidas.append(p)
    palavras = [dict(p) for p in transcricao["palavras"]]
    fronteiras = [b for _, b in faixas]  # fim de cada parágrafo, em índices originais
    novas: list[dict] = []
    novas_fronteiras: list[int] = []
    cursor = 0
    fila = list(escolhidas)
    paragrafo = 0
    while cursor < len(palavras):
        if fila and fila[0].inicio == cursor:
            p = fila.pop(0)
            novas.extend(substituir(palavras, p.inicio, p.fim, p.novos or []))
            p.estado = "aplicada"
            cursor = p.fim
        else:
            novas.append(palavras[cursor])
            cursor += 1
        while paragrafo < len(fronteiras) and fronteiras[paragrafo] <= cursor:
            novas_fronteiras.append(len(novas))
            paragrafo += 1
    paragrafos, inicio = [], 0
    for fim in novas_fronteiras:
        paragrafos.append(" ".join(p["texto"] for p in novas[inicio:fim]))
        inicio = fim
    # Tempos não podem voltar: uma redistribuição nunca passa da vizinha, mas conferimos.
    anterior = 0.0
    for p in novas:
        if p["inicio_s"] < anterior:
            p["inicio_s"] = anterior
            p["interpolada"] = True
        p["fim_s"] = max(p["fim_s"], p["inicio_s"])
        anterior = p["inicio_s"]
    revisada = {**transcricao, "paragrafos": paragrafos, "palavras": novas}
    aplicadas = sum(1 for p in propostas if p.estado == "aplicada")
    revisada["motor"] = f"{transcricao['motor']} + revisão de deslizes pelo Codex ({VERSAO_PROMPT}, J90, {aplicadas} correções)"
    revisada["revisao"] = {"prompt": VERSAO_PROMPT, "aplicadas": aplicadas, "original": "transcricao.json"}
    return revisada


def carregar_propostas(pasta: Path) -> tuple[list[Proposta], list[dict]]:
    propostas, chamadas = [], []
    for arquivo in sorted((pasta / PASTA / "trechos").glob("[0-9][0-9].json")):
        resposta = json.loads(arquivo.read_text(encoding="utf-8"))
        chamadas.append(resposta.get("_chamada", {}))
        permitidos = set(resposta.get("_chamada", {}).get("paragrafos", []))
        for c in resposta["correcoes"]:
            p = Proposta("correcao", c["paragrafo"], c["trecho_original"], c["correcao"], c["tipo"], c["motivo"], c["confianca"])
            if permitidos and p.paragrafo not in permitidos:
                p.estado, p.detalhe = "nao_localizada", "parágrafo fora do trecho enviado"
            propostas.append(p)
        for d in resposta["duvidas"]:
            p = Proposta("duvida", d["paragrafo"], d["trecho_original"], d["sugestao"], "duvida", d["motivo"], "baixa")
            if permitidos and p.paragrafo not in permitidos:
                p.estado, p.detalhe = "nao_localizada", "parágrafo fora do trecho enviado"
            propostas.append(p)
    return propostas, chamadas


def _link(transcricao: dict, segundos: float | None) -> str:
    if segundos is None:
        return ""
    return f"[{_minuto(segundos)}]({transcricao['url']}&t={max(int(segundos) - 2, 0)}s)"


def relatorio(transcricao: dict, propostas: list[Proposta], chamadas: list[dict]) -> str:
    correcoes = [p for p in propostas if p.tipo_registro == "correcao"]
    aplicadas = [p for p in correcoes if p.estado == "aplicada"]
    pendentes = [p for p in correcoes if p.estado != "aplicada"]
    duvidas = [p for p in propostas if p.tipo_registro == "duvida"]
    tokens = sum(c.get("tokens") or 0 for c in chamadas)
    linhas = [f"# Revisão da transcrição · {transcricao['titulo']}", "",
              f"Vídeo `{transcricao['id_video']}` ({transcricao['url']}). Prompt `{VERSAO_PROMPT}`, {len(chamadas)} chamadas ao Codex, {tokens:,} tokens.".replace(",", "."), "",
              f"- **Aplicadas** (confiança alta, citação única): {len(aplicadas)}",
              f"- **Para decidir à mão** (confiança média/baixa, ou não localizadas/ambíguas/em conflito): {len(pendentes)}",
              f"- **Dúvidas** (o Codex não sabe o que foi dito; ouvir o áudio): {len(duvidas)}", "",
              "Por tipo (todas as propostas de correção): " + ", ".join(f"{t} {sum(1 for p in correcoes if p.tipo == t)}" for t in sorted(TIPOS)), "",
              "O minuto é link para o YouTube (2 s antes do trecho).", ""]

    def tabela(titulo: str, itens: list[Proposta], com_estado: bool) -> None:
        linhas.extend([f"## {titulo}", ""])
        if not itens:
            linhas.extend(["Nenhuma.", ""])
            return
        linhas.append("| Minuto | Antes | Depois | Tipo | Conf. | Motivo |" + (" Situação |" if com_estado else ""))
        linhas.append("|---|---|---|---|---|---|" + ("---|" if com_estado else ""))
        for p in sorted(itens, key=lambda p: (p.inicio if p.inicio >= 0 else 10**9, p.paragrafo)):
            celula = lambda s: s.replace("|", "\\|").replace("\n", " ")  # noqa: E731
            situacao = f" {p.estado}{': ' + p.detalhe if p.detalhe else ''} |" if com_estado else ""
            linhas.append(f"| {_link(transcricao, p.inicio_s) or '§' + str(p.paragrafo)} | {celula(p.trecho_original)} | {celula(p.correcao) or '(apagar)'} | {p.tipo} | {p.confianca} | {celula(p.motivo)} |{situacao}")
        linhas.append("")

    tabela("Aplicadas", aplicadas, False)
    tabela("Para decidir à mão", pendentes, True)
    linhas.extend(["## Dúvidas (ouvir o áudio)", ""])
    if not duvidas:
        linhas.extend(["Nenhuma.", ""])
    else:
        linhas.extend(["| Minuto | Trecho | Palpite | Motivo |", "|---|---|---|---|"])
        for p in sorted(duvidas, key=lambda p: (p.inicio if p.inicio >= 0 else 10**9, p.paragrafo)):
            linhas.append(f"| {_link(transcricao, p.inicio_s) or '§' + str(p.paragrafo)} | {p.trecho_original.replace('|', '/')} | {p.correcao.replace('|', '/') or '—'} | {p.motivo.replace('|', '/')} |")
        linhas.append("")
    return "\n".join(linhas)


def aplicar(pasta: Path) -> int:
    transcricao = json.loads((pasta / "transcricao.json").read_text(encoding="utf-8"))
    faixas = faixas_dos_paragrafos(transcricao)
    propostas, chamadas = carregar_propostas(pasta)
    for p in propostas:
        if p.estado == "pendente":
            classificar(p, transcricao, faixas)
    revisada = aplicar_propostas(transcricao, propostas)
    faixas_dos_paragrafos(revisada)  # confere o invariante na saída
    (pasta / "transcricao.revisada.json").write_text(json.dumps(revisada, ensure_ascii=False, indent=1), encoding="utf-8")
    registro = {"versao": 1, "id_video": transcricao["id_video"], "prompt": VERSAO_PROMPT, "chamadas": chamadas,
                "propostas": [p.__dict__ for p in propostas]}
    (pasta / PASTA / "revisao.json").write_text(json.dumps(registro, ensure_ascii=False, indent=1), encoding="utf-8")
    (pasta / PASTA / "REVISAO.md").write_text(relatorio(transcricao, propostas, chamadas), encoding="utf-8")
    contagem = {e: sum(1 for p in propostas if p.estado == e) for e in sorted({p.estado for p in propostas})}
    print(f"{transcricao['id_video']}: {contagem}")
    return 0


def principal() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("acao", choices=["rodar", "aplicar", "revisar"])
    parser.add_argument("pasta", type=Path)
    parser.add_argument("--paralelo", type=int, default=4)
    parser.add_argument("--palavras-por-trecho", type=int, default=900)
    parser.add_argument("--esforco", default="medium")
    o = parser.parse_args()
    pasta = o.pasta.expanduser().resolve()
    if o.acao in ("rodar", "revisar"):
        codigo = rodar(pasta, o.paralelo, o.palavras_por_trecho, o.esforco)
        if codigo or o.acao == "rodar":
            return codigo
    return aplicar(pasta)


if __name__ == "__main__":
    sys.exit(principal())
