import type { MouseEvent } from 'react';
import type { ItemDoHubDeNoticias } from '@margem/contratos';
import type { Rota } from '../biblioteca/rotas';

const diaCurto = (dia: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${dia}T12:00:00Z`));
const mesExtenso = (mes: string) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-01T12:00:00Z`));

export function ArquivoDeNoticias({ edicoes, ir }: { edicoes: ItemDoHubDeNoticias[]; ir: (rota: Rota) => void }) {
  const meses = [...new Set(edicoes.map(e => e.dia.slice(0, 7)))];
  const abrir = (evento: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault(); ir({ nome: 'noticias', edicao_id: id });
  };
  return <div className="noticias-indice" aria-label="Edições de notícias">
    {meses.map(mes => <section className="noticias-mes" key={mes} aria-labelledby={`mes-${mes}`}>
      <h2 id={`mes-${mes}`}>{mesExtenso(mes)}</h2>
      <div>{edicoes.filter(e => e.dia.startsWith(mes)).map(e => {
        const c = e.conteudo;
        const projetos = [...new Set(c?.noticias.map(n => n.projeto) ?? [])];
        const falhou = ['falhou', 'cancelado'].includes(e.estado);
        return <article className={`noticias-entrada${e.capa ? ' com-capa' : ''}`} key={e.id}>
          <time dateTime={e.dia}>{diaCurto(e.dia)}</time>
          <div className="noticias-chamada">
            <h3><a href={`/noticias/${e.id}`} onClick={evento => abrir(evento, e.id)}>{c?.titulo ?? (falhou ? 'Edição interrompida' : 'Edição em preparação')}</a></h3>
            <p>{c?.abertura ?? (falhou ? 'Abra a edição para conferir o diagnóstico e tentar novamente.' : 'A leitura das fontes e a revisão estão em andamento.')}</p>
            <div className="noticias-chamada-meta">
              {projetos.map(p => <span className="noticias-tema" key={p}>{p === 'Geral' ? 'IA aplicada' : p}</span>)}
              {c && <span>{c.noticias.length} {c.noticias.length === 1 ? 'matéria' : 'matérias'}</span>}
              {e.audio && <span>Áudio · {Math.floor(e.audio.duracao_s / 60)}:{String(Math.floor(e.audio.duracao_s % 60)).padStart(2, '0')}</span>}
            </div>
          </div>
          {e.capa && <a className="noticias-miniatura" href={`/noticias/${e.id}`} aria-label={`Abrir ${c?.titulo ?? 'edição'}`} onClick={evento => abrir(evento, e.id)}><img src={`/api/noticias/${e.id}/capa`} alt="" width={e.capa.largura} height={e.capa.altura} loading="lazy" /></a>}
        </article>;
      })}</div>
    </section>)}
  </div>;
}
