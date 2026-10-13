/**
 * Carcaça do e-ink (Xteink X4 Pro, 480 × 800): a leitura guiada em telas, uma de cada vez, preto no
 * branco, sem animação nem cinza. Cada passo mostra o texto (refluível, com os elementos em foco
 * sublinhados e numerados) e depois a explicação, com os mesmos números, as ligações e a parada.
 *
 * Toque: o terço da esquerda volta, o resto avança; a faixa de cima abre o índice. Teclas (os botões
 * do aparelho chegam como teclas): → / PageDown / espaço avançam, ← / PageUp voltam, Enter abre o índice.
 * Uma tela maior que a página se divide em páginas por colunas CSS, medidas depois de desenhar.
 * Numa tela larga (o computador), a carcaça aparece dentro de uma moldura do aparelho, em tamanho real.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ApresentacaoDoPlanoV1, ModeloDoCapituloV1, PlanoPedagogicoV1 } from '@margem/contratos';
import { arvoreDaVersao, capituloDaCompreensao, capituloDaVersao, obterDocumento, pedir } from '../biblioteca/api';
import type { ArvoreDaVersao, SnapshotDoCapitulo } from '../biblioteca/tipos';
import { compreensaoDaCamada } from '../leitor/compreensao/useCompreensao';
import { ROTULO_DA_RELACAO } from '../leitor/compreensao/rotulos';
import { Destaque } from '../ui/marcador/Destaque';
import { roteiroDoEink, trechosDoBloco, type TelaDoEink } from '@margem/core/eink';
import './eink.css';

export interface FontesDoEink {
  documento: typeof obterDocumento;
  arvore: typeof arvoreDaVersao;
  capitulo: typeof capituloDaVersao;
  compreensao: typeof capituloDaCompreensao;
  apresentacao: (planoId: string) => Promise<{ apresentacao: ApresentacaoDoPlanoV1 }>;
}
export const FONTES_DO_EINK: FontesDoEink = {
  documento: obterDocumento, arvore: arvoreDaVersao, capitulo: capituloDaVersao, compreensao: capituloDaCompreensao,
  apresentacao: (planoId) => pedir(`/api/planos/${planoId}/apresentacao?dispositivo=eink`),
};

interface Carregado { arvore: ArvoreDaVersao; capitulo: SnapshotDoCapitulo; plano: PlanoPedagogicoV1; modelo: ModeloDoCapituloV1 | null; telas: TelaDoEink[] }
const TAMANHOS = [16, 18, 20, 22] as const;
const CHAVE_DO_TAMANHO = 'margem:eink:tamanho';
const CHAVE_DA_POSICAO = (planoId: string) => `margem:eink:${planoId}`;
function ler(chave: string): string | null { try { return localStorage.getItem(chave); } catch { return null; } }
function gravar(chave: string, valor: string): void { try { localStorage.setItem(chave, valor); } catch { /* sem storage */ } }

export function Eink({ documento_id, secao_id, fontes = FONTES_DO_EINK }: { documento_id: string; secao_id?: string; fontes?: FontesDoEink }): ReactNode {
  const [dados, definirDados] = useState<Carregado | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const documento = await fontes.documento(documento_id);
      if (documento.versao_id === null) throw new Error('Este documento ainda não tem texto.');
      const arvore = await fontes.arvore(documento.versao_id);
      const secao = secao_id ?? arvore.capitulos[0]?.id;
      if (!secao) throw new Error('O texto não tem capítulos.');
      const capitulo = await fontes.capitulo(documento.versao_id, secao);
      const compreensao = compreensaoDaCamada(capitulo.camada, capitulo.camadas);
      if (!compreensao) throw new Error('Este capítulo não tem compreensão: escolha a camada dela no leitor.');
      const detalhe = await fontes.compreensao(compreensao, secao);
      if (!detalhe.plano) throw new Error('O capítulo ainda não tem leitura guiada.');
      const { apresentacao } = await fontes.apresentacao(detalhe.plano.id);
      const telas = roteiroDoEink(apresentacao, detalhe.plano, detalhe.modelo, capitulo.blocos);
      if (vivo) definirDados({ arvore, capitulo, plano: detalhe.plano, modelo: detalhe.modelo, telas });
    })().catch((falha: unknown) => { if (vivo) definirErro(falha instanceof Error ? falha.message : 'Não foi possível abrir o capítulo.'); });
    return () => { vivo = false; };
  }, [documento_id, secao_id, fontes]);

  return <div className="eink-mesa">
    <div className="eink-carcaca">
      <div className="eink-tela">
        {erro ? <p className="eink-aviso" role="alert">{erro}</p>
          : dados ? <Leitura dados={dados} documento_id={documento_id} />
          : <p className="eink-aviso" role="status">Abrindo…</p>}
      </div>
      <span className="eink-botao eink-botao-cima" aria-hidden="true" />
      <span className="eink-botao eink-botao-baixo" aria-hidden="true" />
    </div>
  </div>;
}

