import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AncoraV1 } from '@margem/contratos';
import { Button, IconButton, Select } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { TipoDoDocumento } from '../ui/TipoDoDocumento';
import { chaveDaFuncaoDaMarca, usarFuncoes } from './ContextoDosModos';
import { minutosDeLeitura } from './forma';
import { grifoNoTexto, type MarcaDoLeitor } from './f2';
import type { NotaPessoal } from './NotasPessoais';
import type { SnapshotCapitulo } from './tipos';
import type { AcaoDeOuvir } from './BarraDoLeitor';

export interface ConversasDoPainel { total: number; conteudo: ReactNode }

/** Tipos de item do Caderno: os grifos (marcas), as relações, as notas do leitor, os exercícios e os visuais. */
export type TipoDoItemDoCaderno = 'grifo' | 'relacao' | 'nota' | 'exercicio' | 'visual';
const ROTULOS_DOS_TIPOS: Record<TipoDoItemDoCaderno, string> = { grifo: 'Grifos', relacao: 'Relações', nota: 'Notas', exercicio: 'Exercícios', visual: 'Imagens' };

/** Um item que vem de fora do leitor (relação, exercício, visual), já com a sua posição no texto. */
export interface ItemExtraDoCaderno {
  id: string;
  tipo: Exclude<TipoDoItemDoCaderno, 'grifo' | 'nota'>;
  /** Posição no texto: índice do bloco × 1e6 + deslocamento (itens sem âncora usam o do começo da página). */
  ordem: number;
  conteudo: ReactNode;
  aoAbrir: () => void;
  rotulo: string;
  /** A cor do item (a da relação, a mesma do braquete). */
  cor?: string;
}

/** O filtro do Caderno que vem do leitor (funções, origem, recorte): vale também para o texto. */
export interface FiltroDoCaderno { valor: string; opcoes: readonly { valor: string; rotulo: string }[]; aoMudar: (valor: string) => void }

/** Posição de um item no texto: ordem do bloco e, dentro dele, o começo da âncora. */
export function ordemNoTexto(blocos: readonly { id: string }[], ancora: AncoraV1): number {
  const indice = blocos.findIndex((bloco) => bloco.id === ancora.bloco_id);
  return (indice < 0 ? blocos.length : indice) * 1e6 + ancora.inicio_utf16;
}

interface Props {
  snapshot: SnapshotCapitulo;
  tituloDocumento?: string | undefined;
  tipo?: { icone: string; rotulo: string } | undefined;
  autor?: string | undefined;
  /** As marcas desenhadas no texto (já filtradas pelos chips e pela atenção), com o número das que têm nota. */
  grifos: readonly MarcaDoLeitor[];
  numeros: ReadonlyMap<string, number>;
  pessoais: readonly NotaPessoal[];
  extras?: readonly ItemExtraDoCaderno[];
  /** O seletor do Caderno (funções, origem, recorte), que também vale para o texto; tipos de item somam-se a ele. */
  filtro?: FiltroDoCaderno;
  /** Ao lado do seletor, na mesma linha: a camada, quando há mais de uma. */
  filtros?: ReactNode;
  /** Abaixo dos metadados no Info: "Primeiro eu" e "Um caminho para a sua leitura". */
  infoExtra?: ReactNode;
  /** A lista da aba Estudo (Entender, Praticar, Ver); sem ações, a aba não aparece. */
  estudo?: readonly AcaoDeOuvir[];
  /** No topo da aba Estudo (a síntese do capítulo). */
  estudoTopo?: ReactNode;
  conversas?: ConversasDoPainel | undefined;
  /** "Percorrer" grifos e relações (etapa 5): fecha o painel e abre o player de navegação. */
  aoPercorrer?: (() => void) | undefined;
  fixada: string | null;
  aoIr: (id: string, ancora: AncoraV1) => void;
  aoFechar: () => void;
}
type Aba = 'info' | 'caderno' | 'estudo' | 'conversas';
const GRUPOS_DO_ESTUDO = ['Entender', 'Praticar', 'Ver'] as const;

