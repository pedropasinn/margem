/**
 * Flashcards: a fila do dia (o cartão vira com um clique ou Espaço; Errei, Difícil, Bom e Fácil com
 * 1–4) e a lista para editar e apagar, da biblioteca inteira (`/flashcards`) ou de um documento
 * (`/documentos/:id/flashcards`). "Ver no texto" abre o trecho do cartão (`?bloco=`). Sai em CSV
 * para o Anki.
 */
import { useCallback, useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { Esqueleto } from '../ui/Esqueleto';
import { Icon } from '../ui/Icon';
import { Button, SegmentedControl, Textarea } from '../ui/Primitives';
import { EstadoVazio } from '../biblioteca/Lista';
import type { Rota } from '../biblioteca/rotas';
import { atalhoDeUmaTeclaDesligado, digitando } from '../leitor/teclado/comandos';
import { API_DOS_FLASHCARDS, consultaDosCartoes, type ApiDosFlashcards, type Flashcard, type Nota } from './api';
import { CartaoQueVira } from './CartaoQueVira';
import './flashcards.css';

export type AbaDosFlashcards = 'estudar' | 'todos';

const RESPOSTAS: readonly { nota: Nota; rotulo: string }[] = [
  { nota: 1, rotulo: 'Errei' }, { nota: 2, rotulo: 'Difícil' }, { nota: 3, rotulo: 'Bom' }, { nota: 4, rotulo: 'Fácil' },
];
/** Quanto tempo esperar antes de olhar de novo se o Codex terminou os cartões pedidos. */
const ESPERA_DO_CODEX_MS = 5000;

/** O link de volta ao trecho passa pelo roteador da web, que lê o `?bloco=`. */
function irAoTrecho(evento: MouseEvent<HTMLAnchorElement>, link: string): void {
  if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
  evento.preventDefault();
  window.history.pushState(null, '', link);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function quando(cartao: Flashcard, agora = Date.now()): string {
  const proxima = cartao.agenda.proxima_revisao;
  if (proxima === null) return 'Novo';
  const dias = Math.ceil((Date.parse(proxima) - agora) / 86_400_000);
  if (dias <= 0) return 'Para hoje';
  if (dias === 1) return 'Volta amanhã';
  return `Volta em ${String(dias)} dias`;
}

function Sessao({ fila: inicial, api, geral, aoMudar }: { fila: Flashcard[]; api: ApiDosFlashcards; geral: boolean; aoMudar: () => void }): ReactNode {
  const [fila, definirFila] = useState(inicial);
  const [virado, virar] = useState(false);
  const [revisados, contar] = useState(0);
  const [ocupado, ocupar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const atual = fila[0];
  const total = revisados + fila.length;

  const responder = useCallback(async (nota: Nota) => {
    if (!atual || ocupado) return;
    ocupar(true); definirErro(null);
    try {
      await api.revisar(atual.id, nota);
      // Errei: o cartão volta para o fim da fila desta sessão.
      definirFila((agora) => (nota === 1 ? [...agora.slice(1), agora[0]!] : agora.slice(1)));
      if (nota !== 1) contar((n) => n + 1);
      virar(false);
    } catch (falha) {
      definirErro(falha instanceof Error ? falha.message : 'Não foi possível gravar a resposta.');
    } finally { ocupar(false); }
  }, [api, atual, ocupado]);

  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (!atual || digitando(evento.target) || atalhoDeUmaTeclaDesligado(evento) || evento.ctrlKey || evento.metaKey || evento.altKey) return;
      if (document.querySelector('[aria-modal=true]')) return;
      if (evento.key === ' ' || evento.key === 'Enter') {
        // O botão do cartão já vira com Espaço/Enter quando está em foco.
        if (evento.target instanceof HTMLElement && evento.target.closest('button, a')) return;
        evento.preventDefault(); virar((v) => !v);
      } else if (virado && ['1', '2', '3', '4'].includes(evento.key)) {
        evento.preventDefault(); void responder(Number(evento.key) as Nota);
      }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [atual, virado, responder]);

  useEffect(() => { if (fila.length === 0 && revisados > 0) aoMudar(); }, [fila.length, revisados, aoMudar]);

  if (!atual) {
    return <div className="sessao-fim" role="status">
      <h2>{revisados > 0 ? 'Pronto por hoje' : 'Nada para hoje'}</h2>
      <p>{revisados > 0 ? `${String(revisados)} ${revisados === 1 ? 'cartão revisado' : 'cartões revisados'}.` : 'Nenhum cartão vence hoje.'}</p>
    </div>;
  }
  return <section className="sessao-de-estudo" aria-label="Estudar">
    <p className="sessao-contador">
      <span className="sessao-onde">{geral ? `${atual.documento.titulo} · ` : ''}{atual.capitulo.titulo}</span>
      <span role="status"><strong>{revisados + 1}</strong> de {total}</span>
    </p>
    <CartaoQueVira key={atual.id} virado={virado} aoVirar={() => virar((v) => !v)} frente={atual.frente} verso={atual.verso} />
    {virado
      ? <div className="sessao-acoes" role="group" aria-label="Como foi">
        {RESPOSTAS.map((resposta) => <Button key={resposta.nota} variante={resposta.nota === 3 ? 'primario' : 'secundario'} disabled={ocupado}
          onClick={() => void responder(resposta.nota)}>{resposta.rotulo}<kbd aria-hidden="true">{resposta.nota}</kbd></Button>)}
      </div>
      : <div className="sessao-acoes"><Button variante="primario" onClick={() => virar(true)}>Mostrar a resposta<kbd aria-hidden="true">Espaço</kbd></Button></div>}
    <p className="sessao-trecho"><a href={atual.link} onClick={(evento) => irAoTrecho(evento, atual.link)}><Icon name="ir-para" size={16} />Ver no texto</a></p>
    {erro && <p className="aviso" role="alert">{erro}</p>}
  </section>;
}

function ItemDoCartao({ cartao, geral, api, aoMudar }: { cartao: Flashcard; geral: boolean; api: ApiDosFlashcards; aoMudar: () => void }): ReactNode {
  const [editando, editar] = useState(false);
  const [frente, definirFrente] = useState(cartao.frente);
  const [verso, definirVerso] = useState(cartao.verso);
  const [erro, definirErro] = useState<string | null>(null);
  const [ocupado, ocupar] = useState(false);
  const agir = async (acao: () => Promise<unknown>) => {
    ocupar(true); definirErro(null);
    try { await acao(); aoMudar(); } catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível salvar.'); } finally { ocupar(false); }
  };
  const salvar = (evento: FormEvent) => {
    evento.preventDefault();
    void agir(async () => { await api.editar(cartao.id, { frente, verso }); editar(false); });
  };
  return <li className="item-cartao">
    {editando
      ? <form onSubmit={salvar} aria-label="Editar flashcard">
        <Textarea aria-label="Frente" value={frente} maxLength={1000} onChange={(e) => definirFrente(e.target.value)} autoFocus />
        <Textarea aria-label="Verso" value={verso} maxLength={4000} onChange={(e) => definirVerso(e.target.value)} />
        <div className="botoes"><Button variante="ghost" onClick={() => { editar(false); definirFrente(cartao.frente); definirVerso(cartao.verso); }}>Cancelar</Button>
          <Button type="submit" variante="primario" disabled={ocupado || !frente.trim() || !verso.trim()}>Salvar</Button></div>
      </form>
      : <>
        <p className="item-cartao-frente">{cartao.frente}</p>
        <p className="item-cartao-verso">{cartao.verso}</p>
      </>}
    <a className="item-cartao-trecho" href={cartao.link} onClick={(evento) => irAoTrecho(evento, cartao.link)} aria-label={`Ver no texto: ${cartao.ancora.citacao}`}>“{cartao.ancora.citacao}”</a>
    <div className="item-cartao-meta">
      {geral && <span>{cartao.capitulo.titulo}</span>}
      <span>{cartao.origem === 'ia' ? 'Criado pelo Codex' : 'Criado por você'}</span>
      <span>{quando(cartao)}</span>
      {!editando && <span className="item-cartao-acoes">
        <Button variante="ghost" onClick={() => editar(true)}>Editar</Button>
        <Button variante="ghost" disabled={ocupado} onClick={() => { if (window.confirm('Apagar este flashcard?')) void agir(() => api.apagar(cartao.id)); }}>Apagar</Button>
      </span>}
    </div>
    {erro && <p className="aviso" role="alert">{erro}</p>}
  </li>;
}

function grupos(cartoes: readonly Flashcard[], geral: boolean): { chave: string; titulo: string; itens: Flashcard[] }[] {
  const mapa = new Map<string, { chave: string; titulo: string; itens: Flashcard[] }>();
  for (const cartao of cartoes) {
    const chave = geral ? cartao.documento.id : cartao.capitulo.id;
    const grupo = mapa.get(chave) ?? { chave, titulo: geral ? cartao.documento.titulo : cartao.capitulo.titulo, itens: [] };
    grupo.itens.push(cartao);
    mapa.set(chave, grupo);
  }
  return [...mapa.values()];
}

export interface PropsDosFlashcards {
  documento_id?: string;
  aba?: AbaDosFlashcards;
  ir: (destino: Rota) => void;
  api?: ApiDosFlashcards;
}

export function Flashcards({ documento_id, aba = 'estudar', ir, api = API_DOS_FLASHCARDS }: PropsDosFlashcards): ReactNode {
  const [todos, definirTodos] = useState<Flashcard[] | null>(null);
  const [fila, definirFila] = useState<Flashcard[] | null>(null);
  const [emCurso, definirEmCurso] = useState<string[]>([]);
  const [erro, definirErro] = useState<string | null>(null);
  const [sessao, novaSessao] = useState(0);
  const geral = documento_id === undefined;
  const filtro = documento_id ? { documento: documento_id } : {};

  const carregar = useCallback(async (reabrirFila: boolean) => {
    try {
      const [lista, hoje] = await Promise.all([api.listar(filtro), reabrirFila ? api.listar({ ...filtro, hoje: true }) : Promise.resolve(null)]);
      definirTodos(lista.cartoes); definirEmCurso(lista.em_curso);
      if (hoje) { definirFila(hoje.cartoes); novaSessao((n) => n + 1); }
    } catch (falha) { definirErro(falha instanceof Error ? falha.message : 'falha ao carregar'); }
    // O filtro é só o documento.
  }, [api, documento_id]);

  useEffect(() => { void carregar(true); }, [carregar, aba]);
  // Enquanto o Codex cria cartões, olha de novo de tempos em tempos; a sessão em curso não recomeça.
  useEffect(() => {
    if (emCurso.length === 0) return;
    const espera = setTimeout(() => { void carregar(fila !== null && fila.length === 0); }, ESPERA_DO_CODEX_MS);
    return () => clearTimeout(espera);
  }, [emCurso, carregar, fila]);

  const titulo = geral ? 'Flashcards' : todos?.[0]?.documento.titulo ?? 'Flashcards';
  const trocarAba = (nova: string) => ir(documento_id === undefined
    ? { nome: 'flashcards', ...(nova === 'todos' ? { aba: 'todos' as const } : {}) }
    : { nome: 'flashcards', documento_id, ...(nova === 'todos' ? { aba: 'todos' as const } : {}) });
  return <section className="flashcards" aria-label="Flashcards">
    <header className="flashcards-cabecalho">
      {documento_id !== undefined && <a className="voltar" href={`/documentos/${documento_id}`} onClick={(evento) => { evento.preventDefault(); ir({ nome: 'documento', documento_id }); }}><Icon name="voltar" size={16} />Voltar ao documento</a>}
      {!geral && <span className="eyebrow">Flashcards</span>}
      <h1>{titulo}</h1>
      <div className="flashcards-ferramentas">
        <SegmentedControl rotulo="Vista" valor={aba} aoMudar={trocarAba} opcoes={[
          { valor: 'estudar', rotulo: fila === null ? 'Estudar' : `Estudar · ${String(fila.length)}` },
          { valor: 'todos', rotulo: todos === null ? 'Todos' : `Todos · ${String(todos.length)}` },
        ]} />
        {todos !== null && todos.length > 0 && <a className="ui-button ui-secundario" href={`/api/flashcards/exportacao.csv${consultaDosCartoes(filtro)}`} download><Icon name="exportar" size={16} />Anki (CSV)</a>}
      </div>
      {emCurso.length > 0 && <p className="flashcards-aviso" role="status">O Codex está criando flashcards de {emCurso.length === 1 ? '1 capítulo' : `${String(emCurso.length)} capítulos`}; eles entram aqui quando ficarem prontos.</p>}
    </header>
    {erro !== null && <p className="aviso" role="alert">Não foi possível carregar os flashcards: {erro}</p>}
    {todos === null || fila === null ? (erro === null && <Esqueleto />)
      : todos.length === 0 ? <EstadoVazio frase={geral ? 'Nenhum flashcard ainda. No leitor, use “Criar flashcards” no menu ••• ou selecione um trecho.' : 'Nenhum flashcard deste documento ainda. Peça os de um capítulo na lista de capítulos ou no leitor.'} />
      : aba === 'estudar' ? <Sessao key={sessao} fila={fila} api={api} geral={geral} aoMudar={() => void carregar(false)} />
      : grupos(todos, geral).map((grupo) => <section key={grupo.chave} className="flashcards-grupo" aria-label={grupo.titulo}>
        <h2>{grupo.titulo}</h2>
        <ul className="lista-de-cartoes">{grupo.itens.map((cartao) => <ItemDoCartao key={`${cartao.id}:${cartao.atualizado_em}`} cartao={cartao} geral={geral} api={api} aoMudar={() => void carregar(false)} />)}</ul>
      </section>)}
  </section>;
}
