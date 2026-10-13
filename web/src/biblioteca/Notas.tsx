/**
 * Notas: as anotações e os grifos do leitor fora do capítulo aberto, de um documento (`/documentos/:id/notas`)
 * ou da biblioteca inteira (`/notas`). Cada item leva de volta ao trecho (`?bloco=`, lido pelo leitor),
 * copia o trecho como citação e o recorte filtrado sai em CSV ou JSON.
 */
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Esqueleto } from '../ui/Esqueleto';
import { Icon } from '../ui/Icon';
import { Button, Input, Select } from '../ui/Primitives';
import { consultaDasNotas, listarNotas, type FiltroDeNotas } from './api';
import { EstadoVazio } from './Lista';
import type { Rota } from './rotas';
import type { ItemDeNota } from './tipos';

/** “trecho” — Autor, *Título*, p. X (ou o capítulo quando não há página). */
export function citacaoFormatada(item: Pick<ItemDeNota, 'citacao' | 'documento' | 'pagina' | 'capitulo'>): string {
  const capitulo = item.capitulo?.titulo.trim();
  const onde = item.pagina !== null ? `p. ${item.pagina}`
    : capitulo ? (/^cap/i.test(capitulo) ? capitulo : `cap. ${capitulo}`) : null;
  const fonte = [item.documento.autor?.trim(), `*${item.documento.titulo}*`, onde].filter((parte) => parte).join(', ');
  return `“${item.citacao.trim()}” — ${fonte}`;
}

