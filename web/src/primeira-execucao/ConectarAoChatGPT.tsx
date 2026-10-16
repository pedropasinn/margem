/**
 * "Conectar ao ChatGPT" no app de computador (U-01/W-05): reabre o login da janela de abertura, com o Codex
 * que vem com o Margem e a pasta de credenciais dele. Pelo navegador (com o link que a própria CLI abre) ou
 * por um código de uso único. Terminado o login, a checagem da instalação é refeita sem a memória curta.
 *
 * Composição: os botões e o `.instrucao` de sempre; nenhuma cor nova, nenhuma faixa lateral.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui/Primitives';
import { usarInstalacao } from './ContextoDaInstalacao';
import { jaConectou, lembrarConexao, ponteDoChatGPT, type PonteDoChatGPT } from './ponte-do-chatgpt';
import './primeira-execucao.css';

type Fase =
  | { fase: 'parado' }
  | { fase: 'entrando'; dispositivo: boolean; link: string | null; codigo: string | null }
  | { fase: 'conectado' }
  | { fase: 'falhou'; mensagem: string };

/**
 * A frase da falha. O app manda frases próprias quando a CLI não roda (W-06: antivírus, política); qualquer
 * outra coisa (a saída da CLI pode vir em inglês) vira a frase padrão.
 */
export function fraseDaFalhaDoLogin(valor: string | undefined): string {
  if (valor !== undefined && /not found|ENOENT/u.test(valor)) {
    return 'O Codex que vem com o Margem não abriu. Reinstale o Margem pelo site margem.dev; a biblioteca e as notas continuam onde estão.';
  }
  if (valor !== undefined && /[áàâãéêíóôõúç]/iu.test(valor) && valor.trim() !== 'O login não terminou.') return valor.trim();
  return 'O login não terminou. Tente de novo; se o navegador não abrir, use um código.';
}

export function ConectarAoChatGPT({ ponte = ponteDoChatGPT(), reconectar = jaConectou(), aoConectar }: {
  ponte?: PonteDoChatGPT | null;
  /** A conta já esteve conectada neste aparelho: o botão diz "Conectar novamente". */
  reconectar?: boolean;
  aoConectar?: () => void;
}): ReactNode {
  const { verificar } = usarInstalacao();
  const [fase, definir] = useState<Fase>({ fase: 'parado' });
  const cancelado = useRef(false);
  /** O que o app disse ao falhar (W-06), para a frase final. */
  const falhaDoApp = useRef<string | undefined>(undefined);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    if (ponte === null) return undefined;
    const parar = ponte.aoEvento((evento) => {
      if (!vivo.current) return;
      if (evento.tipo === 'link' && evento.valor) definir((atual) => atual.fase === 'entrando' ? { ...atual, link: evento.valor ?? null } : atual);
      if (evento.tipo === 'codigo' && evento.valor) definir((atual) => atual.fase === 'entrando' ? { ...atual, codigo: evento.valor ?? null } : atual);
      if (evento.tipo === 'falhou') falhaDoApp.current = evento.valor;
    });
    return () => { vivo.current = false; parar(); };
  }, [ponte]);
  // Sair da tela com o login correndo encerra o login (o processo não fica esperando à toa).
  const correndo = fase.fase === 'entrando';
  const correndoRef = useRef(correndo); correndoRef.current = correndo;
  useEffect(() => () => { if (correndoRef.current) void ponte?.cancelar().catch(() => undefined); }, [ponte]);

  if (ponte === null) {
    return <p className="instrucao-texto">Abra o app do Margem neste computador e use <strong>Conectar ao ChatGPT</strong> nas Configurações.</p>;
  }
  const entrar = async (dispositivo: boolean): Promise<void> => {
    cancelado.current = false;
    falhaDoApp.current = undefined;
    definir({ fase: 'entrando', dispositivo, link: null, codigo: null });
    let ok = false;
    try { ok = await ponte.entrar(dispositivo); } catch { ok = false; }
    if (!vivo.current) return;
    if (ok) {
      lembrarConexao();
      definir({ fase: 'conectado' });
      await verificar(true);
      aoConectar?.();
      return;
    }
    if (cancelado.current) { definir({ fase: 'parado' }); return; }
    // Sem o Codex embutido, o estado diz; senão, o login não terminou.
    const estado = await ponte.estado().catch(() => null);
    definir({ fase: 'falhou', mensagem: estado !== null && !estado.encontrado ? fraseDaFalhaDoLogin('not found') : fraseDaFalhaDoLogin(estado?.falha?.mensagem ?? falhaDoApp.current) });
  };
  const cancelar = () => { cancelado.current = true; void ponte.cancelar().catch(() => undefined); };

  if (fase.fase === 'conectado') return <p className="conectar-chatgpt-estado" role="status">Conectado à sua conta do ChatGPT.</p>;
  if (fase.fase === 'entrando') {
    return <div className="conectar-chatgpt" role="status" aria-live="polite">
      {fase.dispositivo
        ? fase.codigo === null
          ? <p className="instrucao-texto">Gerando o código…</p>
          : <>
            <p className="instrucao-texto">Abra a página de login, entre na sua conta e digite este código:</p>
            <p className="conectar-chatgpt-codigo" aria-label={`Código: ${fase.codigo}`}>{fase.codigo}</p>
          </>
        : <p className="instrucao-texto">Termine o login no navegador e volte para cá.</p>}
      <div className="button-row">
        {fase.link !== null && <Button className="small" onClick={() => { if (fase.link) void ponte.abrirLink(fase.link); }}>Abrir a página de login</Button>}
        <Button variante="ghost" className="small" onClick={cancelar}>Cancelar</Button>
      </div>
    </div>;
  }
  return <div className="conectar-chatgpt">
    {fase.fase === 'falhou' && <p className="aviso" role="alert">{fase.mensagem}</p>}
    <div className="button-row">
      <Button variante="primario" className="small" onClick={() => void entrar(false)}>{reconectar ? 'Conectar novamente' : 'Conectar ao ChatGPT'}</Button>
      <Button variante="ghost" className="small" onClick={() => void entrar(true)}>Usar um código</Button>
    </div>
  </div>;
}

