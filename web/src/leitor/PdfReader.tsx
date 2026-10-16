import { agruparPor, consultarQuads, porPaginaDaAncora } from './indices';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './pdf-polyfills';
import { getDocument, GlobalWorkerOptions, TextLayer, version as versaoDoPdfjs, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from './pdf-worker?worker&url';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { AncoraV1 } from '@margem/contratos';
import { resolverSelecaoPdf } from '../../../core/src/geometria';
import { Button } from '../ui/Primitives';
import { Desenho } from '../ui/marcador/Desenho';
import { tracos } from '../ui/marcador/tracos';
import { juntarPorLinha } from '../ui/marcador/geometria';
import { acaoDoEstilo, recuoNoGuia } from '../ui/marcador/CamadaDeMarcas';
import { usarAparencia } from './ContextoDeAparencia';
import { usarFuncoes } from './ContextoDosModos';
import { corDaFuncao, desenhaMarca, estiloDoNumero, pesoDaSaliencia } from './f2';
import { rugosidadeDoTraco } from './preferencias';
import { segmentar } from './segmentos';
import { ancoraDaFaixa } from './ancora';
import type { PropsDoLeitor } from './ReaderViewport';
import type { ApiDoLeitor, PontoDeTexto } from './tipos';
import { CacheDePaginas, renderizarPaginaNoCanvas, type RecortePdf } from './pdf-recortes';
import { caixaNoPdf, quadNaTela, retangulosDoTextoPdf, tamanhoDaPagina, type GeometriaPdf, type PaginaPdf, type PalavraPdf } from './pdf-geometria';
import './pdf.css';
import { AlvosDoPdf } from './AlvosDoPdf';
GlobalWorkerOptions.workerSrc = workerUrl;
/** Decodificadores wasm (JBIG2, JPEG 2000, ICC) servidos pelo build: ver `decodificadoresDoPdfjs` no vite.config. */
const URL_DOS_DECODIFICADORES = `/pdfjs-${versaoDoPdfjs}/wasm/`;

/** Páginas por pedido de geometria: o teto da rota no serviço. */
const LOTE_DE_PAGINAS = 60;
function avisarGeometria() { window.dispatchEvent(new Event('margem:geometria')); }
function densidadeDaTela(): number { return window.devicePixelRatio || 1; }

/**
 * Um recorte da página para a dobra do braquete. A página inteira (o canvas renderizado pelo PDF.js e
 * as marcas dela, as mesmas do leitor) fica deslocada dentro de uma janela que corta o resto. Monta
 * só com a página já renderizada: o canvas é copiado do cache, sem esperar nada.
 */
/** Um número de nota ao lado do recorte: onde começa a marca (em px da página), na cor da função. */
interface NumeroNoRecorte { id: string; numero: number; y: number; cor: string; classe: string }
/** Distância mínima entre dois números na lateral, para não se sobreporem. */
const ESPACO_ENTRE_NUMEROS = 26;

function RecorteDaPagina({ recorte, fonte, marcas, numeros, rotulo }: { recorte: RecortePdf; fonte: HTMLCanvasElement; marcas: ReactNode; numeros: readonly NumeroNoRecorte[]; rotulo: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const destino = canvas.current;
    if (!destino) return;
    destino.width = fonte.width; destino.height = fonte.height;
    destino.getContext('2d')?.drawImage(fonte, 0, 0);
  }, [fonte]);
  return <><div className="recorte-pdf" data-pagina-do-recorte={recorte.pagina} style={{ width: recorte.largura, height: recorte.altura }}>
    <div className="recorte-pdf-pagina" style={{ width: recorte.largura, height: recorte.alturaDaPagina, transform: `translateY(${String(-recorte.y)}px)` }}>
      <canvas ref={canvas} aria-hidden="true" style={{ width: recorte.largura, height: recorte.alturaDaPagina }} />
      {marcas}
    </div>
  </div>
  {/* A lateral direita do recorte, como a do leitor: os números das notas na altura das marcas. */}
  <div className="recorte-pdf-lateral" style={{ left: recorte.largura + 10, height: recorte.altura }}>
    <div className="recorte-pdf-notas" style={{ transform: `translateY(${String(-recorte.y)}px)` }}>
      {numeros.map((n) => <span key={n.id} className={`nota-numero ${n.classe}`} style={{ top: n.y, ...estiloDoNumero(n.cor) }}>{n.numero}</span>)}
    </div>
  </div>
  {/* A página de onde o trecho vem, dentro da folha, no canto de baixo, em cinza. */}
  <span className="recorte-pdf-pagina-numero" style={{ left: recorte.largura - 44, top: recorte.altura - 20 }}>{rotulo}</span>
</>;
}

