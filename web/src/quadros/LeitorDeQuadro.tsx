/**
 * O leitor de um quadro (`/quadros/<slug>`), na casca do leitor do Margem: a barra de leitura (voltar só
 * com ícone, o título no centro, as ações à direita e o painel), a pintura no palco com zoom e arrasto e
 * a pílula de zoom no canto (como no PDF), as regiões da análise desenhadas sobre ela, o painel direito
 * (Info, Análise, Fontes) e, embaixo, o player central: a análise curta com a câmera e a legenda em
 * karaokê, ou o Percorrer das afirmações.
 *
 * Teclado: Espaço toca a análise curta; P percorre; ← → dentro do player ou do Percorrer; Esc fecha;
 * [ as regiões; ] o painel; + − 0 o zoom; R os contornos; C a legenda.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AfirmacaoDaObra, RetanguloDaObra } from '@margem/contratos';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Primitives';
import { BotaoDaBarra, Separador } from '../leitor/BarraDoLeitor';
import { campoEmEdicao, guardarPreferencia, preferencia } from '../biblioteca/Lista';
import type { Rota } from '../biblioteca/rotas';
import { arquivoDaNarracaoDoQuadro, marcarQuadroVisto, obterAnaliseDoQuadro, obterNarracaoDoQuadro, obterQuadro } from './api';
import { enquadrar, nivelDeZoom, QUADRO_INTEIRO } from './camera';
import { montarLinhaDoTempo } from './linha-do-tempo';
import { PainelDoQuadro } from './PainelDoQuadro';
import { PalcoDoQuadro, type ApiDoPalco } from './PalcoDoQuadro';
import { PercorrerDoQuadro } from './PercorrerDoQuadro';
import { PlayerDoQuadro } from './PlayerDoQuadro';
import { afirmacoesEmOrdem } from './rotulos';
import type { AnaliseDoQuadro, DetalheDoQuadro, ManifestoDaNarracao } from './tipos';
import '../leitor/barra.css';
import '../leitor/painel.css';
import '../leitor/player/player-central.css';
import '../leitor/karaoke/karaoke.css';
import './quadros.css';

type Modo = 'olhar' | 'player' | 'percorrer';
const SEM_ACESAS: ReadonlySet<string> = new Set();

export function LeitorDeQuadro({ slug, ir }: { slug: string; ir: (destino: Rota, substituir?: boolean) => void }): ReactNode {
  const [detalhe, definirDetalhe] = useState<DetalheDoQuadro | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [tentativa, tentar] = useState(0);
  const [analise, definirAnalise] = useState<AnaliseDoQuadro | null>(null);
  const [carregandoAnalise, carregarAnalise] = useState(false);
  const [manifesto, definirManifesto] = useState<ManifestoDaNarracao | null>(null);
  const [modo, definirModo] = useState<Modo>('olhar');
  const [tocarAoAbrir, definirTocarAoAbrir] = useState(false);
  const [seguir, definirSeguir] = useState(true);
  const [batida, definirBatida] = useState(0);
  const [percorrido, definirPercorrido] = useState(0);
  const [escolhida, escolher] = useState<string | null>(null);
  const [passando, passar] = useState<string[] | null>(null);
  const [painel, abrirPainel] = useState(() => window.innerWidth >= 1000 && preferencia('margem:quadro:painel', true));
  const [regioesAbertas, abrirRegioes] = useState(false);
  const [contornos, mostrarContornos] = useState(() => preferencia('margem:quadro:contornos', true));
  const [legenda, mostrarLegenda] = useState(() => preferencia('margem:quadro:legenda', true));
  const [zoom, definirZoom] = useState(1);
  const palco = useRef<ApiDoPalco>(null);

  useEffect(() => {
    let vivo = true;
    definirErro(null);
    obterQuadro(slug).then((d) => { if (!vivo) return; definirDetalhe(d); definirAnalise(d.analise); marcarQuadroVisto(slug); },
      (e: unknown) => { if (vivo) definirErro(e instanceof Error && e.message === 'obra_inexistente' ? 'Este quadro não está no acervo.' : 'Não foi possível abrir o quadro.'); });
    return () => { vivo = false; };
  }, [slug, tentativa]);

  // A narração da análise, quando houver; sem ela, o ritmo de leitura.
  useEffect(() => {
    let vivo = true;
    definirManifesto(null);
    if (analise?.audio) void obterNarracaoDoQuadro(slug, analise.rotulo).then((m) => { if (vivo) definirManifesto(m); }, () => {});
    return () => { vivo = false; };
  }, [slug, analise]);

  const linha = useMemo(() => (analise ? montarLinhaDoTempo(analise.curta, manifesto) : null), [analise, manifesto]);
  const itens = useMemo(() => (analise ? afirmacoesEmOrdem(analise.modelo) : []), [analise]);
  const regioesDe = useCallback((afirmacao: AfirmacaoDaObra | null | undefined) => afirmacao?.regioes ?? [], []);

  const escolherAnalise = (rotulo: string) => {
    if (!detalhe || rotulo === analise?.rotulo) return;
    carregarAnalise(true);
    obterAnaliseDoQuadro(slug, rotulo).then((a) => { definirAnalise(a); definirModo('olhar'); escolher(null); palco.current?.irPara(QUADRO_INTEIRO); }, () => {}).finally(() => carregarAnalise(false));
  };

  const fecharModo = useCallback(() => { definirModo('olhar'); definirSeguir(true); definirTocarAoAbrir(false); }, []);
  const abrirPlayer = useCallback((tocar: boolean) => { definirTocarAoAbrir(tocar); definirSeguir(true); definirModo('player'); if (window.innerWidth < 800) abrirPainel(false); }, []);
  const moverPercorrer = useCallback((indice: number) => {
    const alvo = itens[indice];
    definirPercorrido(indice);
    if (!alvo || !analise) return;
    escolher(alvo.id);
    const formas = alvo.regioes.map((id) => analise.modelo.regioes.find((r) => r.id === id)?.forma).filter((f) => f !== undefined);
    palco.current?.irPara(formas.length ? enquadrar(formas) : QUADRO_INTEIRO);
  }, [itens, analise]);
  const abrirPercorrer = useCallback((inicio?: string | null) => {
    const i = Math.max(0, inicio ? itens.findIndex((a) => a.id === inicio) : 0);
    definirModo('percorrer');
    if (window.innerWidth < 800) abrirPainel(false);
    moverPercorrer(i);
  }, [itens, moverPercorrer]);

  const escolherAfirmacao = (a: AfirmacaoDaObra) => {
    if (modo === 'percorrer') { const i = itens.findIndex((x) => x.id === a.id); if (i >= 0) { moverPercorrer(i); return; } }
    if (modo === 'player') fecharModo();
    escolher((atual) => (atual === a.id ? null : a.id));
    if (escolhida === a.id) return;
    const formas = a.regioes.map((id) => analise?.modelo.regioes.find((r) => r.id === id)?.forma).filter((f) => f !== undefined);
    if (formas.length) palco.current?.irPara(enquadrar(formas));
  };
  const escolherRegiao = (id: string) => {
    if (!analise) return;
    const primeira = itens.find((a) => a.regioes.includes(id));
    if (modo === 'percorrer' && primeira) { moverPercorrer(itens.indexOf(primeira)); return; }
    if (modo === 'player') fecharModo();
    const regiao = analise.modelo.regioes.find((r) => r.id === id);
    if (regiao) palco.current?.irPara(enquadrar([regiao.forma]));
    escolher(primeira?.id ?? null);
    if (primeira && !painel && window.innerWidth >= 800) abrirPainel(true);
  };

  const alternarPainel = useCallback(() => abrirPainel((v) => { guardarPreferencia('margem:quadro:painel', !v); return !v; }), []);
  const alternarContornos = useCallback(() => mostrarContornos((v) => { guardarPreferencia('margem:quadro:contornos', !v); return !v; }), []);
  const alternarLegenda = useCallback(() => mostrarLegenda((v) => { guardarPreferencia('margem:quadro:legenda', !v); return !v; }), []);
  const voltar = () => { if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) window.history.back(); else ir({ nome: 'biblioteca', tipo: 'quadros' }); };

  // Atalhos da página; os do player e do Percorrer (Espaço, ← →, Esc, C) moram neles.
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (campoEmEdicao(evento.target) || document.querySelector('[aria-modal=true], .ui-listbox') || evento.altKey || evento.metaKey) return;
      const tecla = evento.key;
      const comCtrl = evento.ctrlKey;
      if (['+', '='].includes(tecla)) { evento.preventDefault(); definirSeguir(false); palco.current?.zoom(1.5); return; }
      if (tecla === '-' || tecla === '_') { evento.preventDefault(); definirSeguir(false); palco.current?.zoom(1 / 1.5); return; }
      if (tecla === '0') { evento.preventDefault(); definirSeguir(false); palco.current?.irPara(QUADRO_INTEIRO); return; }
      if (comCtrl) return;
      if (tecla === ']') { evento.preventDefault(); alternarPainel(); }
      else if (tecla === '[') { evento.preventDefault(); abrirRegioes((v) => !v); }
      else if (tecla.toLowerCase() === 'r') { evento.preventDefault(); alternarContornos(); }
      else if (modo === 'olhar') {
        if (tecla === ' ' || tecla.toLowerCase() === 'k') { evento.preventDefault(); abrirPlayer(true); }
        else if (tecla.toLowerCase() === 'p') { evento.preventDefault(); abrirPercorrer(escolhida); }
        else if (tecla === 'Escape') { if (escolhida) { escolher(null); palco.current?.irPara(QUADRO_INTEIRO); } else if (regioesAbertas) abrirRegioes(false); }
      } else if (tecla.toLowerCase() === 'p') { evento.preventDefault(); if (modo === 'percorrer') fecharModo(); else abrirPercorrer(escolhida); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [modo, escolhida, regioesAbertas, abrirPlayer, abrirPercorrer, fecharModo, alternarPainel, alternarContornos]);

  if (erro) return <div className="leitor-de-quadro estado-do-quadro"><p role="alert">{erro}</p><button type="button" className="ui-button ui-secundario" onClick={() => tentar((n) => n + 1)}>Tentar novamente</button></div>;
  if (!detalhe || !analise || !linha) return <div className="leitor-de-quadro estado-do-quadro"><p role="status">Abrindo o quadro…</p></div>;

  const m = analise.modelo;
  const escolhidaAtual = m.afirmacoes.find((a) => a.id === escolhida) ?? null;
  const batidaAtual = linha.batidas[batida]?.batida;
  const acesas = new Set<string>([
    ...(passando ?? []),
    ...regioesDe(escolhidaAtual),
    ...(modo === 'player' && batidaAtual ? [...(batidaAtual.regiao_id ? [batidaAtual.regiao_id] : [])] : []),
  ]);
  const titulo = `${m.identidade.titulo}`;
  const aoCamera = (c: RetanguloDaObra) => palco.current?.definir(c);

  return <div className="leitor-de-quadro" data-painel={painel ? '' : undefined} data-regioes={regioesAbertas ? '' : undefined} data-modo={modo}>
    <nav className="filtros barra-do-leitor barra-do-quadro" aria-label="Barra do quadro">
      <div className="barra-grupo barra-esquerda">
        <a className="ui-button ui-ghost ui-icon botao-da-barra voltar-da-barra" href="/biblioteca?tipo=quadros" aria-label="Voltar à biblioteca" data-dica="Voltar"
          onClick={(evento) => { evento.preventDefault(); voltar(); }}><Icon name="voltar" /></a>
        <BotaoDaBarra rotulo="Regiões" atalho="[" icone="painel-esquerdo" aria-expanded={regioesAbertas} onClick={() => abrirRegioes(!regioesAbertas)} />
      </div>
      <div className="barra-grupo barra-centro titulo-do-quadro"><span className="titulo">{titulo}</span><span className="autor">{m.identidade.artista} · {m.identidade.data}</span></div>
      <div className="barra-grupo barra-direita">
        <BotaoDaBarra rotulo={modo === 'player' ? 'Fechar a análise curta' : 'Análise curta'} atalho="Espaço" icone="tocar" aria-pressed={modo === 'player'} onClick={() => (modo === 'player' ? fecharModo() : abrirPlayer(true))} />
        <BotaoDaBarra rotulo="Percorrer as afirmações" atalho="P" icone="percorrer" aria-pressed={modo === 'percorrer'} disabled={itens.length === 0} onClick={() => (modo === 'percorrer' ? fecharModo() : abrirPercorrer(escolhida))} />
        <BotaoDaBarra rotulo={contornos ? 'Esconder as regiões' : 'Mostrar as regiões'} atalho="R" icone="area" aria-pressed={contornos} onClick={alternarContornos} />
        <Separador />
        <BotaoDaBarra rotulo="Painel do quadro" atalho="]" icone="painel-direito" aria-expanded={painel} onClick={alternarPainel} />
      </div>
    </nav>

    {regioesAbertas && <aside className="painel-esquerdo regioes-do-painel" aria-label="Regiões do quadro">
      <div className="painel-esquerdo-cabeca"><span className="painel-esquerdo-titulo">Regiões</span><IconButton aria-label="Fechar as regiões" onClick={() => abrirRegioes(false)}><Icon name="painel-esquerdo" size={18} /></IconButton></div>
      <div className="painel-esquerdo-conteudo"><ul className="lista-de-regioes">{m.regioes.map((r) => {
        const total = m.afirmacoes.filter((a) => a.regioes.includes(r.id)).length;
        return <li key={r.id}><button type="button" aria-pressed={acesas.has(r.id)} onClick={() => escolherRegiao(r.id)} onPointerEnter={() => passar([r.id])} onPointerLeave={() => passar(null)}>
          <span>{r.rotulo}</span><span className="acao-detalhe">{total === 1 ? '1 afirmação' : `${String(total)} afirmações`}</span>
        </button></li>;
      })}</ul>{m.regioes.length === 0 && <p className="painel-leitor-vazio">Esta análise não marcou regiões.</p>}</div>
    </aside>}

    <PalcoDoQuadro ref={palco} url={detalhe.imagem.url} titulo={`${m.identidade.titulo}, ${m.identidade.artista}`} largura={m.imagem.largura} altura={m.imagem.altura}
      regioes={m.regioes} acesas={acesas.size ? acesas : SEM_ACESAS} contornos={contornos}
      aoEscolherRegiao={escolherRegiao} aoPassarRegiao={(id) => passar(id ? [id] : null)}
      aoInteragir={() => { if (modo === 'player') definirSeguir(false); }} aoMudarZoom={definirZoom} />

    {modo === 'olhar' && <div className="pilula-de-leitura pilula-do-quadro" role="group" aria-label="Zoom do quadro">
      <IconButton aria-label="Diminuir zoom" data-dica="Diminuir" data-atalho="−" disabled={zoom <= 1.001} onClick={() => palco.current?.zoom(1 / 1.5)}><Icon name="menos" size={16} /></IconButton>
      <button type="button" className="zoom-atual" data-dica={zoom <= 1.001 ? 'Quadro inteiro' : 'Ver o quadro inteiro'} data-atalho={zoom <= 1.001 ? undefined : '0'}
        aria-label={`Zoom ${String(Math.round(zoom * 100))}%; ver o quadro inteiro`} aria-pressed={zoom <= 1.001} onClick={() => palco.current?.irPara(QUADRO_INTEIRO)}>{Math.round(zoom * 100)}%</button>
      <IconButton aria-label="Aumentar zoom" data-dica="Aumentar" data-atalho="+" disabled={zoom >= nivelDeZoom({ x: 0, y: 0, largura: 0.04, altura: 0.04 }) - 0.01} onClick={() => palco.current?.zoom(1.5)}><Icon name="somar" size={16} /></IconButton>
    </div>}

    {painel && <PainelDoQuadro detalhe={detalhe} analise={analise} carregandoAnalise={carregandoAnalise} duracao_s={linha.duracao_s} narrada={linha.narrada}
      afirmacaoEscolhida={escolhida} aoEscolherAnalise={escolherAnalise} aoEscolherAfirmacao={escolherAfirmacao}
      aoPassarAfirmacao={(a) => passar(a ? regioesDe(a) : null)} aoOuvir={() => abrirPlayer(true)} aoPercorrer={() => abrirPercorrer(escolhida)} aoFechar={alternarPainel} />}

    {modo === 'player' && <PlayerDoQuadro key={analise.rotulo + (manifesto ? ':voz' : '')} linha={linha} titulo={`Análise curta · ${analise.titulo}`}
      audio={analise.audio && manifesto ? arquivoDaNarracaoDoQuadro(slug, analise.rotulo) : null}
      aoCamera={aoCamera} seguir={seguir} aoSeguir={() => definirSeguir(true)} aoBatida={definirBatida}
      legenda={legenda} aoAlternarLegenda={alternarLegenda} tocarAoAbrir={tocarAoAbrir} aoFechar={fecharModo} />}
    {modo === 'percorrer' && <PercorrerDoQuadro itens={itens} indice={percorrido} modelo={m} aoMover={moverPercorrer} aoFechar={fecharModo} />}
  </div>;
}
