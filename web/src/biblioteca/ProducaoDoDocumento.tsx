/**
 * Tudo o que o Margem produziu num documento (Player v2, etapa 8): a página do documento como painel de
 * controle. Junta, capítulo a capítulo, pelas mesmas rotas de leitura que o leitor usa (sem rota nova nem
 * migração): grifos por função, relações, notas e conversas, exercícios resolvidos (com a miniatura do
 * recorte), imagens e quadros, fluxogramas e o progresso de cada capítulo. Cada item leva ao ponto certo
 * no leitor (`gravarIntencao`). V-T8: cada item (grifo, relação, nota, exercício, imagem) e a análise de
 * cada capítulo podem ser apagados daqui, sempre com a confirmação do que sai.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { AncoraV1, VisualV1 } from '@margem/contratos';
import { Icon } from '../ui/Icon';
import { Button, Chip, IconButton } from '../ui/Primitives';
import { ContextoDosModos, usarFuncoes } from '../leitor/ContextoDosModos';
import { grifoNoTexto, type CamadaResumida } from '../leitor/f2';
import { listarVisuais, urlDaImagem } from '../leitor/visuais/api';
import { TextoComMatematica } from '../leitor/resolucao/Matematica';
import { corDaRelacao } from '../leitor/compreensao/cores';
import { ROTULO_DA_RELACAO } from '../leitor/compreensao/rotulos';
import { pedirFlashcardsComAviso } from '../flashcards/api';
import {
  capituloDaVersao, obterModos, relacoesDoCapitulo, resolucoesDoDocumento, type EstadoVisivelDaCompreensao, type RelacaoDoCapitulo, type SessaoDaApi,
  type SituacaoDaPreparacao,
} from './api';
import { gravarIntencao, type IntencaoDeLeitura } from './intencao';
import { apagarAnotacao, removerResolucao } from './api';
import { apagarVisual } from '../leitor/visuais/api';
import { ConfirmarApagar } from '../apagar/ConfirmarApagar';
import { JanelaDeApagarEmLote } from '../apagar/NoDocumento';
import { apagarGrifoDeQualquerUm, apagarItemDaAnalise } from '../apagar/api';
import type { Rota } from './rotas';
import type { DetalheDoDocumento, SnapshotDoCapitulo } from './tipos';

/**
 * `relacoes` é `null` quando o capítulo não tem modelo (não preparado, preparando ou falhou): a página
 * diz isso, em vez de mostrar "0 relações". `preparo` é o estado da compreensão do capítulo.
 */
interface DoCapitulo {
  secao: { id: string; titulo: string }; snapshot: SnapshotDoCapitulo | null; relacoes: RelacaoDoCapitulo[] | null; visuais: VisualV1[];
  preparo: EstadoVisivelDaCompreensao | null;
}

export interface FontesDaProducao {
  capitulo: typeof capituloDaVersao;
  relacoes: typeof relacoesDoCapitulo;
  visuais: typeof listarVisuais;
  resolucoes: typeof resolucoesDoDocumento;
  modos: typeof obterModos;
}
const FONTES: FontesDaProducao = { capitulo: capituloDaVersao, relacoes: relacoesDoCapitulo, visuais: listarVisuais, resolucoes: resolucoesDoDocumento, modos: obterModos };

/** Poucas leituras de cada vez: um livro de 40 capítulos não dispara 120 pedidos juntos. */
async function emLotes<T, R>(itens: readonly T[], fazer: (item: T) => Promise<R>, simultaneos = 4): Promise<R[]> {
  const saida: R[] = new Array<R>(itens.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(simultaneos, itens.length) }, async () => {
    while (proximo < itens.length) { const i = proximo++; saida[i] = await fazer(itens[i]!); }
  }));
  return saida;
}