function Leitura({ dados, documento_id }: { dados: Carregado; documento_id: string }): ReactNode {
  const { telas, plano, capitulo, arvore } = dados;
  const [posicao, definirPosicao] = useState(() => {
    const guardada = Number(ler(CHAVE_DA_POSICAO(plano.id)));
    return { tela: Number.isInteger(guardada) && guardada >= 0 && guardada < telas.length ? guardada : 0, pagina: 0 };
  });
  const [paginas, definirPaginas] = useState(1);
  const [indice, abrirIndice] = useState(false);
  const [tamanho, definirTamanho] = useState(() => { const valor = Number(ler(CHAVE_DO_TAMANHO)); return TAMANHOS.includes(valor as 18) ? valor : 18; });
  const [baixando, definirBaixando] = useState(false);
  const tela = telas[posicao.tela];
  useEffect(() => { gravar(CHAVE_DA_POSICAO(plano.id), String(posicao.tela)); }, [plano.id, posicao.tela]);

  // Da última página do capítulo, avançar abre o capítulo seguinte.
  const seguinte = arvore.capitulos[arvore.capitulos.findIndex((item) => item.id === capitulo.secao.id) + 1];
  const noFim = posicao.tela === telas.length - 1 && posicao.pagina >= paginas - 1;
  const avancar = useCallback(() => {
    if (noFim) { if (seguinte) window.location.assign(`/eink/${documento_id}/${seguinte.id}`); return; }
    definirPosicao((atual) => atual.pagina < paginas - 1 ? { ...atual, pagina: atual.pagina + 1 }
      : atual.tela < telas.length - 1 ? { tela: atual.tela + 1, pagina: 0 } : atual);
  }, [paginas, telas.length, noFim, seguinte, documento_id]);
  // Voltar de uma tela para a anterior cai na última página dela (-1: resolvida ao medir).
  const voltar = useCallback(() => {
    definirPosicao((atual) => atual.pagina > 0 ? { ...atual, pagina: atual.pagina - 1 } : atual.tela > 0 ? { tela: atual.tela - 1, pagina: -1 } : atual);
  }, []);
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' '].includes(evento.key)) { evento.preventDefault(); if (!indice) avancar(); }
      else if (['ArrowLeft', 'PageUp'].includes(evento.key)) { evento.preventDefault(); if (!indice) voltar(); }
      else if (evento.key === 'Enter' || evento.key === 'Escape') { evento.preventDefault(); abrirIndice((aberto) => evento.key === 'Escape' ? false : !aberto); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [avancar, voltar, indice]);

  const passo = plano.passos.find((item) => item.ordem === tela?.passo);
  const numeroDoPasso = passo ? plano.passos.indexOf(passo) + 1 : 1;
  const titulo = arvore.capitulos.find((item) => item.id === capitulo.secao.id)?.titulo ?? capitulo.secao.titulo;
  const primeiraDoPasso = (ordem: number) => telas.findIndex((item) => item.passo === ordem);

  return <div className="eink-leitura" style={{ '--eink-tamanho': `${String(tamanho)}px` } as CSSProperties}>
    <header className="eink-cabeca">
      <span>{titulo} · passo {numeroDoPasso} de {plano.passos.length}</span>
      <span>{posicao.tela + 1}/{telas.length}{paginas > 1 ? ` · ${String(Math.max(0, posicao.pagina) + 1)}/${String(paginas)}` : ''}</span>
    </header>
    {tela && <Folha key={`${String(posicao.tela)}:${String(tamanho)}`} pagina={posicao.pagina} aoMedir={(total) => {
      definirPaginas(total);
      if (posicao.pagina < 0 || posicao.pagina >= total) definirPosicao((atual) => ({ ...atual, pagina: total - 1 }));
    }}>
      {tela.tipo === 'texto' ? <TelaDeTexto tela={tela} /> : <TelaDeExplicacao tela={tela} observar={passo?.observar ?? ''} aoIr={(indiceDaTela) => definirPosicao({ tela: indiceDaTela, pagina: 0 })} />}
    </Folha>}
    {/* Zonas de toque por cima da página: a faixa de cima abre o índice; esquerda volta; o resto avança. */}
    <button type="button" className="eink-zona eink-zona-indice" aria-label="Índice" onClick={() => abrirIndice(true)} />
    <button type="button" className="eink-zona eink-zona-voltar" aria-label="Voltar" onClick={voltar} />
    <button type="button" className="eink-zona eink-zona-avancar" aria-label="Avançar" onClick={avancar} />
    {indice && <nav className="eink-indice" aria-label="Passos do capítulo">
      <div className="eink-indice-cabeca">
        <strong>{titulo}</strong>
        <button type="button" onClick={() => abrirIndice(false)}>Fechar</button>
      </div>
      <ol>{plano.passos.map((item, numero) => {
        const destino = primeiraDoPasso(item.ordem);
        return <li key={item.ordem}><button type="button" aria-current={item.ordem === tela?.passo ? 'step' : undefined}
          onClick={() => { if (destino >= 0) definirPosicao({ tela: destino, pagina: 0 }); abrirIndice(false); }}>
          <span>{numero + 1}</span>{item.observar}
        </button></li>;
      })}</ol>
      <div className="eink-indice-pe">
        <span>Letra</span>
        {TAMANHOS.map((valor) => <button key={valor} type="button" aria-pressed={valor === tamanho} onClick={() => { definirTamanho(valor); gravar(CHAVE_DO_TAMANHO, String(valor)); }}>{valor}</button>)}
        <a href={`/ler/${documento_id}/${capitulo.secao.id}`}>Sair</a>
      </div>
      {/* Para o próprio aparelho: o mesmo roteiro como EPUB, para copiar para o X4 Pro. */}
      <div className="eink-indice-pe">
        <button type="button" disabled={baixando} onClick={() => { void baixarEpub(plano.id, `${titulo}.epub`, definirBaixando); }}>{baixando ? 'Gerando…' : 'Baixar EPUB para o aparelho'}</button>
      </div>
    </nav>}
  </div>;
}

