import { useEffect, useState } from 'react';
import type { PropostaDeAncora } from '@margem/core';
import { pedir } from './api';
import type { VersaoResumida } from './tipos';
import { Button } from '../ui/Primitives';
interface Relatorio {
  mesmo_original: boolean;
  totais: { iguais: number; sem_par_antes: number; sem_par_depois: number; anotacoes: number };
  antes: { id: string; tipo: string; texto: string }[];
  depois: { id: string; tipo: string; texto: string }[];
  anotacoes: { id: string; texto: string; proposta: PropostaDeAncora }[];
  ha_proxima: boolean;
}
export function ComparacaoDeVersoes({ versoes }: { versoes: VersaoResumida[] }) {
  const [antes, escolherAntes] = useState(versoes[1]?.id ?? versoes[0]!.id);
  const [depois, escolherDepois] = useState(versoes[0]!.id);
  const [pagina, escolherPagina] = useState(0);
  const [relatorio, definir] = useState<Relatorio | null>(null);
  const [erro, falhar] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    definir(null); falhar(null);
    void pedir<Relatorio>(`/api/versoes/${antes}/comparar/${depois}?pagina=${pagina}`).then(
      r => { if (ativo) definir(r); },
      e => { if (ativo) falhar(e instanceof Error ? e.message : 'Não foi possível comparar.'); });
    return () => { ativo = false; };
  }, [antes, depois, pagina]);
  const seletor = (rotulo: string, valor: string, escolher: (id: string) => void) => <label>{rotulo}<select value={valor} onChange={e => { escolher(e.target.value); escolherPagina(0); }}>{versoes.map(v => <option key={v.id} value={v.id}>Versão {v.numero} · {v.motor}</option>)}</select></label>;
  return <div className="formulario">
    {seletor('Antes', antes, escolherAntes)}{seletor('Depois', depois, escolherDepois)}
    {erro && <p role="alert">{erro}</p>}
    {!relatorio && !erro && <p role="status">Comparando…</p>}
    {relatorio && <>
      <p>{relatorio.totais.iguais} blocos com texto e tipo iguais; {relatorio.totais.sem_par_antes} sem par antes e {relatorio.totais.sem_par_depois} depois.</p>
      <p>Blocos sem par podem ter mudado de divisão. Esta comparação não certifica perda de conteúdo nem compara geometria ou estilos.</p>
      {!relatorio.mesmo_original && <p>As fontes são diferentes. Não há proposta de migração de anotações.</p>}
      {(['antes', 'depois'] as const).map(lado => <section key={lado}><h3>{lado === 'antes' ? 'Antes' : 'Depois'} — blocos sem par</h3>{relatorio[lado].map(b => <details key={b.id}><summary>{b.tipo} · {Array.from(b.texto).slice(0, 80).join('')}</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b.texto}</p></details>)}</section>)}
      <section><h3>Anotações — localização na outra versão</h3><p>As anotações originais são preservadas. Os resultados abaixo são propostas para revisão, ainda sem aplicação.</p>
        {relatorio.anotacoes.map(n => <details key={n.id}><summary>{Array.from(n.texto).slice(0, 80).join('')}</summary><p>{n.texto}</p>
          {n.proposta.tipo === 'proposta' ? <><p>Passagem localizada {n.proposta.criterio === 'citacao_e_contexto' ? 'com contexto' : 'pela citação literal, sem o contexto anterior'}.</p><blockquote>{n.proposta.ancora.citacao}</blockquote></>
            : n.proposta.tipo === 'ambigua' ? <p>Ambígua: {n.proposta.ocorrencias} ocorrências. É preciso escolher a passagem.</p>
            : <p>{({ fonte_diferente: 'Fonte diferente.', origem_invalida: 'A âncora original não confere.', citacao_ausente: 'Citação não encontrada literalmente.' })[n.proposta.motivo]}</p>}
        </details>)}
      </section>
      <div className="button-row"><Button disabled={pagina === 0} onClick={() => escolherPagina(pagina - 1)}>Anterior</Button><span>Página {pagina + 1}</span><Button disabled={!relatorio.ha_proxima} onClick={() => escolherPagina(pagina + 1)}>Próxima</Button></div>
    </>}
  </div>;
}
