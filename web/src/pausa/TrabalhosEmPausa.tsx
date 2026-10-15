/**
 * "N trabalhos do Codex esperando" (V-F1, decisão de produto: perguntar antes). O que ficou parado desde
 * antes de o app abrir não roda sozinho: este cartão, no topo dos avisos do canto, oferece Retomar, Ver
 * (a lista por documento, cada item com Retomar e Descartar) e Descartar todos (com confirmação).
 *
 * `CartaoDaPausa` só desenha (os testes e a galeria o usam com dados falsos); `usarTrabalhosEmPausa` liga
 * o cartão ao serviço: consulta ao abrir e a cada meio minuto (a pausa nasce quando o worker parte, que
 * pode ser depois da janela).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { FONTES_DA_PAUSA, VAZIO, type AlvoDaPausa, type FontesDaPausa, type TrabalhosEmPausa } from './api';
import './pausa.css';

export const INTERVALO_DA_PAUSA_MS = 30_000;

const plural = (n: number, um: string, varios: string) => `${String(n)} ${n === 1 ? um : varios}`;
const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** "hoje às 08:10", "ontem às 14:20", "12/10 às 09:00" (no fuso de quem lê). */
export function quandoParou(desde: string, agora: Date = new Date()): string {
  const data = new Date(desde);
  if (Number.isNaN(data.getTime())) return 'antes';
  const hora = `${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`;
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((dia(agora) - dia(data)) / 86_400_000);
  if (dias <= 0) return `hoje às ${hora}`;
  if (dias === 1) return `ontem às ${hora}`;
  return `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)} às ${hora}`;
}

export interface PropsDoCartao {
  pausa: TrabalhosEmPausa;
  agora?: Date;
  aoRetomar: (alvo: AlvoDaPausa) => Promise<void>;
  aoDescartar: (alvo: AlvoDaPausa) => Promise<void>;
  /** Lista aberta de saída (galeria e capturas). */
  listaAberta?: boolean;
}

export function CartaoDaPausa({ pausa, agora, aoRetomar, aoDescartar, listaAberta = false }: PropsDoCartao): ReactNode {
  const [aberta, abrir] = useState(listaAberta);
  const [confirmando, confirmar] = useState(false);
  const [ocupado, ocupar] = useState(false);
  const [falha, definirFalha] = useState<string | null>(null);
  if (pausa.total === 0) return null;
  const agir = async (acao: () => Promise<void>, mensagem: string) => {
    ocupar(true); definirFalha(null);
    try { await acao(); confirmar(false); }
    catch (erro) { definirFalha(erro instanceof Error ? erro.message : mensagem); }
    finally { ocupar(false); }
  };
  const retomar = (alvo: AlvoDaPausa) => void agir(() => aoRetomar(alvo), 'Não foi possível retomar.');
  const descartar = (alvo: AlvoDaPausa) => void agir(() => aoDescartar(alvo), 'Não foi possível descartar.');
  const titulo = `${plural(pausa.total, 'trabalho do Codex', 'trabalhos do Codex')} esperando`;
  return <section className="cartao-da-pausa" aria-label={titulo} data-aberta={aberta || undefined}>
    <span className="icone-da-pausa" aria-hidden="true"><Icon name="pausar" size={16} /></span>
    <div className="corpo-da-pausa">
      <p className="titulo-da-pausa">{titulo}</p>
      <p className="meta-da-pausa">
        {pausa.desde !== null ? `${pausa.total === 1 ? 'Parado' : 'Parados'} desde ${quandoParou(pausa.desde, agora)}. ` : ''}
        {pausa.total === 1 ? 'Só continua se você mandar.' : 'Só continuam se você mandar.'}
      </p>
      {aberta && <ul className="lista-da-pausa" aria-label="Trabalhos esperando">
        {pausa.grupos.map((grupo) => <li key={grupo.documento_id ?? 'sem-documento'}>
          <p className="documento-da-pausa">{grupo.titulo ?? 'Fora de um documento'}</p>
          <ul>{grupo.itens.map((item) => <li key={item.ids.join(',')} className="item-da-pausa">
            <span className="rotulo-da-pausa">{item.rotulo}{item.quantidade > 1 ? ` · ${String(item.quantidade)}` : ''}</span>
            <span className="acoes-do-item">
              <button type="button" className="botao-da-pausa" disabled={ocupado} aria-label={`Retomar: ${item.rotulo}${grupo.titulo ? ` de ${grupo.titulo}` : ''}`}
                onClick={() => retomar({ ids: item.ids })}>Retomar</button>
              <button type="button" className="botao-da-pausa descartar" disabled={ocupado} aria-label={`Descartar: ${item.rotulo}${grupo.titulo ? ` de ${grupo.titulo}` : ''}`}
                onClick={() => descartar({ ids: item.ids })}>Descartar</button>
            </span>
          </li>)}</ul>
        </li>)}
      </ul>}
      {confirmando
        ? <div className="confirmacao-da-pausa" role="group" aria-label="Confirmar descarte">
          <p>{pausa.total === 1 ? 'Descartar este trabalho? O Codex não vai fazê-lo.' : `Descartar os ${String(pausa.total)}? O Codex não vai fazer nenhum deles.`}</p>
          <span className="acoes-da-pausa">
            <button type="button" className="botao-da-pausa descartar forte" disabled={ocupado} onClick={() => descartar({ todos: true })}>Descartar</button>
            <button type="button" className="botao-da-pausa" disabled={ocupado} onClick={() => confirmar(false)}>Voltar</button>
          </span>
        </div>
        : <span className="acoes-da-pausa">
          <button type="button" className="botao-da-pausa principal" disabled={ocupado} onClick={() => retomar({ todos: true })}>{pausa.total === 1 ? 'Retomar' : 'Retomar todos'}</button>
          <button type="button" className="botao-da-pausa" aria-expanded={aberta} disabled={ocupado} onClick={() => abrir(!aberta)}>{aberta ? 'Esconder' : 'Ver'}</button>
          <button type="button" className="botao-da-pausa descartar" disabled={ocupado} onClick={() => confirmar(true)}>{pausa.total === 1 ? 'Descartar' : 'Descartar todos'}</button>
        </span>}
      {falha && <p className="falha-da-pausa" role="alert">{falha}</p>}
    </div>
  </section>;
}

/** O estado da pausa, do serviço. Erro de rede vale como "nada em pausa" (o cartão some, sem alarme). */
export function usarTrabalhosEmPausa(fontes: FontesDaPausa = FONTES_DA_PAUSA, intervaloMs = INTERVALO_DA_PAUSA_MS): {
  pausa: TrabalhosEmPausa; retomar: (alvo: AlvoDaPausa) => Promise<void>; descartar: (alvo: AlvoDaPausa) => Promise<void>;
} {
  const [pausa, definir] = useState<TrabalhosEmPausa>(VAZIO);
  const fontesRef = useRef(fontes);
  fontesRef.current = fontes;
  useEffect(() => {
    let vivo = true;
    const consultar = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fontesRef.current.listar().then((nova) => { if (vivo) definir(nova); }, () => undefined);
    };
    consultar();
    const relogio = setInterval(consultar, intervaloMs);
    return () => { vivo = false; clearInterval(relogio); };
  }, [intervaloMs]);
  const retomar = useCallback(async (alvo: AlvoDaPausa) => { definir(await fontesRef.current.retomar(alvo)); }, []);
  const descartar = useCallback(async (alvo: AlvoDaPausa) => { definir(await fontesRef.current.descartar(alvo)); }, []);
  return { pausa, retomar, descartar };
}
