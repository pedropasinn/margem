/** As resoluções do documento, das mais novas às mais antigas; tocar numa abre a sessão. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { removerResolucao, resolucoesDoDocumento, type SessaoDaApi } from '../../biblioteca/api';
import { TextoComMatematica } from './Matematica';

const ROTULO_DO_ESTADO: Record<SessaoDaApi['estado'], string> = { pendente: 'a resolver', resolvendo: 'resolvendo…', respondendo: 'respondendo…', pronta: '', falhou: 'falhou' };
const EM_ANDAMENTO = new Set<SessaoDaApi['estado']>(['resolvendo', 'respondendo']);

export function ListaDeResolucoes({ documentoId, aoAbrir, aoRemover, fontes = { listar: resolucoesDoDocumento, remover: removerResolucao } }: {
  documentoId: string; aoAbrir: (id: string) => void;
  /** Depois de remover: quem desenha os exercícios na página lista de novo. */
  aoRemover?: () => void;
  fontes?: { listar: typeof resolucoesDoDocumento; remover?: typeof removerResolucao };
}): ReactNode {
  const [sessoes, definir] = useState<SessaoDaApi[] | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [removendo, definirRemovendo] = useState(false);
  useEffect(() => {
    fontes.listar(documentoId).then((resposta) => definir(resposta.resolucoes), (falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível listar.'));
  }, [documentoId, fontes]);
  const remover = useCallback(async (ids: string[]) => {
    if (!fontes.remover || ids.length === 0) return;
    definirRemovendo(true);
    try {
      for (const id of ids) await fontes.remover(id);
      definir((atuais) => atuais?.filter(({ resolucao }) => !ids.includes(resolucao.id)) ?? atuais);
      aoRemover?.();
    } catch (falha) {
      definirErro(falha instanceof Error ? falha.message : 'Não foi possível remover.');
    } finally {
      definirRemovendo(false);
    }
  }, [fontes, aoRemover]);
  if (erro) return <p className="aviso-estudo" role="alert">{erro}</p>;
  if (!sessoes) return <p role="status">Carregando…</p>;
  if (sessoes.length === 0) return <p className="lista-vazia">Nenhum exercício resolvido ainda. Use “Resolver exercício” e arraste sobre o exercício na página.</p>;
  const falhas = sessoes.filter(({ estado }) => estado === 'falhou').map(({ resolucao }) => resolucao.id);
  return <>
    {fontes.remover && falhas.length > 0 && <button type="button" className="remover-falhas" disabled={removendo} onClick={() => void remover(falhas)}>
      Remover {falhas.length === 1 ? 'a que falhou' : `as ${String(falhas.length)} que falharam`}
    </button>}
    <ul className="lista-de-resolucoes">{sessoes.map(({ resolucao, estado }) => {
      const titulo = resolucao.resolucao?.enunciado ?? (resolucao.texto_extraido.trim() || 'Exercício recortado');
      return <li key={resolucao.id}>
        <button type="button" className="abrir-resolucao" onClick={() => aoAbrir(resolucao.id)}>
          <span className="eyebrow">{resolucao.origem.tipo === 'recorte' ? `p. ${String(resolucao.origem.pagina)}` : 'trecho'}{ROTULO_DO_ESTADO[estado] ? ` · ${ROTULO_DO_ESTADO[estado]}` : ''}</span>
          <span className="titulo-da-resolucao"><TextoComMatematica texto={titulo} /></span>
        </button>
        {fontes.remover && !EM_ANDAMENTO.has(estado) && <button type="button" className="remover-resolucao" disabled={removendo}
          aria-label={`Remover: ${titulo.replace(/\$/g, '').slice(0, 60)}`} title="Remover" onClick={() => void remover([resolucao.id])}>Remover</button>}
      </li>;
    })}</ul>
  </>;
}
