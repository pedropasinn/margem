import { useEffect, useState, type ReactNode } from 'react';
import {
  AVISO_DA_PRIMEIRA_VEZ, CONFIG, REQUISITOS, SISTEMAS, downloadEmPreparacao, emBreve, instaladoresDe, urlDoArquivo,
  type Arquitetura, type Instalador, type Sistema,
} from '../config';
import { Icone } from './Icone';

export interface Deteccao {
  /** Sistema de quem visita; nulo no celular ou quando não dá para saber. */
  sistema: Sistema | null;
  /** Processador, só quando dá para saber (no macOS decide entre os dois .dmg). */
  arquitetura: Arquitetura | null;
}

type DadosDoAgente = {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (dicas: string[]) => Promise<{ architecture?: string }>;
};

const dadosDoAgente = (): DadosDoAgente | undefined =>
  (navigator as Navigator & { userAgentData?: DadosDoAgente }).userAgentData;

/** Sistema de quem visita, pelo navegador. Celular e desconhecido dão nulo. */
export function detectarSistema(): Sistema | null {
  if (typeof navigator === 'undefined') return null;
  const dados = dadosDoAgente();
  const texto = `${dados?.platform ?? ''} ${navigator.userAgent}`.toLowerCase();
  if (dados?.mobile === true || /android|iphone|ipad|mobile/.test(texto)) return null;
  if (texto.includes('win')) return 'windows';
  if (texto.includes('mac')) return 'macos';
  if (texto.includes('linux') || texto.includes('x11') || texto.includes('cros')) return 'linux';
  return null;
}

/** Processador do Mac pela placa de vídeo que o WebGL informa ("Apple M1…" ou "Intel…"). */
function arquiteturaPeloWebgl(): Arquitetura | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const extensao = gl?.getExtension('WEBGL_debug_renderer_info');
    if (!gl || !extensao) return null;
    const placa = String(gl.getParameter(extensao.UNMASKED_RENDERER_WEBGL)).toLowerCase();
    if (/apple m\d/.test(placa)) return 'arm64';
    if (/intel|amd|radeon|nvidia/.test(placa)) return 'x64';
  } catch { /* sem WebGL: fica indefinido */ }
  return null;
}

/** Sistema na hora; no macOS, o processador logo depois (Chrome e Edge dizem; o Safari não). */
export function useDeteccao(): Deteccao {
  const [deteccao, definir] = useState<Deteccao>(() => ({ sistema: detectarSistema(), arquitetura: null }));
  useEffect(() => {
    if (deteccao.sistema !== 'macos') return;
    let vivo = true;
    const concluir = (arquitetura: Arquitetura | null): void => { if (vivo) definir({ sistema: 'macos', arquitetura }); };
    const dados = dadosDoAgente();
    if (dados?.getHighEntropyValues) {
      dados.getHighEntropyValues(['architecture'])
        .then((r) => concluir(r.architecture === 'arm' ? 'arm64' : r.architecture === 'x86' ? 'x64' : arquiteturaPeloWebgl()))
        .catch(() => concluir(arquiteturaPeloWebgl()));
    } else concluir(arquiteturaPeloWebgl());
    return () => { vivo = false; };
  }, [deteccao.sistema]);
  return deteccao;
}

/** Instaladores a oferecer em destaque: um só, ou os dois do macOS quando o processador é desconhecido. */
export function instaladoresEmDestaque({ sistema, arquitetura }: Deteccao): Instalador[] {
  if (!sistema || emBreve(sistema)) return [];
  const todos = instaladoresDe(sistema);
  if (sistema !== 'macos') return todos.slice(0, 1);
  const certo = todos.find((i) => i.arquitetura === arquitetura);
  return certo ? [certo] : todos;
}

/** Para onde aponta o botão de um instalador: o arquivo, ou a página de download enquanto não há release. */
const destinoDe = (instalador: Instalador): string =>
  downloadEmPreparacao ? `/download/#${instalador.sistema}` : urlDoArquivo(instalador.arquivo);

/** Botão principal de download: já diz o sistema detectado, com "Outras plataformas" ao lado. */
export function BotaoDeDownload({ nome }: { nome: string }): ReactNode {
  const deteccao = useDeteccao();
  const destaque = instaladoresEmDestaque(deteccao);
  return (
    <div className="baixar-botoes">
      {destaque.length === 0 && <a className="botao primario grande" href="/download/">Baixar o {nome}</a>}
      {deteccao.sistema && emBreve(deteccao.sistema) && <span className="link-discreto">{SISTEMAS[deteccao.sistema]}: em breve</span>}
      {destaque.map((instalador, i) => (
        <a key={instalador.id} className={i === 0 ? 'botao primario grande' : 'botao grande'} href={destinoDe(instalador)}>
          {instalador.sistema === 'macos' && destaque.length > 1
            ? `macOS · ${instalador.rotulo}`
            : `Baixar para ${SISTEMAS[instalador.sistema]}`}
        </a>
      ))}
      <a className="link-discreto" href="/download/">Outras plataformas</a>
    </div>
  );
}

