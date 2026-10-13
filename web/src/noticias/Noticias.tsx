import { useCallback, useEffect, useState } from 'react';
import type { HubDeNoticiasV1 } from '@margem/contratos';
import { pedir } from '../biblioteca/api';
import type { Rota } from '../biblioteca/rotas';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Primitives';
import { ArquivoDeNoticias } from './ArquivoDeNoticias';
import { PlayerDeNoticias } from './PlayerDeNoticias';
import './noticias.css';

const data = (dia: string) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dia}T12:00:00Z`));
const duracao = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const estado = (valor: string) => ({ fila: 'Na fila de preparação', reservado: 'Lendo fontes e preparando a edição', adiado: 'Preparação adiada', falhou: 'A edição precisa de uma nova tentativa', cancelado: 'Preparação interrompida', ok: 'Publicada' }[valor] ?? valor);

export function Noticias({ ir, edicaoId }: { ir: (rota: Rota) => void; edicaoId?: string }) {
  const [hub, definirHub] = useState<HubDeNoticiasV1 | null>(null);
  const [erro, definirErro] = useState('');
  const [ocupado, definirOcupado] = useState(false);
  const [filtro, definirFiltro] = useState('Todos');
  const [configurando, configurar] = useState(false);
  const carregar = useCallback(async () => {
    try { definirHub(await pedir<HubDeNoticiasV1>('/api/noticias')); definirErro(''); }
    catch { definirErro('Não foi possível carregar as notícias. Tente novamente.'); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  const pendente = hub?.edicoes.some(e => ['fila', 'reservado', 'adiado'].includes(e.estado) || ['fila', 'reservado', 'adiado'].includes(e.estado_audio ?? '') || ['fila', 'reservado', 'adiado'].includes(e.estado_capa ?? ''));
  useEffect(() => {
    if (!pendente) return;
    const t = window.setInterval(() => { void carregar(); }, 5000);
    return () => window.clearInterval(t);
  }, [pendente, carregar]);
  useEffect(() => { definirFiltro('Todos'); }, [edicaoId]);
  const executar = async (acao: () => Promise<void>) => {
    definirOcupado(true); definirErro('');
    try { await acao(); await carregar(); }
    catch { definirErro('Não foi possível concluir esta ação. A edição anterior continua disponível.'); }
    finally { definirOcupado(false); }
  };
  const gerar = () => executar(async () => {
    const r = await pedir<{ id: string }>('/api/noticias/gerar', { method: 'POST' });
    ir({ nome: 'noticias', edicao_id: r.id });
  });
  const selecionada = edicaoId ? hub?.edicoes.find(e => e.id === edicaoId) : undefined;
  const conteudo = selecionada?.conteudo;
  const emPreparo = hub?.edicoes.find(e => e.id !== selecionada?.id && ['fila', 'reservado', 'adiado'].includes(e.estado));
  const materias = conteudo?.noticias.filter(n => filtro === 'Todos' || n.projeto === filtro) ?? [];
  return <div className="hub-noticias">
    <header className="biblioteca-cabecalho noticias-cabecalho">
      <h1><Icon name="texto" />Notícias</h1>
      <nav className="biblioteca-abas" aria-label="Navegar notícias"><Button variante="ghost" aria-current={!edicaoId ? 'page' : undefined} onClick={() => ir({ nome: 'noticias' })}>Edições</Button></nav>
      <div className="biblioteca-ferramentas"><Button variante="ghost" onClick={() => configurar(!configurando)} aria-expanded={configurando} aria-controls="preferencias-noticias">Sua edição</Button></div>
    </header>
    <div className="noticias-corpo">
    {erro && <div role="alert" className="noticias-aviso">{erro} <button onClick={() => { void carregar(); }}>Recarregar</button></div>}
    {!hub && !erro && <p role="status">Carregando suas edições…</p>}
    {hub && configurando && <section id="preferencias-noticias" className="noticias-config" aria-label="Preferências da edição"><h2>Sua edição diária</h2><p>IA aplicada ao Margem, Gibraltar e Series. Horário de São Paulo.</p>
      <label><input type="checkbox" checked={hub.agenda.ativa} disabled={ocupado} onChange={e => { const ativa = e.target.checked; void executar(async () => { await pedir('/api/noticias/agenda', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativa, hora: hub.agenda.hora }) }); }); }} /> Preparar automaticamente todos os dias</label>
      <label>Horário <select value={hub.agenda.hora} disabled={ocupado} onChange={e => { const hora = Number(e.target.value); void executar(async () => { await pedir('/api/noticias/agenda', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativa: hub.agenda.ativa, hora }) }); }); }}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
      <p className="noticias-discreto">A preparação começa nesse horário e continua em segundo plano. Se o servidor estiver desligado, retoma quando ele voltar no mesmo dia.</p><Button disabled={ocupado || !!pendente} onClick={() => { void gerar(); }}>Preparar edição de hoje</Button>
    </section>}
    {edicaoId && emPreparo && <p className="noticias-aviso" role="status">A edição de {data(emPreparo.dia)} está em preparação. Você pode continuar lendo a última revista.</p>}
    {hub && hub.edicoes.length === 0 && <section className="noticias-vazio"><span className="noticias-sobretitulo">UM NOVO HÁBITO DE LEITURA</span><h2>Suas notícias, com espaço para entender.</h2><p>A cada edição, uma seleção de mudanças em IA, as fontes para conferir e aplicações para os seus projetos. Ouça os destaques e guarde a revista na biblioteca para ler com calma.</p><Button disabled={ocupado} onClick={() => { void gerar(); }}>Preparar minha primeira edição</Button><p className="noticias-discreto">As notícias aparecem aqui depois da leitura e revisão das fontes.</p></section>}
    {hub && !edicaoId && hub.edicoes.length > 0 && <ArquivoDeNoticias edicoes={hub.edicoes} ir={ir} />}
    {hub && edicaoId && <div className="noticias-grade">
      <a className="noticias-voltar" href="/noticias" onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); ir({ nome: 'noticias' }); }}>← Todas as edições</a>
      <div className="noticias-revista">
        {!selecionada && <p role="alert">Esta edição não está entre as 30 mais recentes.</p>}
        {selecionada && !conteudo && <section className="noticias-vazio"><h2>{estado(selecionada.estado)}</h2><p>{selecionada.diagnostico ?? 'A revista fica disponível assim que a leitura e a revisão terminarem.'}</p>{['falhou', 'cancelado'].includes(selecionada.estado) && <Button disabled={ocupado} onClick={() => { void executar(async () => { await pedir(`/api/noticias/${selecionada.id}/repetir`, { method: 'POST' }); }); }}>Tentar novamente</Button>}</section>}
        {conteudo && selecionada && <><header className="noticias-editorial"><span className="noticias-sobretitulo">{data(selecionada.dia)} · IA APLICADA</span><h2>{conteudo.titulo}</h2><p>{conteudo.abertura}</p><Button disabled={ocupado} onClick={() => { void executar(async () => { const r = await pedir<{ documento_id: string }>(`/api/noticias/${selecionada.id}/ler`, { method: 'POST' }); ir({ nome: 'leitura', documento_id: r.documento_id }); }); }}>{selecionada.documento_id ? 'Continuar no leitor' : 'Guardar e abrir no leitor'}</Button></header>
          {selecionada.capa ? <figure className="noticias-capa"><img src={`/api/noticias/${selecionada.id}/capa`} alt={selecionada.capa.descricao} width={selecionada.capa.largura} height={selecionada.capa.altura} /><figcaption>Ilustração gerada por IA</figcaption></figure> : <div className="noticias-capa-estado">{['fila', 'reservado', 'adiado'].includes(selecionada.estado_capa ?? '') ? <p role="status">A capa está sendo preparada.</p> : <><span>A capa ainda não está disponível.</span><Button variante="ghost" disabled={ocupado} onClick={() => { void executar(async () => { await pedir(`/api/noticias/${selecionada.id}/capa`, { method: 'POST' }); }); }}>Preparar capa</Button></>}</div>}
          <section className="noticias-audio" aria-label="Ouvir a edição"><div><span className="noticias-sobretitulo">PARA OUVIR</span><h3>Os destaques em poucos minutos</h3></div>
            {selecionada.audio ? <><span>{duracao(selecionada.audio.duracao_s)} · voz sintética</span><PlayerDeNoticias key={selecionada.id} id={selecionada.id} duracao={selecionada.audio.duracao_s} /></> : <p>{!conteudo.roteiro ? 'Esta edição não tem destaques suficientes para um áudio.' : ['fila', 'reservado', 'adiado'].includes(selecionada.estado_audio ?? '') ? 'O áudio está sendo preparado. A revista já está disponível.' : 'A revista está pronta; o áudio ainda não está disponível.'}</p>}
            {conteudo.roteiro && !selecionada.audio && !['fila', 'reservado', 'adiado'].includes(selecionada.estado_audio ?? '') && <Button disabled={ocupado} onClick={() => { void executar(async () => { await pedir(`/api/noticias/${selecionada.id}/narrar`, { method: 'POST' }); }); }}>Preparar áudio</Button>}
            {conteudo.roteiro && <details><summary>Ler a transcrição</summary><p className="noticias-transcricao">{conteudo.roteiro}</p></details>}
          </section>
          {conteudo.noticias.length > 0 && <div className="noticias-filtros" role="group" aria-label="Filtrar por projeto">{['Todos', 'Margem', 'Gibraltar', 'Series', 'Geral'].map(p => <button key={p} aria-pressed={filtro === p} onClick={() => definirFiltro(p)}>{p}</button>)}</div>}
          {conteudo.noticias.length > 0 && materias.length === 0 && <p>Nenhuma matéria deste projeto nesta edição.</p>}
          {materias.map((n, i) => <article className="noticias-materia" key={n.titulo}><div className="noticias-meta"><span>{String(i + 1).padStart(2, '0')} / {n.projeto}</span><span>{n.natureza === 'novidade' ? 'Novidade' : n.natureza === 'atualizacao' ? 'Atualização' : 'Repertório'}</span></div><h3>{n.titulo}</h3><p>{n.resumo}</p><div className="noticias-aplicacao"><h4>Por que vale sua atenção</h4><p>{n.importancia}</p></div><p className="noticias-discreto">{n.limite}</p><details><summary>Conferir {n.evidencias.length === 1 ? 'a fonte' : `as ${String(n.evidencias.length)} evidências`}</summary>{n.evidencias.map((e, indice) => <div className="noticias-evidencia" key={`${e.fonte_url}-${String(indice)}`}><a href={e.fonte_url} target="_blank" rel="noreferrer">{conteudo.fontes.find(f => f.url === e.fonte_url)?.titulo ?? 'Abrir fonte'} ↗</a><blockquote>{e.citacao}</blockquote></div>)}</details></article>)}
          <section className="noticias-cobertura"><h3>O alcance desta edição</h3><p>Corte em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(conteudo.corte_em))}, horário de São Paulo. Fontes públicas selecionadas; não representa toda a produção de IA.</p><ul>{conteudo.cobertura.map(c => <li key={c.url}><a href={c.url} target="_blank" rel="noreferrer">{c.nome}</a><span>{c.estado === 'ok' ? 'Consultada' : c.estado === 'parcial' ? 'Cobertura parcial' : 'Indisponível'} · {c.lidos} páginas lidas</span>{c.limite && <small>{c.limite}</small>}</li>)}</ul><p className="noticias-discreto">Síntese gerada por IA, com revisão automática contra as fontes. As aplicações sugeridas não são testes já realizados.</p></section>
        </>}
      </div>
    </div>}
    </div>
  </div>;
}
