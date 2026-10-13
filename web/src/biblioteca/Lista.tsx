import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Input, Select, IconButton, Button } from '../ui/Primitives';
import { Esqueleto } from '../ui/Esqueleto';
import { BarraDeProgresso, Icon } from '../ui/Icon';
import { Capa } from '../ui/Capa';
import { listarDocumentos, arvoreDaVersao, escrever, buscarNaBiblioteca } from './api';
import { TrechoMarcado } from '../leitor/BuscaNoDocumento';
import { fraseDoEstado } from './estado';
import { PainelDoItem } from './PainelDoItem';
import { PrimeiroDocumento } from '../onboarding/PrimeiroDocumento';
import { caminhoDaRota, type Rota } from './rotas';
import type { ArvoreDaVersao, ItemDaBiblioteca, RespostaDaBusca, ResultadoDaBusca } from './tipos';
import { iconeDoDocumento, rotuloDoDocumento, verboDoDocumento } from './tipos';
import { atalhoDeUmaTeclaDesligado } from '../leitor/teclado/comandos';
import { AcervoAusente, LinhaDoQuadro, PainelDoQuadroNaBiblioteca, usarListaDeQuadros, vistoEm } from '../quadros/NaBiblioteca';
import { ehTipoDaBiblioteca } from './rotas';
import type { ListaDeQuadros, ResumoDoQuadro } from '../quadros/tipos';
import { usarRecurso } from '../recursos';

export interface PropsDaLista {
  ir: (destino: Rota) => void;
  carregar?: (arquivados?: boolean) => Promise<{ documentos: ItemDaBiblioteca[] }>;
  /** Os quadros do acervo de arte (testes passam uma lista fixa). */
  carregarQuadros?: () => Promise<ListaDeQuadros>;
  rota?: Extract<Rota, { nome: 'biblioteca' }>;
  /** Busca no conteúdo (`GET /api/busca`); os testes trocam. */
  buscarTexto?: typeof buscarNaBiblioteca;
}
export const ROTULO_DO_FORMATO: Record<string, string> = { pdf: 'PDF', md: 'Markdown', txt: 'Texto', colado: 'Colado' };
export function campoEmEdicao(alvo: EventTarget | null): boolean { return alvo instanceof Element && !!alvo.closest('input, textarea, select, [contenteditable=true], [role=combobox], [role=listbox]'); }
export function preferencia(chave: string, padrao: boolean): boolean { try { const valor = localStorage.getItem(chave); return valor === null ? padrao : valor === 'true'; } catch { return padrao; } }
export function guardarPreferencia(chave: string, valor: boolean) { try { localStorage.setItem(chave, String(valor)); } catch { /* Armazenamento indisponível: vale o estado desta sessão. */ } }
/** Na miniatura da capa, vídeo e áudio dizem o que são; os textos, o formato do arquivo. */
export function formatoDaCapa(item: Pick<ItemDaBiblioteca, 'formato' | 'midia'>): string {
  return item.midia ? (item.midia.tipo === 'video' ? 'vídeo' : 'áudio') : item.formato;
}
export function usarBiblioteca(carregar = listarDocumentos, arquivados = false, revisao = 0) {
  const [documentos, definir] = useState<ItemDaBiblioteca[] | null>(null);
  const [arvores, definirArvores] = useState<Record<string, ArvoreDaVersao>>({});
  const [erro, definirErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true; definirErro(null); definir(null);
    carregar(arquivados).then((r) => { if (vivo) definir(r.documentos); }, (e: unknown) => { if (vivo) definirErro(e instanceof Error ? e.message : 'falha ao carregar'); });
    return () => { vivo = false; };
  }, [carregar, arquivados, revisao]);
  useEffect(() => {
    let vivo = true;
    const versoes = [...new Set((documentos ?? []).flatMap((d) => d.versao_id && d.texto_disponivel ? [d.versao_id] : []))];
    void Promise.all(versoes.map(async (id) => { try { const arvore = await arvoreDaVersao(id); return Array.isArray(arvore.capitulos) ? [id, arvore] as const : null; } catch { return null; } })).then((r) => { if (vivo) definirArvores(Object.fromEntries(r.filter((a) => a !== null))); });
    return () => { vivo = false; };
  }, [documentos]);
  return { documentos, arvores, erro };
}
/**
 * Biblioteca vazia: em vez de só constatar, conduz ao primeiro texto (o exemplo, um arquivo ou um
 * texto colado) e aos primeiros passos. Os arquivados vazios continuam com a frase curta.
 */
