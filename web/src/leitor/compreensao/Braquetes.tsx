import { montarRecortesDoTexto, prepararRecortesDoTexto } from './recortes-do-texto';
import { PontasAgrupadas } from './PontasAgrupadas';
import type { NavegacaoDeDestaques } from '../NavegadorDeDestaques';
/**
 * Braquetes (J31, `docs/desenho/09-VISAO.md` §4): na lateral esquerda do texto, cada relação semântica
 * do capítulo é uma chave de uma cor: um colchete abraça as linhas de cada uma das duas citações, e uma espinha os
 * liga, com um círculo no meio. Não são lineares: o §8 liga-se ao §31 mesmo que a leitura guiada passe
 * por eles em passos diferentes.
 *
 * Em repouso ficam apagadas. Com o mouse (ou o foco) sobre uma delas, só ela acende, os dois trechos
 * ficam em destaque e o resto da página esmaece. Se os dois não cabem juntos na tela e um deles está
 * à vista, o texto entre eles se recolhe numa dobra, e os dois parágrafos ficam lado a lado na própria
 * página; o que estava à vista fica parado. Se nenhum dos dois está à vista, ou no PDF, onde o original
 * não se dobra, uma janela dividida ao meio mostra um em cima e o outro embaixo. A explicação da
 * relação abre junto, ao lado do círculo.
 *
 * Só a espinha e o círculo respondem ao mouse: cada relação tem a sua pista, e os colchetes, que
 * relações do mesmo parágrafo compartilham, são só desenho. Nada rola a página para seguir o mouse.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { AncoraV1, Bloco } from '@margem/contratos';
import { relacoesDoCapitulo, type RelacaoDoCapitulo } from '../../biblioteca/api';
import type { ApiDoLeitor } from '../tipos';
import { ancoraDoBloco, distribuirEmPistas, faixaDaAncora, type Faixa } from './geometria';
import { ROTULO_DA_RELACAO } from './rotulos';
import { IconButton } from '../../ui/Primitives';
import { nomeDaUnidade, usarForma } from '../forma';
import { arranjarDobra, construirDobra, SobreposicaoDaDobra, yDoCirculoNaDobra, type EstadoDaDobra } from './DobraDoPdf';

export type VisualizacaoDeRelacoes = 'linhas' | 'pontos';
export type FiltroDeRelacoes = 'ocultas' | 'relevantes' | 'todas';

export interface FontesDosBraquetes { relacoes: typeof relacoesDoCapitulo }
export const FONTES_DOS_BRAQUETES: FontesDosBraquetes = { relacoes: relacoesDoCapitulo };

export interface PropsDosBraquetes {
  visualizacao?: VisualizacaoDeRelacoes;
  navegacao?: NavegacaoDeDestaques;
  compreensaoId: string;
  secaoId: string;
  /** Muda quando a revisão do modelo muda: recarrega as relações. */
  modeloId: string;
  filtro: FiltroDeRelacoes;
  leitor: RefObject<ApiDoLeitor | null>;
  /** Onde fica a coluna de texto, para desenhar à esquerda dela. */
  coluna: () => DOMRect | null;
  /** Blocos do capítulo: ordenam as relações e fornecem contexto à janela dividida. */
  blocos?: readonly Pick<Bloco, 'id' | 'texto'>[];
  /** O artigo do texto, onde os blocos entre os dois trechos se recolhem. Sem ele (PDF), vale a janela dividida. */
  artigo?: () => HTMLElement | null;
  fontes?: FontesDosBraquetes;
  /** Sobre a página do PDF o véu escurece (em vez de clarear) e tem a borda curta: o trecho fica no contraste do original. */
  pdf?: boolean;
  /** Quanto o mouse precisa ficar sobre a espinha para a relação acender. */
  esperaMs?: number;
  /**
   * Leitura guiada: só estas relações, todas acesas, na ordem dada (a cor segue essa ordem, a mesma da
   * barra lateral). Sem mouse, sem véu e sem dobra: o passo é que as mostra.
   */
  fixas?: readonly string[];
  /** Com `fixas`, a relação em destaque (o leitor está sobre ela na barra); as outras recuam. */
  destacada?: string | null;
}

/** Um lado da relação: a faixa da citação, suas linhas e o parágrafo de contexto. */
interface Ponta { ancora: AncoraV1; faixa: Faixa; meio: number; linhas: Faixa[]; contexto: Faixa }
interface Desenhado { item: RelacaoDoCapitulo; cor: number; de: Ponta; para: Ponta; topo: number; base: number; pista: number }

/** Distância entre as espinhas de relações que se cruzam na vertical. */
const LARGURA_DA_PISTA = 14;
/** Cores das relações, na ordem em que aparecem; definidas em `compreensao.css`. */
const CORES = 5;
/** Da barra do leitor para baixo é que a página é visível. */
const TOPO_UTIL = 64;
const ESPERA_AO_SAIR_MS = 140;
/**
 * Até onde o card pode avançar à direita: antes das citações acesas (no PDF a coluna é a folha, com
 * margem branca) ou da coluna do texto; e, se o card de fato cruzar a altura de um colchete do braquete
 * (mais que uma pequena tolerância), antes dele. A altura é a medida do card desenhado.
 */
function limiteDoCard(acesa: Desenhado, coluna: number, xColchete: number, yDoCard: number, alturaDoCard: number): number {
  const esquerdas = [...acesa.de.linhas, ...acesa.para.linhas].map((linha) => linha.esquerda);
  const antesDoTexto = Math.max(coluna, esquerdas.length > 0 ? Math.min(...esquerdas) : coluna) - 10;
  const meia = alturaDoCard / 2 - TOLERANCIA_DO_COLCHETE;
  const cruzaColchete = [acesa.de.faixa, acesa.para.faixa].some((faixa) => faixa.topo < yDoCard + meia && faixa.base > yDoCard - meia);
  return cruzaColchete ? Math.min(antesDoTexto, xColchete - 8) : antesDoTexto;
}
/** Quanto o card pode encostar na ponta de um colchete sem ter de desviar dele. */
const TOLERANCIA_DO_COLCHETE = 8;

/** Largura do card da relação: constante (340) para vários cards lerem como um só sistema; encolhe até o lugar que houver (mínimo 160). */
const LARGURA_DO_CARD = 340;
const LARGURA_MINIMA_DO_CARD = 160;
/** Onde, da esquerda para a direita, o círculo fica dentro do card que o substitui. */
const FRACAO_DO_CIRCULO = 3 / 4;
/**
 * O card substitui o círculo: centrado na altura dele, com o círculo a 3/4 da largura (a espinha entra
 * no card por cima e por baixo nesse ponto). A posição vem da mesma âncora que posicionava o círculo.
 * O terço da direita avança para o lado do texto, mas nunca passa de `limite` (a borda esquerda das
 * citações acesas, com folga): sem lugar, o card desliza para a esquerda e o círculo fica mais à direita
 * nele, sem sair dele.
 */
