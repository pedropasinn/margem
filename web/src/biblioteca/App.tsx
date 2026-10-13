import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Drawer, IconButton } from '../ui/Primitives';
import { Adicionar } from './Adicionar';
import { Detalhe } from './Detalhe';
import { Ler } from './Ler';
import { Lista, campoEmEdicao, preferencia, guardarPreferencia } from './Lista';
import { AtalhosDaBiblioteca } from './AtalhosDaBiblioteca';
import { Inicio } from './Inicio';
import { Notas } from './Notas';
import { Exercicios } from './Exercicios';
import { Flashcards } from '../flashcards/Flashcards';
import { atalhoDeUmaTeclaDesligado } from '../leitor/teclado/comandos';
import { caminhoDaRota, rotaDoCaminho, usarRota, type Rota } from './rotas';
import { BoasVindas } from '../onboarding/BoasVindas';
import { Ajuda, PrimeirosPassos } from '../onboarding/PrimeirosPassos';
import { usarOnboarding } from '../onboarding/ContextoDoOnboarding';
import { mostrarBoasVindas } from '../onboarding/estado';
import { AvisosDoCodex } from '../avisos/AvisosDoCodex';
import { usarInstalacao } from '../primeira-execucao/ContextoDaInstalacao';
import { AvisoDaInstalacao, BoasVindasDaInstalacao } from '../primeira-execucao/PrimeiraExecucao';
import { mostrarPrimeiraExecucao } from '../primeira-execucao/estado';
import { EditorDaSala, SalasDeTeste } from '../sala/SalasDeTeste';
import { RespostasDaSala } from '../sala/RespostasDaSala';
import { LeitorDeQuadro } from '../quadros/LeitorDeQuadro';
import { Perguntar } from '../perguntar/Perguntar';
import { Noticias } from '../noticias/Noticias';
import { usarRecursos, type Recurso } from '../recursos';

/** Recurso pessoal de que a rota depende (J102); `null` para as rotas de sempre. */
export function recursoDaRota(rota: Rota): Recurso | null {
  if (rota.nome === 'noticias') return 'noticias';
  if (rota.nome === 'salas' || rota.nome === 'nova-sala' || rota.nome === 'sala') return 'sala';
  if (rota.nome === 'quadro' || (rota.nome === 'biblioteca' && rota.tipo === 'quadros')) return 'arte';
  return null;
}
import { Configuracoes } from '../audio/Configuracoes';

