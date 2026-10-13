/**
 * Dobra do braquete no PDF. Quando as duas pontas de uma relação não cabem juntas na tela, a folha
 * se "dobra": o trecho entre elas some da vista e as duas partes se aproximam. O leitor continua
 * intacto atrás; nada muda de lugar, a rolagem não mexe e nenhum conteúdo é removido. Por cima dele
 * surge uma apresentação temporária feita de recortes reais do PDF, renderizados pelo PDF.js na mesma
 * escala do leitor, com as mesmas marcas.
 *
 * A separação é esta: âncoras e geometria do leitor → `EstadoDaDobra` → recortes do PDF.js → Motion.
 * O Motion só anima os invólucros (posição e opacidade); o canvas não sofre zoom nem morph.
 */
import { AnimatePresence, motion, useReducedMotion, type Transition, type Variants } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { apararRecorte, faixasVerticais, paginaParaDobra, recorteDaRegiao, type RecortePdf, type RegiaoPdf } from '../pdf-recortes';
import type { DobraDoPdf as FonteDaDobra } from '../tipos';
import type { AncoraV1 } from '@margem/contratos';
import type { Retangulo } from '../../ui/marcador/tracos';

/** O estado da dobra: as duas pontas (a de cima, A, e a de baixo, B, na ordem do documento) e os recortes. */
export interface EstadoDaDobra {
  relacao: string;
  regiaoA: RegiaoPdf;
  regiaoB: RegiaoPdf;
  recorteA: RecortePdf;
  recorteB: RecortePdf;
}

/** Da barra do leitor para baixo, com folga; e a dobra entre os recortes. */
export const TOPO_DA_DOBRA = 64;
export const FOLGA_DA_DOBRA = 12;
export const ALTURA_DA_DOBRA = 20;

/** A ponta de cima no documento: página menor, ou a mesma página e mais alta. */
function antes(a: RegiaoPdf, b: RegiaoPdf): boolean {
  return a.pagina < b.pagina || (a.pagina === b.pagina && Math.min(...a.linhas.map((l) => l.y)) <= Math.min(...b.linhas.map((l) => l.y)));
}

/**
 * Deriva a dobra das duas pontas. Usa a primeira página de cada citação e a mesma escala do leitor;
 * cada recorte tem no máximo metade da altura útil da tela.
 */
export function construirDobra(fonte: FonteDaDobra, relacao: string, de: AncoraV1, para: AncoraV1, alturaDaTela: number): EstadoDaDobra | null {
  const r1 = fonte.regioes(de)[0];
  const r2 = fonte.regioes(para)[0];
  if (!r1 || !r2 || r1.linhas.length === 0 || r2.linhas.length === 0) return null;
  const [regiaoA, regiaoB] = antes(r1, r2) ? [r1, r2] : [r2, r1];
  const alturaMaxima = Math.max(80, (alturaDaTela - TOPO_DA_DOBRA - FOLGA_DA_DOBRA - ALTURA_DA_DOBRA) / 2);
  return { relacao, regiaoA, regiaoB, recorteA: recorteDaRegiao(regiaoA, alturaMaxima), recorteB: recorteDaRegiao(regiaoB, alturaMaxima) };
}

export interface ArranjoDaDobra {
  a: { x: number; y: number };
  b: { x: number; y: number };
  dobra: number;
  /** Os recortes como aparecem: o contexto pode ter sido aparado para a ponta parada não sair do lugar. */
  recorteA: RecortePdf;
  recorteB: RecortePdf;
  /** A ponta que ficou exatamente onde está no leitor (e não se move na entrada), ou nenhuma. */
  fixa: 'a' | 'b' | null;
}

/**
 * Onde os dois recortes ficam na tela. A ponta que está à vista não sai do lugar: se o contexto dela
 * passa sob a barra (ou do pé da tela), só o contexto é aparado, nunca a citação, e a outra ponta vem
 * até ela. Primeiro tenta A parada e B logo abaixo; depois B parada e A logo acima; com as duas fora
 * da tela, as duas ficam juntas no alto da área útil.
 */
