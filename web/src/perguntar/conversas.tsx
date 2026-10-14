/**
 * As conversas do Perguntar na barra lateral principal (V-U1): "Nova conversa", as recentes e, no "…"
 * de cada uma, Renomear e Apagar. A lista é uma só para a barra, a gaveta do celular e a página (que a
 * relê quando uma pergunta entra ou uma resposta chega), por isso mora num contexto.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ConversaDoAgenteV1 } from '@margem/contratos';
import { escrever, pedir } from '../biblioteca/api';
import type { Rota } from '../biblioteca/rotas';
import { Icon } from '../ui/Icon';
import { Button, IconButton, Input, Popover } from '../ui/Primitives';

type Ir = (destino: Rota, substituir?: boolean) => void;

export interface ConversasDoAgente {
  /** `null` enquanto a lista não chegou. */
  conversas: readonly ConversaDoAgenteV1[] | null;
  recarregar: () => void;
  renomear: (id: string, titulo: string) => Promise<void>;
  apagar: (id: string) => Promise<void>;
}

const SEM_PROVEDOR: ConversasDoAgente = { conversas: null, recarregar: () => {}, renomear: () => Promise.resolve(), apagar: () => Promise.resolve() };
const Contexto = createContext<ConversasDoAgente>(SEM_PROVEDOR);

export function ProvedorDasConversas({ children }: { children: ReactNode }): ReactNode {
  const [conversas, definir] = useState<ConversaDoAgenteV1[] | null>(null);
  const recarregar = useCallback(() => {
    void pedir<{ conversas?: unknown }>('/api/agente/conversas').then(
      (r) => definir(Array.isArray(r.conversas) ? r.conversas as ConversaDoAgenteV1[] : []),
      () => definir((atual) => atual ?? []),
    );
  }, []);
  const renomear = useCallback(async (id: string, titulo: string) => {
    const { conversa } = await escrever<{ conversa: ConversaDoAgenteV1 }>(`/api/agente/conversas/${id}`, { titulo }, 'PATCH');
    definir((atual) => atual?.map((c) => (c.id === id ? conversa : c)) ?? null);
  }, []);
  const apagar = useCallback(async (id: string) => {
    await pedir(`/api/agente/conversas/${id}`, { method: 'DELETE' });
    definir((atual) => atual?.filter((c) => c.id !== id) ?? null);
  }, []);
  const valor = useMemo(() => ({ conversas, recarregar, renomear, apagar }), [conversas, recarregar, renomear, apagar]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** A lista compartilhada; quem a mostra primeiro pede à API. */
export function usarConversas(): ConversasDoAgente {
  const valor = useContext(Contexto);
  const { conversas, recarregar } = valor;
  useEffect(() => { if (conversas === null) recarregar(); }, [conversas, recarregar]);
  return valor;
}

function Conversa({ conversa, atual, ir, aoApagarAtual }: { conversa: ConversaDoAgenteV1; atual: boolean; ir: Ir; aoApagarAtual: () => void }): ReactNode {
  const { renomear, apagar } = useContext(Contexto);
  const [menu, abrirMenu] = useState<'opcoes' | 'apagar' | null>(null);
  const [editando, editar] = useState(false);
  const [nome, definirNome] = useState(conversa.titulo);
  const [erro, definirErro] = useState<string | null>(null);
  const botao = useRef<HTMLButtonElement>(null);

  async function salvar(e?: FormEvent) {
    e?.preventDefault();
    const titulo = nome.replace(/\s+/gu, ' ').trim();
    editar(false);
    if (titulo === '' || titulo === conversa.titulo) { definirNome(conversa.titulo); return; }
    try { await renomear(conversa.id, titulo); definirErro(null); }
    catch (falha) { definirNome(conversa.titulo); definirErro(falha instanceof Error ? falha.message : 'Não foi possível renomear.'); }
  }
  async function confirmarApagar() {
    try {
      await apagar(conversa.id);
      abrirMenu(null);
      if (atual) aoApagarAtual();
    } catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível apagar.'); abrirMenu(null); }
  }

  return <li className={`conversa-da-barra ${atual ? 'active' : ''} ${menu ? 'com-menu' : ''}`}>
    {editando
      ? <form className="conversa-renomear" onSubmit={(e) => void salvar(e)}>
        <Input aria-label="Nome da conversa" value={nome} maxLength={200} autoFocus onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => definirNome(e.target.value)} onBlur={() => void salvar()}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); definirNome(conversa.titulo); editar(false); } }} />
      </form>
      : <a href={`/perguntar/${conversa.id}`} aria-current={atual ? 'page' : undefined} title={conversa.titulo}
        onClick={(e) => { e.preventDefault(); ir({ nome: 'perguntar', conversa_id: conversa.id }); }}>{conversa.titulo}</a>}
    {!editando && <IconButton ref={botao} tamanho="sm" icone="reticencias" className="conversa-opcoes" aria-label={`Opções da conversa ${conversa.titulo}`}
      aria-expanded={menu !== null} onClick={() => abrirMenu(menu ? null : 'opcoes')} />}
    {erro && <span role="alert" className="conversa-erro">{erro}</span>}
    {menu && <Popover ancora={botao} rotulo={menu === 'apagar' ? 'Apagar conversa' : 'Opções da conversa'} largura={menu === 'apagar' ? 260 : 200}
      aoFechar={() => abrirMenu(null)} className="menu-da-conversa">
      {menu === 'opcoes'
        ? <ul role="menu" aria-label="Opções da conversa">
          <li role="none"><button type="button" role="menuitem" onClick={() => { abrirMenu(null); definirNome(conversa.titulo); editar(true); }}><Icon name="lapis" size={16} />Renomear</button></li>
          <li role="none"><button type="button" role="menuitem" className="perigo" onClick={() => abrirMenu('apagar')}><Icon name="lixeira" size={16} />Apagar</button></li>
        </ul>
        : <div className="confirmar-apagar">
          <p>Apagar “{conversa.titulo}”? A conversa sai da lista.</p>
          <div className="ui-rodape"><Button variante="ghost" tamanho="sm" onClick={() => abrirMenu(null)}>Cancelar</Button><Button variante="perigo" tamanho="sm" onClick={() => void confirmarApagar()}>Apagar</Button></div>
        </div>}
    </Popover>}
  </li>;
}

/** "Nova conversa" e as recentes, para a barra lateral e para a gaveta do celular. */
export function ConversasNaBarra({ atual, ir, aoNavegar }: { atual?: string | undefined; ir: Ir; aoNavegar?: () => void }): ReactNode {
  const { conversas } = usarConversas();
  const irE = (destino: Rota, substituir?: boolean) => { ir(destino, substituir); aoNavegar?.(); };
  return <div className="conversas-da-barra">
    <a href="/perguntar" className="conversa-nova" onClick={(e) => { e.preventDefault(); irE({ nome: 'perguntar' }); }}><Icon name="somar" size={16} /><span>Nova conversa</span></a>
    {conversas !== null && conversas.length > 0 && <>
      <span className="rotulo-conversas" id="rotulo-conversas">Recentes</span>
      <ul aria-labelledby="rotulo-conversas">{conversas.map((conversa) => <Conversa key={conversa.id} conversa={conversa} atual={conversa.id === atual} ir={irE}
        aoApagarAtual={() => irE({ nome: 'perguntar' }, true)} />)}</ul>
    </>}
  </div>;
}
