/**
 * Primeira execução de uma instalação local (J103).
 *
 * - `BoasVindasDaInstalacao`: o diálogo que aparece enquanto a primeira execução não foi concluída —
 *   o que é o Margem, a checagem do Codex com o comando exato, o exemplo já marcado e "Concluir".
 * - `ChecagemDaInstalacao`: a mesma checagem, reaproveitada na página "Primeiros passos".
 * - `AvisoDaInstalacao`: a faixa da casca quando o Codex falta, está deslogado, é antigo ou a cota
 *   acabou. `AvisoDoCodexCurto`: a mesma mensagem, compacta, onde se pede uma leitura.
 *
 * Composição dentro da linguagem existente: o diálogo é o `.card.boas-vindas` dos primeiros passos,
 * a lista é a `session-list`, os avisos são o `.aviso` de sempre. Nenhuma faixa lateral.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button, IconButton, usarFoco } from '../ui/Primitives';
import { Assinatura } from '../ui/Assinatura';
import type { Rota } from '../biblioteca/rotas';
import { usarOnboarding } from '../onboarding/ContextoDoOnboarding';
import { TresJeitos } from '../onboarding/BoasVindas';
import '../onboarding/onboarding.css';
import './primeira-execucao.css';
import { usarInstalacao } from './ContextoDaInstalacao';
import {
  abrirExemploDaInstalacao, avisoDaInstalacao, avisosDoApp, concluirPrimeiraExecucao, ferramentasDaChecagem, situacaoDoCodex,
  type AvisoDaInstalacao as Aviso, type EstadoDaInstalacao,
} from './estado';

/** Um comando de terminal com o botão de copiar. */
export function ComandoParaCopiar({ rotulo, comando }: { rotulo: string; comando: string }): ReactNode {
  const [copiado, definirCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const relogio = setTimeout(() => definirCopiado(false), 2000);
    return () => clearTimeout(relogio);
  }, [copiado]);
  const copiar = () => {
    void navigator.clipboard?.writeText(comando).then(() => definirCopiado(true), () => { /* sem área de transferência: o texto continua selecionável */ });
  };
  return <div className="comando-para-copiar">
    <span className="comando-rotulo">{rotulo}</span>
    <code>{comando}</code>
    <IconButton aria-label={copiado ? 'Copiado' : `Copiar o comando: ${comando}`} title={copiado ? 'Copiado' : 'Copiar'} onClick={copiar}>
      <Icon name={copiado ? 'check' : 'copiar'} size={16} />
    </IconButton>
  </div>;
}

function InstrucoesDoAviso({ aviso }: { aviso: Aviso }): ReactNode {
  return <>
    <p className="instrucao-texto">{aviso.texto}</p>
    {aviso.comandos.length > 0 && <div className="comandos">{aviso.comandos.map((c) => <ComandoParaCopiar key={c.rotulo} {...c} />)}</div>}
  </>;
}

interface Item { nome: string; ok: boolean | null; detalhe: string }

function itens(estado: EstadoDaInstalacao): Item[] {
  const situacao = situacaoDoCodex(estado.codex);
  const instalado: Item = situacao === 'falso'
    ? { nome: 'Codex', ok: true, detalhe: 'executor de teste: o Codex não é usado nesta instalação' }
    : !estado.codex.encontrado ? { nome: 'Codex instalado', ok: false, detalhe: 'não encontrado' }
      : { nome: 'Codex instalado', ok: estado.codex.compativel, detalhe: `${estado.codex.versao ?? 'versão desconhecida'}${estado.codex.compativel ? '' : ' · antiga demais'}` };
  const conectado: Item = situacao === 'falso' ? { nome: 'Conta', ok: true, detalhe: 'não é necessária' }
    : situacao === 'ausente' ? { nome: 'Conectado à sua conta', ok: null, detalhe: 'depois de instalar o Codex' }
      : estado.codex.logado === true ? { nome: 'Conectado à sua conta', ok: true, detalhe: estado.codex.conta === 'chave_api' ? 'com uma chave de API (o Margem foi pensado para a conta do ChatGPT)' : 'conta do ChatGPT' }
        : estado.codex.logado === false ? { nome: 'Conectado à sua conta', ok: false, detalhe: 'falta entrar na sua conta do ChatGPT' }
          : { nome: 'Conectado à sua conta', ok: null, detalhe: 'não deu para conferir agora' };
  return [
    { nome: 'Banco de dados', ok: estado.banco.ok, detalhe: estado.banco.ok ? 'seus textos e marcas ficam neste computador' : 'sem resposta' },
    { nome: 'Preparação dos documentos', ok: estado.motor.ok, detalhe: estado.motor.ok ? 'PDF, EPUB, Markdown, TXT e texto colado' : 'indisponível' },
    instalado,
    conectado,
    ...ferramentasDaChecagem(estado),
  ];
}

