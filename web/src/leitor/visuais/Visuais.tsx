/**
 * Visuais ancorados na interface (J70): o pedido (painel), a nota na margem, a faixa do capítulo
 * e a visualização grande. Texto do modelo só entra como texto (React escapa) ou pelo SVG
 * higienizado do `DiagramaMermaid`.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AlvoDoVisual, AncoraV1, TipoDoVisual, VisualV1 } from '@margem/contratos';
import { Button, IconButton, SegmentedControl, Textarea, usarFoco } from '../../ui/Primitives';
import { DiagramaMermaid } from './DiagramaMermaid';
import { urlDaImagem } from './api';
import type { SerieDeVisuais } from './useVisuais';
import './visuais.css';

export const NOME_DO_TIPO: Record<TipoDoVisual, string> = { imagem: 'Imagem', diagrama: 'Fluxograma' };

/** Rótulo curto do visual: "Imagem", "Quadro do poema", "Fluxograma do capítulo"… */
export function rotuloDoVisual(visual: Pick<VisualV1, 'tipo' | 'alvo'>, poesia: boolean, unidade = 'capítulo'): string {
  if (visual.alvo.tipo === 'capitulo') return visual.tipo === 'imagem' ? `Quadro do ${poesia ? 'poema' : unidade}` : `Fluxograma do ${unidade}`;
  if (visual.alvo.tipo === 'bloco') return `${NOME_DO_TIPO[visual.tipo]} da ${poesia ? 'estrofe' : 'passagem'}`;
  return NOME_DO_TIPO[visual.tipo];
}

function estadoEmPalavras(visual: VisualV1): string {
  if (visual.estado === 'pendente') return visual.diagnosticos.some((d) => d.codigo === 'adiado') ? 'Aguardando a cota do Codex…' : 'Na fila…';
  if (visual.estado === 'executando') return visual.tipo === 'imagem' ? 'O Codex está desenhando…' : 'O Codex está montando o fluxograma…';
  return '';
}

// ---------------------------------------------------------------- pedido

export interface PedidoDeVisual {
  tipo: TipoDoVisual;
  /** Trecho selecionado; `null` para o capítulo inteiro. */
  ancora: AncoraV1 | null;
  /** A estrofe (ou bloco) inteira que contém o trecho, quando dá para escolher. */
  blocoInteiro: AncoraV1 | null;
}