export function arranjarDobra(estado: EstadoDaDobra, fonte: Pick<FonteDaDobra, 'origemDaPagina'>, alturaDaTela: number): ArranjoDaDobra | null {
  const paginaA = fonte.origemDaPagina(estado.regiaoA.pagina);
  const paginaB = fonte.origemDaPagina(estado.regiaoB.pagina);
  if (!paginaA || !paginaB) return null;
  const topo = TOPO_DA_DOBRA; const fundo = alturaDaTela - FOLGA_DA_DOBRA;
  const montar = (recorteA: RecortePdf, recorteB: RecortePdf, yA: number, fixa: ArranjoDaDobra['fixa']): ArranjoDaDobra => ({
    a: { x: paginaA.x, y: yA }, b: { x: paginaB.x, y: yA + recorteA.altura + ALTURA_DA_DOBRA }, dobra: yA + recorteA.altura, recorteA, recorteB, fixa,
  });

  // A parada: o que ficaria sob a barra sai do topo de A; o que passaria do pé sai do fim de B.
  const comA = (): ArranjoDaDobra | null => {
    const recorteA = apararRecorte(estado.regiaoA, estado.recorteA, { topo: topo - paginaA.y });
    if (!recorteA) return null;
    const yA = paginaA.y + recorteA.y;
    const yB = yA + recorteA.altura + ALTURA_DA_DOBRA;
    if (yB >= fundo) return null;
    const recorteB = apararRecorte(estado.regiaoB, estado.recorteB, { base: estado.recorteB.y + (fundo - yB) });
    return recorteB ? montar(recorteA, recorteB, yA, 'a') : null;
  };
  // B parada: o que passaria do pé sai do fim de B; o que não cabe acima sai do topo de A.
  const comB = (): ArranjoDaDobra | null => {
    const recorteB = apararRecorte(estado.regiaoB, estado.recorteB, { topo: topo - paginaB.y, base: fundo - paginaB.y });
    if (!recorteB) return null;
    const yB = paginaB.y + recorteB.y;
    const espaco = yB - ALTURA_DA_DOBRA - topo;
    if (espaco <= 0) return null;
    const fimA = estado.recorteA.y + estado.recorteA.altura;
    const recorteA = apararRecorte(estado.regiaoA, estado.recorteA, { topo: fimA - espaco });
    return recorteA ? montar(recorteA, recorteB, yB - ALTURA_DA_DOBRA - recorteA.altura, 'b') : null;
  };
  const total = estado.recorteA.altura + ALTURA_DA_DOBRA + estado.recorteB.altura;
  return comA() ?? comB() ?? montar(estado.recorteA, estado.recorteB, topo + Math.max(0, (fundo - topo - total) / 2), null);
}

/** As linhas da citação na dobra: página → recorte → tela, cortadas ao recorte. */
export function linhasNaDobra(regiao: RegiaoPdf, recorte: RecortePdf, noEcra: { x: number; y: number }): Retangulo[] {
  return regiao.linhas
    .filter((linha) => linha.y + linha.altura > recorte.y && linha.y < recorte.y + recorte.altura)
    .map((linha) => paginaParaDobra(linha, recorte, noEcra));
}

/**
 * Quanto do documento ficou escondido na dobra, para dizer no vinco. De uma página para outra, conta
 * em páginas (o resto da página de A, as inteiras do meio e o começo da de B); menos de uma página, ou
 * na mesma página, conta as linhas entre os recortes.
 */
export function distanciaOmitida(estado: EstadoDaDobra): string {
  const { regiaoA, regiaoB, recorteA, recorteB } = estado;
  const fimA = recorteA.y + recorteA.altura;
  const linhas = (regiao: RegiaoPdf, de: number, ate: number) => faixasVerticais(regiao.linhasDaPagina ?? []).filter((l) => l.y >= de && l.y + l.altura <= ate).length;
  const plural = (n: number, um: string, varios: string) => `${String(n)} ${n === 1 ? um : varios}`;
  if (regiaoA.pagina === regiaoB.pagina) return plural(linhas(regiaoA, fimA, recorteB.y), 'linha', 'linhas');
  const paginas = (regiaoA.altura - fimA) / regiaoA.altura + (regiaoB.pagina - regiaoA.pagina - 1) + recorteB.y / regiaoB.altura;
  if (paginas >= 0.95) return plural(Math.max(1, Math.round(paginas)), 'página', 'páginas');
  return plural(linhas(regiaoA, fimA, regiaoA.altura) + linhas(regiaoB, 0, recorteB.y), 'linha', 'linhas');
}