const PREVIA = 6;
/** Capítulo sem modelo ainda: o estado da preparação, nunca "0 relações". */
const FRASE_DO_PREPARO: Record<EstadoVisivelDaCompreensao, string> = {
  nao_preparado: 'não preparado', preparando: 'preparando…', pronto: '', falhou: 'a preparação falhou',
};
const cortar = (texto: string, n = 160) => (texto.length > n ? `${texto.slice(0, n).trimEnd()}…` : texto);

export function ProducaoDoDocumento({ documento, capitulos, concluidos, camadas, ir, fontes = FONTES, preparacao = null }: {
  documento: DetalheDoDocumento; capitulos: readonly { id: string; titulo: string }[]; concluidos: ReadonlySet<string>;
  camadas: readonly CamadaResumida[]; ir: (destino: Rota) => void; fontes?: FontesDaProducao;
  /** Estado da preparação (`GET /api/documentos/:id/preparacao`): a compreensão vigente e cada capítulo. */
  preparacao?: SituacaoDaPreparacao | null;
}): ReactNode {
  const [dados, definirDados] = useState<DoCapitulo[] | null>(null);
  const [resolucoes, definirResolucoes] = useState<SessaoDaApi[]>([]);
  const [modos, definirModos] = useState<Awaited<ReturnType<typeof obterModos>>['modos']>([]);
  // Algo foi apagado daqui: a página relê os capítulos.
  const [rodada, novaRodada] = useState(0);
  // A compreensão da camada padrão (a que a preparação acompanha); sem estado, a mais recente.
  const compreensao = preparacao?.compreensao?.id ?? camadas.find((camada) => camada.compreensao === true)?.id ?? null;
  const preparoDe = (secao: string): EstadoVisivelDaCompreensao | null =>
    preparacao ? preparacao.capitulos.find((capitulo) => capitulo.secao_id === secao)?.estado ?? null : null;
  const chaveDoPreparo = preparacao ? preparacao.capitulos.map((capitulo) => `${capitulo.secao_id}:${capitulo.estado}`).join(',') : '';
  const versaoId = documento.versao_id;
  const chave = capitulos.map((c) => c.id).join(',');
  useEffect(() => {
    if (!versaoId || capitulos.length === 0) return;
    let vivo = true;
    void fontes.modos().then((r) => { if (vivo) definirModos(r.modos ?? []); }, () => undefined);
    void fontes.resolucoes(documento.id).then((r) => { if (vivo) definirResolucoes(r.resolucoes ?? []); }, () => undefined);
    void emLotes(capitulos, async (secao): Promise<DoCapitulo> => {
      const preparo = preparoDe(secao.id);
      // Só pede relações de capítulo com modelo; o 409 "capítulo não preparado" não vira lista vazia.
      const comModelo = compreensao !== null && (preparo === null || preparo === 'pronto');
      const [snapshot, relacoes, visuais] = await Promise.all([
        fontes.capitulo(versaoId, secao.id).then((c) => (Array.isArray(c.blocos) ? c : null), () => null),
        comModelo ? fontes.relacoes(compreensao, secao.id, 'todas').then((r) => r.relacoes ?? [], () => null) : Promise.resolve(null),
        fontes.visuais(versaoId, secao.id).then((r) => r.visuais ?? [], () => []),
      ]);
      return { secao, snapshot, relacoes, visuais, preparo };
    }).then((lista) => { if (vivo) definirDados(lista); });
    return () => { vivo = false; };
    // `chaveDoPreparo` resume `preparacao`: um capítulo que fica pronto refaz a leitura.
  }, [versaoId, chave, compreensao, documento.id, fontes, chaveDoPreparo, rodada]);

  if (!versaoId || capitulos.length === 0) return null;
  if (!dados) return <section className="card producao-carregando" role="status" aria-label="O que o Margem produziu"><span className="eyebrow">O que o Margem produziu</span><p className="dados">Juntando os capítulos…</p></section>;
  return <ContextoDosModos modos={modos}><Producao documento={documento} dados={dados} resolucoes={resolucoes} concluidos={concluidos} ir={ir}
    compreensao={compreensao} aoApagar={() => novaRodada((atual) => atual + 1)} /></ContextoDosModos>;
}