export function PainelDoVisual({ pedido, poesia, unidade, aoEnviar, aoFechar }: {
  pedido: PedidoDeVisual; poesia: boolean; unidade: string;
  aoEnviar: (dados: { alvo: AlvoDoVisual; pedido: string }) => Promise<void>;
  aoFechar: () => void;
}): ReactNode {
  const [texto, definirTexto] = useState('');
  // Seleção que já cobre a estrofe inteira chega só como `blocoInteiro`: o alvo é o bloco.
  const [inteiro, definirInteiro] = useState(pedido.ancora === null && pedido.blocoInteiro !== null);
  const [enviando, enviar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const ancora = inteiro ? pedido.blocoInteiro : pedido.ancora;
  const alvo: AlvoDoVisual = ancora === null ? { tipo: 'capitulo' } : inteiro && pedido.blocoInteiro ? { tipo: 'bloco', ancora } : { tipo: 'trecho', ancora };
  const acao = pedido.tipo === 'imagem' ? 'Criar imagem' : 'Criar fluxograma';
  return <form className="formulario formulario-estudo painel-do-visual" onSubmit={(e) => {
    e.preventDefault();
    if (enviando) return;
    enviar(true); definirErro(null);
    void aoEnviar({ alvo, pedido: texto }).catch((falha: unknown) => { definirErro(falha instanceof Error ? falha.message : 'Não foi possível pedir o visual.'); enviar(false); });
  }}>
    {ancora !== null ? <blockquote className="citacao-do-visual">{ancora.citacao}</blockquote>
      : <p className="alvo-do-visual">{pedido.tipo === 'imagem' ? `Um quadro que represente o ${poesia ? 'poema' : unidade} inteiro.` : `As ideias do ${unidade} inteiro, de cima para baixo.`}</p>}
    {pedido.blocoInteiro && pedido.ancora && <SegmentedControl rotulo="Alcance" valor={inteiro ? 'bloco' : 'trecho'} aoMudar={(valor) => definirInteiro(valor === 'bloco')}
      opcoes={[{ valor: 'trecho', rotulo: 'Trecho selecionado' }, { valor: 'bloco', rotulo: poesia ? 'Estrofe inteira' : 'Parágrafo inteiro' }]} />}
    <label><span>O que você quer <span className="opcional">(opcional)</span></span>
      <Textarea value={texto} maxLength={2000} onChange={(e) => definirTexto(e.target.value)}
        placeholder={pedido.tipo === 'imagem' ? 'Ex.: gravura em nanquim, a cena do naufrágio, sem pessoas' : 'Ex.: destaque as objeções e a resposta do autor'} />
    </label>
    <p className="nota-do-pedido">{pedido.tipo === 'imagem' ? 'O Codex gera a imagem sem texto escrito; ela aparece aqui como nota.' : 'Fluxograma vertical; cada ideia leva ao trecho que a sustenta.'}</p>
    {erro && <p className="erro-do-visual" role="alert">{erro}</p>}
    <div className="ui-rodape"><Button variante="ghost" tamanho="md" onClick={aoFechar}>Cancelar</Button><Button type="submit" variante="primario" tamanho="md" disabled={enviando}>{enviando ? 'Pedindo…' : acao}</Button></div>
  </form>;
}

// ---------------------------------------------------------------- miniatura

function Miniatura({ visual, aoAbrir }: { visual: VisualV1; aoAbrir: () => void }): ReactNode {
  const artefato = visual.artefato;
  if (!artefato) return null;
  if (artefato.tipo === 'png') {
    return <button type="button" className="miniatura-do-visual" onClick={aoAbrir} aria-label={`Ampliar a imagem: ${artefato.descricao}`}>
      <img src={urlDaImagem(visual.id)} alt={artefato.descricao} width={artefato.largura} height={artefato.altura} loading="lazy" decoding="async" />
    </button>;
  }
  return <button type="button" className="miniatura-do-visual miniatura-do-diagrama" onClick={aoAbrir} aria-label={`Ampliar o fluxograma: ${artefato.titulo}`}>
    <DiagramaMermaid id={visual.id} codigo={artefato.codigo} nos={artefato.nos} />
  </button>;
}

/** O conteúdo comum da nota e do cartão do capítulo: estado, miniatura, erro e ações. */
function CorpoDoVisual({ serie, rotulo, ocupado, aoAbrir, aoTentarDeNovo }: {
  serie: SerieDeVisuais; rotulo: string; ocupado: boolean; aoAbrir: () => void; aoTentarDeNovo: () => void;
}): ReactNode {
  const { atual, anteriores } = serie;
  return <>
    <span className="eyebrow">{rotulo}{anteriores.length > 0 ? ` · v${String(anteriores.length + 1)}` : ''}</span>
    {atual.pedido && <p className="pedido-do-visual">{atual.pedido}</p>}
    {(atual.estado === 'pendente' || atual.estado === 'executando') && <p className="estado-do-visual" role="status" data-estado={atual.estado}><span className="pulso" aria-hidden="true" />{estadoEmPalavras(atual)}</p>}
    {atual.estado === 'falhou' && <>
      <p className="erro-do-visual" role="alert">{atual.motivo}</p>
      <div className="acoes-pessoais"><Button tamanho="sm" disabled={ocupado} onClick={aoTentarDeNovo}>Tentar de novo</Button>
        <Button variante="ghost" tamanho="sm" onClick={aoAbrir}>Detalhes</Button></div>
    </>}
    {atual.estado === 'pronto' && <>
      <Miniatura visual={atual} aoAbrir={aoAbrir} />
      {atual.artefato?.tipo === 'mermaid' && <p className="titulo-do-visual">{atual.artefato.titulo}</p>}
    </>}
  </>;
}

export function NotaDoVisual(props: { serie: SerieDeVisuais; rotulo: string; ocupado: boolean; aoAbrir: () => void; aoTentarDeNovo: () => void }): ReactNode {
  // Na margem, a falha não empurra as outras notas (J132): um triângulo do tamanho das bolinhas; o motivo e as ações ao tocar.
  if (props.serie.atual.estado === 'falhou') return <FalhaDoVisual {...props} />;
  return <div className="nota-do-visual" data-tipo={props.serie.atual.tipo} data-estado={props.serie.atual.estado}><CorpoDoVisual {...props} /></div>;
}

function FalhaDoVisual({ serie, rotulo, ocupado, aoAbrir, aoTentarDeNovo }: { serie: SerieDeVisuais; rotulo: string; ocupado: boolean; aoAbrir: () => void; aoTentarDeNovo: () => void }): ReactNode {
  const [aberta, abrir] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberta) return;
    const fora = (evento: PointerEvent) => { if (evento.target instanceof Node && !raiz.current?.contains(evento.target)) abrir(false); };
    const tecla = (evento: KeyboardEvent) => { if (evento.key === 'Escape') abrir(false); };
    document.addEventListener('pointerdown', fora); window.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('pointerdown', fora); window.removeEventListener('keydown', tecla); };
  }, [aberta]);
  return <div ref={raiz} className="nota-do-visual falha-do-visual" data-tipo={serie.atual.tipo} data-estado="falhou">
    <button type="button" className="triangulo-de-falha" aria-expanded={aberta} aria-label={`${rotulo} não saiu: ver o motivo`} title={`${rotulo} não saiu`} onClick={() => abrir(!aberta)}>
      <svg width="24" height="22" viewBox="0 0 24 22" aria-hidden="true"><path d="M12 2 22.5 20H1.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M12 8.5v5.2M12 16.6v.1" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" /></svg>
    </button>
    {aberta && <div className="cartao-da-falha" role="group" aria-label={`${rotulo} não saiu`}>
      <p className="eyebrow">{rotulo} não saiu</p>
      <p className="erro-do-visual" role="alert">{serie.atual.motivo}</p>
      <div className="acoes-pessoais"><Button tamanho="sm" disabled={ocupado} onClick={() => { abrir(false); aoTentarDeNovo(); }}>Tentar de novo</Button>
        <Button variante="ghost" tamanho="sm" onClick={() => { abrir(false); aoAbrir(); }}>Detalhes</Button></div>
    </div>}
  </div>;
}

