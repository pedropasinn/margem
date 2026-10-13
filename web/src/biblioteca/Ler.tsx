import { Button } from '../ui/Primitives';
import { EstudoDoCapitulo } from '../leitor/EstudoDoCapitulo';
import { ContextoDaForma, formaDoDocumento, minutosDeLeitura } from '../leitor/forma';
import { usaPdf } from '../leitor/DocumentReader';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AncoraV1, Id, MarcaV1, ProgressoV1 } from '@margem/contratos';
import { BarraDeProgresso } from '../ui/Icon';
import { Esqueleto } from '../ui/Esqueleto';
import { ReaderController } from '../leitor/ReaderController';
import type { PosicaoNaLeitura } from '../leitor/BarraDoLeitor';
import type { FontesDoProgresso, RespostaDoProgresso } from '../leitor/hooks/useProgresso';
import type { MudancaDeMarca } from '../leitor/notas';
import { arvoreDaVersao, atualizarMarca, capituloDaVersao, lerProgresso, obterDocumento, salvarProgresso, obterModos } from './api';
import type { Rota } from './rotas';
import type { Comando } from '../leitor/teclado/comandos';
import type { ArvoreDaVersao, DetalheDoDocumento, NoDaArvore, ProgressoPersistido, SnapshotDoCapitulo } from './tipos';
import { tipoDoDocumento } from './tipos';
import { consumirIntencao, gravarIntencao, type IntencaoDeLeitura } from './intencao';
import { ancoraDoBloco } from '../leitor/compreensao/geometria';
import { Icon } from '../ui/Icon';
import { BotaoDaBarra } from '../leitor/BarraDoLeitor';
import { BuscaNoDocumento, type Ocorrencia } from '../leitor/BuscaNoDocumento';
import { TourDoLeitor, type SituacaoDasMarcas } from '../onboarding/TourDoLeitor';
import { usarOnboarding } from '../onboarding/ContextoDoOnboarding';
import { pedirFlashcardsComAviso } from '../flashcards/api';

export interface FontesDaLeitura {
  documento: (id: string) => Promise<DetalheDoDocumento>;
  arvore: (versaoId: string) => Promise<ArvoreDaVersao>;
  capitulo: (versaoId: string, secaoId: string, camada?: string) => Promise<SnapshotDoCapitulo>;
  progresso: (documentoId: string) => Promise<{ progresso: ProgressoPersistido | null }>;
  gravarProgresso: (documentoId: string, progresso: ProgressoV1) => Promise<RespostaDoProgresso>;
  marca: (marcaId: string, mudanca: MudancaDeMarca) => Promise<MarcaV1 | null>;
}

export const FONTES: FontesDaLeitura = {
  documento: obterDocumento, arvore: arvoreDaVersao,
  capitulo: capituloDaVersao, progresso: lerProgresso,
  gravarProgresso: salvarProgresso, marca: atualizarMarca,
};

export interface PropsDaLeitura {
  documento_id: string;
  secao_id?: string;
  /** `?bloco=`: o trecho a mostrar quando o capítulo abrir (busca, link de volta do export). */
  bloco?: string;
  ir: (destino: Rota, substituir?: boolean) => void;
  fontes?: FontesDaLeitura;
}

const TITULOS = new Set(['capitulo', 'secao', 'legenda', 'epigrafe']);
/** A seção não tem texto corrido, só títulos e legendas. */
function soTitulos(capitulo: SnapshotDoCapitulo): boolean { return capitulo.blocos.every((bloco) => TITULOS.has(bloco.tipo)); }

/** Qual capítulo abrir: o pedido na URL, o do progresso, ou o primeiro. */
function capituloInicial(arvore: ArvoreDaVersao, pedido: string | undefined, progresso: ProgressoPersistido | null): string | null {
  if (pedido !== undefined && arvore.capitulos.some((capitulo) => capitulo.id === pedido)) return pedido;
  const concluidos = new Set(progresso?.capitulos_concluidos ?? []);
  const pendente = arvore.capitulos.find((capitulo) => !concluidos.has(capitulo.id));
  return pendente?.id ?? arvore.capitulos[0]?.id ?? null;
}

