/**
 * Sessão de resolução de um exercício (J34): o recorte, o enunciado que o Codex leu e os itens, um de
 * cada vez: a ideia e os passos revelados um a um (para o leitor tentar antes de ver), o último deles já
 * como a resposta; só então o próximo item. Os botões (anterior, próximo, todos) ficam fixos no rodapé,
 * num grupo de ícones como o das marcas, e respondem também a → e Espaço (← esconde o último passo). Embaixo, perguntas sobre a resolução
 * ("não entendi o passo 2"), cada uma respondida numa chamada nova.
 *
 * A janela pode ser barra lateral, flutuante ao lado do exercício ou tela cheia (`janela.ts`).
 *
 * Tudo o que vem do modelo é texto; as fórmulas (`$…$`, `$$…$$`, prompt @2) passam pelo KaTeX e pelo
 * DOMPurify (`Matematica.tsx`). Nada vai para `innerHTML`.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as EventoDeTecla, type PointerEvent as EventoDePonteiro, type ReactNode } from 'react';
import type { ItemDaResolucaoV1, PassoDaResolucaoV1 } from '@margem/contratos';
import { obterResolucao, perguntarNaResolucao, resolverExercicio, tentarDeNovo, type SessaoDaApi } from '../../biblioteca/api';
import { Button, IconButton, SegmentedControl } from '../../ui/Primitives';
import { Icon } from '../../ui/Icon';
import { digitando } from '../teclado/comandos';
import { LinhasDoCalculo, TextoComMatematica } from './Matematica';
import { avancar, mostrarTodos, nomeDoItem, passosDoItem, progressoInicial, proximaAcao, recuar, type Progresso } from './progresso';
import { caixaDoRecorte, formaGuardada, guardarForma, guardarTamanho, larguraLateral, posicaoFlutuante, tamanhoFlutuante, tamanhoGuardado, type FormaDaJanela, type TamanhoDaJanela } from './janela';
import ThoughtLine from '../../ui/pensando/ThoughtLine';

export interface FontesDaSessao {
  obter: typeof obterResolucao;
  perguntar: typeof perguntarNaResolucao;
  tentarDeNovo: typeof tentarDeNovo;
  /** Manda ao Codex um exercício pendente (vindo da descoberta do livro). */
  resolver?: typeof resolverExercicio;
}
export const FONTES_DA_SESSAO: FontesDaSessao = { obter: obterResolucao, perguntar: perguntarNaResolucao, tentarDeNovo, resolver: resolverExercicio };
const INTERVALO_MS = 2500;
/** A mesma classe da leitura guiada: o leitor já sabe abrir espaço à direita para uma barra. */
const CLASSE_DA_BARRA = 'com-leitura-guiada';
const CLASSE_DA_SESSAO = 'com-resolucao';
const TELA_LARGA = '(min-width: 900px)';

const OPCOES_DA_JANELA = [
  { valor: 'lateral', rotulo: <Icon name="janela-lateral" size={18} />, nome: 'Barra lateral', dica: 'Barra lateral' },
  { valor: 'flutuante', rotulo: <Icon name="janela-flutuante" size={18} />, nome: 'Janela ao lado do exercício', dica: 'Janela ao lado do exercício (arraste pelo topo)' },
  { valor: 'tela-cheia', rotulo: <Icon name="tela-cheia" size={18} />, nome: 'Tela cheia', dica: 'Tela cheia' },
] as const;

function usarTelaLarga(): boolean {
  const [larga, definir] = useState(() => typeof matchMedia === 'function' && matchMedia(TELA_LARGA).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const consulta = matchMedia(TELA_LARGA);
    const mudar = () => definir(consulta.matches);
    consulta.addEventListener('change', mudar);
    return () => consulta.removeEventListener('change', mudar);
  }, []);
  return larga;
}

