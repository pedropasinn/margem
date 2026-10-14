/**
 * Obra não identificada (V-W5): o Codex não reconheceu a obra e a análise foi feita só pela imagem. O
 * bloco diz isso numa frase, mostra o palpite do Codex como palpite (nunca como identificação) e leva a
 * "Informar título e artista", que prepara de novo com fontes. Usado no leitor do quadro, no painel da
 * Biblioteca e na obra em preparo.
 */
import type { ReactNode } from 'react';
import { Button } from '../ui/Primitives';
import { CONFIANCA_DO_PALPITE } from './rotulos';
import type { PalpiteDaObra } from './tipos';
import './sem-identificacao.css';

/** "Talvez «Educação Obrigatória», de Briton Rivière (1887)." quando o Codex arriscou um nome. */
export function nomeDoPalpite(palpite: PalpiteDaObra): string | null {
  if (palpite.titulo && palpite.artista) return `Talvez «${palpite.titulo}», de ${palpite.artista}${palpite.ano ? ` (${palpite.ano})` : ''}.`;
  if (palpite.artista) return `Talvez de ${palpite.artista}.`;
  if (palpite.titulo) return `Talvez «${palpite.titulo}».`;
  return null;
}

export function PalpiteDoCodex({ palpite }: { palpite: PalpiteDaObra }): ReactNode {
  const nome = nomeDoPalpite(palpite);
  return <div className="palpite-da-obra">
    <span className="palpite-rotulo">Palpite do Codex · {CONFIANCA_DO_PALPITE[palpite.confianca]}</span>
    {nome && <p className="palpite-nome">{nome}</p>}
    <p>{palpite.texto}</p>
  </div>;
}

export function SemIdentificacao({ palpite, emPreparo = false, aoIdentificar, ocupado = false }: {
  palpite?: PalpiteDaObra | null; emPreparo?: boolean; aoIdentificar?: () => void; ocupado?: boolean;
}): ReactNode {
  return <section className="obra-sem-identificacao" aria-label="Obra não identificada">
    <p className="sem-identificacao-titulo">{emPreparo ? 'Sendo analisada só pela imagem' : 'Analisada só pela imagem'}</p>
    <p>O Codex não reconheceu esta obra. A análise mostra o que se vê e o que se pode inferir do que se vê, sem fatos históricos.</p>
    {palpite && <PalpiteDoCodex palpite={palpite} />}
    {aoIdentificar && <div className="button-row"><Button disabled={ocupado} onClick={aoIdentificar}>Informar título e artista</Button></div>}
    {aoIdentificar && <p className="sem-identificacao-nota">Com título e artista, o Margem procura fontes públicas e prepara uma análise nova. Esta continua guardada.</p>}
  </section>;
}
