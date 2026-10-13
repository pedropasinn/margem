/**
 * "Gerar narração" (J106): o capítulo ou o trecho selecionado, com a voz da ElevenLabs da pessoa.
 * Mostra a estimativa (frases, caracteres, créditos, referência em dólares) e só gera quando a
 * pessoa confirma; depois acompanha o progresso e mostra o erro com a frase clara do servidor.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { AncoraV1, Id } from '@margem/contratos';
import { ErroDaApi } from '../biblioteca/api';
import { BarraDeProgresso } from '../ui/Icon';
import { Button, SegmentedControl } from '../ui/Primitives';
import { gerarNarracao, numero, previaDaNarracao, rotuloDoCusto, type PreviaDaNarracao, type SituacaoDaNarracao } from './api';
import './audio.css';

export interface PropsDeGerarNarracao {
  versaoId: Id;
  secaoId: Id;
  /** A seleção no momento em que o painel abriu (narrar só o trecho). */
  trecho: AncoraV1 | null;
  situacao: SituacaoDaNarracao | null;
  aoPedir: (situacao: SituacaoDaNarracao) => void;
  aoConfigurar: () => void;
  aoOuvir?: () => void;
}

type EstadoDaPrevia = { estado: 'carregando' } | { estado: 'erro'; mensagem: string } | { estado: 'pronta'; previa: PreviaDaNarracao };

const mensagem = (erro: unknown): string => erro instanceof ErroDaApi ? erro.detalhe ?? 'Não foi possível falar com o Margem.' : 'Não foi possível falar com o Margem.';

export function GerarNarracao({ versaoId, secaoId, trecho, situacao, aoPedir, aoConfigurar, aoOuvir }: PropsDeGerarNarracao): ReactNode {
  const [escopo, escolherEscopo] = useState<'capitulo' | 'trecho'>(trecho ? 'trecho' : 'capitulo');
  const [previa, definirPrevia] = useState<EstadoDaPrevia>({ estado: 'carregando' });
  const [enviando, enviar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const alvo = escopo === 'trecho' ? trecho : null;
  useEffect(() => {
    let vivo = true;
    definirPrevia({ estado: 'carregando' });
    previaDaNarracao(versaoId, secaoId, alvo).then(
      (p) => { if (vivo) definirPrevia({ estado: 'pronta', previa: p }); },
      (e: unknown) => { if (vivo) definirPrevia({ estado: 'erro', mensagem: mensagem(e) }); },
    );
    return () => { vivo = false; };
  }, [versaoId, secaoId, alvo]);

  const emCurso = situacao?.estado === 'pendente' || situacao?.estado === 'executando';
  const gerar = async (p: PreviaDaNarracao): Promise<void> => {
    enviar(true); definirErro(null);
    try { aoPedir(await gerarNarracao(versaoId, secaoId, alvo, p.caracteres)); }
    catch (e) { definirErro(mensagem(e)); }
    finally { enviar(false); }
  };

  return <section className="gerar-narracao formulario" aria-label="Gerar narração">
    <p className="secundario">Com a sua conta da ElevenLabs: o custo vai direto para ela. O áudio fica guardado neste computador e toca no player, frase por frase.</p>
    {trecho && <SegmentedControl rotulo="O que narrar" valor={escopo} aoMudar={(v) => escolherEscopo(v === 'trecho' ? 'trecho' : 'capitulo')}
      opcoes={[{ valor: 'capitulo', rotulo: 'Capítulo inteiro' }, { valor: 'trecho', rotulo: 'Só o trecho selecionado' }]} />}
    {previa.estado === 'carregando' && <p className="secundario" role="status">Calculando a estimativa…</p>}
    {previa.estado === 'erro' && <p className="aviso" role="alert">{previa.mensagem}</p>}
    {previa.estado === 'pronta' && <>
      <dl className="estimativa-da-narracao">
        <div><dt>Voz</dt><dd>{previa.previa.voz_nome ?? 'nenhuma escolhida'}</dd></div>
        <div><dt>Modelo</dt><dd>{previa.previa.modelo_nome}</dd></div>
        <div><dt>Texto</dt><dd>{numero(previa.previa.cenas)} {previa.previa.cenas === 1 ? 'frase' : 'frases'} · {numero(previa.previa.caracteres)} caracteres</dd></div>
        <div><dt>Custo estimado</dt><dd>{numero(previa.previa.creditos)} créditos · {rotuloDoCusto(previa.previa.custo_usd)}</dd></div>
      </dl>
      <p className="secundario">O valor em dólares é a referência do uso pago da API; no plano mensal, desconta dos créditos da conta.</p>
      {previa.previa.voz_id === null
        ? <p className="aviso">Escolha uma voz antes. <Button variante="ghost" className="small" onClick={aoConfigurar}>Abrir Configurações → Áudio</Button></p>
        : <div className="button-row">
          <Button variante="primario" disabled={enviando || emCurso} onClick={() => void gerar(previa.previa)}>
            {emCurso ? 'Gerando…' : `Gerar narração · ${numero(previa.previa.caracteres)} caracteres`}
          </Button>
          <Button variante="ghost" onClick={aoConfigurar}>Trocar voz ou modelo</Button>
        </div>}
    </>}
    {erro && <p className="aviso" role="alert">{erro}</p>}
    <SituacaoDaGeracao situacao={situacao} {...(aoOuvir ? { aoOuvir } : {})} />
  </section>;
}

/** O pedido mais recente do capítulo: na fila, gerando (com progresso), pronto ou com erro. */
export function SituacaoDaGeracao({ situacao, aoOuvir }: { situacao: SituacaoDaNarracao | null; aoOuvir?: () => void }): ReactNode {
  if (!situacao || situacao.estado === 'nenhum') return null;
  if (situacao.estado === 'pendente') return <p className="situacao-da-narracao" role="status">Na fila; começa em instantes.</p>;
  if (situacao.estado === 'executando') {
    const p = situacao.progresso;
    return <div className="situacao-da-narracao" role="status">
      <span>{p && p.total > 0 ? `Gerando a narração: parte ${numero(Math.min(p.feitos + 1, p.total))} de ${numero(p.total)}.` : 'Gerando a narração…'}</span>
      <BarraDeProgresso valor={p && p.total > 0 ? 100 * p.feitos / p.total : 0} rotulo="Progresso da narração" />
    </div>;
  }
  if (situacao.estado === 'falhou') return <p className="aviso" role="alert">{situacao.motivo ?? 'A narração não pôde ser gerada.'}</p>;
  return <p className="situacao-da-narracao" role="status">Narração pronta.{aoOuvir && <> <Button variante="ghost" className="small" onClick={aoOuvir}>Ouvir agora</Button></>}</p>;
}
