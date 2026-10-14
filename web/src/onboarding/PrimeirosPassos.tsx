import type { ReactNode } from 'react';
import { BarraDeProgresso, Icon } from '../ui/Icon';
import { Button } from '../ui/Primitives';
import type { PaginaDeAjuda, Rota } from '../biblioteca/rotas';
import { usarOnboarding } from './ContextoDoOnboarding';
import { concluidas, etapas, type EstadoDaEtapa, type NomeDaEtapa, type TipoDeTour } from './estado';
import { usarRecurso } from '../recursos';
import { LevarConsigo } from './LevarConsigo';
import { PrimeiroDocumento } from './PrimeiroDocumento';
import { usarInstalacao } from '../primeira-execucao/ContextoDaInstalacao';
import { ChecagemDaInstalacao } from '../primeira-execucao/PrimeiraExecucao';
import './onboarding.css';

const NOMES: Record<NomeDaEtapa, { titulo: string; icone: string; quando?: string }> = {
  boas_vindas: { titulo: 'Boas-vindas', icone: 'lampada' },
  primeiro_documento: { titulo: 'Seu primeiro item', icone: 'livro' },
  tour_texto: { titulo: 'Dicas da leitura', icone: 'explicar', quando: 'na primeira abertura de um texto ou PDF' },
  tour_video: { titulo: 'Dicas do vídeo', icone: 'video-doc', quando: 'na primeira abertura de um vídeo ou áudio' },
  tour_quadro: { titulo: 'Dicas do quadro', icone: 'quadro', quando: 'na primeira abertura de um quadro' },
  levar: { titulo: 'Leve o Margem com você', icone: 'celular' },
};
const TOUR_DA_ETAPA: Partial<Record<NomeDaEtapa, TipoDeTour>> = { tour_texto: 'texto', tour_video: 'video', tour_quadro: 'quadro' };

const ROTULO_DO_ESTADO: Record<EstadoDaEtapa, string> = { pendente: 'A fazer', concluida: 'Feito', pulada: 'Pulado' };

/** Os "Primeiros passos" (seção das Configurações): o progresso, cada etapa reabrível e o "leve com você". */
export function PrimeirosPassos({ ir }: { ir: (destino: Rota) => void }): ReactNode {
  const { estado, despachar } = usarOnboarding();
  const instalacao = usarInstalacao();
  const quadros = usarRecurso('arte');
  const lista = etapas(estado, { quadros });
  const feitas = concluidas(estado, { quadros });
  const documento = estado.primeiro_documento.documento_id ?? estado.exemplo_id;
  const acao = (nome: NomeDaEtapa): ReactNode => {
    const tour = TOUR_DA_ETAPA[nome];
    if (nome === 'boas_vindas') return <Button className="small" onClick={() => despachar({ tipo: 'rever_boas_vindas' })}>{estado.boas_vindas === 'pendente' ? 'Começar' : 'Rever'}</Button>;
    if (tour === 'texto') {
      return <Button className="small" onClick={() => {
        despachar({ tipo: 'rever_tour', tour });
        if (documento) ir({ nome: 'leitura', documento_id: documento });
      }}>{estado.tours.texto === 'pendente' ? (documento ? 'Abrir um texto' : 'No próximo texto') : 'Rever'}</Button>;
    }
    // Vídeo e quadro: "Rever" deixa as dicas prontas para a próxima abertura de um item do tipo.
    if (tour) return estado.tours[tour] === 'pendente' ? null : <Button className="small" onClick={() => despachar({ tipo: 'rever_tour', tour })}>Rever</Button>;
    return null;
  };
  return <div className="primeiros-passos">
    <header className="primeiros-passos-cabeca">
      <h2 className="titulo-primeiros-passos">Primeiros passos</h2>
      <p className="secundario">{feitas} de {lista.length} feitos</p>
      <BarraDeProgresso valor={100 * feitas / lista.length} rotulo="Primeiros passos feitos" />
    </header>
    <section className="card etapas-do-onboarding" aria-label="Etapas">
      <ol className="session-list">{lista.map((etapa, indice) => <li key={etapa.nome} data-etapa={etapa.nome} data-estado={etapa.estado}>
        <span className={`session-dot${etapa.estado === 'concluida' ? ' done' : ''}`} aria-hidden="true">{etapa.estado === 'concluida' ? <Icon name="check" size={16} /> : indice + 1}</span>
        <div><span className="titulo">{NOMES[etapa.nome].titulo}</span><div className="linha-meta"><span>{ROTULO_DO_ESTADO[etapa.estado]}</span>
          {etapa.nome === 'primeiro_documento' && estado.primeiro_documento.origem === 'exemplo' && <span>o exemplo de Machado de Assis</span>}
          {etapa.nome === 'primeiro_documento' && estado.primeiro_documento.origem === 'uso_anterior' && <span>sua biblioteca já tinha textos</span>}
          {NOMES[etapa.nome].quando && <span>{NOMES[etapa.nome].quando}</span>}</div></div>
        {acao(etapa.nome)}
      </li>)}</ol>
    </section>
    {instalacao.estado && <section className="secao-primeiros-passos" id="instalacao" aria-labelledby="titulo-instalacao">
      <h2 id="titulo-instalacao">Esta instalação</h2>
      <div className="card"><ChecagemDaInstalacao estado={instalacao.estado} /></div>
    </section>}
    <section className="secao-primeiros-passos" aria-labelledby="titulo-primeiro-texto">
      <h2 id="titulo-primeiro-texto">{estado.primeiro_documento.estado === 'concluida' ? 'Mais exemplos' : 'Comece por um exemplo'}</h2>
      <PrimeiroDocumento ir={ir} />
    </section>
    <section className="secao-primeiros-passos" id="levar" aria-labelledby="titulo-levar">
      <h2 id="titulo-levar">Leve o Margem com você</h2>
      <LevarConsigo ir={ir} />
    </section>
    <p className="recomecar"><Button variante="ghost" className="small" onClick={() => despachar({ tipo: 'recomecar' })}><Icon name="restaurar" size={16} /> Recomeçar os primeiros passos</Button></p>
  </div>;
}

