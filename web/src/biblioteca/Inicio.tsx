import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Capa } from '../ui/Capa';
import FlipCard from '../ui/virar/FlipCard';
import { BarraDeProgresso, Icon } from '../ui/Icon';
import { IconButton } from '../ui/Primitives';
import { Esqueleto } from '../ui/Esqueleto';
import { arvoreDaVersao, lerProgresso } from './api';
import { capitulosDoItem } from './categorias';
import { fraseDoProgresso } from './estado';
import { ConviteAdicionar, ROTULO_DO_FORMATO, formatoDaCapa, usarBiblioteca, type PropsDaLista } from './Lista';
import { rotuloDoDocumento } from './tipos';
import type { ArvoreDaVersao, ItemDaBiblioteca } from './tipos';
import { CartaoDoQuadro, usarQuadros } from '../quadros/NaBiblioteca';
import type { ResumoDoQuadro } from '../quadros/tipos';

export function Inicio({ ir, carregar, carregarQuadros }: PropsDaLista) {
  const { documentos, arvores, erro } = usarBiblioteca(carregar);
  const carregados = usarQuadros(carregarQuadros);
  const quadros = carregados ?? [];
  if (erro) return <p className="empty" role="alert">Não foi possível ler a biblioteca: {erro}</p>;
  // Espera os quadros também: chegando depois, empurrariam a fileira já desenhada para o lado.
  if (!documentos || carregados === null) return <Esqueleto />;
  const recentes = [...documentos].sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  const continuar = documentos.filter((d) => {
    const total = capitulosDoItem(d, arvores);
    return d.texto_disponivel && d.progresso && total !== undefined && d.progresso.capitulos_concluidos < total;
  }).sort((a, b) => (b.progresso?.atualizado_em ?? '').localeCompare(a.progresso?.atualizado_em ?? ''));
  // "Livro" é atributo (mais de um capítulo), não categoria: a fileira junta EPUBs, PDFs e Markdowns com capítulos.
  const livros = recentes.filter((d) => !d.midia && (capitulosDoItem(d, arvores) ?? 0) > 1);
  return <div className="inicio"><h1 className="titulo-oculto">Início</h1>
    {documentos.length === 0 && quadros.length === 0 ? <ConviteAdicionar ir={ir} /> : <div className="inicio-secoes">
      {continuar.length > 0 && <Fileira titulo="Continuar lendo" subtitulo="Abertos recentemente e ainda não terminados" icone="book" documentos={continuar} arvores={arvores} ir={ir} retomada />}
      <Fileira titulo="Adicionados recentemente" icone="arquivo" documentos={recentes} quadros={quadros} arvores={arvores} ir={ir} />
      {livros.length > 0 && <Fileira titulo="Livros" icone="library" documentos={livros} arvores={arvores} ir={ir} />}
      {quadros.length > 0 && <Fileira titulo="Quadros" icone="quadro" documentos={[]} quadros={quadros} arvores={arvores} ir={ir} />}
    </div>}
  </div>;
}
function Fileira({ titulo, subtitulo, icone, documentos, quadros = [], arvores, ir, retomada = false }: { titulo: string; subtitulo?: string; icone: string; documentos: ItemDaBiblioteca[]; quadros?: ResumoDoQuadro[]; arvores: Record<string, ArvoreDaVersao>; ir: PropsDaLista['ir']; retomada?: boolean }) {
  const trilho = useRef<HTMLDivElement>(null);
  return <section className="secao-inicio" aria-label={titulo}><header><Icon name={icone} /><h2 title={subtitulo}>{titulo}</h2>{subtitulo && <p>{subtitulo}</p>}<div className="setas-fileira"><IconButton aria-label={`Anteriores — ${titulo}`} onClick={() => trilho.current?.scrollBy({ left: -520, behavior: 'smooth' })}><Icon name="back" size={18} /></IconButton><IconButton aria-label={`Próximos — ${titulo}`} onClick={() => trilho.current?.scrollBy({ left: 520, behavior: 'smooth' })}><Icon name="arrow" size={18} /></IconButton></div></header>
    <div className="fileira-cartoes" ref={trilho}>{misturar(documentos, quadros).map(({ documento, quadro }, indice) => {
      if (quadro) return <CartaoDoQuadro key={`quadro:${quadro.slug}`} quadro={quadro} ir={ir} />;
      if (!documento) return null;
      const arvore = arvores[documento.versao_id ?? ''];
      const total = capitulosDoItem(documento, arvores);
      const destino = { nome: documento.texto_disponivel ? 'leitura' as const : 'documento' as const, documento_id: documento.id };
      return <article key={documento.id} className="cartao-documento" onClick={() => ir(destino)}><CapaQueVira documento={documento} total={total} /><div className="cartao-dados"><span className="eyebrow">{rotuloDoDocumento(documento, ROTULO_DO_FORMATO)}{total !== undefined && !documento.midia && total > 1 && ' · Livro'}</span><h3><a href={`/${documento.texto_disponivel ? 'ler' : 'documentos'}/${documento.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); ir(destino); }}>{documento.titulo}</a></h3>{documento.autor && <p className="autor">{documento.autor}</p>}
        {retomada ? <ProgressoDaBiblioteca documento={documento} arvore={arvore} /> : <p className="dados">{total === 1 ? documento.progresso?.capitulos_concluidos ? 'Lido' : documento.progresso ? 'Texto único · em andamento' : 'texto único' : total !== undefined ? `${documento.progresso?.capitulos_concluidos ?? 0} de ${total} capítulos` : 'Preparando o texto'}</p>}
        {!retomada && total !== undefined && total > 1 && <BarraDeProgresso valor={100 * (documento.progresso?.capitulos_concluidos ?? 0) / total} rotulo="Capítulos concluídos" />}
        {retomada && indice === 0 && <a className="continuar-link" href={`/ler/${documento.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); ir({ nome: 'leitura', documento_id: documento.id }); }}>Continuar <Icon name="arrow" size={14} /></a>}
      </div></article>;
    })}</div>
  </section>;
}
/** Documentos e quadros numa fileira só, do adicionado mais recente ao mais antigo (os documentos já vêm ordenados). */
function misturar(documentos: ItemDaBiblioteca[], quadros: ResumoDoQuadro[]): { documento: ItemDaBiblioteca | null; quadro: ResumoDoQuadro | null }[] {
  if (quadros.length === 0) return documentos.map((documento) => ({ documento, quadro: null }));
  const todos = [...documentos.map((documento) => ({ documento, quadro: null, data: documento.criado_em })), ...quadros.map((quadro) => ({ documento: null, quadro, data: quadro.adicionado_em }))];
  return documentos.length === 0 ? todos : todos.sort((a, b) => b.data.localeCompare(a.data));
}
/** Reutiliza a árvore carregada para a lista; só a retomada precisa dos IDs concluídos. */
function ProgressoDaBiblioteca({ documento, arvore: recebida }: { documento: ItemDaBiblioteca; arvore: ArvoreDaVersao | undefined }): ReactNode {
  const [concluidos, definirConcluidos] = useState<string[] | null>(null);
  // A lista não traz as árvores (V-D1): a retomada pede só a do documento que mostra.
  const [buscada, definirBuscada] = useState<ArvoreDaVersao | undefined>(undefined);
  useEffect(() => {
    if (recebida || !documento.versao_id) return;
    let vivo = true;
    void arvoreDaVersao(documento.versao_id).then((a) => { if (vivo && Array.isArray(a.capitulos)) definirBuscada(a); }, () => {});
    return () => { vivo = false; };
  }, [recebida, documento.versao_id]);
  const arvore = recebida ?? buscada;
  useEffect(() => {
    let vivo = true;
    definirConcluidos(null);
    void lerProgresso(documento.id).then((resposta) => {
      if (vivo) definirConcluidos(resposta.progresso?.capitulos_concluidos ?? []);
    }, () => {});
    return () => { vivo = false; };
  }, [documento.id]);
  const capitulos = arvore?.capitulos ?? [];
  // Texto único: não há "capítulo 1 de 1"; a leitura está em andamento até o "terminei".
  if (capitulos.length === 1) return <p className="dados">{concluidos?.length ? 'Lido' : 'Texto único · em andamento'}</p>;
  const atual = concluidos === null ? -1 : capitulos.findIndex((c) => !concluidos.includes(c.id));
  const indice = atual < 0 ? 0 : atual;
  const capitulo = capitulos[indice];
  const repetido = capitulo?.titulo.trim().toLocaleLowerCase() === documento.titulo.trim().toLocaleLowerCase();
  const rotulo = capitulo && concluidos !== null ? (repetido ? `Capítulo ${indice + 1} de ${capitulos.length}` : capitulo.titulo) : fraseDoProgresso(documento);
  return <><p className="dados capitulo-atual" title={rotulo ?? undefined}>{rotulo}</p>{capitulos.length > 0 && <div className="progresso-cartao"><BarraDeProgresso valor={100 * (concluidos?.length ?? documento.progresso?.capitulos_concluidos ?? 0) / capitulos.length} rotulo="Capítulos concluídos" /><span aria-label={`${concluidos?.length ?? documento.progresso?.capitulos_concluidos ?? 0} de ${capitulos.length} capítulos`}>{concluidos?.length ?? documento.progresso?.capitulos_concluidos ?? 0}/{capitulos.length}</span></div>}</>;
}

