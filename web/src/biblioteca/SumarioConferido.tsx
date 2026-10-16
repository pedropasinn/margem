/**
 * Conferência do sumário (J164). Na página do documento, um aviso discreto quando o sumário de um EPUB
 * ou PDF novo parece errado ("O sumário deste livro pode estar errado"), com a sugestão do Codex, antes e
 * depois, e "Usar o sumário sugerido" / "Manter". Usar a sugestão troca só os títulos e os níveis que o
 * sumário mostra: o texto, os capítulos e os grifos ficam como estão. Nas Configurações, o interruptor
 * "Conferir o sumário com o ChatGPT ao importar".
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Switch } from '../ui/Primitives';
import { escrever, pedir } from './api';
import './sumario-conferido.css';

export interface EntradaDoSumario { titulo: string; nivel: number }
export interface SituacaoDoSumario {
  versao_id: string;
  estado: 'conferindo' | 'ok' | 'suspeito' | 'aplicada' | 'mantida';
  problemas: string[];
  antes: EntradaDoSumario[];
  depois: EntradaDoSumario[] | null;
}

export const lerSumarioConferido = (documentoId: string) => pedir<{ situacao: SituacaoDoSumario | null }>(`/api/documentos/${documentoId}/sumario`);
export const decidirSumario = (documentoId: string, decisao: 'usar' | 'manter') =>
  escrever<{ situacao: SituacaoDoSumario | null }>(`/api/documentos/${documentoId}/sumario`, { decisao });
export const lerPreferenciaDoSumario = () => pedir<{ conferir_ao_importar: boolean }>('/api/configuracoes/sumario');
export const gravarPreferenciaDoSumario = (conferir: boolean) =>
  escrever<{ conferir_ao_importar: boolean }>('/api/configuracoes/sumario', { conferir_ao_importar: conferir }, 'PUT');

const FONTES = { ler: lerSumarioConferido, decidir: decidirSumario };

/** Uma resposta sem a forma esperada (um serviço anterior, que não conhece a rota) não mostra aviso. */
function situacaoValida(resposta: unknown): SituacaoDoSumario | null {
  const situacao = typeof resposta === 'object' && resposta !== null ? (resposta as { situacao?: unknown }).situacao : null;
  return typeof situacao === 'object' && situacao !== null && typeof (situacao as SituacaoDoSumario).estado === 'string'
    && Array.isArray((situacao as SituacaoDoSumario).antes) && Array.isArray((situacao as SituacaoDoSumario).problemas)
    ? situacao as SituacaoDoSumario : null;
}

function Lista({ titulo, entradas }: { titulo: string; entradas: readonly EntradaDoSumario[] }): ReactNode {
  return <div className="sumario-conferido-lista">
    <p className="eyebrow">{titulo}</p>
    <ol>{entradas.map((entrada, indice) => <li key={`${String(indice)}-${entrada.titulo}`} className={`nivel-${String(Math.min(entrada.nivel, 4))}`}>{entrada.titulo}</li>)}</ol>
  </div>;
}

/** R3-6: enquanto o Codex confere, a página pergunta de novo a cada tanto (a conferência leva até 3 min). */
export const INTERVALO_DA_CONFERENCIA_MS = 5_000;

