/**
 * O painel direito do quadro, na casca do `PainelDoLeitor`: abas Info (identidade, localização, imagem),
 * Análise (a tese, as afirmações por dimensão de estudo, com tipo e confiança; clicar acende a região) e
 * Fontes (o dossiê e os limites). No alto da Análise, o seletor entre as análises da obra (Referência ×
 * gerações do algoritmo), para comparar.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AfirmacaoDaObra, ModeloDaObraV1 } from '@margem/contratos';
import { Icon } from '../ui/Icon';
import { Button, IconButton, Select } from '../ui/Primitives';
import { TipoDoDocumento } from '../ui/TipoDoDocumento';
import { formatarTempo } from '../leitor/player/PlayerCentral';
import { agruparAfirmacoes, linkDaFonte, ROTULO_DA_CATEGORIA, ROTULO_DA_CONFIANCA, ROTULO_DO_TIPO } from './rotulos';
import { SemIdentificacao } from './SemIdentificacao';
import { obraNaoIdentificada } from '../../../core/src/arte';
import type { AnaliseDoQuadro, DetalheDoQuadro } from './tipos';

export type AbaDoQuadro = 'info' | 'analise' | 'fontes';
const CHAVE_DA_ABA = 'margem:quadro:aba';
export function abaGuardada(): AbaDoQuadro {
  try { const v = localStorage.getItem(CHAVE_DA_ABA); return v === 'info' || v === 'fontes' ? v : 'analise'; } catch { return 'analise'; }
}

interface Props {
  detalhe: DetalheDoQuadro;
  analise: AnaliseDoQuadro;
  carregandoAnalise: boolean;
  duracao_s: number;
  narrada: boolean;
  afirmacaoEscolhida: string | null;
  aoEscolherAnalise: (rotulo: string) => void;
  aoEscolherAfirmacao: (afirmacao: AfirmacaoDaObra) => void;
  aoPassarAfirmacao: (afirmacao: AfirmacaoDaObra | null) => void;
  aoOuvir: () => void;
  aoPercorrer: () => void;
  aoFechar: () => void;
  /** Obra não identificada da pessoa (V-W5): abre "Informar título e artista". */
  aoIdentificar?: () => void;
}

/** O título de uma fonte: link quando é pública; a imagem enviada é só o nome. */
function Fonte({ fonte }: { fonte: { url: string; titulo: string } }): ReactNode {
  const link = linkDaFonte(fonte);
  return link ? <a href={link} target="_blank" rel="noreferrer">{fonte.titulo}</a> : <span>{fonte.titulo}</span>;
}

const naoVerificada = 'não verificada';
const exposicao = (v: boolean | null): string => (v === null ? naoVerificada : v ? 'confirmada' : 'não exposta');

export function Regioes({ modelo, afirmacao }: { modelo: ModeloDaObraV1; afirmacao: AfirmacaoDaObra }): ReactNode {
  const rotulos = afirmacao.regioes.map((id) => modelo.regioes.find((r) => r.id === id)?.rotulo).filter((r): r is string => r !== undefined);
  return rotulos.length ? <span className="regioes-da-afirmacao"><Icon name="area" size={13} />{rotulos.join(' · ')}</span> : null;
}

