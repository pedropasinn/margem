/**
 * O leitor no modo sala: o mesmo `ReaderController` do Margem (texto ou PDF, marcas e notas da IA,
 * aparência), em `somenteLeitura`, sem estudo, sem grifos, sem perguntas à IA e sem nada da
 * biblioteca. O único gesto que escreve é o comentário no trecho, guardado na tabela da sala.
 * O progresso fica no navegador (sem `progresso`, o leitor usa `localStorage`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ComentarioDaSalaV1, Id } from '@margem/contratos';
import { arvoreDaVersao, capituloDaVersao, ErroDaApi, obterModos } from '../biblioteca/api';
import type { ArvoreDaVersao, SnapshotDoCapitulo } from '../biblioteca/tipos';
import { secoesDoCapitulo } from '../biblioteca/Ler';
import { BarraDeSelecao, IconeDaSelecao } from '../leitor/BarraDeSelecao';
import { ContextoDosModos } from '../leitor/ContextoDosModos';
import { usaPdf } from '../leitor/DocumentReader';
import { ContextoDaForma, formaDoDocumento } from '../leitor/forma';
import type { NotaPessoal } from '../leitor/NotasPessoais';
import { ReaderController } from '../leitor/ReaderController';
import { ancoraDaSelecao, type SelecaoDoLeitor } from '../leitor/selecao';
import type { ApiDoLeitor } from '../leitor/tipos';
import type { PosicaoNaLeitura } from '../leitor/BarraDoLeitor';
import { Esqueleto } from '../ui/Esqueleto';
import { Button, Drawer, IconButton, Textarea } from '../ui/Primitives';
import { apagarComentarioDaSala, comentariosDaSala, comentarNaSala, type DocumentoDaSala } from './api';
import '../leitor/estudo.css';

const TITULOS = new Set(['capitulo', 'secao', 'legenda', 'epigrafe']);

export interface PropsDoLeitorDaSala {
  slug: string;
  documento: DocumentoDaSala;
  secao_id?: Id;
  aoVoltar: () => void;
  aoIrCapitulo: (secaoId: Id) => void;
  aoPerderSessao: () => void;
}

export function LeitorDaSala({ slug, documento, secao_id, aoVoltar, aoIrCapitulo, aoPerderSessao }: PropsDoLeitorDaSala): ReactNode {
  const [arvore, definirArvore] = useState<ArvoreDaVersao | null>(null);
  const [snapshot, definirSnapshot] = useState<SnapshotDoCapitulo | null>(null);
  const [comentarios, definirComentarios] = useState<readonly ComentarioDaSalaV1[]>([]);
  const [erro, definirErro] = useState<string | null>(null);
  const [aviso, definirAviso] = useState<string | null>(null);
  const leitor = useRef<ApiDoLeitor>(null);
  const [raiz, definirRaiz] = useState<HTMLDivElement | null>(null);
  const [selecao, selecionar] = useState<SelecaoDoLeitor | null>(null);
  const [comentando, comentar] = useState<SelecaoDoLeitor['ancora'] | null>(null);
  const [texto, definirTexto] = useState('');
  const [ocupado, ocupar] = useState(false);

  // Quem chama passa funções novas a cada render: as refs seguram as últimas sem refazer o carregamento.
  const retornos = useRef({ aoIrCapitulo, aoPerderSessao }); retornos.current = { aoIrCapitulo, aoPerderSessao };
  const falhou = useCallback((falha: unknown, padrao: string) => {
    if (falha instanceof ErroDaApi && falha.status === 404) { retornos.current.aoPerderSessao(); return; }
    definirErro(falha instanceof Error && falha.message ? falha.message : padrao);
  }, []);

  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  useEffect(() => {
    // A URL acabou de receber o capítulo que já está aberto (primeira abertura): nada a recarregar.
    if (secao_id !== undefined && snapshotRef.current?.secao.id === secao_id && snapshotRef.current.documento_id === documento.id) return;
    let vivo = true;
    async function abrir(): Promise<void> {
      const carregada = await arvoreDaVersao(documento.versao_id);
      let escolhido = secao_id !== undefined && carregada.capitulos.some((c) => c.id === secao_id) ? secao_id : carregada.capitulos[0]?.id;
      if (escolhido === undefined) throw new Error('Este texto não tem capítulos.');
      let capitulo = await capituloDaVersao(documento.versao_id, escolhido);
      // Sem capítulo pedido, a folha de rosto (só títulos) não é onde a leitura começa.
      if (secao_id === undefined) {
        let indice = carregada.capitulos.findIndex((c) => c.id === escolhido);
        while (capitulo.blocos.every((b) => TITULOS.has(b.tipo)) && indice < carregada.capitulos.length - 1) {
          const seguinte = carregada.capitulos[++indice];
          if (!seguinte) break;
          escolhido = seguinte.id;
          capitulo = await capituloDaVersao(documento.versao_id, escolhido);
        }
      }
      const [modos, meus] = await Promise.all([obterModos().catch(() => ({ modos: [] })), comentariosDaSala(slug, documento.id)]);
      if (!vivo) return;
      definirArvore(carregada);
      definirComentarios(meus.comentarios);
      definirSnapshot({ ...capitulo, modos: modos.modos });
      definirErro(null);
      if (escolhido !== secao_id) retornos.current.aoIrCapitulo(escolhido);
    }
    abrir().catch((falha: unknown) => { if (vivo) falhou(falha, 'Não foi possível abrir o texto.'); });
    return () => { vivo = false; };
  }, [documento.id, documento.versao_id, secao_id, slug, falhou]);

  // A seleção do texto (ou da camada de texto do PDF) vira a âncora do comentário.
  const comentandoRef = useRef(comentando); comentandoRef.current = comentando;
  useEffect(() => {
    if (!raiz) return;
    let quadro = 0;
    const capturar = () => {
      const atual = snapshotRef.current;
      const ativo = document.activeElement;
      if (!atual || comentandoRef.current || ativo?.matches('input, textarea, select')) return;
      const artigo = raiz.querySelector<HTMLElement>('.capitulo');
      if (!artigo) return;
      const lida = leitor.current?.selecao?.(window.getSelection())
        ?? (atual.formato === 'pdf' && atual.geometria_disponivel ? null : ancoraDaSelecao(window.getSelection(), artigo, atual));
      selecionar(lida);
    };
    const agendar = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(capturar); };
    document.addEventListener('selectionchange', agendar);
    raiz.addEventListener('pointerup', agendar);
    raiz.addEventListener('keyup', agendar);
    window.addEventListener('scroll', agendar, { passive: true });
    return () => { cancelAnimationFrame(quadro); document.removeEventListener('selectionchange', agendar); raiz.removeEventListener('pointerup', agendar); raiz.removeEventListener('keyup', agendar); window.removeEventListener('scroll', agendar); };
  }, [raiz]);

  const fecharComentario = useCallback(() => { comentar(null); definirTexto(''); selecionar(null); window.getSelection()?.removeAllRanges(); }, []);
  const abrirComentario = useCallback((ancora: SelecaoDoLeitor['ancora']) => { comentar(ancora); definirTexto(''); selecionar(null); window.getSelection()?.removeAllRanges(); }, []);

  async function salvarComentario() {
    if (!comentando || texto.trim() === '') return;
    ocupar(true);
    try {
      const { comentario } = await comentarNaSala(slug, {
        versao_id: comentando.versao_id, bloco_id: comentando.bloco_id, inicio_utf16: comentando.inicio_utf16,
        fim_utf16: comentando.fim_utf16, citacao: comentando.citacao, texto: texto.trim(),
      });
      definirComentarios((atuais) => [...atuais, comentario]);
      fecharComentario();
      definirAviso('Comentário guardado.');
    } catch (falha) { falhou(falha, 'Não foi possível guardar o comentário.'); }
    finally { ocupar(false); }
  }
  useEffect(() => { if (!aviso) return; const tempo = setTimeout(() => definirAviso(null), 3000); return () => clearTimeout(tempo); }, [aviso]);

  const apagar = useCallback((id: Id) => {
    void apagarComentarioDaSala(slug, id).then(() => definirComentarios((atuais) => atuais.filter((c) => c.id !== id)),
      (falha: unknown) => falhou(falha, 'Não foi possível apagar o comentário.'));
  }, [slug, falhou]);

  const doCapitulo = useMemo(() => snapshot === null ? [] : comentarios.filter((c) => c.versao_id === snapshot.versao_id && snapshot.blocos.some((b) => b.id === c.bloco_id)), [comentarios, snapshot]);
  const pessoais = useMemo<NotaPessoal[]>(() => doCapitulo.map((c) => ({
    id: c.id,
    ancora: { versao_id: c.versao_id, bloco_id: c.bloco_id, inicio_utf16: c.inicio_utf16, fim_utf16: c.fim_utf16, citacao: c.citacao, prefixo: '', sufixo: '' },
    conteudo: <>
      <span className="eyebrow">Seu comentário</span>
      <p className="texto-pessoal">{c.texto}</p>
      <div className="acoes-pessoais"><Button type="button" onClick={() => apagar(c.id)}>Apagar</Button></div>
    </>,
  })), [doCapitulo, apagar]);
  const visivel = useMemo(() => snapshot === null ? null : {
    ...snapshot,
    tracosPessoais: pessoais.map((nota) => ({ id: nota.id, ancora: nota.ancora, acao: 'sublinhado' as const })),
  }, [snapshot, pessoais]);

  if (erro !== null && snapshot === null) return <div className="empty sala-erro-leitor" role="alert"><h2>Não foi possível abrir o texto</h2><p>{erro}</p><Button onClick={aoVoltar}>Voltar à sala</Button></div>;
  if (arvore === null || visivel === null || snapshot === null) return <Esqueleto />;

  const forma = formaDoDocumento(arvore.capitulos);
  const indice = arvore.capitulos.findIndex((c) => c.id === snapshot.secao.id);
  const irAoCapitulo = (n: number) => { const alvo = arvore.capitulos[n]; if (alvo) aoIrCapitulo(alvo.id); };
  const posicao: PosicaoNaLeitura | undefined = arvore.capitulos.length > 1 && indice >= 0 ? {
    tipo: 'capitulo', atual: indice + 1, total: arvore.capitulos.length,
    anterior: indice > 0 ? () => irAoCapitulo(indice - 1) : undefined,
    proximo: indice < arvore.capitulos.length - 1 ? () => irAoCapitulo(indice + 1) : undefined,
    irPara: (numero) => irAoCapitulo(numero - 1),
  } : undefined;
  const sumario = arvore.capitulos.length > 1 ? <nav className="capitulos" aria-label="Capítulos">
    <p className="capitulos-titulo">{arvore.titulo}</p>
    <ul>{arvore.capitulos.map((capitulo) => <li key={capitulo.id}><span className="linha-do-capitulo">
      <a href={`/t/${slug}/ler/${documento.id}/${capitulo.id}`} aria-current={capitulo.id === snapshot.secao.id ? 'true' : undefined}
        onClick={(e) => { e.preventDefault(); aoIrCapitulo(capitulo.id); }}><span className="capitulo-dot" aria-hidden="true" /><span>{capitulo.titulo}</span></a>
    </span>{capitulo.id === snapshot.secao.id && secoesDoCapitulo(arvore.secoes, capitulo.id).length > 0 && <ul className="secoes-do-capitulo">
      {secoesDoCapitulo(arvore.secoes, capitulo.id).map((secao) => <li key={secao.id}><a href={`/t/${slug}/ler/${documento.id}/${capitulo.id}`}
        className={`secao-do-sumario profundidade-${String(secao.profundidade)}`}
        onClick={(e) => { e.preventDefault(); document.querySelector(`[data-bloco="${secao.bloco_inicio}"]`)?.scrollIntoView({ block: 'start' }); }}>{secao.titulo}</a></li>)}
    </ul>}</li>)}</ul>
  </nav> : undefined;
  const navegacao = forma === 'texto' ? <nav className="fim-do-texto" aria-label="Fim do texto">
    <span className="fim-do-texto-sinal" aria-hidden="true">⁂</span>
    <a href={`/t/${slug}`} onClick={(e) => { e.preventDefault(); aoVoltar(); }}>Voltar à sala</a>
  </nav> : <nav className="navegacao-capitulos" aria-label="Navegar capítulos">
    {([['anterior', 'Anterior'], ['proxima', 'Próximo capítulo']] as const).map(([chave, rotulo]) => {
      const secao = snapshot[chave];
      if (secao == null) return <span key={chave} />;
      const titulo = arvore.capitulos.find((c) => c.id === secao)?.titulo ?? '';
      return <a key={chave} className={`cartao-capitulo ${chave}`} href={`/t/${slug}/ler/${documento.id}/${secao}`} aria-label={rotulo}
        onClick={(e) => { e.preventDefault(); aoIrCapitulo(secao); }}>
        <span className="cartao-capitulo-rotulo">{rotulo}</span><span className="cartao-capitulo-titulo">{titulo}</span>
      </a>;
    })}
  </nav>;
  const modos = (snapshot.modos ?? []).filter((m) => (snapshot.camadas ?? []).some((c) => (snapshot.camada === 'todas' || c.id === snapshot.camada) && c.modo.id === m.id && c.modo.revisao === m.revisao));
  const tipo = documento.formato === 'pdf' ? { icone: 'pdf', rotulo: arvore.capitulos.length > 1 ? 'PDF · livro' : 'PDF' }
    : { icone: arvore.capitulos.length > 1 ? 'livro' : 'texto', rotulo: arvore.capitulos.length > 1 ? 'Livro' : 'Texto' };

  return <ContextoDaForma.Provider value={forma}><ContextoDosModos modos={modos}>
    <div ref={definirRaiz} className={`leitura sala-leitura ${forma === 'texto' ? 'texto-unico' : ''}`}>
      <ReaderController
        somenteLeitura
        leitorRef={leitor}
        snapshot={visivel}
        documento_id={documento.id}
        estrategia="scroll"
        voltar={{ href: `/t/${slug}`, rotulo: 'Voltar à sala', aoVoltar }}
        sumario={sumario}
        posicao={posicao}
        tituloDocumento={arvore.titulo}
        tipoDoDocumento={tipo}
        {...(documento.autor ? { autor: documento.autor } : {})}
        abertura={forma === 'texto' && !usaPdf(snapshot) && documento.autor ? <p className="abertura-do-texto"><span>{documento.autor}</span></p> : undefined}
        pessoais={pessoais}
        navegacao={navegacao}
        aoMudarCapitulos={() => undefined}
        estudoAberto={comentando !== null}
        avisoExtra={<>{erro && <p className="aviso-estudo" role="alert">{erro}</p>}{aviso && <p className="aviso-estudo sala-aviso-leitor" role="status">{aviso}</p>}</>}
        painel={comentando && <Drawer rotulo="Comentar o trecho" aoFechar={fecharComentario}>
          <blockquote>{comentando.citacao}</blockquote>
          <form className="formulario formulario-estudo" onSubmit={(e) => { e.preventDefault(); void salvarComentario(); }}>
            <label>O que você achou deste trecho, da marca ou da nota?<Textarea autoFocus required maxLength={4000} value={texto} onChange={(e) => definirTexto(e.target.value)} /></label>
            <p className="secundario">Só quem convidou você vê os comentários.</p>
            <div className="button-row"><Button type="submit" variante="primario" disabled={ocupado || texto.trim() === ''}>{ocupado ? 'Guardando…' : 'Guardar comentário'}</Button><Button type="button" onClick={fecharComentario}>Cancelar</Button></div>
          </form>
        </Drawer>}
      />
      {selecao && !comentando && <BarraDeSelecao selecao={selecao}>
        <Button variante="ghost" type="button" onClick={() => abrirComentario(selecao.ancora)} aria-label="Comentar"><IconeDaSelecao nome="anotar" /><span>Comentar</span></Button>
        <IconButton aria-label="Fechar seleção" onClick={() => { selecionar(null); window.getSelection()?.removeAllRanges(); }}><IconeDaSelecao nome="fechar" /></IconButton>
      </BarraDeSelecao>}
    </div>
  </ContextoDosModos></ContextoDaForma.Provider>;
}
