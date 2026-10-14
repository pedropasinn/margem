import { Button, Checkbox, Drawer, Input, Switch } from '../ui/Primitives';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { TiposDeTextoV1 } from '@margem/contratos';
import { AvisoDoCodexCurto } from '../primeira-execucao/PrimeiraExecucao';
import {
  catalogoDaPreparacao, escolherTipoDeTexto, gravarPadraoDaPreparacao, gravarPreferenciasDoDocumento, pedirExercicios, prepararLeitura,
  preferenciasDoDocumento, situacaoDaPreparacao, tiposDeTexto, type CatalogoDaPreparacao, type ItemDaPreparacao, type SituacaoDaPreparacao,
} from './api';

/**
 * "Analisar" (v0.1; antes "Preparar leitura"): o botão principal da página do documento. O serviço cria (ou reaproveita) a compreensão do texto e começa
 * na hora: o texto inteiro, ou o primeiro capítulo com o seguinte em segundo plano. Sempre sai com grifos,
 * relações, dificuldades e plano. Clicar de novo não cobra outra leitura; depois de uma falha, tenta de novo.
 */
export interface FontesDaPreparacao {
  situacao: typeof situacaoDaPreparacao;
  preparar: typeof prepararLeitura;
  /** Catálogo de tipos (do contrato) e a escolha da pessoa; sem elas, as da API. */
  tipos?: typeof tiposDeTexto;
  escolherTipo?: typeof escolherTipoDeTexto;
  /** O que a janela oferece e o padrão; e os exercícios (descoberta + disparo). */
  catalogo?: typeof catalogoDaPreparacao;
  exercicios?: typeof pedirExercicios;
}
export const FONTES_DA_PREPARACAO: FontesDaPreparacao = {
  situacao: situacaoDaPreparacao, preparar: prepararLeitura, tipos: tiposDeTexto, escolherTipo: escolherTipoDeTexto, catalogo: catalogoDaPreparacao, exercicios: pedirExercicios,
};

/** Intervalo entre consultas enquanto a leitura prepara. */
export const INTERVALO_DA_PREPARACAO_MS = 10_000;

export interface Preparacao {
  situacao: SituacaoDaPreparacao | null;
  ocupado: boolean;
  erro: string | null;
  /** Sem `itens`, o que já foi pedido (o "Tentar de novo"). Devolve se deu certo. */
  preparar: (todos?: boolean, itens?: readonly string[]) => Promise<boolean>;
  escolherTipo: (tipoId: string) => Promise<void>;
  recarregar: () => void;
  fontes: FontesDaPreparacao;
}

