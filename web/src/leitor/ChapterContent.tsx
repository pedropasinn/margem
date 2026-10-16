import { agruparPor } from './indices';
import type { MarcaDoLeitor } from './f2';
const SEM_MARCAS: readonly MarcaDoLeitor[] = [];
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { CamadaDeMarcas } from '../ui/marcador/CamadaDeMarcas';
import { usarAparencia } from './ContextoDeAparencia';
import type { Bloco, Id } from '@margem/contratos';
import { AnnotatedText } from './AnnotatedText';
import { BlockRenderer } from './BlockRenderer';
import { NotaAberta, textoDaNota } from './NotaDeRodape';
import type { SnapshotCapitulo } from './tipos';

type Grupo = { tipo: 'lista'; blocos: Bloco[] } | { tipo: 'solto'; bloco: Bloco };

/** Junta blocos `lista` vizinhos num único `ul`, preservando a ordem do canônico. */
function agrupar(blocos: readonly Bloco[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const bloco of blocos) {
    const ultimo = grupos[grupos.length - 1];
    if (bloco.tipo === 'lista' && ultimo?.tipo === 'lista') ultimo.blocos.push(bloco);
    else if (bloco.tipo === 'lista') grupos.push({ tipo: 'lista', blocos: [bloco] });
    else grupos.push({ tipo: 'solto', bloco });
  }
  return grupos;
}

/** O título da seção aparece uma vez: no bloco que abre a seção, nunca repetido em cabeçalho. */
export function ChapterContent({ snapshot, ativa = null, abertura }: { snapshot: SnapshotCapitulo; ativa?: Id | null; abertura?: ReactNode }): ReactNode {
  const { secao, blocos, marcas, assets } = snapshot;
  const artigo = useRef<HTMLElement>(null);
  const { preferencias } = usarAparencia();
  const tituloDaSecao = blocos.find(
    (bloco) => bloco.id === secao.bloco_inicio && (bloco.tipo === 'capitulo' || bloco.tipo === 'secao'),
  );
  const porBloco = useMemo(() => agruparPor(marcas, m => m.ancora.bloco_id), [marcas]);
  const blocoAtivo = useMemo(() => marcas.find(m => m.id === ativa)?.ancora.bloco_id, [marcas, ativa]);
  const figuras = useMemo(() => agruparPor(snapshot.ilustracoes ?? [], f => `${f.bloco_id}:${f.posicao}`), [snapshot.ilustracoes]);
  const ilustracoes = useMemo(() => new Map([...figuras].map(([chave, itens]) => [chave,
    itens.map((figura, indice) => <img key={`${figura.url}-${indice}`} className="asset ilustracao-importada" src={figura.url} alt={figura.alt} width={figura.largura} height={figura.altura} loading="lazy" />),
  ])), [figuras]);
  const imagens = (bloco: Bloco, posicao: 'antes' | 'depois') => ilustracoes.get(`${bloco.id}:${posicao}`);
  const grupos = useMemo(() => agrupar(blocos.filter(bloco => bloco !== tituloDaSecao)), [blocos, tituloDaSecao]);
  const marcasDo = (bloco: Bloco) => porBloco.get(bloco.id) ?? SEM_MARCAS;
  const ativaDo = (bloco: Bloco) => bloco.id === blocoAtivo ? ativa : null;
  // Nota de rodapé aberta no lugar: a chamada (`a[data-rodape]`, do `AnnotatedText`) alterna a nota.
  const [nota, abrirNota] = useState<{ id: Id; chamada: HTMLElement } | null>(null);
  useEffect(() => { abrirNota(null); }, [snapshot.versao_id, secao.id]);
  useEffect(() => {
    if (!nota) return;
    nota.chamada.setAttribute('aria-expanded', 'true');
    return () => nota.chamada.setAttribute('aria-expanded', 'false');
  }, [nota]);
  const aoClicar = (evento: MouseEvent<HTMLElement>) => {
    const chamada = evento.target instanceof Element ? evento.target.closest<HTMLElement>('a[data-rodape]') : null;
    const id = chamada?.dataset['rodape'];
    if (!chamada || id === undefined) return;
    evento.preventDefault();
    abrirNota((atual) => atual?.chamada === chamada ? null : { id, chamada });
  };
  const notaAtual = useRef(nota);
  notaAtual.current = nota;
  const fecharNota = useCallback((devolverFoco: boolean) => {
    const atual = notaAtual.current;
    abrirNota(null);
    if (atual && devolverFoco) atual.chamada.focus({ preventScroll: true });
  }, []);


  return (
    <article ref={artigo} data-estilo={preferencias.estilo} className="capitulo" aria-labelledby="titulo-da-secao" onClick={aoClicar} {...(snapshot.idioma ? { lang: snapshot.idioma } : {})}>
      {tituloDaSecao === undefined ? null : (
        <h1
          className="titulo-da-secao"
          id="titulo-da-secao"
          data-bloco={tituloDaSecao.id}
          data-inicio={0}
          data-tipo={tituloDaSecao.tipo}
        >
          <AnnotatedText bloco={tituloDaSecao} marcas={marcasDo(tituloDaSecao)} ativa={ativaDo(tituloDaSecao)} />
        </h1>
      )}
      {abertura}
      {grupos.map((grupo) =>
        grupo.tipo === 'lista' ? (
          <ul className="lista" key={grupo.blocos[0]?.id}>
            {grupo.blocos.map((bloco) => (
              <BlockRenderer key={bloco.id} bloco={bloco} formatacao={snapshot.formatacao?.[bloco.id]} marcas={marcasDo(bloco)} assets={assets} ativa={ativaDo(bloco)} comoItemDeLista antes={imagens(bloco, 'antes')} depois={imagens(bloco, 'depois')} />
            ))}
          </ul>
        ) : (
          <Fragment key={grupo.bloco.id}>{imagens(grupo.bloco, 'antes')}<BlockRenderer bloco={grupo.bloco} formatacao={snapshot.formatacao?.[grupo.bloco.id]} marcas={marcasDo(grupo.bloco)} assets={assets} ativa={ativaDo(grupo.bloco)} />{imagens(grupo.bloco, 'depois')}</Fragment>
        ),
      )}
      {nota && artigo.current && <NotaAberta key={nota.id} versaoId={snapshot.versao_id} nota={nota.id} chamada={nota.chamada} artigo={artigo.current}
        local={textoDaNota(blocos, nota.id)} aoFechar={fecharNota} />}
      <CamadaDeMarcas artigo={artigo} marcas={marcas} ativa={ativa} preferencias={preferencias} pessoais={snapshot.tracosPessoais} guia={snapshot.guia ?? null} />
    </article>
  );
}
