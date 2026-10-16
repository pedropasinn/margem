import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ProgressoNoLivro } from './ProgressoNoLivro';
import { PainelDoLeitor, type ConversasDoPainel, type FiltroDoCaderno, type ItemExtraDoCaderno } from './PainelDoLeitor';
import { Icon } from '../ui/Icon';
import { BotaoDaBarra, MarcasNaBarra, OuvirNaBarra, PosicaoNaBarra, Separador, type AcaoDeOuvir, type PosicaoNaLeitura } from './BarraDoLeitor';
import { PainelEsquerdo, type VistaDoPainelEsquerdo } from './PainelEsquerdo';
import './painel.css';
import './barra.css';
import { PercorrerDestaques, type DestaqueNavegavel, type NavegacaoDeDestaques } from './NavegadorDeDestaques';
import { Button, Popover } from '../ui/Primitives';
import { atalhoNoSistema } from '../ui/teclas';
import { chaveDaFuncaoDaMarca, modoDaMarca, usarFuncoes } from './ContextoDosModos';
import type { SinalDeDificuldade } from './dificuldades';
import { desenhaMarca, grifoNoTexto, marcasVisiveis } from './f2';
import { NotasPessoais, type NotaPessoal } from './NotasPessoais';
import type { MarcaDoLeitor } from './f2';
import {
  lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState,
  type MutableRefObject, type RefObject, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode,
} from 'react';
import type { AncoraV1, Id, ReferenciaModo } from '@margem/contratos';
import { Aparencia, PilulaDeLeitura } from './Aparencia';
import { proximoZoom } from './zoom';
import { usarAparencia, usarMarcasVisiveis } from './ContextoDeAparencia';
import { ProgressoDaRolagem } from './ProgressoDaRolagem';
import { MarginNotes, type AcoesDaNota } from './MarginNotes';
import { NumerosNaLateral, type ItemDaLateral } from './NumerosNaLateral';
import { NoteSheet } from './NoteSheet';
import { BalaoDaMarca, type FuncaoDoBalao } from './BalaoDaMarca';
import { ConfirmarApagar } from '../apagar/ConfirmarApagar';
import { apagarGrifoDeQualquerUm } from '../apagar/api';
import { ContextoDeDesfazer, EVENTO_DESFAZER_DO_MENU, ehDesfazerDoSistema, usePilhaDeDesfazer } from './desfazer';
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
  /** O modo dono da função (sem ele, o do método); o grifo nasce nele e só troca para funções dele. */
  criarGrifo: (ancora: AncoraV1, funcao: string, modo?: ReferenciaModo) => Promise<MarcaDoLeitor>;
  apagarGrifo: (id: Id) => Promise<void>;
  /** Com `modo` (outro olhar), a função é de outro modo: o grifo do leitor passa para ele. */
  trocarFuncao: (id: Id, funcao: string, modo?: ReferenciaModo) => Promise<MarcaDoLeitor>;
  /** Refaz as etiquetas de um grifo recriado pelo desfazer. */
  etiquetar?: (marcaId: Id, nome: string) => Promise<void>;
  /** Refaz a nota de um grifo recriado pelo desfazer (J138: a nota sai com o grifo). */
  restaurarNota?: (marcaId: Id, texto: string) => Promise<void>;
  /** Apaga de vez um grifo do leitor ou do Codex (V-T8); sem ela, a rota `DELETE /api/marcas/:id`. */
  apagarDeVez?: (id: Id) => Promise<unknown>;
}

