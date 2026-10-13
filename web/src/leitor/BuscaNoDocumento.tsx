/**
 * Busca no documento inteiro (Ctrl/⌘ F no leitor). O leitor só tem um capítulo no DOM, então o
 * Ctrl+F do navegador não acha o resto: esta busca pergunta à API (`/api/documentos/:id/busca`),
 * lista as ocorrências por capítulo e anda entre elas com próximo/anterior (Enter, Shift Enter).
 * Quem abre o trecho achado é o dono do leitor (`aoIr`), que conhece capítulos e camadas.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { buscarNoDocumento } from '../biblioteca/api';
import type { RespostaDaBusca, ResultadoDaBusca } from '../biblioteca/tipos';
import { Icon } from '../ui/Icon';
import { IconButton, Input } from '../ui/Primitives';

export interface Ocorrencia {
  resultado: ResultadoDaBusca;
  /** A faixa do termo no bloco; `null` quando o serviço não pôde conferir o realce. */
  faixa: { inicio_utf16: number; fim_utf16: number } | null;
}

/** Cada termo achado vira uma parada do próximo/anterior; um bloco sem realce conferido vale uma. */
export function ocorrenciasDaResposta(resposta: RespostaDaBusca): Ocorrencia[] {
  return resposta.resultados.flatMap((resultado): Ocorrencia[] => resultado.ocorrencias.length === 0
    ? [{ resultado, faixa: null }]
    : resultado.ocorrencias.map((faixa) => ({ resultado, faixa })));
}

/** O trecho com os termos em `<mark>`: só texto, nunca HTML vindo do servidor. */
export function TrechoMarcado({ trecho }: { trecho: ResultadoDaBusca['trecho'] }): ReactNode {
  return <>{trecho.map((segmento, indice) => segmento.marcado
    ? <mark key={indice}>{segmento.texto}</mark>
    : <Fragment key={indice}>{segmento.texto}</Fragment>)}</>;
}

export interface PropsDaBuscaNoDocumento {
  documentoId: string;
  aoIr: (ocorrencia: Ocorrencia) => void;
  aoFechar: () => void;
  /** O campo, para o Ctrl F com o painel já aberto voltar a ele. */
  campoRef?: RefObject<HTMLInputElement>;
  buscar?: typeof buscarNoDocumento;
  /** Espera entre a digitação e a busca (ms). */
  espera?: number;
}

const MINIMO = 2;

