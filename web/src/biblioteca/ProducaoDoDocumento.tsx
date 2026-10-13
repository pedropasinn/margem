/**
 * Tudo o que o Margem produziu num documento (Player v2, etapa 8): a página do documento como painel de
 * controle. Junta, capítulo a capítulo, pelas mesmas rotas de leitura que o leitor usa (sem rota nova nem
 * migração): grifos por função, relações, notas e conversas, exercícios resolvidos (com a miniatura do
 * recorte), imagens e quadros, fluxogramas e o progresso de cada capítulo. Cada item leva ao ponto certo
 * no leitor (`gravarIntencao`). Só leitura: nada aqui escreve.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { AncoraV1, VisualV1 } from '@margem/contratos';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Primitives';
import { ContextoDosModos, usarFuncoes } from '../leitor/ContextoDosModos';
import { grifoNoTexto, type CamadaResumida } from '../leitor/f2';
import { listarVisuais, urlDaImagem } from '../leitor/visuais/api';
import { TextoComMatematica } from '../leitor/resolucao/Matematica';
import { corDaRelacao } from '../leitor/compreensao/cores';
import { ROTULO_DA_RELACAO } from '../leitor/compreensao/rotulos';
import { pedirFlashcardsComAviso } from '../flashcards/api';
import { capituloDaVersao, obterModos, relacoesDoCapitulo, resolucoesDoDocumento, type RelacaoDoCapitulo, type SessaoDaApi } from './api';
import { gravarIntencao, type IntencaoDeLeitura } from './intencao';
import type { Rota } from './rotas';
import type { DetalheDoDocumento, SnapshotDoCapitulo } from './tipos';

interface DoCapitulo { secao: { id: string; titulo: string }; snapshot: SnapshotDoCapitulo | null; relacoes: RelacaoDoCapitulo[]; visuais: VisualV1[] }

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
const cortar = (texto: string, n = 160) => (texto.length > n ? `${texto.slice(0, n).trimEnd()}…` : texto);

export function ProducaoDoDocumento({ documento, capitulos, concluidos, camadas, ir, fontes = FONTES }: {
  documento: DetalheDoDocumento; capitulos: readonly { id: string; titulo: string }[]; concluidos: ReadonlySet<string>;
  camadas: readonly CamadaResumida[]; ir: (destino: Rota) => void; fontes?: FontesDaProducao;
}): ReactNode {
  const [dados, definirDados] = useState<DoCapitulo[] | null>(null);
  const [resolucoes, definirResolucoes] = useState<SessaoDaApi[]>([]);
  const [modos, definirModos] = useState<Awaited<ReturnType<typeof obterModos>>['modos']>([]);
  const compreensao = camadas.find((camada) => camada.compreensao === true)?.id ?? null;
  const versaoId = documento.versao_id;
  const chave = capitulos.map((c) => c.id).join(',');
  useEffect(() => {
    if (!versaoId || capitulos.length === 0) return;
    let vivo = true;
    void fontes.modos().then((r) => { if (vivo) definirModos(r.modos ?? []); }, () => undefined);
    void fontes.resolucoes(documento.id).then((r) => { if (vivo) definirResolucoes(r.resolucoes ?? []); }, () => undefined);
    void emLotes(capitulos, async (secao): Promise<DoCapitulo> => {
      const [snapshot, relacoes, visuais] = await Promise.all([
        fontes.capitulo(versaoId, secao.id).then((c) => (Array.isArray(c.blocos) ? c : null), () => null),
        compreensao ? fontes.relacoes(compreensao, secao.id, 'todas').then((r) => r.relacoes ?? [], () => []) : Promise.resolve([]),
        fontes.visuais(versaoId, secao.id).then((r) => r.visuais ?? [], () => []),
      ]);
      return { secao, snapshot, relacoes, visuais };
    }).then((lista) => { if (vivo) definirDados(lista); });
    return () => { vivo = false; };
  }, [versaoId, chave, compreensao, documento.id, fontes]);

  if (!versaoId || capitulos.length === 0) return null;
  if (!dados) return <section className="card producao-carregando" role="status" aria-label="O que o Margem produziu"><span className="eyebrow">O que o Margem produziu</span><p className="dados">Juntando os capítulos…</p></section>;
  return <ContextoDosModos modos={modos}><Producao documento={documento} dados={dados} resolucoes={resolucoes} concluidos={concluidos} ir={ir} /></ContextoDosModos>;
}

function Producao({ documento, dados, resolucoes, concluidos, ir }: { documento: DetalheDoDocumento; dados: DoCapitulo[]; resolucoes: SessaoDaApi[]; concluidos: ReadonlySet<string>; ir: (destino: Rota) => void }): ReactNode {
  const { funcoes, daMarca } = usarFuncoes();
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
    // A lista de cada capítulo vem com filtro=todas, na ordem do modelo: a posição dá a mesma cor do braquete.
    const relacoes = dados.flatMap((d) => d.relacoes.map((r, indice) => ({ secao: d.secao.id, r, cor: corDaRelacao(indice) })));
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
  const mais = (id: string, total: number) => total > PREVIA && <Button variante="ghost" className="ver-todos" onClick={() => abrir((atual) => { const nova = new Set(atual); if (nova.has(id)) nova.delete(id); else nova.add(id); return nova; })}>
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
  const contagens: [string, number, string][] = [['Grifos', agregado.grifos.length, 'grifo'], ['Relações', agregado.relacoes.length, 'relacao'], ['Notas', agregado.notas.length, 'nota-adesiva'],
    ['Conversas', agregado.conversas.length, 'conversas'], ['Exercícios', exercicios.length, 'resolver'], ['Imagens', agregado.imagens.length, 'imagem'], ['Fluxogramas', agregado.fluxogramas.length, 'fluxograma']];
  const produzido = contagens.filter(([, total]) => total > 0);
  const resumo = <section className="card producao-resumo" aria-label="O que o Margem produziu">
      <span className="eyebrow">O que o Margem produziu</span>
      {produzido.length > 0
        ? <ul className="contagens-da-producao">{produzido.map(([rotulo, total, icone]) => <li key={rotulo}><Icon name={icone} size={16} /><span>{rotulo}</span><strong>{total}</strong></li>)}</ul>
        : <p className="dados">Nada ainda. Prepare a leitura para o Margem marcar o texto.</p>}
    </section>;
  return <div className="producao-do-documento">
    <div className="producao-principal">
    {dados.length > 1 && <section className="card capitulos-do-documento" aria-label="Capítulos">
      <div className="cabeca-da-secao"><h2>Capítulos</h2><span className="dados">{concluidos.size} de {dados.length} lidos</span></div>
      <ul className="session-list lista-de-capitulos">{dados.map((d, posicao) => {
        const lido = concluidos.has(d.secao.id);
        const grifos = agregado.grifos.filter((g) => g.secao === d.secao.id).length;
        const relacoes = d.relacoes.length;
        return <li key={d.secao.id}>
          <span className={lido ? 'session-dot done' : 'session-dot'} aria-hidden="true">{lido ? <Icon name="check" size={16} /> : posicao + 1}</span>
          <a className="titulo" href={`/ler/${documento.id}/${d.secao.id}`} onClick={(e) => { e.preventDefault(); ir({ nome: 'leitura', documento_id: documento.id, secao_id: d.secao.id }); }}>{d.secao.titulo}</a>
          <span className="linha-meta">{grifos > 0 && <span>{grifos} grifos</span>}{relacoes > 0 && <span>{relacoes} relações</span>}</span>
          {relacoes > 0 && <Button variante="ghost" className="acao-do-capitulo" onClick={() => abrirNoLeitor({ secao_id: d.secao.id, acao: 'mapa' })}><Icon name="mapa" size={16} />Mapa</Button>}
          <Button variante="ghost" className="acao-do-capitulo" disabled={flashcards[d.secao.id] !== undefined} title={flashcards[d.secao.id] ?? 'Criar flashcards deste capítulo (Codex)'}
            aria-label={`Criar flashcards de ${d.secao.titulo}`} onClick={() => pedirCartoes(d.secao.id)}><Icon name="cartoes" size={16} />{flashcards[d.secao.id] === undefined ? 'Flashcards' : 'Criando…'}</Button>
          <Icon name="chevron" size={18} />
        </li>;
      })}</ul>
    </section>}

    {porFuncao.length > 0 && <section className="card" aria-label="Grifos">
      <div className="cabeca-da-secao"><h2>Grifos</h2><span className="dados">{agregado.grifos.length}</span></div>
      <div className="chips" role="group" aria-label="Grifos por função">{porFuncao.map((f) => <button key={f.chave} type="button" className="chip chip-funcao" aria-pressed={funcaoAtual === f.chave}
        style={{ '--cor-chip': daMarca(f.itens[0]!.marca) } as CSSProperties} onClick={() => escolherFuncao(f.chave)}><span className="chip-ponto" aria-hidden="true" />{f.rotulo}<span className="chip-conta">{f.itens.length}</span></button>)}</div>
      <ul className="lista-da-producao">{corte(`grifos-${funcaoAtual ?? ''}`, porFuncao.find((f) => f.chave === funcaoAtual)?.itens ?? []).map(({ secao, marca }) => <li key={marca.id}>
        {trecho(secao, marca.ancora, <>{marca.comentario?.rotulo ?? (marca.origem === 'manual' ? 'Seu grifo' : 'Grifo')}</>, marca.comentario ? <span className="item-producao-texto">{cortar(marca.comentario.texto, 220)}</span> : undefined, daMarca(marca))}
      </li>)}</ul>
      {mais(`grifos-${funcaoAtual ?? ''}`, porFuncao.find((f) => f.chave === funcaoAtual)?.itens.length ?? 0)}
    </section>}

    {agregado.relacoes.length > 0 && <section className="card" aria-label="Relações">
      <div className="cabeca-da-secao"><h2>Relações</h2><span className="dados">{agregado.relacoes.length}</span></div>
      <ul className="lista-da-producao">{corte('relacoes', agregado.relacoes).map(({ secao, r, cor }) => {
        const ancora = r.origem?.ancoras[0];
        return ancora ? <li key={r.relacao.id}>{trecho(secao, ancora, <>{ROTULO_DA_RELACAO[r.relacao.tipo]}{r.relacao.retrospectiva ? ' · retrospectiva' : ''}</>, <><span className="item-producao-destino">↳ {cortar(r.destino?.ancoras[0]?.citacao ?? '', 120)}</span><span className="item-producao-texto">{cortar(r.relacao.explicacao, 200)}</span></>, cor)}</li> : null;
      })}</ul>
      {mais('relacoes', agregado.relacoes.length)}
    </section>}

    {(agregado.notas.length > 0 || agregado.conversas.length > 0) && <section className="card" aria-label="Notas e conversas">
      <div className="cabeca-da-secao"><h2>Notas e conversas</h2><span className="dados">{agregado.notas.length + agregado.conversas.length}</span></div>
      <ul className="lista-da-producao">
        {corte('notas', agregado.notas).map(({ secao, a }) => <li key={a.id}>{trecho(secao, a.ancora, <><Icon name="nota-adesiva" size={14} /> Sua nota</>, <span className="item-producao-texto">{cortar(a.texto, 220)}</span>)}</li>)}
        {corte('conversas', agregado.conversas).map(({ secao, c }) => <li key={c.id}>{trecho(secao, c.ancora, <><Icon name="conversas" size={14} /> Conversa · {c.mensagens} mensagens</>)}</li>)}
      </ul>
      {mais('notas', agregado.notas.length)}{mais('conversas', agregado.conversas.length)}
    </section>}

    {exercicios.length > 0 && <section className="card" aria-label="Exercícios resolvidos">
      <div className="cabeca-da-secao"><h2>Exercícios resolvidos</h2><span className="dados">{exercicios.length}</span></div>
      <ul className="grade-da-producao">{corte('exercicios', exercicios).map(({ resolucao, estado }) => {
        const origem = resolucao.origem;
        const secao = origem.tipo === 'recorte' ? secaoDaPagina(origem.pagina) : secaoDoBloco(origem.ancora.bloco_id);
        return <li key={resolucao.id}><button type="button" className="miniatura-da-producao" onClick={() => abrirNoLeitor({ secao_id: secao, resolucao: resolucao.id, ...(origem.tipo === 'recorte' ? { pagina: origem.pagina } : { ancora: origem.ancora }) })}>
          {origem.tipo === 'recorte' ? <img src={`/api/resolucoes/${resolucao.id}/imagem`} alt="" loading="lazy" /> : <span className="item-producao-citacao">{cortar(origem.ancora.citacao, 120)}</span>}
          <span className="item-producao-rotulo">{origem.tipo === 'recorte' ? `p. ${String(origem.pagina)}` : 'trecho'}{estado !== 'pronta' ? ` · ${estado === 'falhou' ? 'falhou' : estado === 'pendente' ? 'a resolver' : 'resolvendo…'}` : ''}</span>
          {resolucao.resolucao?.enunciado && <span className="item-producao-texto"><TextoComMatematica texto={cortar(resolucao.resolucao.enunciado, 120)} /></span>}
        </button></li>;
      })}</ul>
      {mais('exercicios', exercicios.length)}
    </section>}

    {(agregado.imagens.length > 0 || agregado.fluxogramas.length > 0) && <section className="card" aria-label="Imagens, quadros e fluxogramas">
      <div className="cabeca-da-secao"><h2>Imagens, quadros e fluxogramas</h2><span className="dados">{agregado.imagens.length + agregado.fluxogramas.length}</span></div>
      <ul className="grade-da-producao">{corte('visuais', [...agregado.imagens, ...agregado.fluxogramas]).map(({ secao, v }) => <li key={v.id}>
        <button type="button" className="miniatura-da-producao" onClick={() => abrirNoLeitor({ secao_id: secao, visual: v.id, ...(v.alvo.tipo === 'capitulo' ? {} : { ancora: v.alvo.ancora }) })}>
          {v.tipo === 'imagem' && v.estado === 'pronto' ? <img src={urlDaImagem(v.id)} alt="" loading="lazy" /> : <span className="icone-da-miniatura"><Icon name={v.tipo === 'imagem' ? 'imagem' : 'fluxograma'} size={28} /></span>}
          <span className="item-producao-rotulo">{v.tipo === 'imagem' ? (v.alvo.tipo === 'capitulo' ? 'Quadro' : 'Imagem') : 'Fluxograma'} · {titulo(secao)}</span>
        </button>
      </li>)}</ul>
      {mais('visuais', agregado.imagens.length + agregado.fluxogramas.length)}
    </section>}
    </div>
    <aside className="producao-lateral">{resumo}</aside>
  </div>;
}
