import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ProgressoNoLivro } from './ProgressoNoLivro';
import { PainelDoLeitor, type ConversasDoPainel, type ItemExtraDoCaderno } from './PainelDoLeitor';
import { Icon } from '../ui/Icon';
import { AtencaoNaBarra, BotaoDaBarra, OuvirNaBarra, PosicaoNaBarra, Separador, type AcaoDeOuvir, type PosicaoNaLeitura } from './BarraDoLeitor';
import { PainelEsquerdo, type VistaDoPainelEsquerdo } from './PainelEsquerdo';
import './painel.css';
import './barra.css';
import { PercorrerDestaques, type DestaqueNavegavel, type NavegacaoDeDestaques } from './NavegadorDeDestaques';
import { Button, Popover, SegmentedControl } from '../ui/Primitives';
import { usarFuncoes } from './ContextoDosModos';
import { desenhaMarca, dicaDoNivel, grifoNoTexto, filtrarSaliencia, NOMES_DOS_NIVEIS } from './f2';
import { NotasPessoais, type NotaPessoal } from './NotasPessoais';
import type { MarcaDoLeitor } from './f2';
import {
  lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type MutableRefObject, type RefObject, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode,
} from 'react';
import type { AncoraV1, Id } from '@margem/contratos';
import { Aparencia, PilulaDeLeitura } from './Aparencia';
import { proximoZoom } from './zoom';
import { usarAparencia } from './ContextoDeAparencia';
import { ProgressoDaRolagem } from './ProgressoDaRolagem';
import { MarginNotes, type AcoesDaNota } from './MarginNotes';
import { NumerosNaLateral, type ItemDaLateral } from './NumerosNaLateral';
import { NoteSheet } from './NoteSheet';
import { BalaoDaMarca, type FuncaoDoBalao } from './BalaoDaMarca';
import { ContextoDeDesfazer, usePilhaDeDesfazer } from './desfazer';
import { ancoraDoBloco, faixaDaAncora } from './compreensao/geometria';
import { atalhoDeUmaTeclaDesligado, blocosNavegaveis, digitando, vizinho, type Comando } from './teclado/comandos';
import { FocoDoParagrafo } from './teclado/FocoDoParagrafo';
import { PaletaDeComandos } from './teclado/PaletaDeComandos';
import { ListaDeAtalhos } from './teclado/ListaDeAtalhos';
import './teclado/teclado.css';
import { DocumentReader, usaPdf } from './DocumentReader';
import { useControlador } from './useControlador';
import { useTelaEstreita } from './hooks/useTelaEstreita';
import { useProgresso, type FontesDoProgresso, type ProgressoDoLeitor } from './hooks/useProgresso';
import {
  FILTRO_PADRAO, comMudanca, marcasFiltradas,
  notasDoCapitulo, origensPresentes,
  type FiltroDeMarcas, type MudancaDeMarca,
} from './notas';
import type { ApiDoLeitor, EstrategiaDeLayout, SnapshotCapitulo } from './tipos';

const MiniaturasDoPdf = lazy(() => import('./MiniaturasDoPdf').then((modulo) => ({ default: modulo.MiniaturasDoPdf })));

function gravarPainel(aberto: boolean): void {
  try { localStorage.setItem('margem:painel-leitor', aberto ? 'aberto' : 'fechado'); } catch { /* Sem storage, vale a sessão. */ }
}

/** Largura a partir da qual o painel do documento (400 px) cabe à direita do texto de 850 px centrado. */
const LARGURA_PARA_PAINEL_FIXO = 1700;
export type AtualizarMarca = (id: Id, mudanca: MudancaDeMarca) => Promise<MarcaDoLeitor | null>;

/** Os grifos do leitor e a troca de função (J37); sem elas, o leitor só avalia as marcas da IA. */
export interface EdicaoDoLeitor {
  criarGrifo: (ancora: AncoraV1, funcao: string) => Promise<MarcaDoLeitor>;
  apagarGrifo: (id: Id) => Promise<void>;
  trocarFuncao: (id: Id, funcao: string) => Promise<MarcaDoLeitor>;
  /** Refaz as etiquetas de um grifo recriado pelo desfazer. */
  etiquetar?: (marcaId: Id, nome: string) => Promise<void>;
}

export interface PropsDoControlador {
  relacoesParaNavegar?: readonly DestaqueNavegavel[];
  aoNavegarDestaques?: (estado: NavegacaoDeDestaques) => void;
  navegacaoSuspensa?: boolean;
  aoMudarMargem?: (disponivel: boolean) => void;
  leitorRef?: RefObject<ApiDoLeitor>;
  snapshot: SnapshotCapitulo;
  documento_id: Id;
  estrategia?: EstrategiaDeLayout;
  /** Sem fontes, o progresso vive só em `localStorage` (página `/dev/margem`, testes). */
  progresso?: FontesDoProgresso | undefined;
  atualizarMarca?: AtualizarMarca | undefined;
  /** Perguntas de recuperação da seção, quando a API as expõe (hoje ela não expõe). */
  perguntas?: readonly string[] | undefined;
  /** Avisa a biblioteca dos capítulos concluídos, para a árvore de seções mostrar o estado. */
  aoMudarCapitulos?: ((capitulos: readonly Id[]) => void) | undefined;
  limiarDaMargem?: number | undefined;
  atrasoDoCorredorMs?: number | undefined;
  atrasoDoProgressoMs?: number | undefined;
  aparenciaAberta?: boolean;
  navegacao?: ReactNode;
  /** Ações do balão da marca que dependem do estudo (anotar, perguntar, conectar); sem elas o balão só remove e etiqueta. */
  acoesDoBalao?: {
    anotar: (ancora: AncoraV1, marcaId: Id) => void;
    perguntar: (ancora: AncoraV1) => void;
    conectar: (ancora: AncoraV1) => void;
    flashcard?: (ancora: AncoraV1) => void;
  } | undefined;
  /** Abaixo do título, no texto único (autor e tempo de leitura). */
  abertura?: ReactNode;
  /** Chips a mais no topo do Caderno (a camada, quando há mais de uma). */
  filtrosDoCaderno?: ReactNode;
  /** Itens do Caderno que vêm do estudo: relações, exercícios, visuais. */
  extrasDoCaderno?: readonly ItemExtraDoCaderno[];
  /** Abaixo dos metadados do Info ("Primeiro eu", "Um caminho para a sua leitura"). */
  infoDoPainel?: ReactNode;
  /** A grade da aba Estudo do painel. */
  estudoDoPainel?: readonly AcaoDeOuvir[];
  /** Avisa quem envolve o leitor quando o painel do documento abre (os exercícios só são listados então). */
  aoMudarPainel?: (aberto: boolean) => void;
  /** O que entra no fim do popover da aparência (braquetes ou bolinhas, quando há relações). */
  aparenciaExtra?: ReactNode;
  /** Ações que ficam na própria barra, e não no menu `•••` (J31: estado da compreensão e leitura guiada). */
  acoesDaBarra?: ReactNode;
  menuExtra?: ReactNode;
  /** O voltar da barra (só o ícone ←, como no Readwise): o destino é a página do documento. */
  voltar?: { href: string; rotulo: string; aoVoltar: () => void } | undefined;
  /** O sumário do documento, no painel esquerdo (`[`). */
  sumario?: ReactNode;
  /** A posição no centro da barra, no texto corrido ("Cap. 3 de 10"); no PDF, a página vem do próprio leitor. */
  posicao?: PosicaoNaLeitura | undefined;
  /** Página fora do capítulo aberto (Shift J no PDF): quem conhece os capítulos abre o certo. */
  irParaPagina?: ((pagina: number) => void) | undefined;
  /** A página a mostrar assim que o capítulo desenhar (depois de um Shift J para outro capítulo). */
  paginaDestino?: number | null;
  /** O que o 🎧 da barra oferece (visita, leitura comentada, narração). */
  ouvir?: readonly AcaoDeOuvir[] | undefined;
  /** A ferramenta de área (⬚, Shift Ctrl S), onde houver página para recortar. */
  aoSelecionarArea?: (() => void) | undefined;
  avisoExtra?: ReactNode;
  painel?: ReactNode;
  tituloDocumento?: string;
  /** Ícone e nome do tipo (livro, texto, PDF, vídeo), para o Info do painel. */
  tipoDoDocumento?: { icone: string; rotulo: string };
  autor?: string;
  conversasDoPainel?: ConversasDoPainel | undefined;
  pessoaisDoCaderno?: readonly NotaPessoal[];
  /** Um estudo aberto ocupa a lateral: não empilhar o caderno e o fio/formulário. */
  estudoAberto?: boolean;
  pessoais?: readonly NotaPessoal[];
  edicao?: EdicaoDoLeitor | undefined;
  /** Recebe a função de grifar (o que o H faz), para um botão de fora usar o mesmo caminho. */
  grifarRef?: MutableRefObject<((anotar: boolean) => void) | null> | undefined;
  /** A âncora da seleção atual, se houver: `H` grifa a seleção antes do parágrafo em foco. */
  selecaoAtual?: (() => AncoraV1 | null) | undefined;
  /** Depois de grifar, apagar ou trocar a função: o chamador recarrega o capítulo. */
  aoMudarMarcas?: (() => void) | undefined;
  /** Comandos de quem envolve o leitor (estudo, biblioteca), somados aos do leitor na paleta. */
  comandos?: readonly Comando[] | undefined;
  /** Dificuldades textuais do capítulo, que o nível 3 acrescenta: entram na dica dos pontos de atenção. */
  dificuldadesNoNivel3?: number;
  conexaoDaNota?: (ancora: AncoraV1) => ReactNode;
  /** Sem margem, outros círculos que vão para a lateral direita junto dos números das notas (as dificuldades). */
  extrasDaLateral?: readonly ItemDaLateral[];
  /**
   * Leitura sem nenhuma decisão sobre as marcas (sala de teste do beta): sem o balão do grifo
   * (remover, etiquetar) e sem os botões de ocultar ou avaliar a nota. Tocar a marca abre a nota.
   */
  somenteLeitura?: boolean;
}

