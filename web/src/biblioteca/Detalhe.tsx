import { ComparacaoDeVersoes } from './ComparacaoDeVersoes';
import { Button, IconButton, Popover, Drawer } from '../ui/Primitives';
import { PrepararLeitura, PrimeiroEuDoDocumento } from './Operacoes';
import type { CamadaResumida } from '../leitor/f2';
import { rotuloCamada } from '../leitor/f2';
import { criarCompreensao, escrever, gravarPreferenciasDoDocumento, pedir, type OpcoesDeLeitura } from './api';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Esqueleto } from '../ui/Esqueleto';
import { Icon } from '../ui/Icon';
import { arvoreDaVersao, lerProgresso, obterDocumento, prepararMarcas } from './api';
import { fraseDoEstado, frasesDasMarcas } from './estado';
import type { Rota } from './rotas';
import type { DetalheDoDocumento } from './tipos';
import { rotuloDoDocumento, tipoDoDocumento } from './tipos';
import { TipoDoDocumento } from '../ui/TipoDoDocumento';
import { ProducaoDoDocumento } from './ProducaoDoDocumento';
import { EnviarParaObsidian } from './EnviarParaObsidian';
import { pedirFlashcardsComAviso } from '../flashcards/api';

export interface CapitulosDoDocumento {
  capitulos: { id: string; titulo: string }[];
  concluidos: string[];
}

export interface PropsDoDetalhe {
  documento_id: string;
  ir: (destino: Rota) => void;
  carregar?: (id: string) => Promise<DetalheDoDocumento>;
  preparar?: (id: string, opcoes?: OpcoesDeLeitura) => Promise<{ execucao_id: string; partes: number }>;
  /** Capítulos e progresso; sem ela (ou se falhar) o detalhe mostra só o resto. */
  capitulos?: (documento: DetalheDoDocumento) => Promise<CapitulosDoDocumento>;
}

/** Uma canonização de PDF grande lista centenas de limites; os primeiros bastam de saída. */
const LIMITES_VISIVEIS = 4;

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