/**
 * A capa do card vira no hover do card (Flip Card do React Bits): no verso, um resumo rápido do documento.
 * O clique continua sendo do card, que abre o documento.
 */
function CapaQueVira({ documento, total }: { documento: ItemDaBiblioteca; total: number | undefined }): ReactNode {
  const raiz = useRef<HTMLDivElement>(null);
  const [virada, virar] = useState(false);
  useEffect(() => {
    const cartao = raiz.current?.closest('.cartao-documento');
    if (!cartao) return undefined;
    const entrar = (evento: Event) => { if ((evento as PointerEvent).pointerType !== 'touch') virar(true); };
    const sair = () => virar(false);
    cartao.addEventListener('pointerenter', entrar);
    cartao.addEventListener('pointerleave', sair);
    const focar = () => virar(true);
    cartao.addEventListener('focusin', focar);
    cartao.addEventListener('focusout', sair);
    return () => {
      cartao.removeEventListener('pointerenter', entrar); cartao.removeEventListener('pointerleave', sair);
      cartao.removeEventListener('focusin', focar); cartao.removeEventListener('focusout', sair);
    };
  }, []);
  const lidos = documento.progresso?.capitulos_concluidos ?? 0;
  const progresso = total === undefined ? null : total === 1 ? (lidos > 0 ? 'Lido' : documento.progresso ? 'Em andamento' : 'Não aberto')
    : `${String(lidos)} de ${String(total)} capítulos`;
  const verso = <div className="verso-da-capa">
    <span className="eyebrow">{rotuloDoDocumento(documento, ROTULO_DO_FORMATO)}</span>
    <dl>
      <div><dt>Marcas</dt><dd>{documento.marcas.total}</dd></div>
      {progresso && <div><dt>Progresso</dt><dd>{progresso}</dd></div>}
      <div><dt>Última leitura</dt><dd>{documento.progresso ? new Date(documento.progresso.atualizado_em).toLocaleDateString('pt-BR') : '—'}</dd></div>
      <div><dt>Adicionado</dt><dd>{new Date(documento.criado_em).toLocaleDateString('pt-BR')}</dd></div>
    </dl>
    {total !== undefined && total > 1 && <BarraDeProgresso valor={100 * lidos / total} rotulo="Capítulos concluídos" />}
  </div>;
  return <div ref={raiz} className="capa-que-vira">
    <FlipCard somenteVisual flipped={virada} flipOnClick={false} draggable={false} width="100%" height="auto" radius={10}
      background="transparent" color="inherit" shadow={false} hoverScale={1} tiltMax={6} glareOpacity={0.12}
      front={<Capa {...documento} formato={formatoDaCapa(documento)} tamanho="cartao" />} back={verso} />
  </div>;
}