/** Os visuais do capítulo inteiro, no topo dele, na largura do texto. */
export function VisuaisDoCapitulo({ series, rotulo, ocupado, aoAbrir, aoTentarDeNovo }: {
  series: readonly SerieDeVisuais[]; rotulo: (visual: VisualV1) => string; ocupado: boolean;
  aoAbrir: (serie: SerieDeVisuais) => void; aoTentarDeNovo: (visual: VisualV1) => void;
}): ReactNode {
  if (series.length === 0) return null;
  return <section className="visuais-do-capitulo" aria-label="Visuais do capítulo">
    {series.map((serie) => <div key={serie.atual.id} className="cartao-do-visual" data-tipo={serie.atual.tipo} data-estado={serie.atual.estado}>
      <CorpoDoVisual serie={serie} rotulo={rotulo(serie.atual)} ocupado={ocupado} aoAbrir={() => aoAbrir(serie)} aoTentarDeNovo={() => aoTentarDeNovo(serie.atual)} />
    </div>)}
  </section>;
}

// ---------------------------------------------------------------- visualização grande

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3] as const;

export function VisualAmpliado({ serie, rotulo, aoFechar, aoCitar, aoRegenerar, aoApagar }: {
  serie: SerieDeVisuais; rotulo: string; aoFechar: () => void; aoCitar: (ancora: AncoraV1) => void;
  aoRegenerar: (visual: VisualV1, pedido: string | null) => Promise<void>; aoApagar: (visual: VisualV1) => Promise<void>;
}): ReactNode {
  const raiz = useRef<HTMLDivElement>(null);
  usarFoco(raiz, aoFechar);
  const versoes = [serie.atual, ...serie.anteriores];
  const [indice, escolher] = useState(0);
  const visual = versoes[Math.min(indice, versoes.length - 1)]!;
  const [zoom, definirZoom] = useState(3);
  const [refazendo, refazer] = useState(false);
  const [pedido, definirPedido] = useState(visual.pedido ?? '');
  const [confirmar, pedirConfirmacao] = useState(false);
  const [ocupado, ocupar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  useEffect(() => { pedirConfirmacao(false); definirPedido(visual.pedido ?? ''); }, [visual.id, visual.pedido]);
  const executar = (acao: () => Promise<void>) => {
    if (ocupado) return;
    ocupar(true); definirErro(null);
    void acao().catch((falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível concluir.')).finally(() => ocupar(false));
  };
  const artefato = visual.artefato;
  const alvo = visual.alvo.tipo === 'capitulo' ? null : visual.alvo.ancora;
  return <div className="ui-veu visual-ampliado-veu"><div ref={raiz} className="visual-ampliado" role="dialog" aria-modal="true" aria-label={rotulo} tabIndex={-1} data-tipo={visual.tipo}>
    <header className="cabeca-do-ampliado">
      <div className="titulo-do-ampliado">
        <span className="eyebrow">{rotulo}</span>
        {artefato?.tipo === 'mermaid' && <h2>{artefato.titulo}</h2>}
        {alvo && <button type="button" className="citacao-curta" onClick={() => { aoFechar(); aoCitar(alvo); }} title="Ir ao trecho">“{alvo.citacao}”</button>}
      </div>
      <div className="acoes-do-ampliado">
        {versoes.length > 1 && <SegmentedControl rotulo="Versão" valor={String(indice)} aoMudar={(valor) => escolher(Number(valor))}
          opcoes={versoes.map((v, i) => ({ valor: String(i), rotulo: `v${String(versoes.length - i)}`, nome: `Versão ${String(versoes.length - i)}${i === 0 ? ' (atual)' : ''}` }))} />}
        {artefato?.tipo === 'mermaid' && <div className="zoom-do-ampliado" role="group" aria-label="Zoom">
          <IconButton aria-label="Diminuir" disabled={zoom === 0} onClick={() => definirZoom((z) => Math.max(0, z - 1))} icone="menos" />
          <span>{Math.round(ZOOMS[zoom]! * 100)}%</span>
          <IconButton aria-label="Aumentar" disabled={zoom === ZOOMS.length - 1} onClick={() => definirZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} icone="somar" />
        </div>}
        <IconButton aria-label="Fechar" onClick={aoFechar} icone="xis" />
      </div>
    </header>
    <div className="corpo-do-ampliado">
      {artefato?.tipo === 'png' && <img className="imagem-ampliada" src={urlDaImagem(visual.id)} alt={artefato.descricao} width={artefato.largura} height={artefato.altura} />}
      {artefato?.tipo === 'mermaid' && <div className="rolagem-do-diagrama"><div className="escala-do-diagrama" style={{ zoom: ZOOMS[zoom] }}>
        <DiagramaMermaid id={`${visual.id}-grande`} codigo={artefato.codigo} nos={artefato.nos} aoCitar={(ancora) => { aoFechar(); aoCitar(ancora); }} />
      </div></div>}
      {!artefato && <p className={visual.estado === 'falhou' ? 'erro-do-visual' : 'estado-do-visual'}>{visual.estado === 'falhou' ? visual.motivo : estadoEmPalavras(visual)}</p>}
    </div>
    <footer className="rodape-do-ampliado">
      {artefato?.tipo === 'png' && <p className="descricao-do-visual">{artefato.descricao}</p>}
      {artefato?.tipo === 'mermaid' && artefato.nos.some((no) => no.ancora) && <p className="descricao-do-visual">Clique numa ideia com contorno para ir ao trecho.</p>}
      {visual.pedido && <p className="pedido-do-visual">Pedido: {visual.pedido}</p>}
      {visual.diagnosticos.filter((d) => d.codigo !== 'adiado').length > 0 && <details className="diagnosticos-do-visual"><summary>Avisos ({visual.diagnosticos.length})</summary>
        <ul>{visual.diagnosticos.map((d, i) => <li key={`${d.codigo}-${String(i)}`}>{d.mensagem}</li>)}</ul></details>}
      {refazendo ? <form className="formulario refazer-visual" onSubmit={(e) => { e.preventDefault(); executar(async () => { await aoRegenerar(serie.atual, pedido.trim() === '' ? null : pedido); refazer(false); }); }}>
        <label><span>Novo pedido <span className="opcional">(opcional)</span></span><Textarea value={pedido} maxLength={2000} onChange={(e) => definirPedido(e.target.value)} /></label>
        <div className="acoes-pessoais"><Button type="submit" variante="primario" disabled={ocupado}>Gerar nova versão</Button><Button type="button" variante="ghost" onClick={() => refazer(false)}>Cancelar</Button></div>
      </form> : <div className="acoes-pessoais">
        <Button type="button" disabled={ocupado || serie.atual.estado === 'pendente' || serie.atual.estado === 'executando'} onClick={() => refazer(true)}>Gerar de novo</Button>
        {confirmar ? <><Button type="button" variante="primario" disabled={ocupado} onClick={() => executar(async () => { await aoApagar(visual); })}>Excluir esta versão</Button><Button type="button" variante="ghost" onClick={() => pedirConfirmacao(false)}>Manter</Button></>
          : <Button type="button" variante="ghost" disabled={ocupado} onClick={() => pedirConfirmacao(true)}>Excluir…</Button>}
      </div>}
      {erro && <p className="erro-do-visual" role="alert">{erro}</p>}
    </footer>
  </div></div>;
}
