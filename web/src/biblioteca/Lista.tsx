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
import {
  IdentificarObra, LinhaDoQuadro, LinhaDoQuadroEmPreparo, PainelDoQuadroEmPreparo, PainelDoQuadroNaBiblioteca, QuadrosVazios,
  tituloDoPreparo, usarAcoesDoPreparo, usarListaDeQuadros, vistoEm,
} from '../quadros/NaBiblioteca';
import { OPERACOES_DOS_QUADROS, type OperacoesDosQuadros } from '../quadros/api';
import { ehTipoDaBiblioteca } from './rotas';
import { CATEGORIAS, capitulosDoItem, categoriaDoDocumento, contadorDaCategoria, descricaoDaCategoria } from './categorias';
import type { ListaDeQuadros, QuadroDaPessoaV1, ResumoDoQuadro } from '../quadros/tipos';
import { usarRecurso } from '../recursos';
import { campoEmEdicao, guardarPreferencia, preferencia } from './preferencias-locais';

export interface PropsDaLista {
  ir: (destino: Rota) => void;
  carregar?: (arquivados?: boolean) => Promise<{ documentos: ItemDaBiblioteca[] }>;
  /** Os quadros (testes passam uma lista fixa). */
  carregarQuadros?: () => Promise<ListaDeQuadros>;
  /** Adicionar, corrigir, tentar de novo e remover obras (testes trocam). */
  operacoesDosQuadros?: OperacoesDosQuadros;
  rota?: Extract<Rota, { nome: 'biblioteca' }>;
  /** Busca no conteúdo (`GET /api/busca`); os testes trocam. */
  buscarTexto?: typeof buscarNaBiblioteca;
  /**
   * D-06: com a barra lateral aberta, as categorias já estão nela e o título é só o nome; sem a barra
   * (fechada ou no celular), o título vira o seletor de tipo.
   */
  seletorDeTipo?: boolean;
}
export const ROTULO_DO_FORMATO: Record<string, string> = { pdf: 'PDF', epub: 'EPUB', md: 'Markdown', txt: 'Texto', colado: 'Texto colado' };
export { campoEmEdicao, guardarPreferencia, preferencia };
/** Na miniatura da capa, vídeo e áudio dizem o que são; os textos, o formato do arquivo. */
export function formatoDaCapa(item: Pick<ItemDaBiblioteca, 'formato' | 'midia'>): string {
  return item.midia ? (item.midia.tipo === 'video' ? 'vídeo' : 'áudio') : item.formato;
}
/**
 * Os documentos da biblioteca e as árvores que faltam. A lista já traz `capitulos_total` (V-D1), então
 * a árvore só é pedida para as versões em `extras` (o item aberto no painel, a retomada do Início) e,
 * nas APIs antigas sem o campo, para cada documento.
 */
export function usarBiblioteca(carregar = listarDocumentos, arquivados = false, revisao = 0, extras: readonly (string | null | undefined)[] = []) {
  const [documentos, definir] = useState<ItemDaBiblioteca[] | null>(null);
  const [arvores, definirArvores] = useState<Record<string, ArvoreDaVersao>>({});
  const [erro, definirErro] = useState<string | null>(null);
  const pedidas = useRef(new Set<string>());
  useEffect(() => {
    let vivo = true; definirErro(null); definir(null);
    carregar(arquivados).then((r) => { if (vivo) definir(r.documentos); }, (e: unknown) => { if (vivo) definirErro(e instanceof Error ? e.message : 'falha ao carregar'); });
    return () => { vivo = false; };
  }, [carregar, arquivados, revisao]);
  const semContagem = (documentos ?? []).flatMap((d) => d.versao_id && d.texto_disponivel && typeof d.capitulos_total !== 'number' ? [d.versao_id] : []);
  const faltam = [...new Set([...semContagem, ...extras.filter((id): id is string => typeof id === 'string')])].filter((id) => !pedidas.current.has(id));
  const chave = faltam.join(',');
  useEffect(() => {
    if (faltam.length === 0) return;
    for (const id of faltam) pedidas.current.add(id);
    void Promise.all(faltam.map(async (id) => { try { const arvore = await arvoreDaVersao(id); return Array.isArray(arvore.capitulos) ? [id, arvore] as const : null; } catch { pedidas.current.delete(id); return null; } }))
      .then((r) => { const novas = r.filter((a) => a !== null); if (novas.length) definirArvores((atuais) => ({ ...atuais, ...Object.fromEntries(novas) })); });
  // `chave` resume `faltam`; uma árvore já pedida não volta a ser pedida.
  }, [chave]);
  return { documentos, arvores, erro };
}
/**
 * Biblioteca vazia: em vez de só constatar, conduz ao primeiro item (um exemplo de texto, de quadro,
 * um vídeo ou o que a pessoa trouxer) e aos primeiros passos. Os arquivados vazios ficam com a frase curta.
 */
