/**
 * Página "Perguntar": conversa com o agente que lê a biblioteca inteira.
 *
 * Cada pergunta vira um job do worker (Codex, esforço medium, a biblioteca em Markdown montada só
 * para leitura). Enquanto pensa, a página relê o fio a cada 2,5 s e mostra se está na fila ou lendo.
 * A resposta vem em Markdown (desenhado sem HTML), com as citações conferidas pelo serviço levando
 * ao trecho no leitor, e os artefatos pedidos: mapa (Mermaid), resumo, quadro, conceitos.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AncoraV1, ArtefatoDoAgenteV1, CitacaoDoAgenteV1, ConversaDoAgenteV1, MensagemDoAgenteV1 } from '@margem/contratos';
import { escrever, pedir } from '../biblioteca/api';
import type { Rota } from '../biblioteca/rotas';
import { DiagramaMermaid } from '../leitor/visuais/DiagramaMermaid';
import { Icon } from '../ui/Icon';
import { Button, Textarea } from '../ui/Primitives';
import ThoughtLine from '../ui/pensando/ThoughtLine';
import { Markdown } from './Markdown';
import './perguntar.css';

type Fio = { conversa: ConversaDoAgenteV1; mensagens: MensagemDoAgenteV1[] };
type Ir = (destino: Rota, substituir?: boolean) => void;

export const INTERVALO_DE_RELEITURA_MS = 2500;

const EXEMPLOS = [
  'Faça um mapa do capítulo 3 deste livro',
  'Compare como dois livros da biblioteca tratam causalidade',
  'Liste os conceitos centrais do primeiro capítulo',
];

const NOME_DO_ARTEFATO: Record<ArtefatoDoAgenteV1['tipo'], string> = { mapa: 'Mapa', resumo: 'Resumo', quadro: 'Quadro comparativo', conceitos: 'Conceitos' };

const pendente = (mensagem: MensagemDoAgenteV1) => mensagem.autor === 'leitor' && (mensagem.estado === 'na_fila' || mensagem.estado === 'pensando');

function irAoTrecho(ir: Ir, documentoId: string, secaoId: string | null, blocoId: string): void {
  ir(secaoId === null ? { nome: 'leitura', documento_id: documentoId } : { nome: 'leitura', documento_id: documentoId, secao_id: secaoId, bloco: blocoId });
}

function ListaDeConversas({ conversas, atual, ir }: { conversas: readonly ConversaDoAgenteV1[]; atual?: string; ir: Ir }): ReactNode {
  return <nav className="perguntar-conversas" aria-label="Conversas">
    <a href="/perguntar" className={`perguntar-nova ${atual === undefined ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); ir({ nome: 'perguntar' }); }}><Icon name="somar" size={16} /><span>Nova conversa</span></a>
    {conversas.length > 0 && <span className="eyebrow">Conversas</span>}
    <ul>{conversas.map((conversa) => <li key={conversa.id}>
      <a href={`/perguntar/${conversa.id}`} aria-current={conversa.id === atual ? 'page' : undefined} className={conversa.id === atual ? 'active' : ''}
        onClick={(e) => { e.preventDefault(); ir({ nome: 'perguntar', conversa_id: conversa.id }); }}>{conversa.titulo}</a>
    </li>)}</ul>
  </nav>;
}

function Fontes({ citacoes, ir }: { citacoes: readonly CitacaoDoAgenteV1[]; ir: Ir }): ReactNode {
  if (citacoes.length === 0) return null;
  return <section className="perguntar-fontes" aria-label="Fontes">
    <span className="eyebrow">Fontes</span>
    <ol>{citacoes.map((citacao) => <li key={citacao.ref} id={`fonte-${citacao.ref}`}>
      <button type="button" className="perguntar-fonte" onClick={() => irAoTrecho(ir, citacao.documento_id, citacao.secao_id, citacao.ancora.bloco_id)}>
        <span className="perguntar-fonte-numero">{citacao.ref.slice(1)}</span>
        <span className="perguntar-fonte-texto">“{citacao.ancora.citacao}”</span>
        <span className="perguntar-fonte-onde">{citacao.documento}{citacao.capitulo ? ` · ${citacao.capitulo}` : ''}</span>
      </button>
    </li>)}</ol>
  </section>;
}

function Artefato({ artefato, mensagemId, indice, ir, aoMudar, aoCitar }: {
  artefato: ArtefatoDoAgenteV1; mensagemId: string; indice: number; ir: Ir; aoMudar: () => void; aoCitar: (ref: string) => ReactNode | null;
}): ReactNode {
  const [estado, definir] = useState<{ ocupado?: boolean; erro?: string; copiado?: boolean }>({});
  const { capitulo } = artefato;
  async function salvar() {
    definir({ ocupado: true });
    try {
      await escrever(`/api/agente/mensagens/${mensagemId}/artefatos/${String(indice)}/salvar`, {});
      definir({}); aoMudar();
    } catch (falha) { definir({ erro: falha instanceof Error ? falha.message : 'Não foi possível salvar.' }); }
  }
  async function copiar() {
    try {
      await navigator.clipboard.writeText(artefato.tipo === 'mapa' ? artefato.codigo : artefato.markdown);
      definir({ copiado: true });
    } catch { definir({ erro: 'O navegador não deixou copiar.' }); }
  }
  const salvo = artefato.tipo === 'mapa' ? artefato.visual_id : undefined;
  const citar = (ancora: AncoraV1) => {
    const destino = capitulo && ancora.versao_id === capitulo.versao_id ? capitulo : null;
    if (destino) irAoTrecho(ir, destino.documento_id, destino.secao_id, ancora.bloco_id);
  };
  return <article className={`perguntar-artefato perguntar-artefato-${artefato.tipo}`}>
    <header>
      <span className="eyebrow">{NOME_DO_ARTEFATO[artefato.tipo]}{capitulo ? ` · ${capitulo.documento}` : ''}</span>
      <h3>{artefato.titulo}</h3>
      {capitulo && <span className="perguntar-artefato-capitulo">{capitulo.titulo}</span>}
    </header>
    {artefato.tipo === 'mapa'
      ? <DiagramaMermaid id={`agente-${mensagemId}-${String(indice)}`} codigo={artefato.codigo} nos={artefato.nos} aoCitar={citar} className="perguntar-mapa" />
      : <Markdown texto={artefato.markdown} opcoes={{ citacao: aoCitar, id: `agente-${mensagemId}-${String(indice)}` }} />}
    <div className="perguntar-artefato-acoes">
      {artefato.tipo === 'mapa' && capitulo && (salvo
        ? <Button onClick={() => ir({ nome: 'leitura', documento_id: capitulo.documento_id, secao_id: capitulo.secao_id })}>Salvo no capítulo · abrir</Button>
        : <Button onClick={() => void salvar()} disabled={estado.ocupado}>{estado.ocupado ? 'Salvando…' : 'Salvar no capítulo'}</Button>)}
      <Button variante="ghost" onClick={() => void copiar()}>{estado.copiado ? 'Copiado' : artefato.tipo === 'mapa' ? 'Copiar Mermaid' : 'Copiar Markdown'}</Button>
      {estado.erro && <span role="alert" className="perguntar-erro">{estado.erro}</span>}
    </div>
  </article>;
}

function Resposta({ mensagem, ir, aoMudar }: { mensagem: MensagemDoAgenteV1; ir: Ir; aoMudar: () => void }): ReactNode {
  const porRef = new Map(mensagem.citacoes.map((citacao) => [citacao.ref, citacao]));
  const aoCitar = (ref: string): ReactNode | null => {
    const citacao = porRef.get(ref);
    if (!citacao) return null;
    return <button type="button" className="perguntar-marca" title={`“${citacao.ancora.citacao}” — ${citacao.documento}${citacao.capitulo ? `, ${citacao.capitulo}` : ''}`}
      aria-label={`Fonte ${ref.slice(1)}: ir ao trecho`} onClick={() => irAoTrecho(ir, citacao.documento_id, citacao.secao_id, citacao.ancora.bloco_id)}>{ref.slice(1)}</button>;
  };
  const semCitacao = mensagem.diagnosticos.find((diagnostico) => diagnostico.codigo === 'sem_citacao');
  const outros = mensagem.diagnosticos.filter((diagnostico) => diagnostico.codigo !== 'sem_citacao');
  return <div className="perguntar-mensagem perguntar-agente">
    <span className="eyebrow">Agente</span>
    {semCitacao && <p className="perguntar-aviso" role="note">{semCitacao.mensagem}</p>}
    <Markdown texto={mensagem.texto} opcoes={{ citacao: aoCitar, id: `agente-${mensagem.id}` }} />
    {mensagem.artefatos.map((artefato, indice) => <Artefato key={indice} artefato={artefato} mensagemId={mensagem.id} indice={indice} ir={ir} aoMudar={aoMudar} aoCitar={aoCitar} />)}
    <Fontes citacoes={mensagem.citacoes} ir={ir} />
    {(outros.length > 0 || mensagem.execucao) && <details className="perguntar-detalhes">
      <summary>{outros.length > 0 ? `${String(outros.length)} aviso${outros.length > 1 ? 's' : ''} da conferência` : 'Detalhes'}</summary>
      <ul>{outros.map((diagnostico, indice) => <li key={indice}>{diagnostico.mensagem}</li>)}</ul>
      {mensagem.execucao && <p>{mensagem.execucao.modelo} · esforço {mensagem.execucao.esforco} · {Math.round(mensagem.execucao.duracao_ms / 1000)} s</p>}
    </details>}
  </div>;
}

function Pergunta({ mensagem, aoRepetir }: { mensagem: MensagemDoAgenteV1; aoRepetir: (id: string) => void }): ReactNode {
  return <div className="perguntar-mensagem perguntar-leitor">
    <span className="eyebrow">Você</span>
    <p className="perguntar-texto-leitor">{mensagem.texto}</p>
    {mensagem.estado === 'na_fila' && <div className="perguntar-estado" role="status">
      <ThoughtLine label="Na fila do Codex…" collapsible={false} showTimer={false} fontSize={14} color="var(--texto-2)" glyphColor="var(--accent)" />
      {mensagem.aviso && <p className="perguntar-aviso">{mensagem.aviso}</p>}
    </div>}
    {mensagem.estado === 'pensando' && <div className="perguntar-estado" role="status">
      <ThoughtLine label="Lendo a biblioteca…" collapsible={false} fontSize={15} color="var(--texto-1)" glyphColor="var(--accent)" />
    </div>}
    {mensagem.estado === 'falhou' && <div className="perguntar-estado" role="alert">
      <p className="perguntar-erro">{mensagem.motivo ?? 'O agente não conseguiu responder.'}</p>
      <Button onClick={() => aoRepetir(mensagem.id)}>Tentar de novo</Button>
    </div>}
  </div>;
}

export function Perguntar({ conversa_id, ir }: { conversa_id?: string; ir: Ir }): ReactNode {
  const [conversas, definirConversas] = useState<ConversaDoAgenteV1[]>([]);
  const [fio, definirFio] = useState<Fio | null>(null);
  const [pergunta, definirPergunta] = useState('');
  const [ocupado, ocupar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);

  const recarregarLista = useCallback(() => {
    void pedir<{ conversas: ConversaDoAgenteV1[] }>('/api/agente/conversas').then((r) => definirConversas(r.conversas), () => {});
  }, []);
  const recarregar = useCallback(async () => {
    if (conversa_id === undefined) { definirFio(null); return; }
    try { definirFio(await pedir<Fio>(`/api/agente/conversas/${conversa_id}`)); definirErro(null); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível abrir a conversa.'); }
  }, [conversa_id]);

  useEffect(() => { document.title = 'Perguntar · Margem'; recarregarLista(); }, [recarregarLista]);
  useEffect(() => { definirFio(null); void recarregar(); }, [recarregar]);
  const pensando = fio?.mensagens.some(pendente) ?? false;
  useEffect(() => {
    if (!pensando) return;
    const relogio = window.setInterval(() => { void recarregar(); }, INTERVALO_DE_RELEITURA_MS);
    return () => window.clearInterval(relogio);
  }, [pensando, recarregar]);
  // Quando a resposta chega, a lista reordena (a conversa sobe).
  const respondidas = fio?.mensagens.length ?? 0;
  useEffect(() => { if (respondidas > 0) recarregarLista(); }, [respondidas, recarregarLista]);

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    const texto = pergunta.trim();
    if (!texto || ocupado || pensando) return;
    ocupar(true); definirErro(null);
    try {
      if (conversa_id === undefined) {
        const novo = await escrever<Fio>('/api/agente/conversas', { pergunta: texto });
        definirFio(novo);
        ir({ nome: 'perguntar', conversa_id: novo.conversa.id }, true);
      } else {
        definirFio(await escrever<Fio>(`/api/agente/conversas/${conversa_id}/mensagens`, { pergunta: texto }));
      }
      definirPergunta('');
      recarregarLista();
    } catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível enviar a pergunta.'); }
    finally { ocupar(false); }
  }
  async function repetir(id: string) {
    try { definirFio(await escrever<Fio>(`/api/agente/mensagens/${id}/repetir`, {})); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível tentar de novo.'); }
  }

  const mensagens = fio?.mensagens ?? [];
  return <section className="perguntar" aria-label="Perguntar">
    <ListaDeConversas conversas={conversas} {...(conversa_id === undefined ? {} : { atual: conversa_id })} ir={ir} />
    <div className="perguntar-principal">
      <header className="perguntar-cabecalho">
        <h1>{fio?.conversa.titulo ?? 'Perguntar'}</h1>
        {conversa_id === undefined && <p className="perguntar-sub">Pergunte qualquer coisa sobre os textos da biblioteca, ou peça um mapa de capítulo, um resumo, um quadro comparativo, uma lista de conceitos. O agente lê os livros e cita os trechos.</p>}
      </header>
      <div className="perguntar-fio" aria-live="polite">
        {mensagens.map((mensagem) => (mensagem.autor === 'leitor'
          ? <Pergunta key={mensagem.id} mensagem={mensagem} aoRepetir={(id) => void repetir(id)} />
          : <Resposta key={mensagem.id} mensagem={mensagem} ir={ir} aoMudar={() => void recarregar()} />))}
      </div>
      {erro && <p role="alert" className="perguntar-erro">{erro}</p>}
      <form className="perguntar-formulario" onSubmit={(e) => void enviar(e)}>
        <Textarea aria-label="Sua pergunta" ref={caixa} value={pergunta} maxLength={8000} rows={3}
          placeholder={conversa_id === undefined ? 'O que você quer saber da biblioteca?' : 'Continue a conversa…'}
          onChange={(e) => definirPergunta(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void enviar(); } }} />
        <div className="perguntar-formulario-pe">
          <span className="perguntar-dica">{pensando ? 'O agente ainda está respondendo.' : 'Ctrl+Enter envia'}</span>
          <Button type="submit" variante="primario" disabled={ocupado || pensando || pergunta.trim() === ''}>{ocupado ? 'Enviando…' : 'Perguntar'}</Button>
        </div>
      </form>
      {conversa_id === undefined && mensagens.length === 0 && <div className="perguntar-exemplos" aria-label="Exemplos">
        {EXEMPLOS.map((exemplo) => <button type="button" key={exemplo} className="perguntar-exemplo" onClick={() => { definirPergunta(exemplo); caixa.current?.focus(); }}>{exemplo}</button>)}
      </div>}
    </div>
  </section>;
}