export function usePreparacao(
  documentoId: string, ativo: boolean, fontes: FontesDaPreparacao = FONTES_DA_PREPARACAO, aoMudar?: () => void, intervaloMs = INTERVALO_DA_PREPARACAO_MS,
): Preparacao {
  const [situacao, definirSituacao] = useState<SituacaoDaPreparacao | null>(null);
  const [ocupado, ocupar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const [rodada, novaRodada] = useState(0);
  const anterior = useRef<string | null>(null);
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;
  // As fontes podem chegar como objeto novo a cada render (testes, chamadores): não reiniciam a consulta.
  const fontesRef = useRef(fontes);
  fontesRef.current = fontes;
  const aplicar = useCallback((nova: SituacaoDaPreparacao | null | undefined) => {
    // Uma resposta fora do formato (serviço antigo) não derruba a página: fica o botão.
    if (typeof nova !== 'object' || nova === null || !Array.isArray(nova.capitulos)) return;
    // A mesma resposta mantém a mesma referência (sem novo render à toa).
    definirSituacao(Array.isArray(nova.itens) ? nova : { ...nova, itens: [] });
    // Cada mudança de estado (um capítulo ficou pronto, falhou…) refaz o que a página mostra.
    const chave = JSON.stringify([nova.estado, nova.capitulos.map((capitulo) => capitulo.estado)]);
    if (anterior.current !== null && anterior.current !== chave) aoMudarRef.current?.();
    anterior.current = chave;
  }, []);
  useEffect(() => {
    if (!ativo) return undefined;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const ciclo = () => {
      fontesRef.current.situacao(documentoId).then((nova) => {
        if (!vivo) return;
        aplicar(nova);
        if (nova?.estado === 'preparando' || nova?.estado === 'identificando') relogio = setTimeout(ciclo, intervaloMs);
      }, () => { /* sem estado: o botão continua disponível */ });
    };
    ciclo();
    return () => { vivo = false; if (relogio !== undefined) clearTimeout(relogio); };
  }, [documentoId, ativo, intervaloMs, rodada, aplicar]);
  const preparar = useCallback(async (todos = false, itens?: readonly string[]) => {
    ocupar(true); definirErro(null);
    try {
      const resposta = await fontesRef.current.preparar(documentoId, todos, itens);
      aplicar(resposta.situacao);
      aoMudarRef.current?.();
      novaRodada((atual) => atual + 1);
      return true;
    } catch (falha) {
      definirErro(falha instanceof Error ? falha.message : 'Não foi possível começar a análise.');
      return false;
    } finally { ocupar(false); }
  }, [documentoId, aplicar]);
  const escolherTipo = useCallback(async (tipoId: string) => {
    ocupar(true); definirErro(null);
    try {
      aplicar(await (fontesRef.current.escolherTipo ?? escolherTipoDeTexto)(documentoId, tipoId));
      aoMudarRef.current?.();
      novaRodada((atual) => atual + 1);
    } catch (falha) {
      definirErro(falha instanceof Error ? falha.message : 'Não foi possível mudar o tipo do texto.');
    } finally { ocupar(false); }
  }, [documentoId, aplicar]);
  const recarregar = useCallback(() => novaRodada((atual) => atual + 1), []);
  return { situacao, ocupado, erro, preparar, escolherTipo, recarregar, fontes };
}

/**
 * O botão principal da página do documento (V-T3): "Analisar" abre a janela do que criar; com a análise
 * pronta, a mesma janela acrescenta o que faltar (flashcards, mapa…). Em andamento, fica desabilitado.
 * `null` só quando ainda não há texto.
 */
export function rotuloDeAnalisar(situacao: SituacaoDaPreparacao | null): { rotulo: string; desabilitado: boolean } | null {
  switch (situacao?.estado) {
    case 'sem_texto': return null;
    case 'falhou': return { rotulo: 'Tentar de novo', desabilitado: false };
    case 'identificando': case 'preparando': return { rotulo: 'Analisando…', desabilitado: true };
    default: return { rotulo: 'Analisar', desabilitado: false };
  }
}

/**
 * O que "Analisar" faz depende do tipo do documento (V-T3): texto e PDF abrem a janela da análise do
 * texto; vídeo tem a análise própria (J142), que entra pelo ponto de extensão `analisar` da página.
 */
export type TipoDeAnalise = 'texto' | 'video';
export function tipoDeAnalise(documento: { midia?: { tipo: string } | null }): TipoDeAnalise {
  return documento.midia?.tipo === 'video' ? 'video' : 'texto';
}

const relacoesDe = (situacao: SituacaoDaPreparacao) => situacao.capitulos.reduce((soma, capitulo) => soma + (capitulo.relacoes ?? 0), 0);
const plural = (n: number, um: string, varios: string) => `${String(n)} ${n === 1 ? um : varios}`;

/**
 * A frase do estado da análise, honesta (nada de "0 relações" para o que ainda não foi analisado) e curta:
 * `null` quando não há o que dizer (ainda não analisado: o botão basta).
 */
export function fraseDaPreparacao(situacao: SituacaoDaPreparacao, textoUnico: boolean): string | null {
  const total = situacao.capitulos.length;
  const prontos = situacao.capitulos.filter((capitulo) => capitulo.estado === 'pronto').length;
  const relacoes = plural(relacoesDe(situacao), 'relação', 'relações');
  switch (situacao.estado) {
    case 'sem_texto': return 'O texto ainda está sendo preparado para leitura.';
    case 'identificando': return 'Reconhecendo o tipo de texto…';
    case 'nao_preparada': return null;
    case 'preparando': return textoUnico || total <= 1 ? 'Analisando o texto…'
      : `Analisando… ${String(prontos)} de ${String(total)} capítulos prontos.`;
    case 'pronta': return `Análise pronta · ${relacoes}.`;
    case 'parcial': return `Análise pronta em ${String(prontos)} de ${String(total)} capítulos · ${relacoes}.`;
    case 'falhou': return `A análise parou: ${situacao.erro?.mensagem ?? 'algo falhou.'}`;
  }
}

const FRASE_DO_ITEM: Record<SituacaoDaPreparacao['itens'][number]['estado'], string> = {
  aguardando: 'espera os capítulos ficarem prontos', preparando: 'preparando', pronto: 'pronto', falhou: 'falhou',
};

/** O estado da preparação no topo do documento: a frase, o andamento de cada item e o tipo, discreto. */
export function EstadoDaPreparacao({ preparacao, textoUnico }: { preparacao: Preparacao; textoUnico: boolean }): ReactNode {
  const { situacao, ocupado, erro, preparar } = preparacao;
  if (situacao === null || situacao.estado === 'sem_texto') return erro ? <p className="aviso" role="alert">{erro}</p> : null;
  const faltam = situacao.capitulos.some((capitulo) => capitulo.estado === 'nao_preparado');
  const livro = !textoUnico && situacao.capitulos.length > 1;
  const comCompreensao = situacao.compreensao !== null || situacao.estado === 'identificando';
  const frase = comCompreensao || situacao.itens.length === 0 ? fraseDaPreparacao(situacao, textoUnico) : null;
  return <div className="estado-da-preparacao" role="status" aria-label="Análise do documento">
    {frase !== null && <p className="dados">{frase}</p>}
    {situacao.tipo && <p className="dados tipo-discreto" title={situacao.tipo.justificativa ?? undefined}>{situacao.tipo.tipo_id === 'outro' ? 'Lido como texto geral' : `Lido como ${situacao.tipo.rotulo.toLocaleLowerCase('pt-BR')}`}</p>}
    {situacao.itens.length > 0 && <ul className="itens-da-preparacao" aria-label="O que está sendo criado">
      {situacao.itens.map((item) => <li key={item.id} data-estado={item.estado}>
        <span>{item.rotulo}</span>
        <span className="dados">{FRASE_DO_ITEM[item.estado]}{item.total > 1 ? ` · ${String(item.prontos)} de ${String(item.total)}` : ''}</span>
      </li>)}
    </ul>}
    {livro && situacao.compreensao !== null && faltam && situacao.estado !== 'falhou' && (
      <Button variante="ghost" tamanho="sm" disabled={ocupado} onClick={() => void preparar(true)}>Analisar todos os capítulos</Button>
    )}
    {situacao.estado !== 'pronta' && <AvisoDoCodexCurto />}
    {erro && <p className="aviso" role="alert">{erro}</p>}
  </div>;
}

/**
 * A janela "Analisar" (v0.1, MV-P04; antes "Preparar leitura"): a pessoa marca o que quer criar de uma vez. Começa com o
 * padrão das Configurações (grifos e relações sempre marcados por padrão). O tipo de texto é do Codex e
 * fica discreto aqui, com "mudar" para quem quiser corrigir.
 */
export function JanelaDaPreparacao({ preparacao, documentoId, textoUnico, aoFechar }: {
  preparacao: Preparacao; documentoId: string; textoUnico: boolean; aoFechar: () => void;
}): ReactNode {
  const { situacao, ocupado, fontes } = preparacao;
  const [catalogo, definirCatalogo] = useState<CatalogoDaPreparacao | null>(null);
  const [marcados, marcar] = useState<Set<string>>(new Set());
  const [todos, definirTodos] = useState(false);
  const [falha, definirFalha] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    (fontes.catalogo ?? catalogoDaPreparacao)().then((resposta) => {
      if (!vivo) return;
      definirCatalogo(resposta);
      marcar(new Set(resposta.padrao.itens));
    }, () => { if (vivo) { definirFalha('Não foi possível carregar as opções; grifos e relações continuam disponíveis.'); marcar(new Set(['grifos_relacoes'])); } });
    return () => { vivo = false; };
  }, [fontes]);
  const itens: ItemDaPreparacao[] = catalogo?.itens ?? [];
  const alternar = (item: ItemDaPreparacao, valor: boolean) => marcar((atual) => {
    const novo = new Set(atual);
    if (valor) { novo.add(item.id); for (const requerido of item.requer) novo.add(requerido); }
    else {
      novo.delete(item.id);
      // Quem requer o item desmarcado sai junto (o mapa precisa de grifos e relações).
      for (const outro of itens) if (outro.requer.includes(item.id)) novo.delete(outro.id);
    }
    return novo;
  });
  const livro = !textoUnico && (situacao?.capitulos.length ?? 0) !== 1;
  // Texto único não tem capítulos: "Mapa do texto", "Cartões de estudo do texto".
  const noTexto = (frase: string) => (livro ? frase : frase.replace(/de cada capítulo/gu, 'do texto').replace(/(^|\s)do capítulo/gu, '$1do texto'));
  async function enviar() {
    definirFalha(null);
    const escolhidos = itens.filter((item) => marcados.has(item.id)).map((item) => item.id);
    const doServico = escolhidos.filter((id) => id !== 'exercicios');
    if (doServico.length > 0 && !await preparacao.preparar(todos, doServico)) return;
    if (escolhidos.includes('exercicios')) {
      try { await (fontes.exercicios ?? pedirExercicios)(documentoId); preparacao.recarregar(); }
      catch (erro) { definirFalha(erro instanceof Error ? `Exercícios: ${erro.message}` : 'Não foi possível pedir os exercícios.'); return; }
    }
    aoFechar();
  }
  return <Drawer rotulo="Analisar" aoFechar={aoFechar}>
    <div className="janela-da-preparacao">
      <TipoDoTexto preparacao={preparacao} />
      {catalogo === null && falha === null && <p className="dados">Carregando…</p>}
      <ul className="opcoes-da-preparacao">{itens.map((item) => <li key={item.id}>
        <Checkbox checked={marcados.has(item.id)} disabled={!item.disponivel || ocupado} onChange={(valor) => alternar(item, valor)}>
          {noTexto(item.rotulo)}{!item.disponivel && <span className="em-breve"> · em breve</span>}
        </Checkbox>
        <p className="dados">{noTexto(item.descricao)}</p>
      </li>)}</ul>
      {livro && <Switch checked={todos} disabled={ocupado} onChange={definirTodos}>Todos os capítulos agora (senão, cada um quando você o abre)</Switch>}
      <AvisoDoCodexCurto />
      {(falha ?? preparacao.erro) && <p className="aviso" role="alert">{falha ?? preparacao.erro}</p>}
      <div className="ui-rodape">
        <Button variante="ghost" tamanho="md" onClick={aoFechar}>Cancelar</Button>
        <Button variante="primario" tamanho="md" disabled={ocupado || marcados.size === 0} onClick={() => void enviar()}>Analisar</Button>
      </div>
    </div>
  </Drawer>;
}

