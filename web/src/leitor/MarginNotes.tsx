import type { RefObject } from 'react';
import type { ApiDoLeitor } from './tipos';
import { IconButton } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { intervaloDoOffset, retanguloDoIntervalo } from './posicao';
import type { NotaPessoal } from './NotasPessoais';
import { usarFuncoes } from './ContextoDosModos';
import { estiloDoNumero } from './f2';
const SEM_PESSOAIS: readonly NotaPessoal[] = [];
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AncoraV1, Id } from '@margem/contratos';
import { ROTULOS_DA_ORIGEM, type Nota } from './notas';

/** Espaço mínimo entre duas notas empilhadas. */
export const ESPACO_ENTRE_NOTAS = 22;
/** Acima deste deslocamento a nota já não está ao lado do trecho: mostra só a primeira linha. */
export const DESLOCAMENTO_MAXIMO = 240;

export interface AcoesDaNota {
  alternarVisibilidade: (id: Id, visivel: boolean) => void;
  avaliar: (id: Id, avaliacao: 'confirmada' | 'rejeitada') => void;
}

export interface PropsDaMargem {
  leitor?: RefObject<ApiDoLeitor>;
  notas: readonly Nota[];
  /** Raiz do leitor: é nela que os retângulos dos trechos são medidos. */
  artigo: HTMLElement | null;
  ativa: Id | null;
  fixada: Id | null;
  acoes?: AcoesDaNota | undefined;
  /** Perguntas de recuperação da seção, quando a API as expõe. */
  perguntas?: readonly string[] | undefined;
  recolhida?: boolean;
  pessoais?: readonly NotaPessoal[] | undefined;
  conexaoDaNota?: ((ancora: AncoraV1) => ReactNode) | undefined;
  /** J138: a nota do leitor de cada grifo (por marca): aparece como uma linha ✎ dentro da nota do grifo, não como outro card. */
  notasDoLeitor?: ReadonlyMap<Id, string> | undefined;
}

interface Medida {
  topo: number;
  resumo: boolean;
  /** Margem recolhida (J132): a posição na fileira da linha, como as pilhas do celular. */
  esquerda?: number;
}
/** Recolhida, o que começa na mesma linha do texto (até esta distância) entra na mesma fileira. */
const MESMA_LINHA = 18;
/** Passo entre as bolinhas de uma fileira e o máximo por fileira. */
const PASSO_NA_FILEIRA = 30;
const MAXIMO_NA_FILEIRA = 6;

/** Topo do primeiro retângulo do trecho, por `Range.getClientRects()` sobre os segmentos. */
export function topoDoTrecho(artigo: HTMLElement, marcaId: Id): number | null {
  const segmentos = [...artigo.querySelectorAll<HTMLElement>('span[data-marcas]')].filter((span) =>
    (span.dataset['marcas'] ?? '').split(' ').includes(marcaId));
  const primeiro = segmentos[0];
  if (primeiro === undefined) return null;
  const intervalo = artigo.ownerDocument.createRange();
  intervalo.selectNodeContents(primeiro);
  const retangulos = typeof intervalo.getClientRects === 'function' ? [...intervalo.getClientRects()] : [];
  const retangulo = retangulos[0] ?? primeiro.getBoundingClientRect();
  return retangulo.top;
}

/** Aberta, só a altura; recolhida, também a posição na fileira. */
function posicao(medida: Medida | undefined): string {
  return medida?.esquerda ? `translate(${String(medida.esquerda)}px, ${String(medida.topo)}px)` : `translateY(${String(medida?.topo ?? 0)}px)`;
}

function iguais(a: Record<Id, Medida>, b: Record<Id, Medida>): boolean {
  const chaves = Object.keys(a);
  if (chaves.length !== Object.keys(b).length) return false;
  return chaves.every((chave) => a[chave]?.topo === b[chave]?.topo && a[chave]?.resumo === b[chave]?.resumo && a[chave]?.esquerda === b[chave]?.esquerda);
}

/**
 * Notas na coluna que sobra da medida do texto. A posição desejada é a do trecho; a efetiva
 * respeita `topo = máximo(topo_do_trecho, fim_da_anterior + ESPACO_ENTRE_NOTAS)`. A margem nunca empurra o
 * texto: as notas são posicionadas em absoluto dentro da própria coluna.
 */