export function ConviteAdicionar({ ir, arquivados = false }: { ir: PropsDaLista['ir']; arquivados?: boolean }) {
  if (arquivados) return <EstadoVazio frase="Nenhum texto arquivado." />;
  return <div className="biblioteca-vazia conduzir"><Icon name="livro" size={56} />
    <div className="conduzir-texto"><h2>Nenhum texto ainda.</h2><p>Traga o que você está lendo, ou comece por um conto curto de Machado de Assis para ver como o Margem lê.</p></div>
    <PrimeiroDocumento ir={ir} />
    <a className="link-primeiros-passos" href="/primeiros-passos" onClick={(e) => { e.preventDefault(); ir({ nome: 'primeiros-passos' }); }}>Primeiros passos <Icon name="arrow" size={14} /></a>
  </div>;
}
export function EstadoVazio({ frase }: { frase: string }) {
  return <div className="biblioteca-vazia"><Icon name="arquivo" size={88} /><p>{frase}</p></div>;
}
/** A partir de quantos caracteres o campo da biblioteca também busca no texto. */
const MINIMO_NO_TEXTO = 3;
/** Trechos mostrados por documento; o resto, pelo Ctrl F dentro dele. */
const TRECHOS_POR_DOCUMENTO = 3;

function rotaDoResultado(resultado: ResultadoDaBusca): Rota {
  return resultado.capitulo
    ? { nome: 'leitura', documento_id: resultado.documento_id, secao_id: resultado.capitulo.id, bloco: resultado.bloco_id }
    : { nome: 'leitura', documento_id: resultado.documento_id };
}