const AJUDA: Record<PaginaDeAjuda, { titulo: string; corpo: ReactNode }> = {
  instalar: {
    titulo: 'Instalar o Margem como app',
    corpo: <>
      <p>O Margem funciona no navegador e pode ser instalado como app: abre numa janela própria e fica junto dos outros apps. Os textos continuam no seu servidor; instalar não copia a biblioteca para o aparelho.</p>
      <h2>iPhone e iPad (Safari)</h2>
      <ol><li>Abra o Margem no Safari.</li><li>Toque em <strong>Compartilhar</strong> <Icon name="compartilhar-ios" size={16} />.</li><li>Escolha <strong>Adicionar à Tela de Início</strong> e confirme.</li></ol>
      <h2>Android (Chrome)</h2>
      <ol><li>Abra o menu ⋮.</li><li>Toque em <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).</li></ol>
      <h2>Computador (Chrome ou Edge)</h2>
      <ol><li>Clique no ícone de instalar <Icon name="baixar" size={16} /> na barra de endereço, ou no menu ⋮ → <strong>Instalar Margem</strong>.</li></ol>
      <h2>Mac (Safari)</h2>
      <ol><li>Menu <strong>Arquivo → Adicionar ao Dock</strong>.</li></ol>
      <p className="secundario">O Firefox para computador ainda não instala apps da web; use o Margem numa aba fixada.</p>
    </>,
  },
  extensao: {
    titulo: 'Extensão de navegador',
    corpo: <>
      <p>A extensão manda para o Margem o artigo aberto no navegador, com um clique: o texto entra na biblioteca com título, autor e o endereço de origem. Se a aba for um PDF, vai o PDF.</p>
      <h2>Como usar</h2>
      <ul>
        <li>Clique no ícone do Margem na barra do navegador e escolha <strong>Enviar</strong> ou <strong>Enviar e abrir</strong>.</li>
        <li>Ou use o atalho <strong>Alt+Shift+M</strong>.</li>
        <li>Com o botão direito: <strong>Enviar página</strong> ou, com um trecho selecionado, <strong>Enviar seleção</strong> (o caminho mais seguro para e-mails abertos no navegador).</li>
      </ul>
      <h2>Instalar (beta)</h2>
      <p>A extensão ainda não está na loja; quem organiza o beta manda o arquivo.</p>
      <ol>
        <li><strong>Chrome, Edge ou Brave:</strong> abra <code>chrome://extensions</code>, ligue o <strong>Modo do desenvolvedor</strong>, clique em <strong>Carregar sem compactação</strong> e escolha a pasta da extensão.</li>
        <li><strong>Firefox:</strong> abra <code>about:debugging</code>, <strong>Este Firefox</strong> → <strong>Carregar extensão temporária</strong> e escolha o <code>manifest.json</code>.</li>
        <li>Nas opções da extensão, confira o endereço do Margem e clique em <strong>Testar conexão</strong>.</li>
      </ol>
    </>,
  },
  obsidian: {
    titulo: 'Integração com o Obsidian',
    corpo: <>
      <p>Leva seus grifos, notas, perguntas e relações para o cofre do Obsidian: uma pasta por documento, com a nota do documento e uma nota para cada item, cada uma com o trecho inteiro e um link de volta para o lugar exato no Margem. As relações levam os dois trechos e o link para as duas pontas.</p>
      <h2>Um documento de cada vez</h2>
      <p>Na página do documento, abra <strong>•••</strong> → <strong>Exportar para o Obsidian</strong>. No navegador, <strong>Baixar a pasta (.zip)</strong> traz a pasta do documento para você descompactar no cofre. No app de computador, <strong>Exportar para o cofre…</strong> grava direto na pasta que você escolher, sem apagar o que você escreveu nas notas (também em <strong>Arquivo → Exportar para o Obsidian…</strong>).</p>
      <h2>Tudo, sempre atualizado (plugin)</h2>
      <p>O plugin do Margem para o Obsidian sincroniza a biblioteca inteira com o comando <strong>Margem: Sincronizar</strong>. Ele só troca o trecho entre <code>%% margem:inicio %%</code> e <code>%% margem:fim %%</code>: o que você escrever antes ou depois desse bloco continua lá. A sincronização vai do Margem para o Obsidian; o que você escreve no Obsidian não volta para o Margem.</p>
      <p className="secundario">O plugin ainda não está na loja da comunidade; quem organiza o beta manda o arquivo.</p>
    </>,
  },
};

/** Páginas de ajuda internas e simples (instalar, extensão, Obsidian). */
export function Ajuda({ pagina, ir }: { pagina: PaginaDeAjuda; ir: (destino: Rota) => void }): ReactNode {
  const conteudo = AJUDA[pagina];
  return <article className="ajuda">
    <a className="voltar" href="/configuracoes/primeiros-passos" onClick={(e) => { e.preventDefault(); ir({ nome: 'configuracoes', secao: 'primeiros-passos' }); }}><Icon name="back" size={16} /> Primeiros passos</a>
    <h1 className="page-title">{conteudo.titulo}</h1>
    <div className="card ajuda-corpo">{conteudo.corpo}</div>
  </article>;
}