export function ConviteAdicionar({ ir, arquivados = false }: { ir: PropsDaLista['ir']; arquivados?: boolean }) {
  if (arquivados) return <EstadoVazio frase="Nada arquivado." />;
  return <div className="biblioteca-vazia conduzir"><Icon name="library" size={56} />
    <div className="conduzir-texto"><h2>Nenhum item ainda.</h2><p>Traga um PDF, um livro, um vídeo ou a imagem de um quadro, ou comece por um exemplo para ver como o Margem funciona.</p></div>
    <PrimeiroDocumento ir={ir} />
    <a className="link-primeiros-passos" href="/configuracoes/primeiros-passos" onClick={(e) => { e.preventDefault(); ir({ nome: 'configuracoes', secao: 'primeiros-passos' }); }}>Primeiros passos <Icon name="arrow" size={14} /></a>
  </div>;
}
export function EstadoVazio({ frase }: { frase: string }) {
  return <div className="biblioteca-vazia"><Icon name="arquivo" size={88} /><p>{frase}</p></div>;
}
/** A partir de quantos caracteres o campo da biblioteca também busca no texto. */
const MINIMO_NO_TEXTO = 3;
/** Trechos mostrados por documento; o resto, pelo Ctrl F dentro dele. */
const TRECHOS_POR_DOCUMENTO = 3;
/** O rótulo da ordenação no botão fechado; no cabeçalho estreito, só o ícone fica à vista. */
const ROTULO_DA_ORDEM: Record<string, string> = { leitura: 'Última leitura', adicionados: 'Adicionados', titulo: 'Título' };

function rotaDoResultado(resultado: ResultadoDaBusca): Rota {
  return resultado.capitulo
    ? { nome: 'leitura', documento_id: resultado.documento_id, secao_id: resultado.capitulo.id, bloco: resultado.bloco_id }
    : { nome: 'leitura', documento_id: resultado.documento_id };
}

