/**
 * Os exercícios recortados continuam marcados na página do PDF. Cada resolução do documento com origem
 * num recorte desenha, na própria página, um retângulo à mão (o traço `caixa` do Marcador, fino, sem
 * fundo sobre o texto) e uma nota: na margem, se a margem de notas está à vista; senão, uma etiqueta
 * no canto do retângulo. Passar o mouse (ou o foco) na nota mostra a prévia: só a ideia da resolução (o
 * enunciado já está na página, ao lado) ou o estado; o clique abre a resolução. Em andamento, "resolvendo…"; se falhou,
 * o estado e as ações de tentar de novo e remover.
 *
 * O retângulo está em frações da página (o que o contrato guarda), então segue o zoom sozinho.
 */
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { obterResolucao, removerResolucao, resolucoesDoDocumento, tentarDeNovo, type SessaoDaApi } from '../../biblioteca/api';
import { tracos } from '../../ui/marcador/tracos';
import { TextoComMatematica } from './Matematica';
import ThoughtLine from '../../ui/pensando/ThoughtLine';

export interface FontesDosExercicios {
  listar: typeof resolucoesDoDocumento;
  obter: typeof obterResolucao;
  remover: typeof removerResolucao;
  tentarDeNovo: typeof tentarDeNovo;
}
export const FONTES_DOS_EXERCICIOS: FontesDosExercicios = { listar: resolucoesDoDocumento, obter: obterResolucao, remover: removerResolucao, tentarDeNovo };
const INTERVALO_MS = 4000;
/** A cor da tinta do retângulo: a página do PDF é branca nos três temas. */
const TINTA = '#456dff';
/** Distância entre duas notas de exercício empilhadas (uma linha cada). */
const ESPACO_ENTRE_NOTAS = 30;
/** Na margem, a que falhou tem uma segunda linha, com as ações. */
const ALTURA_COM_ACOES = 56;

/** Uma folha do PDF: o elemento, o tamanho e, se a margem está à vista, onde a folha começa na coluna da margem. */
interface Folha { elemento: HTMLElement; largura: number; altura: number; topoNaMargem: number }
interface Medidas { folhas: Map<number, Folha>; margem: HTMLElement | null }
type Recortada = SessaoDaApi & { resolucao: SessaoDaApi['resolucao'] & { origem: { tipo: 'recorte'; pagina: number; retangulo: { x: number; y: number; largura: number; altura: number } } } };

function recortada(sessao: SessaoDaApi): sessao is Recortada { return sessao.resolucao.origem.tipo === 'recorte'; }

/** As folhas do PDF no DOM, com o tamanho de agora; medidas de novo a cada mudança de geometria (zoom, largura). */
function usarFolhas(): Medidas {
  const [estado, definir] = useState<Medidas>({ folhas: new Map(), margem: null });
  useEffect(() => {
    let quadro = 0;
    let leitor: Element | null = null;
    function agendar() { if (!quadro) quadro = requestAnimationFrame(medir); }
    // A margem entra e sai do leitor (painel do documento, navegador de destaques): observa os filhos dele.
    const doLeitor = typeof MutationObserver === 'function' ? new MutationObserver(() => agendar()) : null;
    const medir = () => {
      quadro = 0;
      const atual = document.querySelector('.leitor-pdf');
      if (atual !== leitor) { doLeitor?.disconnect(); leitor = atual; if (atual) doLeitor?.observe(atual, { childList: true }); }
      const candidata = document.querySelector<HTMLElement>('.leitor-pdf > .margem');
      const margem = candidata && getComputedStyle(candidata).display !== 'none' ? candidata : null;
      const topoDaMargem = margem?.getBoundingClientRect().top ?? 0;
      const folhas = new Map<number, Folha>();
      for (const elemento of document.querySelectorAll<HTMLElement>('.pdf-pagina[data-pagina]')) {
        const numero = Number(elemento.dataset['pagina']);
        if (Number.isFinite(numero)) folhas.set(numero, { elemento, largura: elemento.clientWidth, altura: elemento.clientHeight, topoNaMargem: Math.round(elemento.getBoundingClientRect().top - topoDaMargem) });
      }
      definir((atual) => {
        const iguais = atual.margem === margem && atual.folhas.size === folhas.size
          && [...folhas].every(([numero, folha]) => { const antes = atual.folhas.get(numero); return antes?.elemento === folha.elemento && antes.largura === folha.largura && antes.altura === folha.altura && antes.topoNaMargem === folha.topoNaMargem; });
        return iguais ? atual : { folhas, margem };
      });
    };
    agendar();
    window.addEventListener('margem:geometria', agendar);
    window.addEventListener('resize', agendar);
    // A classe da barra lateral (resolução ou leitura guiada) esconde a margem: mede de novo quando ela muda.
    const observador = typeof MutationObserver === 'function' ? new MutationObserver(agendar) : null;
    observador?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('margem:geometria', agendar);
      window.removeEventListener('resize', agendar);
      observador?.disconnect();
      doLeitor?.disconnect();
    };
  }, []);
  return estado;
}