export function posicaoDoCard(xDoCirculo: number, yDoCirculo: number, limite: number): CSSProperties {
  // Largo o bastante para os 3/4 da esquerda caberem na tela antes do círculo, sem passar do limite.
  const largura = Math.max(LARGURA_MINIMA_DO_CARD, Math.min(LARGURA_DO_CARD, (xDoCirculo - 12) / FRACAO_DO_CIRCULO, limite - 12));
  let left = xDoCirculo - largura * FRACAO_DO_CIRCULO;
  if (left + largura > limite) left = limite - largura;
  left = Math.max(12, Math.min(left, xDoCirculo - 12));
  const origem = Math.max(0, Math.min(100, ((xDoCirculo - left) / largura) * 100));
  return { left, top: yDoCirculo, width: largura, '--origem-do-card': `${origem.toFixed(1)}%` } as CSSProperties;
}
/**
 * O mouse precisa repousar na espinha antes de a relação acender: atravessar as chaves depressa, a
 * caminho da que se quer, não recolhe nem esmaece nada no caminho.
 */
export const ESPERA_PARA_ACENDER_MS = 700;
/** No PDF, a intenção de hover que abre a dobra: curta, mas o bastante para não piscar ao atravessar. */
export const ESPERA_DA_DOBRA_MS = 130;

