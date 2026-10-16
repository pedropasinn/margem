import { ComparacaoDeVersoes } from './ComparacaoDeVersoes';
import { mensagemDeErro } from './erros';
import { Button, IconButton, Popover, Drawer, classesDoBotao } from '../ui/Primitives';
import {
  EstadoDaPreparacao, FONTES_DA_PREPARACAO, JanelaDaPreparacao, PrimeiroEuDoDocumento, rotuloDeAnalisar, tipoDeAnalise, usePreparacao,
  type FontesDaPreparacao, type TipoDeAnalise,
} from './Operacoes';
import type { CamadaResumida } from '../leitor/f2';
import { rotuloCamada } from '../leitor/f2';
import { retomarEmPausa } from '../pausa/api';
import { escrever, pedir } from './api';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Esqueleto } from '../ui/Esqueleto';
import { Icon } from '../ui/Icon';
import { arvoreDaVersao, lerProgresso, obterDocumento } from './api';
import { fraseDoEstado, frasesDasMarcas } from './estado';
import type { Rota } from './rotas';
import type { DetalheDoDocumento } from './tipos';
import { rotuloDoDocumento, tipoDoDocumento } from './tipos';
import { TipoDoDocumento } from '../ui/TipoDoDocumento';
import { ProducaoDoDocumento } from './ProducaoDoDocumento';
import { SumarioConferido } from './SumarioConferido';
import { EnviarParaObsidian } from './EnviarParaObsidian';
import { pedirFlashcardsComAviso } from '../flashcards/api';
import { CancelarAnalise, JanelaDeApagarEmLote, MenuDeApagar } from '../apagar/NoDocumento';
import type { QuemApagar } from '../apagar/api';

export interface CapitulosDoDocumento {
  capitulos: { id: string; titulo: string }[];
  concluidos: string[];
}

export interface PropsDoDetalhe {
  documento_id: string;
  ir: (destino: Rota) => void;
  carregar?: (id: string) => Promise<DetalheDoDocumento>;
  /** "Analisar": estado e pedido (a compreensão do texto, num clique). */
  preparacao?: FontesDaPreparacao;
  /**
   * Ponto de extensão do "Analisar" por tipo de documento (V-T3). Sem entrada para o tipo, vale a análise
   * do texto (a janela). O vídeo tem a análise própria (J142), ligada na rota do documento (`App.tsx`).
   * Se devolver uma promessa, o botão espera e a página relê a situação no fim.
   */
  analisar?: Partial<Record<TipoDeAnalise, (documento: DetalheDoDocumento) => void | Promise<unknown>>>;
  /** Capítulos e progresso; sem ela (ou se falhar) o detalhe mostra só o resto. */
  capitulos?: (documento: DetalheDoDocumento) => Promise<CapitulosDoDocumento>;
}

/** Uma canonização de PDF grande lista centenas de limites técnicos; nos detalhes, os primeiros bastam. */
const LIMITES_VISIVEIS = 20;

async function capitulosDaApi(documento: DetalheDoDocumento): Promise<CapitulosDoDocumento> {
  if (documento.versao_id === null) return { capitulos: [], concluidos: [] };
  const [arvore, progresso] = await Promise.all([arvoreDaVersao(documento.versao_id), lerProgresso(documento.id)]);
  return {
    capitulos: arvore.capitulos,
    concluidos: [...(progresso.progresso?.capitulos_concluidos ?? [])],
  };
}

/** Lotes legados do mesmo modo/dia formam uma leitura; execuções continuam individuais. */
function agruparLeituras(camadas: readonly CamadaResumida[]): { id: string; rotulo: string }[] {
  const grupos = new Map<string, { camada: CamadaResumida; lotes: number }>();
  for (const camada of camadas) {
    const dia = new Date(camada.criada_em).toLocaleDateString('pt-BR');
    const chave = camada.tipo === 'importacao' ? JSON.stringify([camada.modo.id, camada.modo.revisao, dia]) : camada.id;
    const grupo = grupos.get(chave);
    if (grupo) grupo.lotes++;
    else grupos.set(chave, { camada, lotes: 1 });
  }
  return [...grupos.values()].map(({ camada, lotes }) => ({
    id: camada.id,
    rotulo: camada.tipo === 'importacao'
      ? `${rotuloCamada(camada).replace('Importação ·', 'Importação legada ·')} · ${lotes} ${lotes === 1 ? 'lote' : 'lotes'}`
      : rotuloCamada(camada),
  }));
}

