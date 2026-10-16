/**
 * Notas (J145): a central de tudo o que foi produzido em todos os documentos (`/notas`) ou num só
 * (`/documentos/:id/notas`): grifos do leitor e do Codex, as notas dos grifos, os comentários do Codex, as
 * relações (com os dois trechos), as dificuldades, as resoluções de exercícios, os flashcards, as perguntas
 * presas a trechos e os visuais. Uma rota paginada no serviço (`GET /api/notas/central`), com contagens para os
 * filtros: tipo, documento, autoria (meu / Codex), função (só as que aparecem), data, busca e ordem; e o
 * agrupamento por documento. Cada item mostra o trecho, o lugar (documento, capítulo, página) e abre o leitor no
 * ponto exato, no painel do item (balão do grifo, conexões, relação da leitura, conversa, exercício, visual).
 *
 * Como a Biblioteca: a página tem a largura da área de conteúdo e só a lista rola (J136).
 * Apagar: o "⋯" do item já tem o lugar; a ação aparece quando a casca passa `apagar` (rotas do J143).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { mensagemDeErro } from './erros';
import { Esqueleto } from '../ui/Esqueleto';
import { Icon } from '../ui/Icon';
import { Button, IconButton, Input, Popover, SegmentedControl, Select, Switch } from '../ui/Primitives';
import { TextoComMatematica } from '../leitor/resolucao/Matematica';
import { consultaDasNotas, listarCentral, type FiltroDaCentral } from './api';
import { gravarIntencao, type IntencaoDeLeitura } from './intencao';
import { EstadoVazio } from './Lista';
import type { Rota } from './rotas';
import type { AberturaNoLeitor, FacetasDaCentral, FiltroDeTipoDaCentral, ItemDaCentral, PaginaDaCentral } from './tipos';

/** “trecho” — Autor, *Título*, p. X (ou o capítulo quando não há página). */
export function citacaoFormatada(item: Pick<ItemDaCentral, 'citacao' | 'documento' | 'pagina' | 'capitulo'>): string {
  const capitulo = item.capitulo?.titulo.trim();
  const onde = item.pagina !== null ? `p. ${item.pagina}`
    : capitulo ? (/^cap/i.test(capitulo) ? capitulo : `cap. ${capitulo}`) : null;
  const fonte = [item.documento.autor?.trim(), `*${item.documento.titulo}*`, onde].filter((parte) => parte).join(', ');
  return `“${item.citacao.trim()}” — ${fonte}`;
}