function Pagina({ documento, pagina, escala, aoErro }: { documento: PDFDocumentProxy; pagina: PaginaPdf; escala: number; aoErro: (erro: string) => void }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [visivel, mostrar] = useState(false);
  useEffect(() => {
    const elemento = raiz.current;
    if (!elemento) return;
    const observador = new IntersectionObserver(([entrada]) => mostrar(entrada?.isIntersecting ?? false), { rootMargin: `${tamanhoDaPagina(pagina, escala).altura}px 0px` });
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [pagina, escala]);
  useEffect(() => {
    const elemento = raiz.current;
    if (!elemento || !visivel) return;
    let vivo = true;
    let tarefa: RenderTask | undefined;
    let camada: TextLayer | undefined;
    let paginaPdf: PDFPageProxy | undefined;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const texto = document.createElement('div'); texto.className = 'textLayer';
    elemento.append(canvas, texto);
    void documento.getPage(pagina.numero).then(async (pdf) => {
      if (!vivo) { pdf.cleanup(); return; }
      paginaPdf = pdf;
      const viewport = pdf.getViewport({ scale: escala });
      texto.style.setProperty('--total-scale-factor', String(viewport.scale));
      texto.style.setProperty('--scale-factor', String(viewport.scale));
      // O mesmo desenho que os recortes da dobra usam: um pixel do recorte é um pixel da página.
      tarefa = renderizarPaginaNoCanvas(pdf, canvas, escala, densidadeDaTela());
      camada = new TextLayer({ textContentSource: pdf.streamTextContent(), container: texto, viewport });
      await Promise.all([tarefa.promise, camada.render()]);
      if (vivo) { elemento.dataset['pronta'] = 'true'; avisarGeometria(); }
    }).catch(() => {
      if (vivo) aoErro('Não foi possível desenhar a página. Tente novamente.');
    });
    return () => { vivo = false; tarefa?.cancel(); camada?.cancel(); canvas.remove(); texto.remove(); delete elemento.dataset['pronta']; void tarefa?.promise.catch(() => {}).finally(() => paginaPdf?.cleanup()); };
  }, [documento, pagina.numero, escala, visivel, aoErro]);
  return <div ref={raiz} className="pdf-conteudo" />;
}

export const PdfReader = forwardRef<ApiDoLeitor, PropsDoLeitor & { documento_id: string }>(function PdfReader({ aoMudarDocumentoPdf, aoMudarEscala, aoMudarMargem, aoMudarTotalDePaginas, snapshot, documento_id, ativa: ativaDoLeitor = null, margem, rodape, numerosDasNotas }, ref) {
  const ativa = snapshot.guia?.ativa ?? ativaDoLeitor;
  const raiz = useRef<HTMLDivElement>(null);
  const { preferencias } = usarAparencia();
  const { modos } = usarFuncoes();
  const [documento, definirDocumento] = useState<PDFDocumentProxy | null>(null);
  const [geometriaCarregada, definirGeometria] = useState<GeometriaPdf | null>(null);
  /** Todos os lotes do capítulo chegaram (as páginas já aparecem desde o primeiro). */
  const [completa, definirCompleta] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const [aviso, definirAviso] = useState<string | null>(null);
  const [largura, definirLargura] = useState(() => Math.min(850, (document.documentElement.clientWidth || window.innerWidth) - 48));
  const [janela, definirJanela] = useState(window.innerWidth);
  const [tentativa, tentar] = useState(0);
  const anterior = useRef<{ ponto: PontoDeTexto; topo: number } | null>(null);
  const api = useRef<ApiDoLeitor | null>(null);
  const cacheDosRecortes = useRef(new CacheDePaginas());
  const geometria = geometriaCarregada?.versao_id === snapshot.versao_id ? geometriaCarregada : null;
  const blocos = useMemo(() => new Map(snapshot.blocos.map((b) => [b.id, { ...b, versao_id: snapshot.versao_id }])), [snapshot.blocos, snapshot.versao_id]);
  useEffect(() => {
    const tarefa = getDocument({ url: `/api/documentos/${documento_id}/original`, disableAutoFetch: true, disableStream: true, wasmUrl: new URL(URL_DOS_DECODIFICADORES, window.location.href).href });
    let vivo = true;
    definirDocumento(null); definirErro(null);
    void tarefa.promise.then((pdf) => { if (vivo) definirDocumento(pdf); }, () => { if (vivo) definirErro('Não foi possível abrir o PDF.'); });
    return () => { vivo = false; void tarefa.destroy(); };
  }, [documento_id, tentativa]);
  useEffect(() => {
    aoMudarDocumentoPdf?.(documento);
    return () => aoMudarDocumentoPdf?.(null);
  }, [documento, aoMudarDocumentoPdf]);
  useEffect(() => { if (documento) aoMudarTotalDePaginas?.(documento.numPages); }, [documento, aoMudarTotalDePaginas]);
  useEffect(() => {
    const abortar = new AbortController();
    definirGeometria(null); definirCompleta(false);
    void (async () => {
      const faixa = snapshot.paginas;
      if (!faixa) throw new Error('As páginas deste capítulo não estão disponíveis.');
      const paginas: PaginaPdf[] = []; const palavras: PalavraPdf[] = [];
      // I-06: a leitura começa com o primeiro lote; os outros chegam em seguida e só acrescentam páginas ao fim.
      for (let inicio = faixa.inicio; inicio <= faixa.fim; inicio += LOTE_DE_PAGINAS) {
        const resposta = await fetch(`/api/versoes/${snapshot.versao_id}/geometria?paginas=${inicio}-${Math.min(faixa.fim, inicio + LOTE_DE_PAGINAS - 1)}`, { signal: abortar.signal });
        if (!resposta.ok) throw new Error('Não foi possível carregar as marcações do PDF.');
        const parte = await resposta.json() as GeometriaPdf;
        if (parte.versao_id !== snapshot.versao_id) throw new Error('A geometria pertence a outra versão.');
        if (abortar.signal.aborted) return;
        paginas.push(...parte.paginas); palavras.push(...parte.palavras);
        definirGeometria({ versao_id: snapshot.versao_id, fonte: parte.fonte, motor: parte.motor, paginas: [...paginas], palavras: [...palavras] });
      }
      if (!abortar.signal.aborted) definirCompleta(true);
    })().catch((falha: unknown) => { if (!abortar.signal.aborted) definirErro(falha instanceof Error ? falha.message : 'Não foi possível abrir o capítulo.'); });
    return () => abortar.abort();
  }, [snapshot.versao_id, snapshot.paginas?.inicio, snapshot.paginas?.fim, tentativa]);
  useLayoutEffect(() => {
    const medir = () => {
      const ponto = api.current?.ancoraVisivel();
      if (ponto) anterior.current = { ponto, topo: api.current?.localizar(ponto.bloco_id, ponto.offset_utf16)?.top ?? 96 };
      const medida = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--largura-leitura')) || 850;
      // A largura do documento, não `innerWidth`: no celular, uma página larga demais faz o navegador
      // afastar o zoom, e `innerWidth` passa a medir a página, que então nunca encolhe.
      const tela = document.documentElement.clientWidth || window.innerWidth;
      const util = tela;
      definirLargura(Math.min(medida, util - (tela < 600 ? 16 : 48))); definirJanela(util);
    };
    medir(); window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [preferencias.medida, preferencias.tamanho]);
  const escalaDaPagina = (pagina: PaginaPdf) => preferencias.zoomPdf === 'largura' ? largura / tamanhoDaPagina(pagina, 1).largura : preferencias.zoomPdf;
  const porBloco = useMemo(() => agruparPor(geometria?.palavras ?? [], p => p.bloco_id), [geometria]);
  const porPagina = useMemo(() => agruparPor(geometria?.palavras ?? [], p => p.pagina), [geometria]);
  const paginasPorNumero = useMemo(() => new Map(geometria?.paginas.map(p => [p.numero, p])), [geometria]);
  const quads = useMemo(() => consultarQuads(geometria?.versao_id ?? snapshot.versao_id, porBloco), [porBloco, geometria?.versao_id, snapshot.versao_id]);
  const marcasPorBloco = useMemo(() => agruparPor(snapshot.marcas, m => m.ancora.bloco_id), [snapshot.marcas]);
  const marcasPorPagina = useMemo(() => porPaginaDaAncora(snapshot.marcas.filter(m => m.visivel && m.validade === 'resolvida' && m.avaliacao !== 'rejeitada'), quads), [snapshot.marcas, quads]);
  const pessoaisPorPagina = useMemo(() => porPaginaDaAncora(snapshot.tracosPessoais ?? [], quads), [snapshot.tracosPessoais, quads]);
  const origensPorPagina = useMemo(() => {
    const mapa = new Map<number, string | undefined>();
    for (const bloco of snapshot.blocos) for (const origem of bloco.origens) if (origem.tipo === 'pdf' && !mapa.has(origem.pagina)) mapa.set(origem.pagina, origem.impressa);
    return mapa;
  }, [snapshot.blocos]);
  const editoriais = useMemo(() => {
    const faixas = new Map<string, AncoraV1[]>();
    for (const bloco of snapshot.blocos) for (const segmento of segmentar(bloco, marcasPorBloco.get(bloco.id) ?? [])) {
      const marca = marcasPorBloco.get(bloco.id)?.find((m) => segmento.marca_ids.includes(m.id) && m.funcao !== 'nenhuma');
      if (!marca) continue;
      const ancora = ancoraDaFaixa(bloco, snapshot.versao_id, segmento.inicio_utf16, segmento.fim_utf16);
      if (ancora) { const lista = faixas.get(marca.id) ?? []; lista.push(ancora); faixas.set(marca.id, lista); }
    }
    return faixas;
  }, [snapshot.blocos, marcasPorBloco, snapshot.versao_id]);
  const caixas = (ancora: AncoraV1): DOMRect[] => quads(ancora).flatMap((grupo) => {
    const pagina = paginasPorNumero.get(grupo.pagina);
    const base = raiz.current?.querySelector(`[data-pagina="${grupo.pagina}"]`)?.getBoundingClientRect();
    if (!pagina || !base) return [];
    return grupo.quads.map((q) => { const r = quadNaTela(q, pagina, escalaDaPagina(pagina)); return new DOMRect(base.left + r.x, base.top + r.y, r.largura, r.altura); });
  });
  const superficie: ApiDoLeitor = {
    localizar(blocoId, offset) {
      // R3-4: com a geometria ainda chegando, um offset que os lotes carregados não cobrem não está "no começo do
      // bloco": espera o lote seguinte (a retomada tenta de novo) em vez de concluir no lugar errado.
      const doBloco = porBloco.get(blocoId);
      const palavra = doBloco?.find(p => p.fim_utf16 > offset) ?? (completa ? doBloco?.[0] : undefined);
      const bloco = blocos.get(blocoId);
      if (!palavra || !bloco) return null;
      const ancora = ancoraDaFaixa(bloco, snapshot.versao_id, palavra.inicio_utf16, palavra.fim_utf16);
      return ancora ? caixas(ancora)[0] ?? null : null;
    },
    retangulosDaAncora: caixas,
    dobraPdf: {
      regioes(ancora) {
        return quads(ancora).flatMap((grupo) => {
          const pagina = paginasPorNumero.get(grupo.pagina);
          if (!pagina) return [];
          const escala = escalaDaPagina(pagina); const tamanho = tamanhoDaPagina(pagina, escala);
          const linhasDaPagina = juntarPorLinha((porPagina.get(pagina.numero) ?? []).map((p) => quadNaTela(p.quad, pagina, escala)));
          return [{ pagina: pagina.numero, escala, largura: tamanho.largura, altura: tamanho.altura, linhas: juntarPorLinha(grupo.quads.map((q) => quadNaTela(q, pagina, escala))), linhasDaPagina }];
        });
      },
      async preparar(recortes) {
        if (!documento) throw new Error('O PDF ainda não abriu.');
        await Promise.all(recortes.map((r) => cacheDosRecortes.current.renderizar(documento, documento_id, r.pagina, r.escala, densidadeDaTela())));
      },
      origemDaPagina(numero) {
        const base = raiz.current?.querySelector(`[data-pagina="${String(numero)}"]`)?.getBoundingClientRect();
        return base ? { x: base.left, y: base.top } : null;
      },
      recorte(recorte) {
        const pagina = paginasPorNumero.get(recorte.pagina);
        const fonte = cacheDosRecortes.current.pronta(cacheDosRecortes.current.chave(documento_id, recorte.pagina, recorte.escala, densidadeDaTela()));
        if (!pagina || !fonte) return null;
        // Os números das notas das marcas que aparecem no recorte, na ordem da página, sem se sobreporem.
        const numeros: NumeroNoRecorte[] = [];
        for (const marca of marcasPorPagina.get(pagina.numero) ?? []) {
          const numero = numerosDasNotas?.get(marca.id);
          if (numero === undefined || !marca.visivel || marca.avaliacao === 'rejeitada') continue;
          const linhas = quads(marca.ancora).find((g) => g.pagina === pagina.numero)?.quads.map((q) => quadNaTela(q, pagina, recorte.escala)) ?? [];
          if (linhas.length === 0) continue;
          const y = Math.min(...linhas.map((l) => l.y));
          if (y + 22 < recorte.y || y > recorte.y + recorte.altura) continue;
          numeros.push({ id: marca.id, numero, y, cor: corDaFuncao(marca.funcao, 'modo' in marca ? marca.modo : undefined, modos, preferencias, false),
            classe: `funcao-${marca.funcao}` });
        }
        numeros.sort((a, b) => a.y - b.y);
        for (let i = 1; i < numeros.length; i++) numeros[i]!.y = Math.max(numeros[i]!.y, numeros[i - 1]!.y + ESPACO_ENTRE_NUMEROS);
        return <RecorteDaPagina recorte={recorte} fonte={fonte} marcas={marcasDaPagina(pagina, recorte.escala, false)} numeros={numeros} rotulo={String(pagina.numero)} />;
      },
    },
    ancoraDaArea(numero, area) {
      const pagina = paginasPorNumero.get(numero);
      if (!pagina) return null;
      const { largura, altura } = tamanhoDaPagina(pagina, 1);
      const [x0, y0, x1, y1] = [area.x * largura, area.y * altura, (area.x + area.largura) * largura, (area.y + area.altura) * altura];
      const dentro = (porPagina.get(numero) ?? []).filter((palavra) => {
        const q = quadNaTela(palavra.quad, pagina, 1);
        const cx = q.x + q.largura / 2; const cy = q.y + q.altura / 2;
        // Só as palavras dos blocos deste capítulo: a página pode começar no fim do capítulo anterior.
        return blocos.has(palavra.bloco_id) && cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
      });
      if (dentro.length === 0) return null;
      const porBlocoNaArea = agruparPor(dentro, (p) => p.bloco_id);
      const [blocoId, palavras] = [...porBlocoNaArea.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
      const bloco = blocos.get(blocoId);
      if (!bloco) return null;
      return ancoraDaFaixa(bloco, snapshot.versao_id, Math.min(...palavras.map((p) => p.inicio_utf16)), Math.max(...palavras.map((p) => p.fim_utf16)));
    },
    ancoraVisivel() {
      for (const pagina of geometria?.paginas ?? []) {
        const base = raiz.current?.querySelector(`[data-pagina="${pagina.numero}"]`)?.getBoundingClientRect();
        if (!base || base.bottom <= 80 || base.top >= window.innerHeight) continue;
        const visiveis = (porPagina.get(pagina.numero) ?? []).map((p) => ({ p, r: quadNaTela(p.quad, pagina, escalaDaPagina(pagina)) })).filter(({ r }) => base.top + r.y + r.altura > 80 && base.top + r.y < window.innerHeight).sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
        const primeira = visiveis[0]?.p;
        if (primeira) return { bloco_id: primeira.bloco_id, offset_utf16: primeira.inicio_utf16 };
      }
      return null;
    },
    selecao(selecao) {
      if (!selecao || selecao.isCollapsed || !selecao.rangeCount || !raiz.current) return null;
      const intervalo = selecao.getRangeAt(0);
      const elemento = intervalo.startContainer instanceof Element ? intervalo.startContainer : intervalo.startContainer.parentElement;
      const paginaElemento = elemento?.closest<HTMLElement>('[data-pagina]');
      if (!paginaElemento || !raiz.current.contains(paginaElemento)) return null;
      const pagina = paginasPorNumero.get(Number(paginaElemento.dataset['pagina']));
      if (!pagina) return null;
      if (!geometria || geometria.versao_id !== snapshot.versao_id) {
        definirAviso('A geometria deste documento ainda está carregando.'); return null;
      }
      const paginasSelecionadas = geometria.paginas.flatMap(outra => {
        const elementoOutra = raiz.current!.querySelector<HTMLElement>(`[data-pagina="${outra.numero}"]`);
        if (!elementoOutra) return [];
        const base = elementoOutra.getBoundingClientRect();
        const retangulos = retangulosDoTextoPdf(intervalo, elementoOutra).map(r => caixaNoPdf(r, base, outra, escalaDaPagina(outra)));
        return retangulos.length ? [{ pagina: outra.numero, retangulos }] : [];
      });
      const resultado = resolverSelecaoPdf(paginasSelecionadas, geometria, blocos);
      if (!resultado.ok) {
        definirAviso(resultado.motivo === 'entre_blocos'
          ? 'Selecione um trecho de um único parágrafo.'
          : 'Não foi possível ligar toda a seleção ao texto do documento com segurança. Tente selecionar um trecho menor.');
        return null;
      }
      definirAviso(null);
      return { ancora: resultado.ancora, aparada: false, caixa: intervalo.getBoundingClientRect() };
    },
  };
  api.current = superficie;
  useImperativeHandle(ref, () => superficie);
  useEffect(() => {
    const guardar = () => {
      const ponto = api.current?.ancoraVisivel();
      if (ponto) anterior.current = { ponto, topo: api.current?.localizar(ponto.bloco_id, ponto.offset_utf16)?.top ?? 96 };
    };
    let quadro = 0;
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(() => { quadro = 0; guardar(); }); };
    window.addEventListener('scroll', agendar, { passive: true });
    return () => { cancelAnimationFrame(quadro); window.removeEventListener('scroll', agendar); };
  }, []);
  useLayoutEffect(() => {
    if (anterior.current) { const { ponto, topo } = anterior.current; const caixa = api.current?.localizar(ponto.bloco_id, ponto.offset_utf16); if (caixa) window.scrollBy(0, caixa.top - topo); }
    avisarGeometria();
  }, [geometria, completa, largura, preferencias.zoomPdf]);
  /** As marcas de uma página, em pixels da página: as mesmas no leitor e nos recortes da dobra. */
  const marcasDaPagina = (pagina: PaginaPdf, escala: number, animar = preferencias.animacao): ReactNode => {
    const linhas = (ancora: AncoraV1) => quads(ancora).find((g) => g.pagina === pagina.numero)?.quads.map((q) => quadNaTela(q, pagina, escala)) ?? [];
    return <svg className="camada-de-marcas pdf-marcas" aria-hidden="true">
      {(marcasPorPagina.get(pagina.numero) ?? []).map((marca) => {
        const retangulos = juntarPorLinha((marca.funcao === 'nenhuma' ? [marca.ancora] : editoriais.get(marca.id) ?? []).flatMap(linhas));
        const cor = corDaFuncao(marca.funcao, 'modo' in marca ? marca.modo : undefined, modos, preferencias, false);
        const opcoes = { cor, semente: marca.id, rugosidade: rugosidadeDoTraco(preferencias) };
        const peso = pesoDaSaliencia(marca);
        const caminhos = !desenhaMarca(marca) || preferencias.estilo === 'margem' ? [] : tracos(retangulos, { ...opcoes, acao: acaoDoEstilo(preferencias.estilo, peso.soSublinhado), espessura: ativa === marca.id ? peso.espessura * 1.6 : peso.espessura });
        // As subfaixas (qualificadores como “por ora”, “somente”) ficam só nos dados: não se desenham.
        // A marca ativa não ganha moldura: fica mais forte.
        return <Desenho key={marca.id} id={marca.id} caminhos={caminhos} opacidade={Math.max(0, (preferencias.intensidade + (ativa === marca.id ? .12 : ativa ? -.08 : 0)) * peso.fator) * recuoNoGuia(snapshot.guia, marca.id)} animacao={animar} />;
      })}
      {(pessoaisPorPagina.get(pagina.numero) ?? []).map((p) => <Desenho key={p.id} id={p.id} animacao={false} opacidade={p.dificuldade === true ? .6 : .5}
        caminhos={tracos(juntarPorLinha(linhas(p.ancora)), p.dificuldade === true
          ? { acao: 'sublinhado', cor: '#b26b00', semente: p.id, espessura: 1.6, rugosidade: 0, tracejado: true }
          : { acao: p.acao, cor: '#333333', semente: p.id, espessura: 1.2 })} />)}
    </svg>;
  };
  const larguraMaxima = geometria?.paginas.length ? Math.max(...geometria.paginas.map((p) => tamanhoDaPagina(p, escalaDaPagina(p)).largura)) : largura;
  const escalaAtual = geometria?.paginas[0] ? escalaDaPagina(geometria.paginas[0]) : 1;
  useLayoutEffect(() => { aoMudarEscala?.(escalaAtual); }, [aoMudarEscala, escalaAtual]);
  const cabeMargem = (janela - larguraMaxima) / 2 >= 284;
  useLayoutEffect(() => { aoMudarMargem?.(cabeMargem); }, [aoMudarMargem, cabeMargem]);
  return <div ref={raiz} className="leitor leitor-pdf" style={{ width: larguraMaxima, '--medida-texto': `${larguraMaxima}px`, '--largura-margem': `${Math.min(340, Math.max(220, (janela - larguraMaxima) / 2 - 64))}px` } as CSSProperties}>
    <article className="capitulo capitulo-pdf" aria-label={snapshot.secao.titulo}>
      {erro && <p role="alert">{erro} <Button onClick={() => tentar((n) => n + 1)}>Tentar novamente</Button></p>}
      {!erro && (!documento || !geometria) && <p role="status">Abrindo PDF…</p>}
      {aviso && <p role="status">{aviso}</p>}
      {documento && geometria?.paginas.map((pagina) => {
        const escala = escalaDaPagina(pagina); const tamanho = tamanhoDaPagina(pagina, escala);
        const impressa = origensPorPagina.get(pagina.numero);
        const linhas = (ancora: AncoraV1) => quads(ancora).find((g) => g.pagina === pagina.numero)?.quads.map((q) => quadNaTela(q, pagina, escala)) ?? [];
        return <section key={pagina.numero} className="pdf-folha" style={{ width: tamanho.largura }} aria-label={`Página ${pagina.numero}`}>
          <div className="pdf-pagina" data-pagina={pagina.numero} style={{ width: tamanho.largura, height: tamanho.altura }}>
            <Pagina documento={documento} pagina={pagina} escala={escala} aoErro={definirErro} />
            {marcasDaPagina(pagina, escala)}
            <AlvosDoPdf pagina={pagina.numero} marcas={marcasPorPagina.get(pagina.numero) ?? []} linhas={linhas}
              paginasDaAncora={(ancora) => quads(ancora).filter((g) => g.quads.length > 0).map((g) => g.pagina)} />
          </div>
          <p className="pdf-numero">{pagina.numero}{impressa ? ` · p. ${impressa}` : ''}</p>
        </section>;
      })}
      {documento && geometria && !completa && !erro && <p className="pdf-carregando" role="status">Carregando as próximas páginas…</p>}
    </article>
    {cabeMargem && margem}{rodape}
  </div>;
});