export function ExerciciosNaPagina({ documentoId, versaoId, aberta, versao = 0, aoAbrir, aoMudar, fontes = FONTES_DOS_EXERCICIOS, intervaloMs = INTERVALO_MS }: {
  documentoId: string; versaoId: string;
  /** A resolução aberta agora: o retângulo dela fica aceso. */
  aberta: string | null;
  /** Muda quando uma resolução é criada ou removida em outro lugar: lista de novo. */
  versao?: number;
  aoAbrir: (id: string) => void;
  /** Uma resolução foi removida daqui (a lista do documento, se aberta, deve saber). */
  aoMudar?: () => void;
  fontes?: FontesDosExercicios; intervaloMs?: number;
}): ReactNode {
  const [sessoes, definir] = useState<Recortada[]>([]);
  const [ocupada, ocupar] = useState<string | null>(null);
  const [realce, realcar] = useState<string | null>(null);
  const { folhas, margem } = usarFolhas();
  const listar = useCallback(async () => {
    try {
      const { resolucoes } = await fontes.listar(documentoId);
      definir(resolucoes.filter(recortada).filter((sessao) => sessao.resolucao.versao_id === versaoId));
    } catch { /* Sem a lista, a página fica sem as marcas dos exercícios; o resto do leitor segue. */ }
  }, [documentoId, versaoId, fontes]);
  useEffect(() => { void listar(); }, [listar, versao, aberta]);
  const trabalhando = sessoes.some((sessao) => sessao.estado === 'resolvendo' || sessao.estado === 'respondendo');
  useEffect(() => {
    if (!trabalhando) return;
    const relogio = setInterval(() => { void listar(); }, intervaloMs);
    return () => clearInterval(relogio);
  }, [trabalhando, listar, intervaloMs]);

  const acao = useCallback(async (id: string, fazer: () => Promise<unknown>) => {
    ocupar(id);
    try { await fazer(); await listar(); } catch { /* O estado volta com a próxima lista. */ } finally { ocupar(null); }
  }, [listar]);
  const remover = (id: string) => void acao(id, async () => { await fontes.remover(id); aoMudar?.(); });
  const refazer = (id: string) => void acao(id, async () => {
    const sessao = await fontes.obter(id);
    const job = sessao.jobs?.filter((item) => item.estado === 'falhou' || item.estado === 'cancelado').at(-1);
    if (job) await fontes.tentarDeNovo(job.id);
  });

  const porPagina = useMemo(() => {
    const mapa = new Map<number, Recortada[]>();
    for (const sessao of sessoes) mapa.set(sessao.resolucao.origem.pagina, [...(mapa.get(sessao.resolucao.origem.pagina) ?? []), sessao]);
    return mapa;
  }, [sessoes]);

  return <>{[...porPagina].map(([pagina, daPagina]) => {
    const folha = folhas.get(pagina);
    if (!folha || folha.largura === 0) return null;
    // Notas do mesmo trecho se empilham, de cima para baixo, sem se cobrir.
    let fim = -Infinity;
    const notas = [...daPagina].sort((a, b) => a.resolucao.origem.retangulo.y - b.resolucao.origem.retangulo.y).map((sessao, indice) => {
      const topo = Math.max(sessao.resolucao.origem.retangulo.y * folha.altura, fim);
      fim = topo + (margem !== null && sessao.estado === 'falhou' ? ALTURA_COM_ACOES : ESPACO_ENTRE_NOTAS);
      return <NotaDoExercicio key={sessao.resolucao.id} sessao={sessao} numero={indice + 1} topo={topo} folha={folha} naMargem={margem !== null}
        ocupada={ocupada === sessao.resolucao.id} aoAbrir={aoAbrir} aoRealcar={realcar} aoRemover={remover} aoRefazer={refazer} />;
    });
    return <Fragment key={pagina}>
      {createPortal(<div className="exercicios-da-pagina">
        <svg className="caixas-dos-exercicios" aria-hidden="true" width={folha.largura} height={folha.altura} viewBox={`0 0 ${String(folha.largura)} ${String(folha.altura)}`}>
          {daPagina.map(({ resolucao, estado }) => {
            const { retangulo } = resolucao.origem;
            const caixa = { x: retangulo.x * folha.largura, y: retangulo.y * folha.altura, largura: retangulo.largura * folha.largura, altura: retangulo.altura * folha.altura };
            const aceso = aberta === resolucao.id || realce === resolucao.id;
            return <g key={resolucao.id} className="caixa-do-exercicio" data-estado={estado} data-aceso={aceso ? '' : undefined}>
              {tracos([caixa], { acao: 'caixa', cor: TINTA, semente: resolucao.id, espessura: 1.3, rugosidade: .45, recuo: 4 }).map((traco, indice) =>
                <path key={indice} d={traco.d} fill="none" stroke={traco.cor} strokeWidth={traco.espessura} strokeLinecap="round" strokeDasharray={estado === 'falhou' ? '5 5' : undefined} />)}
            </g>;
          })}
        </svg>
        {margem === null && notas}
      </div>, folha.elemento)}
      {/* Com a margem à vista, a nota mora nela, como as outras notas, na altura do exercício. */}
      {margem !== null && createPortal(notas, margem)}
    </Fragment>;
  })}</>;
}