export function PainelDoQuadro({ detalhe, analise, carregandoAnalise, duracao_s, narrada, afirmacaoEscolhida, aoEscolherAnalise, aoEscolherAfirmacao, aoPassarAfirmacao, aoOuvir, aoPercorrer, aoFechar, aoIdentificar }: Props): ReactNode {
  const [aba, definirAba] = useState<AbaDoQuadro>(abaGuardada);
  const mudarAba = (nova: AbaDoQuadro) => { definirAba(nova); try { localStorage.setItem(CHAVE_DA_ABA, nova); } catch { /* sem storage */ } };
  const id = useId();
  const cabeca = useRef<HTMLDivElement>(null);
  const conteudo = useRef<HTMLDivElement>(null);
  const m = analise.modelo;
  const info = detalhe.imagem.info;
  const fonteDaImagem = m.fontes.find((f) => f.id === m.imagem.fonte_id);
  // A análise aberta é só pela imagem (V-W5): sem identidade nem localização para mostrar.
  const soImagem = obraNaoIdentificada(m);
  const abas: { id: AbaDoQuadro; rotulo: string; total?: number }[] = [
    { id: 'info', rotulo: 'Info' }, { id: 'analise', rotulo: 'Análise', total: m.afirmacoes.length }, { id: 'fontes', rotulo: 'Fontes', total: m.fontes.length },
  ];
  // A afirmação escolhida fora do painel (no quadro, no Percorrer) aparece na lista.
  useEffect(() => {
    if (aba !== 'analise' || !afirmacaoEscolhida) return;
    conteudo.current?.querySelector(`[data-afirmacao="${afirmacaoEscolhida}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [afirmacaoEscolhida, aba]);
  return <aside className="painel-do-leitor painel-do-quadro" style={{ position: 'fixed' }} aria-label="Painel do quadro">
    <header className="painel-leitor-cabeca">
      <div ref={cabeca} role="tablist" aria-label="Quadro" onKeyDown={(evento) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evento.key)) return;
        evento.preventDefault(); evento.stopPropagation();
        const indice = abas.findIndex((a) => a.id === aba);
        const proxima = evento.key === 'Home' ? 0 : evento.key === 'End' ? abas.length - 1 : (indice + (evento.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length;
        mudarAba(abas[proxima]!.id);
        cabeca.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[proxima]?.focus();
      }}>
        {abas.map((a) => <Button variante="ghost" key={a.id} role="tab" id={`${id}-${a.id}`} aria-controls={`${id}-conteudo`} aria-selected={aba === a.id} tabIndex={aba === a.id ? 0 : -1} onClick={() => mudarAba(a.id)}>
          {a.rotulo}{a.total !== undefined && <span className="painel-leitor-contador">{a.total}</span>}
        </Button>)}
      </div>
      <IconButton aria-label="Fechar painel do quadro" onClick={aoFechar}><Icon name="painel-direito" size={18} /></IconButton>
    </header>
    <div ref={conteudo} className="painel-leitor-conteudo" role="tabpanel" id={`${id}-conteudo`} aria-labelledby={`${id}-${aba}`} tabIndex={0}>
      {aba === 'info' && <>
        <h2>{m.identidade.titulo}</h2>
        {soImagem ? <SemIdentificacao palpite={detalhe.palpite ?? null} {...(aoIdentificar ? { aoIdentificar } : {})} /> : <>
          <p className="painel-leitor-autor">{m.identidade.artista} · {m.identidade.data}</p>
          <h3>Identificação</h3>
          <dl className="painel-leitor-metadados metadados-do-quadro">
            <dt>Tipo</dt><dd><TipoDoDocumento icone="quadro" rotulo="Quadro" /></dd>
            <dt>Título original</dt><dd lang="und">{m.identidade.titulo_original}</dd>
            <dt>Artista</dt><dd>{m.identidade.artista}</dd>
            <dt>Data</dt><dd>{m.identidade.data}</dd>
            <dt>Técnica</dt><dd>{m.identidade.tecnica}</dd>
          </dl>
          <h3>Localização</h3>
          <dl className="painel-leitor-metadados metadados-do-quadro">
            <dt>Acervo</dt><dd>{m.localizacao.instituicao_proprietaria ?? 'instituição não confirmada'}</dd>
            <dt>Onde está</dt><dd>{m.localizacao.localizacao_conhecida ?? naoVerificada}</dd>
            <dt>Exposição atual</dt><dd>{exposicao(m.localizacao.atualmente_exposto)}</dd>
            <dt>Sala</dt><dd>{m.localizacao.sala ?? naoVerificada}</dd>
            <dt>Conferido em</dt><dd>{new Date(`${m.localizacao.verificado_em}T12:00:00`).toLocaleDateString('pt-BR')}</dd>
          </dl>
        </>}
        <h3>Imagem</h3>
        <dl className="painel-leitor-metadados metadados-do-quadro">
          <dt>Dimensões</dt><dd>{m.imagem.largura} × {m.imagem.altura} px</dd>
          <dt>Licença</dt><dd>{info?.licenca ?? (soImagem ? 'não informada' : 'domínio público (segundo a fonte)')}</dd>
          <dt>Crédito</dt><dd>{info?.credito ?? m.imagem.credito}</dd>
          <dt>Origem</dt><dd>{info?.origem_url ? <a href={info.origem_url} target="_blank" rel="noreferrer">{fonteDaImagem?.titulo ?? 'Página da imagem'}</a> : fonteDaImagem ? <Fonte fonte={fonteDaImagem} /> : '—'}</dd>
          {info?.baixado_em && <><dt>Baixada em</dt><dd>{new Date(info.baixado_em).toLocaleDateString('pt-BR')}</dd></>}
        </dl>
        <h3>Esta análise</h3>
        <dl className="painel-leitor-metadados metadados-do-quadro">
          <dt>Análise</dt><dd>{analise.titulo}</dd>
          <dt>Regiões</dt><dd>{m.regioes.length}</dd>
          <dt>Afirmações</dt><dd>{m.afirmacoes.length}</dd>
          <dt>Análise curta</dt><dd>{formatarTempo(duracao_s)} · {narrada ? 'com voz' : 'sem voz'}</dd>
        </dl>
      </>}
      {aba === 'analise' && <>
        <div className="caderno-topo topo-da-analise">
          <label className="seletor-de-analise"><span>Análise</span>
            <Select aria-label="Análise" value={analise.rotulo} rotuloFechado={analise.titulo} disabled={carregandoAnalise || detalhe.analises.length < 2} onChange={(evento) => aoEscolherAnalise(evento.target.value)}>
              {detalhe.analises.map((a) => <option key={a.rotulo} value={a.rotulo}>{`${a.titulo}${a.publicada ? ' · publicada' : ''}${a.audio ? ' · com voz' : ''}`}</option>)}
            </Select>
          </label>
          <p className="tese-do-quadro">{analise.curta.tese}</p>
          {soImagem && <p className="painel-leitor-vazio so-pela-imagem">Só pela imagem: o que se vê e o que se infere do que se vê, sem fatos históricos.</p>}
          <div className="acoes-da-analise">
            <Button onClick={aoOuvir}><Icon name="tocar" size={16} />Análise curta · {formatarTempo(duracao_s)}</Button>
            <Button className="botao-percorrer" onClick={aoPercorrer}><Icon name="percorrer" size={16} />Percorrer</Button>
          </div>
        </div>
        {carregandoAnalise && <p className="painel-leitor-vazio" role="status">Abrindo a análise…</p>}
        {agruparAfirmacoes(m).map((grupo) => <section key={grupo.chave} className="grupo-de-afirmacoes" aria-label={grupo.titulo}>
          <h3>{grupo.titulo}</h3>
          <ol className="painel-leitor-notas afirmacoes-do-quadro">{grupo.afirmacoes.map((a) => <li key={a.id} data-afirmacao={a.id}>
            <Button variante="ghost" className="painel-leitor-trecho" aria-pressed={afirmacaoEscolhida === a.id} onClick={() => aoEscolherAfirmacao(a)}
              onPointerEnter={() => aoPassarAfirmacao(a)} onPointerLeave={() => aoPassarAfirmacao(null)} onFocus={() => aoPassarAfirmacao(a)} onBlur={() => aoPassarAfirmacao(null)}>
              <span className="painel-leitor-rotulo"><span className="tipo-da-afirmacao" data-tipo={a.tipo} aria-hidden="true" />{ROTULO_DO_TIPO[a.tipo]} · {ROTULO_DA_CONFIANCA[a.confianca]}{a.proveniencia.autor === 'ia' ? ' · IA' : ''}</span>
              <span className="texto-da-afirmacao">{a.texto}</span>
              <Regioes modelo={m} afirmacao={a} />
            </Button>
            {afirmacaoEscolhida === a.id && <div className="evidencia-da-afirmacao"><p>{a.evidencia}</p>
              {a.fontes.map((fid) => { const f = m.fontes.find((x) => x.id === fid); return f && <Fonte key={fid} fonte={f} />; })}
            </div>}
          </li>)}</ol>
        </section>)}
      </>}
      {aba === 'fontes' && <>
        <ol className="fontes-do-quadro">{m.fontes.map((f) => <li key={f.id}>
          <span className="painel-leitor-rotulo">{ROTULO_DA_CATEGORIA[f.categoria]}</span>
          <Fonte fonte={f} />
          <span className="acao-detalhe">Consultada em {new Date(`${f.consultado_em}T12:00:00`).toLocaleDateString('pt-BR')}</span>
        </li>)}</ol>
        {m.limites.length > 0 && <><h3>Limites</h3><ul className="limites-do-quadro">{m.limites.map((l) => <li key={l}>{l}</li>)}</ul></>}
      </>}
    </div>
  </aside>;
}