type Faixa = { inicio_utf16: number; fim_utf16: number };
/** Âncora de uma faixa do bloco (o termo achado), com o contexto de 32 caracteres das seleções. */
export function ancoraDaFaixa(versaoId: string, bloco: { id: string; texto: string }, faixa: Faixa): AncoraV1 {
  const { inicio_utf16: inicio, fim_utf16: fim } = faixa;
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: fim, citacao: bloco.texto.slice(inicio, fim),
    prefixo: bloco.texto.slice(Math.max(0, inicio - 32), inicio), sufixo: bloco.texto.slice(fim, fim + 32) };
}

export function Ler({ documento_id, secao_id, bloco: blocoPedido, ir, fontes = FONTES }: PropsDaLeitura): ReactNode {
  const [arvore, definirArvore] = useState<ArvoreDaVersao | null>(null);
  const [snapshot, definirSnapshot] = useState<SnapshotDoCapitulo | null>(null);
  const [aviso, definirAviso] = useState<string | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [concluidos, definirConcluidos] = useState<readonly Id[]>([]);
  const [autor, definirAutor] = useState<string | null>(null);
  const [tipo, definirTipo] = useState<{ icone: string; rotulo: string } | null>(null);
  const [estadoDoDocumento, definirEstadoDoDocumento] = useState<DetalheDoDocumento['estado'] | null>(null);
  const onboarding = usarOnboarding();

  useEffect(() => {
    document.title = snapshot?.documento_id === documento_id && arvore?.documento_id === documento_id
      ? `${snapshot.secao.titulo} · ${arvore.titulo} — Margem` : 'Margem';
    return () => { document.title = 'Margem'; };
  }, [snapshot?.secao.titulo, snapshot?.documento_id, arvore?.titulo, arvore?.documento_id, documento_id]);

  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const requisicao = useRef(0);
  const versaoDeDestino = useRef<{ documentoId: string; versaoId: string } | null>(null);
  const [destino, definirDestino] = useState<AncoraV1 | null>(null);
  useEffect(() => {
    let vivo = true;
    async function abrir(): Promise<void> {
      const documento = await fontes.documento(documento_id);
      const versaoId = versaoDeDestino.current?.documentoId === documento_id ? versaoDeDestino.current.versaoId : documento.versao_id;
      if (versaoId === null) throw new Error('Este documento ainda não tem texto.');
      const [carregada, progresso] = await Promise.all([
        fontes.arvore(versaoId), fontes.progresso(documento_id),
      ]);
      if (!vivo) return;
      definirAutor(documento.autor);
      definirEstadoDoDocumento(documento.estado);
      definirTipo(tipoDoDocumento(documento, carregada.capitulos.length));
      definirArvore(carregada);
      definirConcluidos(progresso.progresso?.capitulos_concluidos ?? []);
      let escolhido = capituloInicial(carregada, secao_id, progresso.progresso);
      if (escolhido === null) throw new Error('O texto não tem capítulos.');
      let camada: string | undefined;
      try { camada = localStorage.getItem(`margem:camada:${documento_id}`) === 'todas' ? 'todas' : undefined; } catch { /* sem storage */ }
      const carregar = async (secao: string): Promise<SnapshotDoCapitulo> => {
        try { return await fontes.capitulo(versaoId, secao, camada); }
        catch (falha) { if (!camada) throw falha; return fontes.capitulo(versaoId, secao); }
      };
      let capitulo = await carregar(escolhido);
      // Sem capítulo pedido, uma seção só de títulos (a folha de rosto do livro, "Capítulo 1") não é
      // onde a leitura começa: abre a seguinte, onde está o texto e as marcas.
      if (secao_id === undefined) {
        let indice = carregada.capitulos.findIndex((item) => item.id === escolhido);
        while (soTitulos(capitulo) && indice >= 0 && indice < carregada.capitulos.length - 1) {
          const seguinte = carregada.capitulos[++indice];
          if (!seguinte) break;
          escolhido = seguinte.id;
          capitulo = await carregar(escolhido);
        }
      }
      if (!vivo) return;
      if (escolhido !== secao_id) ir({ nome: 'leitura', documento_id, secao_id: escolhido }, true);
      const modos = capitulo.camadas ? await obterModos().catch(() => {
        if (vivo) definirAviso('Não foi possível carregar as cores e a legenda do modo. Reabra o capítulo para tentar novamente.');
        return { modos: [] };
      }) : { modos: [] };
      if (vivo) { definirErro(null); definirSnapshot({ ...capitulo, modos: modos.modos }); }
    }
    abrir().catch((falha: unknown) => {
      if (vivo) definirErro(falha instanceof Error ? falha.message : 'falha ao abrir o texto');
    });
    return () => { vivo = false; requisicao.current++; };
  }, [documento_id, secao_id, fontes, ir]);

  const atualizarCapitulo = useCallback(async (camada?: string) => {
    const atual = snapshotRef.current;
    if (!atual) return;
    const numero = ++requisicao.current;
    const novo = await fontes.capitulo(atual.versao_id, atual.secao.id, camada ?? atual.camada);
    if (numero === requisicao.current) definirSnapshot({ ...novo, modos: atual.modos ?? [] });
  }, [fontes]);
  const navegarAncora = useCallback((ancora: AncoraV1) => {
    void (async () => {
      const arvore = await fontes.arvore(ancora.versao_id);
      for (const capitulo of arvore.capitulos) {
        const dados = await fontes.capitulo(ancora.versao_id, capitulo.id);
        if (dados.blocos.some((b) => b.id === ancora.bloco_id)) {
          versaoDeDestino.current = { documentoId: arvore.documento_id, versaoId: ancora.versao_id };
          definirDestino(ancora);
          ir({ nome: 'leitura', documento_id: arvore.documento_id, secao_id: capitulo.id });
          return;
        }
      }
      throw new Error('O trecho não está nos capítulos disponíveis.');
    })().catch((falha: unknown) => definirAviso(falha instanceof Error ? falha.message : 'Não foi possível abrir o trecho.'));
  }, [fontes, ir]);

  // Shift J no PDF, para uma página de outro capítulo: acha o capítulo pelas páginas dele e o abre ali.
  const [paginaDestino, definirPaginaDestino] = useState<number | null>(null);
  // Vindo da página do documento: o ponto certo (trecho, página, exercício, visual, ação do estudo).
  const [intencao, definirIntencao] = useState<IntencaoDeLeitura | null>(null);
  // Seções no sumário: as do capítulo aberto aparecem (a menos que o leitor as feche); as dos outros, ao abrir.
  const [abertos, definirAbertos] = useState<ReadonlySet<string>>(() => new Set());
  const [fechados, definirFechados] = useState<ReadonlySet<string>>(() => new Set());
  const alternarSecoes = (id: string, aberto: boolean) => {
    const trocar = (conjunto: ReadonlySet<string>, incluir: boolean) => { const novo = new Set(conjunto); if (incluir) novo.add(id); else novo.delete(id); return novo; };
    if (id === snapshotRef.current?.secao.id) definirFechados((atual) => trocar(atual, aberto));
    else definirAbertos((atual) => trocar(atual, !aberto));
  };
  // O trecho achado (busca, `?bloco=`): o estudo leva à citação pelo `destino`; o leitor simples
  // rola até o bloco e desenha a caixa por alguns segundos, como a citação do estudo.
  const [achado, definirAchado] = useState<AncoraV1 | null>(null);
  useEffect(() => {
    if (!achado) return;
    const tempo = setTimeout(() => definirAchado(null), 4500);
    return () => clearTimeout(tempo);
  }, [achado]);
  const mostrarTrecho = useCallback((blocoId: string, faixa?: Faixa | null) => {
    const atual = snapshotRef.current;
    const bloco = atual?.blocos.find((b) => b.id === blocoId);
    if (!atual || !bloco) return;
    const ancora = faixa && faixa.fim_utf16 > faixa.inicio_utf16 && faixa.fim_utf16 <= bloco.texto.length
      ? ancoraDaFaixa(atual.versao_id, bloco, faixa) : ancoraDoBloco(atual.versao_id, bloco);
    // No PDF, a página do bloco primeiro: as páginas fora da tela ainda não têm camada de texto.
    const pagina = usaPdf(atual) ? bloco.origens.find((origem) => origem.tipo === 'pdf') : undefined;
    if (pagina?.tipo === 'pdf') { definirPaginaDestino(null); setTimeout(() => definirPaginaDestino(pagina.pagina), 0); }
    if (atual.camadas) { definirDestino(ancora); return; }
    definirAchado(ancora);
    const elemento = pagina ? null : document.querySelector(`[data-bloco="${blocoId}"]`);
    if (elemento && typeof elemento.scrollIntoView === 'function') elemento.scrollIntoView({ block: 'center' });
  }, []);
  const secaoCarregada = snapshot?.secao.id;
  useEffect(() => {
    if (!secaoCarregada) return;
    const pedida = consumirIntencao(documento_id, secaoCarregada);
    if (!pedida) return;
    // Depois da retomada do progresso, que também rola o capítulo ao abrir: o trecho pedido vence.
    if (pedida.ancora) { const ancora = pedida.ancora; setTimeout(() => definirDestino(ancora), 700); }
    const blocoDaIntencao = pedida.bloco;
    if (blocoDaIntencao) setTimeout(() => mostrarTrecho(blocoDaIntencao), 700);
    if (pedida.pagina) definirPaginaDestino(pedida.pagina);
    definirIntencao(pedida);
  }, [documento_id, secaoCarregada, mostrarTrecho]);
  const irParaPagina = useCallback((pagina: number) => {
    void (async () => {
      const atual = snapshotRef.current;
      if (!atual) return;
      const arvoreAtual = await fontes.arvore(atual.versao_id);
      for (const capitulo of arvoreAtual.capitulos) {
        const dados = capitulo.id === atual.secao.id ? atual : await fontes.capitulo(atual.versao_id, capitulo.id);
        if (dados.paginas && pagina >= dados.paginas.inicio && pagina <= dados.paginas.fim) {
          definirPaginaDestino(pagina);
          if (capitulo.id !== atual.secao.id) ir({ nome: 'leitura', documento_id, secao_id: capitulo.id });
          return;
        }
      }
      throw new Error(`A página ${String(pagina)} não está em nenhum capítulo.`);
    })().catch((falha: unknown) => definirAviso(falha instanceof Error ? falha.message : 'Não foi possível abrir a página.'));
  }, [fontes, ir, documento_id]);

  // Vindo de fora com `?bloco=`: espera a retomada do progresso (que também rola ao abrir), como a intenção.
  const faixaPendente = useRef<{ bloco: string; faixa: Faixa | null } | null>(null);
  useEffect(() => {
    if (!blocoPedido || secaoCarregada !== secao_id) return;
    const faixa = faixaPendente.current?.bloco === blocoPedido ? faixaPendente.current.faixa : null;
    faixaPendente.current = null;
    const tempo = setTimeout(() => mostrarTrecho(blocoPedido, faixa), 700);
    return () => clearTimeout(tempo);
  }, [blocoPedido, secaoCarregada, secao_id, mostrarTrecho]);
  const [buscaAberta, abrirBusca] = useState(false);
  const campoDaBusca = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (!(evento.ctrlKey || evento.metaKey) || evento.altKey || evento.shiftKey || evento.key.toLowerCase() !== 'f') return;
      evento.preventDefault();
      abrirBusca(true);
      campoDaBusca.current?.focus(); campoDaBusca.current?.select();
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, []);
  const irAoAchado = useCallback(({ resultado, faixa }: Ocorrencia) => {
    const capitulo = resultado.capitulo?.id;
    if (capitulo === undefined || capitulo === snapshotRef.current?.secao.id) { mostrarTrecho(resultado.bloco_id, faixa); return; }
    faixaPendente.current = { bloco: resultado.bloco_id, faixa };
    ir({ nome: 'leitura', documento_id, secao_id: capitulo, bloco: resultado.bloco_id });
  }, [documento_id, ir, mostrarTrecho]);

  const fontesDoProgresso = useMemo<FontesDoProgresso>(() => ({
    ler: async (documentoId) => (await fontes.progresso(documentoId)).progresso,
    gravar: (documentoId, progresso) => fontes.gravarProgresso(documentoId, progresso),
  }), [fontes]);
  // As perguntas de recuperação das seções do capítulo chegam achatadas na margem,
  // na ordem do texto; a coluna de notas as mostra depois da última nota.
  const perguntas = useMemo<readonly string[]>(
    () => (snapshot?.recuperacao ?? []).flatMap((item) => item.perguntas), [snapshot],
  );
  const gravarMarca = useCallback(
    (marcaId: Id, mudanca: MudancaDeMarca) => fontes.marca(marcaId, mudanca), [fontes],
  );

  // No celular os capítulos viram uma faixa rolável: o atual fica à vista.
  const secaoAtual = snapshot?.secao.id;
  useEffect(() => {
    const atual = document.querySelector<HTMLElement>('.capitulos a[aria-current]');
    if (atual !== null && typeof atual.scrollIntoView === 'function') {
      atual.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [secaoAtual]);

  // Flashcards do capítulo aberto: o Codex os cria a partir do texto, dos grifos e das notas.
  const versaoAberta = snapshot?.versao_id;
  const criarFlashcards = useCallback(() => {
    if (versaoAberta === undefined || secaoAtual === undefined) return;
    void pedirFlashcardsComAviso(versaoAberta, secaoAtual).then(definirAviso);
  }, [versaoAberta, secaoAtual]);
  // As notas e os flashcards do livro inteiro, na paleta (Ctrl K) e no menu •••.
  const comandosDasNotas = useMemo<Comando[]>(() => [{ id: 'notas-do-livro', grupo: 'Leitura', rotulo: 'Notas do livro (todas as anotações e grifos)',
    palavras: 'anotações grifos destaques exportar citação', executar: () => ir({ nome: 'notas', documento_id }) },
  { id: 'criar-flashcards', grupo: 'Estudo', rotulo: 'Criar flashcards deste capítulo', palavras: 'cartões revisão anki memorizar repetição espaçada', executar: criarFlashcards },
  { id: 'flashcards-do-livro', grupo: 'Estudo', rotulo: 'Flashcards do livro (estudar)', palavras: 'cartões revisão anki memorizar', executar: () => ir({ nome: 'flashcards', documento_id }) }],
  [ir, documento_id, criarFlashcards]);
  if (erro !== null) return <div className="empty" role="alert"><h2>Não foi possível abrir a leitura</h2><p>{erro}</p></div>;
  if (arvore === null || snapshot === null || snapshot.documento_id !== documento_id) return <Esqueleto />;

  const Controlador = snapshot.camadas ? EstudoDoCapitulo : ReaderController;
  const forma = formaDoDocumento(arvore.capitulos);
  const minutos = minutosDeLeitura(snapshot.blocos.map((bloco) => bloco.texto));
  // Texto único: a abertura de um artigo (autor e tempo) e, no fim, "terminei" no lugar do próximo capítulo.
  // No PDF quem abre é a própria página original.
  const abertura = forma === 'texto' && !usaPdf(snapshot)
    ? <p className="abertura-do-texto">{autor && <span>{autor}</span>}<span>{minutos} min de leitura</span></p>
    : undefined;
  const lido = concluidos.includes(snapshot.secao.id);
  // Uma seção do sumário: no capítulo aberto, rola até ela; em outro, abre o capítulo já nela.
  const irParaSecao = (capituloId: string, blocoId: string) => {
    if (capituloId === snapshot.secao.id) {
      const bloco = snapshot.blocos.find((b) => b.id === blocoId);
      // O estudo leva à citação (texto e PDF); o leitor simples só rola até o bloco.
      if (bloco && snapshot.camadas) definirDestino(ancoraDoBloco(snapshot.versao_id, bloco));
      else document.querySelector(`[data-bloco="${blocoId}"]`)?.scrollIntoView({ block: 'start' });
      return;
    }
    gravarIntencao({ documento_id, secao_id: capituloId, bloco: blocoId });
    ir({ nome: 'leitura', documento_id, secao_id: capituloId });
  };
  const sumario = arvore.capitulos.length > 1 || secoesDoCapitulo(arvore.secoes, snapshot.secao.id).length > 0 ? <nav className="capitulos" aria-label="Capítulos">
    <p className="capitulos-titulo">{arvore.titulo}</p>
    {arvore.capitulos.length > 1 && <>
      <p className="capitulos-conta">{concluidos.length} de {arvore.capitulos.length} lidos</p>
      <BarraDeProgresso valor={arvore.capitulos.length === 0 ? 0 : (concluidos.length / arvore.capitulos.length) * 100} rotulo="Capítulos lidos" />
    </>}
    <ul>
      {arvore.capitulos.map((capitulo) => {
        const secoes = secoesDoCapitulo(arvore.secoes, capitulo.id);
        const aberto = capitulo.id === snapshot.secao.id ? !fechados.has(capitulo.id) : abertos.has(capitulo.id);
        return <li key={capitulo.id} className={secoes.length > 0 ? 'capitulo-com-secoes' : undefined}>
          <span className="linha-do-capitulo">
            <a
              href={`/ler/${documento_id}/${capitulo.id}`}
              aria-current={capitulo.id === snapshot.secao.id ? 'true' : undefined}
              onClick={(evento) => { evento.preventDefault(); ir({ nome: 'leitura', documento_id, secao_id: capitulo.id }); }}
            >
              <span className={concluidos.includes(capitulo.id) ? 'capitulo-dot lido' : 'capitulo-dot'} aria-hidden="true" />
              <span>{capitulo.titulo}</span>
              {concluidos.includes(capitulo.id) && <span className="concluido apenas-leitores"> · lido</span>}
            </a>
            {secoes.length > 0 && <button type="button" className="abrir-secoes" aria-expanded={aberto}
              aria-label={`${aberto ? 'Esconder' : 'Mostrar'} as seções de ${capitulo.titulo}`} onClick={() => alternarSecoes(capitulo.id, aberto)}>
              <Icon name="abaixo" size={14} />
            </button>}
          </span>
          {aberto && secoes.length > 0 && <ul className="secoes-do-capitulo">
            {secoes.map((secao) => <li key={secao.id}>
              <a href={`/ler/${documento_id}/${capitulo.id}`} className={`secao-do-sumario profundidade-${String(secao.profundidade)}`}
                onClick={(evento) => { evento.preventDefault(); irParaSecao(capitulo.id, secao.bloco_inicio); }}>{secao.titulo}</a>
            </li>)}
          </ul>}
        </li>;
      })}
    </ul>
  </nav> : undefined;
  const indiceDoCapitulo = arvore.capitulos.findIndex((capitulo) => capitulo.id === snapshot.secao.id);
  const irAoCapitulo = (indice: number) => { const alvo = arvore.capitulos[indice]; if (alvo) ir({ nome: 'leitura', documento_id, secao_id: alvo.id }); };
  // O que a primeira dica do tour pode prometer: marcas presentes, uma leitura em curso, ou nenhuma.
  const situacao: SituacaoDasMarcas = snapshot.marcas.length > 0 ? 'com_marcas'
    : estadoDoDocumento === 'marcando' || estadoDoDocumento === 'revisando' ? 'lendo' : 'sem_marcas';
  const posicao: PosicaoNaLeitura | undefined = arvore.capitulos.length > 1 && indiceDoCapitulo >= 0 ? {
    tipo: 'capitulo', atual: indiceDoCapitulo + 1, total: arvore.capitulos.length,
    anterior: indiceDoCapitulo > 0 ? () => irAoCapitulo(indiceDoCapitulo - 1) : undefined,
    proximo: indiceDoCapitulo < arvore.capitulos.length - 1 ? () => irAoCapitulo(indiceDoCapitulo + 1) : undefined,
    irPara: (numero) => irAoCapitulo(numero - 1),
  } : undefined;
  return (
    <ContextoDaForma.Provider value={forma}>
    <div className={forma === 'texto' ? 'leitura texto-unico' : 'leitura'}>
      {aviso && <p className="aviso-estudo" role="status">{aviso}</p>}
      {buscaAberta && <BuscaNoDocumento documentoId={documento_id} campoRef={campoDaBusca} aoIr={irAoAchado} aoFechar={() => abrirBusca(false)} />}
      <TourDoLeitor situacao={situacao} pdf={usaPdf(snapshot)} ir={ir} />
      <Controlador
        voltar={{ href: `/documentos/${documento_id}`, rotulo: 'Voltar ao documento', aoVoltar: () => ir({ nome: 'documento', documento_id }) }}
        comandos={comandosDasNotas}
        menuExtra={<>
          <li><a className="ui-button ui-ghost" href={`/documentos/${documento_id}/notas`} onClick={(evento) => { evento.preventDefault(); ir({ nome: 'notas', documento_id }); }}><Icon name="caderno" size={18} /><span><span className="acao-rotulo">Notas do livro</span></span></a></li>
          <li><Button variante="ghost" onClick={criarFlashcards}><Icon name="cartoes" size={18} /><span><span className="acao-rotulo">Criar flashcards</span><span className="acao-detalhe">deste capítulo, pelo Codex</span></span></Button></li>
          <li><a className="ui-button ui-ghost" href={`/documentos/${documento_id}/flashcards`} onClick={(evento) => { evento.preventDefault(); ir({ nome: 'flashcards', documento_id }); }}><Icon name="cartoes" size={18} /><span><span className="acao-rotulo">Flashcards do livro</span></span></a></li>
          {onboarding.ativo && <li><Button variante="ghost" onClick={() => onboarding.despachar({ tipo: 'rever_tour' })}><Icon name="explicar" size={18} /><span><span className="acao-rotulo">Rever as dicas do leitor</span></span></Button></li>}
        </>}
        sumario={sumario}
        posicao={posicao}
        irParaPagina={irParaPagina}
        paginaDestino={paginaDestino}
        {...(snapshot.camadas ? { intencao } : {})}
        aoAtualizar={atualizarCapitulo}
        tituloDocumento={arvore.titulo}
        {...(tipo ? { tipoDoDocumento: tipo } : {})}
        {...(autor ? { autor } : {})}
        aoNavegarAncora={navegarAncora}
        aoIrCapitulo={(secao: string) => ir({ nome: 'leitura', documento_id, secao_id: secao })}
        destino={destino}
        acoesDaBarra={<BotaoDaBarra rotulo="Buscar no documento" atalho="Ctrl F" icone="buscar" aria-expanded={buscaAberta} onClick={() => abrirBusca((aberta) => !aberta)} />}
        snapshot={achado && !snapshot.camadas
          ? { ...snapshot, tracosPessoais: [...(snapshot.tracosPessoais ?? []), { id: 'achado-da-busca', ancora: achado, acao: 'caixa' }] }
          : snapshot}
        documento_id={documento_id}
        estrategia="scroll"
        progresso={fontesDoProgresso}
        atualizarMarca={gravarMarca}
        perguntas={perguntas}
        aoMudarCapitulos={definirConcluidos}
        abertura={abertura}
        navegacao={forma === 'texto' ? (
          <nav className="fim-do-texto" aria-label="Fim do texto">
            <span className="fim-do-texto-sinal" aria-hidden="true">⁂</span>
            {lido
              ? <p className="fim-do-texto-lido" role="status">Lido</p>
              : <Button data-avancar="">Terminei a leitura</Button>}
            <a href="/" onClick={(evento) => { evento.preventDefault(); ir({ nome: 'biblioteca' }); }}>Voltar à biblioteca</a>
          </nav>
        ) : (
          <nav className="navegacao-capitulos" aria-label="Navegar capítulos">
            {([['anterior', 'Anterior'], ['proxima', 'Próximo capítulo']] as const).map(([chave, rotulo]) => {
              const secao = snapshot[chave];
              if (secao == null) return <span key={chave} />;
              const titulo = arvore.capitulos.find((capitulo) => capitulo.id === secao)?.titulo ?? '';
              return (
                <a
                  key={chave}
                  className={`cartao-capitulo ${chave}`}
                  href={`/ler/${documento_id}/${secao}`}
                  aria-label={rotulo}
                  {...(chave === 'proxima' ? { 'data-avancar': '' } : {})}
                  onClick={(evento) => { evento.preventDefault(); ir({ nome: 'leitura', documento_id, secao_id: secao }); }}
                >
                  <span className="cartao-capitulo-rotulo">{rotulo}</span>
                  <span className="cartao-capitulo-titulo">{titulo}</span>
                </a>
              );
            })}
          </nav>
        )}
      />
    </div>
    </ContextoDaForma.Provider>
  );
}

interface SecaoDoSumario { id: string; titulo: string; bloco_inicio: string; profundidade: number }
/** As seções dentro de um capítulo (até dois níveis abaixo dele), na ordem do texto. */
export function secoesDoCapitulo(secoes: readonly NoDaArvore[], capituloId: string): SecaoDoSumario[] {
  const achar = (nos: readonly NoDaArvore[]): NoDaArvore | null => {
    for (const no of nos) { if (no.id === capituloId) return no; const dentro = achar(no.filhos); if (dentro) return dentro; }
    return null;
  };
  const capitulo = achar(secoes);
  if (!capitulo) return [];
  const lista: SecaoDoSumario[] = [];
  const descer = (nos: readonly NoDaArvore[], profundidade: number) => {
    for (const no of nos) {
      lista.push({ id: no.id, titulo: no.titulo, bloco_inicio: no.bloco_inicio, profundidade });
      if (profundidade < 2) descer(no.filhos, profundidade + 1);
    }
  };
  descer(capitulo.filhos, 1);
  return lista;
}
