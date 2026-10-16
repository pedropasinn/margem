import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Bloco, Id } from '@margem/contratos';
import { arvoreDaVersao, capituloDaVersao } from '../biblioteca/api';

/** Notas de outros capítulos já buscadas, por versão e bloco: abrir de novo não pede nada ao serviço. */
const buscadas = new Map<string, Promise<string | null>>();
/** As que já chegaram: reabrir a nota mostra o texto de imediato, sem o "Abrindo a nota…". */
const chegadas = new Map<string, string | null>();

const paiDoXpath = (xpath: string): string => xpath.slice(0, xpath.lastIndexOf('/'));

/**
 * R3-5: o texto inteiro de uma nota, que no EPUB pode ter vários parágrafos (cada um vira um bloco
 * `nota_rodape`, e a chamada aponta para o primeiro). Continua a nota o bloco seguinte que também é nota,
 * do mesmo elemento da nota (o mesmo pai no XHTML, que não é o `body`) e que não é destino de outra chamada.
 * Os parágrafos vêm separados por uma linha em branco. `undefined` quando o bloco não está na lista.
 */
export function textoDaNota(blocos: readonly Pick<Bloco, 'id' | 'tipo' | 'texto' | 'origens' | 'inline'>[], id: Id): string | undefined {
  const indice = blocos.findIndex((bloco) => bloco.id === id);
  const primeiro = blocos[indice];
  if (!primeiro) return undefined;
  const origem = primeiro.origens[0];
  const pai = origem?.tipo === 'epub' ? paiDoXpath(origem.xpath) : null;
  const textos = [primeiro.texto];
  if (primeiro.tipo === 'nota_rodape' && origem?.tipo === 'epub' && pai !== null && !pai.endsWith('/body')) {
    const chamadas = new Set(blocos.flatMap((bloco) => bloco.inline.flatMap((faixa) => faixa.ref ? [faixa.ref] : [])));
    for (const seguinte of blocos.slice(indice + 1)) {
      const dela = seguinte.origens[0];
      if (seguinte.tipo !== 'nota_rodape' || chamadas.has(seguinte.id) || dela?.tipo !== 'epub'
        || dela.arquivo !== origem.arquivo || paiDoXpath(dela.xpath) !== pai) break;
      textos.push(seguinte.texto);
    }
  }
  return textos.join('\n\n');
}

/**
 * O texto de uma nota que está noutro capítulo (o arquivo de notas do EPUB, por exemplo): o serviço diz
 * em que capítulo o bloco está e o snapshot dele traz o bloco. `null` quando o bloco não existe mais.
 */
export function buscarNota(versaoId: Id, blocoId: Id): Promise<string | null> {
  const chave = `${versaoId}:${blocoId}`;
  const conhecida = buscadas.get(chave);
  if (conhecida) return conhecida;
  const busca = (async () => {
    const { capitulo_do_bloco: capitulo } = await arvoreDaVersao(versaoId, blocoId);
    if (!capitulo) return null;
    return textoDaNota((await capituloDaVersao(versaoId, capitulo)).blocos, blocoId) ?? null;
  })();
  void busca.then((texto) => chegadas.set(chave, texto), () => undefined);
  // Uma falha de rede não fica guardada: a próxima abertura tenta de novo.
  busca.catch(() => buscadas.delete(chave));
  buscadas.set(chave, busca);
  return busca;
}

export interface PropsDaNotaAberta {
  versaoId: Id;
  nota: Id;
  /** O texto (`textoDaNota`), quando a nota está no próprio capítulo; sem ele, a nota é buscada. */
  local: string | undefined;
  chamada: HTMLElement;
  artigo: HTMLElement;
  /** `devolverFoco`: o Esc e o botão de fechar voltam o foco à chamada, no ponto do texto. */
  aoFechar: (devolverFoco: boolean) => void;
}

const MARGEM = 4;

/**
 * A nota de rodapé aberta no lugar, logo abaixo da chamada, como nos leitores de livro (Apple Books,
 * Kindle): a leitura não sai do ponto, e fechar (Esc, ×, clique fora) devolve o texto como estava.
 */
export function NotaAberta({ versaoId, nota, local, chamada, artigo, aoFechar }: PropsDaNotaAberta): ReactNode {
  const caixa = useRef<HTMLDivElement>(null);
  const conhecido = local ?? chegadas.get(`${versaoId}:${nota}`);
  const [texto, definirTexto] = useState<string | null | undefined>(conhecido);
  const [falhou, definirFalha] = useState(false);
  const [posicao, definirPosicao] = useState<{ top: number; left: number } | null>(null);
  const numero = chamada.textContent?.trim() ?? '';

  useEffect(() => {
    definirTexto(conhecido); definirFalha(false);
    if (conhecido !== undefined) return;
    let vivo = true;
    buscarNota(versaoId, nota).then((achado) => { if (vivo) definirTexto(achado); }, () => { if (vivo) definirFalha(true); });
    return () => { vivo = false; };
  }, [versaoId, nota, conhecido]);

  // Abaixo da chamada, sem sair da coluna do texto; a posição é do artigo, e a nota rola com ele.
  useLayoutEffect(() => {
    const medir = () => {
      const alvo = chamada.getBoundingClientRect();
      const base = artigo.getBoundingClientRect();
      const largura = caixa.current?.offsetWidth ?? 0;
      const esquerda = Math.min(Math.max(MARGEM, alvo.left - base.left - 24), Math.max(MARGEM, base.width - largura - MARGEM));
      definirPosicao({ top: alvo.bottom - base.top + 6, left: esquerda });
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [chamada, artigo, texto]);

  useEffect(() => { caixa.current?.focus({ preventScroll: true }); }, [nota]);

  // Clique fora fecha (o clique na própria chamada fica com o `ChapterContent`, que alterna).
  useEffect(() => {
    const fora = (evento: PointerEvent) => {
      const alvo = evento.target as Node | null;
      if (alvo && (caixa.current?.contains(alvo) || chamada.contains(alvo))) return;
      aoFechar(false);
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [chamada, aoFechar]);

  const conteudo = falhou ? 'Não foi possível abrir a nota. Tente de novo.'
    : texto === undefined ? 'Abrindo a nota…'
      : texto === null ? 'A nota não está mais neste documento.' : texto;
  return (
    <div
      ref={caixa}
      id={`rodape-${nota}`}
      className="nota-aberta"
      role="dialog"
      aria-label={numero ? `Nota ${numero}` : 'Nota'}
      tabIndex={-1}
      // Antes da primeira medida, transparente (não `visibility: hidden`, que impediria o foco).
      style={posicao ?? { opacity: 0 }}
      onKeyDown={(evento) => {
        if (evento.key !== 'Escape') return;
        // O Esc é da nota: não fecha painel, balão nem foco do leitor por trás dela.
        evento.preventDefault(); evento.stopPropagation(); aoFechar(true);
      }}
      onBlur={(evento) => {
        const proximo = evento.relatedTarget as Node | null;
        if (proximo && !caixa.current?.contains(proximo) && !chamada.contains(proximo)) aoFechar(false);
      }}
    >
      <p className={texto === undefined || texto === null || falhou ? 'nota-aberta-estado' : undefined} {...(texto === undefined && !falhou ? { role: 'status' } : {})}>{conteudo}</p>
      <button type="button" className="nota-aberta-fechar" aria-label="Fechar a nota" onClick={() => aoFechar(true)}>×</button>
    </div>
  );
}
