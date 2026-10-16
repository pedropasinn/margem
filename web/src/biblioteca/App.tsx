import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Assinatura } from '../ui/Assinatura';
import { Drawer, IconButton } from '../ui/Primitives';
import { Adicionar } from './Adicionar';
import { abaDosArquivos, abaPreferida, imagensColadas } from './importacao';
import { EVENTO_ARQUIVOS_ABERTOS, usarArquivosAbertos } from './abrir-com';
import { Detalhe } from './Detalhe';
import { Ler } from './Ler';
import { Lista, campoEmEdicao, preferencia, guardarPreferencia } from './Lista';
import { AtalhosDaBiblioteca } from './AtalhosDaBiblioteca';
import { Inicio } from './Inicio';
import { NotasComApagar } from '../apagar/NasNotas';
import { Exercicios } from './Exercicios';
import { Flashcards } from '../flashcards/Flashcards';
import { atalhoDeUmaTeclaDesligado } from '../leitor/teclado/comandos';
import { caminhoDaRota, rotaDoCaminho, usarRota, type Rota } from './rotas';
import { BoasVindas } from '../onboarding/BoasVindas';
import { Ajuda } from '../onboarding/PrimeirosPassos';
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
import { ConversasNaBarra, ProvedorDasConversas } from '../perguntar/conversas';
import { Noticias } from '../noticias/Noticias';
import { usarRecursos, type Recurso } from '../recursos';
import { analisarDocumento, listarDocumentos, situacaoDaAnalise } from './api';
import { FONTES_DA_PREPARACAO, type FontesDaPreparacao } from './Operacoes';
import { listarQuadros } from '../quadros/api';
import { CATEGORIAS, contarPorCategoria, type ContagemPorCategoria } from './categorias';

/** Recurso pessoal de que a rota depende (J102); `null` para as rotas de sempre. */
export function recursoDaRota(rota: Rota): Recurso | null {
  if (rota.nome === 'noticias') return 'noticias';
  if (rota.nome === 'salas' || rota.nome === 'nova-sala' || rota.nome === 'sala') return 'sala';
  if (rota.nome === 'quadro' || (rota.nome === 'biblioteca' && rota.tipo === 'quadros')) return 'arte';
  return null;
}
import { Configuracoes } from '../audio/Configuracoes';

/**
 * Quantos itens há em cada categoria da barra lateral (V-D1). Recontado ao trocar de página (voltar de
 * Adicionar já mostra o que entrou) e só enquanto a barra está à vista.
 */