export function Lista({ ir, carregar = listarDocumentos, carregarQuadros, rota, buscarTexto = buscarNaBiblioteca }: PropsDaLista): ReactNode {
  const [abaLocal, definirAba] = useState('todos');
  const aba = rota?.aba ?? (rota ? 'todos' : abaLocal);
  const [busca, buscar] = useState('');
  const [ordem, ordenar] = useState('leitura');
  const [revisao, recarregar] = useState(0);
  const { documentos, arvores, erro } = usarBiblioteca(carregar, aba === 'arquivados', revisao);
  const { quadros, acervo } = usarListaDeQuadros(carregarQuadros);
  const arte = usarRecurso('arte');
  const [foco, focar] = useState<string | null>(null);
  const [painel, abrirPainel] = useState(() => preferencia('margem:painel-biblioteca', true));
  const [erroAcao, definirErroAcao] = useState<string | null>(null);
  const [ocupado, ocupar] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const [noTexto, definirNoTexto] = useState<RespostaDaBusca | null>(null);
  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < MINIMO_NO_TEXTO || aba === 'arquivados') { definirNoTexto(null); return; }
    const controle = new AbortController();
    const tempo = setTimeout(() => {
      buscarTexto(termo, controle.signal).then(definirNoTexto, () => { if (!controle.signal.aborted) definirNoTexto(null); });
    }, 300);
    return () => { clearTimeout(tempo); controle.abort(); };
  }, [busca, aba, buscarTexto]);
  const soQuadros = rota?.tipo === 'quadros';
  // Quadros sem acervo instalado (J110): explica e oferece o pacote, em vez de uma lista vazia muda.
  const semAcervo = soQuadros && acervo !== null && !acervo.instalado && aba !== 'arquivados' && !busca;
  const passaNosFiltros = (d: ItemDaBiblioteca) => {
    const total = arvores[d.versao_id ?? '']?.capitulos.length;
    return (aba !== 'lendo' || (d.progresso !== null && (total === undefined || d.progresso.capitulos_concluidos < total))) &&
      (aba !== 'novos' || d.progresso === null) &&
      (!rota?.tipo || (rota.tipo === 'pdfs' ? d.formato === 'pdf' : rota.tipo === 'videos' ? d.midia?.tipo === 'video'
        // Vídeos e áudios têm transcrição de um capítulo só, mas não são textos; PDF sem capítulos vai para PDFs.
        : !d.midia && total !== undefined && (rota.tipo === 'livros' ? total > 1 : total === 1 && d.formato !== 'pdf')));
  };
  const filtrados = soQuadros ? [] : (documentos ?? []).filter((d) => `${d.titulo} ${d.autor ?? ''}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase()) && passaNosFiltros(d));
  // O que a busca achou no texto, agrupado por documento, só dos documentos que os filtros deixam ver.
  const visiveis = new Set(soQuadros ? [] : (documentos ?? []).filter(passaNosFiltros).map((d) => d.id));
  const gruposNoTexto: { documento_id: string; titulo: string; autor: string | null; resultados: ResultadoDaBusca[] }[] = [];
  for (const resultado of noTexto?.resultados ?? []) {
    if (!visiveis.has(resultado.documento_id)) continue;
    const grupo = gruposNoTexto.find((g) => g.documento_id === resultado.documento_id);
    if (grupo) grupo.resultados.push(resultado);
    else gruposNoTexto.push({ documento_id: resultado.documento_id, titulo: resultado.titulo, autor: resultado.autor, resultados: [resultado] });
  }
  // Quadros: na Biblioteca inteira e no filtro Quadros; não se arquivam nem ficam "em leitura".
  const quadrosFiltrados = (!rota?.tipo || soQuadros) && aba !== 'arquivados' && aba !== 'lendo' ? (quadros ?? []).filter((q) =>
    `${q.titulo} ${q.artista} ${q.titulo_original}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase()) && (aba !== 'novos' || vistoEm(q.slug) === null)) : [];
  const entradas: Entrada[] = [
    ...filtrados.map((d): Entrada => ({ chave: d.id, documento: d, quadro: null, titulo: d.titulo, aberto: d.progresso?.atualizado_em ?? null, criado: d.criado_em })),
    ...quadrosFiltrados.map((q): Entrada => ({ chave: `quadro:${q.slug}`, documento: null, quadro: q, titulo: q.titulo, aberto: vistoEm(q.slug), criado: q.adicionado_em })),
  ].sort((a, b) => compararParaOrdem(ordem, a, b));
  const selecionada = entradas.find((e) => e.chave === foco) ?? entradas[0];
  const selecionado = selecionada?.documento ?? undefined;
  const alternarPainel = () => abrirPainel((valor) => { guardarPreferencia('margem:painel-biblioteca', !valor); return !valor; });
  useEffect(() => { if (rota?.buscar) entrada.current?.focus(); }, [rota, documentos]);
  useEffect(() => {
    const teclado = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal=true]') || campoEmEdicao(e.target) || e.ctrlKey || e.metaKey || e.altKey || atalhoDeUmaTeclaDesligado(e)) return;
      if (e.key === '/') { e.preventDefault(); entrada.current?.focus(); }
      if (e.key === ']') { e.preventDefault(); alternarPainel(); }
      if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault(); const indice = entradas.findIndex((d) => d.chave === selecionada?.chave);
        const proximo = Math.max(0, Math.min(entradas.length - 1, indice + (['j', 'ArrowDown'].includes(e.key) ? 1 : -1)));
        lista.current?.children[proximo]?.querySelector<HTMLElement>('[data-linha]')?.focus();
      }
      if (e.key === 'Enter' && selecionada?.quadro && e.target instanceof Element && e.target.hasAttribute('data-linha')) { e.preventDefault(); ir({ nome: 'quadro', slug: selecionada.quadro.slug }); return; }
      if (e.key === 'Enter' && selecionado && e.target instanceof Element && e.target.hasAttribute('data-linha')) { e.preventDefault(); ir({ nome: e.shiftKey || !selecionado.texto_disponivel ? 'documento' : 'leitura', documento_id: selecionado.id }); }
    };
    window.addEventListener('keydown', teclado); return () => window.removeEventListener('keydown', teclado);
  });
  async function arquivar(item: ItemDaBiblioteca) {
    ocupar(item.id); definirErroAcao(null);
    try { await escrever(`/api/documentos/${item.id}/${aba === 'arquivados' ? 'desarquivar' : 'arquivar'}`, {}); recarregar((n) => n + 1); }
    catch (e) { definirErroAcao(e instanceof Error ? e.message : 'Não foi possível arquivar.'); }
    finally { ocupar(null); }
  }
  const titulo = rota?.tipo === 'livros' ? 'Livros' : rota?.tipo === 'textos' ? 'Textos' : rota?.tipo === 'pdfs' ? 'PDFs' : rota?.tipo === 'videos' ? 'Vídeos' : rota?.tipo === 'quadros' ? 'Quadros' : 'Biblioteca';
  return <div className={`biblioteca-grade ${painel ? 'com-painel' : ''}`}><section className="lista-biblioteca" aria-label="Biblioteca">
    <header className="biblioteca-cabecalho"><h1><Icon name="library" /><Select className="seletor-tipo" aria-label="Tipo de documento" value={rota?.tipo ?? 'todos'} rotuloFechado={titulo} onChange={(e) => {
      const tipo = e.target.value;
      ir({ nome: 'biblioteca', ...(rota?.aba ? { aba: rota.aba } : {}), ...(ehTipoDaBiblioteca(tipo) ? { tipo } : {}) });
    }}><option value="todos">Biblioteca</option><option value="livros">Livros</option><option value="textos">Textos</option><option value="pdfs">PDFs</option><option value="videos">Vídeos</option>{arte && <option value="quadros">Quadros</option>}</Select></h1><nav className="biblioteca-abas" aria-label="Filtrar biblioteca">{([['todos', 'Todos'], ['lendo', 'Em leitura'], ['novos', 'Não abertos'], ['arquivados', 'Arquivados']] as const).map(([valor, nome]) => <Button key={valor} variante="ghost" aria-current={aba === valor ? 'page' : undefined} onClick={() => { definirAba(valor); if (rota) ir({ ...rota, aba: valor }); }}>{nome}</Button>)}</nav>
      <div className="biblioteca-ferramentas"><label className="busca-compacta"><Icon name="buscar" size={16} /><Input ref={entrada} type="search" aria-label="Buscar textos" placeholder="Buscar título, autor ou texto" value={busca} onChange={(e) => buscar(e.target.value)} /></label><Select aria-label="Ordenação" value={ordem} onChange={(e) => ordenar(e.target.value)}><option value="leitura">Última leitura</option><option value="adicionados">Adicionados</option><option value="titulo">Título</option></Select></div>
      {!painel && <IconButton className="alternar-painel" aria-label="Abrir informações" title="Abrir informações (])" onClick={alternarPainel}><Icon name="painel" /></IconButton>}
    </header><h2 className="apenas-leitores">Todos os textos</h2>
    {(erro || erroAcao) && <p role="alert" className="aviso">{erro ?? erroAcao}</p>}
    {(documentos === null && !erro) || (soQuadros && quadros === null) ? <Esqueleto /> : !soQuadros && documentos?.length === 0 && !quadros?.length ? <ConviteAdicionar ir={ir} arquivados={aba === 'arquivados'} /> : <>
      {semAcervo && <AcervoAusente acervo={acervo} />}<ul ref={lista} className="linhas-biblioteca">{entradas.map(({ chave, documento: item, quadro }) => {
        if (quadro) return <li key={chave}><LinhaDoQuadro quadro={quadro} atual={chave === selecionada?.chave} ordem={ordem} ir={ir} aoFocar={() => focar(chave)} /></li>;
        if (!item) return null;
        const total = arvores[item.versao_id ?? '']?.capitulos.length;
        const data = new Date(ordem === 'adicionados' ? item.criado_em : item.progresso?.atualizado_em ?? item.criado_em);
        const atual = chave === selecionada?.chave;
        return <li key={item.id}><div data-linha tabIndex={atual ? 0 : -1} className={`linha-documento ${atual ? 'em-foco' : ''}`} onMouseEnter={() => focar(item.id)} onFocus={() => focar(item.id)} onClick={() => ir({ nome: item.texto_disponivel ? 'leitura' : 'documento', documento_id: item.id })}>
          <Capa {...item} formato={formatoDaCapa(item)} tamanho="mini" icone={iconeDoDocumento(item, total)} /><div className="linha-conteudo"><a className="titulo" href={`/documentos/${item.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); ir({ nome: 'documento', documento_id: item.id }); }}>{item.titulo}</a><div className="linha-meta">{item.autor && <span>{item.autor}</span>}<span>{rotuloDoDocumento(item, ROTULO_DO_FORMATO)}</span>{total !== undefined && <span>{total === 1 ? (item.progresso?.capitulos_concluidos ?? 0) > 0 ? 'lido' : 'texto único' : `${item.progresso?.capitulos_concluidos ?? 0} de ${total} capítulos`}</span>}<span>{item.marcas.total} marcas</span>{item.estado !== 'pronto' && <span className="badge">{item.estado === 'falhou' ? 'Ver documento' : fraseDoEstado(item)}</span>}</div>{item.progresso && item.progresso.capitulos_concluidos > 0 && total !== undefined && total > 0 && <BarraDeProgresso valor={100 * item.progresso.capitulos_concluidos / total} rotulo="Capítulos concluídos" />}</div>
          <time dateTime={data.toISOString()}>{data.toDateString() === new Date().toDateString() ? data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</time>
          <div className="acoes-da-linha" onClick={(e) => e.stopPropagation()}>{item.texto_disponivel && <IconButton aria-label={verboDoDocumento(item)} title={`${verboDoDocumento(item)} (Enter)`} onClick={() => ir({ nome: 'leitura', documento_id: item.id })}><Icon name="book" size={18} /></IconButton>}<IconButton aria-label="Documento" title="Documento (Shift+Enter)" onClick={() => ir({ nome: 'documento', documento_id: item.id })}><Icon name="info" size={18} /></IconButton><IconButton aria-label={aba === 'arquivados' ? 'Desarquivar' : 'Arquivar'} title={aba === 'arquivados' ? 'Desarquivar' : 'Arquivar'} disabled={ocupado !== null} onClick={() => void arquivar(item)}><Icon name="arquivo" size={18} /></IconButton></div>
        </div></li>;
      })}</ul>{gruposNoTexto.length > 0 && <section className="busca-no-texto" aria-label="Encontrado no texto">
        <h2 className="eyebrow">No texto</h2>
        <ul>{gruposNoTexto.map((grupo) => <li key={grupo.documento_id}>
          <p className="busca-no-texto-documento"><span>{grupo.titulo}</span>{grupo.autor && <span>{grupo.autor}</span>}</p>
          <ul>{grupo.resultados.slice(0, TRECHOS_POR_DOCUMENTO).map((resultado) => <li key={resultado.bloco_id}>
            <a className="busca-no-texto-trecho" href={caminhoDaRota(rotaDoResultado(resultado))}
              onClick={(evento) => { evento.preventDefault(); ir(rotaDoResultado(resultado)); }}>
              {resultado.capitulo && <span className="busca-no-texto-capitulo">{resultado.capitulo.titulo}</span>}
              <span><TrechoMarcado trecho={resultado.trecho} /></span>
            </a>
          </li>)}</ul>
          {grupo.resultados.length > TRECHOS_POR_DOCUMENTO && <p className="busca-no-texto-mais">Mais {grupo.resultados.length - TRECHOS_POR_DOCUMENTO} neste texto: abra e use Ctrl F.</p>}
        </li>)}</ul>
      </section>}{(documentos || quadros) && !semAcervo && entradas.length === 0 && gruposNoTexto.length === 0 && <EstadoVazio frase={soQuadros && !busca ? 'Nenhum quadro no acervo.' : aba === 'lendo' && !busca ? 'Nenhum texto em leitura.' : aba === 'novos' && !busca ? 'Nenhum texto por abrir.' : 'Nenhum texto encontrado.'} />}</>}
    <span className="contagem-biblioteca">{soQuadros ? `${String(quadrosFiltrados.length)} quadros` : quadrosFiltrados.length ? `${String(filtrados.length)} textos · ${String(quadrosFiltrados.length)} quadros` : `${String(filtrados.length)} textos`}</span>
  </section>{painel && selecionada?.quadro && <PainelDoQuadroNaBiblioteca quadro={selecionada.quadro} ir={ir} fechar={alternarPainel} />}{painel && !selecionada?.quadro && <PainelDoItem item={selecionado} arvore={arvores[selecionado?.versao_id ?? '']} ir={ir} fechar={alternarPainel} />}</div>;
}

/** Uma linha da Biblioteca: um documento ou um quadro. */
interface Entrada { chave: string; documento: ItemDaBiblioteca | null; quadro: ResumoDoQuadro | null; titulo: string; aberto: string | null; criado: string }

/** "Última leitura": os já abertos primeiro, do mais recente; os nunca abertos depois, pela adição. */
function compararParaOrdem(ordem: string, a: Entrada, b: Entrada): number {
  if (ordem === 'titulo') return a.titulo.localeCompare(b.titulo, 'pt-BR');
  if (ordem === 'leitura' && (a.aberto === null) !== (b.aberto === null)) return a.aberto === null ? 1 : -1;
  const data = (item: Entrada) => ordem === 'leitura' ? item.aberto ?? item.criado : item.criado;
  return data(b).localeCompare(data(a));
}
