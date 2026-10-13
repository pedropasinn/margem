import { useRef, useState } from 'react';
import { BotaoDeTocar, BotaoDoPlayer, formatarTempo, PlayerCentral, TrilhaCentral } from '../leitor/player/PlayerCentral';

export function PlayerDeNoticias({ id, duracao }: { id: string; duracao: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [tempo, definirTempo] = useState(0);
  const [tocando, definirTocando] = useState(false);
  const [velocidade, definirVelocidade] = useState(1);
  const [erro, definirErro] = useState(false);
  const buscar = (t: number) => {
    if (!audio.current) return;
    const alvo = Math.max(0, Math.min(duracao, t));
    audio.current.currentTime = alvo; definirTempo(alvo);
  };
  const alternar = () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) el.pause();
    else { definirErro(false); if (el.ended) buscar(0); void el.play().catch(() => definirErro(true)); }
  };
  return <div className="noticias-player">
    <audio ref={audio} aria-label="Áudio da edição" preload="metadata" src={`/api/noticias/${id}/audio`}
      onTimeUpdate={e => definirTempo(e.currentTarget.currentTime)} onPlay={() => definirTocando(true)} onPause={() => definirTocando(false)} onEnded={() => definirTocando(false)} onError={() => { definirTocando(false); definirErro(true); }} />
    <PlayerCentral rotulo="Player da edição" className="player-da-noticia" aoTeclar={e => {
      if ((e.target as HTMLElement).getAttribute('role') !== 'slider') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); buscar(tempo + (e.key === 'ArrowLeft' ? -10 : 10)); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); buscar(e.key === 'Home' ? 0 : duracao); }
      else if (e.key === ' ') { e.preventDefault(); alternar(); }
    }}>
      <TrilhaCentral t={tempo} duracao={duracao} marcas={[]} aoPassar={buscar} rotulo="Posição na edição" />
      <div className="linha-do-player">
        <div className="esquerda-do-player"><span className="detalhe-do-player">{formatarTempo(tempo)} / {formatarTempo(duracao)}</span></div>
        <div className="centro-do-player"><BotaoDoPlayer icone="voltar-trecho" rotulo="Voltar 10 segundos" onClick={() => buscar(tempo - 10)} /><BotaoDeTocar tocando={tocando} aoAlternar={alternar} /><BotaoDoPlayer icone="avancar-trecho" rotulo="Avançar 10 segundos" onClick={() => buscar(tempo + 10)} /></div>
        <div className="direita-do-player"><button type="button" className="velocidade-central" aria-label="Velocidade" onClick={() => { const nova = velocidade >= 2 ? 1 : velocidade + .25; definirVelocidade(nova); if (audio.current) audio.current.playbackRate = nova; }}>{String(velocidade).replace('.', ',')}×</button></div>
      </div>
    </PlayerCentral>
    {erro && <p role="alert">Não foi possível reproduzir o áudio. Tente tocar novamente.</p>}
  </div>;
}