const SEM_RELACOES: readonly DestaqueNavegavel[] = [];
const SEM_EXTRAS: readonly ItemDaLateral[] = [];
const SEM_COMANDOS: readonly Comando[] = [];
const SEM_OUVIR: readonly AcaoDeOuvir[] = [];
/** Abaixo da barra de leitura: o que fica sob ela não conta como visível. */
const TOPO_UTIL = 72;

function coordenadasDoEvento(evento: { nativeEvent: Event }): { x: number; y: number } | null { const e = evento.nativeEvent; return 'clientX' in e && 'clientY' in e ? { x: Number(e.clientX), y: Number(e.clientY) } : null; }

const SELETOR_DE_CONTROLE = 'button, select, option, a[href], summary, input, textarea';

interface AlvoDaInteracao {
  id: Id;
  elemento: HTMLElement;
}

/** De um evento qualquer para a marca correspondente — vale tanto no trecho quanto na nota. */
function alvoDaInteracao(alvo: EventTarget | null, x?: number, y?: number): AlvoDaInteracao | null {
  if (!(alvo instanceof Element)) return null;
  const pagina = alvo.closest('.pdf-pagina');
  if (pagina && x !== undefined && y !== undefined) {
    const hit = [...pagina.querySelectorAll<HTMLElement>('[data-marcas]')].find((e) => { const r = e.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
    if (hit?.dataset['marcas']) return { id: hit.dataset['marcas'], elemento: hit };
  }
  const nota = alvo.closest<HTMLElement>('[data-nota]');
  const identificador = nota?.dataset['nota'];
  if (nota !== null && identificador !== undefined && identificador !== '') {
    return { id: identificador, elemento: nota };
  }
  const trecho = alvo.closest<HTMLElement>('span[data-marcas]');
  const primeira = (trecho?.dataset['marcas'] ?? '').split(' ')[0];
  return trecho !== null && trecho !== undefined && primeira !== undefined && primeira !== ''
    ? { id: primeira, elemento: trecho }
    : null;
}

/**
 * Ancestral comum do trecho e da nota (a composição da crítica: `ReaderController` sobre
 * `ReaderViewport`, `MarginNotes` e `NoteSheet`). Guarda o estado transitório da interação,
 * o recorte das marcas e a retomada; nada de `Range`, `DOMRect` ou `scrollTop` sai daqui.
 */
export function ReaderController({
  relacoesParaNavegar = SEM_RELACOES, aoNavegarDestaques, navegacaoSuspensa = false, aoMudarMargem, leitorRef, snapshot, documento_id, estrategia = 'scroll', progresso: fontes, atualizarMarca,
  perguntas, aoMudarCapitulos, limiarDaMargem, atrasoDoCorredorMs, atrasoDoProgressoMs, aparenciaAberta = false, navegacao, abertura, acoesDoBalao, filtrosDoCaderno, extrasDoCaderno, infoDoPainel, estudoDoPainel, aoMudarPainel, acoesDaBarra, aparenciaExtra, menuExtra, voltar, sumario, posicao: posicaoDoTexto, irParaPagina, paginaDestino = null, ouvir = SEM_OUVIR, aoSelecionarArea, avisoExtra, painel, pessoais, conexaoDaNota, dificuldadesNoNivel3 = 0, extrasDaLateral = SEM_EXTRAS,
  tituloDocumento, tipoDoDocumento, autor, conversasDoPainel, pessoaisDoCaderno, estudoAberto = false,
  edicao, grifarRef, selecaoAtual, aoMudarMarcas, comandos: comandosDeFora = SEM_COMANDOS, somenteLeitura = false,
}: PropsDoControlador): ReactNode {
  const { preferencias, alterar } = usarAparencia();
  const { funcoes, daMarca } = usarFuncoes();
  const [navegadorAberto, abrirNavegador] = useState(false);
  const [destaqueId, selecionarDestaque] = useState<string | null>(null);
  const [inicioDoPercorrer, definirInicioDoPercorrer] = useState<string | null>(null);
  const [painelDocumento, definirPainelDocumento] = useState(() => {
    // Só reabre sozinho onde o painel cabe ao lado do texto sem cobri-lo; nas telas menores ele
    // é um gesto de cada vez (] ou o botão), para não abrir o capítulo com o texto encoberto.
    if (window.innerWidth < LARGURA_PARA_PAINEL_FIXO) return false;
    try { return localStorage.getItem('margem:painel-leitor') === 'aberto'; } catch { return false; }
  });
  const botaoPainel = useRef<HTMLButtonElement>(null);
  const painelDisponivel = !estudoAberto && !painel;
  const painelAberto = painelDocumento && painelDisponivel;
  // Grava só nos gestos: fechado na montagem por falta de espaço não apaga a preferência.
  const fecharPainelDocumento = useCallback(() => {
    gravarPainel(false); definirPainelDocumento(false); botaoPainel.current?.focus({ preventScroll: true });
  }, []);
  const alternarPainelDocumento = useCallback(() => {
    if (painelDisponivel) { abrirNavegador(false); gravarPainel(!painelDocumento); definirPainelDocumento(!painelDocumento); }
  }, [painelDisponivel, painelDocumento]);
  useEffect(() => { if (!painelDisponivel) { definirPainelDocumento(false); gravarPainel(false); } }, [painelDisponivel]);
  useEffect(() => { aoMudarPainel?.(painelDocumento && painelDisponivel); }, [aoMudarPainel, painelDocumento, painelDisponivel]);

  useEffect(() => {
    if (!painelAberto) return;
    const teclar = (evento: globalThis.KeyboardEvent) => {
      if (evento.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return;
      evento.preventDefault(); evento.stopPropagation(); fecharPainelDocumento();
    };
    window.addEventListener('keydown', teclar, true);
    return () => window.removeEventListener('keydown', teclar, true);
  }, [painelAberto, fecharPainelDocumento]);
  const [menu, abrirMenu] = useState(false);
  const [escalaPdf, definirEscalaPdf] = useState(1);
  const botaoMenu = useRef<HTMLButtonElement>(null);
  const [tiposOcultos, ocultarTipos] = useState<string[]>([]);
  const leitorInterno = useRef<ApiDoLeitor>(null);
  const leitor = leitorRef ?? leitorInterno;
  const [raiz, definirRaiz] = useState<HTMLElement | null>(null);
  const [marcas, definirMarcas] = useState<readonly MarcaDoLeitor[]>(snapshot.marcas);
  const [filtro, definirFiltro] = useState<FiltroDeMarcas>(FILTRO_PADRAO);
  const [avisoDaMarca, definirAvisoDaMarca] = useState<string | null>(null);
  // O balão sobre o grifo tocado (o recém-criado abre já na função); a pilha de desfazer (J37).
  const [balao, definirBalao] = useState<{ id: Id; etiquetas: boolean } | null>(null);
  const abrirBalao = useCallback((id: Id | null, etiquetas = false) => { definirBalao(id === null ? null : { id, etiquetas }); }, []);
  const pilha = usePilhaDeDesfazer();
  // O grifo apagado e recriado pelo desfazer ganha outro id: as ações anteriores seguem o novo.
  const apelidos = useRef(new Map<Id, Id>());
  const idAtual = useCallback((id: Id) => { let atual = id; while (apelidos.current.has(atual)) atual = apelidos.current.get(atual)!; return atual; }, []);
  // A função que a IA deu, quando o leitor a troca aqui antes de o capítulo recarregar.
  const [funcoesDaIa, definirFuncoesDaIa] = useState<Record<Id, string | null>>({});
  useEffect(() => { definirFuncoesDaIa({}); }, [snapshot.edicoes]);
  // Leitura pelo teclado: o parágrafo em foco, a paleta, a lista de atalhos e a lateral esquerda.
  const [foco, focar] = useState<Id | null>(null);
  const [paleta, abrirPaleta] = useState(false);
  const [atalhos, abrirAtalhos] = useState(false);
  const [esquerdaOculta, ocultarEsquerda] = useState(false);
  // O painel esquerdo (sumário e, no PDF, miniaturas): `[` abre e recolhe. Aberto, ele cobre a faixa das braquetes.
  const [painelEsquerdo, definirPainelEsquerdo] = useState(() => {
    if (window.innerWidth < LARGURA_PARA_PAINEL_FIXO) return false;
    try { return localStorage.getItem('margem:painel-esquerdo') === 'aberto'; } catch { return false; }
  });
  const [irParaAberto, abrirIrPara] = useState(false);
  useEffect(() => { focar(null); }, [snapshot.secao.id]);

  const marcasRef = useRef<readonly MarcaDoLeitor[]>(marcas);
  marcasRef.current = marcas;

  useEffect(() => { definirMarcas(snapshot.marcas); }, [snapshot.marcas]);

  const controlador = useControlador(atrasoDoCorredorMs);
  const [margemPdfDisponivel, definirMargemPdf] = useState(true);
  const telaEstreita = useTelaEstreita(limiarDaMargem);
  const estreita = telaEstreita || (usaPdf(snapshot) && !margemPdfDisponivel);
  const atualizarMargemPdf = useCallback((disponivel: boolean) => { definirMargemPdf(disponivel); aoMudarMargem?.(disponivel); }, [aoMudarMargem]);
  const progresso: ProgressoDoLeitor = useProgresso({
    documento_id, snapshot, leitor, fontes,
    ...(atrasoDoProgressoMs === undefined ? {} : { atrasoMs: atrasoDoProgressoMs }),
  });

  const concluidos = progresso.capitulos_concluidos;
  useEffect(() => { aoMudarCapitulos?.(concluidos); }, [aoMudarCapitulos, concluidos]);

  const visiveis = useMemo(() => filtrarSaliencia(marcasFiltradas(marcas, filtro), preferencias.nivelDeAtencao).filter((m) => !tiposOcultos.includes(m.funcao)), [filtro, marcas, preferencias.nivelDeAtencao, tiposOcultos]);
  // Marca oculta sai do texto, mas a nota fica na margem só com o número, para poder ser reaberta.
  const ocultasComNota = useMemo(() => filtro.recorte === 'ocultas' ? [] : filtrarSaliencia(marcasFiltradas(marcas, { ...filtro, recorte: 'ocultas' }), preferencias.nivelDeAtencao)
    .filter((m) => m.validade === 'resolvida' && m.comentario !== null && !tiposOcultos.includes(m.funcao)), [filtro, marcas, preferencias.nivelDeAtencao, tiposOcultos]);
  // Quantas marcas cada nível mostraria, com os mesmos recortes de origem e tipo: vai para a dica dos pontos.
  const marcasPorNivel = useMemo(() => {
    const base = marcasFiltradas(marcas, filtro).filter((m) => m.funcao !== 'nenhuma' && !tiposOcultos.includes(m.funcao));
    return ([0, 1, 2, 3] as const).map((nivel) => filtrarSaliencia(base, nivel).length);
  }, [marcas, filtro, tiposOcultos]);
  const notas = useMemo(() => notasDoCapitulo(snapshot.blocos, [...visiveis, ...ocultasComNota]), [snapshot.blocos, visiveis, ocultasComNota]);
  const destaques = useMemo<DestaqueNavegavel[]>(() => {
    const ordem = new Map(snapshot.blocos.map((bloco, indice) => [bloco.id, indice]));
    return [...marcas.filter((marca) => marca.visivel && marca.validade === 'resolvida' && marca.avaliacao !== 'rejeitada' && desenhaMarca(marca)).map((marca): DestaqueNavegavel => ({
      id: marca.id, tipo: 'grifo', ancora: marca.ancora,
      titulo: marca.comentario?.rotulo ?? funcoes.find((f) => f.chave === marca.funcao)?.rotulo ?? 'Grifo',
      texto: marca.comentario?.texto ?? '', cor: daMarca(marca),
    })), ...relacoesParaNavegar].sort((a, b) => (ordem.get(a.ancora.bloco_id) ?? Infinity) - (ordem.get(b.ancora.bloco_id) ?? Infinity) || a.ancora.inicio_utf16 - b.ancora.inicio_utf16);
  }, [snapshot.blocos, marcas, funcoes, daMarca, relacoesParaNavegar]);
  const destaque = destaques.find((item) => item.id === destaqueId) ?? null;
  const navegando = navegadorAberto && !navegacaoSuspensa;
  const grifoNavegado = navegando && destaque?.tipo === 'grifo' ? destaque.id : null;
  const fecharNavegador = useCallback(() => { abrirNavegador(false); selecionarDestaque(null); controlador.fechar(false); }, [controlador.fechar]);
  const abrirPercorrer = useCallback((inicio: string | null = null) => { definirPainelDocumento(false); controlador.fechar(false); abrirBalao(null); definirInicioDoPercorrer(inicio); abrirNavegador(true); }, [controlador.fechar, abrirBalao]);
  useEffect(() => { abrirNavegador(false); selecionarDestaque(null); }, [snapshot.secao.id, snapshot.camada, navegacaoSuspensa]);
  const relacaoNavegada = navegando && destaque?.tipo === 'braquete' ? destaque.id : null;
  // O Percorrer também fica no Estudo (além do botão no topo do Caderno): é o primeiro da grade.
  const percorrerNoEstudo = useMemo<AcaoDeOuvir[]>(() => navegacaoSuspensa || destaques.length === 0 ? []
    : [{ id: 'percorrer', icone: 'percorrer', rotulo: 'Percorrer grifos e relações', ativa: navegando, executar: () => { if (navegando) fecharNavegador(); else abrirPercorrer(); } }],
  [navegacaoSuspensa, destaques.length, navegando, fecharNavegador, abrirPercorrer]);
  useEffect(() => { aoNavegarDestaques?.({ aberta: navegando, relacaoId: relacaoNavegada, cartao: true }); }, [navegando, relacaoNavegada, aoNavegarDestaques]);
  const ancoraNavegada = destaque?.ancora;
  useEffect(() => {
    if (!grifoNavegado || !ancoraNavegada) return;
    // Vindo de uma relação que recolheu o texto entre as pontas, a dobra se desfaz depois deste efeito
    // (o braquete só sabe da navegação no render seguinte) e, ao se desfazer, mexe na rolagem. Então
    // espera não haver mais texto recolhido e mede um quadro depois, com a página inteira de volta; o
    // quadro extra também deixa o leitor redesenhar um grifo fora do nível de atenção atual.
    let quadro = 0;
    let tentativas = 0;
    const pousar = () => {
      const recolhido = document.querySelector('[data-colapsado]') !== null;
      if (recolhido && tentativas++ < 60) { quadro = requestAnimationFrame(pousar); return; }
      quadro = requestAnimationFrame(() => {
        const faixa = faixaDaAncora(leitor.current, ancoraNavegada);
        if (faixa) window.scrollBy({ top: faixa.topo - Math.max(100, window.innerHeight * .22), behavior: 'instant' });
      });
    };
    quadro = requestAnimationFrame(pousar);
    // Foco como na visita: a nota do grifo abre na margem, ao lado dele (sem margem, fica só o grifo aceso).
    return () => { cancelAnimationFrame(quadro); };
  }, [grifoNavegado, ancoraNavegada, leitor]);
  const ativa = navegando ? grifoNavegado : controlador.ativa;
  const numerosDasNotas = useMemo(() => new Map(notas.map((nota) => [nota.marca.id, nota.numero])), [notas]);
  const comMarcasDoRecorte = useMemo<SnapshotCapitulo>(
    () => ({ ...snapshot, marcas: [...visiveis, ...marcas.filter((m) => m.id === grifoNavegado && !visiveis.some((v) => v.id === m.id))] }), [snapshot, visiveis, marcas, grifoNavegado],
  );
  const origens = useMemo(() => origensPresentes(marcas), [marcas]);
  // Chips do Caderno: as funções (a legenda das cores, sem a interna "nenhuma"), IA · Minhas, e o recorte.
  const funcoesPresentes = useMemo(() => [...new Set(marcas.filter((m) => m.funcao !== 'nenhuma' && desenhaMarca(m)).map((m) => m.funcao))]
    .map((chave) => ({ chave, rotulo: funcoes.find((f) => f.chave === chave)?.rotulo ?? chave, cor: daMarca(marcas.find((m) => m.funcao === chave)!),
      total: marcas.filter((m) => m.funcao === chave && grifoNoTexto(m)).length })), [marcas, funcoes, daMarca]);
  const temIa = origens.some((origem) => origem !== 'manual');
  const temMinhas = origens.includes('manual');
  const ocultas = marcas.filter((m) => !m.visivel).length;
  const filtrosDoPainel = <div className="filtros-do-caderno">
    {funcoesPresentes.length > 0 && <div className="chips" role="group" aria-label="Funções">{funcoesPresentes.map((f) => (
      <button key={f.chave} type="button" className="chip chip-funcao" aria-pressed={!tiposOcultos.includes(f.chave)} style={{ '--cor-chip': f.cor } as CSSProperties}
        onClick={() => ocultarTipos((atuais) => atuais.includes(f.chave) ? atuais.filter((t) => t !== f.chave) : [...atuais, f.chave])}>
        <span className="chip-ponto" aria-hidden="true" />{f.rotulo}<span className="chip-conta">{f.total}</span>
      </button>))}
    </div>}
    <div className="chips" role="group" aria-label="Origem e recorte">
      {temIa && temMinhas && ([['todas', 'Todas'], ['ia', 'IA'], ['manual', 'Minhas']] as const).map(([valor, rotulo]) => (
        <button key={valor} type="button" className="chip" aria-pressed={filtro.origem === valor} onClick={() => definirFiltro((atual) => ({ ...atual, origem: valor }))}>{rotulo}</button>))}
      <button type="button" className="chip" aria-pressed={filtro.recorte === 'confirmadas'} onClick={() => definirFiltro((atual) => ({ ...atual, recorte: atual.recorte === 'confirmadas' ? 'todas' : 'confirmadas' }))}>Confirmadas</button>
      {ocultas > 0 && <button type="button" className="chip" aria-pressed={filtro.recorte === 'ocultas'} onClick={() => definirFiltro((atual) => ({ ...atual, recorte: atual.recorte === 'ocultas' ? 'todas' : 'ocultas' }))}>Ocultas<span className="chip-conta">{ocultas}</span></button>}
    </div>
    {filtrosDoCaderno}
  </div>;
  const grifosDoCaderno = useMemo(() => (filtro.recorte === 'ocultas' ? marcasFiltradas(marcas, filtro) : visiveis)
    .filter((m) => m.avaliacao !== 'rejeitada' && (filtro.recorte === 'ocultas' || (m.visivel && m.validade === 'resolvida')) && (desenhaMarca(m) || m.comentario !== null)), [filtro, marcas, visiveis]);

  const aplicarMudanca = useCallback((id: Id, mudanca: MudancaDeMarca) => {
    const anteriores = marcasRef.current;
    definirAvisoDaMarca(null);
    definirMarcas(comMudanca(anteriores, id, mudanca));
    if (atualizarMarca === undefined) return;
    void atualizarMarca(id, mudanca).then(
      (marca) => {
        if (marca !== null) definirMarcas((atuais) => atuais.map((item) => (item.id === id ? marca : item)));
      },
      () => {
        definirMarcas(anteriores);
        definirAvisoDaMarca('não foi possível registrar a decisão');
      },
    );
  }, [atualizarMarca]);

  const acoes = useMemo<AcoesDaNota>(() => ({
    alternarVisibilidade: (id, visivel) => { aplicarMudanca(id, { visivel }); },
    avaliar: (id, avaliacao) => { aplicarMudanca(id, { avaliacao }); },
  }), [aplicarMudanca]);

  const aoEntrar = useCallback((evento: PointerEvent<HTMLDivElement>) => {
    if (estreita) return;
    const alvo = alvoDaInteracao(evento.target, coordenadasDoEvento(evento)?.x, coordenadasDoEvento(evento)?.y);
    if (alvo !== null) controlador.entrar(alvo.id);
  }, [controlador, estreita]);

  const aoSair = useCallback((evento: PointerEvent<HTMLDivElement>) => {
    if (estreita) return;
    const alvo = alvoDaInteracao(evento.target, coordenadasDoEvento(evento)?.x, coordenadasDoEvento(evento)?.y);
    if (alvo !== null) controlador.sair(alvo.id);
  }, [controlador, estreita]);

  const aoClicar = useCallback((evento: MouseEvent<HTMLDivElement>) => {
    if (evento.target instanceof Element && evento.target.closest(SELETOR_DE_CONTROLE) !== null) return;
    if (!window.getSelection()?.isCollapsed) return;
    const alvo = alvoDaInteracao(evento.target, coordenadasDoEvento(evento)?.x, coordenadasDoEvento(evento)?.y);
    if (alvo === null) return;
    // No texto (ou na página do PDF), o toque abre o balão sobre o grifo; no computador a nota também se fixa
    // na margem. No celular a folha da nota abre pelo número, não pelo grifo.
    const noTexto = evento.target instanceof Element && evento.target.closest('.capitulo, .pdf-pagina') !== null;
    if (noTexto && !somenteLeitura) abrirBalao(alvo.id);
    if (!noTexto || !estreita || somenteLeitura) controlador.fixar(alvo.id, alvo.elemento);
  }, [controlador, estreita, somenteLeitura]);

  const aoFocar = useCallback((evento: FocusEvent<HTMLDivElement>) => {
    const alvo = alvoDaInteracao(evento.target, coordenadasDoEvento(evento)?.x, coordenadasDoEvento(evento)?.y);
    if (alvo !== null) controlador.focar(alvo.id, alvo.elemento);
  }, [controlador]);

  const aoDesfocar = useCallback((evento: FocusEvent<HTMLDivElement>) => {
    const alvo = alvoDaInteracao(evento.target, coordenadasDoEvento(evento)?.x, coordenadasDoEvento(evento)?.y);
    if (alvo !== null) controlador.desfocar(alvo.id);
  }, [controlador]);

  const aoTeclar = useCallback((evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === 'Escape') {
      // Dentro do balão, o Esc é dele: fecha primeiro o painel aberto, depois o balão.
      if (evento.target instanceof Element && evento.target.closest('.balao-da-marca') !== null) return;
      evento.preventDefault();
      abrirBalao(null);
      controlador.fechar(true);
      return;
    }
    const espacoNoNumero = evento.key === ' ' && evento.target instanceof Element && evento.target.matches('.nota-numero[role="button"]');
    if (evento.key !== 'Enter' && !espacoNoNumero) return;
    if (evento.target instanceof Element && evento.target.closest(SELETOR_DE_CONTROLE) !== null) return;
    const alvo = alvoDaInteracao(evento.target, coordenadasDoEvento(evento)?.x, coordenadasDoEvento(evento)?.y);
    if (alvo === null) return;
    evento.preventDefault();
    controlador.fixar(alvo.id, alvo.elemento);
  }, [controlador]);

  const { fixada } = controlador.estado;
  const marcaFixada = fixada === null ? null : marcas.find((marca) => marca.id === fixada) ?? null;
  const marcaDoBalao = balao === null || somenteLeitura ? null : marcas.find((marca) => marca.id === balao.id && marca.avaliacao !== 'rejeitada') ?? null;
  const fecharBalao = useCallback(() => { abrirBalao(null); }, [abrirBalao]);

  // ------------------------------------------------------------ grifos, função e desfazer (J37)
  const inserir = useCallback((marca: MarcaDoLeitor) => { definirMarcas((atuais) => [...atuais.filter((item) => item.id !== marca.id), marca]); }, []);
  const substituir = useCallback((marca: MarcaDoLeitor) => { definirMarcas((atuais) => atuais.map((item) => (item.id === marca.id ? marca : item))); }, []);
  const falhou = useCallback((falha: unknown, padrao: string) => { definirAvisoDaMarca(null); pilha.avisar(falha instanceof Error && falha.message !== '' ? falha.message : padrao); }, [pilha]);

  const removerMarca = useCallback((marca: MarcaDoLeitor) => {
    abrirBalao(null); controlador.fechar(true);
    if (marca.origem === 'manual' && edicao) {
      const etiquetas = (snapshot.etiquetas ?? []).filter((etiqueta) => etiqueta.alvo.tipo === 'marca' && etiqueta.alvo.id === marca.id).map((etiqueta) => etiqueta.nome);
      definirMarcas((atuais) => atuais.filter((item) => item.id !== marca.id));
      edicao.apagarGrifo(marca.id).then(() => {
        pilha.registrar({ rotulo: 'Grifo apagado', desfazer: async () => {
          const nova = await edicao.criarGrifo(marca.ancora, marca.funcao);
          apelidos.current.set(marca.id, nova.id);
          inserir(nova);
          if (edicao.etiquetar) for (const nome of etiquetas) await edicao.etiquetar(nova.id, nome);
          aoMudarMarcas?.();
        } });
        aoMudarMarcas?.();
      }, (falha: unknown) => { inserir(marca); falhou(falha, 'Não foi possível apagar o grifo.'); });
      return;
    }
    const antes = marca.avaliacao;
    aplicarMudanca(marca.id, { avaliacao: 'rejeitada' });
    pilha.registrar({ rotulo: 'Marca removida', desfazer: () => { aplicarMudanca(idAtual(marca.id), { avaliacao: antes === 'rejeitada' ? 'nao_avaliada' : antes }); } });
  }, [abrirBalao, controlador, edicao, snapshot.etiquetas, pilha, inserir, aoMudarMarcas, falhou, aplicarMudanca, idAtual]);

  const funcaoDaIa = useCallback((marca: MarcaDoLeitor): string | undefined => {
    if (marca.origem === 'manual') return undefined;
    const local = funcoesDaIa[marca.id];
    if (local !== undefined) return local ?? undefined;
    return snapshot.edicoes?.[marca.id]?.funcao_da_ia;
  }, [funcoesDaIa, snapshot.edicoes]);

  const trocarFuncao = useCallback(async (marca: MarcaDoLeitor, funcao: string, registrar = true) => {
    if (!edicao) return;
    const antes = marca.funcao;
    const nova = await edicao.trocarFuncao(idAtual(marca.id), funcao);
    substituir(nova);
    if (marca.origem !== 'manual') {
      const original = funcaoDaIa(marca) ?? antes;
      definirFuncoesDaIa((atuais) => ({ ...atuais, [marca.id]: funcao === original ? null : original }));
    }
    if (registrar) pilha.registrar({ rotulo: `Função: ${funcao === 'nenhuma' ? 'nenhuma' : funcoes.find((f) => f.chave === funcao)?.rotulo.toLocaleLowerCase('pt-BR') ?? funcao}`,
      desfazer: () => trocarFuncao(nova, antes, false) });
    aoMudarMarcas?.();
  }, [edicao, idAtual, substituir, funcaoDaIa, pilha, funcoes, aoMudarMarcas]);

  const funcaoDoBalao = useMemo<FuncaoDoBalao | undefined>(() => (edicao && marcaDoBalao ? {
    trocar: (funcao) => trocarFuncao(marcaDoBalao, funcao), daIa: funcaoDaIa(marcaDoBalao),
  } : undefined), [edicao, marcaDoBalao, trocarFuncao, funcaoDaIa]);

  // ------------------------------------------------------------ leitura pelo teclado (J37)
  const navegaveis = useMemo(() => blocosNavegaveis(snapshot.blocos), [snapshot.blocos]);
  const ancoraDoFoco = useMemo(() => {
    const bloco = foco === null ? undefined : navegaveis.find((item) => item.id === foco);
    return bloco ? ancoraDoBloco(snapshot.versao_id, bloco) : null;
  }, [foco, navegaveis, snapshot.versao_id]);
  const faixaDoBloco = useCallback((id: Id) => {
    const bloco = navegaveis.find((item) => item.id === id);
    return bloco ? faixaDaAncora(leitor.current, ancoraDoBloco(snapshot.versao_id, bloco)) : null;
  }, [navegaveis, leitor, snapshot.versao_id]);

  const mover = useCallback((direcao: 1 | -1) => {
    abrirBalao(null);
    const altura = window.innerHeight;
    const atual = foco === null ? null : faixaDoBloco(foco);
    // Parágrafo mais alto que a tela: primeiro rola dentro dele, depois passa ao vizinho.
    if (atual && direcao === 1 && atual.base > altura - 24 && atual.topo < altura * 0.5) { window.scrollBy({ top: altura * 0.6 }); return; }
    if (atual && direcao === -1 && atual.topo < TOPO_UTIL && atual.base > altura * 0.5) { window.scrollBy({ top: -altura * 0.6 }); return; }
    const ids = navegaveis.map((bloco) => bloco.id);
    let proximo: Id | null;
    // Parágrafo em foco na tela (ou sem medida, como uma página do PDF ainda por desenhar): o vizinho.
    if (foco !== null && (atual === null || (atual.base > TOPO_UTIL && atual.topo < altura))) proximo = vizinho(ids, foco, direcao);
    else {
      // Sem foco, ou com ele fora da tela (o leitor rolou com o mouse): começa pelo primeiro visível.
      const visiveis = ids.filter((id) => { const faixa = faixaDoBloco(id); return faixa !== null && faixa.base > TOPO_UTIL + 8 && faixa.topo < altura - 8; });
      proximo = (direcao === 1 ? visiveis[0] : visiveis.at(-1)) ?? vizinho(ids, null, direcao);
    }
    if (proximo === null) return;
    focar(proximo);
    const destino = faixaDoBloco(proximo);
    if (destino && (destino.topo < TOPO_UTIL + 8 || destino.base > altura - 24)) window.scrollBy({ top: destino.topo - altura * 0.3 });
  }, [abrirBalao, foco, faixaDoBloco, navegaveis]);

  const grifar = useCallback(async (anotar: boolean) => {
    if (!edicao) return;
    const selecionada = selecaoAtual?.() ?? null;
    const ancora = selecionada ?? ancoraDoFoco;
    if (!ancora) { pilha.avisar('Escolha um parágrafo com ↑ ↓ ou selecione um trecho.'); return; }
    const mesmo = marcasRef.current.find((marca) => marca.origem === 'manual' && marca.ancora.bloco_id === ancora.bloco_id
      && marca.ancora.inicio_utf16 === ancora.inicio_utf16 && marca.ancora.fim_utf16 === ancora.fim_utf16);
    if (mesmo) {
      // De novo sobre o mesmo trecho: H apaga o grifo; N abre as notas dele.
      if (anotar) acoesDoBalao?.anotar(mesmo.ancora, mesmo.id); else removerMarca(mesmo);
      return;
    }
    try {
      const marca = await edicao.criarGrifo(ancora, 'nenhuma');
      window.getSelection()?.removeAllRanges();
      inserir(marca);
      pilha.registrar({ rotulo: 'Grifo criado', desfazer: async () => {
        const id = idAtual(marca.id);
        await edicao.apagarGrifo(id);
        definirMarcas((atuais) => atuais.filter((item) => item.id !== id));
        aoMudarMarcas?.();
      } });
      if (anotar && acoesDoBalao) acoesDoBalao.anotar(marca.ancora, marca.id);
      else abrirBalao(marca.id, true);
      aoMudarMarcas?.();
    } catch (falha) {
      // Sobreposto a um grifo dele: abre o balão daquele, em vez de um segundo grifo.
      const vizinha = marcasRef.current.find((marca) => marca.origem === 'manual' && marca.ancora.bloco_id === ancora.bloco_id
        && marca.ancora.inicio_utf16 < ancora.fim_utf16 && ancora.inicio_utf16 < marca.ancora.fim_utf16);
      if (vizinha) { if (anotar && acoesDoBalao) acoesDoBalao.anotar(vizinha.ancora, vizinha.id); else abrirBalao(vizinha.id); return; }
      falhou(falha, 'Não foi possível grifar.');
    }
  }, [edicao, selecaoAtual, ancoraDoFoco, pilha, acoesDoBalao, removerMarca, inserir, idAtual, aoMudarMarcas, abrirBalao, falhou]);

  useEffect(() => {
    if (!grifarRef) return;
    grifarRef.current = (anotar) => { void grifar(anotar); };
    return () => { grifarRef.current = null; };
  }, [grifarRef, grifar]);

  const alternarMargem = useCallback(() => {
    alterar({ tipo: 'alterar', valores: { margem: preferencias.margem === 'mostrar' ? 'recolher' : 'mostrar' } });
  }, [alterar, preferencias.margem]);
  // Zoom do PDF (preferência `zoomPdf`): pelos passos, a partir da escala atual.
  const pdf = usaPdf(snapshot);
  // A página no centro da barra (PDF): a que cruza 40% da altura da tela; o total vem do próprio PDF.
  const [documentoPdf, definirDocumentoPdf] = useState<PDFDocumentProxy | null>(null);
  const [totalDePaginas, definirTotalDePaginas] = useState<number | null>(null);
  const [paginaAtual, definirPaginaAtual] = useState<number | null>(null);
  useEffect(() => {
    if (!pdf || !raiz) return;
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      const limite = window.innerHeight * 0.4;
      let atual: number | null = null;
      for (const elemento of raiz.querySelectorAll<HTMLElement>('.capitulo-pdf .pdf-pagina[data-pagina]')) {
        if (atual !== null && elemento.getBoundingClientRect().top > limite) break;
        atual = Number(elemento.dataset['pagina']);
      }
      if (atual !== null) definirPaginaAtual(atual);
    };
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(medir); };
    agendar();
    window.addEventListener('scroll', agendar, { passive: true });
    window.addEventListener('margem:geometria', agendar);
    return () => { cancelAnimationFrame(quadro); window.removeEventListener('scroll', agendar); window.removeEventListener('margem:geometria', agendar); };
  }, [pdf, raiz, snapshot.secao.id]);
  const irParaPaginaDoPdf = useCallback((numero: number) => {
    const alvo = raiz?.querySelector<HTMLElement>(`.capitulo-pdf .pdf-pagina[data-pagina="${String(numero)}"]`);
    if (alvo) { window.scrollBy({ top: alvo.getBoundingClientRect().top - TOPO_UTIL + 4, behavior: 'instant' }); definirPaginaAtual(numero); return; }
    irParaPagina?.(numero);
  }, [raiz, irParaPagina]);
  useEffect(() => {
    if (!pdf || paginaDestino === null || !raiz) return;
    // As páginas ganham altura quando a geometria chega; até lá, tenta de novo a cada aviso dela.
    let feito = false;
    const tentar = () => {
      const alvo = raiz.querySelector<HTMLElement>(`.capitulo-pdf .pdf-pagina[data-pagina="${String(paginaDestino)}"]`);
      if (!alvo || feito) return;
      feito = true;
      window.scrollBy({ top: alvo.getBoundingClientRect().top - TOPO_UTIL + 4, behavior: 'instant' });
    };
    tentar();
    window.addEventListener('margem:geometria', tentar);
    const fim = setTimeout(() => window.removeEventListener('margem:geometria', tentar), 4000);
    return () => { clearTimeout(fim); window.removeEventListener('margem:geometria', tentar); };
  }, [pdf, paginaDestino, raiz, snapshot.secao.id]);
  const posicaoDaBarra = useMemo<PosicaoNaLeitura | undefined>(() => {
    if (!pdf) return posicaoDoTexto;
    const total = totalDePaginas ?? snapshot.paginas?.fim;
    const atual = paginaAtual ?? snapshot.paginas?.inicio;
    if (total === undefined || atual === undefined) return undefined;
    const alcancavel = (numero: number) => numero >= 1 && numero <= total && (irParaPagina !== undefined
      || (numero >= (snapshot.paginas?.inicio ?? 1) && numero <= (snapshot.paginas?.fim ?? total)));
    return { tipo: 'pagina', atual, total,
      anterior: alcancavel(atual - 1) ? () => irParaPaginaDoPdf(atual - 1) : undefined,
      proximo: alcancavel(atual + 1) ? () => irParaPaginaDoPdf(atual + 1) : undefined,
      irPara: irParaPaginaDoPdf };
  }, [pdf, posicaoDoTexto, totalDePaginas, paginaAtual, snapshot.paginas?.inicio, snapshot.paginas?.fim, irParaPagina, irParaPaginaDoPdf]);
  const temPainelEsquerdo = sumario !== undefined || pdf;
  const [vistaEsquerda, definirVistaEsquerda] = useState<VistaDoPainelEsquerdo>(() => { try { return localStorage.getItem('margem:vista-esquerda') === 'miniaturas' ? 'miniaturas' : 'sumario'; } catch { return 'sumario'; } });
  const mudarVistaEsquerda = useCallback((vista: VistaDoPainelEsquerdo) => { definirVistaEsquerda(vista); try { localStorage.setItem('margem:vista-esquerda', vista); } catch { /* sem storage */ } }, []);
  const alternarPainelEsquerdo = useCallback(() => {
    definirPainelEsquerdo((aberto) => {
      try { localStorage.setItem('margem:painel-esquerdo', aberto ? 'fechado' : 'aberto'); } catch { /* Sem storage, vale a sessão. */ }
      return !aberto;
    });
  }, []);
  const painelEsquerdoAberto = painelEsquerdo && temPainelEsquerdo;
  const zoom = useCallback((direcao: 1 | -1 | 0) => {
    alterar({ tipo: 'alterar', valores: { zoomPdf: direcao === 0 ? 'largura' : proximoZoom(escalaPdf, direcao) } });
  }, [alterar, escalaPdf]);
  // Ctrl + roda do mouse no PDF: o zoom do documento, não o da página (um passo por gesto).
  useEffect(() => {
    if (!pdf) return;
    let ultimo = 0;
    const roda = (evento: WheelEvent) => {
      if (!evento.ctrlKey && !evento.metaKey) return;
      evento.preventDefault();
      const agora = Date.now();
      if (agora - ultimo < 140 || evento.deltaY === 0) return;
      ultimo = agora;
      zoom(evento.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener('wheel', roda, { passive: false });
    return () => window.removeEventListener('wheel', roda);
  }, [pdf, zoom]);
  const desfazer = useCallback(() => { pilha.desfazer().catch((falha: unknown) => falhou(falha, 'Não foi possível desfazer.')); }, [pilha, falhou]);

  const comandos = useMemo<Comando[]>(() => [
    { id: 'proximo', grupo: 'Leitura', rotulo: 'Próximo parágrafo', atalho: '↓', executar: () => mover(1) },
    { id: 'anterior', grupo: 'Leitura', rotulo: 'Parágrafo anterior', atalho: '↑', executar: () => mover(-1) },
    ...(edicao ? [
      { id: 'grifar', grupo: 'Marcas', rotulo: 'Grifar o parágrafo (ou a seleção)', atalho: 'H', palavras: 'highlight destacar', executar: () => { void grifar(false); } },
      { id: 'grifar-anotar', grupo: 'Marcas', rotulo: 'Grifar e anotar', atalho: 'N', palavras: 'nota', executar: () => { void grifar(true); } },
    ] : []),
    { id: 'desfazer', grupo: 'Marcas', rotulo: 'Desfazer', atalho: 'Z', executar: desfazer },
    ...(temPainelEsquerdo ? [{ id: 'painel-esquerdo', grupo: 'Leitura focada', rotulo: painelEsquerdoAberto ? 'Recolher o sumário' : 'Sumário', atalho: '[', palavras: 'capítulos índice lateral esquerda', executar: alternarPainelEsquerdo }] : []),
    { id: 'braquetes', grupo: 'Leitura focada', rotulo: esquerdaOculta ? 'Mostrar as braquetes' : 'Esconder as braquetes', ...(temPainelEsquerdo ? {} : { atalho: '[' }), palavras: 'lateral esquerda relações', executar: () => ocultarEsquerda((atual) => !atual) },
    ...(posicaoDaBarra?.irPara ? [{ id: 'ir-para', grupo: 'Leitura', rotulo: posicaoDaBarra.tipo === 'pagina' ? 'Ir para a página…' : 'Ir para o capítulo…', atalho: 'Shift J', palavras: 'saltar número', executar: () => abrirIrPara(true) }] : []),
    { id: 'painel-documento', grupo: 'Leitura focada', rotulo: 'Painel do documento', atalho: ']', palavras: 'info caderno estudo conversas', executar: alternarPainelDocumento },
    ...(navegacaoSuspensa ? [] : [{ id: 'percorrer', grupo: 'Leitura', rotulo: navegando ? 'Fechar o percorrer' : 'Percorrer grifos e relações', palavras: 'navegar destaques próximo grifo relação', executar: () => { if (navegando) fecharNavegador(); else abrirPercorrer(); } }]),
    { id: 'margem', grupo: 'Leitura focada', rotulo: preferencias.margem === 'mostrar' ? 'Recolher as notas em números' : 'Abrir as notas na margem', atalho: 'M', palavras: 'lateral direita', executar: alternarMargem },
    { id: 'focada', grupo: 'Leitura focada', rotulo: 'Leitura focada (esconder as duas laterais)', palavras: 'foco zen', executar: () => { ocultarEsquerda(true); definirPainelEsquerdo(false); alterar({ tipo: 'alterar', valores: { margem: 'recolher' } }); } },
    ...(pdf ? [
      { id: 'zoom-mais', grupo: 'Visual', rotulo: 'Aumentar o zoom do PDF', atalho: 'Ctrl +', palavras: 'ampliar maior', executar: () => zoom(1) },
      { id: 'zoom-menos', grupo: 'Visual', rotulo: 'Diminuir o zoom do PDF', atalho: 'Ctrl −', palavras: 'reduzir menor', executar: () => zoom(-1) },
      { id: 'zoom-largura', grupo: 'Visual', rotulo: 'Ajustar o PDF à largura', atalho: 'Ctrl 0', palavras: 'zoom', executar: () => zoom(0) },
    ] : []),
    ...([0, 1, 2, 3] as const).map((nivel) => ({ id: `atencao-${String(nivel)}`, grupo: 'Visual', rotulo: `Atenção: ${NOMES_DOS_NIVEIS[nivel]}`, palavras: 'nível marcas',
      executar: () => alterar({ tipo: 'alterar', valores: { nivelDeAtencao: nivel } }) })),
    ...([['grifo', 'Grifo'], ['marca_texto', 'Marca-texto'], ['sublinhado', 'Sublinhado']] as const).map(([estilo, rotulo]) => ({ id: `estilo-${estilo}`, grupo: 'Visual', rotulo: `Estilo das marcas: ${rotulo}`,
      executar: () => alterar({ tipo: 'alterar', valores: { estilo } }) })),
    ...([['claro', 'Claro'], ['escuro', 'Escuro'], ['sepia', 'Sépia'], ['sistema', 'Do sistema']] as const).map(([tema, rotulo]) => ({ id: `tema-${tema}`, grupo: 'Visual', rotulo: `Tema: ${rotulo}`, palavras: 'aparência cor',
      executar: () => alterar({ tipo: 'alterar', valores: { tema } }) })),
    ...comandosDeFora,
    { id: 'atalhos', grupo: 'Ajuda', rotulo: 'Atalhos do teclado', atalho: '?', executar: () => abrirAtalhos(true) },
  ], [navegacaoSuspensa, navegando, fecharNavegador, abrirPercorrer, mover, edicao, grifar, desfazer, esquerdaOculta, preferencias.margem, alternarMargem, alternarPainelDocumento, alterar, comandosDeFora, pdf, zoom, temPainelEsquerdo, painelEsquerdoAberto, alternarPainelEsquerdo, posicaoDaBarra]);

  useEffect(() => {
    const teclar = (evento: globalThis.KeyboardEvent) => {
      if ((evento.ctrlKey || evento.metaKey) && !evento.altKey && evento.key.toLowerCase() === 'k') {
        evento.preventDefault(); abrirAtalhos(false); abrirPaleta((aberta) => !aberta); return;
      }
      // Shift Ctrl S: a ferramenta de área (como no Readwise), onde houver página para recortar.
      if ((evento.ctrlKey || evento.metaKey) && evento.shiftKey && !evento.altKey && evento.key.toLowerCase() === 's' && aoSelecionarArea) {
        evento.preventDefault(); aoSelecionarArea(); return;
      }
      // Ctrl/⌘ + e − no PDF: o zoom do documento (como num leitor de PDF), e 0 volta à largura.
      if (pdf && (evento.ctrlKey || evento.metaKey) && !evento.altKey && ['+', '=', '-', '_', '0'].includes(evento.key)) {
        evento.preventDefault(); zoom(evento.key === '0' ? 0 : evento.key === '-' || evento.key === '_' ? -1 : 1); return;
      }
      if (evento.defaultPrevented || evento.ctrlKey || evento.metaKey || evento.altKey || digitando(evento.target) || atalhoDeUmaTeclaDesligado(evento)) return;
      // Com uma janela aberta (painel, paleta, atalhos), as teclas são dela.
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      const tecla = evento.key;
      if (tecla === 'ArrowDown' || tecla === 'ArrowUp') {
        if (evento.target instanceof Element && evento.target.closest('[role="menu"], [role="listbox"], [role="radiogroup"], [role="toolbar"], .painel-do-leitor')) return;
        evento.preventDefault(); mover(tecla === 'ArrowDown' ? 1 : -1);
      } else if (tecla === '?') { evento.preventDefault(); abrirAtalhos(true); }
      else if (tecla === '{' && temPainelEsquerdo && pdf && sumario !== undefined) { evento.preventDefault(); definirPainelEsquerdo(true); mudarVistaEsquerda(vistaEsquerda === 'sumario' ? 'miniaturas' : 'sumario'); }
      else if (tecla === '[') { evento.preventDefault(); if (temPainelEsquerdo) alternarPainelEsquerdo(); else ocultarEsquerda((atual) => !atual); }
      else if ((tecla === 'J' || tecla === 'j') && evento.shiftKey && posicaoDaBarra?.irPara) { evento.preventDefault(); abrirIrPara(true); }
      else if (tecla === ']') { evento.preventDefault(); alternarPainelDocumento(); }
      // `]` ficou com o painel do documento (J72); a margem de notas passou para M.
      else if (tecla === 'm' || tecla === 'M') { evento.preventDefault(); alternarMargem(); }
      else if (tecla.toLowerCase() === 'z' && !evento.shiftKey) { evento.preventDefault(); desfazer(); }
      else if (tecla === 'Escape' && balao === null && foco !== null) focar(null);
      // Com o balão aberto, N anota pela própria marca (o balão cuida); H fica para o texto.
      else if (edicao && balao === null && (tecla === 'h' || tecla === 'H' || tecla === 'n' || tecla === 'N')) {
        evento.preventDefault(); void grifar(tecla.toLowerCase() === 'n');
      }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [mover, alternarPainelDocumento, alternarMargem, desfazer, balao, foco, edicao, grifar, pdf, zoom, temPainelEsquerdo, alternarPainelEsquerdo, posicaoDaBarra, aoSelecionarArea, sumario, vistaEsquerda, mudarVistaEsquerda]);
  // O aviso do desfazer some sozinho.
  useEffect(() => {
    if (pilha.aviso === null) return;
    const relogio = setTimeout(pilha.dispensar, 6000);
    return () => clearTimeout(relogio);
  }, [pilha.aviso, pilha.dispensar]);
  const numeroDaFixada = notas.find((nota) => nota.marca.id === fixada)?.numero;
  // Sem margem, os números das notas vão para a lateral direita do texto; tocar abre a folha.
  const colunaDoTexto = useCallback(() => raiz?.querySelector('.capitulo')?.getBoundingClientRect() ?? null, [raiz]);
  const itensDaLateral = useMemo<ItemDaLateral[]>(() => [
    ...notas.map((nota) => ({
      id: nota.marca.id, ancora: nota.marca.ancora, rotulo: String(nota.numero), cor: daMarca(nota.marca),
      tracejado: 'saliencia' in nota.marca && nota.marca.saliencia === 3, descricao: `Nota ${String(nota.numero)}: ${nota.comentario.rotulo}`,
      aoAbrir: () => { controlador.fixar(nota.marca.id); },
    })),
    ...extrasDaLateral,
  ], [notas, daMarca, controlador, extrasDaLateral]);

  return (
    <ContextoDeDesfazer.Provider value={pilha}>
    <div
      className="leitor-controlado"
      data-navegador={navegando ? '' : undefined}
      data-margem={preferencias.margem}
      data-lateral-esquerda={esquerdaOculta || painelEsquerdoAberto ? 'oculta' : undefined}
      data-painel-esquerdo={painelEsquerdoAberto ? '' : undefined}
      ref={definirRaiz}
      onPointerOver={aoEntrar}
      onPointerMove={(e) => { if (e.target instanceof Element && e.target.closest('.pdf-pagina')) { const alvo = alvoDaInteracao(e.target, e.clientX, e.clientY); if (alvo) controlador.entrar(alvo.id); else if (controlador.ativa) controlador.sair(controlador.ativa); } }}
      onPointerOut={aoSair}
      onClick={aoClicar}
      onFocus={aoFocar}
      onBlur={aoDesfocar}
      onKeyDown={aoTeclar}
    >
      <nav className="filtros barra-do-leitor" aria-label="Barra de leitura">
        <ProgressoDaRolagem raiz={raiz} />
        <div className="barra-grupo barra-esquerda">
          {voltar && <a className="ui-button ui-ghost ui-icon botao-da-barra voltar-da-barra" href={voltar.href} aria-label={voltar.rotulo} data-dica={voltar.rotulo}
            onClick={(evento) => { evento.preventDefault(); voltar.aoVoltar(); }}><Icon name="voltar" /></a>}
          {temPainelEsquerdo && <BotaoDaBarra rotulo={sumario ? 'Sumário' : 'Miniaturas'} atalho="[" icone="painel-esquerdo" aria-expanded={painelEsquerdoAberto} onClick={alternarPainelEsquerdo} />}
        </div>
        <div className="barra-grupo barra-centro">
          {posicaoDaBarra && <PosicaoNaBarra posicao={posicaoDaBarra} irParaAberto={irParaAberto} aoAbrirIrPara={abrirIrPara} />}
        </div>
        <div className="barra-grupo barra-direita">
          {acoesDaBarra && <div className="acoes-da-barra">{acoesDaBarra}</div>}
          <Aparencia abertaInicialmente={aparenciaAberta} extra={aparenciaExtra} />
          {aoSelecionarArea && <BotaoDaBarra rotulo="Selecionar área" atalho="Shift Ctrl S" icone="area" onClick={aoSelecionarArea} />}
          <AtencaoNaBarra nivel={preferencias.nivelDeAtencao}><Atencao marcasPorNivel={marcasPorNivel} dificuldades={dificuldadesNoNivel3} /></AtencaoNaBarra>
          {ouvir.length > 0 && <OuvirNaBarra acoes={ouvir} />}
          <Separador />
          <BotaoDaBarra ref={botaoPainel} rotulo="Painel do documento" atalho="]" icone="painel-direito" aria-expanded={painelAberto} disabled={!painelDisponivel} onClick={alternarPainelDocumento} />
          <BotaoDaBarra ref={botaoMenu} rotulo="Mais opções" aria-label="Mais opções do leitor" icone="reticencias" aria-expanded={menu} onClick={() => abrirMenu(!menu)} />
        </div>
        {menu && <Popover ancora={botaoMenu} aoFechar={() => abrirMenu(false)} rotulo="Mais opções" largura={260} className="menu-da-barra">
          {/* Só o raro: cada ação fecha o menu antes de abrir a sua janela. */}
          <ul className="lista-de-acoes" onClick={(evento) => { if (evento.target instanceof Element && evento.target.closest('button, a')) abrirMenu(false); }}>
            {menuExtra}
            <li><Button variante="ghost" onClick={() => abrirPaleta(true)}><Icon name="buscar" size={18} /><span><span className="acao-rotulo">Paleta de comandos</span><span className="acao-detalhe">Ctrl K</span></span></Button></li>
            <li><Button variante="ghost" onClick={() => abrirAtalhos(true)}><Icon name="info" size={18} /><span><span className="acao-rotulo">Atalhos do teclado</span><span className="acao-detalhe">?</span></span></Button></li>
          </ul>
        </Popover>}
      </nav>
      <ProgressoNoLivro snapshot={snapshot} leitor={leitor} concluido={concluidos.includes(snapshot.secao.id)} />
      <PilulaDeLeitura pdf={pdf} escala={escalaPdf} aoProximaPagina={pdf ? posicaoDaBarra?.proximo : undefined} />
      {painelEsquerdoAberto && <PainelEsquerdo aoFechar={alternarPainelEsquerdo} vista={vistaEsquerda} aoMudarVista={mudarVistaEsquerda} sumario={sumario}
        miniaturas={pdf ? <Suspense fallback={<p className="painel-leitor-vazio" role="status">Abrindo as páginas…</p>}><MiniaturasDoPdf documento={documentoPdf} atual={paginaAtual} aoIr={irParaPaginaDoPdf} /></Suspense> : undefined} />}

      {avisoExtra}
      <DocumentReader
        numerosDasNotas={numerosDasNotas}
        abertura={abertura}
        aoMudarEscala={definirEscalaPdf}
        aoMudarTotalDePaginas={definirTotalDePaginas}
        aoMudarDocumentoPdf={definirDocumentoPdf}
        aoMudarMargem={atualizarMargemPdf}
        documento_id={documento_id}
        ref={leitor}
        snapshot={comMarcasDoRecorte}
        estrategia={estrategia}
        ativa={ativa}
        margem={estreita || painelAberto ? null : (
          <MarginNotes
            conexaoDaNota={conexaoDaNota}
            pessoais={pessoais}
            notas={notas}
            artigo={raiz}
            leitor={leitor}
            ativa={ativa}
            fixada={fixada}
            acoes={somenteLeitura ? undefined : acoes}
            perguntas={perguntas}
            recolhida={preferencias.margem === 'recolher'}
          />
        )}
        rodape={(
          <div className="rodape-do-leitor">
            {estreita && pessoais && <NotasPessoais notas={pessoais} />}
            {/* Avançar pelo "Próximo capítulo" é o gesto explícito de ter lido este capítulo. */}
            <div onClickCapture={(evento) => {
              if (evento.target instanceof Element && evento.target.closest('[data-avancar]') !== null) {
                progresso.marcarCapituloLido(snapshot.secao.id);
              }
            }}
            >
              {navegacao}
            </div>
            {progresso.aviso === null ? null : (
              <p className="aviso-do-progresso" role="status">{progresso.aviso}</p>
            )}
            {avisoDaMarca === null ? null : (
              <p className="aviso-do-progresso" role="status">{avisoDaMarca}</p>
            )}
          </div>
        )}
      />

      {navegando && <PercorrerDestaques key={snapshot.secao.id} itens={destaques} inicial={inicioDoPercorrer} aoSelecionar={selecionarDestaque} aoFechar={fecharNavegador} />}
      {painelAberto && <PainelDoLeitor snapshot={{ ...snapshot, marcas: [...marcas] }} tituloDocumento={tituloDocumento} tipo={tipoDoDocumento} autor={autor}
        grifos={grifosDoCaderno} numeros={numerosDasNotas} filtros={filtrosDoPainel} {...(extrasDoCaderno ? { extras: extrasDoCaderno } : {})}
        infoExtra={infoDoPainel} {...(estudoDoPainel || percorrerNoEstudo.length > 0 ? { estudo: [...percorrerNoEstudo, ...(estudoDoPainel ?? [])] } : {})}
        aoPercorrer={navegacaoSuspensa ? undefined : () => abrirPercorrer()}
        pessoais={pessoaisDoCaderno ?? pessoais ?? []} conversas={conversasDoPainel} fixada={fixada}
        aoFechar={fecharPainelDocumento} aoIr={(id, ancora) => {
          controlador.fixar(id);
          const faixa = faixaDaAncora(leitor.current, ancora);
          if (faixa) window.scrollBy({ top: faixa.topo - TOPO_UTIL, behavior: 'smooth' });
        }} />}
      {painel}
      {pilha.aviso && <p className="aviso-desfazer" role="status">{pilha.aviso}
        {pilha.desfazivel && <button type="button" onClick={desfazer}>Desfazer <kbd>Z</kbd></button>}
        <button type="button" aria-label="Fechar aviso" onClick={pilha.dispensar}>×</button></p>}
      {ancoraDoFoco && <FocoDoParagrafo leitor={leitor} ancora={ancoraDoFoco} />}
      {paleta && <PaletaDeComandos comandos={comandos} aoFechar={() => abrirPaleta(false)} />}
      {atalhos && <ListaDeAtalhos aoFechar={() => abrirAtalhos(false)} />}
      {marcaDoBalao && <BalaoDaMarca key={marcaDoBalao.id} marca={marcaDoBalao} versaoId={snapshot.versao_id} aoFechar={fecharBalao} funcao={funcaoDoBalao}
        painelInicial={balao?.etiquetas ? 'etiquetas' : null} acoes={{
        remover: () => { removerMarca(marcaDoBalao); },
        anotar: acoesDoBalao ? () => { abrirBalao(null); acoesDoBalao.anotar(marcaDoBalao.ancora, marcaDoBalao.id); } : undefined,
        perguntar: acoesDoBalao ? () => { abrirBalao(null); acoesDoBalao.perguntar(marcaDoBalao.ancora); } : undefined,
        conectar: acoesDoBalao ? () => { abrirBalao(null); acoesDoBalao.conectar(marcaDoBalao.ancora); } : undefined,
        flashcard: acoesDoBalao?.flashcard ? () => { abrirBalao(null); acoesDoBalao.flashcard?.(marcaDoBalao.ancora); } : undefined,
        verNota: marcaDoBalao.funcao === 'nenhuma' && !marcaDoBalao.comentario ? undefined : () => { abrirBalao(null); controlador.fixar(marcaDoBalao.id); },
      }} />}
      {estreita && !painelAberto && <NumerosNaLateral itens={itensDaLateral} leitor={leitor} coluna={colunaDoTexto} />}
      {estreita && !navegando && !painelAberto && marcaFixada !== null && (
        <NoteSheet
          conexao={conexaoDaNota?.(marcaFixada.ancora)}
          marca={marcaFixada}
          numero={numeroDaFixada}
          aoFechar={() => { controlador.fechar(true); }}
        />
      )}
    </div>
    </ContextoDeDesfazer.Provider>
  );
}

export function Atencao({ marcasPorNivel, dificuldades = 0 }: { marcasPorNivel?: readonly number[]; dificuldades?: number } = {}): ReactNode {
  const { preferencias, alterar } = usarAparencia();
  const atual = preferencias.nivelDeAtencao;
  const opcoes = ([0, 1, 2, 3] as const).map((n) => ({
    valor: String(n),
    rotulo: <span className="ponto-atencao" aria-hidden="true" data-preenchido={n <= atual} />,
    nome: `${String(n)} · ${NOMES_DOS_NIVEIS[n]}`,
    ...(marcasPorNivel ? { dica: dicaDoNivel(n, marcasPorNivel[n] ?? 0, dificuldades) } : { dica: NOMES_DOS_NIVEIS[n] }),
  }));
  return <div className="controle-atencao"><span>Atenção</span><SegmentedControl rotulo="Nível de atenção" className="pontos-atencao" valor={String(atual)} opcoes={opcoes}
    aoMudar={(n) => alterar({ tipo: 'alterar', valores: { nivelDeAtencao: Number(n) as 0 | 1 | 2 | 3 } })} /><span className="valor-atencao">{NOMES_DOS_NIVEIS[atual]}</span></div>;
}