/** A checagem: as quatro linhas (e as ferramentas de mídia, quando verificadas), os avisos do app, o que fazer quando falta algo e "Verificar de novo". */
export function ChecagemDaInstalacao({ estado }: { estado: EstadoDaInstalacao }): ReactNode {
  const { verificar, verificando } = usarInstalacao();
  const aviso = avisoDaInstalacao(estado);
  return <div className="checagem-da-instalacao">
    <ul className="session-list" aria-label="O que esta instalação precisa">{itens(estado).map((item) =>
      <li key={item.nome} data-ok={item.ok === null ? 'talvez' : String(item.ok)}>
        <span className={`session-dot${item.ok === true ? ' done' : ''}`} aria-hidden="true">
          <Icon name={item.ok === true ? 'check' : item.ok === false ? 'alerta' : 'clock'} size={16} />
        </span>
        <div><span className="titulo">{item.nome}</span><div className="linha-meta"><span>{item.ok === true ? 'Pronto' : item.ok === false ? 'Falta' : 'A conferir'}</span><span>{item.detalhe}</span></div></div>
      </li>)}
    </ul>
    {aviso && aviso.tipo !== 'cota' && aviso.tipo !== 'app' && <div className="instrucao" role="status"><p className="instrucao-titulo">{aviso.titulo}</p><InstrucoesDoAviso aviso={aviso} /></div>}
    {avisosDoApp(estado).length > 0 && <ul className="avisos-do-app" aria-label="Avisos sobre esta instalação">
      {avisosDoApp(estado).map((texto) => <li key={texto} className="aviso">{texto}</li>)}</ul>}
    {aviso?.tipo === 'cota' && <p className="aviso" role="status">{aviso.titulo} {aviso.texto}</p>}
    {estado.instancia && <p className="identificacao-da-instalacao">Identificação deste Margem: <code>{estado.instancia.id}</code> · porta {estado.instancia.porta}</p>}
    <p className="verificar-de-novo"><Button variante="ghost" className="small" disabled={verificando} onClick={() => void verificar(true)}>
      <Icon name="restaurar" size={16} /> {verificando ? 'Verificando…' : 'Verificar de novo'}</Button></p>
  </div>;
}

/**
 * O diálogo da primeira execução. Fechar (Esc, clique fora ou "Depois") só o esconde nesta aba;
 * "Concluir" e "Abrir o exemplo" gravam no serviço e ele não volta.
 */
export function BoasVindasDaInstalacao({ estado, ir, aoFechar }: { estado: EstadoDaInstalacao; ir: (destino: Rota) => void; aoFechar: () => void }): ReactNode {
  const { marcarConcluida } = usarInstalacao();
  const onboarding = usarOnboarding();
  const raiz = useRef<HTMLDivElement>(null);
  const titulo = useId();
  const [ocupado, ocupar] = useState<'exemplo' | 'concluir' | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  usarFoco(raiz, aoFechar);
  useEffect(() => { raiz.current?.querySelector<HTMLElement>('.boas-vindas-rodape .ui-primario')?.focus({ preventScroll: true }); }, []);

  const concluir = async (): Promise<void> => {
    const { concluida_em } = await concluirPrimeiraExecucao();
    // Os primeiros passos deste navegador não repetem as boas-vindas que esta tela já deu.
    onboarding.despachar({ tipo: 'concluir_boas_vindas' });
    marcarConcluida(concluida_em);
  };
  const abrirExemplo = async () => {
    ocupar('exemplo'); definirErro(null);
    try {
      const { documento_id } = await abrirExemploDaInstalacao();
      onboarding.despachar({ tipo: 'registrar_documento', origem: 'exemplo', documento_id });
      await concluir();
      ir({ nome: 'leitura', documento_id });
    } catch {
      definirErro('Não foi possível abrir o exemplo agora. Tente de novo em instantes.');
    } finally { ocupar(null); }
  };
  const terminar = async () => {
    ocupar('concluir'); definirErro(null);
    try { await concluir(); } catch { definirErro('Não foi possível registrar agora. Tente de novo em instantes.'); ocupar(null); }
  };
  const prontoParaLer = estado.pronto;
  // No app de computador, a janela de abertura já conferiu a pasta e o login: aqui fica só a apresentação.
  // A checagem continua em Primeiros passos e no aviso do topo, quando algo falta (V-D5).
  const doDesktop = estado.origem === 'desktop';
  return <div className="ui-veu veu-boas-vindas">
    <div ref={raiz} role="dialog" aria-modal="true" aria-labelledby={titulo} tabIndex={-1} className="card boas-vindas boas-vindas-da-instalacao">
      <header className="boas-vindas-topo">
        <span className="eyebrow">Primeira execução</span>
        <Button variante="ghost" className="small pular" onClick={aoFechar}>Depois</Button>
      </header>
      <Assinatura lema className="boas-vindas-assinatura" />
      <h2 id={titulo} tabIndex={-1}>Boas-vindas ao Margem</h2>
      <p className="boas-vindas-lead">Um lugar para estudar o que você <strong>lê, assiste e observa</strong>: textos marcados pelo que cada trecho faz,
        vídeos com a transcrição ao lado e quadros com uma leitura guiada. Tudo fica neste computador; as marcas são feitas pelo Codex, com a sua conta do ChatGPT.</p>

      {doDesktop ? <section className="secao-da-instalacao" aria-labelledby={`${titulo}-jeitos`}>
        <h3 id={`${titulo}-jeitos`}>Três jeitos de estudar</h3>
        <TresJeitos />
      </section> : <section className="secao-da-instalacao" aria-labelledby={`${titulo}-codex`}>
        <h3 id={`${titulo}-codex`}>{prontoParaLer ? 'Tudo pronto para ler' : 'Antes de pedir a primeira leitura'}</h3>
        <ChecagemDaInstalacao estado={estado} />
      </section>}

      <section className="secao-da-instalacao" aria-labelledby={`${titulo}-exemplo`}>
        <h3 id={`${titulo}-exemplo`}>Um texto para começar</h3>
        <ul className="portas-do-documento"><li>
          <Button variante="ghost" className="porta" disabled={ocupado !== null} onClick={() => void abrirExemplo()}>
            <Icon name="livro" size={22} /><span className="porta-texto"><span className="porta-titulo">{ocupado === 'exemplo' ? 'Abrindo o exemplo…' : 'Abrir o exemplo já marcado'}</span>
              <span className="porta-detalhe">“Um apólogo”, de Machado de Assis · conto curto, domínio público · as marcas já vêm prontas, sem usar o Codex</span></span>
            <Icon name="arrow" size={18} /></Button>
        </li></ul>
      </section>

      {erro && <p className="aviso" role="alert">{erro}</p>}
      <footer className="boas-vindas-rodape">
        <span className="rodape-nota">{prontoParaLer || doDesktop ? 'Traga PDFs, EPUBs, textos, vídeos e quadros pela tela Adicionar.' : 'Dá para concluir agora e conectar o Codex depois: um aviso lembra no topo.'}</span>
        <div className="button-row">
          <Button variante="primario" disabled={ocupado !== null} onClick={() => void terminar()}>{ocupado === 'concluir' ? 'Concluindo…' : 'Concluir'}</Button>
        </div>
      </footer>
    </div>
  </div>;
}