export function App(): ReactNode {
  const { rota, ir } = usarRota();
  const onboarding = usarOnboarding();
  const recursos = usarRecursos();
  const com = (recurso: Recurso) => recursos.ativos.has(recurso);
  const exigido = recursoDaRota(rota);
  // Rota de recurso desligado: some (enquanto a configuração carrega) e depois volta ao Início ou à Biblioteca.
  const bloqueada = exigido !== null && !com(exigido);
  useEffect(() => {
    if (bloqueada && recursos.carregado) ir(rota.nome === 'biblioteca' ? { nome: 'biblioteca' } : { nome: 'inicio' }, true);
  }, [bloqueada, recursos.carregado, rota.nome, ir]);
  const instalacao = usarInstalacao();
  // "Depois" esconde a primeira execução só nesta aba; concluir grava no serviço.
  const [instalacaoAdiada, adiarInstalacao] = useState(false);
  const [largura, definirLargura] = useState(window.innerWidth);
  const [aberta, abrir] = useState(() => window.innerWidth >= 1000 && preferencia('margem:barra-lateral', true));
  const [arquivosSoltos, definirArquivosSoltos] = useState<File[]>([]);
  const [filhos, expandir] = useState(true);
  const lendo = rota.nome === 'leitura' || rota.nome === 'quadro';
  useEffect(() => { if (!lendo) document.title = 'Margem'; }, [lendo]);
  const alternar = () => abrir((valor) => { guardarPreferencia('margem:barra-lateral', !valor); return !valor; });
  useEffect(() => {
    const redimensionar = () => { definirLargura(window.innerWidth); if (window.innerWidth < 1000) abrir(false); };
    window.addEventListener('resize', redimensionar);
    return () => window.removeEventListener('resize', redimensionar);
  }, []);
  useEffect(() => {
    const teclado = (e: KeyboardEvent) => { if (!lendo && e.key === '[' && !atalhoDeUmaTeclaDesligado(e) && !campoEmEdicao(e.target) && !document.querySelector('[aria-modal=true]') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); alternar(); } };
    window.addEventListener('keydown', teclado);
    return () => window.removeEventListener('keydown', teclado);
  }, [lendo]);
  useEffect(() => {
    if (rota.nome !== 'adicionar') definirArquivosSoltos([]);
    if (rota.nome !== 'biblioteca' && rota.nome !== 'inicio' && rota.nome !== 'adicionar') return;
    const arrastar = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const soltar = (e: DragEvent) => {
      const arquivos = Array.from(e.dataTransfer?.files ?? []);
      if (!arquivos.length || e.defaultPrevented) return;
      e.preventDefault();
      // Em Adicionar, soltar fora da área só impede o navegador de abrir o arquivo (e perder o envio).
      if (rota.nome !== 'adicionar') { definirArquivosSoltos(arquivos); ir({ nome: 'adicionar' }); }
    };
    window.addEventListener('dragover', arrastar); window.addEventListener('drop', soltar);
    return () => { window.removeEventListener('dragover', arrastar); window.removeEventListener('drop', soltar); };
  }, [rota.nome, ir]);
  // A primeira execução da instalação (J103) vem antes das boas-vindas do onboarding e as substitui.
  const instalacaoPendente = instalacao.estado !== null && !instalacao.estado.primeira_execucao.concluida;
  const primeiraExecucao = instalacao.ativo && mostrarPrimeiraExecucao(instalacao.estado, instalacaoAdiada, lendo) ? instalacao.estado : null;
  const navegar = (destino: Rota) => { ir(destino); if (largura < 1000) abrir(false); };
  const link = (destino: Rota, rotulo: string, icone: string, classe = '') => {
    const atual = !(destino.nome === 'biblioteca' && destino.buscar) && (rota.nome === destino.nome || (destino.nome === 'salas' && (rota.nome === 'sala' || rota.nome === 'nova-sala'))) && (destino.nome !== 'biblioteca' || (rota.nome === 'biblioteca' && rota.tipo === destino.tipo));
    return <a href={caminhoDaRota(destino)} className={`${classe} ${atual ? 'active' : ''}`} aria-current={atual ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navegar(destino); }}><Icon name={icone} size={18} /><span>{rotulo}</span></a>;
  };
  const barra = <><div className="barra-marca"><a className="brand" href="/" onClick={(e) => { e.preventDefault(); navegar({ nome: 'inicio' }); }}>Margem</a><IconButton aria-label="Recolher barra lateral" title="Recolher barra lateral ([)" onClick={alternar}><Icon name="painel" /></IconButton><IconButton aria-label="Adicionar" onClick={() => navegar({ nome: 'adicionar' })}><Icon name="adicionar" /></IconButton></div>
    <nav aria-label="Seções" className="navegacao-lateral">{link({ nome: 'inicio' }, 'Início', 'casa')}
      {com('noticias') && link({ nome: 'noticias' }, 'Notícias', 'texto')}
      <div className="grupo-biblioteca">{link({ nome: 'biblioteca' }, 'Biblioteca', 'library')}<IconButton aria-label="Categorias da biblioteca" aria-expanded={filhos} onClick={() => expandir(!filhos)}><span className={filhos ? 'chevron-aberto' : ''}><Icon name="chevron" size={14} /></span></IconButton></div>
      {filhos && <div className="filhos-biblioteca">{link({ nome: 'biblioteca', tipo: 'livros' }, 'Livros', 'livro')}{link({ nome: 'biblioteca', tipo: 'textos' }, 'Textos', 'texto')}{link({ nome: 'biblioteca', tipo: 'pdfs' }, 'PDFs', 'pdf')}{link({ nome: 'biblioteca', tipo: 'videos' }, 'Vídeos', 'video-doc')}{com('arte') && link({ nome: 'biblioteca', tipo: 'quadros' }, 'Quadros', 'quadro')}</div>}
      {link({ nome: 'notas' }, 'Notas', 'caderno')}
      {link({ nome: 'flashcards' }, 'Flashcards', 'cartoes')}
      {link({ nome: 'perguntar' }, 'Perguntar', 'conversas')}
      <div className="barra-inferior">{onboarding.ativo && link({ nome: 'primeiros-passos' }, 'Primeiros passos', 'pergunta')}{link({ nome: 'biblioteca', buscar: true }, 'Buscar', 'buscar')}{com('sala') && link({ nome: 'salas' }, 'Salas de teste', 'bandeira', 'link-discreto')}{link({ nome: 'configuracoes' }, 'Configurações', 'engrenagem', 'link-discreto')}</div>
    </nav></>;
  return <div className={`app-shell ${lendo ? 'lendo' : `${aberta && largura >= 1000 ? 'com-barra' : ''} ${rota.nome === 'inicio' || rota.nome === 'biblioteca' || rota.nome === 'noticias' ? 'pagina-ampla' : ''}`}`}>
    {!lendo && <><header className="topbar"><div className="topbar-inner"><a className="brand" href="/" onClick={(e) => { e.preventDefault(); navegar({ nome: 'inicio' }); }}>Margem</a><span className="topbar-acoes">{onboarding.ativo && <IconButton aria-label="Primeiros passos" onClick={() => navegar({ nome: 'primeiros-passos' })}><Icon name="pergunta" /></IconButton>}<IconButton aria-label="Buscar textos na biblioteca" onClick={() => navegar({ nome: 'biblioteca', buscar: true })}><Icon name="buscar" /></IconButton></span></div></header>
      {largura >= 1000 && aberta && <aside className="barra-lateral">{barra}</aside>}
      {largura >= 800 && largura < 1000 && aberta && <Drawer lado="esquerda" aoFechar={() => abrir(false)} rotulo="Navegação"><div className="barra-gaveta">{barra}</div></Drawer>}
      {(!aberta || largura < 1000) && <IconButton style={aberta ? { visibility: 'hidden' } : undefined} className="abrir-barra" aria-label="Abrir barra lateral" title="Abrir barra lateral ([)" onClick={alternar}><Icon name="painel" /></IconButton>}</>}
    {(rota.nome === 'inicio' || rota.nome === 'biblioteca') && <AtalhosDaBiblioteca />}
    <main id="conteudo" tabIndex={-1}>{!lendo && rota.nome !== 'primeiros-passos' && <AvisoDaInstalacao ir={navegar} />}{bloqueada ? null : conteudo(rota, ir, arquivosSoltos)}</main>
    {primeiraExecucao && <BoasVindasDaInstalacao estado={primeiraExecucao} ir={navegar} aoFechar={() => adiarInstalacao(true)} />}
    {onboarding.ativo && onboarding.pronto && instalacao.pronto && primeiraExecucao === null && !instalacaoPendente && mostrarBoasVindas(onboarding.estado, lendo) && <BoasVindas ir={navegar} />}
    {!lendo && <nav className="bottomnav" aria-label="Seções">{link({ nome: 'inicio' }, 'Início', 'casa', 'bottomnav-item')}{com('noticias') && link({ nome: 'noticias' }, 'Notícias', 'texto', 'bottomnav-item')}{link({ nome: 'biblioteca' }, 'Biblioteca', 'library', 'bottomnav-item')}{link({ nome: 'notas' }, 'Notas', 'caderno', 'bottomnav-item')}{link({ nome: 'flashcards' }, 'Flashcards', 'cartoes', 'bottomnav-item')}{link({ nome: 'perguntar' }, 'Perguntar', 'conversas', 'bottomnav-item')}{link({ nome: 'adicionar' }, 'Adicionar', 'upload', 'bottomnav-item')}</nav>}
    <AvisosDoCodex ir={(caminho) => ir(rotaDoCaminho(caminho))} />
  </div>;
}
function conteudo(rota: Rota, ir: (destino: Rota, substituir?: boolean) => void, arquivosSoltos: File[]): ReactNode {
  switch (rota.nome) {
    case 'noticias': return <Noticias ir={ir} {...(rota.edicao_id ? { edicaoId: rota.edicao_id } : {})} />;
    case 'adicionar': return <Adicionar key={rota.entrada ?? 'arquivo'} ir={ir} entradaInicial={rota.entrada ?? 'arquivo'} arquivosIniciais={arquivosSoltos} />;
    case 'primeiros-passos': return <PrimeirosPassos ir={ir} />;
    case 'configuracoes': return <Configuracoes />;
    case 'ajuda': return <Ajuda pagina={rota.pagina} ir={ir} />;
    case 'documento': return <Detalhe documento_id={rota.documento_id} ir={ir} />;
    case 'leitura': return <Ler documento_id={rota.documento_id} {...(rota.secao_id === undefined ? {} : { secao_id: rota.secao_id })} {...(rota.bloco === undefined ? {} : { bloco: rota.bloco })} ir={ir} />;
    case 'biblioteca': return <Lista ir={ir} rota={rota} />;
    case 'notas': return <Notas key={rota.documento_id ?? 'biblioteca'} ir={ir} {...(rota.documento_id === undefined ? {} : { documento_id: rota.documento_id })} />;
    case 'exercicios': return <Exercicios key={rota.documento_id} documento_id={rota.documento_id} ir={ir} />;
    case 'flashcards': return <Flashcards key={`${rota.documento_id ?? 'biblioteca'}`} ir={ir} aba={rota.aba === 'todos' ? 'todos' : 'estudar'} {...(rota.documento_id === undefined ? {} : { documento_id: rota.documento_id })} />;
    case 'salas': return <SalasDeTeste ir={ir} />;
    case 'nova-sala': return <EditorDaSala key="nova" ir={ir} />;
    case 'sala': return rota.aba === 'editar' ? <EditorDaSala key={rota.sala_id} sala_id={rota.sala_id} ir={ir} /> : <RespostasDaSala key={rota.sala_id} sala_id={rota.sala_id} ir={ir} />;
    case 'quadro': return <LeitorDeQuadro key={rota.slug} slug={rota.slug} ir={ir} />;
    case 'perguntar': return <Perguntar {...(rota.conversa_id === undefined ? {} : { conversa_id: rota.conversa_id })} ir={ir} />;
    default: return <Inicio ir={ir} />;
  }
}
