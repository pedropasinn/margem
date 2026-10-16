/**
 * Cancelar e apagar na página do documento (V-T8):
 *
 * - `CancelarAnalise`: ao lado do andamento da análise, para o Codex e descarta o que ele já tinha feito
 *   nesta análise (os capítulos prontos ficam);
 * - `MenuDeApagar`: no menu "…", os três lotes ("Apagar análise do Codex…", "Apagar tudo meu…",
 *   "Apagar tudo…");
 * - `JanelaDeApagarEmLote`: a confirmação com a contagem de cada lote (do documento ou de um capítulo).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { mensagemDeErro } from '../biblioteca/erros';
import type { SituacaoDaPreparacao } from '../biblioteca/api';
import { Button } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { ConfirmarApagar } from './ConfirmarApagar';
import {
  CONFIRMACAO_DE_APAGAR_TUDO, apagarDoDocumento, apagaveis, cancelarDoDocumento, type Apagaveis, type ItemApagavel, type QuemApagar,
} from './api';
import './apagar.css';

export interface FontesDoApagar {
  apagaveis: typeof apagaveis;
  apagar: typeof apagarDoDocumento;
  cancelar: typeof cancelarDoDocumento;
}
export const FONTES_DO_APAGAR: FontesDoApagar = { apagaveis, apagar: apagarDoDocumento, cancelar: cancelarDoDocumento };

/** Há algo do Codex em andamento neste documento (a análise, o tipo de texto ou um item pedido)? */
export function analiseEmAndamento(situacao: SituacaoDaPreparacao | null): boolean {
  if (!situacao) return false;
  return situacao.estado === 'preparando' || situacao.estado === 'identificando' || situacao.itens.some((item) => item.estado === 'preparando');
}

export function CancelarAnalise({ documentoId, situacao, aoCancelar, fontes = FONTES_DO_APAGAR }: {
  documentoId: string; situacao: SituacaoDaPreparacao | null; aoCancelar: () => void; fontes?: FontesDoApagar;
}): ReactNode {
  const [confirmar, abrir] = useState(false);
  const [aviso, avisar] = useState<string | null>(null);
  if (!analiseEmAndamento(situacao) && aviso === null) return null;
  return <div className="cancelar-da-analise">
    {analiseEmAndamento(situacao) && <Button variante="ghost" tamanho="sm" className="cancelar-pedido" onClick={() => abrir(true)}>
      <Icon name="xis" size={16} />Cancelar análise</Button>}
    {aviso && <p className="dados" role="status">{aviso}</p>}
    {confirmar && <ConfirmarApagar titulo="Cancelar a análise?" rotuloDoBotao="Cancelar análise"
      texto="O Codex para agora e nada do que ele estava fazendo fica registrado. Capítulos que já estavam prontos continuam."
      aoFechar={() => abrir(false)}
      aoConfirmar={async () => {
        const resultado = await fontes.cancelar(documentoId);
        avisar(resultado.cancelados === 0 ? 'Não havia nada em andamento.' : 'Análise cancelada. Nada do que estava em andamento ficou.');
        aoCancelar();
      }} />}
  </div>;
}

export function MenuDeApagar({ aoEscolher }: { aoEscolher: (quem: QuemApagar) => void }): ReactNode {
  return <div className="menu-de-apagar" role="group" aria-label="Apagar">
    <Button variante="ghost" onClick={() => aoEscolher('codex')}><Icon name="lixeira" size={16} />Apagar análise do Codex…</Button>
    <Button variante="ghost" onClick={() => aoEscolher('leitor')}><Icon name="lixeira" size={16} />Apagar tudo meu…</Button>
    <Button variante="ghost" className="apagar-tudo" onClick={() => aoEscolher('tudo')}><Icon name="lixeira" size={16} />Apagar tudo…</Button>
  </div>;
}

/** As linhas da lista: "12 grifos" (os comentários entram como detalhe dos grifos). */
export function linhasDoLote(itens: readonly ItemApagavel[], doCodex = false): string[] {
  const doQue = doCodex ? ' do Codex' : '';
  const comentarios = itens.find((item) => item.chave === 'comentarios')?.total ?? 0;
  return itens.filter((item) => item.total > 0 && item.chave !== 'comentarios').map((item) => {
    const linha = `${String(item.total)} ${item.total === 1 ? item.singular : item.rotulo}`;
    if (item.chave === 'grifos' && comentarios > 0) return `${linha}${doQue} (${String(comentarios)} com comentário)`;
    if (item.chave === 'tipo') return 'o tipo de texto que o Codex reconheceu';
    if (item.chave === 'em_andamento') return `${String(item.total)} ${item.total === 1 ? 'pedido em andamento, que será cancelado' : 'pedidos em andamento, que serão cancelados'}`;
    return `${linha}${doQue}`;
  });
}

const TITULOS: Record<QuemApagar, string> = {
  codex: 'Apagar a análise do Codex?', leitor: 'Apagar tudo o que é seu?', tudo: 'Apagar tudo deste documento?',
};

function textoDoLote(quem: QuemApagar, capitulo: string | undefined): string {
  const onde = capitulo ? `no capítulo “${capitulo}”` : 'neste documento';
  switch (quem) {
    case 'codex': return `Sai tudo o que o Codex fez ${onde}. Seus grifos, notas e conexões ficam. Depois dá para analisar de novo, do zero.`;
    case 'leitor': return `Saem os seus grifos, notas, conexões e flashcards ${onde}. O que o Codex fez fica.`;
    default: return `Sai tudo ${onde}: o que o Codex fez e o que você fez. O texto continua na biblioteca.`;
  }
}

export function JanelaDeApagarEmLote({ documentoId, quem, secaoId, tituloDoCapitulo, aoFechar, aoApagar, fontes = FONTES_DO_APAGAR }: {
  documentoId: string; quem: QuemApagar; secaoId?: string; tituloDoCapitulo?: string;
  aoFechar: () => void; aoApagar: () => void; fontes?: FontesDoApagar;
}): ReactNode {
  const [conta, definirConta] = useState<Apagaveis | null>(null);
  const [falha, definirFalha] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    fontes.apagaveis(documentoId, secaoId).then((resposta) => { if (vivo) definirConta(resposta); },
      (erro: unknown) => { if (vivo) definirFalha(mensagemDeErro(erro, 'Não foi possível contar o que será apagado.')); });
    return () => { vivo = false; };
  }, [documentoId, secaoId, fontes]);
  const linhas = conta === null ? undefined : [
    ...(quem === 'leitor' ? [] : linhasDoLote(conta.codex, quem === 'tudo')),
    ...(quem === 'codex' ? [] : linhasDoLote(conta.leitor)),
  ];
  return <ConfirmarApagar titulo={TITULOS[quem]} texto={falha ?? textoDoLote(quem, tituloDoCapitulo)} carregando={conta === null && falha === null}
    itens={falha ? [] : linhas} vazio={quem === 'leitor' ? 'Você ainda não grifou nem anotou nada aqui.' : 'Não há nada para apagar aqui.'}
    {...(quem === 'tudo' ? { exigirFrase: CONFIRMACAO_DE_APAGAR_TUDO, rotuloDoBotao: 'Apagar tudo' } : {})}
    aoFechar={aoFechar}
    aoConfirmar={async () => {
      await fontes.apagar(documentoId, quem, {
        ...(secaoId === undefined ? {} : { secaoId }), ...(quem === 'tudo' ? { confirmacao: CONFIRMACAO_DE_APAGAR_TUDO } : {}),
      });
      aoApagar();
    }} />;
}
