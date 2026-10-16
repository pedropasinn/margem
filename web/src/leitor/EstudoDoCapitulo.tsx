import { SinteseDoCapitulo } from './SinteseDoCapitulo';
import { AcoesDaSelecao, BarraDeSelecao, IconeDaSelecao } from './BarraDeSelecao';
import { Blocos } from './Aparencia';
import { Icon } from '../ui/Icon';
import { atalhoNoSistema } from '../ui/teclas';
import { PlayerDeMidia } from './midia/PlayerDeMidia';
import { useFontesDeReproducao } from './midia/fontes';
import { useNarracao } from '../audio/useNarracao';
import { GerarNarracao } from '../audio/GerarNarracao';
import type { AcaoDeOuvir } from './BarraDoLeitor';
import type { DestaqueNavegavel, NavegacaoDeDestaques } from './NavegadorDeDestaques';
import { LARGURA_DA_MARGEM, useTelaEstreita } from './hooks/useTelaEstreita';
import { Button, IconButton, Select, Drawer } from '../ui/Primitives';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AncoraV1, AnotacaoV1, ConexaoV2, ElementoSemanticoV1, ReferenciaModo, RelacaoConexao, TipoRelacaoSemantica } from '@margem/contratos';
import { ErroDaApi, type RelacaoDoCapitulo, apagarGrifo, baixarPdfAnotado, criarEtiqueta, criarGrifo, criarResolucao, escrever, gravarNotaDoGrifo, gravarPreferenciasDoDocumento, resolucoesDoDocumento, trocarFuncaoDaMarca, type SessaoDaApi } from '../biblioteca/api';
import { NotasDoGrifo } from './NotasDoGrifo';
import { atalhoDeUmaTeclaDesligado, digitando, type Comando } from './teclado/comandos';
import { ReaderController, type EdicaoDoLeitor, type OpcoesDoGrifo, type PropsDoControlador } from './ReaderController';
import { ContextoDosModos, lembrarOlharNoDocumento, mesmaReferencia, modoDaMarca, olharesLembrados, type Olhar } from './ContextoDosModos';
import { cruza, sinaisDoCapitulo, sinaisVisiveis, type SinalDeDificuldade } from './dificuldades';
import { LinhaDaDificuldade } from './BalaoDaMarca';
import { usaPdf } from './DocumentReader';
import { nomeDaUnidade, usarForma } from './forma';
import { usarMarcasVisiveis } from './ContextoDeAparencia';
import { usarEscolhaDeDestino } from './ContextoDeConexao';
import { ancoraDaSelecao, type SelecaoDoLeitor } from './selecao';
import { liberarPrimeiroEu, rotuloCamada } from './f2';
import { DialogoDeConexao, ListaDeConexoes } from './Conexoes';
import { FioDeConversa } from './FioDeConversa';
import { FormularioDeFlashcard } from '../flashcards/FormularioDeFlashcard';
import { PainelDoTrecho, type AbaDoTrecho } from './PainelDoTrecho';
import type { NotaPessoal } from './NotasPessoais';
import type { ItemDaLateral } from './NumerosNaLateral';
import type { ApiDoLeitor, PontoDeTexto } from './tipos';
import { compreensaoDaCamada, useCompreensao } from './compreensao/useCompreensao';
import { ROTULO_DA_RELACAO, ROTULO_DA_DIFICULDADE } from './compreensao/rotulos';
import { VisitaGuiada, type FocoDaVisita } from './visita/VisitaGuiada';
import { useVisita } from './visita/useVisita';
import { consumirContinuacao } from './visita/retomada';
import { LeituraComentada, type FocoDaLeitura } from './comentada/LeituraComentada';
import { useLeituraComentada } from './comentada/useLeituraComentada';
import { OuvirDaqui } from './voz/OuvirDaqui';
import { vozDisponivel } from './voz/voz';
import { consumirContinuacaoDaLeitura } from './comentada/retomada';
import { Braquetes, type FiltroDeRelacoes, type VisualizacaoDeRelacoes } from './compreensao/Braquetes';
import { PerfilDoLeitor } from './compreensao/PerfilDoLeitor';
import { corDaRelacao } from './compreensao/cores';
import { MapaDoCapitulo } from './compreensao/MapaDoCapitulo';
import { FerramentaDeArea } from './resolucao/FerramentaDeArea';
import type { IntencaoDeLeitura } from '../biblioteca/intencao';
import { SessaoDeResolucao } from './resolucao/SessaoDeResolucao';
import { ListaDeResolucoes } from './resolucao/ListaDeResolucoes';
import { TextoComMatematica } from './resolucao/Matematica';
import { ordemNoTexto, type ItemExtraDoCaderno } from './PainelDoLeitor';
import { ExerciciosNaPagina } from './resolucao/ExerciciosNaPagina';
import './resolucao/resolucao.css';
import { apagarVisual, criarVisual, regenerarVisual, urlDaImagem } from './visuais/api';
import { useVisuais, type SerieDeVisuais } from './visuais/useVisuais';
import { NotaDoVisual, PainelDoVisual, VisuaisDoCapitulo, VisualAmpliado, rotuloDoVisual, type PedidoDeVisual } from './visuais/Visuais';
import './estudo.css';
import './compreensao/compreensao.css';
import { LinkDoEink } from '../eink/LinkDoEink';


/** O painel do trecho: a nota (do grifo, ou uma anotação antiga), a conversa, as conexões (com o formulário aberto em "conectar") ou o flashcard. */
type Painel = { tipo: 'anotar'; ancora: AncoraV1; anotacao?: AnotacaoV1; marcaId?: string } | { tipo: 'perguntar'; ancora: AncoraV1; id: string | null } | { tipo: 'conectar' | 'conexoes' | 'flashcard'; ancora: AncoraV1 };
const ABA_DO_PAINEL: Record<Painel['tipo'], AbaDoTrecho | null> = { anotar: 'nota', perguntar: 'perguntar', conectar: 'conexoes', conexoes: 'conexoes', flashcard: null };
/** Como uma conexão do leitor se lê no braquete: o verbo mais próximo entre as relações da compreensão. */
const TIPO_DA_CONEXAO: Record<RelacaoConexao, TipoRelacaoSemantica> = { semelhanca: 'ecoa', contraste: 'contrasta', tensao: 'tensiona', prerequisito: 'pressupoe', desenvolve: 'desenvolve', exemplo: 'exemplifica' };
/** Uma ponta de conexão como elemento do braquete: só a âncora importa para o desenho. */
function elementoDaConexao(id: string, ancora: AncoraV1): ElementoSemanticoV1 {
  return { id, papel: null, ancoras: [ancora], enunciado: ancora.citacao, qualificadores: [], notas: [] } as unknown as ElementoSemanticoV1;
}
const mesmaAncora = (a: AncoraV1, b: AncoraV1) => a.bloco_id === b.bloco_id && a.inicio_utf16 === b.inicio_utf16 && a.fim_utf16 === b.fim_utf16;
export interface PropsDoEstudo extends PropsDoControlador {
  aoAtualizar: (camada?: string) => Promise<void>;
  destino?: AncoraV1 | null;
  aoNavegarAncora?: (ancora: AncoraV1) => void;
  /** Abre outro capítulo do documento (a visita guiada segue de capítulo em capítulo, J91). */
  aoIrCapitulo?: (secaoId: string) => void;
  /** Vindo da página do documento: abrir um exercício, um visual ou uma ação do estudo ao chegar. */
  intencao?: IntencaoDeLeitura | null;
}
const SEM_DIFICULDADES: readonly SinalDeDificuldade[] = [];
const SEM_MODOS: readonly import('@margem/contratos').ModoDeLeituraV1[] = [];
/** Âncora do começo do capítulo (o primeiro bloco com texto): onde a margem põe os visuais do capítulo inteiro. */
function ancoraDoInicio(versaoId: string, blocos: readonly { id: string; texto: string }[]): AncoraV1 | null {
  const bloco = blocos.find((b) => b.texto.trim() !== '');
  if (!bloco) return null;
  const fim = (bloco.texto.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: fim, citacao: bloco.texto.slice(0, fim), prefixo: '', sufixo: bloco.texto.slice(fim, fim + 16) };
}

