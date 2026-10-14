/**
 * O painel do trecho (J132): o lugar único das ações sobre um trecho — nota, perguntar, conexões,
 * flashcard e visual —, no mesmo trilho de 400 px do painel do documento, sem véu (o texto continua
 * legível e selecionável ao lado). A citação aparece uma vez, no topo; as abas trocam o conteúdo; cada
 * formulário tem um único botão principal, no rodapé. Esc fecha (quem abre cuida) e "← Documento"
 * volta às abas do documento. No celular, folha inferior, como o painel do documento.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AncoraV1 } from '@margem/contratos';
import { Button, IconButton, SegmentedControl } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { usarFuncoes } from './ContextoDosModos';
import type { MarcaDoLeitor } from './f2';

export type AbaDoTrecho = 'nota' | 'perguntar' | 'conexoes';
const TITULOS: Record<AbaDoTrecho, string> = { nota: 'Nota do trecho', perguntar: 'Perguntar', conexoes: 'Conexões do trecho' };
/** Citações maiores que isto começam recolhidas (cerca de três linhas no painel). */
const CITACAO_CURTA = 220;

export function PainelDoTrecho({ ancora, marca = null, aba, titulo, conexoes = 0, aoMudarAba, aoFechar, aoVoltarAoDocumento, children }: {
  /** O trecho; sem ele (o quadro do capítulo inteiro), não há citação. */
  ancora: AncoraV1 | null;
  /** O grifo do trecho, quando há: o rótulo dele (cor e função) fica sob a citação. */
  marca?: MarcaDoLeitor | null;
  /** A aba das ações do trecho; `null` é um formulário sem abas (flashcard, visual), com `titulo`. */
  aba: AbaDoTrecho | null;
  titulo?: string;
  conexoes?: number;
  aoMudarAba?: (aba: AbaDoTrecho) => void;
  aoFechar: () => void;
  aoVoltarAoDocumento?: (() => void) | undefined;
  children: ReactNode;
}): ReactNode {
  const { rotuloDaMarca, daMarca } = usarFuncoes();
  const raiz = useRef<HTMLElement>(null);
  const [inteira, mostrarInteira] = useState(false);
  const longa = (ancora?.citacao.length ?? 0) > CITACAO_CURTA;
  // Abrir põe o foco no painel (no campo, se o conteúdo tiver um com autoFocus); sem prender o Tab.
  useEffect(() => {
    const elemento = raiz.current;
    if (elemento && !elemento.contains(document.activeElement)) (elemento.querySelector<HTMLElement>('textarea, input:not([type=hidden])') ?? elemento).focus({ preventScroll: true });
  }, [aba, titulo]);
  const rotuloDoGrifo = marca === null ? null : rotuloDaMarca(marca);
  const nome = aba === null ? titulo ?? 'Trecho' : TITULOS[aba];
  return <aside ref={raiz} className="painel-do-leitor painel-trecho" style={{ position: 'fixed' }} aria-label={nome} tabIndex={-1}>
    <header className="painel-trecho-cabeca">
      {aoVoltarAoDocumento && <Button variante="ghost" tamanho="sm" className="painel-trecho-voltar" onClick={aoVoltarAoDocumento}><Icon name="back" size={16} />Documento</Button>}
      <h2>{nome}</h2>
      <IconButton tamanho="sm" icone="xis" aria-label="Fechar o painel do trecho" onClick={aoFechar} />
    </header>
    {ancora && <figure className="painel-trecho-citacao" style={{ '--cor-nota': marca ? daMarca(marca) : 'var(--borda)' } as CSSProperties}>
      <blockquote data-recolhida={longa && !inteira ? '' : undefined}>{ancora.citacao}</blockquote>
      {(longa || rotuloDoGrifo) && <figcaption>
        {rotuloDoGrifo && <span className="painel-trecho-rotulo"><span className="painel-leitor-ponto" style={{ backgroundColor: daMarca(marca!) }} />{rotuloDoGrifo}{marca!.origem === 'manual' ? ' · seu grifo' : ''}</span>}
        {longa && <Button variante="ghost" tamanho="sm" onClick={() => mostrarInteira(!inteira)}>{inteira ? 'Mostrar menos' : 'Mostrar tudo'}</Button>}
      </figcaption>}
    </figure>}
    {aba !== null && aoMudarAba && <SegmentedControl rotulo="Ações do trecho" className="painel-trecho-abas" valor={aba} aoMudar={(valor) => aoMudarAba(valor as AbaDoTrecho)}
      opcoes={[{ valor: 'nota', rotulo: 'Nota' }, { valor: 'perguntar', rotulo: 'Perguntar' }, { valor: 'conexoes', rotulo: conexoes > 0 ? `Conexões ${String(conexoes)}` : 'Conexões', nome: 'Conexões' }]} />}
    <div className="painel-trecho-corpo">{children}</div>
  </aside>;
}