export function Braquetes({ visualizacao = 'linhas', navegacao, compreensaoId, secaoId, modeloId, filtro, leitor, coluna, blocos, artigo, pdf = false, fontes = FONTES_DOS_BRAQUETES, esperaMs = pdf ? ESPERA_DA_DOBRA_MS : ESPERA_PARA_ACENDER_MS, fixas, destacada = null }: PropsDosBraquetes): ReactNode {
  const [carregadas, definirRelacoes] = useState<RelacaoDoCapitulo[]>([]);
  const unidade = nomeDaUnidade(usarForma());
  const chaveDasFixas = fixas?.join(' ');
  const relacoes = useMemo(() => {
    if (chaveDasFixas === undefined) return carregadas;
    const porId = new Map(carregadas.map((item) => [item.relacao.id, item]));
    return chaveDasFixas.split(' ').flatMap((id) => { const item = porId.get(id); return item ? [item] : []; });
  }, [carregadas, chaveDasFixas]);
  const guiada = fixas !== undefined;
  const compacta = useCompacta();
  const porPontos = visualizacao === 'pontos' && !compacta && !guiada;
  const [desenho, definirDesenho] = useState<{ x: number; largura: number; itens: Desenhado[] }>({ x: 0, largura: 0, itens: [] });
  const [sobre, definirSobre] = useState<string | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const saida = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dobra = useRef<Dobra | null>(null);
  const itens = useRef<Desenhado[]>([]);
  const pistas = useRef<Map<string, number> | null>(null);

  const consultaRelacoes = useRef(0);
  const carregar = useCallback(() => {
    const pedido = ++consultaRelacoes.current;
    definirRelacoes([]);
    if (filtro === 'ocultas' && !guiada) { definirRelacoes([]); return; }
    fontes.relacoes(compreensaoId, secaoId, guiada || filtro === 'ocultas' ? 'todas' : filtro, modeloId).then((resposta) => { if (pedido !== consultaRelacoes.current) return; definirRelacoes(resposta.relacoes); definirErro(null); },
      (falha: unknown) => { if (pedido === consultaRelacoes.current) definirErro(falha instanceof Error ? falha.message : 'Não foi possível carregar as relações.'); });
  }, [compreensaoId, secaoId, filtro, fontes, guiada, modeloId]);
  useEffect(() => { carregar(); return () => { consultaRelacoes.current++; }; }, [carregar]);

  const blocosPorId = useMemo(() => new Map(blocos?.map(b => [b.id, b])), [blocos]);
  const medir = useCallback(() => {
    const caixa = coluna();
    if (!caixa) { definirDesenho({ x: 0, largura: 0, itens: [] }); return; }
    const pontas = new Map<string, Ponta | null>();
    const contextos = new Map<string, Faixa | null>();
    const ponta = (ancora: AncoraV1 | undefined): Ponta | null => {
      if (!ancora) return null;
      const chave = JSON.stringify([ancora.versao_id, ancora.bloco_id, ancora.inicio_utf16, ancora.fim_utf16]);
      if (pontas.has(chave)) return pontas.get(chave)!;
      // Nos dois leitores, as pontas acompanham somente as linhas da citação.
      const linhas = (leitor.current?.retangulosDaAncora?.(ancora) ?? []).filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ topo: r.top, base: r.bottom, esquerda: r.left, direita: r.right }));
      const faixa = faixaDasLinhas(linhas) ?? faixaDaAncora(leitor.current, ancora);
      if (!faixa) { pontas.set(chave, null); return null; }
      const bloco = pdf ? undefined : blocosPorId.get(ancora.bloco_id);
      if (bloco && !contextos.has(bloco.id)) contextos.set(bloco.id, faixaDaAncora(leitor.current, ancoraDoBloco(ancora.versao_id, bloco)));
      const contexto = (bloco ? contextos.get(bloco.id) : null) ?? faixa;
      const medida = { ancora, faixa, meio: (faixa.topo + faixa.base) / 2, linhas, contexto };
      pontas.set(chave, medida);
      return medida;
    };
    const medidos = relacoes.flatMap((item, indice) => {
      const de = ponta(item.origem?.ancoras[0]);
      const para = ponta(item.destino?.ancoras[0]);
      if (!de || !para) return [];
      return [{ item, cor: indice % CORES, de, para, topo: Math.min(de.faixa.topo, para.faixa.topo), base: Math.max(de.faixa.base, para.faixa.base) }];
    });
    // A pista de cada relação é decidida uma vez e não muda com a rolagem nem com o texto recolhido:
    // se relações sumissem da conta, a acesa pularia para perto do texto e sairia de baixo do mouse.
    if (!pistas.current || pistas.current.size < relacoes.length && !dobra.current) pistas.current = pistasFixas(relacoes, medidos, blocos);
    const fixas = pistas.current;
    const distribuidos = medidos.map((medido) => ({ ...medido, pista: porPontos ? 0 : fixas.get(medido.item.relacao.id) ?? 0 }));
    itens.current = distribuidos;
    definirDesenho({ x: caixa.left, largura: caixa.width, itens: distribuidos });
  }, [relacoes, coluna, leitor, blocos, blocosPorId, pdf, porPontos]);
  useEffect(() => { pistas.current = null; }, [relacoes, blocos]);

  useEffect(() => {
    medir();
    let quadro = 0;
    const agendar = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(medir); };
    window.addEventListener('scroll', agendar, { passive: true });
    const redimensionar = () => { desdobrar(dobra); agendar(); };
    window.addEventListener('resize', redimensionar);
    // O PDF desenha as páginas depois de montar: a geometria nova pede nova medida.
    window.addEventListener('margem:geometria', agendar);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('scroll', agendar); window.removeEventListener('resize', redimensionar); window.removeEventListener('margem:geometria', agendar);
    };
  }, [medir]);
  useEffect(() => () => { clearTimeout(saida.current); clearTimeout(espera.current); desdobrar(dobra); }, []);

  // Depois de apagar uma relação que tinha recolhido o texto, ela só volta a acender quando o mouse
  // sair de cima dela: ao desdobrar, o traço reaparece sob o mouse, e isso não pode virar um pisca-pisca.
  const bloqueada = useRef<string | null>(null);
  const [candidata, definirCandidata] = useState<string | null>(null);
  const candidataRef = useRef<string | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const acender = (id: string) => {
    clearTimeout(espera.current); candidataRef.current = null; definirCandidata(null);
    clearTimeout(saida.current); saida.current = undefined;
    definirSobre(id);
  };
  const desistir = () => { clearTimeout(espera.current); candidataRef.current = null; definirCandidata(null); };
  // Mouse sobre a espinha: a relação vira candidata e só acende se ele repousar ali.
  const entrar = (id: string) => {
    if (navegacao?.aberta) return;
    if (bloqueada.current === id) return;
    if (sobre === id) { clearTimeout(saida.current); saida.current = undefined; return; }
    if (esperaMs <= 0) { acender(id); return; }
    if (candidataRef.current === id) return;
    clearTimeout(espera.current);
    candidataRef.current = id; definirCandidata(id);
    espera.current = setTimeout(() => { if (candidataRef.current === id) acender(id); }, esperaMs);
  };
  const sair = () => {
    if (fixadaRef.current !== null) return;
    clearTimeout(saida.current); saida.current = setTimeout(() => definirSobre(null), ESPERA_AO_SAIR_MS);
  };
  // O clique no círculo fixa a relação (e a dobra do PDF) até outro clique ou Esc.
  const fixadaRef = useRef<string | null>(null);
  const fixar = (id: string) => {
    fixadaRef.current = fixadaRef.current === id ? null : id;
    if (fixadaRef.current === id) acender(id);
  };
  useEffect(() => {
    const soltar = (evento: KeyboardEvent) => { if (evento.key === 'Escape' && fixadaRef.current !== null) { fixadaRef.current = null; definirSobre(null); } };
    window.addEventListener('keydown', soltar);
    return () => window.removeEventListener('keydown', soltar);
  }, []);

  // Acesa só enquanto o mouse estiver sobre a espinha dela (o círculo fica na espinha).
  useEffect(() => {
    const mover = (evento: PointerEvent) => {
      if (navegacao?.aberta) return;
      const caixa = coluna();
      if (!caixa) return;
      const sobreA = (id: string | null) => {
        const item = itens.current.find((atual) => atual.item.relacao.id === id);
        if (item === undefined) return false;
        if (dentroDoDesenho(item, caixa.left, evento.clientX, evento.clientY)) return true;
        // Recolhida, a espinha encurta e pode sair de baixo do mouse: a de antes de recolher, onde o
        // mouse estava, continua valendo.
        const atual = dobra.current;
        const y = evento.clientY + window.scrollY;
        return atual?.id === id && Math.abs(evento.clientX - xDaEspinha(caixa.left, item.pista)) <= 13 && y >= atual.espinha[0] - 13 && y <= atual.espinha[1] + 13;
      };
      if (bloqueada.current !== null && !sobreA(bloqueada.current)) bloqueada.current = null;
      // Saiu da candidata antes da hora: não acende.
      if (candidataRef.current !== null && !sobreA(candidataRef.current)) desistir();
      if (sobre === null) return;
      // Sobre a dobra do PDF (os recortes e a espinha religada), ou com a relação fixada pelo clique: fica.
      const naDobra = evento.target instanceof Element && evento.target.closest('.dobra-pdf-alvo, .pontas-agrupadas') !== null;
      if (sobreA(sobre) || naDobra || fixadaRef.current === sobre) { clearTimeout(saida.current); saida.current = undefined; return; }
      if (saida.current === undefined) {
        saida.current = setTimeout(() => {
          saida.current = undefined;
          if (dobra.current?.id === sobre) bloqueada.current = sobre;
          definirSobre(null);
        }, ESPERA_AO_SAIR_MS);
      }
    };
    window.addEventListener('pointermove', mover);
    return () => window.removeEventListener('pointermove', mover);
  }, [sobre, coluna, navegacao?.aberta]);

  const navegacaoAberta = navegacao?.aberta ?? false;
  const relacaoNavegada = navegacao?.relacaoId ?? null;
  const navegava = useRef(false);
  useLayoutEffect(() => {
    if (!navegacaoAberta && !navegava.current) return;
    navegava.current = navegacaoAberta;
    clearTimeout(saida.current); clearTimeout(espera.current);
    fixadaRef.current = null;
    definirSobre(null);
    desdobrar(dobra);
    medir();
    if (!navegacaoAberta || !relacaoNavegada) return;
    const item = relacoes.find((r) => r.relacao.id === relacaoNavegada);
    const ancoras = [item?.origem?.ancoras[0], item?.destino?.ancoras[0]].filter((a): a is AncoraV1 => a !== undefined);
    const faixas = ancoras.map((a) => faixaDaAncora(leitor.current, a)).filter((f): f is Faixa => f !== null);
    if (faixas.length) window.scrollBy({ top: Math.min(...faixas.map((f) => f.topo)) - Math.max(100, window.innerHeight * .22), behavior: 'instant' });
    // Mede já na posição final antes de ativar a mesma dobra/véu do hover.
    const quadro = requestAnimationFrame(() => { medir(); definirSobre(relacaoNavegada); });
    return () => cancelAnimationFrame(quadro);
  }, [navegacaoAberta, relacaoNavegada, relacoes, leitor, medir]);

  const acesaId = navegacaoAberta && sobre !== relacaoNavegada ? null : sobre;
  const acesa = desenho.itens.find((item) => item.item.relacao.id === acesaId);

  // Dobra do PDF: com as duas pontas longe demais, recortes do original aproximam as duas. Primeiro
  // as páginas são renderizadas (fora da tela, com cache); só então a dobra monta e anima.
  const [dobraPdf, definirDobraPdf] = useState<EstadoDaDobra | null>(null);
  const acesaRef = useRef(acesa); acesaRef.current = acesa;
  useEffect(() => {
    const atual = acesaRef.current;
    const fonte = leitor.current?.dobraPdf;
    if (!pdf || guiada || !atual || !fonte || cabemNaTela(atual)) { definirDobraPdf(null); return; }
    const estado = construirDobra(fonte, atual.item.relacao.id, atual.de.ancora, atual.para.ancora, window.innerHeight);
    if (!estado) { definirDobraPdf(null); return; }
    let vivo = true;
    fonte.preparar([estado.recorteA, estado.recorteB]).then(() => { if (vivo) definirDobraPdf(estado); }, () => { if (vivo) definirDobraPdf(null); });
    return () => { vivo = false; };
  }, [acesaId, pdf, guiada, leitor]);
  const dobraAtual = dobraPdf !== null && dobraPdf.relacao === acesaId ? dobraPdf : null;
  // A posição é refeita a cada medida (rolagem, redimensionamento), pela origem das páginas no leitor.
  const fonteDaDobra = leitor.current?.dobraPdf;
  const arranjo = dobraAtual && fonteDaDobra ? arranjarDobra(dobraAtual, fonteDaDobra, window.innerHeight) : null;
  // O card se alinha ao círculo: o da espinha, ou o do braquete religado na dobra do PDF.
  // A altura do card aceso, medida depois de desenhado (a frase quebra em quantas linhas couber).
  const card = useRef<HTMLFieldSetElement>(null);
  const [alturaDoCard, definirAlturaDoCard] = useState(96);
  useLayoutEffect(() => {
    const altura = card.current?.offsetHeight;
    if (altura && Math.abs(altura - alturaDoCard) > 1) definirAlturaDoCard(altura);
  });
  const yDoCard = (dobraAtual && arranjo ? yDoCirculoNaDobra(dobraAtual, arranjo) : null) ?? (acesa ? (acesa.de.meio + acesa.para.meio) / 2 : 0);

  // Não cabem juntos na tela: recolhe o texto entre os dois.
  useLayoutEffect(() => {
    if (dobra.current?.id === acesa?.item.relacao.id) return;
    // Outra relação (ou nenhuma) acesa: desfaz a dobra e mede de novo na hora. A decisão sobre a
    // relação nova só vem no próximo passo, com as posições da página já desdobrada; decidir com as
    // da página recolhida desenhava a chave fora do lugar.
    if (dobra.current) { desdobrar(dobra); medir(); return; }
    if (!acesa || !deveRecolher(acesa)) return;
    const raiz = artigo?.() ?? null;
    if (!raiz || pdf) return;
    const entre = blocosEntre(acesa, blocos, raiz) ?? [];
    const recortes = prepararRecortesDoTexto(raiz, [acesa.de, acesa.para].map((p) => ({ blocoId: p.ancora.bloco_id, faixa: p.faixa })));
    const elementos = [...new Set([...entre, ...recortes.map((r) => r.elemento)])];
    if (!elementos.length) return;
    const [cima, baixo] = acesa.de.faixa.topo <= acesa.para.faixa.topo ? [acesa.de, acesa.para] : [acesa.para, acesa.de];
    // O texto recolhido fica abaixo do trecho de cima, que não sai do lugar: a página não rola. Só se
    // o trecho de cima estiver fora da tela é o de baixo que fica parado (senão os dois sumiriam).
    const ancoraFixa = cima.faixa.base > TOPO_UTIL ? cima.ancora : baixo.ancora;
    const api = leitor.current;
    const rolagemAntes = window.scrollY;
    const antes = faixaDaAncora(api, ancoraFixa)?.topo ?? 0;
    const projecoes = montarRecortesDoTexto(recortes);
    // Um marco próprio funciona também quando só há uma imagem entre as pontas.
    const marco = document.createElement('div');
    marco.setAttribute('data-colapsado', 'marco');
    marco.setAttribute('data-recolhidos', 'Conteúdo recolhido');
    // A separação fica entre as duas janelas, inclusive dentro do mesmo parágrafo.
    if (projecoes.length > 1) projecoes[1]?.before(marco);
    else if (entre.length) entre[0]?.before(marco);
    for (const elemento of elementos) elemento.setAttribute('data-colapsado', '');
    const depois = faixaDaAncora(api, ancoraFixa)?.topo;
    if (depois !== undefined) window.scrollBy({ top: depois - antes, behavior: 'instant' });
    const espinha: [number, number] = [Math.min(acesa.de.meio, acesa.para.meio) + rolagemAntes, Math.max(acesa.de.meio, acesa.para.meio) + rolagemAntes];
    dobra.current = { id: acesa.item.relacao.id, marco, elementos, projecoes, api, ancoraFixa, rolagemAntes, rolagemDepois: window.scrollY, espinha };
    medir();
  });

  if (compacta && !guiada && !navegacaoAberta) return <BraquetesCompactas itens={desenho.itens} x={desenho.x} />;
  if (filtro === 'ocultas' && !guiada) return null;
  // No celular (leitura guiada), a lateral é a sarjeta do texto: chaves estreitas, pistas de 4 px.
  const sarjeta = desenho.x >= 20 ? desenho.x - 8 : desenho.x + 10;
  const xColchete = compacta ? sarjeta : desenho.x - 12;
  const xDaPista = (pista: number) => compacta ? Math.max(2, sarjeta - 6 - pista * 4) : xDaEspinha(desenho.x, pista);

  if (guiada) {
    // Uma ponta fora da tela (a outra ponta de uma relação lá atrás no capítulo) não puxa a espinha até
    // o infinito: a chave para na borda da tela com uma seta, e o círculo só aparece com as duas à vista.
    // O comentário no documento traz o "volta a" com a citação dessa ponta.
    const alto = TOPO_UTIL + 8; const baixo = window.innerHeight - 8;
    const naJanela = (ponta: Ponta) => ponta.faixa.base > TOPO_UTIL && ponta.faixa.topo < window.innerHeight;
    return <div className="braquetes guiadas" role="group" aria-label="Relações do passo" data-destacada={destacada ?? undefined}>
    <svg className="braquetes-desenho" aria-hidden="true" width="100%" height="100%">
      {desenho.itens.map(({ item, cor, de, para, pista }) => {
        const x = xDaPista(pista);
        const aba = compacta ? 3 : 6;
        const [veDe, vePara] = [naJanela(de), naJanela(para)];
        if (!veDe && !vePara) return null;
        const y = (ponta: Ponta, visivel: boolean) => visivel ? ponta.meio : Math.max(alto, Math.min(baixo, ponta.meio));
        const [yDe, yPara] = [y(de, veDe), y(para, vePara)];
        const colchete = (faixa: Faixa) => `M ${String(xColchete + aba)} ${String(faixa.topo)} H ${String(xColchete)} V ${String(faixa.base)} H ${String(xColchete + aba)}`;
        const seta = (yPonta: number, meio: number) => { const s = meio < yPonta ? -1 : 1; return `M ${String(x - 4)} ${String(yPonta - 5 * s)} L ${String(x)} ${String(yPonta)} L ${String(x + 4)} ${String(yPonta - 5 * s)}`; };
        const traco = [
          ...(veDe ? [colchete(de.faixa), `M ${String(xColchete)} ${String(de.meio)} H ${String(x)}`] : [seta(yDe, de.meio)]),
          ...(vePara ? [colchete(para.faixa), `M ${String(xColchete)} ${String(para.meio)} H ${String(x)}`] : [seta(yPara, para.meio)]),
          `M ${String(x)} ${String(yDe)} V ${String(yPara)}`].join(' ');
        const classes = ['relacao-braquete', 'acesa', `cor-${String(cor)}`];
        if (destacada !== null && destacada !== item.relacao.id) classes.push('recuada');
        return <g key={item.relacao.id} className={classes.join(' ')} data-relacao={item.relacao.id} data-ponta-fora={veDe && vePara ? undefined : ''}>
          <path className="braquete" d={traco} />
          {!compacta && veDe && vePara && <circle className="circulo-guiado" cx={x} cy={(de.meio + para.meio) / 2} r={5} />}
        </g>;
      })}
    </svg>
  </div>;
  }

  return <div role="group" className={`braquetes${pdf ? ' no-pdf' : ''}${porPontos ? ' em-pontos' : ''}`} aria-label={`Relações do ${unidade}`} data-acesa={acesa ? '' : undefined}>
    {/* O véu do próprio braquete vale sempre, também conduzido (Percorrer, leitura comentada, visita):
        esmaece o resto e deixa as duas pontas em destaque. O véu que saiu (30/09) era o da leitura comentada. */}
    {acesa && !(pdf && !cabemNaTela(acesa)) && <VeuDaRelacao acesa={acesa} recolhido={dobra.current?.id === acesa.item.relacao.id} pdf={pdf} escurecer={porPontos} />}
    <svg className="braquetes-desenho" aria-hidden="true" width="100%" height="100%">
      {(porPontos ? desenho.itens.filter((item) => item.item.relacao.id === acesaId) : desenho.itens).map(({ item, cor, de, para, pista }) => {
        const x = xDaPista(pista);
        const colchete = (faixa: Faixa) => `M ${String(xColchete + 6)} ${String(faixa.topo)} H ${String(xColchete)} V ${String(faixa.base)} H ${String(xColchete + 6)}`;
        const traco = [colchete(de.faixa), colchete(para.faixa),
          `M ${String(xColchete)} ${String(de.meio)} H ${String(x)}`, `M ${String(xColchete)} ${String(para.meio)} H ${String(x)}`].join(' ');
        const espinha = `M ${String(x)} ${String(de.meio)} V ${String(para.meio)}`;
        const id = item.relacao.id;
        const classes = ['relacao-braquete', `cor-${String(cor)}`];
        if (acesaId === id) classes.push('acesa');
        else if (candidata === id) classes.push('candidata');
        if (item.relevante) classes.push('relevante');
        if (item.relacao.retrospectiva) classes.push('retrospectiva');
        return <g key={id} className={classes.join(' ')}>
          <path className="braquete" d={traco} />
          <path className="braquete espinha" d={espinha} />
          {/* Faixa larga e invisível só sobre a espinha, que é só desta relação: passar perto acende. */}
          <path className="alvo-do-traco" d={espinha} onPointerEnter={() => entrar(id)} />
        </g>;
      })}
    </svg>
    {!porPontos && desenho.itens.map(({ item, cor, de, para, pista }) => {
      const id = item.relacao.id;
      return <button key={id} type="button" className={`alvo-braquete cor-${String(cor)}${acesaId === id ? ' acesa' : candidata === id ? ' candidata' : ''}`}
        style={{ left: xDaPista(pista) - 11, top: (de.meio + para.meio) / 2 - 11 }}
        aria-label={`Relação: ${ROTULO_DA_RELACAO[item.relacao.tipo]}. ${item.relacao.explicacao}`}
        onPointerEnter={() => entrar(id)} onFocus={() => acender(id)} onBlur={sair} onClick={() => fixar(id)} aria-pressed={fixadaRef.current === id} />;
    })}
    {porPontos && !navegacaoAberta && <PontasAgrupadas pontos={desenho.itens.flatMap((item) => [
      { chave: `${item.item.relacao.id}:saida`, id: item.item.relacao.id, tipo: item.item.relacao.tipo, y: item.de.faixa.topo, cor: item.cor, lado: 'saida' as const, descricao: `${ROTULO_DA_RELACAO[item.item.relacao.tipo]}. ${item.item.relacao.explicacao}` },
      { chave: `${item.item.relacao.id}:chegada`, id: item.item.relacao.id, tipo: item.item.relacao.tipo, y: item.para.faixa.topo, cor: item.cor, lado: 'chegada' as const, descricao: `${ROTULO_DA_RELACAO[item.item.relacao.tipo]}. ${item.item.relacao.explicacao}` },
    ])} x={desenho.x} ativa={acesaId} aoAtivar={acender} aoFixar={fixar} aoSair={sair} />}
    {/* No PDF, a dobra de recortes reais; no texto, a janela dividida (quando o texto não pode recolher). */}
    {pdf && <SobreposicaoDaDobra estado={dobraAtual} fonte={leitor.current?.dobraPdf} arranjo={arranjo} xColchete={xColchete}
      xEspinha={acesa ? xDaPista(acesa.pista) : 0} cor={acesa?.cor ?? 0} retrospectiva={acesa?.item.relacao.retrospectiva ?? false} veu={GEOMETRIA_DO_VEU.pdf} />}
    {!pdf && acesa && !cabemNaTela(acesa) && dobra.current?.id !== acesa.item.relacao.id && (!deveRecolher(acesa) || !blocosEntre(acesa, blocos, artigo?.() ?? null)) && <JanelaDividida acesa={acesa} blocos={blocos} x={desenho.x} largura={desenho.largura} />}
    {/* A explicação abre com o hover, ao lado do círculo; não recebe o mouse, para não disputar o hover. */}
    {/* Aceso, o card da relação toma o lugar do círculo: centrado nele, com o círculo a 3/4 da largura.
        Um fieldset cuja legenda (a relação, em miúdo) interrompe a borda; mesma geometria para todas as
        relações, muda só a cor e a legenda. Não recebe o mouse, para não disputar o hover; o botão do
        círculo continua sendo a âncora lógica (hover, foco, clique fixa). */}
    {acesa && (!navegacaoAberta || navegacao?.cartao === true) && <fieldset className={`popover-braquete cor-${String(acesa.cor)}`} role="tooltip" ref={card} style={posicaoDoCard(xDaPista(acesa.pista), yDoCard, limiteDoCard(acesa, desenho.x, xColchete, yDoCard, alturaDoCard))}>
      <legend>{ROTULO_DA_RELACAO[acesa.item.relacao.tipo]}{acesa.item.relacao.retrospectiva ? ' · retrospectiva' : ''}</legend>
      <p>{acesa.item.relacao.explicacao}</p>
    </fieldset>}
    {erro && <p className="aviso-estudo" role="alert">{erro}</p>}
  </div>;
}

