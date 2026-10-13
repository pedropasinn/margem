import { useCallback, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Primitives';
import './onboarding.css';
import ThoughtLine from '../ui/pensando/ThoughtLine';
import type { Rota } from '../biblioteca/rotas';
import { usarOnboarding } from './ContextoDoOnboarding';
import { AUTOR_DO_EXEMPLO, TITULO_DO_EXEMPLO, usarExemplo, type FontesDoExemplo } from './exemplo';

export interface PropsDoPrimeiroDocumento {
  ir: (destino: Rota) => void;
  /** Chamado antes de navegar (o diálogo de boas-vindas se fecha). */
  aoSair?: () => void;
  fontes?: FontesDoExemplo;
}

/**
 * As três portas para o primeiro texto: o exemplo, um arquivo ou um texto colado. As duas últimas
 * levam à tela "Adicionar" (o mesmo fluxo de sempre); o exemplo é adicionado por aqui e, quando o
 * texto fica disponível, abre no leitor.
 */
export function PrimeiroDocumento({ ir, aoSair, fontes }: PropsDoPrimeiroDocumento): ReactNode {
  const { estado, despachar } = usarOnboarding();
  const aoRegistrar = useCallback((documento_id: string) => despachar({ tipo: 'registrar_documento', origem: 'exemplo', documento_id }), [despachar]);
  const aoPronto = useCallback((documento_id: string) => { aoSair?.(); ir({ nome: 'leitura', documento_id }); }, [aoSair, ir]);
  const exemplo = usarExemplo({ existente: estado.exemplo_id, aoRegistrar, aoPronto, ...(fontes ? { fontes } : {}) });
  const ocupado = exemplo.fase === 'enviando' || exemplo.fase === 'preparando';
  const sair = (destino: Rota) => { aoSair?.(); ir(destino); };
  return <div className="primeiro-documento">
    <ul className="portas-do-documento">
      <li><Button variante="ghost" className="porta" disabled={ocupado} onClick={() => void exemplo.abrir()}>
        <Icon name="livro" size={22} /><span className="porta-texto"><span className="porta-titulo">Abrir um texto de exemplo</span>
          <span className="porta-detalhe">“{TITULO_DO_EXEMPLO}”, de {AUTOR_DO_EXEMPLO} · conto curto, domínio público</span></span>
        <Icon name="arrow" size={18} /></Button></li>
      <li><Button variante="ghost" className="porta" disabled={ocupado} onClick={() => sair({ nome: 'adicionar' })}>
        <Icon name="upload" size={22} /><span className="porta-texto"><span className="porta-titulo">Importar um arquivo</span>
          <span className="porta-detalhe">PDF, EPUB, Markdown ou TXT</span></span>
        <Icon name="arrow" size={18} /></Button></li>
      <li><Button variante="ghost" className="porta" disabled={ocupado} onClick={() => sair({ nome: 'adicionar', entrada: 'colado' })}>
        <Icon name="aspas" size={22} /><span className="porta-texto"><span className="porta-titulo">Colar um texto</span>
          <span className="porta-detalhe">Um artigo, um capítulo, um poema</span></span>
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