function usarContagens(gatilho: string, visivel: boolean, arte: boolean): ContagemPorCategoria | null {
  const [contagem, definir] = useState<ContagemPorCategoria | null>(null);
  useEffect(() => {
    if (!visivel) return;
    let vivo = true;
    void Promise.all([listarDocumentos(), arte ? listarQuadros().catch(() => null) : Promise.resolve(null)]).then(([lista, quadros]) => {
      if (!vivo || !Array.isArray(lista.documentos)) return;
      const obras = quadros && Array.isArray(quadros.obras) ? quadros.obras.length : 0;
      const preparando = quadros && Array.isArray(quadros.preparando) ? quadros.preparando.length : 0;
      definir(contarPorCategoria(lista.documentos, obras + preparando));
    }, () => {});
    return () => { vivo = false; };
  }, [gatilho, visivel, arte]);
  return contagem;
}

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
  const [conversasAbertas, expandirConversas] = useState(true);
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
  // `/adicionar` sem aba abre a última usada, com o endereço da aba.
  useEffect(() => { if (rota.nome === 'adicionar' && rota.aba === undefined) ir({ nome: 'adicionar', aba: abaPreferida() }, true); }, [rota, ir]);
  useEffect(() => {
    if (rota.nome !== 'adicionar') definirArquivosSoltos([]);
    if (rota.nome !== 'biblioteca' && rota.nome !== 'inicio' && rota.nome !== 'adicionar') return;
    const arrastar = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    // Em Adicionar, a própria página recebe o que cai fora das áreas; aqui, cada lote vai à aba do seu tipo.
    const soltar = (e: DragEvent) => {
      if (rota.nome === 'adicionar') return;
      const arquivos = Array.from(e.dataTransfer?.files ?? []);
      if (!arquivos.length || e.defaultPrevented) return;
      e.preventDefault();
      definirArquivosSoltos(arquivos); ir({ nome: 'adicionar', aba: abaDosArquivos(arquivos) });
    };
    // Ctrl/Cmd+V de uma imagem no Início ou na Biblioteca: ela espera na aba Quadro, sem envio (V-D2).
    const colar = (e: ClipboardEvent) => {
      if (rota.nome === 'adicionar' || !com('arte')) return;
      const imagens = imagensColadas(e.clipboardData);
      if (!imagens.length) return;
      e.preventDefault();
      definirArquivosSoltos(imagens.slice(0, 1)); ir({ nome: 'adicionar', aba: 'quadro' });
    };
    window.addEventListener('dragover', arrastar); window.addEventListener('drop', soltar); window.addEventListener('paste', colar);
    return () => { window.removeEventListener('dragover', arrastar); window.removeEventListener('drop', soltar); window.removeEventListener('paste', colar); };
  }, [rota.nome, ir, recursos.ativos]);
  // "Abrir com" o Margem (U-08): os arquivos vão para Adicionar, na fila, esperando a confirmação.
  usarArquivosAbertos((arquivos) => {
    if (rota.nome === 'adicionar') { window.dispatchEvent(new CustomEvent<File[]>(EVENTO_ARQUIVOS_ABERTOS, { detail: arquivos })); return; }
    definirArquivosSoltos(arquivos); ir({ nome: 'adicionar', aba: 'documento' });
  });
  // A primeira execução da instalação (J103) vem antes das boas-vindas do onboarding e as substitui.
  const instalacaoPendente = instalacao.estado !== null && !instalacao.estado.primeira_execucao.concluida;
  const primeiraExecucao = instalacao.ativo && mostrarPrimeiraExecucao(instalacao.estado, instalacaoAdiada, lendo) ? instalacao.estado : null;
  const [maisAberto, abrirMais] = useState(false);
  const noMais = rota.nome === 'notas' || rota.nome === 'flashcards' || rota.nome === 'noticias';
  const navegar = (destino: Rota) => { ir(destino); abrirMais(false); if (largura < 1000) abrir(false); };
  const contagens = usarContagens(rota.nome, !lendo && aberta && largura >= 800, com('arte'));
  const link = (destino: Rota, rotulo: string, icone: string, classe = '', contagem?: number, ativo?: boolean) => {
    const atual = ativo ?? (!(destino.nome === 'biblioteca' && destino.buscar) && (rota.nome === destino.nome || (destino.nome === 'salas' && (rota.nome === 'sala' || rota.nome === 'nova-sala'))) && (destino.nome !== 'biblioteca' || (rota.nome === 'biblioteca' && rota.tipo === destino.tipo)));
    return <a href={caminhoDaRota(destino)} className={`${classe} ${atual ? 'active' : ''}`} aria-current={atual ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navegar(destino); }}><Icon name={icone} size={18} /><span>{rotulo}</span>{contagem !== undefined && <span className="contagem-categoria">{contagem}</span>}</a>;
  };
  // Categorias pelo tipo de arquivo; com as contagens à mão, as de documento vazias saem (a aberta fica).
  // Quadros fica sempre (com a arte ligada): vazio, é ali que se descobre o que são e se adiciona a primeira obra.
  const categorias = CATEGORIAS.filter((c) => c.tipo === 'quadros' ? com('arte')
    : contagens === null || contagens[c.tipo] > 0 || (rota.nome === 'biblioteca' && rota.tipo === c.tipo));
  // A barra: marca no topo, o meio rola sozinho (as conversas podem ser muitas), e o rodapé fica (V-U3).
  const barra = <><div className="barra-marca"><a className="brand" href="/" aria-label="Margem" onClick={(e) => { e.preventDefault(); navegar({ nome: 'inicio' }); }}><Assinatura /></a><IconButton aria-label="Recolher barra lateral" title="Recolher barra lateral ([)" onClick={alternar}><Icon name="painel" /></IconButton><IconButton aria-label="Adicionar" onClick={() => navegar({ nome: 'adicionar' })}><Icon name="adicionar" /></IconButton></div>
    <nav aria-label="Seções" className="navegacao-lateral"><div className="navegacao-rolagem">{link({ nome: 'inicio' }, 'Início', 'casa')}
      {com('noticias') && link({ nome: 'noticias' }, 'Notícias', 'texto')}
      <div className="grupo-biblioteca">{link({ nome: 'biblioteca' }, 'Biblioteca', 'library')}<IconButton aria-label="Categorias da biblioteca" aria-expanded={filhos} onClick={() => expandir(!filhos)}><span className={filhos ? 'chevron-aberto' : ''}><Icon name="chevron" size={14} /></span></IconButton></div>
      {filhos && <div className="filhos-biblioteca">{categorias.map((c) => <Fragment key={c.tipo}>{link({ nome: 'biblioteca', tipo: c.tipo }, c.rotulo, c.icone, '', contagens?.[c.tipo])}</Fragment>)}</div>}
      {link({ nome: 'notas' }, 'Notas', 'caderno')}
      {link({ nome: 'flashcards' }, 'Flashcards', 'cartoes')}
      <div className="grupo-biblioteca">{link({ nome: 'perguntar' }, 'Perguntar', 'conversas', '', undefined, rota.nome === 'perguntar' && rota.conversa_id === undefined)}<IconButton aria-label="Conversas" aria-expanded={conversasAbertas} onClick={() => expandirConversas(!conversasAbertas)}><span className={conversasAbertas ? 'chevron-aberto' : ''}><Icon name="chevron" size={14} /></span></IconButton></div>
      {conversasAbertas && <div className="filhos-biblioteca"><ConversasNaBarra atual={rota.nome === 'perguntar' ? rota.conversa_id : undefined} ir={navegar} /></div>}
    </div>
      <div className="barra-inferior">{com('sala') && link({ nome: 'salas' }, 'Salas de teste', 'bandeira')}{link({ nome: 'configuracoes' }, 'Configurações', 'engrenagem')}</div>
    </nav></>;
  // Páginas de altura fixa (V-U2): só uma região rola (a lista, a conversa), nunca a casca inteira.
  // Notas (J145) como a Biblioteca: só a lista rola.
  const alturaFixa = rota.nome === 'perguntar' || rota.nome === 'biblioteca' || rota.nome === 'notas';
  const barraVisivel = aberta && largura >= 1000;
  return <ProvedorDasConversas><div className={`app-shell ${lendo ? 'lendo' : `${barraVisivel ? 'com-barra' : ''} ${rota.nome === 'inicio' || rota.nome === 'biblioteca' || rota.nome === 'noticias' || rota.nome === 'perguntar' || rota.nome === 'notas' ? 'pagina-ampla' : ''} ${alturaFixa ? 'altura-fixa' : ''}`}`}>
    {!lendo && <><header className="topbar"><div className="topbar-inner"><a className="brand" href="/" aria-label="Margem" onClick={(e) => { e.preventDefault(); navegar({ nome: 'inicio' }); }}><Assinatura /></a><span className="topbar-acoes"><IconButton aria-label="Buscar textos na biblioteca" onClick={() => navegar({ nome: 'biblioteca', buscar: true })}><Icon name="buscar" /></IconButton></span></div></header>
      {largura >= 1000 && aberta && <aside className="barra-lateral">{barra}</aside>}
      {largura >= 800 && largura < 1000 && aberta && <Drawer lado="esquerda" aoFechar={() => abrir(false)} rotulo="Navegação"><div className="barra-gaveta">{barra}</div></Drawer>}
      {(!aberta || largura < 1000) && <IconButton style={aberta ? { visibility: 'hidden' } : undefined} className="abrir-barra" aria-label="Abrir barra lateral" title="Abrir barra lateral ([)" onClick={alternar}><Icon name="painel" /></IconButton>}</>}
    {(rota.nome === 'inicio' || rota.nome === 'biblioteca') && <AtalhosDaBiblioteca />}
    <main id="conteudo" tabIndex={-1}>{!lendo && !(rota.nome === 'configuracoes' && rota.secao === 'primeiros-passos') && <AvisoDaInstalacao ir={navegar} />}{bloqueada ? null : conteudo(rota, ir, arquivosSoltos, !barraVisivel)}</main>
    {primeiraExecucao && <BoasVindasDaInstalacao estado={primeiraExecucao} ir={navegar} aoFechar={() => adiarInstalacao(true)} />}
    {onboarding.ativo && onboarding.pronto && instalacao.pronto && primeiraExecucao === null && !instalacaoPendente && mostrarBoasVindas(onboarding.estado, lendo) && <BoasVindas ir={navegar} />}
    {/* No celular, cinco itens (D-18): Adicionar no centro; Notas, Flashcards e Notícias em "Mais". */}
    {!lendo && <nav className="bottomnav" aria-label="Seções">{link({ nome: 'inicio' }, 'Início', 'casa', 'bottomnav-item')}{link({ nome: 'biblioteca' }, 'Biblioteca', 'library', 'bottomnav-item')}{link({ nome: 'adicionar' }, 'Adicionar', 'upload', 'bottomnav-item')}{link({ nome: 'perguntar' }, 'Perguntar', 'conversas', 'bottomnav-item')}
      <button type="button" className={`bottomnav-item ${noMais ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={maisAberto} onClick={() => abrirMais(true)}><Icon name="mais" size={18} /><span>Mais</span></button></nav>}
    {maisAberto && <Drawer rotulo="Mais" aoFechar={() => abrirMais(false)}><nav className="navegacao-lateral mais-do-celular" aria-label="Mais seções">
      {link({ nome: 'notas' }, 'Notas', 'caderno')}{link({ nome: 'flashcards' }, 'Flashcards', 'cartoes')}{com('noticias') && link({ nome: 'noticias' }, 'Notícias', 'texto')}
      {com('sala') && link({ nome: 'salas' }, 'Salas de teste', 'bandeira')}{link({ nome: 'configuracoes' }, 'Configurações', 'engrenagem')}
    </nav></Drawer>}
    <AvisosDoCodex ir={(caminho) => ir(rotaDoCaminho(caminho))} />
  </div></ProvedorDasConversas>;
}
/**
 * "Analisar" na página do documento (J142): a situação e o pedido pela rota única `/analise`, em que o
 * serviço decide pelo tipo; no vídeo, o botão dispara direto a análise própria (transcrição passada a
 * limpo, grifos e relações, partes e momentos), sem a janela do texto.
 */
const FONTES_DA_ANALISE: FontesDaPreparacao = { ...FONTES_DA_PREPARACAO, situacao: situacaoDaAnalise, preparar: analisarDocumento };
const ANALISES_PROPRIAS = { video: (documento: { id: string }) => analisarDocumento(documento.id) };
function conteudo(rota: Rota, ir: (destino: Rota, substituir?: boolean) => void, arquivosSoltos: File[], semBarra: boolean): ReactNode {
  switch (rota.nome) {
    case 'noticias': return <Noticias ir={ir} {...(rota.edicao_id ? { edicaoId: rota.edicao_id } : {})} />;
    // A mesma instância nas três abas: a fila continua ao trocar de aba.
    case 'adicionar': return <Adicionar key="adicionar" ir={ir} aba={rota.aba ?? abaPreferida()} {...(rota.modo ? { modo: rota.modo } : {})} arquivosIniciais={arquivosSoltos} />;
    case 'configuracoes': return <Configuracoes secao={rota.secao} ir={ir} />;
    case 'ajuda': return <Ajuda pagina={rota.pagina} ir={ir} />;
    case 'documento': return <Detalhe documento_id={rota.documento_id} ir={ir} preparacao={FONTES_DA_ANALISE} analisar={ANALISES_PROPRIAS} />;
    case 'leitura': return <Ler documento_id={rota.documento_id} {...(rota.secao_id === undefined ? {} : { secao_id: rota.secao_id })} {...(rota.bloco === undefined ? {} : { bloco: rota.bloco })} ir={ir} />;
    case 'biblioteca': return <Lista ir={ir} rota={rota} seletorDeTipo={semBarra} />;
    case 'notas': return <NotasComApagar key={rota.documento_id ?? 'biblioteca'} ir={ir} {...(rota.documento_id === undefined ? {} : { documento_id: rota.documento_id })} />;
    case 'exercicios': return <Exercicios key={rota.documento_id} documento_id={rota.documento_id} ir={ir} />;
    case 'flashcards': return <Flashcards key={`${rota.documento_id ?? 'biblioteca'}`} ir={ir} aba={rota.aba === 'todos' ? 'todos' : 'estudar'} {...(rota.documento_id === undefined ? {} : { documento_id: rota.documento_id })} />;
    case 'salas': return <SalasDeTeste ir={ir} />;
    case 'nova-sala': return <EditorDaSala key="nova" ir={ir} />;
    case 'sala': return rota.aba === 'editar' ? <EditorDaSala key={rota.sala_id} sala_id={rota.sala_id} ir={ir} /> : <RespostasDaSala key={rota.sala_id} sala_id={rota.sala_id} ir={ir} />;
    case 'quadro': return <LeitorDeQuadro key={rota.slug} slug={rota.slug} ir={ir} />;
    case 'perguntar': return <Perguntar {...(rota.conversa_id === undefined ? {} : { conversa_id: rota.conversa_id })} ir={ir} barraVisivel={!semBarra} />;
    default: return <Inicio ir={ir} />;
  }
}