/**
 * Configurações → Conta do ChatGPT (só no app de computador): o estado do login do app e o botão de
 * conectar (ou conectar novamente). Sem o Codex embutido, diz para reinstalar.
 */
export function ContaDoChatGPT({ ponte = ponteDoChatGPT() }: { ponte?: PonteDoChatGPT | null } = {}): ReactNode {
  const [estado, definir] = useState<Awaited<ReturnType<PonteDoChatGPT['estado']>> | 'carregando' | 'falhou'>('carregando');
  const [revisao, recarregar] = useState(0);
  useEffect(() => {
    if (ponte === null) return undefined;
    let vivo = true;
    ponte.estado().then((novo) => { if (vivo) definir(novo); }, () => { if (vivo) definir('falhou'); });
    return () => { vivo = false; };
  }, [ponte, revisao]);
  if (ponte === null) return null;
  const logado = typeof estado === 'object' && estado.logado === true;
  return <section className="card configuracao-do-chatgpt" id="chatgpt" aria-labelledby="titulo-do-chatgpt" aria-busy={estado === 'carregando'}>
    <div className="cabeca-da-secao">
      <h2 id="titulo-do-chatgpt">Conta do ChatGPT</h2>
      <p className="secundario">As marcas são feitas pelo Codex que vem com o Margem, com a sua conta do ChatGPT. O login fica só neste computador.</p>
    </div>
    {estado === 'carregando' ? <p className="secundario">Conferindo…</p>
      : estado === 'falhou' ? <><p className="aviso" role="alert">Não foi possível conferir a conexão agora.</p>
        <div className="button-row"><Button className="small" onClick={() => recarregar((n) => n + 1)}>Tentar novamente</Button></div></>
        : !estado.encontrado ? <p className="aviso" role="status">O Codex que vem com o Margem não foi encontrado. Reinstale o Margem com o instalador de margem.dev; a biblioteca e as notas continuam onde estão.</p>
          : logado ? <p className="conectar-chatgpt-estado" role="status">{estado.conta === 'chave_api' ? 'Conectado com uma chave de API (o Margem foi pensado para a conta do ChatGPT).' : 'Conectado à sua conta do ChatGPT.'}</p>
            : <>
              <p role="status">{estado.logado === false ? (jaConectou() ? 'A conexão com o ChatGPT terminou.' : 'Ainda não conectado.') : estado.falha?.mensagem ?? 'Não foi possível conferir a conexão agora.'}</p>
              <ConectarAoChatGPT ponte={ponte} aoConectar={() => recarregar((n) => n + 1)} />
            </>}
  </section>;
}