/** Espaço que a nota ocupa à direita do retângulo (deslocamento de 10 px + o círculo de 22 px). */
const FOLGA_DA_NOTA_PX = 36;

const ROTULO: Record<SessaoDaApi['estado'], string> = { pendente: 'A resolver', pronta: 'Exercício resolvido', resolvendo: 'Resolvendo…', respondendo: 'Respondendo…', falhou: 'Não deu certo' };

function NotaDoExercicio({ sessao, numero, topo, folha, naMargem, ocupada, aoAbrir, aoRealcar, aoRemover, aoRefazer }: {
  sessao: Recortada; numero: number; topo: number; folha: Folha; naMargem: boolean; ocupada: boolean;
  aoAbrir: (id: string) => void; aoRealcar: (id: string | null) => void; aoRemover: (id: string) => void; aoRefazer: (id: string) => void;
}): ReactNode {
  const { resolucao, estado } = sessao;
  const { retangulo } = resolucao.origem;
  const gerada = resolucao.resolucao;
  const primeira = gerada?.itens[0];
  const linha = estado === 'pronta' && primeira ? primeira.estrategia : estado === 'falhou' ? 'O Codex não conseguiu resolver desta vez.' : estado === 'pendente' ? 'Ainda não foi ao Codex: abra para pedir a resolução.' : estado === 'pronta' ? '' : 'O Codex está lendo o exercício e montando os passos.';
  // Na margem, na altura do topo do exercício; na página, no canto de cima à direita do retângulo.
  const estilo = naMargem ? { top: folha.topoNaMargem + topo } : { top: topo, left: (retangulo.x + retangulo.largura) * folha.largura };
  // Retângulo que encosta na borda direita da folha (a questão por imagem cobre a página inteira): a
  // nota entra no canto, por dentro, em vez de sair da folha (e da tela, no celular).
  const dentro = !naMargem && (1 - retangulo.x - retangulo.largura) * folha.largura < FOLGA_DA_NOTA_PX;
  return <div className="nota-do-exercicio" data-lugar={naMargem ? 'margem' : 'pagina'} data-dentro={dentro ? '' : undefined} data-estado={estado} style={estilo}
    onPointerEnter={() => aoRealcar(resolucao.id)} onPointerLeave={() => aoRealcar(null)} onFocus={() => aoRealcar(resolucao.id)} onBlur={() => aoRealcar(null)}>
    <button type="button" className="abrir-exercicio" aria-label={`${ROTULO[estado]}: abrir a resolução do exercício da página ${String(resolucao.origem.pagina)}`}
      onClick={() => aoAbrir(resolucao.id)}>
      <span className="nota-cabeca"><span className="nota-numero numero-do-exercicio" aria-hidden="true">{estado === 'pronta' ? '∑' : estado === 'falhou' ? '!' : estado === 'pendente' ? '○' : '…'}</span><span className="nota-rotulo">{estado === 'resolvendo' || estado === 'respondendo'
        ? <ThoughtLine label={ROTULO[estado]} collapsible={false} showTimer={false} fontSize={12} color="var(--texto-2)" glyphColor="var(--accent)" />
        : ROTULO[estado]}{numero > 1 ? ` · ${String(numero)}` : ''}</span></span>
    </button>
    {/* A prévia: aparece com o mouse ou o foco; o clique na nota abre a resolução. O enunciado já está
        na página, ao lado: a prévia mostra só a ideia (ou o estado). Se falhou, as ações ficam na linha da nota. */}
    {linha && <div className="previa-do-exercicio">
      <p className="linha-da-previa">{estado === 'pronta' && <span className="eyebrow">Ideia</span>}<TextoComMatematica texto={linha} /></p>
    </div>}
    {estado === 'falhou' && <span className="acoes-do-exercicio">
      <button type="button" disabled={ocupada} onClick={() => aoRefazer(resolucao.id)}>Tentar de novo</button>
      <button type="button" disabled={ocupada} onClick={() => aoRemover(resolucao.id)}>Remover</button>
    </span>}
  </div>;
}
