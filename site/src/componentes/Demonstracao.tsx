import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  APARENCIA_PADRAO, DISTANCIA_DO_COLCHETE, FUNCOES_FILOSOFICAS, ROTULOS_DOS_ESTILOS, ROTULO_DA_RELACAO,
  estiloDoNumero, opacidadeDaMarca, posicaoDoCard, retangulosDosTrechos, tracosDaMarca, xDaEspinha, type Estilo,
} from '../app/marcador';
import type { Retangulo } from '../app/tracos';
import { BLOCOS, DOCUMENTO, FONTE, MARCAS, PERGUNTA, RELACOES, TITULO, segmentos, type Ancora, type RelacaoDoRecorte } from '../demo/recorte';
import { CONFIG } from '../config';
import { usarEscuro } from './usarEscuro';

const VAO_ENTRE_NOTAS = 10;
/** A ordem em que as relações acendem sozinhas: acesa, repouso, a próxima… (cada passo, `PASSO_MS`). */
const ROTEIRO: readonly (string | null)[] = ['r2', null, 'r1', null, 'r3', null];
const PASSO_MS = 3800;
const INTERVALO_DAS_MARCAS_MS = 450;

function prefereMenosMovimento(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Faixa { topo: number; base: number; meio: number; esquerda: number }
interface Braquete { relacao: RelacaoDoRecorte; cor: number; de: Faixa; para: Faixa; x: number }
interface Geometria { linhas: Record<string, Retangulo[]>; topos: Record<string, number>; alturaMargem: number; braquetes: Braquete[]; xColchete: number; compacta: boolean; minimo: number }
const VAZIA: Geometria = { linhas: {}, topos: {}, alturaMargem: 0, braquetes: [], xColchete: -DISTANCIA_DO_COLCHETE, compacta: false, minimo: 0 };

/** Pistas como `distribuirEmPistas` do app: espinhas que se cruzam na vertical ficam lado a lado. */
function distribuirEmPistas(intervalos: readonly [number, number][]): number[] {
  const ocupadas: [number, number][][] = [];
  return intervalos.map(([a, b]) => {
    let pista = ocupadas.findIndex((lista) => lista.every(([c, d]) => b < c || a > d));
    if (pista < 0) { pista = ocupadas.length; ocupadas.push([]); }
    ocupadas[pista]!.push([a, b]);
    return pista;
  });
}

const mesmaAncora = (a: Ancora, b: Ancora): boolean => a.bloco_id === b.bloco_id && a.inicio_utf16 === b.inicio_utf16;
const marcaDaAncora = (a: Ancora): string | undefined => MARCAS.find((m) => mesmaAncora(m.ancora, a))?.id;

function CardDaRelacao({ b, estilo, className = 'popover-braquete' }: { b: Braquete; estilo?: CSSProperties; className?: string }): ReactNode {
  return (
    <fieldset className={`${className} cor-${b.cor}`} style={estilo}>
      <legend>{ROTULO_DA_RELACAO[b.relacao.tipo]}</legend>
      <p>{b.relacao.explicacao}</p>
    </fieldset>
  );
}

/**
 * Um recorte do leitor do Margem dentro da página: os dados vêm no formato do app (`demo/recorte.ts`)
 * e o desenho é o do app, copiado em `app/` — o Marcador no padrão (grifo, régua, intensidade .3, por
 * saliência), a margem que mostra só os números e abre a nota da marca ativa, e as braquetes das
 * relações à esquerda do texto (colchetes, espinha, círculo e, acesa, o card com o nome da relação).
 */
export function Demonstracao(): ReactNode {
  const raiz = useRef<HTMLElement>(null);
  const artigo = useRef<HTMLDivElement>(null);
  const margem = useRef<HTMLDivElement>(null);
  const escuro = usarEscuro();
  const [estilo, definirEstilo] = useState<Estilo>(APARENCIA_PADRAO.estilo);
  // O botão Marcas do leitor: mostra todas as marcas ou nenhuma (o app não tem mais níveis de atenção).
  const [comMarcas, definirComMarcas] = useState(true);
  const atencao = comMarcas ? 3 : 0;
  const [reveladas, definirReveladas] = useState(0);
  const [ativa, definirAtiva] = useState<string | null>(null);
  const [acesa, definirAcesa] = useState<string | null>(null);
  const [manual, definirManual] = useState(false);
  const [geometria, definirGeometria] = useState<Geometria>(VAZIA);
  const [versao, definirVersao] = useState(0);

  const relacoesProntas = reveladas > MARCAS.length;

  // As marcas se desenham uma a uma quando o recorte aparece (o Desenho do app, 800 ms cada); sem movimento, já prontas.
  useEffect(() => {
    if (prefereMenosMovimento() || typeof IntersectionObserver !== 'function') {
      definirReveladas(MARCAS.length + 2); definirAcesa('r2'); definirManual(true); return;
    }
    let relogio: number | undefined;
    const observador = new IntersectionObserver((entradas) => {
      if (!entradas.some((e) => e.isIntersecting)) return;
      observador.disconnect();
      relogio = window.setInterval(() => {
        definirReveladas((n) => { if (n >= MARCAS.length + 1) window.clearInterval(relogio); return n + 1; });
      }, INTERVALO_DAS_MARCAS_MS);
    }, { threshold: .2 });
    if (raiz.current) observador.observe(raiz.current);
    return () => { observador.disconnect(); window.clearInterval(relogio); };
  }, []);

  // Depois, as relações acendem uma de cada vez, com um repouso entre elas, até o leitor tocar numa.
  useEffect(() => {
    if (!relacoesProntas || manual) return;
    let passo = 0;
    definirAcesa(ROTEIRO[0] ?? null);
    const relogio = window.setInterval(() => { passo = (passo + 1) % ROTEIRO.length; definirAcesa(ROTEIRO[passo] ?? null); }, PASSO_MS);
    return () => { window.clearInterval(relogio); };
  }, [relacoesProntas, manual]);

  useEffect(() => {
    const refazer = (): void => { definirVersao((v) => v + 1); };
    void document.fonts?.ready.then(refazer);
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(refazer) : null;
    if (artigo.current) observador?.observe(artigo.current);
    return () => { observador?.disconnect(); };
  }, []);

  const visivel = useCallback((saliencia: number): boolean => atencao > 0 && saliencia <= atencao, [atencao]);

  useLayoutEffect(() => {
    const texto = artigo.current;
    if (!texto) return;
    const base = texto.getBoundingClientRect();
    const linhas: Record<string, Retangulo[]> = {};
    for (const marca of MARCAS) {
      const spans = [...texto.querySelectorAll(`[data-marcas~="${marca.id}"]`)];
      linhas[marca.id] = retangulosDosTrechos(spans, base);
    }
    // A margem: cada nota na altura da primeira linha do trecho, sem encostar na anterior.
    const topos: Record<string, number> = {};
    let fim = -Infinity;
    for (const nota of margem.current?.querySelectorAll<HTMLElement>('[data-nota]') ?? []) {
      const id = nota.dataset['nota'] ?? '';
      if (getComputedStyle(nota).display === 'none') continue;
      const primeira = linhas[id]?.[0];
      const topo = Math.max((primeira?.y ?? 0) + ((primeira?.altura ?? 24) - 24) / 2, fim + VAO_ENTRE_NOTAS);
      topos[id] = topo;
      fim = topo + nota.offsetHeight;
    }
    // Braquetes: colchete a 12 px da coluna, espinhas a 30 px + 14 por pista (no celular, mais juntas).
    const compacta = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
    const xColchete = compacta ? -6 : -DISTANCIA_DO_COLCHETE;
    const faixa = (id: string | undefined): Faixa | null => {
      const ls = id ? linhas[id] ?? [] : [];
      if (!ls.length) return null;
      const topo = Math.min(...ls.map((l) => l.y));
      const baseDaFaixa = Math.max(...ls.map((l) => l.y + l.altura));
      return { topo, base: baseDaFaixa, meio: (topo + baseDaFaixa) / 2, esquerda: Math.min(...ls.map((l) => l.x)) };
    };
    const validas = RELACOES.flatMap((relacao, cor) => {
      const [idDe, idPara] = [marcaDaAncora(relacao.origem), marcaDaAncora(relacao.destino)];
      const [mDe, mPara] = [MARCAS.find((m) => m.id === idDe), MARCAS.find((m) => m.id === idPara)];
      const [de, para] = [faixa(idDe), faixa(idPara)];
      return mDe && mPara && visivel(mDe.saliencia) && visivel(mPara.saliencia) && de && para ? [{ relacao, cor, de, para }] : [];
    });
    const pistas = distribuirEmPistas(validas.map(({ de, para }) => [Math.min(de.meio, para.meio), Math.max(de.meio, para.meio)]));
    const braquetes = validas.map((v, i) => ({ ...v, x: compacta ? -14 - (pistas[i] ?? 0) * 5 : xDaEspinha(0, pistas[i] ?? 0) }));
    const lateral = texto.parentElement?.querySelector<HTMLElement>('.demo-lateral');
    const minimo = lateral && getComputedStyle(lateral).display !== 'none' ? lateral.getBoundingClientRect().left - base.left : xColchete - 40;
    definirGeometria({ linhas, topos, alturaMargem: fim, braquetes, xColchete, compacta, minimo });
  }, [versao, atencao, ativa, reveladas, visivel]);

  const numero = (id: string): number => MARCAS.findIndex((m) => m.id === id) + 1;
  // Uma nota aberta pelo trecho suspende a relação acesa: o leitor está olhando para outra coisa.
  const braqueteAceso = relacoesProntas && ativa === null ? geometria.braquetes.find((b) => b.relacao.id === acesa) ?? null : null;
  const citadas = braqueteAceso ? [marcaDaAncora(braqueteAceso.relacao.origem), marcaDaAncora(braqueteAceso.relacao.destino)] : [];
  const blocosCitados = braqueteAceso ? [braqueteAceso.relacao.origem.bloco_id, braqueteAceso.relacao.destino.bloco_id] : [];

  const tocarRelacao = (id: string | null): void => { definirManual(true); definirAcesa(id); };
  const card = (b: Braquete): CSSProperties => {
    // Como no app: o card não passa da coluna do texto e, se cruza a altura de um colchete, para antes dele.
    const y = (b.de.meio + b.para.meio) / 2;
    const cruza = [b.de, b.para].some((f) => f.topo < y + 30 && f.base > y - 30);
    const limite = cruza ? Math.min(-10, geometria.xColchete - 8) : -10;
    return posicaoDoCard(b.x, y, limite, geometria.minimo);
  };

  return (
    <figure className="demo" ref={raiz} aria-labelledby="demo-legenda" data-escuro={escuro ? '' : undefined}>
      <div className="demo-barra">
        <span className="demo-documento"><span aria-hidden="true">‹</span> {DOCUMENTO}</span>
        <div className="demo-controles">
          <div className="demo-segmentado">
            <button type="button" role="switch" aria-checked={comMarcas} onClick={() => { definirComMarcas((v) => !v); }}>Marcas</button>
          </div>
          <div className="demo-segmentado" role="radiogroup" aria-label="Estilo das marcas">
            {(['grifo', 'marca_texto', 'sublinhado'] as const).map((opcao) => (
              <button key={opcao} type="button" role="radio" aria-checked={estilo === opcao} onClick={() => { definirEstilo(opcao); }}>{ROTULOS_DOS_ESTILOS[opcao]}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="demo-corpo" data-relacao-acesa={braqueteAceso ? '' : undefined}>
        <div className="demo-lateral" aria-hidden="true" />
        <div className="demo-texto" ref={artigo} lang="pt-BR">
          <svg className="camada-de-marcas" aria-hidden="true" focusable="false">
            {MARCAS.map((marca, indice) => {
              if (!visivel(marca.saliencia) || indice >= reveladas) return null;
              const cor = FUNCOES_FILOSOFICAS[marca.funcao].cor;
              const opacidade = opacidadeDaMarca(marca.saliencia, ativa, marca.id, escuro);
              return (
                <g key={marca.id} data-desenho={marca.id} data-animacao="desenhando">
                  {tracosDaMarca(geometria.linhas[marca.id] ?? [], { id: marca.id, cor, saliencia: marca.saliencia, estilo, ativa: ativa === marca.id }).map((t, i) => (
                    <path key={i} d={t.d} fill={t.preenchido ? t.cor : 'none'} stroke={t.preenchido ? 'none' : t.cor} strokeWidth={t.espessura}
                      strokeLinecap="round" strokeLinejoin="round" pathLength={1}
                      opacity={t.preenchido ? opacidade : Math.min(1, opacidade + .5)} className={t.preenchido ? 'traco-faixa' : 'traco-linha'} />
                  ))}
                </g>
              );
            })}
          </svg>

          <svg className="braquetes-desenho" aria-hidden="true" focusable="false" data-acesa={braqueteAceso ? '' : undefined}>
            {relacoesProntas && geometria.braquetes.map((b) => {
              const xc = geometria.xColchete;
              const aba = geometria.compacta ? 3 : 6;
              const colchete = (f: Faixa): string => `M ${xc + aba} ${f.topo} H ${xc} V ${f.base} H ${xc + aba}`;
              const d = [colchete(b.de), colchete(b.para), `M ${xc} ${b.de.meio} H ${b.x}`, `M ${xc} ${b.para.meio} H ${b.x}`].join(' ');
              return (
                <g key={b.relacao.id} className={`relacao-braquete cor-${b.cor}${acesa === b.relacao.id ? ' acesa' : ''}`}>
                  <path className="braquete" d={d} />
                  <path className="braquete espinha" d={`M ${b.x} ${b.de.meio} V ${b.para.meio}`} />
                </g>
              );
            })}
          </svg>
          {relacoesProntas && geometria.braquetes.map((b) => (
            <button key={b.relacao.id} type="button" className={`alvo-braquete cor-${b.cor}${acesa === b.relacao.id ? ' acesa' : ''}`}
              style={{ left: b.x - 11, top: (b.de.meio + b.para.meio) / 2 - 11 }}
              aria-label={`Relação: ${ROTULO_DA_RELACAO[b.relacao.tipo]}. ${b.relacao.explicacao}`} aria-pressed={acesa === b.relacao.id}
              onPointerEnter={() => { tocarRelacao(b.relacao.id); }} onPointerLeave={() => { tocarRelacao(null); }}
              onFocus={() => { tocarRelacao(b.relacao.id); }} onClick={() => { tocarRelacao(b.relacao.id); }} />
          ))}
          {braqueteAceso && !geometria.compacta && <CardDaRelacao key={braqueteAceso.relacao.id} b={braqueteAceso} estilo={card(braqueteAceso)} />}

          <h3 className="demo-titulo">{TITULO}</h3>
          {BLOCOS.map((bloco, i) => (
            <p key={bloco.id} className="demo-paragrafo" data-bloco={bloco.id} data-veu={braqueteAceso && !blocosCitados.includes(bloco.id) ? 'cheio' : braqueteAceso ? 'leve' : undefined}>
              {i === 2 && <span className="demo-elipse" aria-label="trecho omitido">[…] </span>}
              {segmentos(bloco, MARCAS.filter((m) => visivel(m.saliencia))).map((s, j) => s.marcas.length === 0
                ? <span key={j}>{s.texto}</span>
                : (
                  <span key={j} data-marcas={s.marcas.join(' ')} data-citada={s.marcas.some((id) => citadas.includes(id)) ? '' : undefined}
                    onMouseEnter={() => { definirAtiva(s.marcas[0] ?? null); }} onMouseLeave={() => { definirAtiva(null); }}>{s.texto}</span>
                ))}
            </p>
          ))}
          <p className="demo-fonte">{FONTE}</p>
        </div>

        <div className="demo-margem" ref={margem} style={{ minHeight: geometria.alturaMargem }} aria-label="Notas na margem">
          {MARCAS.map((marca) => {
            if (!visivel(marca.saliencia) || numero(marca.id) > reveladas) return null;
            const funcao = FUNCOES_FILOSOFICAS[marca.funcao];
            const aberta = ativa === marca.id;
            return (
              <aside key={marca.id} data-nota={marca.id} className={aberta ? 'nota ativa' : 'nota'} style={{ top: geometria.topos[marca.id] ?? 0 }}
                onMouseEnter={() => { definirAtiva(marca.id); }} onMouseLeave={() => { definirAtiva(null); }}>
                <p className="nota-cabeca">
                  <button type="button" className={`nota-numero${marca.saliencia === 3 ? ' periferica' : ''}`} style={estiloDoNumero(funcao.cor)}
                    aria-label={`Nota ${numero(marca.id)}: ${funcao.rotulo}`} aria-expanded={aberta}
                    onFocus={() => { definirAtiva(marca.id); }} onClick={() => { definirAtiva(aberta ? null : marca.id); }}>{numero(marca.id)}</button>
                  <span className="nota-rotulo">{funcao.rotulo}</span>
                </p>
                <p className="nota-texto">{marca.comentario.texto}</p>
                {aberta && marca.id === PERGUNTA.marca && (
                  <div className="nota-conversa">
                    <p className="nota-pergunta"><span className="nota-quem">Você</span>{PERGUNTA.pergunta}</p>
                    <p><span className="nota-quem">{CONFIG.nome}</span>{PERGUNTA.resposta}</p>
                  </div>
                )}
              </aside>
            );
          })}
        </div>
      </div>

      {/* Sem lugar à esquerda do texto, o card da relação acesa vem embaixo. */}
      <div className="demo-relacao-estreita" aria-live="polite">
        {braqueteAceso
          ? <CardDaRelacao key={braqueteAceso.relacao.id} b={braqueteAceso} className="popover-braquete estatico" />
          : <p className="demo-relacao-dica">{relacoesProntas ? 'Toque num círculo à esquerda do texto para ver como dois trechos se ligam.' : ''}</p>}
      </div>

      <figcaption id="demo-legenda" className="demo-legenda">
        Um recorte do leitor do {CONFIG.nome} dentro da página, com o mesmo desenho das marcas, da margem e das relações do app.
        Passe o cursor num trecho marcado para abrir a nota, ou num círculo à esquerda para ver a relação.
      </figcaption>
    </figure>
  );
}