const CONSULTA_COMPACTA = '(max-width: 899.98px)';
/** Celular: não há lateral para as chaves nem mouse para acendê-las. */
export function useCompacta(): boolean {
  const consultar = () => typeof matchMedia === 'function' && matchMedia(CONSULTA_COMPACTA).matches;
  const [compacta, definir] = useState(consultar);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const consulta = matchMedia(CONSULTA_COMPACTA);
    const mudar = () => definir(consulta.matches);
    consulta.addEventListener('change', mudar);
    return () => consulta.removeEventListener('change', mudar);
  }, []);
  return compacta;
}

/** Pontos da lateral no celular: até três lado a lado por fileira, fileiras de 10 px. */
/** Pontos da lateral no celular: uma pilha por linha, como de avatares (até três e um "+N"). */
const DIAMETRO_DO_PONTO = 9;
const AVANCO_DO_PONTO = 5;
const VISIVEIS_NA_PILHA = 3;
const LARGURA_DA_PILHA = DIAMETRO_DO_PONTO + (VISIVEIS_NA_PILHA - 1) * AVANCO_DO_PONTO + 14;

interface EntradaDaLateral { chave: string; y: number; item: Desenhado; aqui: Ponta; outra: Ponta }

/**
 * A lateral esquerda no celular: não há espaço para chaves nem mouse. Cada ponta de relação é um ponto
 * da cor dela, na altura da linha em que começa; o que cai na mesma linha vira uma pilha sobreposta,
 * como de avatares (os números das notas ficam do outro lado, à direita). Tocar abre uma folha inferior
 * com as relações da linha, e só a pilha tocada fica na tela; tocar numa relação deixa só os dois pontos
 * dela, ligados pela espinha, e leva ao outro trecho.
 */