/** O véu do braquete (o do leitor quando as pontas estão perto) dentro do recorte: só a citação fica limpa. */
export interface GeometriaDoVeu { desfoque: number; citacao: { x: number; y: number; raio: number } }

function VeuDoRecorte({ regiao, recorte, veu }: { regiao: RegiaoPdf; recorte: RecortePdf; veu: GeometriaDoVeu }): ReactNode {
  const id = useId();
  const linhas = linhasNaDobra(regiao, recorte, { x: 0, y: 0 });
  return <svg className="dobra-pdf-veu-do-recorte" width={recorte.largura} height={recorte.altura} aria-hidden="true">
    <defs>
      <filter id={`${id}-bordas`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation={veu.desfoque} /></filter>
      <mask id={`${id}-mascara`} maskUnits="userSpaceOnUse">
        <g filter={`url(#${id}-bordas)`}>
          <rect x={-50} y={-50} width={recorte.largura + 100} height={recorte.altura + 100} fill="#fff" />
          {linhas.map((l, i) => <rect key={i} x={l.x - veu.citacao.x} y={l.y - veu.citacao.y} width={l.largura + 2 * veu.citacao.x} height={l.altura + 2 * veu.citacao.y} rx={veu.citacao.raio} fill="#000" />)}
        </g>
      </mask>
    </defs>
    <rect className="veu-cor" width="100%" height="100%" mask={`url(#${id}-mascara)`} />
  </svg>;
}

const EASE: Transition['ease'] = [0.22, 1, 0.36, 1];

/**
 * A dobra montada: o véu na cor do leitor, os dois recortes que convergem, a dobra entre eles e o
 * braquete religando as pontas. Recebe o estado já pronto (as páginas renderizadas): nada aparece vazio.
 */
export function SobreposicaoDaDobra({ estado, fonte, arranjo, xColchete, xEspinha, cor, retrospectiva, veu }: {
  estado: EstadoDaDobra | null;
  fonte: FonteDaDobra | undefined;
  arranjo: ArranjoDaDobra | null;
  xColchete: number;
  xEspinha: number;
  cor: number;
  retrospectiva: boolean;
  /** Com o véu, o resto dos recortes escurece como a página escurece com as pontas perto. */
  veu?: GeometriaDoVeu | undefined;
}): ReactNode {
  const reduzido = useReducedMotion() ?? false;
  const passo = reduzido ? 0 : 1;
  const transicao: Transition = { duration: reduzido ? 0.08 : 0.18, ease: EASE };
  // A ponta parada não se move: só aparece. A outra é que se aproxima dela.
  const deslocA = arranjo?.fixa === 'a' ? 0 : passo;
  const deslocB = arranjo?.fixa === 'b' ? 0 : passo;
  const variantesA: Variants = { oculto: { opacity: 0, y: -12 * deslocA }, visivel: { opacity: 1, y: 0 }, saida: { opacity: 0, y: -8 * deslocA } };
  const variantesB: Variants = { oculto: { opacity: 0, y: 12 * deslocB }, visivel: { opacity: 1, y: 0 }, saida: { opacity: 0, y: 8 * deslocB } };
  const aberta = estado !== null && fonte !== undefined && arranjo !== null;
  return <AnimatePresence>
    {aberta && <motion.div key={estado.relacao} className="dobra-pdf" aria-hidden="true" data-relacao={estado.relacao}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduzido ? 0.06 : 0.12 }}>
      <div className="dobra-pdf-veu" />
      <motion.div className="dobra-pdf-recorte dobra-pdf-alvo" style={{ left: arranjo.a.x, top: arranjo.a.y }}
        variants={variantesA} initial="oculto" animate="visivel" exit="saida" transition={transicao}>
        {fonte.recorte(arranjo.recorteA)}
        {veu && <VeuDoRecorte regiao={estado.regiaoA} recorte={arranjo.recorteA} veu={veu} />}
      </motion.div>
      <motion.div className="dobra-pdf-vinco" style={{ left: arranjo.a.x, top: arranjo.dobra, width: arranjo.recorteA.largura, height: ALTURA_DA_DOBRA }}
        initial={{ opacity: 0, scaleX: reduzido ? 1 : 0.7 }} animate={{ opacity: 1, scaleX: 1 }} exit={{ opacity: 0, scaleX: reduzido ? 1 : 0.7 }} transition={transicao}>
        <span className="dobra-pdf-omitido">{distanciaOmitida({ ...estado, recorteA: arranjo.recorteA, recorteB: arranjo.recorteB })}</span>
      </motion.div>
      <motion.div className="dobra-pdf-recorte dobra-pdf-alvo" style={{ left: arranjo.b.x, top: arranjo.b.y }}
        variants={variantesB} initial="oculto" animate="visivel" exit="saida" transition={transicao}>
        {fonte.recorte(arranjo.recorteB)}
        {veu && <VeuDoRecorte regiao={estado.regiaoB} recorte={arranjo.recorteB} veu={veu} />}
      </motion.div>
      <BraqueteDobrado estado={estado} arranjo={arranjo} xColchete={xColchete} xEspinha={xEspinha} cor={cor} retrospectiva={retrospectiva} reduzido={reduzido} />
    </motion.div>}
  </AnimatePresence>;
}