/** Um instalador: botão do arquivo e, embaixo, formato, tamanho e para quem é. */
function LinhaDeInstalador({ instalador, principal, detalhado }: { instalador: Instalador; principal: boolean; detalhado: boolean }): ReactNode {
  const classe = principal ? 'botao primario' : 'botao';
  const conteudo = <>{instalador.rotulo}<span className="instalador-formato">{instalador.formato}</span></>;
  return (
    <li className="instalador">
      {downloadEmPreparacao
        ? <span className={classe} aria-disabled="true">{conteudo}</span>
        : <a className={classe} href={urlDoArquivo(instalador.arquivo)} download>{conteudo}</a>}
      <p className="instalador-info">
        <span>{instalador.tamanho}</span>
        {detalhado && instalador.detalhe && <span>{instalador.detalhe}</span>}
      </p>
    </li>
  );
}

/** Cartão de um sistema com todos os seus instaladores. */
function CartaoDePlataforma({ sistema, deteccao, detalhado }: { sistema: Sistema; deteccao: Deteccao; detalhado: boolean }): ReactNode {
  const seu = deteccao.sistema === sistema;
  if (emBreve(sistema)) {
    return (
      <li id={sistema} className="cartao plataforma" data-detectado={seu}>
        <div className="plataforma-topo">
          <h3>{SISTEMAS[sistema]}</h3>
          <span className="selo">Em breve</span>
        </div>
        <p>A versão para {SISTEMAS[sistema]} está em preparação. Por enquanto, o {CONFIG.nome} é para Windows e Linux.</p>
      </li>
    );
  }
  const destaque = seu ? instaladoresEmDestaque(deteccao) : [];
  const instaladores = instaladoresDe(sistema);
  const principal = (i: Instalador): boolean => (destaque.length === 1 ? destaque[0] === i : i === instaladores[0]);
  return (
    <li id={sistema} className="cartao plataforma" data-detectado={seu}>
      <div className="plataforma-topo">
        <h3>{SISTEMAS[sistema]}</h3>
        {seu && <span className="selo" data-disponivel="true">Seu sistema</span>}
      </div>
      <p>{REQUISITOS[sistema]}</p>
      {AVISO_DA_PRIMEIRA_VEZ[sistema] && <p className="plataforma-aviso">{AVISO_DA_PRIMEIRA_VEZ[sistema]}</p>}
      <ul className="instaladores" role="list">
        {instaladores.map((i) => <LinhaDeInstalador key={i.id} instalador={i} principal={principal(i)} detalhado={detalhado} />)}
      </ul>
      <a className="link-seta" href={`/docs/instalacao/#${sistema}`}>Como instalar<Icone nome="seta" tamanho={16} /></a>
    </li>
  );
}

const ORDEM: readonly Sistema[] = ['windows', 'macos', 'linux'];

/** Os três sistemas lado a lado (o que ainda não tem versão, com "Em breve"), com o detectado primeiro no celular e destacado em todos. */
export function Plataformas({ detalhado = false }: { detalhado?: boolean }): ReactNode {
  const deteccao = useDeteccao();
  return (
    <>
      {downloadEmPreparacao && (
        <p className="aviso-provisorio" role="note">
          <strong>Download em preparação.</strong> O primeiro release ainda não foi publicado; os botões passam a funcionar quando ele sair.
        </p>
      )}
      <ul className="plataformas" role="list">
        {ORDEM.map((s) => <CartaoDePlataforma key={s} sistema={s} deteccao={deteccao} detalhado={detalhado} />)}
      </ul>
    </>
  );
}

/** Linha final do download: o que é preciso, além do sistema. */
export function RequisitosGerais(): ReactNode {
  return (
    <p className="baixar-requisitos">
      Você vai precisar de uma conta do ChatGPT num plano que inclua o Codex e de espaço para os seus livros. Versão {CONFIG.versao}, de {CONFIG.dataDaVersao}.
      {' '}<a href={CONFIG.urlDoRelease}>Página do release</a> · <a href="/novidades/">O que há de novo</a>
    </p>
  );
}
