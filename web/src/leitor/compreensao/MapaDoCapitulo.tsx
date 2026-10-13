/**
 * Mapa do capítulo (`docs/desenho/09-VISAO.md` §7, item 3): o capítulo resumido num fluxograma
 * esquemático (partes em faixas de cor, ideias em formas por tipo, setas com rótulo), gerado uma vez
 * pelo Codex a partir do modelo da compreensão e guardado. Tocar numa ideia leva ao trecho no texto.
 * A antiga vista "Em texto" e o "Fluxograma do capítulo" saíram (30/09): o esquema faz as duas vezes.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AncoraV1 } from '@margem/contratos';
import { Button, IconButton } from '../../ui/Primitives';
import { Icon } from '../../ui/Icon';
import ThoughtLine from '../../ui/pensando/ThoughtLine';
import { DesenhoDoEsquema } from './esquema/DesenhoDoEsquema';
import type { MotorDeLayout } from './esquema/layout';
import { emCurso, useEsquema, FONTES_DO_ESQUEMA, type FontesDoEsquema } from './esquema/useEsquema';
import './esquema/esquema.css';
import { nomeDaUnidade, usarForma } from '../forma';

export interface PropsDoMapa {
  titulo: string;
  aoIr: (ancora: AncoraV1) => void;
  aoFechar: () => void;
  compreensaoId: string;
  secaoId: string;
  fontesDoEsquema?: FontesDoEsquema;
  motorDoLayout?: () => Promise<MotorDeLayout>;
}

/** A tela cheia do mapa: barra de cima (título, ações, fechar) e o esquema. */
function CascaDoMapa({ titulo, aoFechar, acoes, children }: { titulo: string; aoFechar: () => void; acoes: ReactNode; children: ReactNode }): ReactNode {
  const unidade = nomeDaUnidade(usarForma());
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => { fechar.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [aoFechar]);
  return <div className="mapa-capitulo" role="dialog" aria-modal="true" aria-label={`Mapa do ${unidade}`}>
    <header className="mapa-barra">
      <div className="mapa-titulos"><span className="eyebrow">Mapa do {unidade}</span><h2>{titulo}</h2></div>
      {acoes}
      <IconButton ref={fechar} aria-label="Fechar mapa" onClick={aoFechar} className="fechar-mapa"><Icon name="xis" size={18} /></IconButton>
    </header>
    {children}
  </div>;
}

export function MapaDoCapitulo(props: PropsDoMapa): ReactNode {
  const { compreensaoId, secaoId, aoIr, fontesDoEsquema, motorDoLayout } = props;
  const { situacao, erro, pedindo, gerar } = useEsquema(compreensaoId, secaoId, fontesDoEsquema ?? FONTES_DO_ESQUEMA);
  const andando = emCurso(situacao) || pedindo;
  const [avisoFechado, fecharAviso] = useState<string | null>(null);
  const pronto = situacao?.esquema ?? null;
  const acoes = pronto ? (andando
    ? <span className="esquema-gerando" role="status"><ThoughtLine label="Gerando um mapa novo…" collapsible={false} showTimer={false} fontSize={13} color="var(--texto-2)" glyphColor="var(--accent)" /></span>
    : <Button variante="ghost" className="small regenerar-mapa" onClick={gerar} title="Pede ao Codex um esquema novo; o atual continua guardado" aria-label="Regenerar o mapa">
      <Icon name="restaurar" size={16} /><span>Regenerar</span></Button>) : null;

  let esquema: ReactNode;
  if (pronto) {
    const falhaNova = situacao?.estado === 'falhou' && situacao.pedido_id !== avisoFechado ? situacao.motivo ?? 'A nova versão falhou.' : null;
    esquema = <div className="mapa-esquema">
      <DesenhoDoEsquema key={pronto.id} esquema={pronto} aoIr={aoIr} {...(motorDoLayout ? { motor: motorDoLayout } : {})} />
      {(falhaNova || erro) && <div className="esquema-acoes">
        {falhaNova && <span className="esquema-aviso" role="alert">Não deu para gerar de novo: {falhaNova}
          <button type="button" aria-label="Dispensar aviso" onClick={() => fecharAviso(situacao?.pedido_id ?? null)}>×</button></span>}
        {erro && <span className="esquema-aviso" role="alert">{erro}</span>}
      </div>}
    </div>;
  } else {
    let corpo: ReactNode;
    if (andando) {
      corpo = <>
        <ThoughtLine label="Desenhando o mapa do capítulo…" collapsible={false} fontSize={17} color="var(--texto-1)" glyphColor="var(--accent)"
          steps={['Lendo o modelo do capítulo', 'Separando as partes', 'Escolhendo as ideias principais', 'Ligando uma à outra']} />
        <p>Leva um ou dois minutos. Pode fechar e voltar: o mapa fica guardado.</p>
      </>;
    } else if (situacao === null && erro === null) {
      corpo = <ThoughtLine label="Abrindo o mapa…" collapsible={false} showTimer={false} fontSize={15} color="var(--texto-2)" glyphColor="var(--accent)" />;
    } else {
      const falhou = situacao?.estado === 'falhou';
      corpo = <>
        <span className="esquema-vazio-icone"><Icon name="fluxograma" size={28} /></span>
        <h3>{falhou ? 'O mapa não saiu desta vez' : 'Este capítulo ainda não tem mapa'}</h3>
        <p>{falhou ? situacao.motivo ?? 'O Codex não conseguiu gerar o mapa.'
          : 'O Codex resume o capítulo num fluxograma: as partes, as ideias principais de cada uma e como uma leva à outra. Leva um ou dois minutos e fica guardado.'}</p>
        {erro && <p className="esquema-aviso" role="alert">{erro}</p>}
        <div className="esquema-vazio-acoes">
          <Button variante="primario" onClick={gerar} disabled={pedindo}>{falhou ? 'Tentar de novo' : 'Gerar mapa'}</Button>
        </div>
      </>;
    }
    esquema = <div className="mapa-esquema"><div className="esquema-vazio" aria-live="polite">{corpo}</div></div>;
  }
  return <CascaDoMapa titulo={props.titulo} aoFechar={props.aoFechar} acoes={acoes}>{esquema}</CascaDoMapa>;
}