export function BuscaNoDocumento({ documentoId, aoIr, aoFechar, campoRef, buscar = buscarNoDocumento, espera = 250 }: PropsDaBuscaNoDocumento): ReactNode {
  const [consulta, definirConsulta] = useState('');
  const [resposta, definirResposta] = useState<RespostaDaBusca | null>(null);
  const [estado, definirEstado] = useState<'parado' | 'buscando' | 'erro'>('parado');
  const [atual, definirAtual] = useState(-1);
  const proprio = useRef<HTMLInputElement>(null);
  const campo = campoRef ?? proprio;

  useEffect(() => { campo.current?.focus(); }, [campo]);
  useEffect(() => {
    const termo = consulta.trim();
    if (termo.length < MINIMO) { definirResposta(null); definirEstado('parado'); definirAtual(-1); return; }
    const controle = new AbortController();
    definirEstado('buscando');
    const tempo = setTimeout(() => {
      buscar(documentoId, termo, controle.signal).then((nova) => {
        definirResposta(nova); definirEstado('parado'); definirAtual(-1);
      }, () => { if (!controle.signal.aborted) definirEstado('erro'); });
    }, espera);
    return () => { clearTimeout(tempo); controle.abort(); };
  }, [consulta, documentoId, buscar, espera]);

  const ocorrencias = useMemo(() => resposta ? ocorrenciasDaResposta(resposta) : [], [resposta]);
  const grupos = useMemo(() => {
    const lista: { id: string; titulo: string; resultados: ResultadoDaBusca[] }[] = [];
    for (const resultado of resposta?.resultados ?? []) {
      const id = resultado.capitulo?.id ?? '';
      const ultimo = lista.at(-1);
      if (ultimo && ultimo.id === id) ultimo.resultados.push(resultado);
      else lista.push({ id, titulo: resultado.capitulo?.titulo ?? 'Fora dos capítulos', resultados: [resultado] });
    }
    return lista;
  }, [resposta]);

  const irPara = (indice: number) => {
    const ocorrencia = ocorrencias[indice];
    if (!ocorrencia) return;
    definirAtual(indice);
    aoIr(ocorrencia);
  };
  const andar = (passo: 1 | -1) => {
    if (ocorrencias.length === 0) return;
    irPara(atual < 0 ? (passo > 0 ? 0 : ocorrencias.length - 1) : (atual + passo + ocorrencias.length) % ocorrencias.length);
  };
  const ativo = ocorrencias[atual]?.resultado.bloco_id;

  const contagem = consulta.trim().length < MINIMO ? ''
    : estado === 'buscando' ? 'Buscando…'
    : estado === 'erro' ? 'Não foi possível buscar'
    : ocorrencias.length === 0 ? 'Nada encontrado'
    : atual < 0 ? `${String(ocorrencias.length)} ${ocorrencias.length === 1 ? 'ocorrência' : 'ocorrências'}`
    : `${String(atual + 1)} de ${String(ocorrencias.length)}`;

  return <section className="busca-no-documento" role="search" aria-label="Buscar no documento"
    onKeyDown={(evento) => { if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); aoFechar(); } }}>
    <div className="busca-no-documento-campo">
      <span className="busca-no-documento-lupa"><Icon name="buscar" size={16} /></span>
      <Input ref={campo} type="search" aria-label="Buscar no documento" placeholder="Buscar no documento" value={consulta}
        onChange={(evento) => definirConsulta(evento.target.value)}
        onKeyDown={(evento) => { if (evento.key === 'Enter') { evento.preventDefault(); andar(evento.shiftKey ? -1 : 1); } }} />
      <span className="busca-no-documento-contagem" role="status">{contagem}</span>
      <IconButton aria-label="Ocorrência anterior" title="Anterior (Shift Enter)" disabled={ocorrencias.length === 0} onClick={() => andar(-1)}><Icon name="anterior" size={16} /></IconButton>
      <IconButton aria-label="Próxima ocorrência" title="Próxima (Enter)" disabled={ocorrencias.length === 0} onClick={() => andar(1)}><Icon name="proximo" size={16} /></IconButton>
      <IconButton aria-label="Fechar a busca" title="Fechar (Esc)" onClick={aoFechar}><Icon name="xis" size={16} /></IconButton>
    </div>
    {grupos.length > 0 && <ol className="busca-no-documento-lista">
      {grupos.map((grupo) => <li key={grupo.id || 'fora'}>
        <p className="busca-no-documento-capitulo"><span>{grupo.titulo}</span><span>{grupo.resultados.reduce((soma, r) => soma + Math.max(1, r.ocorrencias.length), 0)}</span></p>
        <ul>{grupo.resultados.map((resultado) => <li key={resultado.bloco_id}>
          <button type="button" className="busca-no-documento-trecho" aria-current={resultado.bloco_id === ativo ? 'true' : undefined}
            onClick={() => irPara(ocorrencias.findIndex((o) => o.resultado === resultado))}>
            <TrechoMarcado trecho={resultado.trecho} />{resultado.pagina !== null && <span className="busca-no-documento-pagina"> · p. {resultado.pagina}</span>}
          </button>
        </li>)}</ul>
      </li>)}
    </ol>}
    {resposta && resposta.total > resposta.resultados.length && <p className="busca-no-documento-nota">Mostrando os {resposta.resultados.length} primeiros trechos de {resposta.total}. Refine a busca para ver o resto.</p>}
  </section>;
}
