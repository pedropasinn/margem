import { Button, Textarea } from '../ui/Primitives';
import { useEffect, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AncoraV1, ConexaoV2, ConversaV2 } from '@margem/contratos';
import { escrever, pedir } from '../biblioteca/api';
import { CONVERSA_VAZIA, reduzirConversa, type EstadoConversa } from './f2';
import { ListaDeConexoes } from './Conexoes';
export function FioDeConversa({ id, ancora, documentoId, conexoes, aoCriar, aoMudar, aoCitar, aoLonga, rascunho, aoRascunho }: {
  aoLonga?: () => void;
  rascunho?: string;
  aoRascunho?: (texto: string) => void;
  id: string | null; ancora: AncoraV1; documentoId: string; conexoes: readonly ConexaoV2[];
  aoCriar: (id: string) => void; aoMudar: () => void; aoCitar: (a: AncoraV1) => void;
}): ReactNode {
  const [estado, despachar] = useReducer(reduzirConversa, CONVERSA_VAZIA);
  const [perguntaLocal, definirPerguntaLocal] = useState('');
  const pergunta = rascunho ?? perguntaLocal;
  const definirPergunta = aoRascunho ?? definirPerguntaLocal;
  const [ocupado, ocupar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const [desconectado, desconectar] = useState(false);
  const recarregarRef = useRef<() => void>(() => {});
  const aoMudarRef = useRef(aoMudar); aoMudarRef.current = aoMudar;
  useEffect(() => {
    if (!id) { despachar({ tipo: 'fechar' }); return; }
    despachar({ tipo: 'abrir', id });
    let vivo = true;
    let requisicao = 0;
    const recarregar = () => {
      const numero = ++requisicao;
      void pedir<{ conversa: ConversaV2; pendentes: EstadoConversa['pendentes'] }>(`/api/conversas/${id}`).then((r) => {
        if (vivo && numero === requisicao) despachar({ tipo: 'receber', id, ...r });
      }, (falha: unknown) => { if (vivo) despachar({ tipo: 'erro', id, erro: falha instanceof Error ? falha.message : 'Falha ao atualizar a conversa.' }); });
    };
    recarregarRef.current = recarregar;
    recarregar();
    const eventos = typeof EventSource === 'function' ? new EventSource('/api/eventos') : null;
    const receber = (e: MessageEvent<string>) => {
      try {
        const evento = JSON.parse(e.data) as { documento_id?: string; job_tipo?: string };
        if (evento.documento_id !== documentoId || evento.job_tipo !== 'responder') return;
        recarregar(); aoMudarRef.current();
      } catch { /* Evento inválido não substitui o snapshot. */ }
    };
    const tipos = ['resposta_publicada', 'enfileirado', 'reservado', 'publicado', 'falhou', 'adiado', 'cancelado', 'reenfileirado'];
    for (const tipo of tipos) eventos?.addEventListener(tipo, receber as EventListener);
    if (eventos) {
      eventos.onopen = () => { desconectar(false); recarregar(); aoMudarRef.current(); };
      eventos.onerror = () => desconectar(true);
    }
    const aoFocar = () => recarregar();
    window.addEventListener('focus', aoFocar);
    return () => { vivo = false; eventos?.close(); window.removeEventListener('focus', aoFocar); recarregarRef.current = () => {}; };
  }, [id, documentoId]);
  const aoLongaRef = useRef(aoLonga); aoLongaRef.current = aoLonga;
  useEffect(() => {
    const mensagens = estado.conversa?.mensagens ?? [];
    if (mensagens.length > 4 || mensagens.reduce((total, m) => total + m.texto.length, 0) > 900) aoLongaRef.current?.();
  }, [estado.conversa]);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pergunta.trim() || ocupado) return;
    ocupar(true); definirErro(null);
    try {
      if (id) { await escrever(`/api/conversas/${id}/mensagens`, { pergunta: pergunta.trim() }); recarregarRef.current(); }
      else { const resposta = await escrever<{ conversa: ConversaV2 }>('/api/conversas', { ancora, pergunta: pergunta.trim() }); aoCriar(resposta.conversa.id); }
      definirPergunta(''); aoMudar();
    } catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível enviar a pergunta.'); }
    finally { ocupar(false); }
  }
  return <section className="fio-conversa" aria-label="Conversa ancorada">
    {estado.conversa?.mensagens.map((m) => <div className={`mensagem mensagem-${m.autor}`} key={m.id}>
      <span className="eyebrow">{m.autor === 'leitor' ? 'Você' : 'Leitura da IA'}</span><p>{m.texto}</p>
      {m.autor === 'ia' && m.citacoes.map((a, i) => <Button variante="ghost" className="citacao-link" key={`${a.bloco_id}:${a.inicio_utf16}:${i}`} onClick={() => aoCitar(a)}>“{a.citacao}”</Button>)}
    </div>)}
    {estado.pendentes.map((p) => <p role="status" key={p.mensagem_id}>{p.estado === 'falhou' ? 'A resposta falhou. Reenfileire o trabalho no detalhe do documento.' : p.estado === 'cancelado' ? 'Resposta cancelada.' : p.estado === 'adiado' ? 'Leitura adiada; aguardando retomada…' : 'lendo o capítulo…'}</p>)}
    {desconectado && <p role="status">Reconectando à conversa…</p>}
    {(erro || estado.erro) && <p role="alert">{erro ?? estado.erro} <Button variante="ghost" tamanho="sm" onClick={() => recarregarRef.current()}>Atualizar conversa</Button></p>}
    <ListaDeConexoes conexoes={conexoes.filter((c) => c.conversa_id === id)} aoMudar={aoMudar} aoCitar={aoCitar} />
    <form className="formulario formulario-estudo" onSubmit={(e) => void enviar(e)}>
      <label>Sua pergunta<Textarea autoFocus value={pergunta} onChange={(e) => definirPergunta(e.target.value)} required maxLength={8000} /></label>
      <div className="ui-rodape"><Button type="submit" variante="primario" tamanho="md" disabled={ocupado || estado.conversa?.estado === 'arquivada'}>{ocupado ? 'Enviando…' : 'Enviar pergunta'}</Button></div>
    </form>
  </section>;
}