/** A faixa da casca: só quando algo impede a leitura e a primeira execução já terminou. */
export function AvisoDaInstalacao({ ir }: { ir: (destino: Rota) => void }): ReactNode {
  const { estado, ativo, avisoDispensado, dispensarAviso } = usarInstalacao();
  if (!ativo || estado === null || !estado.primeira_execucao.concluida) return null;
  const aviso = avisoDaInstalacao(estado);
  if (aviso === null || avisoDispensado === aviso.tipo) return null;
  return <section className="aviso aviso-da-instalacao" role="status" aria-label="Aviso da instalação" data-tipo={aviso.tipo}>
    <Icon name={aviso.tipo === 'cota' ? 'clock' : 'alerta'} size={18} />
    <div className="aviso-corpo">
      <p className="aviso-titulo">{aviso.titulo}</p>
      <InstrucoesDoAviso aviso={aviso} />
      {aviso.tipo !== 'cota' && aviso.tipo !== 'app' && <p className="aviso-link"><a href="/configuracoes/primeiros-passos#instalacao" onClick={(e) => { e.preventDefault(); ir({ nome: 'configuracoes', secao: 'primeiros-passos' }); }}>Ver a checagem completa</a></p>}
    </div>
    <IconButton aria-label="Dispensar o aviso" title="Dispensar" onClick={() => dispensarAviso(aviso.tipo)}><Icon name="xis" size={16} /></IconButton>
  </section>;
}

/**
 * Onde se pede uma leitura: diz antes do clique o que vai acontecer com ela. Com a faixa da casca à
 * vista, uma frase só (os comandos já estão lá em cima); com a faixa dispensada, as instruções inteiras.
 */
export function AvisoDoCodexCurto(): ReactNode {
  const { estado, ativo, avisoDispensado } = usarInstalacao();
  if (!ativo || estado === null) return null;
  const aviso = avisoDaInstalacao(estado);
  if (aviso === null || aviso.tipo === 'banco' || aviso.tipo === 'motor' || aviso.tipo === 'app') return null;
  const faixaVisivel = estado.primeira_execucao.concluida && avisoDispensado !== aviso.tipo;
  if (aviso.tipo === 'cota') {
    return <p className="aviso aviso-do-codex-curto" role="status" data-tipo="cota">
      {aviso.titulo} Se pedir agora, a leitura espera na fila e começa sozinha quando a cota voltar.</p>;
  }
  if (faixaVisivel) {
    return <p className="aviso aviso-do-codex-curto" role="status" data-tipo={aviso.tipo}>
      {aviso.titulo} Sem isso, a leitura pedida fica parada; o aviso no topo mostra o que fazer.</p>;
  }
  return <div className="aviso aviso-do-codex-curto" role="status" data-tipo={aviso.tipo}>
    <p className="aviso-titulo">{aviso.titulo}</p>
    <InstrucoesDoAviso aviso={aviso} />
  </div>;
}