export function SessaoDeResolucao({ id, aoFechar, fontes = FONTES_DA_SESSAO, intervaloMs = INTERVALO_MS }: { id: string; aoFechar: () => void; fontes?: FontesDaSessao; intervaloMs?: number }): ReactNode {
  const [sessao, definirSessao] = useState<SessaoDaApi | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [pergunta, definirPergunta] = useState('');
  const [enviando, enviar] = useState(false);
  const [progresso, definirProgresso] = useState<Progresso | null>(null);
  const [formaEscolhida, escolherForma] = useState<FormaDaJanela>(formaGuardada);
  const larga = usarTelaLarga();
  // No celular a janela é a folha de baixo; a tela cheia vale nos dois.
  const forma: FormaDaJanela = !larga && formaEscolhida === 'flutuante' ? 'lateral' : formaEscolhida;
  const [posicao, posicionar] = useState<{ left: number; top: number } | null>(null);
  const [tamanho, redimensionar] = useState<TamanhoDaJanela>(tamanhoGuardado);
  const [perguntando, abrirPergunta] = useState(false);
  const campoDaPergunta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (perguntando) campoDaPergunta.current?.focus({ preventScroll: true }); }, [perguntando]);
  const janela = useRef<HTMLElement>(null);
  const corpo = useRef<HTMLDivElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => { fechar.current?.focus({ preventScroll: true }); }, []);

  // Na barra lateral, no computador, a sessão fica ao lado do texto, como a leitura guiada: o texto se recentra no que sobra.
  useEffect(() => {
    const raiz = document.documentElement;
    if (forma !== 'lateral' || !larga || raiz.classList.contains(CLASSE_DA_BARRA)) return;
    raiz.classList.add(CLASSE_DA_BARRA, CLASSE_DA_SESSAO);
    return () => {
      raiz.classList.remove(CLASSE_DA_BARRA, CLASSE_DA_SESSAO);
      raiz.style.removeProperty('--largura-guiada');
    };
  }, [forma, larga]);
  const larguraDaBarra = larga ? larguraLateral(tamanho.lateral) : null;
  useEffect(() => {
    const raiz = document.documentElement;
    if (forma !== 'lateral' || larguraDaBarra === null || !raiz.classList.contains(CLASSE_DA_SESSAO)) return;
    raiz.style.setProperty('--largura-guiada', `${String(larguraDaBarra)}px`);
  }, [forma, larguraDaBarra]);

  // Puxar a borda esquerda da barra lateral, ou o canto da janela flutuante, muda o tamanho (e ele fica guardado).
  const puxando = useRef<{ x: number; y: number; lateral: number; largura: number; altura: number } | null>(null);
  const comecarAPuxar = (evento: EventoDePonteiro<HTMLElement>) => {
    if (evento.button !== 0) return;
    evento.preventDefault();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    const caixa = janela.current?.getBoundingClientRect();
    puxando.current = { x: evento.clientX, y: evento.clientY, lateral: larguraDaBarra ?? tamanho.lateral, largura: caixa?.width ?? 420, altura: caixa?.height ?? 560 };
    document.documentElement.classList.add('puxando-a-resolucao');
  };
  const puxar = (evento: EventoDePonteiro<HTMLElement>) => {
    const inicio = puxando.current;
    if (!inicio) return;
    const dx = evento.clientX - inicio.x;
    const dy = evento.clientY - inicio.y;
    redimensionar((atual) => forma === 'lateral'
      ? { ...atual, lateral: larguraLateral(inicio.lateral - dx) }
      : { ...atual, flutuante: tamanhoFlutuante(inicio.largura + dx, inicio.altura + dy, posicao ?? { left: 0, top: 0 }) });
  };
  const soltar = () => {
    if (!puxando.current) return;
    puxando.current = null;
    document.documentElement.classList.remove('puxando-a-resolucao');
    redimensionar((atual) => { guardarTamanho(atual); return atual; });
  };
  const puxarPeloTeclado = (evento: EventoDeTecla<HTMLElement>) => {
    const passo = evento.shiftKey ? 64 : 16;
    const sinal = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[evento.key as 'ArrowLeft'];
    if (sinal === undefined) return;
    evento.preventDefault();
    evento.stopPropagation();
    const horizontal = evento.key === 'ArrowLeft' || evento.key === 'ArrowRight';
    const caixa = janela.current?.getBoundingClientRect();
    const novo: TamanhoDaJanela = forma === 'lateral'
      ? (horizontal ? { ...tamanho, lateral: larguraLateral((larguraDaBarra ?? tamanho.lateral) - sinal * passo) } : tamanho)
      : { ...tamanho, flutuante: tamanhoFlutuante((caixa?.width ?? 420) + (horizontal ? sinal * passo : 0), (caixa?.height ?? 560) + (horizontal ? 0 : sinal * passo), posicao ?? { left: 0, top: 0 }) };
    redimensionar(novo);
    guardarTamanho(novo);
  };

  const carregar = useCallback(async () => {
    try { definirSessao(await fontes.obter(id)); definirErro(null); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível abrir a resolução.'); }
  }, [id, fontes]);
  useEffect(() => { void carregar(); }, [carregar]);
  // Enquanto o Codex trabalha, a sessão é consultada de novo de tempos em tempos.
  const trabalhando = sessao?.estado === 'resolvendo' || sessao?.estado === 'respondendo';
  useEffect(() => {
    if (!trabalhando) return;
    const relogio = setInterval(() => { void carregar(); }, intervaloMs);
    return () => clearInterval(relogio);
  }, [trabalhando, carregar, intervaloMs]);

  const resolucao = sessao?.resolucao.resolucao ?? null;
  const origem = sessao?.resolucao.origem;
  const falhou = sessao?.estado === 'falhou' ? sessao.jobs?.filter((job) => job.estado === 'falhou' || job.estado === 'cancelado').at(-1) : undefined;
  const itens = resolucao?.itens;
  // O progresso nasce com a resolução (e recomeça se ela mudar de tamanho, o que só acontece se for refeita).
  useEffect(() => {
    if (itens) definirProgresso((atual) => atual && atual.passos.length === itens.length ? atual : progressoInicial(itens));
  }, [itens]);

  // A janela flutuante nasce ao lado do exercício na página; depois, fica onde o leitor a deixar.
  const recorte = origem?.tipo === 'recorte' ? origem : null;
  const ondeEsta = recorte ? JSON.stringify([recorte.pagina, recorte.retangulo]) : '';
  useLayoutEffect(() => {
    if (forma !== 'flutuante') { posicionar(null); return; }
    const altura = janela.current?.getBoundingClientRect().height ?? 560;
    const [pagina, retangulo] = ondeEsta ? JSON.parse(ondeEsta) as [number, { x: number; y: number; largura: number; altura: number }] : [null, null];
    posicionar(posicaoFlutuante(pagina !== null && retangulo ? caixaDoRecorte(pagina, retangulo) : null, altura, undefined, tamanho.flutuante?.largura));
    // A posição nasce uma vez por forma e recorte; mudar o tamanho não a reposiciona.
  }, [forma, ondeEsta]);
  const arrasto = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const comecarArrasto = (evento: EventoDePonteiro<HTMLElement>) => {
    if (forma !== 'flutuante' || !posicao || evento.button !== 0 || (evento.target instanceof Element && evento.target.closest('button'))) return;
    evento.preventDefault();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    arrasto.current = { x: evento.clientX, y: evento.clientY, ...posicao };
  };
  const arrastar = (evento: EventoDePonteiro<HTMLElement>) => {
    const inicio = arrasto.current;
    if (!inicio) return;
    const caixa = janela.current?.getBoundingClientRect();
    const largura = caixa?.width ?? 420;
    posicionar({
      left: Math.max(8 - largura + 120, Math.min(window.innerWidth - 120, inicio.left + evento.clientX - inicio.x)),
      top: Math.max(0, Math.min(window.innerHeight - 48, inicio.top + evento.clientY - inicio.y)),
    });
  };
  const soltarArrasto = () => { arrasto.current = null; };

  const acao = itens && progresso ? proximaAcao(itens, progresso) : null;
  const seguir = useCallback(() => { if (itens) definirProgresso((atual) => atual && avancar(itens, atual)); }, [itens]);
  const voltar = useCallback(() => { definirProgresso((atual) => atual && recuar(atual)); }, []);

  // Esc fecha (na volta do evento: um menu aberto por cima fecha primeiro e o consome).
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [aoFechar]);
  // → e Espaço avançam, ← recua: fora de campos de texto, de menus e de controles que usam as setas.
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (evento.defaultPrevented || evento.altKey || evento.ctrlKey || evento.metaKey || !itens || digitando(evento.target)) return;
      if (document.querySelector('.ui-veu, .ui-popover')) return;
      const alvo = evento.target instanceof Element ? evento.target : null;
      if (alvo?.closest('[role=radiogroup], [role=listbox], [role=combobox], [role=slider]')) return;
      if (evento.key === ' ' && alvo?.closest('button, a, summary, [role=button]')) return;
      if (evento.key === 'ArrowRight' || evento.key === ' ') { evento.preventDefault(); evento.stopImmediatePropagation(); seguir(); }
      else if (evento.key === 'ArrowLeft') { evento.preventDefault(); evento.stopImmediatePropagation(); voltar(); }
    };
    window.addEventListener('keydown', teclar, true);
    return () => window.removeEventListener('keydown', teclar, true);
  }, [itens, seguir, voltar]);

  // O que acabou de aparecer entra na área visível do painel, sem pular.
  const chaveDoProgresso = progresso ? `${String(progresso.atual)}:${progresso.passos.join(',')}` : '';
  useEffect(() => {
    if (!chaveDoProgresso) return;
    const ultimo = [...(corpo.current?.querySelectorAll('.item-da-resolucao[data-atual] .surgiu') ?? [])].at(-1) ?? corpo.current?.querySelector('.item-da-resolucao[data-atual]');
    const reduzir = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (ultimo instanceof HTMLElement && typeof ultimo.scrollIntoView === 'function') ultimo.scrollIntoView({ block: 'nearest', behavior: reduzir ? 'auto' : 'smooth' });
  }, [chaveDoProgresso]);

  const mudarForma = (valor: string) => { const nova = valor as FormaDaJanela; escolherForma(nova); guardarForma(nova); };
  const opcoes = larga ? OPCOES_DA_JANELA : OPCOES_DA_JANELA.filter((opcao) => opcao.valor !== 'flutuante');
  const proximo = itens && progresso ? itens[progresso.atual + 1] : undefined;

  return <aside ref={janela} className="sessao-de-resolucao" data-janela={forma} role="dialog" aria-modal="false" aria-label="Resolução do exercício"
    style={forma === 'flutuante' && posicao ? { left: posicao.left, top: posicao.top, ...(tamanho.flutuante ? { width: tamanho.flutuante.largura, height: tamanho.flutuante.altura } : {}) }
      : forma === 'lateral' && larguraDaBarra !== null ? { width: larguraDaBarra } : undefined}>
    {larga && forma !== 'tela-cheia' && <div className={forma === 'lateral' ? 'alca-da-resolucao lateral' : 'alca-da-resolucao canto'}
      role="separator" aria-orientation={forma === 'lateral' ? 'vertical' : undefined} aria-label={forma === 'lateral' ? 'Largura da barra (arraste ou use as setas)' : 'Tamanho da janela (arraste ou use as setas)'}
      tabIndex={0} onPointerDown={comecarAPuxar} onPointerMove={puxar} onPointerUp={soltar} onPointerCancel={soltar} onKeyDown={puxarPeloTeclado} />}
    <header className="cabeca-da-resolucao" onPointerDown={comecarArrasto} onPointerMove={arrastar} onPointerUp={soltarArrasto} onPointerCancel={soltarArrasto}>
      <span className="eyebrow">Resolução{origem?.tipo === 'recorte' ? ` · p. ${String(origem.pagina)}` : ''}</span>
      <div className="controles-da-janela">
        <SegmentedControl rotulo="Forma da janela" className="forma-da-janela" valor={forma} opcoes={opcoes} aoMudar={mudarForma} />
        <IconButton ref={fechar} aria-label="Fechar resolução" onClick={aoFechar}>×</IconButton>
      </div>
    </header>
    <div ref={corpo} className="corpo-da-resolucao">
      {erro && <p className="aviso-estudo" role="alert">{erro}</p>}
      {origem?.tipo === 'recorte' && <ImagemDoRecorte id={id} />}
      {origem?.tipo === 'trecho' && <blockquote className="trecho-da-resolucao">{origem.ancora.citacao}</blockquote>}
      {sessao?.estado === 'resolvendo' && <div className="estado-da-resolucao pensando"><ThoughtLine label="Resolvendo o exercício…" collapsible={false} fontSize={15} color="var(--texto-1)" glyphColor="var(--accent)" /></div>}
      {sessao?.estado === 'pendente' && fontes.resolver && <p className="estado-da-resolucao">Este exercício está na lista do livro e ainda não foi ao Codex.
        <Button variante="ghost" onClick={() => { void fontes.resolver?.(id).then((nova) => definirSessao(nova), (falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível pedir a resolução.')); }}>Resolver agora</Button></p>}
      {falhou && <p className="estado-da-resolucao" role="alert">Não deu certo desta vez. <Button variante="ghost" onClick={() => { void fontes.tentarDeNovo(falhou.id).then(carregar); }}>Tentar de novo</Button></p>}
      {resolucao && progresso && <>
        {/* O enunciado é a própria foto do recorte (ou o trecho citado): sem repeti-lo em texto. Só avisa quando o Codex não leu bem. */}
        {(resolucao.legibilidade !== 'boa' || resolucao.observacao) && <p className="aviso-de-leitura" role="note">
          {resolucao.legibilidade !== 'boa' && <>O Codex teve dificuldade para ler o recorte (legibilidade {resolucao.legibilidade}). </>}
          {resolucao.observacao && <TextoComMatematica texto={resolucao.observacao} />}
        </p>}
        {resolucao.itens.slice(0, progresso.atual + 1).map((item, indice) => <ItemResolvido key={`${String(indice)}-${item.rotulo}`} item={item}
          atual={indice === progresso.atual} passos={progresso.passos[indice] ?? 0} />)}
        {proximo && <p className="proximo-item">Depois: item {nomeDoItem(proximo, progresso.atual + 1)}{resolucao.itens.length > progresso.atual + 2 ? ` e mais ${String(resolucao.itens.length - progresso.atual - 2)}` : ''}</p>}
      </>}
      {sessao && sessao.resolucao.mensagens.length > 0 && <section className="perguntas-da-resolucao" aria-label="Perguntas sobre a resolução">
        {sessao.resolucao.mensagens.map((mensagem) => mensagem.autor === 'leitor'
          ? <p key={mensagem.id} className="pergunta-do-leitor">{mensagem.texto}</p>
          : <div key={mensagem.id} className="resposta-do-professor">
            <p><TextoComMatematica texto={mensagem.texto} /></p>
            {mensagem.passos.length > 0 && <ol className="passos-da-resolucao todos">{mensagem.passos.map((passo, posicao) => <Passo key={posicao} passo={passo} />)}</ol>}
          </div>)}
      </section>}
      {sessao?.estado === 'respondendo' && <div className="estado-da-resolucao pensando"><ThoughtLine label="Pensando na resposta…" collapsible={false} fontSize={15} color="var(--texto-1)" glyphColor="var(--accent)" /></div>}
    </div>
    {resolucao && <footer className="rodape-da-resolucao">
      {acao && itens && progresso && <div className="avanco-da-resolucao">
        <span className="grupos-do-avanco">
          <span className="grupo-de-icones" role="group" aria-label="Perguntar e ver tudo">
            <IconButton aria-label="Perguntar sobre um passo" title="Perguntar sobre um passo" aria-expanded={perguntando} aria-pressed={perguntando}
              className={perguntando ? 'aberto' : undefined} onClick={() => abrirPergunta((aberto) => !aberto)}>
              <Icon name="comentario" size={16} />
            </IconButton>
            <IconButton aria-label="Mostrar todos os passos" title="Mostrar todos os passos" disabled={acao.tipo !== 'passo'} onClick={() => definirProgresso(mostrarTodos(itens, progresso))}>
              <Icon name="passo-a-passo" size={16} />
            </IconButton>
          </span>
          <span className="grupo-de-icones" role="group" aria-label="Passos da resolução">
            <IconButton aria-label="Passo anterior" title="Passo anterior  ←" aria-keyshortcuts="ArrowLeft" disabled={(progresso.passos[progresso.atual] ?? 0) === 0} onClick={voltar}>
              <Icon name="anterior" size={18} />
            </IconButton>
            <IconButton className="proximo-passo" aria-label={acao.rotulo} title={`${acao.rotulo}  → ou Espaço`} aria-keyshortcuts="ArrowRight Space" disabled={acao.tipo === 'fim'} onClick={seguir}>
              <Icon name="proximo" size={18} />
            </IconButton>
          </span>
        </span>
        <span className="onde-esta" aria-live="polite">{posicaoNaResolucao(itens, progresso)}</span>
      </div>}
      {(perguntando || !itens) && <form className="pergunta-sobre-a-resolucao" onSubmit={(evento) => {
        evento.preventDefault();
        const texto = pergunta.trim();
        if (texto === '' || enviando) return;
        enviar(true);
        void fontes.perguntar(id, texto).then((nova) => { definirSessao(nova); definirPergunta(''); }, (falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível perguntar.'))
          .finally(() => enviar(false));
      }}>
        <textarea ref={campoDaPergunta} aria-label="Pergunta sobre a resolução" rows={2} value={pergunta} placeholder="Não entendeu um passo? Pergunte aqui…"
          disabled={trabalhando} onChange={(evento) => definirPergunta(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter' && (evento.metaKey || evento.ctrlKey)) evento.currentTarget.form?.requestSubmit();
            // Esc fecha só a caixa da pergunta, não a resolução.
            if (evento.key === 'Escape' && itens) { evento.stopPropagation(); abrirPergunta(false); }
          }} />
        <Button type="submit" disabled={trabalhando || enviando || pergunta.trim() === ''}>Perguntar</Button>
      </form>}
    </footer>}
  </aside>;
}

/** Um item: a ideia e os passos à mostra; o último passo é a resposta (sem passos, a resposta é o único). */
function ItemResolvido({ item, atual, passos }: { item: ItemDaResolucaoV1; atual: boolean; passos: number }): ReactNode {
  const lista: PassoDaResolucaoV1[] = item.passos.length > 0 ? item.passos : [{ texto: item.resposta, calculo: null }];
  const completo = passos >= lista.length;
  return <section className="item-da-resolucao" data-atual={atual ? '' : undefined} aria-label={item.rotulo ? `Item ${item.rotulo}` : 'Exercício'}>
    {item.rotulo && <h3><span className="rotulo-do-item">Item {item.rotulo}</span></h3>}
    <p className="estrategia"><span className="eyebrow">Ideia</span><TextoComMatematica texto={item.estrategia} /></p>
    {passos > 0 && <ol className="passos-da-resolucao">{lista.slice(0, passos).map((passo, posicao) => <Passo key={posicao} passo={passo} novo final={posicao === lista.length - 1} />)}</ol>}
    {completo && item.verificacao && <p className="verificacao-do-item surgiu"><span className="eyebrow">Conferindo</span><TextoComMatematica texto={item.verificacao} /></p>}
  </section>;
}

/** "Passo 3 de 7", "Item a completo", "Completo": onde a resolução está, ao lado dos botões. */
function posicaoNaResolucao(itens: readonly ItemDaResolucaoV1[], progresso: Progresso): string {
  const item = itens[progresso.atual];
  const total = passosDoItem(item);
  const vistos = progresso.passos[progresso.atual] ?? 0;
  const nome = itens.length > 1 ? `item ${nomeDoItem(item, progresso.atual)} · ` : '';
  if (vistos < total) return `${nome}passo ${String(vistos)} de ${String(total)}`.replace(/^./, (letra) => letra.toUpperCase());
  return progresso.atual < itens.length - 1 ? `Item ${nomeDoItem(item, progresso.atual)} completo` : 'Completo';
}

function Passo({ passo, novo = false, final = false }: { passo: PassoDaResolucaoV1; novo?: boolean; final?: boolean }): ReactNode {
  return <li className={['passo-da-resolucao', novo && 'surgiu', final && 'passo-final'].filter(Boolean).join(' ')} aria-label={final ? 'Resposta' : undefined}>
    <p><TextoComMatematica texto={passo.texto} /></p>
    {passo.calculo && <p className="calculo"><LinhasDoCalculo calculo={passo.calculo} /></p>}
  </li>;
}

/** O PNG do recorte, buscado pelo `fetch` como o resto da API (e não por `src` direto). */
function ImagemDoRecorte({ id }: { id: string }): ReactNode {
  const [url, definirUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    let criada: string | null = null;
    void fetch(`/api/resolucoes/${id}/imagem`).then(async (resposta) => {
      if (!resposta.ok || !vivo) return;
      criada = URL.createObjectURL(await resposta.blob());
      if (vivo) definirUrl(criada); else URL.revokeObjectURL(criada);
    }).catch(() => undefined);
    return () => { vivo = false; if (criada) URL.revokeObjectURL(criada); };
  }, [id]);
  return url ? <img className="imagem-do-recorte" src={url} alt="O exercício recortado da página" /> : <div className="imagem-do-recorte vazia" aria-hidden="true" />;
}