export function SumarioConferido({ documentoId, aoMudar, fontes = FONTES, intervalo = INTERVALO_DA_CONFERENCIA_MS }: {
  documentoId: string;
  /** Depois de usar ou manter: a página recarrega o sumário (capítulos lidos, a lista ao lado). */
  aoMudar?: () => void;
  fontes?: typeof FONTES;
  intervalo?: number;
}): ReactNode {
  const [situacao, definir] = useState<SituacaoDoSumario | null>(null);
  const [aberto, abrir] = useState(false);
  const [ocupado, ocupar] = useState(false);
  const [falha, falhar] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    fontes.ler(documentoId).then((resposta) => { if (vivo) definir(situacaoValida(resposta)); }, () => { if (vivo) definir(null); });
    return () => { vivo = false; };
  }, [documentoId, fontes]);
  const conferindo = situacao?.estado === 'conferindo';
  useEffect(() => {
    if (!conferindo) return;
    let vivo = true;
    // Uma consulta por vez: a próxima só sai quando a anterior volta, e para quando a conferência termina.
    let tempo = setTimeout(function consultar() {
      fontes.ler(documentoId).then((resposta) => {
        if (!vivo) return;
        const nova = situacaoValida(resposta);
        if (nova?.estado === 'conferindo') tempo = setTimeout(consultar, intervalo);
        else definir(nova);
      }, () => { if (vivo) tempo = setTimeout(consultar, intervalo); });
    }, intervalo);
    return () => { vivo = false; clearTimeout(tempo); };
  }, [conferindo, documentoId, fontes, intervalo]);
  const decidir = useCallback(async (decisao: 'usar' | 'manter') => {
    ocupar(true); falhar(null);
    try { definir(situacaoValida(await fontes.decidir(documentoId, decisao))); abrir(false); aoMudar?.(); }
    catch (erro) { falhar(erro instanceof Error ? erro.message : 'Não foi possível salvar.'); }
    finally { ocupar(false); }
  }, [aoMudar, documentoId, fontes]);

  if (situacao === null) return null;
  if (situacao.estado === 'aplicada') {
    return <p className="sumario-conferido sumario-em-uso" role="status">
      O sumário sugerido está em uso.{' '}
      <Button variante="ghost" tamanho="sm" disabled={ocupado} onClick={() => void decidir('manter')}>Voltar ao original</Button>
      {falha && <span className="dados"> {falha}</span>}
    </p>;
  }
  if (situacao.estado !== 'suspeito') return null;
  const { depois } = situacao;
  return <section className="sumario-conferido aviso" aria-label="Sumário">
    <div className="sumario-conferido-linha">
      <p><strong>O sumário deste livro pode estar errado.</strong>{situacao.problemas[0] && <> {situacao.problemas[0]}</>}</p>
      <div className="sumario-conferido-acoes">
        {depois !== null && <Button variante="ghost" tamanho="sm" aria-expanded={aberto} onClick={() => abrir(!aberto)}>{aberto ? 'Esconder sugestão' : 'Ver sugestão'}</Button>}
        {(!aberto || depois === null) && <Button variante="ghost" tamanho="sm" disabled={ocupado} onClick={() => void decidir('manter')}>Manter</Button>}
      </div>
    </div>
    {aberto && depois !== null && <>
      {situacao.problemas.length > 1 && <ul className="sumario-conferido-problemas">{situacao.problemas.slice(1).map((problema) => <li key={problema}>{problema}</li>)}</ul>}
      <div className="sumario-conferido-comparacao">
        <Lista titulo="Agora" entradas={situacao.antes} />
        <Lista titulo="Sugerido" entradas={depois} />
      </div>
      <p className="dados">O texto e os seus grifos não mudam: só os títulos e os níveis do sumário.</p>
      <div className="sumario-conferido-acoes">
        <Button variante="primario" tamanho="sm" disabled={ocupado} onClick={() => void decidir('usar')}>Usar o sumário sugerido</Button>
        <Button variante="ghost" tamanho="sm" disabled={ocupado} onClick={() => void decidir('manter')}>Manter</Button>
      </div>
    </>}
    {falha && <p className="dados" role="alert">{falha}</p>}
  </section>;
}

const FONTES_DA_PREFERENCIA = { ler: lerPreferenciaDoSumario, gravar: gravarPreferenciaDoSumario };

/** Configurações → "Sumário dos livros": conferir ou não, ao importar um EPUB ou PDF. */
export function ConferenciaDoSumarioNasConfiguracoes({ fontes = FONTES_DA_PREFERENCIA }: { fontes?: typeof FONTES_DA_PREFERENCIA }): ReactNode {
  const [ligada, ligar] = useState<boolean | null>(null);
  const [aviso, avisar] = useState<string | null>(null);
  const [ocupado, ocupar] = useState(false);
  useEffect(() => { fontes.ler().then((valor) => ligar(valor.conferir_ao_importar), () => avisar('Não foi possível carregar.')); }, [fontes]);
  async function mudar(valor: boolean) {
    ocupar(true); avisar(null);
    try { ligar((await fontes.gravar(valor)).conferir_ao_importar); avisar('Salvo.'); }
    catch (erro) { avisar(erro instanceof Error ? erro.message : 'Não foi possível salvar.'); }
    finally { ocupar(false); }
  }
  return <section className="card" aria-label="Sumário dos livros">
    <h2>Sumário dos livros</h2>
    {ligada !== null && <Switch checked={ligada} disabled={ocupado} onChange={(valor) => void mudar(valor)}>Conferir o sumário com o ChatGPT ao importar</Switch>}
    <p className="dados">Quando um EPUB ou PDF entra e o sumário parece estranho, uma conferência rápida sugere outro. Você escolhe se usa.</p>
    {aviso && <p className="dados">{aviso}</p>}
  </section>;
}