interface PedidoDeApagar { titulo: string; itens: string[]; texto: string; acao: () => Promise<unknown> }

/** O botão de apagar ao lado de um item da lista (o item continua sendo um botão que abre o leitor). */
function BotaoDeApagar({ rotulo, aoClicar }: { rotulo: string; aoClicar: () => void }): ReactNode {
  return <IconButton tamanho="sm" className="apagar-item" aria-label={rotulo} title={rotulo} onClick={aoClicar}><Icon name="lixeira" size={16} /></IconButton>;
}

function Producao({ documento, dados, resolucoes, concluidos, ir, compreensao = null, aoApagar = () => undefined }: {
  documento: DetalheDoDocumento; dados: DoCapitulo[]; resolucoes: SessaoDaApi[]; concluidos: ReadonlySet<string>; ir: (destino: Rota) => void;
  compreensao?: string | null; aoApagar?: () => void;
}): ReactNode {
  const { funcoes, daMarca } = usarFuncoes();
  const [apagando, pedirApagar] = useState<PedidoDeApagar | null>(null);
  const [capituloParaApagar, apagarCapitulo] = useState<{ id: string; titulo: string } | null>(null);
  const citacao = (texto: string) => `“${cortar(texto, 90)}”`;
  const [abertas, abrir] = useState<Set<string>>(new Set());
  // Flashcards pedidos ao Codex nesta visita: o botão do capítulo vira "Criando…" (ou mostra o motivo).
  const [flashcards, marcarFlashcards] = useState<Record<string, string>>({});
  const pedirCartoes = (secao: string) => {
    if (!documento.versao_id) return;
    marcarFlashcards((atual) => ({ ...atual, [secao]: 'Pedindo…' }));
    void pedirFlashcardsComAviso(documento.versao_id, secao).then((aviso) => marcarFlashcards((atual) => ({ ...atual, [secao]: aviso })));
  };
  const abrirNoLeitor = (intencao: Omit<IntencaoDeLeitura, 'documento_id'>) => {
    gravarIntencao({ documento_id: documento.id, ...intencao });
    ir({ nome: 'leitura', documento_id: documento.id, secao_id: intencao.secao_id });
  };
  const titulo = (secao: string) => dados.find((d) => d.secao.id === secao)?.secao.titulo ?? '';
  const agregado = useMemo(() => {
    const grifos = dados.flatMap((d) => (d.snapshot?.marcas ?? []).filter(grifoNoTexto).map((marca) => ({ secao: d.secao.id, marca })));
    // A cor vem do id da relação: a mesma do braquete no leitor.
    const relacoes = dados.flatMap((d) => (d.relacoes ?? []).map((r) => ({ secao: d.secao.id, r, cor: corDaRelacao(r.relacao.id) })));
    const notas = dados.flatMap((d) => (d.snapshot?.anotacoes ?? []).map((a) => ({ secao: d.secao.id, a })));
    const conversas = dados.flatMap((d) => (d.snapshot?.conversas ?? []).map((c) => ({ secao: d.secao.id, c })));
    const visuais = dados.flatMap((d) => d.visuais.filter((v) => !v.substitui || !d.visuais.some((o) => o.substitui === v.id)).map((v) => ({ secao: d.secao.id, v })));
    return { grifos, relacoes, notas, conversas, imagens: visuais.filter((x) => x.v.tipo === 'imagem'), fluxogramas: visuais.filter((x) => x.v.tipo !== 'imagem') };
  }, [dados]);
  const secaoDaPagina = (pagina: number) => dados.find((d) => d.snapshot?.paginas && pagina >= d.snapshot.paginas.inicio && pagina <= d.snapshot.paginas.fim)?.secao.id ?? dados[0]!.secao.id;
  const secaoDoBloco = (bloco: string) => dados.find((d) => d.snapshot?.blocos.some((b) => b.id === bloco))?.secao.id ?? dados[0]!.secao.id;
  const porFuncao = [...new Set(agregado.grifos.map((g) => g.marca.funcao))].map((chave) => ({
    chave, rotulo: chave === 'nenhuma' ? 'Grifos seus' : funcoes.find((f) => f.chave === chave)?.rotulo ?? chave,
    itens: agregado.grifos.filter((g) => g.marca.funcao === chave),
  })).sort((a, b) => b.itens.length - a.itens.length);
  const [funcao, escolherFuncao] = useState<string | null>(null);
  const funcaoAtual = funcao ?? porFuncao[0]?.chave ?? null;
  const mais = (id: string, total: number) => total > PREVIA && <Button variante="ghost" tamanho="sm" className="ver-todos" onClick={() => abrir((atual) => { const nova = new Set(atual); if (nova.has(id)) nova.delete(id); else nova.add(id); return nova; })}>
    {abertas.has(id) ? 'Mostrar menos' : `Ver todos (${String(total)})`}</Button>;
  const corte = <T,>(id: string, lista: readonly T[]) => (abertas.has(id) ? lista : lista.slice(0, PREVIA));
  const trecho = (secao: string, ancora: AncoraV1, rotulo: ReactNode, extra?: ReactNode, cor?: string) => <button type="button" className="item-producao" style={cor ? { '--cor-item': cor } as CSSProperties : undefined}
    onClick={() => abrirNoLeitor({ secao_id: secao, ancora })}>
    <span className="item-producao-rotulo">{rotulo}<span className="item-producao-capitulo">{titulo(secao)}</span></span>
    <span className="item-producao-citacao">{cortar(ancora.citacao)}</span>
    {extra}
  </button>;
  // Os pedidos do lote que ainda não foram ao Codex ficam na página de exercícios, não aqui.
  const exercicios = resolucoes.filter((s) => s.estado !== 'pendente').filter((s) => s.resolucao.origem.tipo === 'recorte' || dados.some((d) => d.snapshot?.blocos.some((b) => s.resolucao.origem.tipo === 'trecho' && b.id === s.resolucao.origem.ancora.bloco_id)));
  const contagens: [string, number, string][] = [['Grifos', agregado.grifos.length, 'grifo'], ['Relações da leitura', agregado.relacoes.length, 'relacao'], ['Notas', agregado.notas.length, 'nota-adesiva'],
    ['Conversas', agregado.conversas.length, 'conversas'], ['Exercícios', exercicios.length, 'resolver'], ['Imagens', agregado.imagens.length, 'imagem'], ['Fluxogramas', agregado.fluxogramas.length, 'fluxograma']];
  const produzido = contagens.filter(([, total]) => total > 0);
  const resumo = <section className="card producao-resumo" aria-label="O que o Margem produziu">
      <span className="eyebrow">O que o Margem produziu</span>
      {produzido.length > 0
        ? <ul className="contagens-da-producao">{produzido.map(([rotulo, total, icone]) => <li key={rotulo}><Icon name={icone} size={16} /><span>{rotulo}</span><strong>{total}</strong></li>)}</ul>
        : <p className="dados">Nada ainda.</p>}
    </section>;
  return <div className="producao-do-documento">
    <div className="producao-principal">
    {dados.length > 1 && <section className="card capitulos-do-documento" aria-label="Capítulos">
      <div className="cabeca-da-secao"><h2>Capítulos</h2><span className="dados">{concluidos.size} de {dados.length} lidos</span></div>
      <ul className="session-list lista-de-capitulos">{dados.map((d, posicao) => {
        const lido = concluidos.has(d.secao.id);
        const grifos = agregado.grifos.filter((g) => g.secao === d.secao.id).length;
        const relacoes = d.relacoes?.length ?? 0;
        return <li key={d.secao.id}>
          <span className={lido ? 'session-dot done' : 'session-dot'} aria-hidden="true">{lido ? <Icon name="check" size={16} /> : posicao + 1}</span>
          <a className="titulo" href={`/ler/${documento.id}/${d.secao.id}`} onClick={(e) => { e.preventDefault(); ir({ nome: 'leitura', documento_id: documento.id, secao_id: d.secao.id }); }}>{d.secao.titulo}</a>
          <span className="linha-meta">{grifos > 0 && <span>{grifos} grifos</span>}{d.relacoes !== null
            ? <span>{relacoes === 1 ? '1 relação' : `${String(relacoes)} relações`}</span>
            : d.preparo !== null && <span>{FRASE_DO_PREPARO[d.preparo]}</span>}</span>
          {relacoes > 0 && <Button variante="ghost" tamanho="sm" className="acao-do-capitulo" onClick={() => abrirNoLeitor({ secao_id: d.secao.id, acao: 'mapa' })}><Icon name="mapa" size={16} />Mapa</Button>}
          <Button variante="ghost" tamanho="sm" className="acao-do-capitulo" disabled={flashcards[d.secao.id] !== undefined} title={flashcards[d.secao.id] ?? 'Criar flashcards deste capítulo (Codex)'}
            aria-label={`Criar flashcards de ${d.secao.titulo}`} onClick={() => pedirCartoes(d.secao.id)}><Icon name="cartoes" size={16} />{flashcards[d.secao.id] === undefined ? 'Flashcards' : 'Criando…'}</Button>
          {(grifos > 0 || d.relacoes !== null) && <BotaoDeApagar rotulo={`Apagar a análise de ${d.secao.titulo}`} aoClicar={() => apagarCapitulo(d.secao)} />}
          <Icon name="chevron" size={18} />
        </li>;
      })}</ul>
    </section>}

    {porFuncao.length > 0 && <section className="card" aria-label="Grifos">
      <div className="cabeca-da-secao"><h2>Grifos</h2><span className="dados">{agregado.grifos.length}</span></div>
      <div className="chips" role="group" aria-label="Grifos por função">{porFuncao.map((f) => <Chip key={f.chave} pressionado={funcaoAtual === f.chave}
        cor={daMarca(f.itens[0]!.marca)} conta={f.itens.length} onClick={() => escolherFuncao(f.chave)}>{f.rotulo}</Chip>)}</div>
      <ul className="lista-da-producao">{corte(`grifos-${funcaoAtual ?? ''}`, porFuncao.find((f) => f.chave === funcaoAtual)?.itens ?? []).map(({ secao, marca }) => <li key={marca.id} className="com-apagar">
        {trecho(secao, marca.ancora, <>{marca.comentario?.rotulo ?? (marca.origem === 'manual' ? 'Seu grifo' : 'Grifo')}</>, marca.comentario ? <span className="item-producao-texto">{cortar(marca.comentario.texto, 220)}</span> : undefined, daMarca(marca))}
        <BotaoDeApagar rotulo="Apagar este grifo" aoClicar={() => pedirApagar({
          titulo: 'Apagar este grifo?', itens: [citacao(marca.ancora.citacao)], acao: () => apagarGrifoDeQualquerUm(marca.id),
          texto: marca.origem === 'manual' ? 'O seu grifo sai do texto. As notas presas a ele ficam.' : 'O grifo do Codex sai do texto, com o comentário dele e as relações que partem dele.',
        })} />
      </li>)}</ul>
      {mais(`grifos-${funcaoAtual ?? ''}`, porFuncao.find((f) => f.chave === funcaoAtual)?.itens.length ?? 0)}
    </section>}

    {agregado.relacoes.length > 0 && <section className="card" aria-label="Relações da leitura">
      <div className="cabeca-da-secao"><h2>Relações da leitura</h2><span className="dados">{agregado.relacoes.length}</span></div>
      <ul className="lista-da-producao">{corte('relacoes', agregado.relacoes).map(({ secao, r, cor }) => {
        const ancora = r.origem?.ancoras[0];
        return ancora ? <li key={r.relacao.id} className="com-apagar">{trecho(secao, ancora, <>{ROTULO_DA_RELACAO[r.relacao.tipo]}{r.relacao.retrospectiva ? ' · retrospectiva' : ''}</>, <><span className="item-producao-destino">↳ {cortar(r.destino?.ancoras[0]?.citacao ?? '', 120)}</span><span className="item-producao-texto">{cortar(r.relacao.explicacao, 200)}</span></>, cor)}
          {compreensao !== null && <BotaoDeApagar rotulo="Apagar esta relação" aoClicar={() => pedirApagar({
            titulo: 'Apagar esta relação?', itens: [`${ROTULO_DA_RELACAO[r.relacao.tipo]}: ${citacao(ancora.citacao)}`],
            texto: 'A relação do Codex sai da leitura. Os grifos das duas pontas ficam.', acao: () => apagarItemDaAnalise(compreensao, secao, r.relacao.id),
          })} />}</li> : null;
      })}</ul>
      {mais('relacoes', agregado.relacoes.length)}
    </section>}

    {(agregado.notas.length > 0 || agregado.conversas.length > 0) && <section className="card" aria-label="Notas e conversas">
      <div className="cabeca-da-secao"><h2>Notas e conversas</h2><span className="dados">{agregado.notas.length + agregado.conversas.length}</span></div>
      <ul className="lista-da-producao">
        {corte('notas', agregado.notas).map(({ secao, a }) => <li key={a.id} className="com-apagar">{trecho(secao, a.ancora, <><Icon name="nota-adesiva" size={14} /> Sua nota</>, <span className="item-producao-texto">{cortar(a.texto, 220)}</span>)}
          <BotaoDeApagar rotulo="Apagar esta nota" aoClicar={() => pedirApagar({
            titulo: 'Apagar esta nota?', itens: [cortar(a.texto, 120)], texto: 'A nota sai do texto e das suas notas.', acao: () => apagarAnotacao(a.id, a.revisao_edicao),
          })} /></li>)}
        {corte('conversas', agregado.conversas).map(({ secao, c }) => <li key={c.id}>{trecho(secao, c.ancora, <><Icon name="conversas" size={14} /> Conversa · {c.mensagens} mensagens</>)}</li>)}
      </ul>
      {mais('notas', agregado.notas.length)}{mais('conversas', agregado.conversas.length)}
    </section>}

    {exercicios.length > 0 && <section className="card" aria-label="Exercícios resolvidos">
      <div className="cabeca-da-secao"><h2>Exercícios resolvidos</h2><span className="dados">{exercicios.length}</span></div>
      <ul className="grade-da-producao">{corte('exercicios', exercicios).map(({ resolucao, estado }) => {
        const origem = resolucao.origem;
        const secao = origem.tipo === 'recorte' ? secaoDaPagina(origem.pagina) : secaoDoBloco(origem.ancora.bloco_id);
        return <li key={resolucao.id} className="com-apagar"><button type="button" className="miniatura-da-producao" onClick={() => abrirNoLeitor({ secao_id: secao, resolucao: resolucao.id, ...(origem.tipo === 'recorte' ? { pagina: origem.pagina } : { ancora: origem.ancora }) })}>
          {origem.tipo === 'recorte' ? <img src={`/api/resolucoes/${resolucao.id}/imagem`} alt="" loading="lazy" /> : <span className="item-producao-citacao">{cortar(origem.ancora.citacao, 120)}</span>}
          <span className="item-producao-rotulo">{origem.tipo === 'recorte' ? `p. ${String(origem.pagina)}` : 'trecho'}{estado !== 'pronta' ? ` · ${estado === 'falhou' ? 'falhou' : estado === 'pendente' ? 'a resolver' : 'resolvendo…'}` : ''}</span>
          {resolucao.resolucao?.enunciado && <span className="item-producao-texto"><TextoComMatematica texto={cortar(resolucao.resolucao.enunciado, 120)} /></span>}
        </button>
        <BotaoDeApagar rotulo="Apagar esta resolução" aoClicar={() => pedirApagar({
          titulo: estado === 'pronta' || estado === 'falhou' ? 'Apagar esta resolução?' : 'Cancelar e apagar esta resolução?',
          itens: [origem.tipo === 'recorte' ? `Exercício da p. ${String(origem.pagina)}` : citacao(origem.ancora.citacao)],
          texto: estado === 'pronta' || estado === 'falhou' ? 'A resolução do Codex e as perguntas feitas sobre ela saem.' : 'O Codex para agora e nada desta resolução fica.',
          acao: () => removerResolucao(resolucao.id),
        })} /></li>;
      })}</ul>
      {mais('exercicios', exercicios.length)}
    </section>}

    {(agregado.imagens.length > 0 || agregado.fluxogramas.length > 0) && <section className="card" aria-label="Imagens, quadros e fluxogramas">
      <div className="cabeca-da-secao"><h2>Imagens, quadros e fluxogramas</h2><span className="dados">{agregado.imagens.length + agregado.fluxogramas.length}</span></div>
      <ul className="grade-da-producao">{corte('visuais', [...agregado.imagens, ...agregado.fluxogramas]).map(({ secao, v }) => <li key={v.id} className="com-apagar">
        <button type="button" className="miniatura-da-producao" onClick={() => abrirNoLeitor({ secao_id: secao, visual: v.id, ...(v.alvo.tipo === 'capitulo' ? {} : { ancora: v.alvo.ancora }) })}>
          {v.tipo === 'imagem' && v.estado === 'pronto' ? <img src={urlDaImagem(v.id)} alt="" loading="lazy" /> : <span className="icone-da-miniatura"><Icon name={v.tipo === 'imagem' ? 'imagem' : 'fluxograma'} size={28} /></span>}
          <span className="item-producao-rotulo">{v.tipo === 'imagem' ? (v.alvo.tipo === 'capitulo' ? 'Quadro' : 'Imagem') : 'Fluxograma'} · {titulo(secao)}</span>
        </button>
        <BotaoDeApagar rotulo={v.tipo === 'imagem' ? 'Apagar esta imagem' : 'Apagar este fluxograma'} aoClicar={() => pedirApagar({
          titulo: v.tipo === 'imagem' ? 'Apagar esta imagem?' : 'Apagar este fluxograma?', itens: [`${v.tipo === 'imagem' ? 'Imagem' : 'Fluxograma'} · ${titulo(secao)}`],
          texto: v.estado === 'pronto' || v.estado === 'falhou' ? 'Sai do capítulo e da lista.' : 'O Codex para de desenhar e nada fica.', acao: () => apagarVisual(v.id),
        })} />
      </li>)}</ul>
      {mais('visuais', agregado.imagens.length + agregado.fluxogramas.length)}
    </section>}
    </div>
    <aside className="producao-lateral">{resumo}</aside>
    {apagando && <ConfirmarApagar titulo={apagando.titulo} itens={apagando.itens} texto={apagando.texto} aoFechar={() => pedirApagar(null)}
      aoConfirmar={async () => { await apagando.acao(); aoApagar(); }} />}
    {capituloParaApagar && <JanelaDeApagarEmLote documentoId={documento.id} quem="codex" secaoId={capituloParaApagar.id} tituloDoCapitulo={capituloParaApagar.titulo}
      aoFechar={() => apagarCapitulo(null)} aoApagar={aoApagar} />}
  </div>;
}