/** Sobreposto à viewport: abrir o caderno nunca recalcula a coluna do documento. */
export function PainelDoLeitor({ snapshot, tituloDocumento, tipo, autor, grifos, numeros, pessoais, extras = [], filtro, filtros, infoExtra, estudo = [], estudoTopo, conversas, aoPercorrer, fixada, aoIr, aoFechar }: Props): ReactNode {
  const [aba, definirAba] = useState<Aba>(() => { try { const guardada = localStorage.getItem('margem:aba-do-painel'); return guardada === 'caderno' || guardada === 'estudo' || guardada === 'conversas' ? guardada : 'info'; } catch { return 'info'; } });
  const mudarAba = (nova: Aba) => { definirAba(nova); try { localStorage.setItem('margem:aba-do-painel', nova); } catch { /* sem storage */ } };
  const [tipoVisivel, mostrarTipo] = useState<TipoDoItemDoCaderno | null>(null);
  const { rotuloDaMarca, daMarca } = usarFuncoes();
  const id = useId();
  const cabeca = useRef<HTMLDivElement>(null);
  useEffect(() => { cabeca.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }); }, []);
  const itens = useMemo(() => [
    ...grifos.map((marca) => ({ id: marca.id, tipo: 'grifo' as const, ordem: ordemNoTexto(snapshot.blocos, marca.ancora), marca, pessoal: null, extra: null })),
    ...pessoais.map((pessoal) => ({ id: pessoal.id, tipo: 'nota' as const, ordem: ordemNoTexto(snapshot.blocos, pessoal.ancora), marca: null, pessoal, extra: null })),
    ...extras.map((extra) => ({ id: extra.id, tipo: extra.tipo, ordem: extra.ordem, marca: null, pessoal: null, extra })),
  ].sort((a, b) => a.ordem - b.ordem), [grifos, pessoais, extras, snapshot.blocos]);
  const tiposPresentes = (Object.keys(ROTULOS_DOS_TIPOS) as TipoDoItemDoCaderno[]).filter((t) => itens.some((item) => item.tipo === t));
  // Um valor do leitor (função, origem, recorte) recorta os grifos: o Caderno mostra só eles.
  const filtroDoLeitor = filtro !== undefined && filtro.valor !== 'tudo' && !filtro.valor.startsWith('t:');
  const visiveis = itens.filter((item) => (filtroDoLeitor ? item.tipo === 'grifo' : tipoVisivel === null || item.tipo === tipoVisivel));
  const valorDoFiltro = filtroDoLeitor ? filtro.valor : tipoVisivel === null ? 'tudo' : `t:${tipoVisivel}`;
  const escolherFiltro = (valor: string) => {
    mostrarTipo(valor.startsWith('t:') ? valor.slice(2) as TipoDoItemDoCaderno : null);
    filtro?.aoMudar(valor.startsWith('t:') ? 'tudo' : valor);
  };
  const abas: { id: Aba; rotulo: string; total?: number }[] = [
    { id: 'info', rotulo: 'Info' }, { id: 'caderno', rotulo: 'Caderno', total: itens.length },
    ...(estudo.length > 0 ? [{ id: 'estudo' as const, rotulo: 'Estudo' }] : []),
    ...(conversas ? [{ id: 'conversas' as const, rotulo: 'Conversas', total: conversas.total }] : []),
  ];
  const atual = abas.some((item) => item.id === aba) ? aba : 'info';
  // Contagens do que o texto desenha (J107), como a biblioteca: sem rejeitadas, ocultas nem a IA sem função.
  const noTexto = snapshot.marcas.filter(grifoNoTexto);
  // Por função no modo de cada grifo (J138): a mesma chave em dois modos são duas linhas.
  const marcasPorFuncao = [...new Set(noTexto.filter((marca) => marca.funcao !== 'nenhuma').map(chaveDaFuncaoDaMarca))];
  return <aside className="painel-do-leitor" style={{ position: 'fixed' }} aria-label="Painel do documento">
    <header className="painel-leitor-cabeca">
      <div ref={cabeca} role="tablist" aria-label="Documento" onKeyDown={(evento) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evento.key)) return;
        evento.preventDefault(); evento.stopPropagation();
        const indice = abas.findIndex((item) => item.id === atual);
        const proxima = evento.key === 'Home' ? 0 : evento.key === 'End' ? abas.length - 1 : (indice + (evento.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length;
        mudarAba(abas[proxima]!.id);
        cabeca.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[proxima]?.focus();
      }}>
        {abas.map((item) => <Button variante="ghost" key={item.id} role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-conteudo`} aria-selected={atual === item.id} tabIndex={atual === item.id ? 0 : -1} onClick={() => mudarAba(item.id)}>
          {item.rotulo}{item.total !== undefined && <span className="painel-leitor-contador">{item.total}</span>}
        </Button>)}
      </div>
      <IconButton aria-label="Fechar painel do documento" onClick={aoFechar}><Icon name="painel-direito" size={18} /></IconButton>
    </header>
    <div className="painel-leitor-conteudo" role="tabpanel" id={`${id}-conteudo`} aria-labelledby={`${id}-${atual}`} tabIndex={0}>
      {atual === 'info' && <>
        <h2>{tituloDocumento ?? snapshot.secao.titulo}</h2>
        {autor && <p className="painel-leitor-autor">{autor}</p>}
        <h3>Metadados</h3>
        <dl className="painel-leitor-metadados">
          {tipo && <><dt>Tipo</dt><dd><TipoDoDocumento {...tipo} /></dd></>}
          <dt>Capítulo</dt><dd>{snapshot.secao.titulo}</dd>
          <dt>Leitura</dt><dd>{minutosDeLeitura(snapshot.blocos.map((bloco) => bloco.texto))} min</dd>
          {snapshot.formato && <><dt>Formato</dt><dd>{snapshot.formato.toUpperCase()}</dd></>}
          <dt>Marcas</dt><dd>{noTexto.length}</dd>
        </dl>
        {marcasPorFuncao.length > 0 && <><h3>Marcas por função</h3>
          <ul className="painel-leitor-funcoes">{marcasPorFuncao.map((funcao) => {
            const marcas = noTexto.filter((marca) => chaveDaFuncaoDaMarca(marca) === funcao);
            return <li key={funcao}><span className="painel-leitor-ponto" style={{ backgroundColor: daMarca(marcas[0]!) }} /><span>{rotuloDaMarca(marcas[0]!)}</span><span>{marcas.length}</span></li>;
          })}</ul></>}
        {infoExtra && <div className="painel-leitor-info-extra">{infoExtra}</div>}
      </>}
      {atual === 'caderno' && <>
        <div className="caderno-filtro">
          <Select aria-label="Mostrar no caderno" className="caderno-seletor" value={valorDoFiltro} onChange={(evento) => escolherFiltro(evento.target.value)}>
            <option value="tudo">{`Tudo (${String(itens.length)})`}</option>
            {tiposPresentes.length > 1 && tiposPresentes.map((t) => <option key={t} value={`t:${t}`}>{`${ROTULOS_DOS_TIPOS[t]} (${String(itens.filter((item) => item.tipo === t).length)})`}</option>)}
            {(filtro?.opcoes ?? []).map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
          </Select>
          {filtros}
          {aoPercorrer && itens.some((item) => item.tipo === 'grifo' || item.tipo === 'relacao') && <IconButton icone="percorrer" className="botao-percorrer" aria-label="Percorrer grifos e relações" title="Percorrer grifos e relações" onClick={aoPercorrer} />}
        </div>
        {visiveis.length === 0 && <p className="painel-leitor-vazio">{itens.length === 0 ? 'Os grifos, as notas e o que você produzir neste capítulo aparecerão aqui.' : 'Nada com esses filtros.'}</p>}
        <ol className="painel-leitor-notas">{visiveis.map((item) => {
          if (item.marca) {
            const marca = item.marca;
            const numero = numeros.get(marca.id);
            return <li key={item.id} data-tipo="grifo" style={{ '--cor-nota': daMarca(marca) } as CSSProperties}>
              <Button variante="ghost" className="painel-leitor-trecho" aria-pressed={fixada === marca.id} onClick={() => aoIr(marca.id, marca.ancora)}>
                <span className="painel-leitor-rotulo"><span className="painel-leitor-ponto" style={{ backgroundColor: daMarca(marca) }} />{numero !== undefined && <span className="painel-leitor-numero">{numero}</span>}{rotuloDaMarca(marca)}{marca.origem === 'manual' ? ' · seu' : ''}</span>
                <span className="painel-leitor-citacao">{marca.ancora.citacao}</span>
                {marca.comentario && <span className="painel-leitor-comentario">{marca.comentario.texto}</span>}
              </Button>
            </li>;
          }
          if (item.pessoal) {
            const pessoal = item.pessoal;
            return <li key={item.id} data-tipo="nota" style={{ '--cor-nota': 'var(--texto-3)' } as CSSProperties}>
              <Button variante="ghost" className="painel-leitor-trecho" aria-pressed={fixada === pessoal.id} onClick={() => (pessoal.aoAbrir ? pessoal.aoAbrir() : aoIr(pessoal.id, pessoal.ancora))}>
                <span className="painel-leitor-rotulo"><Icon name="nota-adesiva" size={14} />{pessoal.resumo === undefined ? 'Conversa e conexões' : 'Nota'}</span>
                <span className="painel-leitor-citacao">{pessoal.ancora.citacao}</span>
                {pessoal.resumo !== undefined && <span className="painel-leitor-comentario">{pessoal.resumo}</span>}
              </Button>
            </li>;
          }
          const extra = item.extra;
          return <li key={item.id} data-tipo={extra.tipo} style={{ '--cor-nota': extra.cor ?? 'var(--texto-3)' } as CSSProperties}>
            <Button variante="ghost" className="painel-leitor-trecho" aria-label={extra.rotulo} onClick={extra.aoAbrir}>{extra.conteudo}</Button>
          </li>;
        })}</ol>
      </>}
      {atual === 'estudo' && <div className="estudo-do-painel">
        {estudoTopo}
        {GRUPOS_DO_ESTUDO.map((grupo) => {
          const doGrupo = estudo.filter((acao) => (acao.grupo ?? 'Ver') === grupo);
          return doGrupo.length > 0 && <section key={grupo} aria-label={grupo}><h3>{grupo}</h3>
            <ul className="lista-de-estudo">{doGrupo.map((acao) => <li key={acao.id}>
              <Button variante="ghost" tamanho="md" className="acao-de-estudo" aria-pressed={acao.ativa ?? undefined} disabled={acao.desabilitada} onClick={acao.executar}>
                <Icon name={acao.icone} size={18} /><span className="acao-rotulo">{acao.rotulo}</span>{acao.detalhe && <span className="acao-detalhe">{acao.detalhe}</span>}
              </Button>
            </li>)}</ul></section>;
        })}
      </div>}
      {atual === 'conversas' && conversas?.conteudo}
    </div>
  </aside>;
}