function BraquetesCompactas({ itens, x }: { itens: readonly Desenhado[]; x: number }): ReactNode {
  const [aberto, abrir] = useState<string | null>(null);
  const [escolhida, escolher] = useState<string | null>(null);
  const unidade = nomeDaUnidade(usarForma());
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (aberto) fechar.current?.focus({ preventScroll: true }); }, [aberto]);
  // Na sarjeta à esquerda do texto; no PDF (sem sarjeta), dentro da margem branca da página.
  const esquerda = x >= LARGURA_DA_PILHA ? Math.max(1, x - LARGURA_DA_PILHA - 2) : x + 6;
  const entradas: EntradaDaLateral[] = itens.flatMap((item) => ([[item.de, item.para, 'de'], [item.para, item.de, 'para']] as const).map(([aqui, outra, lado]): EntradaDaLateral =>
    ({ chave: `${item.item.relacao.id}:${lado}`, y: aqui.linhas[0]?.topo ?? aqui.faixa.topo, item, aqui, outra }))).sort((a, b) => a.y - b.y);
  // O que está a menos de uma linha e meia divide a mesma pilha (um só alvo de toque).
  const grupos: { chave: string; topo: number; entradas: EntradaDaLateral[] }[] = [];
  for (const entrada of entradas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && entrada.y - ultimo.topo <= 30) ultimo.entradas.push(entrada);
    else grupos.push({ chave: entrada.chave, topo: entrada.y, entradas: [entrada] });
  }
  const doAberto = grupos.find((grupo) => grupo.chave === aberto);
  const acesa = doAberto?.entradas.find((entrada) => entrada.item.item.relacao.id === escolhida);
  const centro = esquerda + DIAMETRO_DO_PONTO / 2;
  const ir = (ponta: Ponta) => { window.scrollBy({ top: ponta.faixa.topo - window.innerHeight * 0.2, behavior: 'smooth' }); };
  const quantos = (grupo: { entradas: EntradaDaLateral[] }) => `${String(grupo.entradas.length)} ${grupo.entradas.length === 1 ? 'relação' : 'relações'}`;
  const ponto = (entrada: EntradaDaLateral, indice: number) => <span key={entrada.chave}
    className={`cor-${String(entrada.item.cor)}${entrada.item.item.relacao.retrospectiva ? ' retrospectiva' : ''}`}
    style={{ left: indice * AVANCO_DO_PONTO, zIndex: indice + 1 }} />;
  // Com uma relação escolhida, ficam só as duas pontas dela; com a folha aberta, só a pilha tocada.
  const visiveis = acesa ? [] : doAberto ? [doAberto] : grupos;
  // Sem sarjeta (PDF), os pontos ficam sobre a folha branca.
  return <div role="group" className={`braquetes compactas${x >= LARGURA_DA_PILHA ? '' : ' sobre-pagina'}`} aria-label={`Relações do ${unidade}`}>
    <svg className="braquetes-desenho" aria-hidden="true" width="100%" height="100%">
      {acesa && <g className={`relacao-braquete acesa cor-${String(acesa.item.cor)}`}>
        <path className="braquete" d={`M ${String(centro)} ${String(acesa.aqui.linhas[0]?.topo ?? acesa.aqui.faixa.topo)} V ${String(acesa.outra.linhas[0]?.topo ?? acesa.outra.faixa.topo)}`} transform={`translate(0 ${String(DIAMETRO_DO_PONTO / 2 + 4)})`} />
        {[acesa.aqui, acesa.outra].map((ponta, lado) => <circle key={lado} className="ponta-escolhida" cx={centro} cy={(ponta.linhas[0]?.topo ?? ponta.faixa.topo) + DIAMETRO_DO_PONTO / 2 + 4} r={DIAMETRO_DO_PONTO / 2} />)}
      </g>}
    </svg>
    {visiveis.map((grupo) => {
      const sobram = grupo.entradas.length > VISIVEIS_NA_PILHA + 1 ? grupo.entradas.length - VISIVEIS_NA_PILHA : 0;
      const mostrados = sobram > 0 ? grupo.entradas.slice(0, VISIVEIS_NA_PILHA) : grupo.entradas;
      return <button key={grupo.chave} type="button" className={`pontos-braquete${aberto === grupo.chave ? ' aberto' : ''}`}
        style={{ left: esquerda - 4, top: grupo.topo }}
        aria-label={`${quantos(grupo)} nesta linha`} aria-expanded={aberto === grupo.chave}
        onClick={() => { escolher(null); abrir((atual) => atual === grupo.chave ? null : grupo.chave); }}>
        {mostrados.map(ponto)}
        {sobram > 0 && <span className="mais-pontos" style={{ left: mostrados.length * AVANCO_DO_PONTO, zIndex: mostrados.length + 1 }}>+{sobram}</span>}
      </button>;
    })}
    {doAberto && <div className="folha folha-braquete" role="dialog" aria-modal="false" aria-label="Nesta linha">
      <div className="folha-cabeca">
        <span className="eyebrow">{quantos(doAberto)}</span>
        <IconButton ref={fechar} className="folha-fechar" aria-label="Fechar" onClick={() => { abrir(null); escolher(null); }}>×</IconButton>
      </div>
      <ol className="pontas-da-folha">
        {doAberto.entradas.map((entrada) => <li key={entrada.chave} className={`cor-${String(entrada.item.cor)}`}>
            <button type="button" className={`ponta-da-folha${escolhida === entrada.item.item.relacao.id ? ' escolhida' : ''}`} aria-pressed={escolhida === entrada.item.item.relacao.id}
              onClick={() => { escolher(entrada.item.item.relacao.id); ir(entrada.outra); }}>
              <span className="eyebrow">{ROTULO_DA_RELACAO[entrada.item.item.relacao.tipo]}{entrada.item.item.relacao.retrospectiva ? ' · retrospectiva' : ''}</span>
              <span className="explicacao-braquete">{entrada.item.item.relacao.explicacao}</span>
              <span className="citacao-da-ponta">↗ “{entrada.outra.ancora.citacao}”</span>
            </button>
          </li>)}
      </ol>
    </div>}
  </div>;
}