const SEM_ANALISES: NonNullable<PropsDoDetalhe['analisar']> = {};

export function Detalhe({
  documento_id, ir, carregar = obterDocumento, preparacao: fontesDaPreparacao = FONTES_DA_PREPARACAO, capitulos = capitulosDaApi, analisar = SEM_ANALISES,
}: PropsDoDetalhe): ReactNode {
  const [camadas, definirCamadas] = useState<CamadaResumida[]>([]);
  const [menu, abrirMenu] = useState(false);
  const [comparacao, abrirComparacao] = useState(false);
  const [diagnostico, abrirDiagnostico] = useState(false);
  const [obsidian, abrirObsidian] = useState(false);
  const botaoMenu = useRef<HTMLButtonElement>(null);
  const [documento, definir] = useState<DetalheDoDocumento | null>(null);
  const [indice, definirIndice] = useState<CapitulosDoDocumento | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [operando, operar] = useState(false);
  const [janela, abrirJanela] = useState(false);
  // Muda quando a preparação avança: as camadas e o que o Margem produziu são lidos de novo.
  const [rodadaDaLeitura, novaRodadaDaLeitura] = useState(0);
  const [aviso, definirAviso] = useState<string | null>(null);
  // Apagar em lote (V-T8): a janela de confirmação aberta pelo menu "…".
  const [apagar, abrirApagar] = useState<QuemApagar | null>(null);

  const recarregar = useCallback(() => carregar(documento_id).then(definir, (falha: unknown) => {
    definirErro(mensagemDeErro(falha, 'Não foi possível carregar o documento.'));
  }), [carregar, documento_id]);

  useEffect(() => { void recarregar(); }, [recarregar]);
  const aoMudarPreparacao = useCallback(() => { novaRodadaDaLeitura((atual) => atual + 1); void recarregar(); }, [recarregar]);
  const preparacao = usePreparacao(documento_id, documento?.texto_disponivel === true, fontesDaPreparacao, aoMudarPreparacao);

  const versaoId = documento?.versao_id ?? null;
  // J164: usar (ou largar) o sumário sugerido muda os capítulos que o índice mostra.
  const [rodadaDoSumario, novaRodadaDoSumario] = useState(0);
  useEffect(() => {
    if (documento === null || versaoId === null) return;
    let vivo = true;
    capitulos(documento).then(
      (resposta) => { if (vivo) definirIndice(resposta); },
      () => { /* sem índice: o detalhe continua útil sem ele */ },
    );
    return () => { vivo = false; };
    // O índice depende da versão (e do sumário em uso), não de cada recarga do documento.
  }, [versaoId, capitulos, rodadaDoSumario]);

  useEffect(() => {
    if (!versaoId) return;
    let vivo = true;
    void pedir<{ camadas: CamadaResumida[] }>(`/api/documentos/${documento_id}/camadas`).then((r) => { if (vivo) definirCamadas(r.camadas ?? []); }, () => {});
    return () => { vivo = false; };
  }, [documento_id, versaoId, rodadaDaLeitura]);

  if (erro !== null) return <p className="empty" role="alert">Não foi possível abrir o documento: {erro}</p>;
  if (documento === null) return <Esqueleto />;
  const versao = documento.versoes[0];
  // PDF escaneado: as páginas sem camada de texto podem ser transcritas por visão (job do worker).
  const semTexto = documento.formato === 'pdf' ? documento.paginas_sem_texto ?? 0 : 0;
  const concluidos = new Set(indice?.concluidos ?? []);
  // Trabalhos concluídos com ressalvas (leitura parcial, marcas que ficaram de fora…): visíveis aqui, com os detalhes no Diagnóstico.
  const avisosDosTrabalhos = [...new Set(documento.jobs.flatMap((job) => (job.estado === 'ok' ? job.avisos ?? [] : []).map((a) => a.mensagem)))];
  // Um texto sem capítulos (artigo, ensaio, texto colado) não tem índice: lê-se de uma vez.
  const textoUnico = indice !== null && indice.capitulos.length === 1;
  const lido = textoUnico && concluidos.size > 0;
  // Vídeo se assiste, áudio se ouve; o resto se lê.
  const verbo = documento.midia?.tipo === 'video'
    ? { uma: 'Assistir', de_novo: 'Assistir de novo', continuar: 'Continuar assistindo', comecar: 'Começar a assistir' }
    : documento.midia?.tipo === 'audio'
      ? { uma: 'Ouvir', de_novo: 'Ouvir de novo', continuar: 'Continuar ouvindo', comecar: 'Começar a ouvir' }
      : { uma: 'Ler', de_novo: 'Reler', continuar: 'Continuar de onde parei', comecar: 'Começar a ler' };
  const analise = rotuloDeAnalisar(preparacao.situacao);
  const lerCapitulo = (secao_id?: string) => {
    ir(secao_id === undefined
      ? { nome: 'leitura', documento_id: documento.id }
      : { nome: 'leitura', documento_id: documento.id, secao_id });
  };

  async function operacao(caminho: string | (() => Promise<unknown>)): Promise<void> {
    if (operando) return;
    operar(true); definirAviso(null);
    try { await (typeof caminho === 'string' ? escrever(caminho, {}) : caminho()); await recarregar(); }
    catch (falha) { definirAviso(mensagemDeErro(falha, 'Não foi possível concluir a operação.')); }
    finally { operar(false); }
  }
  // V-F1: o que ficou parado desde antes de o app abrir espera a pessoa; "Retomar" o devolve à fila.
  const retomarDaPausa = (id: string) => void operacao(() => retomarEmPausa({ ids: [id] }));
  const emPausa = documento.jobs.some((job) => job.em_pausa === true) || documento.preparacao_em_pausa === true;

  return (
    <article className="detalhe">

      <section className="hero-card detalhe-topo">
        <div className="hero-top">
          <span className="eyebrow"><TipoDoDocumento {...tipoDoDocumento(documento, indice?.capitulos.length)} tamanho={14} />{documento.midia ? ` · ${String(Math.max(1, Math.round(documento.midia.duracao_s / 60)))} min` : ''}</span>
          <span className={documento.estado === 'falhou' ? 'badge erro' : 'badge'}>{documento.estado === 'pronto' ? 'pronto' : documento.estado === 'falhou' ? 'Requer atenção' : fraseDoEstado(documento)}</span>
        </div>
        <h1>{documento.titulo}</h1>
        {documento.autor !== null && <p className="autor">{documento.autor}</p>}
        <div className="hero-meta">
          {textoUnico && <span>{lido ? <><Icon name="check" size={16} />Lido</> : 'Texto único'}</span>}
          {!textoUnico && indice !== null && indice.capitulos.length > 0 && (
            <span><Icon name="list" size={16} />{concluidos.size} de {indice.capitulos.length} capítulos lidos</span>
          )}
          <span>{documento.marcas.total} marcas · {rotuloDoDocumento(documento, { md: 'Markdown' })}</span>
        </div>
        {/* V-T3: "Analisar" é a ação principal; ler vem ao lado, secundário; Notas, Exercícios e Flashcards
            descem para uma linha de atalhos discretos, abaixo. */}
        <div className="button-row acoes-do-documento">
          {documento.texto_disponivel && analise !== null && (
            <Button variante="primario" tamanho="lg" disabled={analise.desabilitado || preparacao.ocupado || operando} className="botao-analisar"
              onClick={() => {
                const propria = analisar[tipoDeAnalise(documento)];
                if (propria) {
                  operar(true); definirAviso(null);
                  void Promise.resolve(propria(documento))
                    .then(() => { preparacao.recarregar(); aoMudarPreparacao(); },
                      (falha: unknown) => { definirAviso(mensagemDeErro(falha, 'Não foi possível começar a análise.')); })
                    .finally(() => { operar(false); });
                }
                else if (preparacao.situacao?.estado === 'falhou') void preparacao.preparar();
                else abrirJanela(true);
              }}>
              <Icon name="spark" size={18} /> {analise.rotulo}
            </Button>
          )}
          {documento.texto_disponivel && (
            <a
              // Sem "Analisar" à vista (ainda sem texto para analisar), ler volta a ser a ação principal.
              className={classesDoBotao({ variante: analise === null ? 'primario' : 'secundario', tamanho: 'lg' })}
              href={`/ler/${documento.id}`}
              onClick={(evento) => { evento.preventDefault(); lerCapitulo(); }}
            >
              {textoUnico ? (lido ? verbo.de_novo : verbo.uma) : concluidos.size > 0 || documento.progresso ? verbo.continuar : verbo.comecar}
            </a>
          )}
        <div className="operacoes-documento">
          <IconButton ref={botaoMenu} aria-label="Opções do documento" aria-expanded={menu} onClick={() => abrirMenu(!menu)} icone="reticencias" />
          {menu && <Popover ancora={botaoMenu} rotulo="Opções do documento" aoFechar={() => abrirMenu(false)} className="formulario">
            <div><span className="eyebrow">Marcas por função</span><p className="dados">{frasesDasMarcas(documento).map((frase) => frase.replace(' ', '\u00a0')).join(' · ') || `${documento.marcas.total} marcas`}</p></div>
            {documento.versao_id && <PrimeiroEuDoDocumento documentoId={documento_id} />}
            <Button variante="ghost" disabled={operando} onClick={() => void operacao(`/api/documentos/${documento_id}/${documento.arquivado_em ? 'desarquivar' : 'arquivar'}`)}>{documento.arquivado_em ? 'Desarquivar' : 'Arquivar'}</Button>
            {documento.versao_id && textoUnico && indice?.capitulos[0] && <Button variante="ghost" onClick={() => {
              const versao = documento.versao_id; const secao = indice.capitulos[0]?.id;
              abrirMenu(false);
              if (versao && secao) void pedirFlashcardsComAviso(versao, secao).then(definirAviso);
            }}>Criar flashcards</Button>}
            {documento.versao_id && <Button variante="ghost" onClick={() => { abrirMenu(false); abrirObsidian(true); }}>Exportar para o Obsidian</Button>}
            {documento.versoes.length > 1 && <Button variante="ghost" onClick={() => { abrirMenu(false); abrirComparacao(true); }}>Comparar versões</Button>}
            <Button variante="ghost" onClick={() => { abrirMenu(false); abrirDiagnostico(true); }}>Diagnóstico</Button>
            {documento.versao_id && <MenuDeApagar aoEscolher={(quem) => { abrirMenu(false); abrirApagar(quem); }} />}
          </Popover>}
        </div>
        </div>
        {documento.versao_id !== null && (
          <nav className="atalhos-do-documento" aria-label="Do documento">
            {([['notas', 'caderno', 'Notas'], ['exercicios', 'resolver', 'Exercícios'], ['flashcards', 'cartoes', 'Flashcards']] as const).map(([nome, icone, rotulo]) => (
              <a key={nome} href={`/documentos/${documento.id}/${nome}`} onClick={(evento) => { evento.preventDefault(); ir({ nome, documento_id: documento.id }); }}>
                <Icon name={icone} size={16} /> {rotulo}
              </a>
            ))}
          </nav>
        )}
        {semTexto > 0 && documento.estado !== 'transcrevendo' && (
          <p className="aviso">
            {semTexto === 1 ? '1 página sem texto' : `${String(semTexto)} páginas sem texto`} —{' '}
            <Button variante="ghost" disabled={operando} onClick={() => void operacao(`/api/documentos/${documento_id}/transcrever`)}>transcrever</Button>
          </p>
        )}
        {documento.texto_disponivel && <EstadoDaPreparacao preparacao={preparacao} textoUnico={textoUnico} />}
        {documento.versao_id !== null && <SumarioConferido key={documento.versao_id} documentoId={documento_id} aoMudar={() => novaRodadaDoSumario((atual) => atual + 1)} />}
        {documento.texto_disponivel && <CancelarAnalise documentoId={documento_id} situacao={preparacao.situacao} aoCancelar={() => { preparacao.recarregar(); aoMudarPreparacao(); }} />}
        {janela && <JanelaDaPreparacao preparacao={preparacao} documentoId={documento_id} textoUnico={textoUnico} aoFechar={() => abrirJanela(false)} />}
        {avisosDosTrabalhos.length > 0 && (
          <p className="aviso aviso-dos-trabalhos" role="status">
            Concluído com avisos: {avisosDosTrabalhos[0]}
            {avisosDosTrabalhos.length > 1 && ` (e mais ${String(avisosDosTrabalhos.length - 1)})`} —{' '}
            <Button variante="ghost" onClick={() => abrirDiagnostico(true)}>ver detalhes</Button>
          </p>
        )}
        {aviso !== null && <p className="aviso">{aviso}</p>}
      </section>

      <div className="detalhe-grade">
        {indice !== null && <ProducaoDoDocumento documento={documento} capitulos={indice.capitulos} concluidos={concluidos} camadas={camadas} ir={ir}
          preparacao={preparacao.situacao} />}


      </div>
      {apagar && <JanelaDeApagarEmLote documentoId={documento.id} quem={apagar} aoFechar={() => abrirApagar(null)}
        aoApagar={() => { preparacao.recarregar(); aoMudarPreparacao(); }} />}
      {obsidian && <Drawer rotulo="Exportar para o Obsidian" aoFechar={() => abrirObsidian(false)}><EnviarParaObsidian documentoId={documento.id} /></Drawer>}
      {comparacao && <Drawer rotulo="Comparar versões" aoFechar={() => abrirComparacao(false)}><ComparacaoDeVersoes versoes={documento.versoes} /></Drawer>}
      {diagnostico && <Drawer rotulo="Diagnóstico" aoFechar={() => abrirDiagnostico(false)}>
        {documento.detalhe && <p>Último resultado: {documento.detalhe}</p>}
        <div className="diagnostico">
          {versao !== undefined && (
            <section className="card">
              <span className="eyebrow">Texto</span>
              <p className="dados">
                versão {String(versao.numero)} · {String(versao.blocos)} blocos · {String(versao.secoes)} seções
                {versao.assets > 0 && ` · ${String(versao.assets)} imagens`} · {versao.motor}
              </p>
              {(versao.resumo_dos_limites ?? []).length > 0 && (
                <ul className="limites resumo-dos-limites">
                  {(versao.resumo_dos_limites ?? []).map((item) => <li key={`${item.nivel}-${item.codigo}-${item.mensagem}`} data-nivel={item.nivel}>{item.mensagem}</li>)}
                </ul>
              )}
              {versao.limites.length > 0 && (
                // O texto técnico do motor, recolhido: o resumo acima é o que importa a quem lê.
                <details className="mais-limites">
                  <summary>Detalhes técnicos ({versao.limites.length})</summary>
                  <ul className="limites">
                    {versao.limites.slice(0, LIMITES_VISIVEIS).map((limite, posicao) => <li key={`${String(posicao)}-${limite}`}>{limite}</li>)}
                    {versao.limites.length > LIMITES_VISIVEIS && <li>… e mais {versao.limites.length - LIMITES_VISIVEIS}</li>}
                  </ul>
                </details>
              )}
            </section>
          )}

          {camadas.length > 0 && (
            <section className="card">
              <span className="eyebrow">Camadas de leitura</span>
              <ul className="limites">{agruparLeituras(camadas).map((c) => <li key={c.id}>{c.rotulo}</li>)}</ul>
            </section>
          )}

          {documento.execucoes.length > 0 && (
            <section className="card">
              <span className="eyebrow">Execuções</span>
              <ul className="limites">
                {documento.execucoes.map((execucao) => (
                  <li key={execucao.id}>
                    {execucao.modelo} · {execucao.esforco} · {String(execucao.partes_prontas)} de {String(execucao.partes_total)} partes
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(documento.jobs.length > 0 || emPausa) && (
            <section className="card">
              <span className="eyebrow">Trabalhos</span>
              <ul className="limites">
                {documento.preparacao_em_pausa === true && <li data-pausa="">
                  Análise pedida antes · em pausa, esperando você
                  <Button type="button" disabled={operando} onClick={() => retomarDaPausa(`preparacao:${documento_id}`)}>Retomar</Button>
                </li>}
                {documento.jobs.map((job) => (
                  <li key={job.id} data-avisos={(job.avisos?.length ?? 0) > 0 ? '' : undefined} data-pausa={job.em_pausa === true ? '' : undefined}>
                    {job.tipo} · {job.em_pausa === true ? 'em pausa, esperando você' : (job.avisos?.length ?? 0) > 0 ? 'concluído com avisos' : job.estado}
                    {job.error_code !== null && ` · ${job.error_code}`}
                    {job.not_before !== null && ` · retoma em ${job.not_before}`}
                    {job.em_pausa === true && <Button type="button" disabled={operando} onClick={() => retomarDaPausa(job.id)}>Retomar</Button>}
                    {['fila', 'reservado', 'adiado'].includes(job.estado) && <Button type="button" disabled={operando} onClick={() => void operacao(`/api/jobs/${job.id}/cancelar`)}>Cancelar</Button>}
                    {['falhou', 'cancelado'].includes(job.estado) && <Button type="button" disabled={operando} onClick={() => void operacao(`/api/jobs/${job.id}/reenfileirar`)}>Reenfileirar</Button>}
                    {(job.avisos?.length ?? 0) > 0 && <ul className="avisos-do-trabalho">{job.avisos?.map((aviso) => <li key={aviso.codigo}>{aviso.mensagem}</li>)}</ul>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>      </Drawer>}
    </article>
  );
}