/** O que o grifar recebe: a nota abre as notas do grifo; a função já sai escolhida; a âncora (área do PDF) troca a seleção. */
export interface OpcoesDoGrifo { nota?: boolean; funcao?: string; modo?: ReferenciaModo | undefined; ancora?: AncoraV1; olhares?: boolean }
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
  /** Ações do balão do grifo que dependem do estudo (perguntar, conectar, flashcard, conexões); sem elas o balão só troca a função, anota e remove. */
  acoesDoBalao?: {
    perguntar: (ancora: AncoraV1) => void;
    conectar: (ancora: AncoraV1) => void;
    flashcard?: (ancora: AncoraV1) => void;
    /** As conexões do trecho (no painel do trecho). */
    conexoes?: (ancora: AncoraV1) => void;
  } | undefined;
  /** J138: os sinais de dificuldade que cruzam um trecho (para o balão do grifo). */
  dificuldadesDoTrecho?: ((ancora: AncoraV1) => SinalDeDificuldade[]) | undefined;
  /** J138: quantas conexões passam por um trecho (para o balão do grifo). */
  conexoesDoTrecho?: ((ancora: AncoraV1) => number) | undefined;
  /** J138: recebe a função que abre o balão de um grifo (a margem abre o grifo pela nota dele). */
  abrirBalaoRef?: MutableRefObject<((marcaId: Id, opcoes?: { nota?: boolean }) => void) | null> | undefined;
  /** Abaixo do título, no texto único (autor e tempo de leitura). */
  abertura?: ReactNode;
  /** Chips a mais no topo do Caderno (a camada, quando há mais de uma). */
  filtrosDoCaderno?: ReactNode;
  /** Itens do Caderno que vêm do estudo: relações, exercícios, visuais. */
  extrasDoCaderno?: readonly ItemExtraDoCaderno[];
  /** Abaixo dos metadados do Info ("Primeiro eu", "Um caminho para a sua leitura"). */
  infoDoPainel?: ReactNode;
  /** A lista da aba Estudo do painel (agrupada por `grupo`). */
  estudoDoPainel?: readonly AcaoDeOuvir[];
  /** O que abre a aba Estudo, antes da lista (a síntese do capítulo). */
  estudoTopoDoPainel?: ReactNode;
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
  /** O painel do trecho (nota, perguntar, conexões, flashcard), no mesmo trilho do painel do documento. */
  painel?: ReactNode;
  /** Fecha o painel do trecho: o botão do painel do documento troca um pelo outro. */
  aoFecharPainel?: (() => void) | undefined;
  /** Recebe a função que abre o painel do documento (o "← Documento" do trecho). */
  painelDocumentoRef?: MutableRefObject<(() => void) | null> | undefined;
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
  grifarRef?: MutableRefObject<((opcoes?: OpcoesDoGrifo) => void) | null> | undefined;
  /** A âncora da seleção atual, se houver: `H` grifa a seleção antes do parágrafo em foco. */
  selecaoAtual?: (() => AncoraV1 | null) | undefined;
  /** Depois de grifar, apagar ou trocar a função: o chamador recarrega o capítulo. */
  aoMudarMarcas?: (() => void) | undefined;
  /** Comandos de quem envolve o leitor (estudo, biblioteca), somados aos do leitor na paleta. */
  comandos?: readonly Comando[] | undefined;
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
  perguntas, aoMudarCapitulos, limiarDaMargem, atrasoDoCorredorMs, atrasoDoProgressoMs, aparenciaAberta = false, navegacao, abertura, acoesDoBalao, filtrosDoCaderno, extrasDoCaderno, infoDoPainel, estudoDoPainel, estudoTopoDoPainel, aoMudarPainel, acoesDaBarra, aparenciaExtra, menuExtra, voltar, sumario, posicao: posicaoDoTexto, irParaPagina, paginaDestino = null, ouvir = SEM_OUVIR, aoSelecionarArea, avisoExtra, painel, aoFecharPainel, painelDocumentoRef, pessoais, conexaoDaNota, extrasDaLateral = SEM_EXTRAS,
  tituloDocumento, tipoDoDocumento, autor, conversasDoPainel, pessoaisDoCaderno, estudoAberto = false,
  edicao, grifarRef, selecaoAtual, aoMudarMarcas, comandos: comandosDeFora = SEM_COMANDOS, somenteLeitura = false,
  dificuldadesDoTrecho, conexoesDoTrecho, abrirBalaoRef,
}: PropsDoControlador): ReactNode {
  const { preferencias, alterar } = usarAparencia();
  const { daMarca, rotulo, rotuloDaMarca, nomeDoModo } = usarFuncoes();
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
  // Com o painel do trecho aberto no mesmo trilho, o botão (e o "← Documento" do trecho) troca para o do documento.
  const alternarPainelDocumento = useCallback(() => {
    if (painel && aoFecharPainel) { aoFecharPainel(); abrirNavegador(false); gravarPainel(true); definirPainelDocumento(true); return; }
    if (painelDisponivel) { abrirNavegador(false); gravarPainel(!painelDocumento); definirPainelDocumento(!painelDocumento); }
  }, [painelDisponivel, painelDocumento, painel, aoFecharPainel]);
  useEffect(() => {
    if (!painelDocumentoRef) return;
    painelDocumentoRef.current = () => { if (aoFecharPainel) aoFecharPainel(); abrirNavegador(false); gravarPainel(true); definirPainelDocumento(true); };
    return () => { painelDocumentoRef.current = null; };
  }, [painelDocumentoRef, aoFecharPainel]);
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
  // O balão sobre o grifo tocado (o recém-criado pelo H abre com as cores); a pilha de desfazer (J37).
  const [balao, definirBalao] = useState<{ id: Id; nota?: boolean; olhares?: boolean } | null>(null);
  const abrirBalao = useCallback((id: Id | null, opcoes: { nota?: boolean; olhares?: boolean } = {}) => { definirBalao(id === null ? null : { id, ...opcoes }); }, []);
  useEffect(() => {
    if (!abrirBalaoRef) return;
    abrirBalaoRef.current = (id, opcoes) => { abrirBalao(id, opcoes); };
    return () => { abrirBalaoRef.current = null; };
  }, [abrirBalaoRef, abrirBalao]);
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

  // V-T3: todas as marcas, ou nenhuma (o botão "Marcas"); a saliência não filtra mais.
  const [marcasAVista, mostrarMarcas] = usarMarcasVisiveis(documento_id);
  const visiveis = useMemo(() => marcasVisiveis(marcasFiltradas(marcas, filtro), marcasAVista).filter((m) => !tiposOcultos.includes(chaveDaFuncaoDaMarca(m))), [filtro, marcas, marcasAVista, tiposOcultos]);
  // Marca oculta sai do texto, mas a nota fica na margem só com o número, para poder ser reaberta.
  const ocultasComNota = useMemo(() => filtro.recorte === 'ocultas' ? [] : marcasVisiveis(marcasFiltradas(marcas, { ...filtro, recorte: 'ocultas' }), marcasAVista)
    .filter((m) => m.validade === 'resolvida' && m.comentario !== null && !tiposOcultos.includes(chaveDaFuncaoDaMarca(m))), [filtro, marcas, marcasAVista, tiposOcultos]);
  const notas = useMemo(() => notasDoCapitulo(snapshot.blocos, [...visiveis, ...ocultasComNota]), [snapshot.blocos, visiveis, ocultasComNota]);
  const destaques = useMemo<DestaqueNavegavel[]>(() => {
    const ordem = new Map(snapshot.blocos.map((bloco, indice) => [bloco.id, indice]));
    return [...marcas.filter((marca) => marca.visivel && marca.validade === 'resolvida' && marca.avaliacao !== 'rejeitada' && desenhaMarca(marca)).map((marca): DestaqueNavegavel => ({
      id: marca.id, tipo: 'grifo', ancora: marca.ancora,
      titulo: marca.comentario?.rotulo ?? rotuloDaMarca(marca),
      texto: marca.comentario?.texto ?? '', cor: daMarca(marca),
    })), ...relacoesParaNavegar].sort((a, b) => (ordem.get(a.ancora.bloco_id) ?? Infinity) - (ordem.get(b.ancora.bloco_id) ?? Infinity) || a.ancora.inicio_utf16 - b.ancora.inicio_utf16);
  // rótulo e cor mudam com os modos e o tema, que mudam as marcas
  }, [snapshot.blocos, marcas, relacoesParaNavegar]);
  const destaque = destaques.find((item) => item.id === destaqueId) ?? null;
  const navegando = navegadorAberto && !navegacaoSuspensa;
  const grifoNavegado = navegando && destaque?.tipo === 'grifo' ? destaque.id : null;
  const fecharNavegador = useCallback(() => { abrirNavegador(false); selecionarDestaque(null); controlador.fechar(false); }, [controlador.fechar]);
  const abrirPercorrer = useCallback((inicio: string | null = null) => { definirPainelDocumento(false); controlador.fechar(false); abrirBalao(null); definirInicioDoPercorrer(inicio); abrirNavegador(true); }, [controlador.fechar, abrirBalao]);
  useEffect(() => { abrirNavegador(false); selecionarDestaque(null); }, [snapshot.secao.id, snapshot.camada, navegacaoSuspensa]);
  const relacaoNavegada = navegando && destaque?.tipo === 'braquete' ? destaque.id : null;
  useEffect(() => { aoNavegarDestaques?.({ aberta: navegando, relacaoId: relacaoNavegada, cartao: true }); }, [navegando, relacaoNavegada, aoNavegarDestaques]);
  const ancoraNavegada = destaque?.ancora;
  useEffect(() => {
    if (!grifoNavegado || !ancoraNavegada) return;
    // Vindo de uma relação que recolheu o texto entre as pontas, a dobra se desfaz depois deste efeito
    // (o braquete só sabe da navegação no render seguinte) e, ao se desfazer, mexe na rolagem. Então
    // espera não haver mais texto recolhido e mede um quadro depois, com a página inteira de volta; o
    // quadro extra também deixa o leitor redesenhar um grifo que estava oculto.
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
  // A nota do leitor de cada grifo (J138): dentro da nota do grifo na margem, como uma linha ✎.
  const notasDoLeitor = useMemo(() => new Map((snapshot.anotacoes ?? []).flatMap((anotacao) => anotacao.marca_id ? [[anotacao.marca_id, anotacao.texto] as const] : [])), [snapshot.anotacoes]);
  const numerosDasNotas = useMemo(() => new Map(notas.map((nota) => [nota.marca.id, nota.numero])), [notas]);
  const comMarcasDoRecorte = useMemo<SnapshotCapitulo>(
    () => ({ ...snapshot, marcas: [...visiveis, ...marcas.filter((m) => m.id === grifoNavegado && !visiveis.some((v) => v.id === m.id))] }), [snapshot, visiveis, marcas, grifoNavegado],
  );
  const origens = useMemo(() => origensPresentes(marcas), [marcas]);
  // Chips do Caderno: as funções que de fato aparecem nos grifos do capítulo (a legenda das cores, sem a
  // interna "nenhuma"), cada uma no modo do seu grifo (J138: grifos de vários modos convivem). Rótulos
  // iguais em modos diferentes ganham o nome do modo.
  const funcoesPresentes = useMemo(() => {
    const lista = [...new Map(marcas.filter((m) => m.funcao !== 'nenhuma' && desenhaMarca(m)).map((m) => [chaveDaFuncaoDaMarca(m), m] as const)).entries()]
      .map(([chave, marca]) => ({ chave, rotulo: rotuloDaMarca(marca), modo: modoDaMarca(marca), cor: daMarca(marca),
        total: marcas.filter((m) => chaveDaFuncaoDaMarca(m) === chave && grifoNoTexto(m)).length }));
    return lista.map((f) => (lista.some((outra) => outra !== f && outra.rotulo === f.rotulo) ? { ...f, rotulo: `${f.rotulo} · ${nomeDoModo(f.modo)}` } : f));
  // rótulo, cor e nome do modo derivam dos modos, estáveis no capítulo
  }, [marcas]);
  const temIa = origens.some((origem) => origem !== 'manual');
  const temMinhas = origens.includes('manual');
  const ocultas = marcas.filter((m) => !m.visivel).length;
  // Uma linha de filtro no Caderno (J132): um seletor só, que também vale para o texto (funções, origem, recorte).
  const [filtroDoCaderno, definirFiltroDoCaderno] = useState('tudo');
  const escolherFiltroDoCaderno = useCallback((valor: string) => {
    definirFiltroDoCaderno(valor);
    const tipo = valor.slice(0, valor.indexOf(':') < 0 ? valor.length : valor.indexOf(':'));
    const chave = valor.indexOf(':') < 0 ? undefined : valor.slice(valor.indexOf(':') + 1);
    ocultarTipos(tipo === 'f' ? [...new Set(marcas.map(chaveDaFuncaoDaMarca))].filter((f) => f !== chave) : []);
    definirFiltro({ ...FILTRO_PADRAO, ...(tipo === 'o' ? { origem: chave as FiltroDeMarcas['origem'] } : {}), ...(tipo === 'r' ? { recorte: chave as FiltroDeMarcas['recorte'] } : {}) });
  }, [marcas]);
  const filtrosDoPainel: FiltroDoCaderno = { valor: filtroDoCaderno, aoMudar: escolherFiltroDoCaderno, opcoes: [
    ...funcoesPresentes.map((f) => ({ valor: `f:${f.chave}`, rotulo: `${f.rotulo} (${String(f.total)})` })),
    ...(temIa && temMinhas ? [{ valor: 'o:ia', rotulo: 'Só os da IA' }, { valor: 'o:manual', rotulo: 'Só os meus grifos' }] : []),
    { valor: 'r:confirmadas', rotulo: 'Confirmadas' },
    ...(ocultas > 0 ? [{ valor: 'r:ocultas', rotulo: `Ocultas (${String(ocultas)})` }] : []),
  ] };
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
    // Espaço também ativa os alvos que se apresentam como botão: o número da nota e o alvo do grifo no PDF (U-09).
    const espacoNoBotao = evento.key === ' ' && evento.target instanceof Element && evento.target.matches('.nota-numero[role="button"], .pdf-alvos [role="button"]');
    if (evento.key !== 'Enter' && !espacoNoBotao) return;
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
      // A nota sai com o grifo (o balão pede confirmação); desfazer devolve as duas coisas.
      const nota = (snapshot.anotacoes ?? []).find((anotacao) => anotacao.marca_id === marca.id)?.texto;
      definirMarcas((atuais) => atuais.filter((item) => item.id !== marca.id));
      edicao.apagarGrifo(marca.id).then(() => {
        // Restaurar tem etapas (grifo, etiquetas, nota): as já feitas ficam guardadas, e uma nova tentativa
        // depois de uma falha no meio não recria o grifo nem repete a etiqueta (U-06, I-10).
        let recriada: MarcaDoLeitor | null = null;
        const etiquetadas = new Set<string>();
        let notaRestaurada = false;
        pilha.registrar({ rotulo: nota ? 'Grifo e anotação removidos' : 'Grifo apagado', desfazer: async () => {
          if (recriada === null) {
            recriada = await edicao.criarGrifo(marca.ancora, marca.funcao, 'modo' in marca ? marca.modo : undefined);
            apelidos.current.set(marca.id, recriada.id);
            inserir(recriada);
          }
          const nova = recriada;
          if (edicao.etiquetar) for (const nome of etiquetas) {
            if (etiquetadas.has(nome)) continue;
            await edicao.etiquetar(nova.id, nome);
            etiquetadas.add(nome);
          }
          if (nota && edicao.restaurarNota && !notaRestaurada) { await edicao.restaurarNota(nova.id, nota); notaRestaurada = true; }
          aoMudarMarcas?.();
        } });
        aoMudarMarcas?.();
      }, (falha: unknown) => { inserir(marca); falhou(falha, 'Não foi possível apagar o grifo.'); });
      return;
    }
    const antes = marca.avaliacao;
    aplicarMudanca(marca.id, { avaliacao: 'rejeitada' });
    pilha.registrar({ rotulo: 'Marca removida', desfazer: () => { aplicarMudanca(idAtual(marca.id), { avaliacao: antes === 'rejeitada' ? 'nao_avaliada' : antes }); } });
  }, [abrirBalao, controlador, edicao, snapshot.etiquetas, snapshot.anotacoes, pilha, inserir, aoMudarMarcas, falhou, aplicarMudanca, idAtual]);

  // "Remover grifo" no balão (V-T8): exclusão real, do leitor ou do Codex, com a nota e os sinais do grifo.
  // Não há desfazer, então pede confirmação; depois, quem chama recarrega o capítulo.
  const [apagando, definirApagando] = useState<MarcaDoLeitor | null>(null);
  const pedirApagar = useCallback((marca: MarcaDoLeitor) => { abrirBalao(null); definirApagando(marca); }, [abrirBalao]);
  const apagarDeVez = useCallback(async (marca: MarcaDoLeitor) => {
    await (edicao?.apagarDeVez ?? apagarGrifoDeQualquerUm)(marca.id);
    controlador.fechar(true);
    definirMarcas((atuais) => atuais.filter((item) => item.id !== marca.id));
    aoMudarMarcas?.();
  }, [edicao, controlador, aoMudarMarcas]);

  const funcaoDaIa = useCallback((marca: MarcaDoLeitor): string | undefined => {
    if (marca.origem === 'manual') return undefined;
    const local = funcoesDaIa[marca.id];
    if (local !== undefined) return local ?? undefined;
    return snapshot.edicoes?.[marca.id]?.funcao_da_ia;
  }, [funcoesDaIa, snapshot.edicoes]);

  const trocarFuncao = useCallback(async (marca: MarcaDoLeitor, funcao: string, registrar = true, modo?: ReferenciaModo) => {
    if (!edicao) return;
    // Outro olhar sobre a marca da IA: ela fica no modo da execução dela (com o comentário do Codex); o
    // leitor ganha um grifo seu no mesmo trecho, com aquele olhar.
    if (modo !== undefined && marca.origem !== 'manual') {
      const nova = await edicao.criarGrifo(marca.ancora, funcao, modo);
      inserir(nova);
      pilha.registrar({ rotulo: `Grifo: ${rotulo(funcao, modo).toLocaleLowerCase('pt-BR')}`, desfazer: async () => {
        const id = idAtual(nova.id); await edicao.apagarGrifo(id); definirMarcas((atuais) => atuais.filter((item) => item.id !== id)); aoMudarMarcas?.();
      } });
      abrirBalao(nova.id);
      aoMudarMarcas?.();
      return;
    }
    const antes = marca.funcao;
    const modoAntes = modoDaMarca(marca);
    const nova = await edicao.trocarFuncao(idAtual(marca.id), funcao, modo);
    substituir(nova);
    if (marca.origem !== 'manual') {
      const original = funcaoDaIa(marca) ?? antes;
      definirFuncoesDaIa((atuais) => ({ ...atuais, [marca.id]: funcao === original ? null : original }));
    }
    if (registrar) pilha.registrar({ rotulo: `Função: ${funcao === 'nenhuma' ? 'nenhuma' : rotulo(funcao, modo ?? modoAntes).toLocaleLowerCase('pt-BR')}`,
      desfazer: () => trocarFuncao(nova, antes, false, modo !== undefined ? modoAntes : undefined) });
    aoMudarMarcas?.();
  // `rotulo` deriva dos modos, estáveis no capítulo
  }, [edicao, idAtual, substituir, funcaoDaIa, pilha, aoMudarMarcas, inserir, abrirBalao]);

  const funcaoDoBalao = useMemo<FuncaoDoBalao | undefined>(() => (edicao && marcaDoBalao ? {
    trocar: (funcao, modo) => trocarFuncao(marcaDoBalao, funcao, true, modo), daIa: funcaoDaIa(marcaDoBalao),
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

  const grifar = useCallback(async ({ nota: anotar = false, ancora: dada, funcao, modo, olhares = false }: OpcoesDoGrifo = {}) => {
    if (!edicao) return;
    const selecionada = dada ?? selecaoAtual?.() ?? null;
    const ancora = selecionada ?? ancoraDoFoco;
    if (!ancora) { pilha.avisar('Escolha um parágrafo com ↑ ↓ ou selecione um trecho.'); return; }
    const mesmo = marcasRef.current.find((marca) => marca.origem === 'manual' && marca.ancora.bloco_id === ancora.bloco_id
      && marca.ancora.inicio_utf16 === ancora.inicio_utf16 && marca.ancora.fim_utf16 === ancora.fim_utf16);
    if (mesmo) {
      // De novo sobre o mesmo trecho: H apaga o grifo (o com nota abre o balão, onde remover pede confirmação); N abre a nota.
      const comNota = (snapshot.anotacoes ?? []).some((anotacao) => anotacao.marca_id === mesmo.id);
      if (anotar || comNota || olhares) abrirBalao(mesmo.id, { nota: anotar, olhares }); else removerMarca(mesmo);
      return;
    }
    try {
      const marca = await edicao.criarGrifo(ancora, funcao ?? 'nenhuma', modo);
      window.getSelection()?.removeAllRanges();
      inserir(marca);
      pilha.registrar({ rotulo: 'Grifo criado', desfazer: async () => {
        const id = idAtual(marca.id);
        await edicao.apagarGrifo(id);
        definirMarcas((atuais) => atuais.filter((item) => item.id !== id));
        aoMudarMarcas?.();
      } });
      // O balão do grifo abre ao grifar (J138): as funções, a nota (com o cursor nela pelo N) e o resto do trecho.
      abrirBalao(marca.id, { nota: anotar, olhares });
      aoMudarMarcas?.();
    } catch (falha) {
      // Sobreposto a um grifo dele: abre o balão daquele, em vez de um segundo grifo.
      const vizinha = marcasRef.current.find((marca) => marca.origem === 'manual' && marca.ancora.bloco_id === ancora.bloco_id
        && marca.ancora.inicio_utf16 < ancora.fim_utf16 && ancora.inicio_utf16 < marca.ancora.fim_utf16);
      if (vizinha) { abrirBalao(vizinha.id, { nota: anotar, olhares }); return; }
      falhou(falha, 'Não foi possível grifar.');
    }
  }, [edicao, selecaoAtual, ancoraDoFoco, pilha, removerMarca, inserir, idAtual, aoMudarMarcas, abrirBalao, falhou, snapshot.anotacoes]);

  useEffect(() => {
    if (!grifarRef) return;
    grifarRef.current = (opcoes) => { void grifar(opcoes); };
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
      { id: 'grifar', grupo: 'Marcas', rotulo: 'Grifar o parágrafo (ou a seleção)', atalho: 'H', palavras: 'highlight destacar', executar: () => { void grifar(); } },
      { id: 'grifar-anotar', grupo: 'Marcas', rotulo: 'Grifar com nota', atalho: 'N', palavras: 'nota anotar escrever', executar: () => { void grifar({ nota: true }); } },
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
    { id: 'marcas', grupo: 'Visual', rotulo: marcasAVista ? 'Ocultar as marcas' : 'Mostrar as marcas', palavras: 'grifos marcas texto limpo esconder', executar: () => mostrarMarcas(!marcasAVista) },
    ...([['grifo', 'Grifo'], ['marca_texto', 'Marca-texto'], ['sublinhado', 'Sublinhado']] as const).map(([estilo, rotulo]) => ({ id: `estilo-${estilo}`, grupo: 'Visual', rotulo: `Estilo das marcas: ${rotulo}`,
      executar: () => alterar({ tipo: 'alterar', valores: { estilo } }) })),
    ...([['claro', 'Claro'], ['escuro', 'Escuro'], ['sepia', 'Sépia'], ['sistema', 'Do sistema']] as const).map(([tema, rotulo]) => ({ id: `tema-${tema}`, grupo: 'Visual', rotulo: `Tema: ${rotulo}`, palavras: 'aparência cor',
      executar: () => alterar({ tipo: 'alterar', valores: { tema } }) })),
    ...comandosDeFora,
    { id: 'atalhos', grupo: 'Ajuda', rotulo: 'Atalhos do teclado', atalho: '?', executar: () => abrirAtalhos(true) },
  ], [navegacaoSuspensa, navegando, fecharNavegador, abrirPercorrer, mover, edicao, grifar, desfazer, esquerdaOculta, preferencias.margem, alternarMargem, alternarPainelDocumento, alterar, comandosDeFora, pdf, zoom, temPainelEsquerdo, painelEsquerdoAberto, alternarPainelEsquerdo, posicaoDaBarra, marcasAVista, mostrarMarcas]);

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
      // Ctrl/⌘ Z fora dos campos: a pilha do leitor (U-05). Num campo, fica o desfazer do próprio campo.
      if (ehDesfazerDoSistema(evento) && !evento.defaultPrevented && !digitando(evento.target) && document.querySelector('[aria-modal="true"]') === null) {
        evento.preventDefault(); desfazer(); return;
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
        evento.preventDefault(); void grifar({ nota: tecla.toLowerCase() === 'n' });
      }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [mover, alternarPainelDocumento, alternarMargem, desfazer, balao, foco, edicao, grifar, pdf, zoom, temPainelEsquerdo, alternarPainelEsquerdo, posicaoDaBarra, aoSelecionarArea, sumario, vistaEsquerda, mudarVistaEsquerda]);
  // Editar → Desfazer no menu do app de computador: chega como evento quando o foco não está num campo.
  useEffect(() => {
    window.addEventListener(EVENTO_DESFAZER_DO_MENU, desfazer);
    return () => window.removeEventListener(EVENTO_DESFAZER_DO_MENU, desfazer);
  }, [desfazer]);
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
      descricao: `Nota ${String(nota.numero)}: ${nota.comentario.rotulo}`,
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
          <MarcasNaBarra visiveis={marcasAVista} aoMudar={mostrarMarcas} />
          {ouvir.length > 0 && <OuvirNaBarra acoes={ouvir} />}
          <Separador />
          <BotaoDaBarra ref={botaoPainel} rotulo="Painel do documento" atalho="]" icone="painel-direito" aria-expanded={painelAberto} disabled={!painelDisponivel && !aoFecharPainel} onClick={alternarPainelDocumento} />
          <BotaoDaBarra ref={botaoMenu} rotulo="Mais opções" aria-label="Mais opções do leitor" icone="reticencias" aria-expanded={menu} onClick={() => abrirMenu(!menu)} />
        </div>
        {menu && <Popover ancora={botaoMenu} aoFechar={() => abrirMenu(false)} rotulo="Mais opções" largura={260} className="menu-da-barra">
          {/* Só o raro: cada ação fecha o menu antes de abrir a sua janela. */}
          <ul className="lista-de-acoes" onClick={(evento) => { if (evento.target instanceof Element && evento.target.closest('button, a')) abrirMenu(false); }}>
            {menuExtra}
            <li><Button variante="ghost" onClick={() => abrirPaleta(true)}><Icon name="buscar" size={18} /><span><span className="acao-rotulo">Paleta de comandos</span><span className="acao-detalhe">{atalhoNoSistema('Ctrl K')}</span></span></Button></li>
            <li><Button variante="ghost" onClick={() => abrirAtalhos(true)}><Icon name="info" size={18} /><span><span className="acao-rotulo">Atalhos do teclado</span><span className="acao-detalhe">?</span></span></Button></li>
          </ul>
        </Popover>}
      </nav>
      <ProgressoNoLivro snapshot={snapshot} leitor={leitor} concluido={concluidos.includes(snapshot.secao.id)}
        ultimaParte={pdf ? totalDePaginas !== null && (snapshot.paginas?.fim ?? 0) >= totalDePaginas : !snapshot.proxima} />
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
        margem={estreita || painelAberto || painel ? null : (
          <MarginNotes
            conexaoDaNota={conexaoDaNota}
            notasDoLeitor={notasDoLeitor}
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
        grifos={grifosDoCaderno} numeros={numerosDasNotas} filtro={filtrosDoPainel} filtros={filtrosDoCaderno} {...(extrasDoCaderno ? { extras: extrasDoCaderno } : {})}
        infoExtra={infoDoPainel} estudoTopo={estudoTopoDoPainel} {...(estudoDoPainel ? { estudo: estudoDoPainel } : {})}
        aoPercorrer={navegacaoSuspensa ? undefined : () => abrirPercorrer()}
        pessoais={pessoaisDoCaderno ?? pessoais ?? []} conversas={conversasDoPainel} fixada={fixada}
        aoFechar={fecharPainelDocumento} aoIr={(id, ancora) => {
          controlador.fixar(id);
          const faixa = faixaDaAncora(leitor.current, ancora);
          if (faixa) window.scrollBy({ top: faixa.topo - TOPO_UTIL, behavior: 'smooth' });
        }} />}
      {painel}
      {pilha.aviso && <p className="aviso-desfazer" role="status">{pilha.aviso}
        {pilha.desfazivel && <button type="button" onClick={desfazer} disabled={pilha.desfazendo}>Desfazer <kbd>Z</kbd></button>}
        <button type="button" aria-label="Fechar aviso" onClick={pilha.dispensar}>×</button></p>}
      {ancoraDoFoco && <FocoDoParagrafo leitor={leitor} ancora={ancoraDoFoco} />}
      {paleta && <PaletaDeComandos comandos={comandos} aoFechar={() => abrirPaleta(false)} />}
      {atalhos && <ListaDeAtalhos aoFechar={() => abrirAtalhos(false)} />}
      {marcaDoBalao && <BalaoDaMarca key={marcaDoBalao.id} marca={marcaDoBalao} aoFechar={fecharBalao} funcao={funcaoDoBalao}
        nota={(snapshot.anotacoes ?? []).find((anotacao) => anotacao.marca_id === marcaDoBalao.id) ?? null}
        dificuldades={dificuldadesDoTrecho?.(marcaDoBalao.ancora) ?? []} conexoes={conexoesDoTrecho?.(marcaDoBalao.ancora) ?? 0}
        focarNota={balao?.nota === true} olharesAbertos={balao?.olhares === true} aoMudar={aoMudarMarcas}
        acoes={{
        remover: () => { pedirApagar(marcaDoBalao); },
        perguntar: acoesDoBalao ? () => { abrirBalao(null); acoesDoBalao.perguntar(marcaDoBalao.ancora); } : undefined,
        conectar: acoesDoBalao ? () => { abrirBalao(null); acoesDoBalao.conectar(marcaDoBalao.ancora); } : undefined,
        flashcard: acoesDoBalao?.flashcard ? () => { abrirBalao(null); acoesDoBalao.flashcard?.(marcaDoBalao.ancora); } : undefined,
        conexoes: acoesDoBalao?.conexoes ? () => { abrirBalao(null); acoesDoBalao.conexoes?.(marcaDoBalao.ancora); } : undefined,
      }} />}
      {apagando && (() => {
        const nota = (snapshot.anotacoes ?? []).some((anotacao) => anotacao.marca_id === apagando.id);
        const sinais = (snapshot.dificuldades ?? []).filter((d) => d.marca_id === apagando.id).length;
        const comentado = apagando.origem !== 'manual' && apagando.comentario !== null;
        return <ConfirmarApagar titulo="Remover este grifo?"
          texto={apagando.origem === 'manual' ? undefined : 'O grifo é do Codex: ele sai da análise deste capítulo.'}
          itens={[`“${apagando.ancora.citacao.length > 80 ? `${apagando.ancora.citacao.slice(0, 80)}…` : apagando.ancora.citacao}”`,
            ...(comentado ? ['o comentário do Codex'] : []), ...(nota ? ['a sua nota'] : []),
            ...(sinais > 0 ? [sinais === 1 ? '1 sinal de dificuldade' : `${String(sinais)} sinais de dificuldade`] : [])]}
          rotuloDoBotao="Remover" aoConfirmar={() => apagarDeVez(apagando)} aoFechar={() => definirApagando(null)} />;
      })()}
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