/**
 * Pista de cada relação, na ordem do capítulo: pelos índices dos blocos quando o texto os tem (vale
 * para todas as relações, desenhadas ou não); senão, pela posição na página, medida uma vez.
 */
function pistasFixas(relacoes: readonly RelacaoDoCapitulo[], medidos: readonly { item: RelacaoDoCapitulo; topo: number; base: number }[], blocos: readonly Pick<Bloco, 'id'>[] | undefined): Map<string, number> {
  const indice = new Map((blocos ?? []).map((bloco, posicao) => [bloco.id, posicao]));
  const porBlocos = relacoes.flatMap((item) => {
    const a = indice.get(item.origem?.ancoras[0]?.bloco_id ?? '');
    const b = indice.get(item.destino?.ancoras[0]?.bloco_id ?? '');
    // Dez unidades por bloco: a folga de `distribuirEmPistas` separa relações que só se tocam num bloco.
    return a === undefined || b === undefined ? [] : [{ id: item.relacao.id, topo: Math.min(a, b) * 10, base: Math.max(a, b) * 10 + 5 }];
  });
  const itens = porBlocos.length === relacoes.length && relacoes.length > 0
    ? porBlocos
    : medidos.map((medido) => ({ id: medido.item.relacao.id, topo: medido.topo + window.scrollY, base: medido.base + window.scrollY }));
  return new Map(distribuirEmPistas(itens).map((item) => [item.id, item.pista]));
}