/** A tela do roteiro dividida em páginas da altura da tela, por colunas CSS. */
function Folha({ pagina, aoMedir, children }: { pagina: number; aoMedir: (paginas: number) => void; children: ReactNode }): ReactNode {
  const moldura = useRef<HTMLDivElement>(null);
  const conteudo = useRef<HTMLDivElement>(null);
  const [largura, definirLargura] = useState(0);
  const avisar = useRef(aoMedir); avisar.current = aoMedir;
  useLayoutEffect(() => {
    const medir = () => {
      const caixa = moldura.current; const coluna = conteudo.current;
      if (!caixa || !coluna) return;
      const passo = caixa.clientWidth + VAO;
      definirLargura(caixa.clientWidth);
      avisar.current(Math.max(1, Math.round((coluna.scrollWidth + VAO) / passo)));
    };
    medir();
    void document.fonts?.ready.then(medir);
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);
  const atual = Math.max(0, pagina);
  return <div ref={moldura} className="eink-folha">
    <div ref={conteudo} className="eink-colunas" style={{ columnWidth: largura || undefined, columnGap: VAO, transform: `translateX(${String(-atual * (largura + VAO))}px)` }}>
      {children}
    </div>
  </div>;
}
const VAO = 40;

/** Baixa o EPUB pelo `fetch` (e não por um link): assim passa pelo mesmo caminho das outras chamadas. */
async function baixarEpub(planoId: string, nome: string, ocupado: (sim: boolean) => void): Promise<void> {
  ocupado(true);
  try {
    const resposta = await fetch(`/api/planos/${planoId}/eink.epub`);
    if (!resposta.ok) throw new Error(`HTTP ${String(resposta.status)}`);
    const url = URL.createObjectURL(await resposta.blob());
    const link = document.createElement('a');
    link.href = url; link.download = nome;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    window.alert('Não foi possível gerar o EPUB agora.');
  } finally { ocupado(false); }
}
const maiuscula = (texto: string): string => texto.charAt(0).toLocaleUpperCase('pt-BR') + texto.slice(1);

function TelaDeTexto({ tela }: { tela: Extract<TelaDoEink, { tipo: 'texto' }> }): ReactNode {
  return <article className="eink-texto">
    {tela.blocos.map((bloco) => {
      const trechos = trechosDoBloco(bloco.texto, tela.grifos[bloco.id] ?? []);
      const Tag = bloco.tipo === 'capitulo' || bloco.tipo === 'secao' ? 'h2' : 'p';
      return <Tag key={bloco.id}>{trechos.map((trecho, indice) => trecho.grifo
        ? <span key={indice} className="eink-grifo"><Destaque acao="sublinhado" cor="#000" animacao={false} opacidade={1} espessura={trecho.grifo.periferico ? 1 : 1.6} rugosidade={0} tracejado={trecho.grifo.periferico}>{trecho.texto}</Destaque><sup className={trecho.grifo.periferico ? 'eink-numero periferico' : 'eink-numero'}>{trecho.grifo.numero}</sup></span>
        : <span key={indice}>{trecho.texto}</span>)}</Tag>;
    })}
  </article>;
}

function TelaDeExplicacao({ tela, observar, aoIr }: { tela: Extract<TelaDoEink, { tipo: 'explicacao' }>; observar: string; aoIr: (tela: number) => void }): ReactNode {
  // O texto da apresentação traz a explicação curta e, depois, "Observe: …": o observar vai em cima.
  const explicacao = useMemo(() => tela.texto.split(/\n\nObserve: /)[0] ?? tela.texto, [tela.texto]);
  return <section className="eink-explicacao">
    <p className="eink-observar">{observar}</p>
    <p>{explicacao}</p>
    {tela.itens.length > 0 && <>
      <h3>No trecho</h3>
      <ol className="eink-itens">{tela.itens.map((item) => <li key={item.numero}><span className={item.periferico ? 'eink-numero periferico' : 'eink-numero'}>{item.numero}</span>{item.enunciado}</li>)}</ol>
    </>}
    {tela.ligacoes.length > 0 && <>
      <h3>Ligações</h3>
      <ul className="eink-ligacoes">{tela.ligacoes.map((ligacao, indice) => <li key={indice}>
        <strong>{maiuscula(ROTULO_DA_RELACAO[ligacao.tipo])}{ligacao.retrospectiva ? ' · volta adiante' : ''}.</strong> {ligacao.explicacao}
        {ligacao.citacao && <> <em>“{ligacao.citacao.length > 110 ? `${ligacao.citacao.slice(0, 110)}…` : ligacao.citacao}”</em></>}
        {ligacao.tela !== null && <button type="button" className="eink-ir" onClick={(evento) => { evento.stopPropagation(); if (ligacao.tela !== null) aoIr(ligacao.tela); }}>tela {ligacao.tela + 1} ›</button>}
      </li>)}</ul>
    </>}
    {tela.parada && <p className="eink-parada"><strong>{tela.parada.tipo === 'pergunta' ? 'Antes de seguir' : 'Pausa'}.</strong> {tela.parada.texto}</p>}
  </section>;
}
