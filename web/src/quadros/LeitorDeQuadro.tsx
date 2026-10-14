/**
 * O leitor de um quadro (`/quadros/<slug>`): busca a obra, a análise escolhida e a narração na API e
 * entrega tudo à parte visual (`QuadroAberto`, onde estão a descrição do leitor e os atalhos).
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Rota } from '../biblioteca/rotas';
import { arquivoDaNarracaoDoQuadro, marcarQuadroVisto, obterAnaliseDoQuadro, obterNarracaoDoQuadro, obterQuadro } from './api';
import { IdentificarObra } from './NaBiblioteca';
import { QuadroAberto } from './QuadroAberto';
import { TourDoQuadro } from '../onboarding/TourDoLeitor';
import type { AnaliseDoQuadro, DetalheDoQuadro, ManifestoDaNarracao } from './tipos';

export function LeitorDeQuadro({ slug, ir }: { slug: string; ir: (destino: Rota, substituir?: boolean) => void }): ReactNode {
  const [detalhe, definirDetalhe] = useState<DetalheDoQuadro | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [tentativa, tentar] = useState(0);
  const [analise, definirAnalise] = useState<AnaliseDoQuadro | null>(null);
  const [carregandoAnalise, carregarAnalise] = useState(false);
  const [manifesto, definirManifesto] = useState<ManifestoDaNarracao | null>(null);
  const [identificando, identificar] = useState(false);

  useEffect(() => {
    let vivo = true;
    definirErro(null);
    obterQuadro(slug).then((d) => { if (!vivo) return; definirDetalhe(d); definirAnalise(d.analise); marcarQuadroVisto(slug); },
      (e: unknown) => { if (vivo) definirErro(e instanceof Error && e.message === 'obra_inexistente' ? 'Este quadro não está na sua biblioteca (ou ainda está sendo preparado).' : 'Não foi possível abrir o quadro.'); });
    return () => { vivo = false; };
  }, [slug, tentativa]);

  // A narração da análise, quando houver; sem ela, o ritmo de leitura.
  useEffect(() => {
    let vivo = true;
    definirManifesto(null);
    if (analise?.audio) void obterNarracaoDoQuadro(slug, analise.rotulo).then((m) => { if (vivo) definirManifesto(m); }, () => {});
    return () => { vivo = false; };
  }, [slug, analise]);

  const escolherAnalise = (rotulo: string) => {
    if (!detalhe || rotulo === analise?.rotulo) return;
    carregarAnalise(true);
    obterAnaliseDoQuadro(slug, rotulo).then((a) => { definirAnalise(a); }, () => {}).finally(() => carregarAnalise(false));
  };

  const voltar = () => { if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) window.history.back(); else ir({ nome: 'biblioteca', tipo: 'quadros' }); };

  if (erro) return <div className="leitor-de-quadro estado-do-quadro"><p role="alert">{erro}</p><button type="button" className="ui-button ui-secundario" onClick={() => tentar((n) => n + 1)}>Tentar novamente</button></div>;
  if (!detalhe || !analise) return <div className="leitor-de-quadro estado-do-quadro"><p role="status">Abrindo o quadro…</p></div>;
  // Obra não identificada que a pessoa adicionou (V-W5): título e artista podem ser informados aqui; a obra
  // volta a ser preparada (com fontes) e aparece na Biblioteca enquanto isso.
  const podeIdentificar = detalhe.nao_identificada === true && detalhe.removivel === true;
  const palpite = detalhe.palpite ?? null;
  return <>
    <QuadroAberto detalhe={detalhe} analise={analise} manifesto={manifesto} carregandoAnalise={carregandoAnalise} aoEscolherAnalise={escolherAnalise}
      audio={analise.audio && manifesto ? arquivoDaNarracaoDoQuadro(slug, analise.rotulo) : null} hrefDeVolta="/biblioteca?tipo=quadros" aoVoltar={voltar}
      {...(podeIdentificar ? { aoIdentificar: () => identificar(true) } : {})} />
    {identificando && <IdentificarObra quadro={{ slug, titulo: null, artista: null, ano: null }} palpite={palpite}
      aoFechar={() => identificar(false)} aoSalvar={() => { identificar(false); ir({ nome: 'biblioteca', tipo: 'quadros' }); }} />}
    {/* Na primeira abertura de um quadro, três dicas (V-D4): percorrer, a narração e as fontes. */}
    <TourDoQuadro ir={ir} />
  </>;
}