/** Texto recolhido entre os dois trechos da relação acesa, e o bloco que ficou parado na tela. */
interface Dobra {
  id: string; marco: HTMLElement; elementos: HTMLElement[]; projecoes: HTMLElement[]; api: ApiDoLeitor | null; ancoraFixa: AncoraV1; rolagemAntes: number; rolagemDepois: number;
  /** Onde estava a espinha antes de recolher, em coordenadas da página. */
  espinha: [number, number];
}

function xDaEspinha(esquerdaDaColuna: number, pista: number): number { return esquerdaDaColuna - 30 - pista * LARGURA_DA_PISTA; }

/** O mouse está sobre a espinha da relação (com o círculo)? Os colchetes, compartilhados, não contam. */
function dentroDoDesenho(item: Desenhado, esquerdaDaColuna: number, x: number, y: number): boolean {
  const [de, ate] = [Math.min(item.de.meio, item.para.meio), Math.max(item.de.meio, item.para.meio)];
  return Math.abs(x - xDaEspinha(esquerdaDaColuna, item.pista)) <= 13 && y >= de - 13 && y <= ate + 13;
}

/** Os blocos entre os dois trechos, no DOM do texto; `null` se não há o que recolher ou não há texto (PDF). */
function blocosEntre(acesa: Desenhado, blocos: readonly Pick<Bloco, 'id'>[] | undefined, raiz: HTMLElement | null): HTMLElement[] | null {
  if (!blocos || !raiz) return null;
  const a = blocos.findIndex((bloco) => bloco.id === acesa.de.ancora.bloco_id);
  const b = blocos.findIndex((bloco) => bloco.id === acesa.para.ancora.bloco_id);
  if (a === -1 || b === -1 || a === b) return null;
  const cima = raiz.querySelector<HTMLElement>(`[data-bloco="${blocos[Math.min(a, b)]?.id}"]`);
  const baixo = raiz.querySelector<HTMLElement>(`[data-bloco="${blocos[Math.max(a, b)]?.id}"]`);
  if (!cima || !baixo) return null;
  const elementos: HTMLElement[] = [];
  let entre = false;
  const imagensDaPonta = (ponta: HTMLElement, lado: 'antes' | 'depois'): void => {
    const segmentos = ponta.querySelectorAll('[data-inicio]');
    const limite = lado === 'antes' ? segmentos[0] : segmentos[segmentos.length - 1];
    if (!limite) return;
    for (const imagem of ponta.querySelectorAll('img')) {
      const posicao = limite.compareDocumentPosition(imagem);
      if (posicao & (lado === 'antes' ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING)) elementos.push(imagem);
    }
  };
  // Percorre também listas e figuras: recolhe cada subárvore inteira sem esconder
  // um contêiner que inclua uma das pontas e sem deixar imagens ou margens vazias.
  const visitar = (pai: HTMLElement): void => {
    for (const filho of pai.children) {
      if (!(filho instanceof HTMLElement)) continue;
      if (filho === cima) { imagensDaPonta(filho, 'depois'); entre = true; continue; }
      if (filho === baixo) { imagensDaPonta(filho, 'antes'); entre = false; return; }
      if (filho.contains(cima) || filho.contains(baixo)) visitar(filho);
      else if (entre) elementos.push(filho);
    }
  };
  visitar(raiz);
  return elementos.length > 0 ? elementos : null;
}

/**
 * Devolve o texto recolhido. Sem rolagem no meio tempo, a página volta exatamente para onde estava;
 * se o leitor rolou, fica parado na tela o trecho que ficou parado ao recolher.
 */
function desdobrar(dobra: { current: Dobra | null }): void {
  const atual = dobra.current;
  if (!atual) return;
  dobra.current = null;
  const intacta = Math.abs(window.scrollY - atual.rolagemDepois) < 2;
  const antes = faixaDaAncora(atual.api, atual.ancoraFixa)?.topo ?? 0;
  atual.marco.remove();
  for (const projecao of atual.projecoes) projecao.remove();
  for (const elemento of atual.elementos) { elemento.removeAttribute('data-colapsado'); elemento.removeAttribute('data-recolhidos'); }
  if (intacta) window.scrollTo({ top: atual.rolagemAntes, behavior: 'instant' });
  else { const depois = faixaDaAncora(atual.api, atual.ancoraFixa)?.topo; if (depois !== undefined) window.scrollBy({ top: depois - antes, behavior: 'instant' }); }
}

/** O parágrafo aparece, ao menos em parte, entre a barra do leitor e o pé da janela? */
function naTela(faixa: Faixa): boolean {
  return faixa.base > TOPO_UTIL && faixa.topo < window.innerHeight;
}

/**
 * Recolher só faz sentido com um dos dois trechos à vista: é ele que fica parado e recebe o outro.
 * Com os dois fora da tela, vale a janela dividida, e o texto não se mexe.
 */
function deveRecolher(acesa: Desenhado): boolean {
  return !cabemNaTela(acesa) && (naTela(acesa.de.faixa) || naTela(acesa.para.faixa));
}