/** O link de volta ao trecho passa pelo roteador da web, que lê o `?bloco=` (não recarrega a página). */
function irAoTrecho(evento: MouseEvent<HTMLAnchorElement>, link: string): void {
  if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
  evento.preventDefault();
  window.history.pushState(null, '', link);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function filtroDaEscolha(escolha: string): Pick<FiltroDeNotas, 'especie' | 'tipo'> {
  if (escolha === 'anotacao' || escolha === 'grifo') return { especie: escolha };
  return escolha.startsWith('tipo:') ? { tipo: escolha.slice(5) } : {};
}

function grupos(itens: readonly ItemDeNota[], porDocumento: boolean): { chave: string; titulo: string; subtitulo: string | null; itens: ItemDeNota[] }[] {
  const mapa = new Map<string, { chave: string; titulo: string; subtitulo: string | null; itens: ItemDeNota[] }>();
  for (const item of itens) {
    const chave = porDocumento ? item.documento.id : item.capitulo?.id ?? '';
    const grupo = mapa.get(chave) ?? { chave, titulo: porDocumento ? item.documento.titulo : item.capitulo?.titulo ?? 'Sem capítulo',
      subtitulo: porDocumento ? item.documento.autor : null, itens: [] };
    grupo.itens.push(item);
    mapa.set(chave, grupo);
  }
  return [...mapa.values()];
}

function Item({ item, geral }: { item: ItemDeNota; geral: boolean }): ReactNode {
  const [copiada, copiar] = useState(false);
  const cor = item.cor ? { '--cor-claro': item.cor.claro, '--cor-escuro': item.cor.escuro } as CSSProperties : undefined;
  const data = new Date(item.criada_em);
  const aoCopiar = () => {
    void navigator.clipboard?.writeText(citacaoFormatada(item)).then(() => { copiar(true); setTimeout(() => copiar(false), 1500); }, () => undefined);
  };
  return <li className="nota-item">
    <span className="eyebrow">{cor && <span className="nota-cor" style={cor} aria-hidden="true">● </span>}{item.especie === 'grifo' ? `Grifo · ${item.rotulo}` : item.rotulo}</span>
    <a className="nota-trecho" href={item.link} onClick={(evento) => irAoTrecho(evento, item.link)} aria-label={`Ir ao trecho: ${item.citacao}`}><blockquote>{item.citacao}</blockquote></a>
    {item.nota && <p className="nota-texto">{item.nota}</p>}
    <div className="nota-meta">
      {geral && item.capitulo && <span>{item.capitulo.titulo}</span>}
      {item.pagina !== null && <span>p. {item.pagina}</span>}
      <time dateTime={item.criada_em}>{data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</time>
      <Button variante="ghost" className="nota-copiar" onClick={aoCopiar} aria-live="polite"><Icon name="aspas" size={16} />{copiada ? 'Citação copiada' : 'Copiar como citação'}</Button>
    </div>
  </li>;
}

export interface PropsDasNotas {
  documento_id?: string;
  ir: (destino: Rota) => void;
  carregar?: (filtro: FiltroDeNotas) => Promise<{ itens: ItemDeNota[] }>;
}

export function Notas({ documento_id, ir, carregar = listarNotas }: PropsDasNotas): ReactNode {
  const [todas, definirTodas] = useState<ItemDeNota[] | null>(null);
  const [filtradas, definirFiltradas] = useState<ItemDeNota[] | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [texto, definirTexto] = useState('');
  const [escolha, escolher] = useState('');
  const [documento, definirDocumento] = useState(documento_id ?? '');
  const geral = documento_id === undefined;
  const filtro: FiltroDeNotas = { ...(documento ? { documento } : {}), ...filtroDaEscolha(escolha), ...(texto.trim() ? { texto: texto.trim() } : {}) };
  const consulta = consultaDasNotas(filtro);
  const semFiltro = consulta === consultaDasNotas(documento_id ? { documento: documento_id } : {});

  useEffect(() => {
    let vivo = true;
    definirTodas(null); definirErro(null);
    carregar(documento_id ? { documento: documento_id } : {}).then(
      (resposta) => { if (vivo) definirTodas(resposta.itens); },
      (falha: unknown) => { if (vivo) definirErro(falha instanceof Error ? falha.message : 'falha ao carregar'); },
    );
    return () => { vivo = false; };
  }, [documento_id, carregar]);

  useEffect(() => {
    if (semFiltro) { definirFiltradas(null); return; }
    let vivo = true;
    const espera = setTimeout(() => {
      carregar(filtro).then((resposta) => { if (vivo) definirFiltradas(resposta.itens); },
        (falha: unknown) => { if (vivo) definirErro(falha instanceof Error ? falha.message : 'falha ao filtrar'); });
    }, 250);
    return () => { vivo = false; clearTimeout(espera); };
    // A consulta resume o filtro inteiro.
  }, [consulta, semFiltro, carregar]);

  const itens = semFiltro ? todas : filtradas;
  const doDocumento = geral ? undefined : todas?.[0]?.documento.titulo;
  const tipos = [...new Map((todas ?? []).map((item) => [item.tipo, item.rotulo])).entries()];
  const documentos = [...new Map((todas ?? []).map((item) => [item.documento.id, item.documento.titulo])).entries()];
  return <section className="notas" aria-label="Notas">
    <header className="notas-cabecalho">
      {documento_id !== undefined && <a className="voltar" href={`/documentos/${documento_id}`} onClick={(evento) => { evento.preventDefault(); ir({ nome: 'documento', documento_id }); }}><Icon name="voltar" size={16} />Voltar ao documento</a>}
      {doDocumento !== undefined && <span className="eyebrow">Notas</span>}
      <h1>{doDocumento ?? 'Notas'}</h1>
      <div className="notas-ferramentas">
        <label className="busca-compacta"><Icon name="buscar" size={16} /><Input type="search" aria-label="Procurar nas notas" placeholder="Procurar no trecho ou na nota" value={texto} onChange={(evento) => definirTexto(evento.target.value)} /></label>
        <Select aria-label="Tipo de nota" value={escolha} onChange={(evento) => escolher(evento.target.value)}>
          <option value="">Tudo</option><option value="anotacao">Anotações</option><option value="grifo">Grifos</option>
          {tipos.map(([tipo, rotulo]) => <option key={tipo} value={`tipo:${tipo}`}>{rotulo}</option>)}
        </Select>
        {geral && documentos.length > 1 && <Select aria-label="Documento" value={documento} onChange={(evento) => definirDocumento(evento.target.value)}>
          <option value="">Todos os documentos</option>
          {documentos.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
        </Select>}
        <a className="ui-button ui-secundario" href={`/api/notas/exportacao.csv${consulta}`} download><Icon name="exportar" size={16} />CSV</a>
        <a className="ui-button ui-secundario" href={`/api/notas/exportacao.json${consulta}`} download><Icon name="exportar" size={16} />JSON</a>
      </div>
    </header>
    {erro !== null && <p className="aviso" role="alert">Não foi possível carregar as notas: {erro}</p>}
    {itens === null && erro === null ? <Esqueleto /> : itens !== null && itens.length === 0
      ? <EstadoVazio frase={semFiltro ? (geral ? 'Nenhuma anotação ou grifo ainda.' : 'Nenhuma anotação ou grifo neste documento.') : 'Nenhuma nota com esse filtro.'} />
      : itens !== null && <>
        <p className="notas-contagem" role="status">{itens.length === 1 ? '1 nota' : `${String(itens.length)} notas`}</p>
        {grupos(itens, geral).map((grupo) => <section key={grupo.chave} className="notas-grupo" aria-label={grupo.titulo}>
          <h2>{grupo.titulo}{grupo.subtitulo && <span className="notas-autor"> · {grupo.subtitulo}</span>}</h2>
          {geral && <a className="notas-do-documento" href={`/documentos/${grupo.chave}/notas`} onClick={(evento) => { evento.preventDefault(); ir({ nome: 'notas', documento_id: grupo.chave }); }}>Só as deste documento</a>}
          <ul className="notas-lista">{grupo.itens.map((item) => <Item key={item.id} item={item} geral={geral} />)}</ul>
        </section>)}
      </>}
  </section>;
}