export function Detalhe({
  documento_id, ir, carregar = obterDocumento, preparar = prepararMarcas, capitulos = capitulosDaApi,
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
  const [preparacao, abrirPreparacao] = useState(false);
  const [operando, operar] = useState(false);
  const [aviso, definirAviso] = useState<string | null>(null);

  const recarregar = useCallback(() => carregar(documento_id).then(definir, (falha: unknown) => {
    definirErro(falha instanceof Error ? falha.message : 'falha ao carregar');
  }), [carregar, documento_id]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  const versaoId = documento?.versao_id ?? null;
  useEffect(() => {
    if (documento === null || versaoId === null) return;
    let vivo = true;
    capitulos(documento).then(
      (resposta) => { if (vivo) definirIndice(resposta); },
      () => { /* sem índice: o detalhe continua útil sem ele */ },
    );
    return () => { vivo = false; };
    // O índice depende da versão, não de cada recarga do documento.
  }, [versaoId, capitulos]);

  useEffect(() => {
    if (!versaoId) return;
    let vivo = true;
    void pedir<{ camadas: CamadaResumida[] }>(`/api/documentos/${documento_id}/camadas`).then((r) => { if (vivo) definirCamadas(r.camadas ?? []); }, () => {});
    return () => { vivo = false; };
  }, [documento_id, versaoId]);

  if (erro !== null) return <p className="empty" role="alert">Não foi possível abrir o documento: {erro}</p>;
  if (documento === null) return <Esqueleto />;
  const versao = documento.versoes[0];
  // PDF escaneado: as páginas sem camada de texto podem ser transcritas por visão (job do worker).
  const semTexto = documento.formato === 'pdf' ? documento.paginas_sem_texto ?? 0 : 0;
  const concluidos = new Set(indice?.concluidos ?? []);
  // Um texto sem capítulos (artigo, ensaio, texto colado) não tem índice: lê-se de uma vez.
  const textoUnico = indice !== null && indice.capitulos.length === 1;
  const lido = textoUnico && concluidos.size > 0;
  // Vídeo se assiste, áudio se ouve; o resto se lê.
  const verbo = documento.midia?.tipo === 'video'
    ? { uma: 'Assistir', de_novo: 'Assistir de novo', continuar: 'Continuar assistindo', comecar: 'Começar a assistir' }
    : documento.midia?.tipo === 'audio'
      ? { uma: 'Ouvir', de_novo: 'Ouvir de novo', continuar: 'Continuar ouvindo', comecar: 'Começar a ouvir' }
      : { uma: 'Ler', de_novo: 'Reler', continuar: 'Continuar de onde parei', comecar: 'Começar a ler' };
  const lerCapitulo = (secao_id?: string) => {
    ir(secao_id === undefined
      ? { nome: 'leitura', documento_id: documento.id }
      : { nome: 'leitura', documento_id: documento.id, secao_id });
  };

  /** A compreensão vira a camada padrão: abrir um capítulo o prepara, com o seguinte em segundo plano. */
  async function aoCompreender(modo: { id: string; revisao: number }): Promise<void> {
    const { compreensao } = await criarCompreensao(documento_id, modo);
    await gravarPreferenciasDoDocumento(documento_id, { camada_padrao: compreensao.id });
    definirAviso(textoUnico
      ? 'Compreensão criada. O texto é preparado quando você o abre.'
      : 'Compreensão criada. Cada capítulo é preparado quando você o abre, e o seguinte em segundo plano.');
  }
  async function aoPreparar(opcoes: OpcoesDeLeitura): Promise<void> {
    definirAviso(null);
    try {
      const resposta = await preparar(documento_id, opcoes);
      definirAviso(`Leitura enfileirada em ${String(resposta.partes)} parte(s).`);
      await recarregar();
    } catch (falha: unknown) {
      throw falha;
    }
  }

  async function operacao(caminho: string): Promise<void> {
    if (operando) return;
    operar(true); definirAviso(null);
    try { await escrever(caminho, {}); await recarregar(); }
    catch (falha) { definirAviso(falha instanceof Error ? falha.message : 'Não foi possível concluir a operação.'); }
    finally { operar(false); }
  }

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
        <div className="button-row">
          {documento.texto_disponivel && (
            <a
              className="button primary"
              href={`/ler/${documento.id}`}
              onClick={(evento) => { evento.preventDefault(); lerCapitulo(); }}
            >
              {textoUnico ? (lido ? verbo.de_novo : verbo.uma) : concluidos.size > 0 || documento.progresso ? verbo.continuar : verbo.comecar}
            </a>
          )}
          {documento.versao_id !== null && (
            <a className="button" href={`/documentos/${documento.id}/notas`} onClick={(evento) => { evento.preventDefault(); ir({ nome: 'notas', documento_id: documento.id }); }}>
              <Icon name="caderno" size={18} /> Notas
            </a>
          )}
          {documento.versao_id !== null && (
            <a className="button" href={`/documentos/${documento.id}/exercicios`} onClick={(evento) => { evento.preventDefault(); ir({ nome: 'exercicios', documento_id: documento.id }); }}>
              <Icon name="resolver" size={18} /> Exercícios
            </a>
          )}
          {documento.versao_id !== null && (
            <a className="button" href={`/documentos/${documento.id}/flashcards`} onClick={(evento) => { evento.preventDefault(); ir({ nome: 'flashcards', documento_id: documento.id }); }}>
              <Icon name="cartoes" size={18} /> Flashcards
            </a>
          )}
          {documento.texto_disponivel && (
            <Button type="button" className="button" onClick={() => abrirPreparacao(!preparacao)}>
              <Icon name="spark" size={18} /> Preparar leitura
            </Button>
          )}
        <div className="operacoes-documento">
          <IconButton ref={botaoMenu} aria-label="Opções do documento" aria-expanded={menu} onClick={() => abrirMenu(!menu)}>•••</IconButton>
          {menu && <Popover ancora={botaoMenu} rotulo="Opções do documento" aoFechar={() => abrirMenu(false)} className="formulario">
            <div><span className="eyebrow">Marcas por função</span><p className="dados">{frasesDasMarcas(documento).map((frase) => frase.replace(' ', '\u00a0')).join(' · ') || `${documento.marcas.total} marcas`}</p></div>
            {documento.versao_id && <PrimeiroEuDoDocumento documentoId={documento_id} />}
            <Button variante="ghost" disabled={operando} onClick={() => void operacao(`/api/documentos/${documento_id}/${documento.arquivado_em ? 'desarquivar' : 'arquivar'}`)}>{documento.arquivado_em ? 'Desarquivar' : 'Arquivar'}</Button>
            {documento.versao_id && textoUnico && indice?.capitulos[0] && <Button variante="ghost" onClick={() => {
              const versao = documento.versao_id; const secao = indice.capitulos[0]?.id;
              abrirMenu(false);
              if (versao && secao) void pedirFlashcardsComAviso(versao, secao).then(definirAviso);
            }}>Criar flashcards</Button>}
            {documento.versao_id && <Button variante="ghost" onClick={() => { abrirMenu(false); abrirObsidian(true); }}>Enviar para o Obsidian</Button>}
            {documento.versoes.length > 1 && <Button variante="ghost" onClick={() => { abrirMenu(false); abrirComparacao(true); }}>Comparar versões</Button>}
            <Button variante="ghost" onClick={() => { abrirMenu(false); abrirDiagnostico(true); }}>Diagnóstico</Button>
          </Popover>}
        </div>
        </div>
        {semTexto > 0 && documento.estado !== 'transcrevendo' && (
          <p className="aviso">
            {semTexto === 1 ? '1 página sem texto' : `${String(semTexto)} páginas sem texto`} —{' '}
            <Button variante="ghost" disabled={operando} onClick={() => void operacao(`/api/documentos/${documento_id}/transcrever`)}>transcrever</Button>
          </p>
        )}
        {preparacao && <PrepararLeitura preparar={aoPreparar} compreender={aoCompreender} textoUnico={textoUnico} aoFechar={() => abrirPreparacao(false)} />}
        {aviso !== null && <p className="aviso">{aviso}</p>}
      </section>

      <div className="detalhe-grade">
        {indice !== null && <ProducaoDoDocumento documento={documento} capitulos={indice.capitulos} concluidos={concluidos} camadas={camadas} ir={ir} />}


      </div>
      {obsidian && <Drawer rotulo="Enviar para o Obsidian" aoFechar={() => abrirObsidian(false)}><EnviarParaObsidian documentoId={documento.id} /></Drawer>}
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
              {versao.limites.length > 0 && (
                <ul className="limites">
                  {versao.limites.slice(0, LIMITES_VISIVEIS).map((limite, posicao) => <li key={`${String(posicao)}-${limite}`}>{limite}</li>)}
                </ul>
              )}
              {versao.limites.length > LIMITES_VISIVEIS && (
                <details className="mais-limites">
                  <summary>mais {versao.limites.length - LIMITES_VISIVEIS} limites</summary>
                  <ul className="limites">
                    {versao.limites.slice(LIMITES_VISIVEIS).map((limite, posicao) => <li key={`${String(posicao)}-${limite}`}>{limite}</li>)}
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

          {documento.jobs.length > 0 && (
            <section className="card">
              <span className="eyebrow">Trabalhos</span>
              <ul className="limites">
                {documento.jobs.map((job) => (
                  <li key={job.id}>
                    {job.tipo} · {job.estado}
                    {job.error_code !== null && ` · ${job.error_code}`}
                    {job.not_before !== null && ` · retoma em ${job.not_before}`}
                    {['fila', 'reservado', 'adiado'].includes(job.estado) && <Button type="button" disabled={operando} onClick={() => void operacao(`/api/jobs/${job.id}/cancelar`)}>Cancelar</Button>}
                    {['falhou', 'cancelado'].includes(job.estado) && <Button type="button" disabled={operando} onClick={() => void operacao(`/api/jobs/${job.id}/reenfileirar`)}>Reenfileirar</Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>      </Drawer>}
    </article>
  );
}