export function Lista({ ir, carregar = listarDocumentos, carregarQuadros, operacoesDosQuadros = OPERACOES_DOS_QUADROS, rota, buscarTexto = buscarNaBiblioteca, seletorDeTipo = true }: PropsDaLista): ReactNode {
  const [abaLocal, definirAba] = useState('todos');
  const aba = rota?.aba ?? (rota ? 'todos' : abaLocal);
  const [busca, buscar] = useState('');
  const [ordem, ordenar] = useState('leitura');
  const [revisao, recarregar] = useState(0);
  const [foco, focar] = useState<string | null>(null);
  const [painel, abrirPainel] = useState(() => preferencia('margem:painel-biblioteca', true));
  const [versaoNoPainel, definirVersaoNoPainel] = useState<string | null>(null);
  const { documentos, arvores, erro } = usarBiblioteca(carregar, aba === 'arquivados', revisao, painel ? [versaoNoPainel] : []);
  const { quadros, preparando, recarregar: recarregarQuadros } = usarListaDeQuadros(carregarQuadros);
  const acoesDoPreparo = usarAcoesDoPreparo(recarregarQuadros, operacoesDosQuadros);
  const [identificando, identificar] = useState<{ slug: string; titulo: string | null; artista: string | null; ano: string | null } | null>(null);
  const arte = usarRecurso('arte');
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
  // Quadros sem nenhuma obra da pessoa (J118): explica e convida a adicionar a primeira, em vez de uma lista muda.
  const semObrasDaPessoa = soQuadros && quadros !== null && !quadros.some((q) => !q.exemplo) && preparando.length === 0 && aba !== 'arquivados' && !busca;
  // A categoria vem do tipo de arquivo (V-D1): cada documento em uma só, sem esperar a árvore.
  const passaNosFiltros = (d: ItemDaBiblioteca) => {
    const total = capitulosDoItem(d, arvores);
    return (aba !== 'lendo' || (d.progresso !== null && (total === undefined || d.progresso.capitulos_concluidos < total))) &&
      (aba !== 'novos' || d.progresso === null) &&
      (!rota?.tipo || categoriaDoDocumento(d) === rota.tipo);
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
  // Obras da pessoa ainda não prontas (J118): junto dos quadros, com o estado do preparo.
  const preparoFiltrado = (!rota?.tipo || soQuadros) && aba !== 'arquivados' && aba !== 'lendo'
    ? preparando.filter((q) => `${tituloDoPreparo(q)} ${q.identificacao?.artista ?? ''}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase())) : [];
  const entradas: Entrada[] = [
    ...filtrados.map((d): Entrada => ({ chave: d.id, documento: d, quadro: null, preparo: null, titulo: d.titulo, aberto: d.progresso?.atualizado_em ?? null, criado: d.criado_em })),
    ...quadrosFiltrados.map((q): Entrada => ({ chave: `quadro:${q.slug}`, documento: null, quadro: q, preparo: null, titulo: q.titulo, aberto: vistoEm(q.slug), criado: q.adicionado_em })),
    ...preparoFiltrado.map((q): Entrada => ({ chave: `preparo:${q.slug}`, documento: null, quadro: null, preparo: q, titulo: tituloDoPreparo(q), aberto: null, criado: q.enviado_em })),
  ].sort((a, b) => compararParaOrdem(ordem, a, b));
  const selecionada = entradas.find((e) => e.chave === foco) ?? entradas[0];
  const selecionado = selecionada?.documento ?? undefined;
  const versaoSelecionada = selecionado?.versao_id ?? null;
  useEffect(() => { definirVersaoNoPainel(versaoSelecionada); }, [versaoSelecionada]);
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
  const titulo = rota?.tipo ? descricaoDaCategoria(rota.tipo).rotulo : 'Biblioteca';
  // Quadros não se arquivam nem ficam "em leitura": lá, só Todos e Não abertos.
  const abas = ([['todos', 'Todos'], ['lendo', 'Em leitura'], ['novos', 'Não abertos'], ['arquivados', 'Arquivados']] as const)
    .filter(([valor]) => !soQuadros || valor === 'todos' || valor === 'novos');
  const quantosQuadros = quadrosFiltrados.length + preparoFiltrado.length;
  const contador = rota?.tipo === 'quadros' ? contadorDaCategoria(quantosQuadros, 'quadros')
    : rota?.tipo ? contadorDaCategoria(filtrados.length, rota.tipo, filtrados.flatMap((d) => d.midia ? [d.midia.tipo] : []))
      : contadorDaCategoria(filtrados.length + quantosQuadros, null);
  const vazio = rota?.tipo ? descricaoDaCategoria(rota.tipo).vazio : 'Nada';
  // O "+" e o convite dos Quadros levam à aba certa de Adicionar (V-D2).
  const adicionarAqui = () => ir({ nome: 'adicionar', aba: soQuadros ? 'quadro' : rota?.tipo === 'videos' ? 'video' : 'documento' });
  return <div className={`biblioteca-grade ${painel ? 'com-painel' : ''}`}><section className="lista-biblioteca" aria-label="Biblioteca">
    <header className="biblioteca-cabecalho"><h1><Icon name="library" />{seletorDeTipo ? <Select className="seletor-tipo" aria-label="Tipo de documento" value={rota?.tipo ?? 'todos'} rotuloFechado={titulo} onChange={(e) => {
      const tipo = e.target.value;
      ir({ nome: 'biblioteca', ...(rota?.aba ? { aba: rota.aba } : {}), ...(ehTipoDaBiblioteca(tipo) ? { tipo } : {}) });
    }}><option value="todos">Biblioteca</option>{CATEGORIAS.filter((c) => c.tipo !== 'quadros' || arte).map((c) => <option key={c.tipo} value={c.tipo}>{c.rotulo}</option>)}</Select> : <span className="titulo-da-lista">{titulo}</span>}</h1><nav className="biblioteca-abas" aria-label="Filtrar biblioteca">{abas.map(([valor, nome]) => <Button key={valor} variante="ghost" aria-current={aba === valor ? 'page' : undefined} onClick={() => { definirAba(valor); if (rota) ir({ ...rota, aba: valor }); }}>{nome}</Button>)}</nav>
      <div className="biblioteca-ferramentas">{(!soQuadros || arte) && <IconButton className="adicionar-obra-botao" aria-label={soQuadros ? 'Adicionar obra' : rota?.tipo === 'videos' ? 'Adicionar vídeo' : 'Adicionar'} title={soQuadros ? 'Adicionar obra' : rota?.tipo === 'videos' ? 'Adicionar vídeo' : 'Adicionar'} onClick={adicionarAqui}><Icon name="adicionar" size={18} /></IconButton>}<label className="busca-compacta"><Icon name="buscar" size={16} /><Input ref={entrada} type="search" aria-label="Buscar textos" placeholder="Buscar título, autor ou texto" value={busca} onChange={(e) => buscar(e.target.value)} /></label><Select className="ordenacao" aria-label="Ordenação" value={ordem} rotuloFechado={<><Icon name="ordenar" size={16} /><span className="rotulo-da-ordem">{ROTULO_DA_ORDEM[ordem] ?? ROTULO_DA_ORDEM['leitura']}</span></>} onChange={(e) => ordenar(e.target.value)}><option value="leitura">Última leitura</option><option value="adicionados">Adicionados</option><option value="titulo">Título</option></Select></div>
      {!painel && <IconButton className="alternar-painel" aria-label="Abrir informações" title="Abrir informações (])" onClick={alternarPainel}><Icon name="painel" /></IconButton>}
    </header><h2 className="apenas-leitores">{rota?.tipo ? titulo : 'Todos os itens'}</h2>
    {(erro || erroAcao || acoesDoPreparo.erro) && <p role="alert" className="aviso">{erro ?? erroAcao ?? acoesDoPreparo.erro}</p>}
    {(documentos === null && !erro) || (soQuadros && quadros === null) ? <Esqueleto /> : !soQuadros && documentos?.length === 0 && !quadros?.length && !preparando.length ? <ConviteAdicionar ir={ir} arquivados={aba === 'arquivados'} /> : <>
      {semObrasDaPessoa && <QuadrosVazios aoAdicionar={adicionarAqui} />}<ul ref={lista} className="linhas-biblioteca">{entradas.map(({ chave, documento: item, quadro, preparo }) => {
        if (quadro) return <li key={chave}><LinhaDoQuadro quadro={quadro} atual={chave === selecionada?.chave} ordem={ordem} ir={ir} aoFocar={() => focar(chave)} /></li>;
        if (preparo) {
          return <li key={chave}><LinhaDoQuadroEmPreparo quadro={preparo} atual={chave === selecionada?.chave} aoFocar={() => focar(chave)} ocupado={acoesDoPreparo.ocupado === preparo.slug}
            aoTentar={() => void acoesDoPreparo.tentarDeNovo(preparo.slug)} aoRemover={() => void acoesDoPreparo.remover(preparo.slug, tituloDoPreparo(preparo))}
            aoCorrigir={() => identificar({ slug: preparo.slug, titulo: preparo.identificacao?.titulo ?? null, artista: preparo.identificacao?.artista ?? null, ano: preparo.identificacao?.ano ?? null })} /></li>;
        }
        if (!item) return null;
        const total = capitulosDoItem(item, arvores);
        const data = new Date(ordem === 'adicionados' ? item.criado_em : item.progresso?.atualizado_em ?? item.criado_em);
        const atual = chave === selecionada?.chave;
        return <li key={item.id}><div data-linha tabIndex={atual ? 0 : -1} className={`linha-documento ${atual ? 'em-foco' : ''}`} onMouseEnter={() => focar(item.id)} onFocus={() => focar(item.id)} onClick={() => ir({ nome: item.texto_disponivel ? 'leitura' : 'documento', documento_id: item.id })}>
          <Capa {...item} formato={formatoDaCapa(item)} tamanho="mini" icone={iconeDoDocumento(item, total)} /><div className="linha-conteudo"><a className="titulo" href={`/documentos/${item.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); ir({ nome: 'documento', documento_id: item.id }); }}>{item.titulo}</a><div className="linha-meta">{item.autor && <span>{item.autor}</span>}<span>{rotuloDoDocumento(item, ROTULO_DO_FORMATO)}{!item.midia && total !== undefined && total > 1 ? ' · Livro' : ''}</span>{total !== undefined && !item.midia && <span>{total === 1 ? (item.progresso?.capitulos_concluidos ?? 0) > 0 ? 'lido' : 'texto único' : `${item.progresso?.capitulos_concluidos ?? 0} de ${total} capítulos`}</span>}<span>{item.marcas.total} marcas</span>{item.estado !== 'pronto' && <span className="badge">{item.estado === 'falhou' ? 'Ver documento' : fraseDoEstado(item)}</span>}</div>{item.progresso && item.progresso.capitulos_concluidos > 0 && total !== undefined && total > 0 && <BarraDeProgresso valor={100 * item.progresso.capitulos_concluidos / total} rotulo="Capítulos concluídos" />}</div>
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
      </section>}{(documentos || quadros) && !semObrasDaPessoa && entradas.length === 0 && gruposNoTexto.length === 0 && <EstadoVazio frase={busca ? `${vazio} encontrado.` : aba === 'lendo' ? `${vazio} em leitura.` : aba === 'novos' ? `${vazio} por abrir.` : rota?.tipo ? `${vazio} na biblioteca.` : 'Nada nesta aba.'} />}</>}
    <span className="contagem-biblioteca">{contador}</span>
  </section>{painel && selecionada?.quadro && <PainelDoQuadroNaBiblioteca quadro={selecionada.quadro} ir={ir} fechar={alternarPainel} ocupado={acoesDoPreparo.ocupado === selecionada.quadro.slug}
    aoCorrigir={() => { const q = selecionada.quadro!; identificar({ slug: q.slug, titulo: q.titulo, artista: q.artista, ano: q.ano }); }}
    aoRemover={() => { const q = selecionada.quadro!; void acoesDoPreparo.remover(q.slug, q.titulo); }} />}
  {painel && selecionada?.preparo && <PainelDoQuadroEmPreparo quadro={selecionada.preparo} fechar={alternarPainel} ocupado={acoesDoPreparo.ocupado === selecionada.preparo.slug}
    aoTentar={() => void acoesDoPreparo.tentarDeNovo(selecionada.preparo!.slug)} aoRemover={() => void acoesDoPreparo.remover(selecionada.preparo!.slug, tituloDoPreparo(selecionada.preparo!))}
    aoCorrigir={() => { const q = selecionada.preparo!; identificar({ slug: q.slug, titulo: q.identificacao?.titulo ?? null, artista: q.identificacao?.artista ?? null, ano: q.identificacao?.ano ?? null }); }} />}
  {painel && !selecionada?.quadro && !selecionada?.preparo && <PainelDoItem item={selecionado} arvore={arvores[selecionado?.versao_id ?? '']} ir={ir} fechar={alternarPainel} />}
  {identificando && <IdentificarObra quadro={identificando} operacoes={operacoesDosQuadros} aoFechar={() => identificar(null)} aoSalvar={(novo) => { identificar(null); recarregarQuadros(); focar(`preparo:${novo.slug}`); }} />}</div>;
}

/** Uma linha da Biblioteca: um documento, um quadro pronto ou uma obra da pessoa em preparo. */
interface Entrada { chave: string; documento: ItemDaBiblioteca | null; quadro: ResumoDoQuadro | null; preparo: QuadroDaPessoaV1 | null; titulo: string; aberto: string | null; criado: string }

/** "Última leitura": os já abertos primeiro, do mais recente; os nunca abertos depois, pela adição. */
function compararParaOrdem(ordem: string, a: Entrada, b: Entrada): number {
  if (ordem === 'titulo') return a.titulo.localeCompare(b.titulo, 'pt-BR');
  if (ordem === 'leitura' && (a.aberto === null) !== (b.aberto === null)) return a.aberto === null ? 1 : -1;
  const data = (item: Entrada) => ordem === 'leitura' ? item.aberto ?? item.criado : item.criado;
  return data(b).localeCompare(data(a));
}
