import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Primitives';
import './onboarding.css';
import ThoughtLine from '../ui/pensando/ThoughtLine';
import type { Rota } from '../biblioteca/rotas';
import { usarOnboarding } from './ContextoDoOnboarding';
import { AUTOR_DO_EXEMPLO, TITULO_DO_EXEMPLO, usarExemplo, type FontesDoExemplo } from './exemplo';
import { listarQuadros } from '../quadros/api';
import type { ListaDeQuadros, ResumoDoQuadro } from '../quadros/tipos';
import { usarRecurso } from '../recursos';

export interface PropsDoPrimeiroDocumento {
  ir: (destino: Rota) => void;
  /** Chamado antes de navegar (o diálogo de boas-vindas se fecha). */
  aoSair?: () => void;
  fontes?: FontesDoExemplo;
  /** A lista de quadros, de onde sai a obra de exemplo (testes trocam). */
  quadros?: () => Promise<ListaDeQuadros>;
}

/**
 * A obra de exemplo dos Quadros: a primeira do acervo de exemplo (`fixtures/arte`, já analisada e
 * narrada), que abre direto, sem chamar o Codex. Sem a arte ou sem exemplo, `null`.
 */
function usarObraDeExemplo(carregar: () => Promise<ListaDeQuadros>): ResumoDoQuadro | null {
  const arte = usarRecurso('arte');
  const [obra, definir] = useState<ResumoDoQuadro | null>(null);
  useEffect(() => {
    if (!arte) return;
    let vivo = true;
    carregar().then((lista) => { if (vivo) definir((Array.isArray(lista.obras) ? lista.obras : []).find((q) => q.exemplo) ?? null); }, () => {});
    return () => { vivo = false; };
  }, [arte, carregar]);
  return arte ? obra : null;
}

/**
 * As portas para o primeiro item, uma por jeito de estudar: o texto de exemplo (adicionado por aqui e
 * aberto no leitor quando o texto fica disponível), a obra de exemplo dos Quadros, um vídeo do YouTube
 * e "trazer o seu", que leva a Adicionar.
 */
export function PrimeiroDocumento({ ir, aoSair, fontes, quadros = listarQuadros }: PropsDoPrimeiroDocumento): ReactNode {
  const { estado, despachar } = usarOnboarding();
  const aoRegistrar = useCallback((documento_id: string) => despachar({ tipo: 'registrar_documento', origem: 'exemplo', documento_id }), [despachar]);
  const aoPronto = useCallback((documento_id: string) => { aoSair?.(); ir({ nome: 'leitura', documento_id }); }, [aoSair, ir]);
  const exemplo = usarExemplo({ existente: estado.exemplo_id, aoRegistrar, aoPronto, ...(fontes ? { fontes } : {}) });
  const ocupado = exemplo.fase === 'enviando' || exemplo.fase === 'preparando';
  const sair = (destino: Rota) => { aoSair?.(); ir(destino); };
  const obra = usarObraDeExemplo(quadros);
  return <div className="primeiro-documento">
    <ul className="portas-do-documento">
      <li><Button variante="ghost" className="porta" disabled={ocupado} onClick={() => void exemplo.abrir()}>
        <Icon name="livro" size={22} /><span className="porta-texto"><span className="porta-titulo">Ler um texto de exemplo</span>
          <span className="porta-detalhe">“{TITULO_DO_EXEMPLO}”, de {AUTOR_DO_EXEMPLO} · conto curto, domínio público</span></span>
        <Icon name="arrow" size={18} /></Button></li>
      {obra && <li><Button variante="ghost" className="porta" disabled={ocupado} onClick={() => sair({ nome: 'quadro', slug: obra.slug })}>
        <Icon name="quadro" size={22} /><span className="porta-texto"><span className="porta-titulo">Observar um quadro de exemplo</span>
          <span className="porta-detalhe">“{obra.titulo}”{obra.artista ? `, de ${obra.artista}` : ''} · já analisado, abre na hora</span></span>
        <Icon name="arrow" size={18} /></Button></li>}
      <li><Button variante="ghost" className="porta" disabled={ocupado} onClick={() => sair({ nome: 'adicionar', aba: 'video' })}>
        <Icon name="video-doc" size={22} /><span className="porta-texto"><span className="porta-titulo">Assistir a um vídeo do YouTube</span>
          <span className="porta-detalhe">Cole o link: o vídeo entra com a transcrição</span></span>
        <Icon name="arrow" size={18} /></Button></li>
      <li><Button variante="ghost" className="porta" disabled={ocupado} onClick={() => sair({ nome: 'adicionar', aba: 'documento' })}>
        <Icon name="upload" size={22} /><span className="porta-texto"><span className="porta-titulo">Trazer o seu</span>
          <span className="porta-detalhe">PDF, EPUB, Markdown, TXT ou um texto colado</span></span>
        <Icon name="arrow" size={18} /></Button></li>
    </ul>
    <SituacaoDoExemplo fase={exemplo.fase} erro={exemplo.erro} documento={exemplo.documento} sair={sair} tentar={() => void exemplo.abrir()} />
  </div>;
}

function SituacaoDoExemplo({ fase, erro, documento, sair, tentar }: {
  fase: ReturnType<typeof usarExemplo>['fase']; erro: string | null; documento: string | null;
  sair: (destino: Rota) => void; tentar: () => void;
}): ReactNode {
  if (fase === 'parado') return null;
  if (fase === 'erro') return <p className="aviso situacao-do-exemplo" role="alert">{erro} <Button variante="ghost" className="small" onClick={tentar}>Tentar de novo</Button></p>;
  if (fase === 'demorando') {
    return <p className="situacao-do-exemplo" role="status">O texto ainda está sendo preparado (o serviço de preparação pode estar ocupado).
      {documento && <Button variante="ghost" className="small" onClick={() => sair({ nome: 'documento', documento_id: documento })}>Ver o documento <Icon name="arrow" size={14} /></Button>}</p>;
  }
  return <div className="situacao-do-exemplo" role="status"><ThoughtLine key={fase} collapsible={false} showTimer={false} fontSize={14} color="var(--texto-2)" glyphColor="var(--accent)"
    label={fase === 'enviando' ? 'Adicionando o exemplo à sua biblioteca…' : 'Preparando o texto… leva alguns segundos.'} /></div>;
}