/** As citações de A e B na dobra, em px da tela: onde vão os colchetes do braquete religado. */
function pontasNaDobra(estado: EstadoDaDobra, arranjo: ArranjoDaDobra): { a: { topo: number; base: number }; b: { topo: number; base: number } } | null {
  const faixa = (linhas: Retangulo[]) => linhas.length === 0 ? null : { topo: Math.min(...linhas.map((l) => l.y)), base: Math.max(...linhas.map((l) => l.y + l.altura)) };
  const a = faixa(linhasNaDobra(estado.regiaoA, arranjo.recorteA, arranjo.a));
  const b = faixa(linhasNaDobra(estado.regiaoB, arranjo.recorteB, arranjo.b));
  return a && b ? { a, b } : null;
}

/** Onde fica o círculo do braquete religado (o card da relação se alinha a ele). */
export function yDoCirculoNaDobra(estado: EstadoDaDobra, arranjo: ArranjoDaDobra): number | null {
  const pontas = pontasNaDobra(estado, arranjo);
  return pontas ? ((pontas.a.topo + pontas.a.base) / 2 + (pontas.b.topo + pontas.b.base) / 2) / 2 : null;
}

/** O braquete da relação religado na dobra: um colchete em cada citação, e a espinha agora curta entre eles. */
function BraqueteDobrado({ estado, arranjo, xColchete, xEspinha, cor, retrospectiva, reduzido }: {
  estado: EstadoDaDobra; arranjo: ArranjoDaDobra; xColchete: number; xEspinha: number; cor: number; retrospectiva: boolean; reduzido: boolean;
}): ReactNode {
  const pontas = pontasNaDobra(estado, arranjo);
  if (!pontas) return null;
  const { a, b } = pontas;
  const meioA = (a.topo + a.base) / 2; const meioB = (b.topo + b.base) / 2;
  const colchete = (f: { topo: number; base: number }) => `M ${String(xColchete + 6)} ${String(f.topo)} H ${String(xColchete)} V ${String(f.base)} H ${String(xColchete + 6)}`;
  const traco = [colchete(a), colchete(b), `M ${String(xColchete)} ${String(meioA)} H ${String(xEspinha)}`, `M ${String(xColchete)} ${String(meioB)} H ${String(xEspinha)}`].join(' ');
  const espinha = `M ${String(xEspinha)} ${String(meioA)} V ${String(meioB)}`;
  const desenhar = { initial: { pathLength: reduzido ? 1 : 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, exit: { pathLength: reduzido ? 1 : 0, opacity: 0 },
    transition: { duration: reduzido ? 0.08 : 0.22, ease: EASE } };
  return <svg className="dobra-pdf-braquete" width="100%" height="100%">
    <g className={`relacao-braquete acesa cor-${String(cor)}${retrospectiva ? ' retrospectiva' : ''}`}>
      <motion.path className="braquete" d={traco} {...desenhar} />
      <motion.path className="braquete espinha" d={espinha} {...desenhar} />
      {/* Sem círculo: o card da relação ocupa o meio da espinha religada (veja Braquetes). */}
      {/* A espinha religada também segura o hover: do braquete ao recorte A e ao B sem fechar. */}
      <path className="alvo-do-traco dobra-pdf-alvo" d={`M ${String(xEspinha)} ${String(meioA - 12)} V ${String(meioB + 12)}`} />
    </g>
  </svg>;
}
