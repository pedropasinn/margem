/**
 * As perguntas de um formulário da sala, com os tipos do contrato (escala 1–5, escolha única,
 * texto curto, texto longo). Serve ao testador (respondendo) e ao leitor (prévia ao montar).
 */
import { useId, type ReactNode } from 'react';
import { LIMITE_TEXTO_CURTO, LIMITE_TEXTO_LONGO, type PerguntaDaSalaV1, type ValorDaRespostaDaSala } from '@margem/contratos/sala';
import { Input, SegmentedControl, Select, Textarea } from '../ui/Primitives';

export interface PropsDosCampos {
  perguntas: readonly PerguntaDaSalaV1[];
  valores: Readonly<Record<string, ValorDaRespostaDaSala>>;
  aoMudar: (id: string, valor: ValorDaRespostaDaSala | null) => void;
  desabilitado?: boolean;
  /** Ids das perguntas que faltam (destacadas depois de um envio recusado). */
  faltando?: ReadonlySet<string>;
}

function Pergunta({ pergunta, valor, aoMudar, desabilitado, falta }: {
  pergunta: PerguntaDaSalaV1; valor: ValorDaRespostaDaSala | undefined; aoMudar: (valor: ValorDaRespostaDaSala | null) => void; desabilitado: boolean; falta: boolean;
}): ReactNode {
  const id = useId();
  const rotulo = <span className="pergunta-enunciado" id={`${id}-rotulo`}>{pergunta.enunciado}{pergunta.obrigatoria && <span className="pergunta-obrigatoria" aria-label="obrigatória"> *</span>}</span>;
  const ajuda = pergunta.ajuda ? <span className="pergunta-ajuda" id={`${id}-ajuda`}>{pergunta.ajuda}</span> : null;
  if (pergunta.tipo === 'escala') {
    return <div className="pergunta" data-falta={falta || undefined} role="group" aria-labelledby={`${id}-rotulo`}>
      {rotulo}{ajuda}
      <SegmentedControl rotulo={pergunta.enunciado} className="escala-da-pergunta" valor={typeof valor === 'number' ? String(valor) : ''}
        aoMudar={(novo) => { if (!desabilitado) aoMudar(Number(novo)); }}
        opcoes={[1, 2, 3, 4, 5].map((n) => ({ valor: String(n), rotulo: String(n) }))} />
      {pergunta.rotulos && <span className="escala-rotulos" aria-hidden="true"><span>1 · {pergunta.rotulos.minimo}</span><span>{pergunta.rotulos.maximo} · 5</span></span>}
    </div>;
  }
  if (pergunta.tipo === 'escolha') {
    const opcoes = pergunta.opcoes ?? [];
    return <div className="pergunta" data-falta={falta || undefined} role="group" aria-labelledby={`${id}-rotulo`}>
      {rotulo}{ajuda}
      {opcoes.length <= 4
        ? <SegmentedControl rotulo={pergunta.enunciado} valor={typeof valor === 'string' ? valor : ''} aoMudar={(novo) => { if (!desabilitado) aoMudar(novo); }}
          opcoes={opcoes.map((opcao) => ({ valor: opcao, rotulo: opcao }))} />
        : <Select aria-label={pergunta.enunciado} value={typeof valor === 'string' ? valor : ''} disabled={desabilitado} onChange={(e) => aoMudar(e.target.value === '' ? null : e.target.value)}>
          <option value="">Escolha…</option>{opcoes.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
        </Select>}
    </div>;
  }
  const texto = typeof valor === 'string' ? valor : '';
  return <label className="pergunta" data-falta={falta || undefined}>
    {rotulo}{ajuda}
    {pergunta.tipo === 'texto_curto'
      ? <Input value={texto} maxLength={LIMITE_TEXTO_CURTO} disabled={desabilitado} aria-describedby={ajuda ? `${id}-ajuda` : undefined} onChange={(e) => aoMudar(e.target.value === '' ? null : e.target.value)} />
      : <Textarea value={texto} maxLength={LIMITE_TEXTO_LONGO} rows={4} disabled={desabilitado} aria-describedby={ajuda ? `${id}-ajuda` : undefined} onChange={(e) => aoMudar(e.target.value === '' ? null : e.target.value)} />}
  </label>;
}

export function CamposDoFormulario({ perguntas, valores, aoMudar, desabilitado = false, faltando }: PropsDosCampos): ReactNode {
  return <div className="campos-do-formulario">
    {perguntas.map((pergunta) => <Pergunta key={pergunta.id} pergunta={pergunta} valor={valores[pergunta.id]} desabilitado={desabilitado}
      falta={faltando?.has(pergunta.id) ?? false} aoMudar={(valor) => aoMudar(pergunta.id, valor)} />)}
  </div>;
}

/** Quantas perguntas (gerais e por documento) já têm resposta, para o progresso da capa. */
export function progressoDoFormulario(
  perguntas: { geral: readonly PerguntaDaSalaV1[]; por_documento: readonly PerguntaDaSalaV1[] }, documentos: readonly string[],
  respostas: { geral: Readonly<Record<string, ValorDaRespostaDaSala>>; por_documento: Readonly<Record<string, Readonly<Record<string, ValorDaRespostaDaSala>>>> } | null,
): { respondidas: number; total: number } {
  const total = perguntas.geral.length + perguntas.por_documento.length * documentos.length;
  if (!respostas) return { respondidas: 0, total };
  const respondida = (valor: ValorDaRespostaDaSala | undefined) => valor !== undefined && !(typeof valor === 'string' && valor.trim() === '');
  const geral = perguntas.geral.filter((p) => respondida(respostas.geral[p.id])).length;
  const porDocumento = documentos.reduce((soma, documento) => soma + perguntas.por_documento.filter((p) => respondida(respostas.por_documento[documento]?.[p.id])).length, 0);
  return { respondidas: geral + porDocumento, total };
}