/** Configurações → "Ao importar": o que o Margem cria sozinho quando um arquivo entra na biblioteca. */
const FONTES_DO_PADRAO = { catalogo: catalogoDaPreparacao, gravar: gravarPadraoDaPreparacao };
export function PadraoDaPreparacaoNasConfiguracoes({ fontes = FONTES_DO_PADRAO }: {
  fontes?: { catalogo: typeof catalogoDaPreparacao; gravar: typeof gravarPadraoDaPreparacao };
}): ReactNode {
  const [catalogo, definirCatalogo] = useState<CatalogoDaPreparacao | null>(null);
  const [aviso, avisar] = useState<string | null>(null);
  const [ocupado, ocupar] = useState(false);
  useEffect(() => { fontes.catalogo().then(definirCatalogo, () => avisar('Não foi possível carregar o padrão.')); }, [fontes]);
  async function gravar(padrao: CatalogoDaPreparacao['padrao']) {
    ocupar(true); avisar(null);
    try { definirCatalogo(await fontes.gravar(padrao)); avisar('Salvo.'); }
    catch (erro) { avisar(erro instanceof Error ? erro.message : 'Não foi possível salvar.'); }
    finally { ocupar(false); }
  }
  if (catalogo === null) return <section className="card" aria-label="Ao importar"><h2>Ao importar</h2>{aviso && <p className="dados">{aviso}</p>}</section>;
  const { padrao } = catalogo;
  const alternar = (item: ItemDaPreparacao, valor: boolean) => {
    const itens = new Set(padrao.itens);
    if (valor) { itens.add(item.id); for (const requerido of item.requer) itens.add(requerido); }
    else { itens.delete(item.id); for (const outro of catalogo.itens) if (outro.requer.includes(item.id)) itens.delete(outro.id); }
    void gravar({ ...padrao, itens: catalogo.itens.map((candidato) => candidato.id).filter((id) => itens.has(id)) });
  };
  return <section className="card configuracao-da-preparacao" aria-label="Ao importar">
    <h2>Ao importar</h2>
    <Switch checked={padrao.ao_importar} disabled={ocupado} onChange={(valor) => void gravar({ ...padrao, ao_importar: valor })}>Analisar sozinho quando um arquivo entra</Switch>
    <ul className="opcoes-da-preparacao">{catalogo.itens.filter((item) => item.ao_importar).map((item) => <li key={item.id}>
      <Checkbox checked={padrao.itens.includes(item.id)} disabled={ocupado || !padrao.ao_importar} onChange={(valor) => alternar(item, valor)}>{item.rotulo}</Checkbox>
    </li>)}</ul>
    <p className="dados">O mesmo conjunto vem marcado na janela “Analisar” de cada documento.</p>
    {aviso && <p className="dados">{aviso}</p>}
  </section>;
}