export const TIPOS_DA_CENTRAL: readonly (readonly [FiltroDeTipoDaCentral | '', string])[] = [
  ['', 'Tudo'], ['grifo', 'Grifos'], ['nota', 'Notas'], ['comentario', 'Comentários'], ['relacao', 'Relações'], ['dificuldade', 'Dificuldades'],
  ['resolucao', 'Exercícios'], ['flashcard', 'Flashcards'], ['conversa', 'Perguntas'], ['visual', 'Visuais'],
];
const PERIODOS: readonly (readonly [string, string])[] = [['', 'Qualquer data'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['365', 'Último ano']];
const ORDENS: readonly (readonly [NonNullable<FiltroDaCentral['ordem']>, string])[] = [['recentes', 'Mais recentes'], ['antigos', 'Mais antigos'], ['documento', 'Por documento']];
const POR_PAGINA = 50;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** O que a pessoa escolheu nos filtros; vai para a URL (`?tipo=…`) para voltar do leitor no mesmo lugar. */
export interface EscolhaDaCentral {
  tipo: FiltroDeTipoDaCentral | '';
  autoria: '' | 'leitor' | 'codex';
  documento: string;
  /** `<modo>:<função>` (sem modo no grifo sem função). */
  funcao: string;
  periodo: string;
  ordem: NonNullable<FiltroDaCentral['ordem']>;
  agrupar: boolean;
  texto: string;
}
const ESCOLHA_INICIAL: EscolhaDaCentral = { tipo: '', autoria: '', documento: '', funcao: '', periodo: '', ordem: 'recentes', agrupar: false, texto: '' };

/** `ordemPadrao`: na página de um documento a ordem do texto; na de tudo, as mais recentes. */
export function escolhaDaUrl(busca: string, ordemPadrao: EscolhaDaCentral['ordem'] = 'recentes'): EscolhaDaCentral {
  const p = new URLSearchParams(busca);
  const tipo = p.get('tipo') ?? '';
  const autoria = p.get('autoria') ?? '';
  const ordem = p.get('ordem') ?? '';
  const periodo = p.get('periodo') ?? '';
  const documento = p.get('documento') ?? '';
  const funcao = p.get('funcao') ?? '';
  return {
    tipo: TIPOS_DA_CENTRAL.find(([valor]) => valor === tipo)?.[0] ?? '',
    autoria: autoria === 'leitor' || autoria === 'codex' ? autoria : '',
    documento: ULID.test(documento) ? documento : '',
    funcao: /^[a-z0-9_-]*:[a-z][a-z0-9_]*$/.test(funcao) ? funcao : '',
    periodo: PERIODOS.some(([valor]) => valor === periodo) ? periodo : '',
    ordem: ORDENS.find(([valor]) => valor === ordem)?.[0] ?? ordemPadrao,
    agrupar: p.get('agrupar') === '1',
    texto: (p.get('q') ?? '').slice(0, 200),
  };
}

export function urlDaEscolha(escolha: EscolhaDaCentral, ordemPadrao: EscolhaDaCentral['ordem'] = 'recentes'): string {
  const p = new URLSearchParams();
  if (escolha.tipo) p.set('tipo', escolha.tipo);
  if (escolha.autoria) p.set('autoria', escolha.autoria);
  if (escolha.documento) p.set('documento', escolha.documento);
  if (escolha.funcao) p.set('funcao', escolha.funcao);
  if (escolha.periodo) p.set('periodo', escolha.periodo);
  if (escolha.ordem !== ordemPadrao) p.set('ordem', escolha.ordem);
  if (escolha.agrupar) p.set('agrupar', '1');
  if (escolha.texto.trim()) p.set('q', escolha.texto.trim());
  return p.size ? `?${p.toString()}` : '';
}

/** O filtro do serviço para a escolha (o documento da página vence o da escolha). */
export function filtroDaEscolha(escolha: EscolhaDaCentral, documentoDaPagina: string | undefined, hoje = new Date()): FiltroDaCentral {
  const [modo = '', funcao = ''] = escolha.funcao.split(':');
  const documento = documentoDaPagina ?? escolha.documento;
  const desde = escolha.periodo ? new Date(hoje.getTime() - Number(escolha.periodo) * 86_400_000).toISOString().slice(0, 10) : '';
  return {
    ...(documento ? { documento } : {}), ...(escolha.tipo ? { tipo: escolha.tipo } : {}), ...(escolha.autoria ? { autoria: escolha.autoria } : {}),
    ...(funcao ? { funcao, ...(modo ? { modo } : {}) } : {}), ...(escolha.texto.trim() ? { texto: escolha.texto.trim() } : {}),
    ...(desde ? { desde } : {}), ordem: escolha.agrupar && documentoDaPagina === undefined ? 'documento' : escolha.ordem,
  };
}

/** A intenção que o leitor consome ao abrir: o capítulo, o trecho e o painel do item. */
export function intencaoDoItem(abrir: AberturaNoLeitor): IntencaoDeLeitura | null {
  if (abrir.secao_id === null) return null;
  const alvo = abrir.alvo_id ?? undefined;
  return {
    documento_id: abrir.documento_id, secao_id: abrir.secao_id,
    ...(abrir.bloco_id ? { bloco: abrir.bloco_id } : {}), ...(abrir.faixa ? { faixa: abrir.faixa } : {}),
    ...(alvo && (abrir.painel === 'balao' || abrir.painel === 'nota') ? { marca: alvo, ...(abrir.painel === 'nota' ? { nota: true } : {}) } : {}),
    ...(alvo && abrir.painel === 'conexao' ? { conexao: alvo } : {}),
    ...(alvo && abrir.painel === 'relacao' ? { relacao: alvo } : {}),
    ...(alvo && abrir.painel === 'conversa' ? { conversa: alvo } : {}),
    ...(alvo && abrir.painel === 'resolucao' ? { resolucao: alvo } : {}),
    ...(alvo && abrir.painel === 'visual' ? { visual: alvo } : {}),
  };
}

export function abrirNoLeitor(abrir: AberturaNoLeitor, ir: (destino: Rota) => void): void {
  if (abrir.painel === 'flashcards') { ir({ nome: 'flashcards', documento_id: abrir.documento_id }); return; }
  const intencao = intencaoDoItem(abrir);
  if (!intencao) { ir({ nome: 'leitura', documento_id: abrir.documento_id }); return; }
  gravarIntencao(intencao);
  ir({ nome: 'leitura', documento_id: abrir.documento_id, secao_id: intencao.secao_id });
}

/** Rótulo do alto do item: o que ele é e de quem é. */
export function cabecalhoDoItem(item: Pick<ItemDaCentral, 'tipo' | 'rotulo' | 'autoria'>): string {
  const minusculo = item.rotulo.toLocaleLowerCase('pt-BR');
  const partes = item.tipo === 'relacao' ? ['Relação', minusculo]
    : item.tipo === 'dificuldade' ? (item.rotulo === 'Dificuldade' ? ['Dificuldade'] : ['Dificuldade', minusculo])
      : item.tipo === 'flashcard' ? ['Flashcard'] : item.tipo === 'conversa' ? ['Pergunta'] : [item.rotulo];
  if (item.autoria === 'codex') partes.push('Codex');
  return partes.join(' · ');
}

const ESTADOS: Readonly<Record<string, string>> = { sugerida: 'sugestão', pendente: 'em preparo', arquivada: 'arquivada', da_leitura: 'da leitura' };

function semCifroes(texto: string): string { return texto.replace(/\$/g, ''); }

function CorpoDoItem({ item }: { item: ItemDaCentral }): ReactNode {
  switch (item.tipo) {
    case 'relacao': {
      const destino = item.destino;
      const outroDocumento = destino?.documento && destino.documento.id !== item.documento.id ? destino.documento.titulo : null;
      return <>
        {destino && (destino.citacao ?? destino.titulo_externo ?? destino.documento) && <p className="central-destino">
          <Icon name="relacao" size={16} />
          <span>{destino.citacao ?? destino.titulo_externo ?? destino.documento?.titulo}
            {outroDocumento && destino.citacao && <span className="central-onde"> · {outroDocumento}</span>}</span>
        </p>}
        {item.texto && <p className="central-texto">{item.texto}</p>}
      </>;
    }
    case 'resolucao': return <>
      {item.texto && <p className="central-texto"><span className="central-voz">Ideia</span><TextoComMatematica texto={item.texto} /></p>}
      {item.comentario && <p className="central-codex"><span className="central-voz">Resposta</span><TextoComMatematica texto={item.comentario} /></p>}
    </>;
    case 'flashcard': return <>
      {item.texto && <p className="central-texto"><span className="central-voz">Frente</span>{item.texto}</p>}
      {item.comentario && <p className="central-codex"><span className="central-voz">Verso</span>{item.comentario}</p>}
    </>;
    case 'conversa': return <>
      {item.texto && <p className="central-texto">{item.texto}</p>}
      {item.comentario && <p className="central-codex"><span className="central-voz">Codex</span>{item.comentario}</p>}
    </>;
    default: return <>
      {item.nota && <p className="central-nota">{item.nota}</p>}
      {item.texto && <p className="central-texto">{item.texto}</p>}
      {item.comentario && <p className="central-codex"><span className="central-voz">Codex</span>{item.comentario}</p>}
    </>;
  }
}

export interface PropsDoItem {
  item: ItemDaCentral;
  /** Mostra o documento no rodapé (a lista de tudo, sem agrupar). */
  comDocumento: boolean;
  ir: (destino: Rota) => void;
  /** J143: apagar o item (com aviso). Sem ela, o "⋯" não oferece Apagar. */
  apagar?: ((item: ItemDaCentral) => void) | undefined;
}

function ItemDaLista({ item, comDocumento, ir, apagar }: PropsDoItem): ReactNode {
  const [menu, abrirMenu] = useState(false);
  const [copiada, copiar] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const cor = item.cor ? { '--cor-claro': item.cor.claro, '--cor-escuro': item.cor.escuro } as CSSProperties : undefined;
  const data = new Date(item.criada_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const estado = item.estado ? ESTADOS[item.estado] ?? '' : '';
  const abrir = (evento: MouseEvent) => {
    if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault();
    abrirNoLeitor(item.abrir, ir);
  };
  const aoCopiar = () => {
    abrirMenu(false);
    void navigator.clipboard?.writeText(citacaoFormatada(item)).then(() => { copiar(true); setTimeout(() => copiar(false), 1500); }, () => undefined);
  };
  const trecho = item.tipo === 'resolucao' ? semCifroes(item.citacao) : item.citacao;
  const destino = item.destino?.abrir ?? null;
  const rotulo = cabecalhoDoItem(item);
  return <li className={`central-item central-${item.tipo}`} data-chave={item.chave}>
    <div className="central-alto">
      <span className="eyebrow">{cor && <span className="nota-cor" style={cor} aria-hidden="true">● </span>}{rotulo}</span>
      {estado && <span className="central-estado">{estado}</span>}
      {item.tipo === 'conversa' && item.mensagens !== null && item.mensagens > 1 && <span className="central-estado">{item.mensagens} mensagens</span>}
    </div>
    <a className="central-abrir" href={item.abrir.painel === 'flashcards' ? `/documentos/${item.documento.id}/flashcards` : item.link} onClick={abrir}
      aria-label={`Abrir: ${trecho || item.documento.titulo}`}>
      {trecho ? <blockquote>{trecho}</blockquote> : <span className="central-sem-trecho">{item.capitulo?.titulo ?? item.documento.titulo}</span>}
    </a>
    <CorpoDoItem item={item} />
    <div className="central-meta">
      {comDocumento && <span className="central-documento">{item.documento.titulo}</span>}
      {item.capitulo && <span>{item.capitulo.titulo}</span>}
      {item.pagina !== null && <span>p. {item.pagina}</span>}
      <time dateTime={item.criada_em}>{data}</time>
      {copiada && <span role="status">Citação copiada</span>}
      <IconButton ref={botao} tamanho="sm" icone="reticencias" className="central-mais" aria-label={`Mais ações: ${rotulo}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => abrirMenu(!menu)} />
    </div>
    {menu && <Popover ancora={botao} rotulo="Ações do item" largura={240} aoFechar={() => abrirMenu(false)} className="menu-da-nota">
      <ul role="menu" aria-label="Ações do item">
        <li role="none"><button type="button" role="menuitem" onClick={() => { abrirMenu(false); abrirNoLeitor(item.abrir, ir); }}>
          <Icon name={item.tipo === 'flashcard' ? 'cartoes' : 'book'} size={16} />{item.tipo === 'flashcard' ? 'Estudar os flashcards' : 'Abrir'}</button></li>
        {item.tipo === 'flashcard' && <li role="none"><button type="button" role="menuitem" onClick={() => { abrirMenu(false); abrirNoLeitor({ ...item.abrir, painel: 'trecho', alvo_id: null }, ir); }}>
          <Icon name="book" size={16} />Abrir o trecho</button></li>}
        {destino && <li role="none"><button type="button" role="menuitem" onClick={() => { abrirMenu(false); abrirNoLeitor(destino, ir); }}>
          <Icon name="relacao" size={16} />Abrir o outro trecho</button></li>}
        {item.citacao && <li role="none"><button type="button" role="menuitem" onClick={aoCopiar}><Icon name="aspas" size={16} />Copiar como citação</button></li>}
        {/* J143: "Apagar…" (com aviso) aparece quando a casca passa `apagar`. */}
        {apagar && <li role="none"><button type="button" role="menuitem" className="perigo" onClick={() => { abrirMenu(false); apagar(item); }}><Icon name="lixeira" size={16} />Apagar…</button></li>}
      </ul>
    </Popover>}
  </li>;
}

interface Grupo { chave: string; titulo: string; autor: string | null; itens: ItemDaCentral[] }
function emGrupos(itens: readonly ItemDaCentral[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const item of itens) {
    const ultimo = grupos.at(-1);
    if (ultimo?.chave === item.documento.id) ultimo.itens.push(item);
    else grupos.push({ chave: item.documento.id, titulo: item.documento.titulo, autor: item.documento.autor, itens: [item] });
  }
  return grupos;
}

export interface PropsDasNotas {
  documento_id?: string;
  ir: (destino: Rota) => void;
  carregar?: (filtro: FiltroDaCentral) => Promise<PaginaDaCentral>;
  /**
   * J143: apagar um item. A casca liga às rotas de apagar (com o aviso antes) e resolve `true` quando apagou: o
   * item sai da lista e o total diminui, sem recarregar.
   */
  apagar?: (item: ItemDaCentral) => Promise<boolean>;
  /** Quais itens oferecem "Apagar…" (sem ela, todos, quando há `apagar`). */
  podeApagar?: (item: ItemDaCentral) => boolean;
}

export function Notas({ documento_id, ir, carregar = listarCentral, apagar, podeApagar }: PropsDasNotas): ReactNode {
  const ordemPadrao: EscolhaDaCentral['ordem'] = documento_id === undefined ? 'recentes' : 'documento';
  const [escolha, escolher] = useState<EscolhaDaCentral>(() => typeof window === 'undefined' ? { ...ESCOLHA_INICIAL, ordem: ordemPadrao } : escolhaDaUrl(window.location.search, ordemPadrao));
  const [busca, buscar] = useState(escolha.texto);
  const [itens, definirItens] = useState<ItemDaCentral[] | null>(null);
  const [total, definirTotal] = useState(0);
  const [facetas, definirFacetas] = useState<FacetasDaCentral | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [carregandoMais, carregarMais] = useState(false);
  const [exportar, abrirExportar] = useState(false);
  const botaoExportar = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const pedido = useRef(0);
  const geral = documento_id === undefined;
  const mudar = useCallback((parcial: Partial<EscolhaDaCentral>) => escolher((atual) => ({ ...atual, ...parcial })), []);

  // A busca espera a pessoa parar de digitar.
  useEffect(() => {
    if (busca === escolha.texto) return;
    const espera = setTimeout(() => mudar({ texto: busca }), 250);
    return () => clearTimeout(espera);
  }, [busca, escolha.texto, mudar]);

  // A escolha vai para a URL (sem nova entrada no histórico): voltar do leitor reabre o mesmo recorte.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const destino = `${window.location.pathname}${urlDaEscolha(geral ? escolha : { ...escolha, documento: '', agrupar: false }, ordemPadrao)}`;
    if (destino !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', destino);
  }, [escolha, geral, ordemPadrao]);

  const filtro = useMemo(() => filtroDaEscolha(escolha, documento_id), [escolha, documento_id]);
  const consulta = JSON.stringify(filtro);

  useEffect(() => {
    const numero = ++pedido.current;
    definirErro(null);
    definirItens(null);
    carregar({ ...filtro, limite: POR_PAGINA, facetas: true }).then((pagina) => {
      if (numero !== pedido.current) return;
      definirItens(pagina.itens); definirTotal(pagina.total);
      if (pagina.facetas) definirFacetas(pagina.facetas);
      lista.current?.scrollTo?.({ top: 0 });
    }, (falha: unknown) => { if (numero === pedido.current) definirErro(mensagemDeErro(falha, 'Não foi possível carregar as notas.')); });
    // `consulta` resume o filtro inteiro.
  }, [consulta, carregar]);

  const temMais = itens !== null && itens.length < total;
  const maisUma = useCallback(() => {
    if (!temMais || carregandoMais || itens === null) return;
    const numero = pedido.current;
    carregarMais(true);
    carregar({ ...filtro, limite: POR_PAGINA, deslocamento: itens.length }).then((pagina) => {
      if (numero !== pedido.current) return;
      definirItens((atuais) => {
        const vistos = new Set((atuais ?? []).map((item) => item.chave));
        return [...(atuais ?? []), ...pagina.itens.filter((item) => !vistos.has(item.chave))];
      });
      definirTotal(pagina.total);
    }, (falha: unknown) => { if (numero === pedido.current) definirErro(mensagemDeErro(falha, 'Não foi possível carregar as notas.')); })
      .finally(() => carregarMais(false));
  }, [temMais, carregandoMais, itens, carregar, filtro]);

  // Rolagem infinita: o fim da lista à vista pede a próxima página (o botão continua, para teclado e sem observador).
  useEffect(() => {
    const alvo = fim.current;
    if (!alvo || !temMais || typeof IntersectionObserver !== 'function') return;
    const observador = new IntersectionObserver((entradas) => { if (entradas.some((entrada) => entrada.isIntersecting)) maisUma(); }, { root: lista.current, rootMargin: '400px' });
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [temMais, maisUma]);

  const tipos = TIPOS_DA_CENTRAL.filter(([valor]) => valor === '' || valor === escolha.tipo || (facetas?.tipos[valor] ?? 0) > 0);
  const funcoes = facetas?.funcoes ?? [];
  const documentos = facetas?.documentos ?? [];
  const tituloDoDocumento = documento_id ? documentos.find((d) => d.id === documento_id)?.titulo ?? itens?.[0]?.documento.titulo : undefined;
  const filtrando = escolha.tipo !== '' || escolha.autoria !== '' || escolha.funcao !== '' || escolha.periodo !== '' || escolha.texto.trim() !== '' || (geral && escolha.documento !== '');
  const agrupado = geral && escolha.agrupar;
  const exportacao = consultaDasNotas(documento_id ? { documento: documento_id } : escolha.documento ? { documento: escolha.documento } : {});
  const contagem = itens === null ? '' : total === 1 ? '1 item' : `${String(total)} itens`;

  const aoApagar = apagar ? (alvo: ItemDaCentral) => {
    void apagar(alvo).then((apagado) => {
      if (!apagado) return;
      definirItens((atuais) => atuais?.filter((item) => item.chave !== alvo.chave) ?? atuais);
      definirTotal((atual) => Math.max(0, atual - 1));
    }, (falha: unknown) => definirErro(mensagemDeErro(falha, 'Não foi possível apagar.')));
  } : undefined;
  const linhas = (deste: readonly ItemDaCentral[]) => <ul className="central-itens">{deste.map((item) =>
    <ItemDaLista key={item.chave} item={item} comDocumento={geral && !agrupado} ir={ir} apagar={podeApagar && !podeApagar(item) ? undefined : aoApagar} />)}</ul>;

  return <section className="central-notas" aria-label="Notas">
    <header className="central-cabecalho">
      <div className="central-identidade">
        {documento_id !== undefined && <a className="central-voltar" href={`/documentos/${documento_id}`} aria-label="Voltar ao documento" title="Voltar ao documento"
          onClick={(evento) => { evento.preventDefault(); ir({ nome: 'documento', documento_id }); }}><Icon name="voltar" size={18} /></a>}
        <h1>
          {documento_id === undefined && <Icon name="caderno" />}
          <span className="central-titulo">Notas{documento_id !== undefined && <span className="central-do-documento"> · {tituloDoDocumento ?? 'documento'}</span>}</span>
        </h1>
      </div>
      <nav className="biblioteca-abas central-abas" aria-label="Tipo">
        {tipos.map(([valor, nome]) => <Button key={valor || 'tudo'} variante="ghost" aria-current={escolha.tipo === valor ? 'page' : undefined}
          onClick={() => mudar({ tipo: valor, ...(valor !== '' && valor !== 'grifo' && valor !== 'nota' && valor !== 'comentario' ? { funcao: '' } : {}) })}>{nome}</Button>)}
      </nav>
      <div className="biblioteca-ferramentas central-ferramentas">
        <IconButton ref={botaoExportar} icone="exportar" aria-label="Exportar as notas" title="Exportar as notas" aria-expanded={exportar} onClick={() => abrirExportar(!exportar)} />
        {exportar && <Popover ancora={botaoExportar} rotulo="Exportar as notas" largura={240} aoFechar={() => abrirExportar(false)} className="menu-da-nota">
          <ul role="menu" aria-label="Exportar as notas">
            <li role="none"><a role="menuitem" href={`/api/notas/exportacao.csv${exportacao}`} download onClick={() => abrirExportar(false)}><Icon name="exportar" size={16} />Grifos e notas em CSV</a></li>
            <li role="none"><a role="menuitem" href={`/api/notas/exportacao.json${exportacao}`} download onClick={() => abrirExportar(false)}><Icon name="exportar" size={16} />Grifos e notas em JSON</a></li>
          </ul>
        </Popover>}
      </div>
    </header>
    <div className="central-filtros" role="group" aria-label="Filtros">
      <label className="busca-compacta"><Icon name="buscar" size={16} /><Input type="search" aria-label="Procurar nas notas" placeholder="Procurar em tudo" value={busca} onChange={(evento) => buscar(evento.target.value)} /></label>
      <div className="central-opcoes">
        <SegmentedControl rotulo="De quem" valor={escolha.autoria} aoMudar={(valor) => mudar({ autoria: valor === 'leitor' || valor === 'codex' ? valor : '' })}
          opcoes={[{ valor: '', rotulo: 'Tudo' }, { valor: 'leitor', rotulo: 'Meus', dica: 'Seus grifos, notas, conexões, perguntas e flashcards' }, { valor: 'codex', rotulo: 'Codex', dica: 'O que o Codex fez' }]} />
        {geral && documentos.length > 1 && <Select aria-label="Documento" value={escolha.documento} onChange={(evento) => mudar({ documento: evento.target.value })}>
          <option value="">Todos os documentos</option>
          {documentos.map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}
        </Select>}
        {funcoes.length > 0 && <Select aria-label="Função" value={escolha.funcao} onChange={(evento) => mudar({ funcao: evento.target.value })}>
          <option value="">Todas as funções</option>
          {funcoes.map((f) => { const valor = `${f.modo?.id ?? ''}:${f.funcao}`; return <option key={valor} value={valor}>{f.rotulo}</option>; })}
        </Select>}
        <Select aria-label="Data" value={escolha.periodo} onChange={(evento) => mudar({ periodo: evento.target.value })}>
          {PERIODOS.map(([valor, nome]) => <option key={valor || 'sempre'} value={valor}>{nome}</option>)}
        </Select>
        {geral && <Switch checked={escolha.agrupar} aria-label="Agrupar por documento" onChange={(valor) => mudar({ agrupar: valor })}>Agrupar por documento</Switch>}
        {filtrando && <Button variante="ghost" tamanho="sm" className="central-limpar" onClick={() => { buscar(''); escolher({ ...ESCOLHA_INICIAL, ordem: escolha.ordem, agrupar: escolha.agrupar }); }}>Limpar filtros</Button>}
        <Select className="central-ordem" aria-label="Ordem" value={agrupado ? 'documento' : escolha.ordem} onChange={(evento) => mudar({ ordem: evento.target.value as EscolhaDaCentral['ordem'], ...(evento.target.value !== 'documento' ? { agrupar: false } : {}) })}>
          {ORDENS.map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}
        </Select>
        <span className="central-contagem" role="status">{contagem}</span>
      </div>
    </div>
    <div ref={lista} className="central-lista">
      {erro !== null && <p className="aviso" role="alert">Não foi possível carregar as notas: {erro}</p>}
      {itens === null && erro === null ? <Esqueleto />
        : itens !== null && itens.length === 0
          ? <EstadoVazio frase={filtrando ? 'Nada com esse filtro.' : geral ? 'Nada ainda. Grife, anote ou peça uma análise ao Codex: tudo aparece aqui.' : 'Nada neste documento ainda.'} />
          : itens !== null && <>
            {agrupado
              ? emGrupos(itens).map((grupo, indice) => <section key={`${grupo.chave}-${String(indice)}`} className="central-grupo" aria-label={grupo.titulo}>
                <h2>{grupo.titulo}{grupo.autor && <span className="central-autor"> · {grupo.autor}</span>}</h2>
                {linhas(grupo.itens)}
              </section>)
              : linhas(itens)}
            <div ref={fim} className="central-fim">
              {temMais && <Button variante="ghost" disabled={carregandoMais} onClick={maisUma}>{carregandoMais ? 'Carregando…' : `Mostrar mais (${String(total - itens.length)})`}</Button>}
            </div>
          </>}
    </div>
  </section>;
}