export function MarginNotes({ leitor, notas, artigo, ativa, fixada, acoes, perguntas, recolhida = false, pessoais = SEM_PESSOAIS, conexaoDaNota, notasDoLeitor }: PropsDaMargem): ReactNode {
  const { daMarca, rotuloDaMarca } = usarFuncoes();
  const coluna = useRef<HTMLDivElement>(null);
  const elementos = useRef(new Map<Id, HTMLElement>());
  const [medidas, definirMedidas] = useState<Record<Id, Medida>>({});
  const [fimDasNotas, definirFim] = useState(0);

  const medir = useCallback(() => {
    const alvo = coluna.current;
    if (alvo === null || artigo === null) return;
    const base = alvo.getBoundingClientRect().top;
    const novas: Record<Id, Medida> = {};
    let piso = 0;
    const itens = [
      ...notas.map((nota) => ({ id: nota.marca.id, desejado: (leitor?.current?.retangulosDaAncora?.(nota.marca.ancora)[0]?.top ?? topoDoTrecho(artigo, nota.marca.id)
        ?? leitor?.current?.localizar(nota.marca.ancora.bloco_id, nota.marca.ancora.inicio_utf16)?.top ?? base) - base })),
      ...pessoais.map((nota) => {
        const intervalo = intervaloDoOffset(artigo, nota.ancora.bloco_id, nota.ancora.inicio_utf16);
        return { id: nota.id, desejado: (leitor?.current?.localizar(nota.ancora.bloco_id, nota.ancora.inicio_utf16)?.top ?? (intervalo ? retanguloDoIntervalo(intervalo)?.top ?? base : base)) - base };
      }),
    ].sort((a, b) => a.desejado - b.desejado);
    // Recolhida (J132): as bolinhas da mesma linha ficam lado a lado, na altura do trecho, em vez de
    // descerem uma abaixo da outra; só a nota aberta (ativa ou fixada) ocupa a altura toda.
    let fileira: { topo: number; quantos: number; aberta: boolean } | null = null;
    for (const item of itens) {
      const aberta = item.id === ativa || item.id === fixada;
      if (recolhida && !aberta && fileira && !fileira.aberta && item.desejado - fileira.topo < MESMA_LINHA && fileira.quantos < MAXIMO_NA_FILEIRA) {
        novas[item.id] = { topo: fileira.topo, resumo: false, esquerda: fileira.quantos * PASSO_NA_FILEIRA };
        fileira.quantos += 1;
        continue;
      }
      const topo = Math.max(item.desejado, piso);
      novas[item.id] = { topo, resumo: topo - item.desejado > DESLOCAMENTO_MAXIMO, ...(recolhida ? { esquerda: 0 } : {}) };
      fileira = { topo, quantos: 1, aberta };
      piso = topo + (elementos.current.get(item.id)?.getBoundingClientRect().height ?? 0) + (recolhida && !aberta ? 6 : ESPACO_ENTRE_NOTAS);
    }
    definirMedidas((anteriores) => (iguais(anteriores, novas) ? anteriores : novas));
    definirFim((anterior) => (anterior === piso ? anterior : piso));
  }, [artigo, notas, pessoais, leitor, recolhida, ativa, fixada]);

  // Só mudanças que afetam a geometria das notas.
  useLayoutEffect(medir, [medir, ativa, fixada, recolhida]);

  // Fonte, imagem ou largura disponível mudou: medir de novo.
  useEffect(() => {
    if (artigo === null || typeof window === 'undefined') return;
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { medir(); }) : null;
    observador?.observe(artigo);
    const texto = artigo.querySelector('.capitulo');
    if (texto) observador?.observe(texto);
    for (const nota of elementos.current.values()) observador?.observe(nota);
    window.addEventListener('resize', medir); window.addEventListener('margem:geometria', medir);
    const fontes: { ready?: Promise<unknown> } | undefined = document.fonts;
    void fontes?.ready?.then(() => { medir(); }, () => { /* sem API de fontes: a medida inicial vale. */ });
    return () => {
      observador?.disconnect();
      window.removeEventListener('resize', medir); window.removeEventListener('margem:geometria', medir);
    };
  }, [artigo, medir]);

  const registrar = useCallback((id: Id, elemento: HTMLElement | null) => {
    if (elemento === null) elementos.current.delete(id);
    else elementos.current.set(id, elemento);
  }, []);

  return (
    <div className={recolhida ? "margem recolhida" : "margem"} ref={coluna} data-ativa={ativa ?? undefined} style={{ minHeight: fimDasNotas }}>
      {notas.map((nota) => {
        const { id } = nota.marca;
        const medida = medidas[id];
        const estaAtiva = ativa === id;
        const classes = ['nota'];
        if (estaAtiva) classes.push('ativa');
        if (medida?.resumo === true && !estaAtiva) classes.push('resumo');
        // Oculta: fica só o número; fixada, abre inteira para poder ser mostrada de novo.
        const oculta = !nota.marca.visivel && fixada !== id;
        if (oculta) classes.push('oculta');
        const soNumero = recolhida || oculta;
        return (
          <aside
            key={id}
            id={`nota-${id}`}
            className={classes.join(' ')}
            data-nota={id}
            tabIndex={0}
            ref={(elemento) => { registrar(id, elemento); }}
            style={{ transform: posicao(medida) }}
          >
            <p className="nota-cabeca">
              <span style={estiloDoNumero(daMarca(nota.marca))} className={`nota-numero funcao-${nota.marca.funcao}`} tabIndex={soNumero ? 0 : undefined} role={soNumero ? 'button' : undefined} aria-label={soNumero ? `Nota ${nota.numero}${nota.marca.visivel ? '' : ' (oculta)'}: ${nota.comentario.rotulo}` : undefined}>{nota.numero}</span>
              <span className="nota-rotulo">{rotuloDaMarca(nota.marca)}</span>
              {conexaoDaNota?.(nota.marca.ancora)}
            </p>
            <p className="nota-texto">{nota.comentario.texto}</p>
            {notasDoLeitor?.has(id) && <p className="nota-do-leitor-resumo"><span aria-hidden="true">✎</span><span className="balao-oculto">Sua anotação: </span>{notasDoLeitor.get(id)}</p>}
            {fixada === id && acoes !== undefined && (
              <p className="nota-acoes">
                <span className="grupo-de-icones" role="group" aria-label="Avaliar esta marca">
                  <IconButton aria-label={nota.marca.visivel ? 'Ocultar' : 'Mostrar'} title={nota.marca.visivel ? 'Ocultar' : 'Mostrar'}
                    onClick={() => { acoes.alternarVisibilidade(id, !nota.marca.visivel); }}>
                    <Icon name={nota.marca.visivel ? 'olho-fechado' : 'olho'} size={16} />
                  </IconButton>
                  <IconButton className="confirmar" aria-label="Confirmar" title="Confirmar" aria-pressed={nota.marca.avaliacao === 'confirmada'}
                    onClick={() => { acoes.avaliar(id, 'confirmada'); }}>
                    <Icon name="check" size={16} />
                  </IconButton>
                  <IconButton className="rejeitar" aria-label="Rejeitar" title="Rejeitar" aria-pressed={nota.marca.avaliacao === 'rejeitada'}
                    onClick={() => { acoes.avaliar(id, 'rejeitada'); }}>
                    <Icon name="xis" size={16} />
                  </IconButton>
                </span>
                <span className="nota-origem">{ROTULOS_DA_ORIGEM[nota.marca.origem]}</span>
              </p>
            )}
          </aside>
        );
      })}
      {pessoais.map((nota) => <aside key={nota.id} data-pessoal={nota.id} className={`nota nota-pessoal${recolhida && nota.sinal ? ' com-sinal' : ''}`} ref={(el) => registrar(nota.id, el)} style={{ transform: posicao(medidas[nota.id]) }}>
        {recolhida && nota.sinal && nota.aoAbrir
          ? <button type="button" className={`nota-numero sinal-pessoal${nota.sinal === '!' ? ' sinal-de-falha' : ''}`} aria-label={nota.descricao ?? 'Abrir'} title={nota.descricao} onClick={nota.aoAbrir}>{nota.sinal === '!' ? '' : nota.sinal}</button>
          : nota.conteudo}
      </aside>)}
      {perguntas !== undefined && perguntas.length > 0 && (
        <details className="recuperacao" style={{ transform: `translateY(${String(fimDasNotas)}px)` }}>
          <summary>Recuperação da seção</summary>
          <ul>
            {perguntas.map((pergunta) => <li key={pergunta}>{pergunta}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