/** "Tipo: Conto (Literatura) · mudar": o tipo detectado ou escolhido, e o seletor agrupado, com busca. */
export function TipoDoTexto({ preparacao }: { preparacao: Preparacao }): ReactNode {
  const { situacao, ocupado, escolherTipo, fontes } = preparacao;
  const [aberto, abrir] = useState(false);
  const [tipos, definirTipos] = useState<TiposDeTextoV1 | null>(null);
  const [busca, buscar] = useState('');
  const [falha, definirFalha] = useState<string | null>(null);
  const idDaBusca = useId();
  useEffect(() => {
    if (!aberto || tipos !== null) return undefined;
    let vivo = true;
    (fontes.tipos ?? tiposDeTexto)().then((resposta) => { if (vivo) definirTipos(resposta.tipos); },
      () => { if (vivo) definirFalha('Não foi possível carregar os tipos de texto.'); });
    return () => { vivo = false; };
  }, [aberto, tipos, fontes]);
  if (situacao === null) return null;
  const tipo = situacao.tipo;
  const duvida = tipo !== null && tipo.origem === 'detectado' && tipo.confianca === 'baixa';
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const casa = (texto: string) => texto.toLocaleLowerCase('pt-BR').includes(termo);
  const grupos = (tipos?.grupos ?? []).map((grupo) => ({ ...grupo, tipos: grupo.tipos.filter((item) => termo === '' || casa(item.rotulo) || casa(item.exemplos) || casa(grupo.rotulo)) }))
    .filter((grupo) => grupo.tipos.length > 0);
  async function escolher(tipoId: string) {
    await escolherTipo(tipoId);
    abrir(false); buscar('');
  }
  return <div className="tipo-do-texto">
    <span className="ui-chip ui-chip-md chip-tipo" title={tipo?.justificativa ?? undefined}>
      {tipo === null
        ? (situacao.estado === 'identificando' ? 'Tipo: reconhecendo…' : 'Tipo: reconhecido ao analisar')
        : <>Tipo: {tipo.rotulo}{duvida ? '?' : ''} <span className="chip-tipo-grupo">{tipo.grupo}</span></>}
    </span>
    <Button variante="ghost" tamanho="sm" aria-expanded={aberto} disabled={ocupado} onClick={() => abrir(!aberto)}>
      {tipo === null ? 'escolher' : duvida ? 'confirmar' : 'mudar'}
    </Button>
    {aberto && <div className="seletor-de-tipo" role="group" aria-label="Escolher o tipo de texto">
      <label htmlFor={idDaBusca}>Que tipo de texto é este?</label>
      <Input id={idDaBusca} type="search" value={busca} placeholder="Buscar: conto, encíclica, paper…" onChange={(evento) => buscar(evento.target.value)} />
      {duvida && tipo.alternativas.length > 0 && <p className="dados">Também pode ser: {tipo.alternativas.map((item) => item.rotulo).join(', ')}.</p>}
      {tipos === null && falha === null && <p className="dados">Carregando os tipos…</p>}
      {falha && <p role="alert">{falha}</p>}
      <div className="grupos-de-tipo">{grupos.map((grupo) => <section key={grupo.id} aria-label={grupo.rotulo}>
        <span className="eyebrow">{grupo.rotulo}</span>
        <ul>{grupo.tipos.map((item) => <li key={item.id}>
          <button type="button" className="opcao-de-tipo" aria-pressed={tipo?.tipo_id === item.id} disabled={ocupado} onClick={() => void escolher(item.id)}>
            <span>{item.rotulo}</span><span className="exemplos-do-tipo">{item.exemplos}</span>
          </button>
        </li>)}</ul>
      </section>)}</div>
      {tipos !== null && grupos.length === 0 && <p className="dados">Nenhum tipo com “{busca}”. Escolha “Outro ou não sei”.</p>}
    </div>}
  </div>;
}

export function PrimeiroEuDoDocumento({ documentoId }: { documentoId: string }): ReactNode {
  const [ativo, definir] = useState(false);
  const [pronto, preparar] = useState(false);
  const [ocupado, ocupar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    preferenciasDoDocumento(documentoId).then((r) => { if (vivo) { definir(r.preferencias.primeiro_eu); preparar(true); } }, () => { if (vivo) definirErro('Não foi possível carregar a preferência Primeiro eu.'); });
    return () => { vivo = false; };
  }, [documentoId]);
  async function mudar(valor: boolean) {
    ocupar(true); definirErro(null);
    try { await gravarPreferenciasDoDocumento(documentoId, { primeiro_eu: valor }); definir(valor); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível salvar a preferência.'); }
    finally { ocupar(false); }
  }
  return <div><Switch checked={ativo} disabled={!pronto || ocupado} onChange={(valor) => void mudar(valor)}>Primeiro eu</Switch>{erro && <p role="alert">{erro}</p>}</div>;
}