/** A página de exercícios do documento, pelo roteador da web (o leitor não recebe `ir`). */
/** Configurações → Áudio (J106): a chave da ElevenLabs, a voz e o modelo. */
function irParaConfiguracoes(): void {
  window.history.pushState(null, '', '/configuracoes');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function irParaOsExercicios(documentoId: string): void {
  window.history.pushState(null, '', `/documentos/${documentoId}/exercicios`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function EstudoDoCapitulo({ aoAtualizar, aoNavegarAncora, aoIrCapitulo, destino, intencao = null, comandos: comandosDeFora, ...props }: PropsDoEstudo): ReactNode {
  const { snapshot, documento_id } = props;
  const unidade = nomeDaUnidade(usarForma());
  const leitor = useRef<ApiDoLeitor>(null);
  // V-T3: todas as marcas à vista, ou nenhuma (o botão "Marcas" da barra; Configurações decide como abre).
  const [marcasAVista] = usarMarcasVisiveis(documento_id);
  const [raiz, definirRaiz] = useState<HTMLDivElement | null>(null);
  const [selecao, selecionar] = useState<SelecaoDoLeitor | null>(null);
  const [margemPdfDisponivel, definirMargemPdf] = useState(true);
  // Vídeo ao lado do texto (J71): a margem de notas só cabe se sobrar espaço além do vídeo.
  const [lateralDaMidia, definirLateralDaMidia] = useState(0);
  const limiarDaMargem = LARGURA_DA_MARGEM + lateralDaMidia;
  const telaEstreita = useTelaEstreita(limiarDaMargem);
  const estreita = telaEstreita || (usaPdf(snapshot) && !margemPdfDisponivel);
  const [rascunho, guardarRascunho] = useState('');
  const [painel, abrir] = useState<Painel | null>(null);
  const [citacao, citar] = useState<AncoraV1 | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [ocupado, ocupar] = useState(false);
  const [avisoDoPdf, definirAvisoDoPdf] = useState<string | null>(null);
  const acionador = useRef<HTMLElement | null>(null);
  // Compreensão do capítulo (J31): ativa quando a camada escolhida é a de uma execução de compreensão.
  const compreensao = useCompreensao(compreensaoDaCamada(snapshot.camada, snapshot.camadas), snapshot.secao.id);
  const [navegacao, definirNavegacao] = useState<NavegacaoDeDestaques>({ aberta: false, relacaoId: null });
  // Visita guiada do livro (J91): o roteiro narrado do capítulo; ao terminar, segue para o próximo.
  const visita = useVisita(compreensao.ativa, snapshot.secao.id);
  const [visitaAberta, abrirVisita] = useState<{ tocar: boolean } | null>(null);
  const [focoDaVisita, definirFocoDaVisita] = useState<FocoDaVisita | null>(null);
  const continuarVisita = useRef(false);
  // Leitura comentada integral (J92): o capítulo inteiro lido em voz alta, com as pausas do professor.
  const comentada = useLeituraComentada(compreensao.ativa, snapshot.secao.id);
  const [comentadaAberta, abrirComentada] = useState<{ tocar: boolean } | null>(null);
  const [focoDaLeitura, definirFocoDaLeitura] = useState<FocoDaLeitura | null>(null);
  const continuarComentada = useRef(false);
  const [visualizacaoRelacoes, definirVisualizacaoRelacoes] = useState<VisualizacaoDeRelacoes>(() => {
    // Bolinhas por padrão (pedido de produto, 30/09); a chave mudou para que a escolha antiga não prevaleça sobre o padrão novo.
    try { return localStorage.getItem('margem:visualizacao-relacoes:2') === 'linhas' ? 'linhas' : 'pontos'; } catch { return 'pontos'; }
  });
  // As relações seguem as marcas: com elas à vista, todas; ocultas, nenhuma.
  const filtroRelacoes: FiltroDeRelacoes = marcasAVista ? 'todas' : 'ocultas';
  const [perfilAberto, abrirPerfil] = useState(false);
  const [audioAberto, abrirAudio] = useState(false);
  // Narração gerada no app com a chave ElevenLabs da pessoa (J106); quando fica pronta, o player lista de novo.
  const narracao = useNarracao(snapshot.versao_id, snapshot.secao.id);
  const [geracao, abrirGeracao] = useState<{ trecho: AncoraV1 | null } | null>(null);
  useEffect(() => { abrirGeracao(null); }, [snapshot.versao_id, snapshot.secao.id]);
  const fontesDeReproducao = useFontesDeReproducao(snapshot.versao_id, snapshot.secao.id, narracao.prontas);
  const fontesProntas = fontesDeReproducao.estado === 'pronto' ? fontesDeReproducao.fontes : [];
  const temVideo = fontesProntas.some((f) => f.tipo === 'video');
  // Um documento que é um vídeo abre com o player (parado); áudio narrado só quando pedido.
  useEffect(() => { if (temVideo) abrirAudio(true); }, [temVideo, snapshot.versao_id, snapshot.secao.id]);
  // Sem áudio preparado (narração, leitura comentada ou visita com voz), a voz do sistema lê a partir daqui.
  const temAudioPreparado = fontesProntas.length > 0 || comentada.narracao !== null || visita.narracao !== null;
  const [ouvirDaqui, abrirOuvirDaqui] = useState<{ inicio: PontoDeTexto | null } | null>(null);
  const alternarOuvirDaqui = useCallback(() => {
    if (ouvirDaqui) { abrirOuvirDaqui(null); return; }
    const selecionado = selecaoRef.current?.ancora;
    abrirComentada(null); abrirVisita(null);
    // A seleção só diz de onde começar: sai da frente para o destaque da leitura.
    if (selecionado) window.getSelection()?.removeAllRanges();
    abrirOuvirDaqui({ inicio: selecionado ? { bloco_id: selecionado.bloco_id, offset_utf16: selecionado.inicio_utf16 } : leitor.current?.ancoraVisivel() ?? null });
  }, [ouvirDaqui]);
  useEffect(() => { abrirOuvirDaqui(null); }, [snapshot.versao_id, snapshot.secao.id]);
  useEffect(() => { if (comentadaAberta || visitaAberta || temAudioPreparado) abrirOuvirDaqui(null); }, [comentadaAberta, visitaAberta, temAudioPreparado]);
  const acaoDaVoz = temAudioPreparado || fontesDeReproducao.estado === 'carregando' ? [] : [{ id: 'voz-do-sistema', icone: 'ouvir', ativa: ouvirDaqui !== null, desabilitada: !vozDisponivel(), executar: alternarOuvirDaqui,
    rotulo: ouvirDaqui ? 'Parar a voz do sistema' : 'Ouvir a partir daqui',
    detalhe: vozDisponivel() ? 'Com a voz do sistema, da seleção ou do trecho na tela' : 'Este navegador não tem voz do sistema' }];
  const situacaoDaNarracao = narracao.situacao;
  const acaoDaNarracao: AcaoDeOuvir[] = situacaoDaNarracao === null ? [] : situacaoDaNarracao.chave_configurada ? [{
    id: 'gerar-narracao', icone: 'preparar', ativa: geracao !== null,
    rotulo: situacaoDaNarracao.estado === 'executando' ? (situacaoDaNarracao.progresso && situacaoDaNarracao.progresso.total > 0
      ? `Gerando a narração… ${String(situacaoDaNarracao.progresso.feitos)}/${String(situacaoDaNarracao.progresso.total)}` : 'Gerando a narração…')
      : situacaoDaNarracao.estado === 'pendente' ? 'Narração na fila…'
        : situacaoDaNarracao.estado === 'falhou' ? 'Narração: tentar de novo'
          : fontesProntas.some((f) => f.origem === 'audio') ? 'Gerar outra narração' : 'Gerar narração',
    detalhe: situacaoDaNarracao.estado === 'falhou' ? situacaoDaNarracao.motivo ?? 'A narração não pôde ser gerada.'
      : situacaoDaNarracao.estado === 'pendente' || situacaoDaNarracao.estado === 'executando' ? 'Acompanhe o progresso aqui'
        : 'Capítulo ou trecho, com a sua voz da ElevenLabs; mostra o custo antes',
    executar: () => abrirGeracao({ trecho: selecaoRef.current?.ancora ?? null }),
  }] : [{ id: 'configurar-narracao', icone: 'engrenagem', rotulo: 'Narração com a sua chave', detalhe: 'Opcional: configure a ElevenLabs em Configurações → Áudio', executar: irParaConfiguracoes }];
  const [mapaAberto, abrirMapa] = useState(false);
  // Resolução de exercícios (J34): recortar na página, a sessão aberta e a lista do documento.
  const [recortando, recortar] = useState(false);
  const [resolucaoAberta, abrirResolucao] = useState<string | null>(null);
  const [listaDeResolucoes, abrirListaDeResolucoes] = useState(false);
  // Muda quando uma resolução é criada ou removida: as caixas dos exercícios na página listam de novo.
  const [versaoDosExercicios, mudarExercicios] = useState(0);
  const exerciciosMudaram = useCallback(() => mudarExercicios((n) => n + 1), []);
  const abrirExercicio = useCallback((id: string) => { abrirListaDeResolucoes(false); abrirResolucao(id); }, []);
  // Os exercícios do documento entram no Caderno; só são listados quando o painel abre (e de novo quando mudam).
  const [painelAberto, definirPainelAberto] = useState(false);
  const [resolucoes, definirResolucoes] = useState<readonly SessaoDaApi[]>([]);
  useEffect(() => {
    if (!painelAberto) return;
    let vivo = true;
    resolucoesDoDocumento(documento_id).then((resposta) => { if (vivo) definirResolucoes(resposta.resolucoes); }, () => { if (vivo) definirResolucoes([]); });
    return () => { vivo = false; };
  }, [painelAberto, documento_id, versaoDosExercicios]);
  // Visuais ancorados (J70): imagem e fluxograma pedidos ao Codex, como notas do trecho ou no topo do capítulo.
  const visuais = useVisuais(snapshot.versao_id, snapshot.secao.id);
  const [pedidoVisual, pedirVisual] = useState<PedidoDeVisual | null>(null);
  const [visualAmpliado, ampliarVisual] = useState<string | null>(null);
  const poesia = snapshot.blocos.some((b) => b.tipo === 'estrofe');
  useEffect(() => { pedirVisual(null); ampliarVisual(null); }, [snapshot.versao_id, snapshot.secao.id]);
  useEffect(() => {
    abrirVisita(null); abrirComentada(null);
    continuarVisita.current = consumirContinuacao(documento_id, snapshot.secao.id);
    continuarComentada.current = consumirContinuacaoDaLeitura(documento_id, snapshot.secao.id);
  }, [snapshot.secao.id, compreensao.ativa]);
  useEffect(() => { if (continuarComentada.current && comentada.leitura) { continuarComentada.current = false; abrirVisita(null); abrirComentada({ tocar: true }); } }, [comentada.leitura]);
  useEffect(() => { if (!comentadaAberta) definirFocoDaLeitura(null); }, [comentadaAberta]);
  const alternarComentada = useCallback(() => {
    if (comentadaAberta) { abrirComentada(null); return; }
    if (comentada.leitura) { abrirVisita(null); abrirComentada({ tocar: false }); return; }
    if (comentada.estado !== 'preparando') comentada.preparar();
  }, [comentadaAberta, comentada]);
  useEffect(() => { if (continuarVisita.current && visita.roteiro) { continuarVisita.current = false; abrirVisita({ tocar: true }); } }, [visita.roteiro]);
  useEffect(() => { if (!visitaAberta) definirFocoDaVisita(null); }, [visitaAberta]);
  const alternarVisita = useCallback(() => {
    if (visitaAberta) { abrirVisita(null); return; }
    if (visita.roteiro) { abrirComentada(null); abrirVisita({ tocar: false }); return; }
    if (visita.estado !== 'preparando') visita.preparar();
  }, [visitaAberta, visita]);
  const colunaDoTexto = useCallback(() => raiz?.querySelector('.capitulo')?.getBoundingClientRect() ?? null, [raiz]);
  // Só o texto se dobra: no PDF não há blocos `[data-bloco]` no artigo, e as braquetes usam a janela dividida.
  const artigoDoTexto = useCallback(() => raiz?.querySelector<HTMLElement>('.capitulo') ?? null, [raiz]);
  const { escolha, escolher } = usarEscolhaDeDestino();
  // Os dois trechos escolhidos no texto, à espera do tipo da relação (o diálogo pequeno).
  const [ligacao, ligar] = useState<{ origem: AncoraV1; destino: AncoraV1 } | null>(null);
  const referencias = useRef({ snapshot, painel }); referencias.current = { snapshot, painel };
  const fechar = useCallback(() => {
    guardarRascunho(''); abrir(null); selecionar(null); definirErro(null); window.getSelection()?.removeAllRanges();
    acionador.current?.focus({ preventScroll: true });
  }, []);
  const abrirPainel = useCallback((novo: Painel) => {
    acionador.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    guardarRascunho(''); abrir(novo); pedirVisual(null); selecionar(null); window.getSelection()?.removeAllRanges();
  }, []);
  const selecaoRef = useRef(selecao); selecaoRef.current = selecao;
  // O botão "Grifar" da seleção usa o mesmo caminho do H (pilha de desfazer, balão da função).
  const grifarRef = useRef<((opcoes?: OpcoesDoGrifo) => void) | null>(null);
  const painelDocumentoRef = useRef<(() => void) | null>(null);
  const abrirBalaoRef = useRef<((marcaId: string, opcoes?: { nota?: boolean }) => void) | null>(null);
  const acoesDoBalao = useMemo(() => ({
    conexoes: (ancora: AncoraV1) => abrirPainel({ tipo: 'conexoes', ancora }),
    perguntar: (ancora: AncoraV1) => abrirPainel({ tipo: 'perguntar', ancora, id: null }),
    conectar: (ancora: AncoraV1) => { fechar(); escolher({ origem: ancora }); },
    flashcard: (ancora: AncoraV1) => abrirPainel({ tipo: 'flashcard', ancora }),
  }), [abrirPainel, fechar, escolher]);
  useEffect(() => { fechar(); citar(null); }, [snapshot.versao_id, snapshot.secao.id, fechar]);
  useEffect(() => {
    if (!raiz) return;
    let quadro = 0;
    const capturar = () => {
      const ativo = document.activeElement;
      // O painel do trecho não é modal: selecionar outro trecho com ele aberto traz a barra de novo.
      if (ativo?.matches('input, textarea, select')) return;
      const artigo = raiz.querySelector<HTMLElement>('.capitulo');
      if (!artigo) return;
      const atual = leitor.current?.selecao?.(window.getSelection()) ?? (referencias.current.snapshot.formato === 'pdf' && referencias.current.snapshot.geometria_disponivel ? null : ancoraDaSelecao(window.getSelection(), artigo, referencias.current.snapshot));
      selecionar(atual);
    };
    const agendar = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(capturar); };
    document.addEventListener('selectionchange', agendar);
    raiz.addEventListener('pointerup', agendar);
    raiz.addEventListener('keyup', agendar);
    window.addEventListener('scroll', agendar, { passive: true });
    return () => { cancelAnimationFrame(quadro); document.removeEventListener('selectionchange', agendar); raiz.removeEventListener('pointerup', agendar); raiz.removeEventListener('keyup', agendar); window.removeEventListener('scroll', agendar); };
  }, [raiz]);
  useEffect(() => {
    const teclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (document.querySelector('[aria-modal="true"]')) return; fechar(); pedirVisual(null); escolher(null); return; }
      if (!selecao || e.ctrlKey || e.metaKey || e.altKey || digitando(e.target) || atalhoDeUmaTeclaDesligado(e)) return;
      // A nota é sempre do grifo (N grifa e abre a nota); com a seleção, P pergunta.
      if (e.key.toLowerCase() === 'p') { e.preventDefault(); abrirPainel({ tipo: 'perguntar', ancora: selecao.ancora, id: null }); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [selecao, fechar, abrirPainel, escolher]);
  useEffect(() => {
    if (!citacao) return;
    const tempo = setTimeout(() => citar(null), 4500);
    return () => clearTimeout(tempo);
  }, [citacao]);
  const versaoId = snapshot.versao_id;
  // Os modos (J138): o catálogo inteiro fica no contexto — cada grifo tem o seu modo e grifos de modos
  // diferentes convivem. Os principais (as funções que vêm primeiro) são o do tipo de texto do documento e
  // os das camadas abertas; sem eles, os dos grifos do capítulo. Os olhares de outros modos usados há pouco
  // no documento sobem para a primeira fileira do balão.
  const principais = useMemo(() => {
    const lista: ReferenciaModo[] = [];
    const juntar = (ref: ReferenciaModo | null | undefined) => { if (ref && !lista.some((r) => mesmaReferencia(r, ref))) lista.push({ id: ref.id, revisao: ref.revisao }); };
    juntar(snapshot.modo_principal);
    for (const c of snapshot.camadas ?? []) if (snapshot.camada === 'todas' || c.id === snapshot.camada) juntar(c.modo);
    if (lista.length === 0) for (const m of snapshot.marcas) juntar(modoDaMarca(m));
    return lista;
  }, [snapshot.modo_principal, snapshot.camadas, snapshot.camada, snapshot.marcas]);
  const [lembrados, definirLembrados] = useState<Olhar[]>(() => olharesLembrados(documento_id));
  useEffect(() => { definirLembrados(olharesLembrados(documento_id)); }, [documento_id]);
  const lembrarOlhar = useCallback((olhar: Olhar) => { definirLembrados(lembrarOlharNoDocumento(documento_id, olhar)); }, [documento_id]);
  const recentes = useMemo(() => {
    // Os lembrados e os modos dos grifos do capítulo que não são principais, do mais novo ao mais antigo.
    const doCapitulo = [...snapshot.marcas].filter((m) => m.origem === 'manual' && m.funcao !== 'nenhuma').sort((a, b) => (a.criada_em < b.criada_em ? 1 : -1))
      .flatMap((m): Olhar[] => { const modo = modoDaMarca(m); return modo && !principais.some((p) => mesmaReferencia(p, modo)) ? [{ modo, funcao: m.funcao }] : []; });
    return [...lembrados, ...doCapitulo].filter((o, i, todos) => todos.findIndex((outro) => mesmaReferencia(outro.modo, o.modo) && outro.funcao === o.funcao) === i).slice(0, 6);
  }, [lembrados, snapshot.marcas, principais]);
  const edicao = useMemo<EdicaoDoLeitor>(() => ({
    criarGrifo: async (ancora, funcao, modo) => (await criarGrifo(ancora, funcao, modo)).marca,
    apagarGrifo: async (id) => { await apagarGrifo(id); },
    trocarFuncao: async (id, funcao, modo) => (await trocarFuncaoDaMarca(id, funcao, modo)).marca,
    etiquetar: async (marcaId, nome) => { await criarEtiqueta(versaoId, { tipo: 'marca', id: marcaId }, nome); },
    restaurarNota: async (marcaId, texto) => { await gravarNotaDoGrifo(marcaId, texto); },
  }), [versaoId]);
  const selecaoAtual = useCallback(() => selecaoRef.current?.ancora ?? null, []);
  /** Abre o pedido de visual: de um trecho (com a estrofe inteira como alternativa) ou do capítulo. */
  const abrirVisual = useCallback((tipo: PedidoDeVisual['tipo'], ancora: AncoraV1 | null) => {
    const bloco = ancora === null ? undefined : referencias.current.snapshot.blocos.find((b) => b.id === ancora.bloco_id);
    const inteiro = bloco && bloco.tipo === 'estrofe' && ancora && (ancora.inicio_utf16 > 0 || ancora.fim_utf16 < bloco.texto.length)
      ? { versao_id: ancora.versao_id, bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: bloco.texto.length, citacao: bloco.texto, prefixo: '', sufixo: '' } : null;
    const completo = bloco && ancora && ancora.inicio_utf16 === 0 && ancora.fim_utf16 === bloco.texto.length && bloco.tipo === 'estrofe';
    fechar();
    pedirVisual({ tipo, ancora: completo ? null : ancora, blocoInteiro: completo ? ancora : inteiro });
  }, [fechar]);
  const serieAmpliada: SerieDeVisuais | undefined = visualAmpliado === null ? undefined
    : visuais.series.find((serie) => serie.atual.id === visualAmpliado || serie.anteriores.some((v) => v.id === visualAmpliado));
  const rotuloVisual = (v: Parameters<typeof rotuloDoVisual>[0]) => rotuloDoVisual(v, poesia, unidade);
  const atualizar = useCallback(() => { void aoAtualizar().catch((falha: unknown) => definirErro(falha instanceof Error ? falha.message : `Não foi possível atualizar o ${unidade}.`)); }, [aoAtualizar]);
  // As marcas da compreensão são projetadas no fim da preparação. Se o capítulo foi carregado antes
  // disso (aberto enquanto preparava), a compreensão fica pronta com o capítulo ainda sem marcas:
  // recarrega uma vez por revisão do modelo.
  const recarregadoPara = useRef<string | null>(null);
  const modeloPronto = compreensao.visivel === 'pronto' && compreensao.modelo !== null && compreensao.modelo.elementos.length > 0 ? compreensao.modelo.id : null;
  useEffect(() => {
    if (modeloPronto === null || snapshot.marcas.length > 0 || recarregadoPara.current === modeloPronto) return;
    recarregadoPara.current = modeloPronto;
    atualizar();
  }, [modeloPronto, snapshot.marcas.length, atualizar]);
  // Enquanto o Codex revisa uma nota, o capítulo se recarrega de tempos em tempos para trazer a revisão.
  const revisando = (snapshot.revisoes_pendentes ?? []).length > 0;
  useEffect(() => {
    if (!revisando) return;
    const relogio = setInterval(atualizar, 4000);
    return () => clearInterval(relogio);
  }, [revisando, atualizar]);
  const irACitacao = useCallback((a: AncoraV1) => {
    if (a.versao_id !== snapshot.versao_id || !snapshot.blocos.some((b) => b.id === a.bloco_id)) { aoNavegarAncora?.(a); return; }
    citar(a);
    const caixa = leitor.current?.localizar(a.bloco_id, a.inicio_utf16);
    if (caixa) window.scrollBy({ top: caixa.top - 170, behavior: 'auto' });
  }, [raiz, snapshot.versao_id, snapshot.blocos, aoNavegarAncora]);
  useEffect(() => {
    if (destino && destino.versao_id === snapshot.versao_id && snapshot.blocos.some((b) => b.id === destino.bloco_id)) irACitacao(destino);
  }, [destino, snapshot.versao_id, snapshot.secao.id, irACitacao]);
  const anotacoes = snapshot.anotacoes ?? [];
  const conexoes = snapshot.conexoes ?? [];
  const liberado = liberarPrimeiroEu(snapshot.primeiro_eu?.ativo ?? false, anotacoes, snapshot.blocos, snapshot.marcas);
  // Leitura comentada e visita conduzem o braquete principal como o Percorrer: a relação do comentário
  // acende como no hover, com a dobra do texto entre as duas pontas (sem véu, decisão de produto, 30/09).
  const relacaoDoFoco = visitaAberta && focoDaVisita ? focoDaVisita.destacada : comentadaAberta && focoDaLeitura ? focoDaLeitura.destacada : undefined;
  const navegacaoDosBraquetes = useMemo<NavegacaoDeDestaques>(
    // Comentário só de grifo (sem relação): os braquetes seguem o mouse, como fora da leitura.
    () => relacaoDoFoco ? { aberta: true, relacaoId: relacaoDoFoco } : navegacao,
    [navegacao, relacaoDoFoco]);
  const semMarcas = !liberado || (!marcasAVista && !navegacao.aberta);
  // O sinal de dificuldade (J138): à parte do grifo, um "!" pequeno na margem ao lado do trecho. As do
  // Codex vêm do modelo do capítulo (depois do "primeiro eu"); com as marcas à vista (V-T3) aparecem as
  // sugeridas, as confirmadas e as do leitor; as descartadas ficam gravadas e fora da tela.
  const sinaisDoTexto = useMemo(() => sinaisDoCapitulo(liberado ? compreensao.modelo : null, snapshot.dificuldades ?? [], snapshot.versao_id, snapshot.blocos),
    [liberado, compreensao.modelo, snapshot.dificuldades, snapshot.versao_id, snapshot.blocos]);
  const dificuldades = useMemo(() => (semMarcas && !liberado ? SEM_DIFICULDADES : sinaisVisiveis(sinaisDoTexto, marcasAVista)), [sinaisDoTexto, marcasAVista, semMarcas, liberado]);
  const dificuldadesDoTrecho = useCallback((ancora: AncoraV1) => sinaisDoTexto.filter((sinal) => sinal.estado !== 'descartada' && cruza(sinal.ancora, ancora)), [sinaisDoTexto]);
  const [sinalAberto, abrirSinal] = useState<string | null>(null);
  const visivel = useMemo(() => ({ ...snapshot,
    // Os grifos do leitor não esperam o "primeiro eu": são dele. Só "ocultar as marcas" os esconde.
    marcas: semMarcas ? snapshot.marcas.filter((m) => m.origem === 'manual' && marcasAVista) : [...snapshot.marcas].sort((a, b) => {
      const precedencia = snapshot.precedencia ?? [];
      return precedencia.indexOf('camada_id' in a ? a.camada_id : '') - precedencia.indexOf('camada_id' in b ? b.camada_id : '');
    }),
    tracosPessoais: [
      // A nota é do grifo (J138): só a nota antiga, sem grifo, ainda ganha o sublinhado do trecho.
      ...(!marcasAVista ? [] : (snapshot.anotacoes ?? []).filter((a) => !a.marca_id).map((a) => ({ id: a.id, ancora: a.ancora, acao: 'sublinhado' as const }))),
      ...(citacao ? [{ id: 'citacao-temporaria', ancora: citacao, acao: 'caixa' as const }] : []),
      // O primeiro trecho da conexão fica marcado enquanto se escolhe o segundo.
      ...(escolha && escolha.origem.versao_id === snapshot.versao_id ? [{ id: 'origem-da-conexao', ancora: escolha.origem, acao: 'caixa' as const }] : []),
      ...(visitaAberta && focoDaVisita?.ancora ? [{ id: 'foco-da-visita', ancora: focoDaVisita.ancora, acao: 'caixa' as const }] : []),
      // Na leitura comentada o véu já abre só o trecho comentado: sem caixa por cima dele (Player v2).
      // O sinal de dificuldade aberto na margem acende o trecho dele (sem cor de função: é só a caixa).
      ...dificuldades.filter((d) => d.chave === sinalAberto).map((d) => ({ id: `dificuldade-${d.chave}`, ancora: d.ancora, acao: 'caixa' as const })),
    ],
    guia: visitaAberta && focoDaVisita ? { marcas: focoDaVisita.marcas, ativa: focoDaVisita.ativa }
        : comentadaAberta && focoDaLeitura ? { marcas: focoDaLeitura.marcas, ativa: focoDaLeitura.ativa } : null,
  }), [snapshot, semMarcas, marcasAVista, citacao, escolha, dificuldades, sinalAberto, visitaAberta, focoDaVisita, comentadaAberta, focoDaLeitura]);
  async function executar(acao: () => Promise<void>) {
    if (ocupado) return;
    ocupar(true); definirErro(null);
    try { await acao(); } catch (falha) {
      if (falha instanceof ErroDaApi && falha.status === 409 && falha.codigo === 'anotacao_obsoleta') {
        definirErro('Esta anotação mudou em outro lugar. Carregamos a versão atual; confira antes de tentar novamente.');
        atualizar();
      } else definirErro(falha instanceof Error ? falha.message : 'Não foi possível registrar a ação.');
    }
    finally { ocupar(false); }
  }
  const fio = painel?.tipo === 'perguntar' ? <FioDeConversa key={painel.ancora.bloco_id + ':' + painel.ancora.inicio_utf16 + ':' + (painel.id ?? '')} id={painel.id} ancora={painel.ancora} documentoId={documento_id} conexoes={conexoes} aoCriar={(id) => abrir({ ...painel, id })} aoMudar={atualizar} aoCitar={irACitacao} rascunho={rascunho} aoRascunho={guardarRascunho} /> : null;
  // As conexões do leitor entre dois trechos são desenhadas pelos mesmos braquetes da compreensão (J132).
  const comBraquetesDaCompreensao = compreensao.ativa !== null && compreensao.modelo !== null && compreensao.modelo.revisao >= 2 && liberado;
  const conexoesDesenhadas = useMemo<RelacaoDoCapitulo[]>(() => conexoes.flatMap((c) => c.estado === 'rejeitada' || c.destino.tipo !== 'trecho' ? [] : [{
    relacao: { id: c.id, tipo: TIPO_DA_CONEXAO[c.relacao], origem_id: `${c.id}:origem`, destino_id: `${c.id}:destino`, explicacao: c.justificativa, confianca: 'alta' as const, retrospectiva: false, origem: { estagio: 'revisao' as const, job_id: c.id } },
    relevante: true, origem: elementoDaConexao(`${c.id}:origem`, c.origem), destino: elementoDaConexao(`${c.id}:destino`, c.destino.ancora), conexao_id: c.id,
  }]), [conexoes]);
  const relacionadas = (a: AncoraV1) => conexoes.filter((c) => c.estado !== 'rejeitada' && (c.origem.bloco_id === a.bloco_id || (c.destino.tipo === 'trecho' && c.destino.ancora.bloco_id === a.bloco_id)));
  // A margem só lê (J132): rótulo, texto e um "…" no hover ou foco que abre o painel do trecho, onde ficam editar e apagar.
  // A nota é do grifo (J138): na margem, uma linha ✎ ligada ao grifo, não um card à parte. A do grifo com
  // comentário do Codex vai dentro da nota dele (MarginNotes); a nota antiga, sem grifo, fica só de leitura.
  const marcaDaNota = (a: AnotacaoV1) => (a.marca_id ? snapshot.marcas.find((m) => m.id === a.marca_id) : undefined);
  const abrirNota = (a: AnotacaoV1) => (a.marca_id && marcaDaNota(a) ? abrirBalaoRef.current?.(a.marca_id, { nota: true }) : abrirPainel({ tipo: 'anotar', ancora: a.ancora, anotacao: a }));
  const notaPessoal = (a: AnotacaoV1): NotaPessoal => {
    const marca = marcaDaNota(a);
    return { id: a.id, ancora: marca?.ancora ?? a.ancora, aoAbrir: () => abrirNota(a), resumo: a.texto, sinal: marca ? '✎' : 'N',
      descricao: `${marca ? 'Sua anotação' : 'Nota antiga'}: ${a.texto.slice(0, 80)}`, conteudo: marca
        ? <button type="button" className="nota-do-grifo-linha" onClick={() => abrirNota(a)} aria-label={`Sua anotação: ${a.texto.slice(0, 80)}`}>
          <span className="nota-do-grifo-sinal" aria-hidden="true">✎</span><span className="nota-do-grifo-texto">{a.texto}</span></button>
        : <><p className="nota-cabeca"><span className="nota-rotulo">Nota antiga</span>
          <IconButton tamanho="sm" icone="reticencias" className="abrir-da-margem" aria-label="Abrir a nota no painel" onClick={() => abrirNota(a)} /></p>
        <p className="nota-texto">{a.texto}</p></> };
  };
  // Na margem, a nota do grifo do Codex com comentário já aparece dentro da nota dele.
  const naMargem = (a: AnotacaoV1) => { const marca = marcaDaNota(a); return !marca || marca.origem === 'manual' || marca.comentario === null; };
  const visiveisNoTexto = new Set(visivel.marcas.map((m) => m.id));
  const notas: NotaPessoal[] = !marcasAVista ? [] : anotacoes.filter((a) => !a.marca_id || visiveisNoTexto.has(a.marca_id)).filter(naMargem).map(notaPessoal);
  const notasDoCaderno: NotaPessoal[] = anotacoes.filter((a) => !a.marca_id || marcaDaNota(a)).map(notaPessoal);
  if (marcasAVista) for (const c of (snapshot.conversas ?? [])) notas.push({ id: c.id, ancora: c.ancora, aoAbrir: () => abrirPainel({ tipo: 'perguntar', ancora: c.ancora, id: c.id }), sinal: 'C', descricao: `Conversa · ${String(c.mensagens)} mensagens`, conteudo: <Button variante="ghost" tamanho="sm" className="reabrir-conversa" onClick={() => abrirPainel({ tipo: 'perguntar', ancora: c.ancora, id: c.id })}>
    <span className="reabrir-conversa-rotulo"><Icon name="conversas" size={16} />Conversa · {c.mensagens} {c.mensagens === 1 ? 'mensagem' : 'mensagens'}</span><span className="reabrir-conversa-citacao">{c.ancora.citacao}</span></Button> });
  const blocosConectados = [...new Set(conexoes.filter((c) => c.estado !== 'rejeitada').flatMap((c) => [c.origem, ...(c.destino.tipo === 'trecho' ? [c.destino.ancora] : [])]).filter((a) => a.versao_id === snapshot.versao_id && snapshot.blocos.some((b) => b.id === a.bloco_id)).map((a) => a.bloco_id))];
  if (marcasAVista) for (const blocoId of blocosConectados) {
    const c = conexoes.find((c) => c.origem.bloco_id === blocoId || (c.destino.tipo === 'trecho' && c.destino.ancora.bloco_id === blocoId));
    if (!c) continue;
    const a = c.origem.bloco_id === blocoId ? c.origem : c.destino.tipo === 'trecho' ? c.destino.ancora : c.origem;
    const total = relacionadas(a).length;
    notas.push({ id: `conexoes-${blocoId}`, ancora: a, aoAbrir: () => abrirPainel({ tipo: 'conexoes', ancora: a }), sinal: '↗', descricao: total === 1 ? '1 conexão' : `${String(total)} conexões`, conteudo: <Button variante="ghost" tamanho="sm" className="conexoes-da-margem" onClick={() => abrirPainel({ tipo: 'conexoes', ancora: a })}>
      <Icon name="relacao" size={16} />{total === 1 ? '1 conexão' : `${String(total)} conexões`}</Button> });
  }
  // O sinal de dificuldade na margem (J138): o "!" do tamanho das bolinhas, ao lado do trecho; tocar abre o
  // cartão pequeno (categoria, descrição do Codex, confirmar e descartar). Sem margem, vai para a lateral.
  const cartaoDoSinal = (d: SinalDeDificuldade) => <LinhaDaDificuldade sinal={d} aoMudar={atualizar} aoErro={definirErro} />;
  for (const d of estreita ? [] : dificuldades) {
    const aberto = sinalAberto === d.chave;
    notas.push({ id: `dificuldade-${d.chave}`, ancora: d.ancora, conteudo: <div className={`sinal-na-margem${aberto ? ' aberto' : ''}`}>
      <button type="button" className="nota-numero sinal-de-dificuldade-botao" aria-expanded={aberto} onClick={() => abrirSinal(aberto ? null : d.chave)}
        aria-label={`Dificuldade${d.tipo ? `: ${ROTULO_DA_DIFICULDADE[d.tipo]}` : ''}${d.estado === 'sugerida' ? ' (sugerida pelo Codex)' : ''}`}
        title={d.tipo ? ROTULO_DA_DIFICULDADE[d.tipo] : 'Dificuldade'} data-estado={d.estado}>!</button>
      {aberto && cartaoDoSinal(d)}
    </div> });
  }
  // Visuais de trecho e de estrofe: nota na margem (ou no rodapé, sem margem), ancorada ao trecho. Os do
  // capítulo inteiro ficam na margem ao lado do começo do capítulo; sem margem, numa faixa no topo dele.
  // No poema, o quadro fica no próprio texto, entre a abertura e o primeiro verso: na margem, sempre
  // aberto, tomava o lugar das notas das estrofes.
  const quadroNoTexto = poesia && !usaPdf(snapshot);
  const inicioDoCapitulo = quadroNoTexto ? null : ancoraDoInicio(snapshot.versao_id, snapshot.blocos);
  const visuaisDoCapitulo = marcasAVista ? <VisuaisDoCapitulo series={visuais.series.filter((s) => s.atual.alvo.tipo === 'capitulo')} rotulo={rotuloVisual} ocupado={ocupado}
    aoAbrir={(serie) => ampliarVisual(serie.atual.id)} aoTentarDeNovo={(v) => void executar(async () => { await regenerarVisual(v.id); await visuais.recarregar(); })} /> : null;
  if (marcasAVista) for (const serie of visuais.series) {
    const alvo = serie.atual.alvo;
    const ancora = alvo.tipo === 'capitulo' ? (estreita ? null : inicioDoCapitulo) : alvo.ancora;
    if (ancora === null || !snapshot.blocos.some((b) => b.id === ancora.bloco_id)) continue;
    notas.push({ id: `visual-${serie.atual.id}`, ancora, aoAbrir: () => ampliarVisual(serie.atual.id), sinal: serie.atual.estado === 'falhou' ? '!' : 'V',
      descricao: serie.atual.estado === 'falhou' ? `${rotuloVisual(serie.atual)} não saiu: ver o motivo` : rotuloVisual(serie.atual), conteudo: <NotaDoVisual serie={serie} rotulo={rotuloVisual(serie.atual)} ocupado={ocupado}
      aoAbrir={() => ampliarVisual(serie.atual.id)} aoTentarDeNovo={() => void executar(async () => { await regenerarVisual(serie.atual.id); await visuais.recarregar(); })} /> });
  }
  // As dificuldades já têm o sublinhado tracejado no texto: não ganham indicador por cima dele.
  // Os visuais já aparecem inteiros na margem (ou no rodapé): não ganham indicador por cima do texto.
  // Sem margem (celular), as notas, conversas e conexões entram na lateral direita, com os números das marcas; nunca por cima do texto.
  // Os visuais seguem no rodapé, inteiros; só a falha ganha o triângulo na lateral.
  const pessoaisNaLateral: ItemDaLateral[] = notas.flatMap((n) => n.aoAbrir === undefined || n.sinal === undefined || n.sinal === 'V' ? [] : [{
    id: `pessoal-${n.id}`, ancora: n.ancora, aoAbrir: n.aoAbrir, classe: n.sinal === '!' ? 'numero-pessoal numero-falha' : 'numero-pessoal',
    rotulo: n.sinal === '!' ? '!' : n.sinal, descricao: n.descricao ?? 'Abrir' }]);
  const comandos: Comando[] = [
    ...(comandosDeFora ?? []),
    ...(compreensao.modelo && compreensao.modelo.revisao >= 2 ? [{ id: 'comentada', grupo: 'Estudo', rotulo: comentadaAberta ? 'Sair da leitura comentada' : comentada.leitura ? 'Leitura comentada' : 'Preparar a leitura comentada', palavras: 'professor voz ouvir ler em voz alta comentários karaokê', executar: alternarComentada }] : []),
    ...(compreensao.modelo && compreensao.modelo.revisao >= 2 ? [{ id: 'visita', grupo: 'Estudo', rotulo: visitaAberta ? 'Sair da visita (só comentários)' : visita.roteiro ? 'Visita (só comentários)' : 'Preparar a visita (só comentários)', palavras: 'narrada voz ouvir tour guiada', executar: alternarVisita }] : []),
    ...(compreensao.modelo && compreensao.modelo.elementos.length > 0 ? [{ id: 'mapa', grupo: 'Estudo', rotulo: `Mapa do ${unidade}`, executar: () => abrirMapa(true) }] : []),
    ...(selecao ? [
      { id: 'perguntar-selecao', grupo: 'Seleção', rotulo: 'Perguntar sobre a seleção', atalho: 'P', executar: () => abrirPainel({ tipo: 'perguntar', ancora: selecao.ancora, id: null }) },
      { id: 'flashcard-selecao', grupo: 'Seleção', rotulo: 'Criar flashcard da seleção', palavras: 'cartão anki revisão', executar: () => abrirPainel({ tipo: 'flashcard', ancora: selecao.ancora }) },
      { id: 'imagem-selecao', grupo: 'Seleção', rotulo: 'Criar imagem da seleção', executar: () => abrirVisual('imagem', selecao.ancora) },
      { id: 'fluxograma-selecao', grupo: 'Seleção', rotulo: 'Fluxograma da seleção', executar: () => abrirVisual('diagrama', selecao.ancora) },
    ] : []),
    { id: 'quadro-capitulo', grupo: 'Estudo', rotulo: poesia ? 'Quadro do poema' : `Quadro do ${unidade}`, executar: () => abrirVisual('imagem', null) },
    ...(usaPdf(snapshot) ? [{ id: 'resolver', grupo: 'Estudo', rotulo: 'Resolver exercício (recortar na página)', executar: () => { abrirResolucao(null); recortar(true); } }] : []),
    { id: 'resolvidos', grupo: 'Estudo', rotulo: 'Exercícios resolvidos', executar: () => abrirListaDeResolucoes(true) },
    { id: 'pagina-de-exercicios', grupo: 'Estudo', rotulo: 'Página de exercícios do livro', palavras: 'exercícios lista latex pdf exportar', executar: () => irParaOsExercicios(documento_id) },
    { id: 'perfil', grupo: 'Estudo', rotulo: 'Perfil do leitor', executar: () => abrirPerfil(true) },
    ...acaoDaVoz.filter((acao) => !acao.desabilitada).map((acao) => ({ id: acao.id, grupo: 'Mídia', rotulo: acao.rotulo, palavras: 'voz ouvir ler em voz alta falar tts', executar: acao.executar })),
    ...(fontesProntas.length > 0 ? [{ id: 'midia', grupo: 'Mídia', rotulo: temVideo ? 'Assistir com a transcrição' : 'Ouvir a narração', palavras: 'player áudio vídeo karaokê tocar', executar: () => abrirAudio(true) }] : []),
    ...acaoDaNarracao.map((acao) => ({ id: acao.id, grupo: 'Mídia', rotulo: acao.rotulo, palavras: 'narração narrar áudio voz elevenlabs gerar', executar: acao.executar })),
  ];
  const relacoesParaNavegar = useMemo<DestaqueNavegavel[]>(() => {
    const modelo = compreensao.modelo;
    if (!liberado || !modelo || modelo.revisao < 2) return [];
    return modelo.relacoes.flatMap((relacao) => {
      const ancora = modelo.elementos.find((e) => e.id === relacao.origem_id)?.ancoras[0];
      const destino = modelo.elementos.find((e) => e.id === relacao.destino_id)?.ancoras[0];
      return ancora && destino ? [{ id: relacao.id, tipo: 'braquete' as const, ancora, destino, titulo: ROTULO_DA_RELACAO[relacao.tipo], texto: relacao.explicacao, cor: corDaRelacao(relacao.id) }] : [];
    });
  }, [compreensao.modelo, liberado]);
  // O que o estudo acrescenta ao Caderno, cada item na sua posição no texto: relações, exercícios e visuais.
  const primeiroBlocoDaPagina = (pagina: number): number => {
    const indice = snapshot.blocos.findIndex((bloco) => bloco.origens.some((origem) => origem.tipo === 'pdf' && origem.pagina >= pagina));
    return indice < 0 ? snapshot.blocos.length : indice;
  };
  const extrasDoCaderno: ItemExtraDoCaderno[] = [
    ...relacoesParaNavegar.map((relacao): ItemExtraDoCaderno => ({ id: `relacao-${relacao.id}`, tipo: 'relacao', ordem: ordemNoTexto(snapshot.blocos, relacao.ancora), rotulo: `Relação: ${relacao.titulo}`,
      aoAbrir: () => irACitacao(relacao.ancora),
      cor: relacao.cor,
      conteudo: <><span className="painel-leitor-rotulo"><span className="painel-leitor-ponto" style={{ backgroundColor: relacao.cor }} />Relação · {relacao.titulo.toLocaleLowerCase('pt-BR')}</span>
        <span className="painel-leitor-citacao">{relacao.ancora.citacao}</span>
        {relacao.destino && <span className="painel-leitor-destino"><Icon name="relacao" size={14} />{relacao.destino.citacao}</span>}
        {relacao.texto && <span className="painel-leitor-comentario">{relacao.texto}</span>}</> })),
    ...resolucoes.flatMap(({ resolucao, estado }): ItemExtraDoCaderno[] => {
      const origem = resolucao.origem;
      if (origem.tipo === 'recorte' && (!usaPdf(snapshot) || !snapshot.paginas || origem.pagina < snapshot.paginas.inicio || origem.pagina > snapshot.paginas.fim)) return [];
      if (origem.tipo === 'trecho' && !snapshot.blocos.some((bloco) => bloco.id === origem.ancora.bloco_id)) return [];
      const titulo = resolucao.resolucao?.enunciado ?? (resolucao.texto_extraido.trim() || 'Exercício recortado');
      return [{ id: `exercicio-${resolucao.id}`, tipo: 'exercicio', rotulo: `Exercício: ${titulo.replace(/\$/g, '').slice(0, 80)}`,
        ordem: origem.tipo === 'recorte' ? primeiroBlocoDaPagina(origem.pagina) * 1e6 : ordemNoTexto(snapshot.blocos, origem.ancora),
        aoAbrir: () => abrirExercicio(resolucao.id),
        conteudo: <><span className="painel-leitor-rotulo"><Icon name="resolver" size={14} /> Exercício{origem.tipo === 'recorte' ? ` · p. ${String(origem.pagina)}` : ''}{estado !== 'pronta' ? ` · ${estado === 'falhou' ? 'falhou' : 'resolvendo…'}` : ''}</span>
          {origem.tipo === 'recorte' && <img className="painel-leitor-miniatura" src={`/api/resolucoes/${resolucao.id}/imagem`} alt="" loading="lazy" />}
          <span className="painel-leitor-comentario"><TextoComMatematica texto={titulo} /></span></> }];
    }),
    ...visuais.series.flatMap((serie): ItemExtraDoCaderno[] => {
      const visual = serie.atual;
      const ancora = visual.alvo.tipo === 'capitulo' ? null : visual.alvo.ancora;
      if (ancora && !snapshot.blocos.some((bloco) => bloco.id === ancora.bloco_id)) return [];
      const rotulo = rotuloVisual(visual);
      return [{ id: `visual-${visual.id}`, tipo: 'visual', rotulo, ordem: ancora ? ordemNoTexto(snapshot.blocos, ancora) : -1, aoAbrir: () => ampliarVisual(visual.id),
        conteudo: <><span className="painel-leitor-rotulo"><Icon name={visual.tipo === 'imagem' ? 'imagem' : 'fluxograma'} size={14} /> {rotulo}{visual.estado !== 'pronto' ? ` · ${visual.estado === 'falhou' ? 'falhou' : 'gerando…'}` : ''}</span>
          {visual.tipo === 'imagem' && visual.estado === 'pronto' && <img className="painel-leitor-miniatura" src={urlDaImagem(visual.id)} alt="" loading="lazy" />}
          {ancora && <span className="painel-leitor-citacao">{ancora.citacao}</span>}</> }];
    }),
  ];
  // A intenção vinda da página do documento: cada parte se cumpre uma vez, quando o que ela pede fica pronto.
  const cumpridas = useRef(new Set<string>());
  useEffect(() => {
    if (!intencao) return;
    const cumprir = (chave: string, fazer: () => void) => { if (!cumpridas.current.has(chave)) { cumpridas.current.add(chave); fazer(); } };
    if (intencao.resolucao) cumprir(`r:${intencao.resolucao}`, () => abrirResolucao(intencao.resolucao!));
    if (intencao.visual) cumprir(`v:${intencao.visual}`, () => ampliarVisual(intencao.visual!));
    if (intencao.acao === 'resolvidos') cumprir('resolvidos', () => abrirListaDeResolucoes(true));
    if (intencao.acao === 'mapa' && compreensao.modelo && compreensao.modelo.elementos.length > 0) cumprir('mapa', () => abrirMapa(true));
    if (intencao.acao === 'visita' && visita.roteiro) cumprir('visita', () => abrirVisita({ tocar: false }));
    if (intencao.acao === 'comentada' && comentada.leitura) cumprir('comentada', () => abrirComentada({ tocar: false }));
    // Vindo da página Notas (J145): o painel certo do item, depois que o leitor chegou ao trecho.
    const { marca, conversa: conversaId, conexao: conexaoId, relacao: relacaoId } = intencao;
    if (marca && snapshot.marcas.some((m) => m.id === marca)) cumprir(`m:${marca}`, () => { setTimeout(() => abrirBalaoRef.current?.(marca, intencao.nota ? { nota: true } : {}), 900); });
    const conversa = conversaId ? (snapshot.conversas ?? []).find((c) => c.id === conversaId) : undefined;
    if (conversa) cumprir(`c:${conversa.id}`, () => abrirPainel({ tipo: 'perguntar', ancora: conversa.ancora, id: conversa.id }));
    const conexao = conexaoId ? conexoes.find((c) => c.id === conexaoId) : undefined;
    if (conexao) cumprir(`x:${conexao.id}`, () => abrirPainel({ tipo: 'conexoes', ancora: conexao.origem.versao_id === snapshot.versao_id ? conexao.origem : conexao.destino.tipo === 'trecho' ? conexao.destino.ancora : conexao.origem }));
    if (relacaoId && relacoesParaNavegar.some((r) => r.id === relacaoId)) cumprir(`r2:${relacaoId}`, () => { setTimeout(() => definirNavegacao({ aberta: true, relacaoId, cartao: true }), 900); });
  }, [intencao, compreensao.modelo, visita.roteiro, comentada.leitura, snapshot.marcas, snapshot.conversas, snapshot.versao_id, conexoes, relacoesParaNavegar, abrirPainel]);
  // O grifo do trecho aberto: o da nota pedida, ou o que cobre exatamente o trecho (do leitor antes do da IA).
  const marcaDoPainel = painel === null ? null : painel.tipo === 'anotar' && painel.marcaId !== undefined ? snapshot.marcas.find((m) => m.id === painel.marcaId) ?? null
    : painel.tipo === 'anotar' && painel.anotacao ? null
      : [...snapshot.marcas].sort((a, b) => Number(b.origem === 'manual') - Number(a.origem === 'manual')).find((m) => mesmaAncora(m.ancora, painel.ancora)) ?? null;
  const trocarAba = (aba: AbaDoTrecho) => {
    if (!painel) return;
    const ancora = painel.ancora;
    if (aba === 'nota') abrir(marcaDoPainel ? { tipo: 'anotar', ancora, marcaId: marcaDoPainel.id } : { tipo: 'anotar', ancora });
    else if (aba === 'perguntar') abrir({ tipo: 'perguntar', ancora, id: (snapshot.conversas ?? []).find((c) => mesmaAncora(c.ancora, ancora))?.id ?? null });
    else abrir({ tipo: 'conexoes', ancora });
  };
  const conteudoDoPainel = painel === null ? null : <>
    {painel.tipo === 'anotar' && marcaDoPainel && <NotasDoGrifo key={marcaDoPainel.id} marca={marcaDoPainel} aoMudar={atualizar}
      nota={anotacoes.find((a) => a.marca_id === marcaDoPainel.id) ?? null} pendente={(snapshot.revisoes_pendentes ?? []).some((id) => anotacoes.some((a) => a.id === id && a.marca_id === marcaDoPainel.id))}
      comentarioDaIa={snapshot.edicoes?.[marcaDoPainel.id]?.comentario_da_ia} />}
    {painel.tipo === 'anotar' && !marcaDoPainel && painel.anotacao
      ? <NotaAntiga key={painel.anotacao.id} anotacao={painel.anotacao} ocupado={ocupado} aoGrifar={() => grifarRef.current?.({ nota: true, ancora: painel.ancora })} />
      : painel.tipo === 'anotar' && !marcaDoPainel && <>
        <p className="painel-trecho-vazio">A nota fica no grifo: grife o trecho para escrever sobre ele.</p>
        <div className="ui-rodape"><Button variante="primario" tamanho="md" disabled={ocupado} onClick={() => grifarRef.current?.({ nota: true, ancora: painel.ancora })}>Grifar e escrever a nota</Button></div>
      </>}
    {painel.tipo === 'perguntar' && fio}
    {(painel.tipo === 'conexoes' || painel.tipo === 'conectar') && <>
      {relacionadas(painel.ancora).length > 0 ? <ListaDeConexoes conexoes={relacionadas(painel.ancora)} aoMudar={atualizar} aoCitar={irACitacao} doTrecho={painel.ancora} />
        : <p className="painel-trecho-vazio">Nenhuma conexão neste trecho ainda.</p>}
      <Button variante="ghost" tamanho="sm" className="nova-nota" onClick={() => { const origem = painel.ancora; fechar(); escolher({ origem }); }}><Icon name="somar" size={16} />Conectar a outro trecho</Button>
    </>}
    {painel.tipo === 'flashcard' && <FormularioDeFlashcard ancora={painel.ancora} aoFechar={fechar} />}
  </>;
  const tituloDoVisual = pedidoVisual === null ? '' : pedidoVisual.tipo === 'imagem' ? (pedidoVisual.ancora === null && pedidoVisual.blocoInteiro === null ? (poesia ? 'Quadro do poema' : `Quadro do ${unidade}`) : 'Criar imagem') : (pedidoVisual.ancora === null && pedidoVisual.blocoInteiro === null ? `Fluxograma do ${unidade}` : 'Fluxograma');
  const voltarAoDocumento = () => painelDocumentoRef.current?.();
  return <ContextoDosModos modos={snapshot.modos ?? SEM_MODOS} principais={principais} recentes={recentes} lembrarOlhar={lembrarOlhar}><div ref={definirRaiz} className="estudo-capitulo">
    <ReaderController {...props} {...(quadroNoTexto ? { abertura: <>{props.abertura}{visuaisDoCapitulo}</> } : {})} limiarDaMargem={limiarDaMargem}
      estudoAberto={painel !== null || pedidoVisual !== null} aoFecharPainel={() => { fechar(); pedirVisual(null); }} painelDocumentoRef={painelDocumentoRef}
      pessoaisDoCaderno={notasDoCaderno}
      dificuldadesDoTrecho={dificuldadesDoTrecho} conexoesDoTrecho={(a) => relacionadas(a).length} abrirBalaoRef={abrirBalaoRef}
      conversasDoPainel={(snapshot.camadas?.length || snapshot.conversas?.length) ? {
        total: snapshot.conversas?.length ?? 0,
        conteudo: <>
          {!snapshot.conversas?.length && <div className="painel-leitor-pronto"><h2>Pronto quando você estiver</h2></div>}
          <ul className="painel-leitor-conversas">{(snapshot.conversas ?? []).map((conversa) => <li key={conversa.id}>
            <Button variante="ghost" className="painel-leitor-trecho" onClick={() => abrirPainel({ tipo: 'perguntar', ancora: conversa.ancora, id: conversa.id })}>
              <span className="painel-leitor-citacao">{conversa.ancora.citacao.length > 180 ? conversa.ancora.citacao.slice(0, 180) + '…' : conversa.ancora.citacao}</span>
              <span>{conversa.estado} · {conversa.mensagens} mensagens</span>
            </Button>
          </li>)}</ul>
          <p className="painel-leitor-dica">Selecione um trecho e use Perguntar (p) para conversar ancorado no texto.</p>
        </>,
      } : undefined}
      relacoesParaNavegar={relacoesParaNavegar} aoNavegarDestaques={definirNavegacao} navegacaoSuspensa={visitaAberta !== null || comentadaAberta !== null} leitorRef={leitor} acoesDoBalao={acoesDoBalao} edicao={edicao} grifarRef={grifarRef} selecaoAtual={selecaoAtual} aoMudarMarcas={atualizar} comandos={comandos} aoMudarMargem={definirMargemPdf} snapshot={visivel} pessoais={notas} extrasDaLateral={estreita ? [...pessoaisNaLateral, ...dificuldades.map((d) => ({
        id: `dificuldade-${d.chave}`, ancora: d.ancora, rotulo: '!', classe: 'numero-dificuldade', descricao: `Dificuldade${d.tipo ? `: ${ROTULO_DA_DIFICULDADE[d.tipo]}` : ''}`,
        conteudo: cartaoDoSinal(d),
      }))] : undefined} perguntas={semMarcas ? [] : props.perguntas}
      conexaoDaNota={(a) => relacionadas(a).length > 0 ? <IconButton tamanho="sm" icone="relacao" className="conexao-da-nota" aria-label="Conexões desta nota" onClick={() => abrirPainel({ tipo: 'conexoes', ancora: a })} /> : null}
      filtrosDoCaderno={(snapshot.camadas ?? []).length > 1 ? <Select aria-label="Camada de marcas" className="caderno-seletor" value={snapshot.camada ?? 'todas'} disabled={ocupado} onChange={(evento) => { const camada = evento.target.value; if (camada === snapshot.camada) return; void executar(async () => {
          await gravarPreferenciasDoDocumento(documento_id, { camada_padrao: camada === 'todas' ? null : camada });
          try {
            if (camada === 'todas') localStorage.setItem(`margem:camada:${documento_id}`, camada);
            else localStorage.removeItem(`margem:camada:${documento_id}`);
          } catch { /* A sessão continua sem storage. */ }
          await aoAtualizar(camada);
        }); }}>{[{ id: 'todas', rotulo: 'Todas as camadas' }, ...(snapshot.camadas ?? []).map((c) => ({ id: c.id, rotulo: rotuloCamada(c) }))].map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}</Select> : undefined}
      extrasDoCaderno={extrasDoCaderno}
      aoMudarPainel={definirPainelAberto}
      estudoTopoDoPainel={liberado && compreensao.modelo?.execucao_id === compreensao.ativa && compreensao.modelo?.secao_id === snapshot.secao.id ? <SinteseDoCapitulo key={compreensao.modelo.id} movimento={compreensao.modelo.movimento} /> : undefined}
      estudoDoPainel={[
        // Estudar este capítulo (J132): entender, praticar e ver. Ouvir (visita, leitura comentada) fica no botão da barra.
        ...(compreensao.modelo && compreensao.modelo.elementos.length > 0 ? [{ id: 'mapa', grupo: 'Entender' as const, icone: 'mapa', rotulo: `Mapa do ${unidade}`, executar: () => abrirMapa(true) }] : []),
        { id: 'resolvidos', grupo: 'Praticar' as const, icone: 'resolvidos', rotulo: 'Exercícios', detalhe: 'Os deste livro, com a página de todos', executar: () => abrirListaDeResolucoes(true) },
        ...(usaPdf(snapshot) ? [{ id: 'resolver', grupo: 'Praticar' as const, icone: 'resolver', rotulo: 'Resolver exercício', detalhe: atalhoNoSistema('Shift Ctrl S'), executar: () => { abrirResolucao(null); recortar(true); } }] : []),
        { id: 'quadro', grupo: 'Ver' as const, icone: 'imagem', rotulo: poesia ? 'Quadro do poema' : `Quadro do ${unidade}`, executar: () => abrirVisual('imagem', null) },
      ]}
      ouvir={[
        ...(compreensao.modelo && compreensao.modelo.revisao >= 2 ? [{ id: 'comentada', icone: 'comentada', ativa: comentadaAberta !== null,
          desabilitada: comentada.estado === 'preparando' || comentada.estado === null, executar: alternarComentada,
          rotulo: comentadaAberta ? 'Sair da leitura comentada' : comentada.estado === 'preparando' ? 'Preparando a leitura comentada…' : comentada.leitura ? 'Leitura comentada' : comentada.estado === 'falhou' ? 'Leitura comentada: tentar de novo' : 'Preparar a leitura comentada',
          detalhe: 'O capítulo inteiro em voz alta, com as pausas do professor' },
        { id: 'visita', icone: 'visita', ativa: visitaAberta !== null, desabilitada: visita.estado === 'preparando' || visita.estado === null, executar: alternarVisita,
          rotulo: visitaAberta ? 'Sair da visita' : visita.estado === 'preparando' ? 'Preparando a visita…' : visita.roteiro ? 'Visita (só comentários)' : 'Preparar a visita (só comentários)',
          detalhe: 'Só os comentários, de trecho em trecho' }] : []),
        ...(fontesProntas.length > 0 ? [{ id: 'midia', icone: temVideo ? 'video-doc' : 'ouvir', ativa: audioAberto, executar: () => abrirAudio(!audioAberto),
          rotulo: temVideo ? 'Assistir com a transcrição' : 'Ouvir a narração' }] : []),
        ...acaoDaNarracao,
        ...acaoDaVoz,
      ]}
      {...(usaPdf(snapshot) ? { aoSelecionarArea: () => { abrirResolucao(null); recortar(true); } } : {})}
      aparenciaExtra={compreensao.ativa ? <><h3>Relações</h3><Blocos rotulo="Visualização dos braquetes" classe="escolhas-dois" valor={visualizacaoRelacoes} aoMudar={(visualizacao) => {
        definirVisualizacaoRelacoes(visualizacao);
        try { localStorage.setItem('margem:visualizacao-relacoes:2', visualizacao); } catch { /* sem storage */ }
      }} opcoes={[{ valor: 'linhas', rotulo: 'Braquetes', previa: <Icon name="braquetes" size={18} /> }, { valor: 'pontos', rotulo: 'Bolinhas', previa: <Icon name="bolinhas" size={18} /> }]} /></> : undefined}
      acoesDaBarra={(props.acoesDaBarra || compreensao.ativa) && <>
        {props.acoesDaBarra}
        {compreensao.ativa && compreensao.visivel === 'preparando' && <span className="estado-compreensao" role="status" data-estado="preparando">Preparando…</span>}
        {compreensao.ativa && compreensao.visivel === 'falhou' && <Button variante="ghost" className="estado-compreensao" data-estado="falhou" onClick={compreensao.preparar}>Falhou · tentar de novo</Button>}
      </>}
      menuExtra={<>
        {props.menuExtra}
        <li><Button variante="ghost" onClick={() => abrirPerfil(true)}><Icon name="perfil" size={18} /><span><span className="acao-rotulo">Perfil do leitor</span></span></Button></li>
        {usaPdf(snapshot) && <li><Button variante="ghost" disabled={ocupado} onClick={() => void executar(async () => {
          definirAvisoDoPdf(null);
          const { semGeometria } = await baixarPdfAnotado(snapshot.versao_id);
          if (semGeometria > 0) definirAvisoDoPdf(`${String(semGeometria)} ${semGeometria === 1 ? 'marca ou nota ficou' : 'marcas ou notas ficaram'} fora do PDF anotado: não têm posição na página`);
        })}><Icon name="exportar" size={18} /><span><span className="acao-rotulo">Baixar PDF anotado</span><span className="acao-detalhe">Seus grifos e notas</span></span></Button></li>}
        {compreensao.plano && <LinkDoEink documento_id={documento_id} secao_id={snapshot.secao.id} />}
      </>}
      avisoExtra={<>{!quadroNoTexto && (estreita || inicioDoCapitulo === null) && visuaisDoCapitulo}{visuais.erro && <p className="aviso-estudo" role="alert">{visuais.erro}</p>}{visita.erro && <p className="aviso-estudo" role="alert">{visita.erro}</p>}{comentada.erro && <p className="aviso-estudo" role="alert">{comentada.erro}</p>}{compreensao.erro && <p className="aviso-estudo" role="alert">{compreensao.erro}</p>}{!liberado && <p className="aviso-estudo" role="status">As marcas da IA aparecem depois do seu primeiro grifo neste {unidade}</p>}{erro && <p className="aviso-estudo" role="alert">{erro}</p>}{avisoDoPdf && <p className="aviso-estudo" role="status">{avisoDoPdf}</p>}</>}
      painel={painel ? <PainelDoTrecho key={`${painel.ancora.bloco_id}:${String(painel.ancora.inicio_utf16)}:${String(painel.ancora.fim_utf16)}`} ancora={painel.ancora} marca={marcaDoPainel}
        aba={ABA_DO_PAINEL[painel.tipo]} titulo="Novo flashcard" conexoes={relacionadas(painel.ancora).length} aoMudarAba={trocarAba} aoFechar={fechar} aoVoltarAoDocumento={voltarAoDocumento}>{conteudoDoPainel}</PainelDoTrecho>
        : pedidoVisual ? <PainelDoTrecho ancora={null} aba={null} titulo={tituloDoVisual} aoFechar={() => pedirVisual(null)} aoVoltarAoDocumento={voltarAoDocumento}>
          <PainelDoVisual key={`${pedidoVisual.tipo}:${pedidoVisual.ancora?.bloco_id ?? pedidoVisual.blocoInteiro?.bloco_id ?? 'capitulo'}`} pedido={pedidoVisual} poesia={poesia} unidade={unidade} aoFechar={() => pedirVisual(null)}
            aoEnviar={async ({ alvo, pedido }) => {
              await criarVisual({ tipo: pedidoVisual.tipo, versao_id: snapshot.versao_id, secao_id: snapshot.secao.id, alvo, ...(pedido.trim() === '' ? {} : { pedido }) });
              pedirVisual(null); await visuais.recarregar();
            }} />
        </PainelDoTrecho> : null}
    />
    {(comBraquetesDaCompreensao || conexoesDesenhadas.length > 0) && <Braquetes compreensaoId={comBraquetesDaCompreensao ? compreensao.ativa : null} secaoId={snapshot.secao.id} extras={conexoesDesenhadas} aoAdotar={atualizar}
      key={visualizacaoRelacoes} visualizacao={visualizacaoRelacoes} navegacao={navegacaoDosBraquetes} modeloId={compreensao.modelo?.id ?? 'conexoes'} filtro={navegacaoDosBraquetes.aberta ? 'todas' : filtroRelacoes} leitor={leitor} coluna={colunaDoTexto} blocos={snapshot.blocos} artigo={artigoDoTexto} pdf={usaPdf(snapshot)} />}
    {comentadaAberta && comentada.leitura && <LeituraComentada tituloDocumento={props.tituloDocumento} key={comentada.leitura.id} leitura={comentada.leitura} narracao={comentada.narracao} modelo={compreensao.modelo} documentoId={documento_id}
      leitor={leitor} raiz={raiz} marcas={semMarcas ? [] : snapshot.marcas} tocarAoAbrir={comentadaAberta.tocar}
      aoSair={() => abrirComentada(null)} aoCitar={irACitacao} aoMudarFoco={definirFocoDaLeitura} {...(aoIrCapitulo ? { aoIrCapitulo } : {})} />}
    {visitaAberta && visita.roteiro && <VisitaGuiada key={visita.roteiro.id} roteiro={visita.roteiro} narracao={visita.narracao} modelo={compreensao.modelo} documentoId={documento_id}
      versaoId={snapshot.versao_id} blocos={snapshot.blocos} leitor={leitor} marcas={semMarcas ? [] : snapshot.marcas} tocarAoAbrir={visitaAberta.tocar}
      aoSair={() => abrirVisita(null)} aoCitar={irACitacao} aoMudarFoco={definirFocoDaVisita} {...(aoIrCapitulo ? { aoIrCapitulo } : {})} />}
    {mapaAberto && compreensao.modelo && compreensao.ativa && <MapaDoCapitulo titulo={snapshot.secao.titulo} compreensaoId={compreensao.ativa} secaoId={compreensao.modelo.secao_id}
      aoIr={(ancora) => { abrirMapa(false); irACitacao(ancora); }} aoFechar={() => abrirMapa(false)} />}
    {recortando && <FerramentaDeArea ancoraDaArea={(pagina, area) => leitor.current?.ancoraDaArea?.(pagina, area) ?? null} aoCancelar={() => recortar(false)} aoAgir={(acao, recorte, ancora) => {
      recortar(false);
      if (acao === 'resolver') {
        void executar(async () => {
          const criada = await criarResolucao(documento_id, { tipo: 'recorte', pagina: recorte.pagina, retangulo: recorte.retangulo, imagem_png: recorte.imagem_png }, recorte.texto);
          abrirResolucao(criada.resolucao.id);
          exerciciosMudaram();
        });
        return;
      }
      if (!ancora) return;
      if (acao === 'explicar') { abrirPainel({ tipo: 'perguntar', ancora, id: null }); guardarRascunho('Explique este trecho: o que ele diz e por que importa aqui.'); }
      else if (acao === 'imagem') abrirVisual('imagem', ancora);
      // A nota é sempre de um grifo: a área vira grifo, e a nota dele abre.
      else grifarRef.current?.({ nota: true, ancora });
    }} />}
    {ligacao && <DialogoDeConexao origem={ligacao.origem} destino={ligacao.destino} aoFechar={() => ligar(null)} aoSalvar={() => { ligar(null); atualizar(); }} />}
    {resolucaoAberta && <SessaoDeResolucao key={resolucaoAberta} id={resolucaoAberta} aoFechar={() => abrirResolucao(null)} />}
    {listaDeResolucoes && <Drawer rotulo="Exercícios resolvidos" aoFechar={() => abrirListaDeResolucoes(false)}>
      <a className="link-dos-exercicios" href={`/documentos/${documento_id}/exercicios`} onClick={(evento) => { evento.preventDefault(); irParaOsExercicios(documento_id); }}>Todos os exercícios do livro, com exportação em PDF →</a>
      <ListaDeResolucoes documentoId={documento_id} aoAbrir={abrirExercicio} aoRemover={exerciciosMudaram} />
    </Drawer>}
    {usaPdf(snapshot) && <ExerciciosNaPagina documentoId={documento_id} versaoId={snapshot.versao_id} aberta={resolucaoAberta} versao={versaoDosExercicios} aoAbrir={abrirExercicio} aoMudar={exerciciosMudaram} />}
    {ouvirDaqui && <OuvirDaqui blocos={snapshot.blocos} raiz={raiz} inicio={ouvirDaqui.inicio} aoSair={() => abrirOuvirDaqui(null)} />}
    {audioAberto && fontesProntas.length > 0 && <PlayerDeMidia tituloDocumento={props.tituloDocumento} key={snapshot.versao_id + snapshot.secao.id} fontes={fontesProntas} raiz={raiz} snapshot={visivel}
      aoFechar={() => abrirAudio(false)} aoMudarLateral={definirLateralDaMidia} />}
    {serieAmpliada && <VisualAmpliado key={serieAmpliada.atual.id} serie={serieAmpliada} rotulo={rotuloVisual(serieAmpliada.atual)} aoFechar={() => ampliarVisual(null)} aoCitar={irACitacao}
      aoRegenerar={async (v, pedido) => { const { visual } = await regenerarVisual(v.id, pedido); await visuais.recarregar(); ampliarVisual(visual.id); }}
      aoApagar={async (v) => { await apagarVisual(v.id); await visuais.recarregar(); }} />}
    {perfilAberto && <Drawer rotulo="Perfil do leitor" aoFechar={() => abrirPerfil(false)}><PerfilDoLeitor /></Drawer>}
    {geracao && <Drawer rotulo="Gerar narração" aoFechar={() => abrirGeracao(null)}>
      <GerarNarracao versaoId={snapshot.versao_id} secaoId={snapshot.secao.id} trecho={geracao.trecho} situacao={situacaoDaNarracao}
        aoPedir={(nova) => narracao.atualizar(nova)} aoConfigurar={() => { abrirGeracao(null); irParaConfiguracoes(); }}
        {...(fontesProntas.some((f) => f.origem === 'audio') ? { aoOuvir: () => { abrirGeracao(null); abrirAudio(true); } } : {})} />
    </Drawer>}
    {selecao && <BarraDeSelecao selecao={selecao}>
      {escolha ? <Button variante="ghost" type="button" className="botao-de-destino" disabled={ocupado} onClick={() => {
        const destino = selecao.ancora;
        // Vindo do formulário antigo (destino trecho com relação já escolhida), grava direto; senão, o diálogo pequeno escolhe a relação.
        if (escolha.relacao && escolha.justificativa) void executar(async () => { await escrever<{ conexao: ConexaoV2 }>('/api/conexoes', { origem: escolha.origem, relacao: escolha.relacao, justificativa: escolha.justificativa, destino: { tipo: 'trecho', ancora: destino } }); escolher(null); fechar(); await aoAtualizar(); });
        else { ligar({ origem: escolha.origem, destino }); escolher(null); fechar(); }
      }}><IconeDaSelecao nome="conectar" /><span>Conectar estes dois</span></Button>
        : <AcoesDaSelecao ocupado={ocupado} aoGrifar={(funcao) => grifarRef.current?.({ funcao: funcao.chave, modo: funcao.modo })}
          aoOutrosOlhares={() => grifarRef.current?.({ olhares: true })}
          aoPerguntar={() => abrirPainel({ tipo: 'perguntar', ancora: selecao.ancora, id: null })} aoConectar={() => { const origem = selecao.ancora; fechar(); escolher({ origem }); }}
          mais={[
            { id: 'flashcard', rotulo: 'Criar flashcard', icone: 'cartoes', executar: () => abrirPainel({ tipo: 'flashcard', ancora: selecao.ancora }) },
            { id: 'imagem', rotulo: 'Criar imagem', icone: 'imagem', executar: () => abrirVisual('imagem', selecao.ancora) },
            { id: 'fluxograma', rotulo: 'Fluxograma', icone: 'fluxograma', executar: () => abrirVisual('diagrama', selecao.ancora) },
            { id: 'resolver', rotulo: 'Resolver exercício', icone: 'resolver', desabilitado: ocupado, executar: () => { const ancora = selecao.ancora; fechar(); void executar(async () => { const criada = await criarResolucao(documento_id, { tipo: 'trecho', ancora }, ancora.citacao); abrirResolucao(criada.resolucao.id); }); } },
            { id: 'copiar', rotulo: 'Copiar texto', icone: 'copiar', executar: () => { void navigator.clipboard?.writeText(selecao.ancora.citacao).catch(() => undefined); fechar(); } },
          ]} />}
      <IconButton aria-label="Fechar seleção" className="botao-da-selecao" onClick={fechar}><IconeDaSelecao nome="fechar" /></IconButton>
    </BarraDeSelecao>}
  </div></ContextoDosModos>;
}

/**
 * Uma nota antiga, sem grifo (de antes de a nota ir para o grifo e que a migração não ligou a um grifo):
 * só leitura. Grifar o trecho dá a ele um grifo com a nota nova.
 */
function NotaAntiga({ anotacao, ocupado, aoGrifar }: { anotacao: AnotacaoV1; ocupado: boolean; aoGrifar: () => void }): ReactNode {
  return <article className="nota-do-grifo" data-autor="leitor">
    <p className="eyebrow">Nota antiga</p>
    <p className="texto-pessoal">{anotacao.texto}</p>
    <p className="painel-trecho-vazio">Esta nota é de antes de as notas irem para o grifo. Grife o trecho para escrever sobre ele.</p>
    <div className="ui-rodape"><Button variante="primario" tamanho="md" disabled={ocupado} onClick={aoGrifar}>Grifar o trecho</Button></div>
  </article>;
}