/** A caixa que junta as linhas de uma citação; `null` sem linhas. */
export function faixaDasLinhas(linhas: readonly Faixa[]): Faixa | null {
  if (linhas.length === 0) return null;
  return { topo: Math.min(...linhas.map((l) => l.topo)), base: Math.max(...linhas.map((l) => l.base)),
    esquerda: Math.min(...linhas.map((l) => l.esquerda)), direita: Math.max(...linhas.map((l) => l.direita)) };
}

/** Os dois parágrafos cabem juntos entre a barra do leitor e o pé da janela? */
function cabemNaTela({ topo, base }: Pick<Desenhado, 'topo' | 'base'>): boolean {
  return topo >= TOPO_UTIL && base <= window.innerHeight;
}

/**
 * Véu sobre a página, em três tons: o resto da página esmaece forte, o resto dos dois parágrafos
 * esmaece de leve (o contexto continua legível) e só as duas citações ficam no tom do texto. É uma
 * máscara com bordas desfocadas sobre uma camada; o texto não muda de cor, fundo nem peso.
 *
 * No PDF o véu escurece a página (a folha é branca: clarear a deixaria enevoada), em dois tons só: o
 * trecho de cada ponta limpo, o resto escuro (um tom intermediário no parágrafo vira caixa). A borda é
 * curta: o desfoque é pequeno e o recorte limpo se estende além das letras por mais que o desfoque
 * alcança, então o trecho fica no contraste do original e a transição não vira brilho nem caixa dura.
 */
export const GEOMETRIA_DO_VEU = {
  texto: { desfoque: 7, citacao: { x: 3, y: 2, raio: 3 }, paragrafo: { x: 8, y: 6, raio: 8 } },
  pdf: { desfoque: 2.5, citacao: { x: 7, y: 5, raio: 5 }, paragrafo: { x: 12, y: 9, raio: 10 } },
} as const;

function VeuDaRelacao({ acesa, recolhido, pdf, escurecer = false }: { acesa: Desenhado; recolhido: boolean; pdf: boolean; escurecer?: boolean }): ReactNode {
  const id = useId();
  const g = GEOMETRIA_DO_VEU[pdf || escurecer ? 'pdf' : 'texto'];
  const [cima, baixo] = [acesa.de, acesa.para].sort((a, b) => a.faixa.topo - b.faixa.topo) as [Ponta, Ponta];
  const paragrafo = (faixa: Faixa, chave: string) => <rect key={chave} className="veu-paragrafo" x={faixa.esquerda - g.paragrafo.x} y={faixa.topo - g.paragrafo.y}
    width={faixa.direita - faixa.esquerda + 2 * g.paragrafo.x} height={faixa.base - faixa.topo + 2 * g.paragrafo.y} rx={g.paragrafo.raio} />;
  return <svg className={pdf || escurecer ? 'veu-relacao veu-pdf' : 'veu-relacao'} aria-hidden="true" width="100%" height="100%">
    <defs>
      <filter id={`${id}-bordas`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation={g.desfoque} /></filter>
      <mask id={`${id}-mascara`} maskUnits="userSpaceOnUse">
        <g filter={`url(#${id}-bordas)`}>
          <rect className="veu-pagina" x="-50" y="-50" width="200%" height="200%" />
          {!pdf && paragrafo(cima.contexto, 'cima')}
          {!pdf && paragrafo(baixo.contexto, 'baixo')}
          {/* Recolhido, entre os dois só fica o aviso da dobra: ele também fica legível. */}
          {recolhido && paragrafo({ ...cima.faixa, topo: cima.faixa.base, base: baixo.faixa.topo }, 'dobra')}
          {[cima, baixo].flatMap((ponta, lado) => ponta.linhas.map((linha, indice) =>
            <rect key={`${String(lado)}-${String(indice)}`} className="veu-citacao" x={linha.esquerda - g.citacao.x} y={linha.topo - g.citacao.y}
              width={linha.direita - linha.esquerda + 2 * g.citacao.x} height={linha.base - linha.topo + 2 * g.citacao.y} rx={g.citacao.raio} />))}
        </g>
      </mask>
    </defs>
    <rect className="veu-cor" width="100%" height="100%" mask={`url(#${id}-mascara)`} />
  </svg>;
}

/**
 * Quando os dois trechos não cabem na tela, a janela divide a página ao meio: o que vem antes no
 * capítulo em cima, o que vem depois embaixo, e a relação entre eles na divisória. O parágrafo aparece
 * esmaecido e só a citação fica no tom do texto: sem fundo, peso ou fonte trocada.
 */
function JanelaDividida({ acesa, blocos, x, largura }: { acesa: Desenhado; blocos: readonly Pick<Bloco, 'id' | 'texto'>[] | undefined; x: number; largura: number }): ReactNode {
  const deEmCima = acesa.de.faixa.topo <= acesa.para.faixa.topo;
  const [primeira, segunda] = deEmCima ? [acesa.de, acesa.para] : [acesa.para, acesa.de];
  const verbo = ROTULO_DA_RELACAO[acesa.item.relacao.tipo];
  return <div className={`janela-dividida cor-${String(acesa.cor)}`} aria-hidden="true" style={{ left: x - 16, width: largura + 32 }}>
    <Trecho ponta={primeira} blocos={blocos} rotulo={deEmCima ? 'De' : 'Para'} />
    <div className="divisoria-da-janela">
      <span>{deEmCima ? '↓' : '↑'} {verbo}{acesa.item.relacao.retrospectiva ? ' · retrospectiva' : ''}</span>
      <p>{acesa.item.relacao.explicacao}</p>
    </div>
    <Trecho ponta={segunda} blocos={blocos} rotulo={deEmCima ? 'Para' : 'De'} />
  </div>;
}

/** Até onde voltar no parágrafo antes da citação, para ela aparecer perto do topo do painel. */
const CONTEXTO_ANTES = 220;

function Trecho({ ponta, blocos, rotulo }: { ponta: Ponta; blocos: readonly Pick<Bloco, 'id' | 'texto'>[] | undefined; rotulo: string }): ReactNode {
  const { ancora } = ponta;
  const texto = blocos?.find((bloco) => bloco.id === ancora.bloco_id)?.texto;
  const dentro = texto !== undefined && texto.slice(ancora.inicio_utf16, ancora.fim_utf16) === ancora.citacao;
  let antes = dentro ? texto.slice(0, ancora.inicio_utf16) : '';
  if (antes.length > CONTEXTO_ANTES) antes = `…${antes.slice(antes.length - CONTEXTO_ANTES).replace(/^\S*\s/u, '')}`;
  const depois = dentro ? texto.slice(ancora.fim_utf16) : '';
  return <section className="painel-da-janela">
    <span className="eyebrow">{rotulo}</span>
    <p className="texto-da-janela"><span className="contexto">{antes}</span>{ancora.citacao}<span className="contexto">{depois}</span></p>
  </section>;
}
