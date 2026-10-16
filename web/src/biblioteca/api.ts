/**
 * Cliente da API. Mesma origem, sempre com o cabeçalho `X-Margem` nas escritas —
 * é a proteção simples contra escrita vinda de outra página.
 */
import type { MarcaV1, ProgressoV1 } from '@margem/contratos';
import type { RespostaDoProgresso } from '../leitor/hooks/useProgresso';
import type { MudancaDeMarca } from '../leitor/notas';
import type {
  ArvoreDaVersao, DetalheDoDocumento, FiltroDeTipoDaCentral, ItemDaBiblioteca, ItemDeNota, PaginaDaCentral, ProgressoPersistido, RespostaDaBusca, SnapshotDoCapitulo,
} from './tipos';

export const CABECALHO_MARGEM = 'X-Margem';

export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    readonly detalhe?: string,
    /** Corpo da resposta: o `409` do progresso traz junto o progresso atual do servidor. */
    readonly corpo?: unknown,
  ) {
    super(detalhe ?? codigo);
    this.name = 'ErroDaApi';
  }
}

export async function pedir<T>(caminho: string, inicio?: RequestInit): Promise<T> {
  const escrita = inicio?.method !== undefined && inicio.method !== 'GET';
  const resposta = await fetch(caminho, {
    ...inicio,
    headers: { ...(escrita ? { [CABECALHO_MARGEM]: '1' } : {}), ...(inicio?.headers ?? {}) },
  });
  const texto = await resposta.text();
  let corpo: unknown = null;
  // Um 413 do proxy chega em HTML: o erro continua sendo da API, com o status real.
  try { corpo = texto === '' ? null : JSON.parse(texto); } catch (falha) { if (resposta.ok) throw falha; }
  if (!resposta.ok) {
    const erro = corpo as { erro?: string; detalhe?: string } | null;
    throw new ErroDaApi(resposta.status, erro?.erro ?? (resposta.statusText || 'falha'), erro?.detalhe, corpo);
  }
  return corpo as T;
}

/**
 * Baixa a cópia do PDF original com os grifos e notas como anotações padrão. Devolve quantas
 * marcas ou notas ficaram de fora por não terem posição no PDF (`X-Margem-Sem-Geometria`).
 */
export async function baixarPdfAnotado(versaoId: string): Promise<{ semGeometria: number }> {
  const resposta = await fetch(`/api/versoes/${versaoId}/pdf-anotado`);
  if (!resposta.ok) throw new ErroDaApi(resposta.status, 'falha', 'Não foi possível gerar o PDF anotado.');
  // O nome vem do servidor (título do documento); o link de blob precisa dele em `download`.
  const codificado = /filename\*=UTF-8''([^;]+)/.exec(resposta.headers.get('content-disposition') ?? '')?.[1];
  let nome = 'anotado.pdf';
  try { if (codificado) nome = decodeURIComponent(codificado); } catch { /* fica o nome genérico */ }
  const url = URL.createObjectURL(await resposta.blob());
  const link = document.createElement('a');
  link.href = url; link.download = nome;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { semGeometria: Number(resposta.headers.get('x-margem-sem-geometria') ?? 0) || 0 };
}

export function listarDocumentos(arquivados = false): Promise<{ documentos: ItemDaBiblioteca[] }> {
  return pedir(`/api/documentos${arquivados ? '?arquivados=1' : ''}`);
}

export function obterDocumento(id: string): Promise<DetalheDoDocumento> {
  return pedir(`/api/documentos/${id}`);
}

export function adicionarDocumento(formulario: FormData): Promise<{ documento_id: string; job_id: string }> {
  return pedir('/api/documentos', { method: 'POST', body: formulario });
}

/** Leitura antiga (F1/V2): fica para ferramentas e testes; a interface usa `prepararLeitura`. */
export function prepararMarcas(id: string, opcoes: OpcoesDeLeitura = {}): Promise<{ execucao_id: string; partes: number }> {
  return pedir(`/api/documentos/${id}/leituras`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opcoes),
  });
}

/** `bloco`: a resposta diz também em que capítulo ele está (`capitulo_do_bloco`), para retomar a leitura ali. */
export function arvoreDaVersao(versaoId: string, bloco?: string): Promise<ArvoreDaVersao> {
  return pedir(`/api/versoes/${versaoId}/secoes${bloco ? `?bloco=${encodeURIComponent(bloco)}` : ''}`);
}

export function capituloDaVersao(versaoId: string, secaoId: string, camada?: string): Promise<SnapshotDoCapitulo> {
  return pedir(`/api/versoes/${versaoId}/capitulos/${secaoId}${camada ? `?camada=${encodeURIComponent(camada)}` : ''}`);
}

/** Busca no texto de toda a biblioteca (só a última versão de cada documento não arquivado). */
export function buscarNaBiblioteca(consulta: string, sinal?: AbortSignal): Promise<RespostaDaBusca> {
  return pedir(`/api/busca?q=${encodeURIComponent(consulta)}`, sinal ? { signal: sinal } : undefined);
}

/** Busca no texto de um documento inteiro, na ordem do texto. */
export function buscarNoDocumento(documentoId: string, consulta: string, sinal?: AbortSignal): Promise<RespostaDaBusca> {
  return pedir(`/api/documentos/${documentoId}/busca?q=${encodeURIComponent(consulta)}`, sinal ? { signal: sinal } : undefined);
}

export function lerProgresso(documentoId: string): Promise<{ progresso: ProgressoPersistido | null }> {
  return pedir(`/api/documentos/${documentoId}/progresso`);
}

interface ConflitoDeProgresso {
  erro?: string;
  revisao_atual?: number;
  progresso?: ProgressoPersistido | null;
}

/**
 * Revisão otimista: o `409` do serviço devolve o progresso mais recente e este cliente o
 * entrega ao chamador sem regravar nada por cima.
 */
export async function salvarProgresso(
  documentoId: string, progresso: ProgressoV1,
): Promise<RespostaDoProgresso> {
  try {
    const resposta = await pedir<{ progresso: ProgressoPersistido }>(
      `/api/documentos/${documentoId}/progresso`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(progresso) },
    );
    return { estado: 'gravado', progresso: resposta.progresso };
  } catch (falha: unknown) {
    if (falha instanceof ErroDaApi && falha.status === 409) {
      const conflito = falha.corpo as ConflitoDeProgresso | null;
      return { estado: 'obsoleto', progresso: conflito?.progresso ?? null };
    }
    return { estado: 'erro' };
  }
}

interface RespostaDaMarca {
  estado: 'aplicado' | 'recusado';
  motivo?: string;
  marca: MarcaV1 | null;
  revisao_marcas: string;
}

/** `PATCH /api/marcas/:id`: exatamente um campo por vez, como o serviço exige. */
export async function atualizarMarca(marcaId: string, mudanca: MudancaDeMarca): Promise<MarcaV1 | null> {
  const resposta = await pedir<RespostaDaMarca>(`/api/marcas/${marcaId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mudanca),
  });
  if (resposta.estado === 'recusado') throw new ErroDaApi(409, 'marca_recusada', resposta.motivo);
  return resposta.marca;
}

export interface OpcoesDeLeitura { modo_de_leitura?: { id: string; revisao: number }; nivel_de_atencao?: 1 | 2 | 3 }
export function escrever<T>(caminho: string, corpo: unknown, method = 'POST'): Promise<T> {
  return pedir(caminho, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
}
export const obterModos = () => pedir<{ modos: import('@margem/contratos').ModoDeLeituraV1[] }>('/api/modos');
export const preferenciasDoDocumento = (id: string) => pedir<{ preferencias: { primeiro_eu: boolean; camada_padrao: string | null } }>(`/api/documentos/${id}/camadas`);
export const gravarPreferenciasDoDocumento = (id: string, valores: { primeiro_eu?: boolean; camada_padrao?: string | null }) => escrever(`/api/documentos/${id}/preferencias`, valores, 'PUT');

// ---------------------------------------------------------------- compreensão do capítulo (J31)

export type EstadoVisivelDaCompreensao = 'nao_preparado' | 'preparando' | 'pronto' | 'falhou';
export interface CapituloDaCompreensao { secao_id: string; titulo: string; estado: string; visivel: EstadoVisivelDaCompreensao; revisao: number | null; plano_id: string | null }
export interface DetalheDoCapituloDaCompreensao {
  estado: string;
  visivel: EstadoVisivelDaCompreensao;
  modelo: import('@margem/contratos').ModeloDoCapituloV1 | null;
  plano: import('@margem/contratos').PlanoPedagogicoV1 | null;
  plano_do_perfil_atual: boolean;
}
export interface RelacaoDoCapitulo {
  relacao: import('@margem/contratos').RelacaoSemanticaV1;
  relevante: boolean;
  origem?: import('@margem/contratos').ElementoSemanticoV1;
  destino?: import('@margem/contratos').ElementoSemanticoV1;
  conexao_id: string | null;
}
// ---------------------------------------------------------------- "Preparar leitura" (v0.1)

export type EstadoDaPreparacao = 'sem_texto' | 'nao_preparada' | 'identificando' | 'preparando' | 'pronta' | 'parcial' | 'falhou';
/** O tipo do texto como a página mostra ("Conto · Literatura"): detectado pelo Codex ou escolhido. */
export interface TipoDaPreparacao {
  tipo_id: string; rotulo: string; grupo: string; origem: 'detectado' | 'escolhido';
  confianca: 'alta' | 'media' | 'baixa' | null; justificativa: string | null; alternativas: { tipo_id: string; rotulo: string }[];
}
export interface CapituloDaPreparacao { secao_id: string; titulo: string; estado: EstadoVisivelDaCompreensao; etapa: string; relacoes: number | null }
export interface SituacaoDaPreparacao {
  documento_id: string;
  versao_id: string | null;
  estado: EstadoDaPreparacao;
  tipo: TipoDaPreparacao | null;
  compreensao: { id: string; modo: { id: string; revisao: number } } | null;
  capitulos: CapituloDaPreparacao[];
  erro: { codigo: string; mensagem: string } | null;
  /** Itens pedidos além de grifos e relações, com o andamento (pelos jobs). */
  itens: ProgressoDoItem[];
}
export interface ProgressoDoItem { id: string; rotulo: string; estado: 'aguardando' | 'preparando' | 'pronto' | 'falhou'; prontos: number; total: number }
export interface ItemDaPreparacao { id: string; rotulo: string; descricao: string; disponivel: boolean; ao_importar: boolean; requer: string[] }
export interface PadraoDaPreparacao { ao_importar: boolean; itens: string[] }
export interface CatalogoDaPreparacao { itens: ItemDaPreparacao[]; padrao: PadraoDaPreparacao }
/** O que "Preparar leitura" pode criar e o padrão das Configurações. */
export const catalogoDaPreparacao = () => pedir<CatalogoDaPreparacao>('/api/preparacao/itens');
export const gravarPadraoDaPreparacao = (padrao: PadraoDaPreparacao) => escrever<CatalogoDaPreparacao>('/api/configuracoes/preparacao', padrao, 'PUT');
/** Exercícios do livro: descobre e cria os pedidos; depois manda até 50 ao Codex. */
export async function pedirExercicios(documentoId: string): Promise<number> {
  const descoberta = await escrever<{ total: number }>(`/api/documentos/${documentoId}/exercicios/descobrir`, { criar: true });
  if (descoberta.total === 0) return 0;
  const { disparados } = await escrever<{ disparados: number }>(`/api/documentos/${documentoId}/exercicios/disparar`, { limite: 50 });
  return disparados;
}
export interface RespostaDaPreparacao {
  compreensao_id: string | null; criada: boolean; enfileirados: number; devolvidos: number; aguardando_tipo: boolean; situacao: SituacaoDaPreparacao;
}
export const situacaoDaPreparacao = (documentoId: string) => pedir<SituacaoDaPreparacao>(`/api/documentos/${documentoId}/preparacao`);
/** Grupos e tipos de texto, lidos do contrato (`contratos/tipos-de-texto.json`). */
export const tiposDeTexto = () => pedir<{ tipos: import('@margem/contratos').TiposDeTextoV1 }>('/api/tipos-de-texto');
/** A escolha da pessoa: nenhuma detecção a substitui. Se uma leitura esperava pelo tipo, ela começa. */
export const escolherTipoDeTexto = (documentoId: string, tipoId: string) =>
  escrever<SituacaoDaPreparacao>(`/api/documentos/${documentoId}/tipo-de-texto`, { tipo_id: tipoId }, 'PUT');
/** Um clique: cria ou reaproveita a compreensão e enfileira já; de novo depois de uma falha, tenta de novo. */
export const prepararLeitura = (documentoId: string, todos = false, itens?: readonly string[]) =>
  escrever<RespostaDaPreparacao>(`/api/documentos/${documentoId}/preparacao`, { ...(todos ? { todos: true } : {}), ...(itens ? { itens } : {}) });

// ---------------------------------------------------------------- "Analisar" por tipo (J142)

/** No vídeo: o que aconteceu com a transcrição e com as partes e os momentos (os popups). */
export interface SituacaoDoVideo {
  midia_id: string | null;
  transcricao: { estado: 'sem_transcricao' | 'sem_sincronia' | 'original' | 'passando_a_limpo' | 'limpa' | 'falhou' | 'sem_limpeza'; detalhe: string | null };
  momentos: { estado: 'nao_preparado' | 'preparando' | 'pronto' | 'falhou' | 'sem_fala'; quantidade: number; partes: number };
  aguardando_transcricao: boolean;
}
/** A situação da preparação e, nos documentos de vídeo, `video`; nos outros, `video: null`. */
export interface SituacaoDaAnalise extends SituacaoDaPreparacao { video: SituacaoDoVideo | null }
export interface RespostaDaAnalise extends Omit<RespostaDaPreparacao, 'situacao'> { aguardando_transcricao: boolean; situacao: SituacaoDaAnalise }
export const situacaoDaAnalise = (documentoId: string) => pedir<SituacaoDaAnalise>(`/api/documentos/${documentoId}/analise`);
/**
 * O botão "Analisar" da página do documento: uma rota só, e o serviço decide pelo tipo. Texto: grifos,
 * relações e o que estiver marcado; vídeo: a transcrição passada a limpo, grifos e relações, e as partes e
 * os momentos sobre o vídeo.
 */
export const analisarDocumento = (documentoId: string, todos = false, itens?: readonly string[]) =>
  escrever<RespostaDaAnalise>(`/api/documentos/${documentoId}/analise`, { ...(todos ? { todos: true } : {}), ...(itens ? { itens } : {}) });

export const compreensoesDoDocumento = (documentoId: string) =>
  pedir<{ versao_id: string; compreensoes: import('@margem/contratos').ExecucaoCompreensaoV1[] }>(`/api/documentos/${documentoId}/compreensoes`);
export const criarCompreensao = (documentoId: string, modo: { id: string; revisao: number }) =>
  escrever<{ compreensao: import('@margem/contratos').ExecucaoCompreensaoV1 }>(`/api/documentos/${documentoId}/compreensoes`, { modo_de_leitura: modo });
export const capitulosDaCompreensao = (id: string) => pedir<{ capitulos: CapituloDaCompreensao[] }>(`/api/compreensoes/${id}/capitulos`);
/** `tentarDeNovo` devolve à fila os jobs do capítulo que falharam antes de avançar. */
export const prepararCapituloDaCompreensao = (id: string, secaoId: string, prefetch = true, tentarDeNovo = false) =>
  escrever<{ estado: string; visivel: EstadoVisivelDaCompreensao; seguinte: string | null }>(`/api/compreensoes/${id}/capitulos/${secaoId}/preparar`,
    tentarDeNovo ? { prefetch, tentar_de_novo: true } : { prefetch });
export const capituloDaCompreensao = (id: string, secaoId: string) => pedir<DetalheDoCapituloDaCompreensao>(`/api/compreensoes/${id}/capitulos/${secaoId}`);
export const relacoesDoCapitulo = (id: string, secaoId: string, filtro: 'relevantes' | 'todas', modeloId?: string) =>
  pedir<{ relacoes: RelacaoDoCapitulo[] }>(`/api/compreensoes/${id}/capitulos/${secaoId}/relacoes?filtro=${filtro}${modeloId ? `&modelo_id=${encodeURIComponent(modeloId)}` : ''}`);
export const adotarRelacao = (id: string, secaoId: string, relacaoId: string) =>
  escrever<{ conexao_id: string; criada: boolean }>(`/api/compreensoes/${id}/capitulos/${secaoId}/relacoes/${relacaoId}/adotar`, {});
// ---------------------------------------------------------------- esquema do capítulo (mapa esquemático)

export type EstadoDoEsquema = 'nenhum' | 'pendente' | 'executando' | 'pronto' | 'falhou';
export interface SituacaoDoEsquema {
  estado: EstadoDoEsquema;
  pedido_id: string | null;
  motivo?: string;
  aviso?: string;
  /** O esquema pronto mais recente (continua servido enquanto um novo é gerado ou depois de uma falha). */
  esquema: import('@margem/contratos').EsquemaDoCapituloV1 | null;
}
export const esquemaDoCapitulo = (id: string, secaoId: string) => pedir<SituacaoDoEsquema>(`/api/compreensoes/${id}/capitulos/${secaoId}/esquema`);
export const gerarEsquema = (id: string, secaoId: string) => escrever<SituacaoDoEsquema>(`/api/compreensoes/${id}/capitulos/${secaoId}/esquema`, {});
// ---------------------------------------------------------------- visita guiada (J91)

export type EstadoDaVisita = 'nao_preparada' | 'preparando' | 'pronta' | 'falhou';
export interface DetalheDaVisita {
  estado: EstadoDaVisita;
  roteiro: import('@margem/contratos').RoteiroGuiadoV1 | null;
  narracao: import('@margem/contratos').NarracaoDaVisitaV1 | null;
}
export const visitaDoCapitulo = (id: string, secaoId: string) => pedir<DetalheDaVisita>(`/api/compreensoes/${id}/capitulos/${secaoId}/visita`);
export const prepararVisita = (id: string, secaoId: string) => escrever<DetalheDaVisita>(`/api/compreensoes/${id}/capitulos/${secaoId}/visita`, {});
export const arquivoDaNarracao = (id: string): string => `/api/narracoes-visita/${id}/arquivo`;

// ---------------------------------------------------------------- leitura comentada (J92)

export type EstadoDaLeituraComentada = 'nao_preparada' | 'preparando' | 'pronta' | 'falhou';
export interface DetalheDaLeituraComentada {
  estado: EstadoDaLeituraComentada;
  leitura: import('@margem/contratos').LeituraComentadaV1 | null;
  narracao: import('@margem/contratos').NarracaoDaLeituraV1 | null;
}
export const leituraComentadaDoCapitulo = (id: string, secaoId: string) => pedir<DetalheDaLeituraComentada>(`/api/compreensoes/${id}/capitulos/${secaoId}/leitura-comentada`);
export const prepararLeituraComentada = (id: string, secaoId: string) => escrever<DetalheDaLeituraComentada>(`/api/compreensoes/${id}/capitulos/${secaoId}/leitura-comentada`, {});
export const arquivoDaNarracaoDaLeitura = (id: string): string => `/api/narracoes-leitura/${id}/arquivo`;
export const obterPerfil = () => pedir<{ perfil: import('@margem/contratos').PerfilDoLeitorV1 | null; hash: string }>('/api/perfil');
export const gravarPerfil = (perfil: Pick<import('@margem/contratos').PerfilDoLeitorV1, 'areas' | 'preferencias' | 'observacoes'>) =>
  escrever<{ perfil: import('@margem/contratos').PerfilDoLeitorV1; hash: string }>('/api/perfil', perfil, 'PUT');

// ---------------------------------------------------------------- resolução de exercícios (J34)

/** `pendente`: pedido criado na descoberta dos exercícios de um livro, ainda não enviado ao Codex. */
export type EstadoDaResolucao = 'pendente' | 'resolvendo' | 'pronta' | 'respondendo' | 'falhou';
export interface SessaoDaApi {
  resolucao: import('@margem/contratos').ResolucaoV2;
  estado: EstadoDaResolucao;
  jobs?: { id: string; tipo: string; estado: string }[];
}
export type OrigemDoPedido =
  | { tipo: 'recorte'; pagina: number; retangulo: { x: number; y: number; largura: number; altura: number }; imagem_png: string }
  | { tipo: 'trecho'; ancora: import('@margem/contratos').AncoraV1 };
export const criarResolucao = (documentoId: string, origem: OrigemDoPedido, texto_extraido: string) =>
  escrever<SessaoDaApi & { job_id: string }>(`/api/documentos/${documentoId}/resolucoes`, { origem, texto_extraido });
export const resolucoesDoDocumento = (documentoId: string) => pedir<{ resolucoes: SessaoDaApi[] }>(`/api/documentos/${documentoId}/resolucoes`);
export const obterResolucao = (id: string) => pedir<SessaoDaApi>(`/api/resolucoes/${id}`);
export const perguntarNaResolucao = (id: string, texto: string) => escrever<SessaoDaApi>(`/api/resolucoes/${id}/perguntas`, { texto });
export const removerResolucao = (id: string) => pedir<null>(`/api/resolucoes/${id}`, { method: 'DELETE' });
export const tentarDeNovo = (jobId: string) => escrever<unknown>(`/api/jobs/${jobId}/reenfileirar`, {});
/** Pendente: manda ao Codex; falhou: tenta de novo; pronta: refaz numa sessão nova (a antiga sai). */
export const resolverExercicio = (id: string) => escrever<SessaoDaApi & { job_id: string }>(`/api/resolucoes/${id}/resolver`, {});

/** Um exercício na página de exercícios: a sessão, o estado e onde está no livro. */
export interface ExercicioDaLista extends SessaoDaApi { secao_id: string | null; capitulo: string; secao: string | null; numero: string | null }
export interface ExerciciosDoDocumento {
  documento: { id: string; titulo: string; autor: string | null; formato: string };
  exercicios: ExercicioDaLista[];
}
export const exerciciosDoDocumento = (documentoId: string) => pedir<ExerciciosDoDocumento>(`/api/documentos/${documentoId}/exercicios`);
/** O LaTeX (`.tex`) ou o PDF compilado; `capitulo` restringe a um capítulo e `pendentes` inclui os ainda sem resolução. */
export function exportacaoDosExercicios(documentoId: string, formato: 'tex' | 'pdf', filtro: { capitulo?: string; pendentes?: boolean } = {}): string {
  const consulta = new URLSearchParams();
  if (filtro.capitulo) consulta.set('capitulo', filtro.capitulo);
  if (filtro.pendentes) consulta.set('pendentes', '1');
  return `/api/documentos/${documentoId}/exercicios.${formato}${consulta.size ? `?${consulta.toString()}` : ''}`;
}

// Etiquetas (tags) do leitor sobre marcas e anotações.
type EtiquetaV1 = import('@margem/contratos').EtiquetaV1;
export const etiquetasDaVersao = (versaoId: string) => pedir<{ etiquetas: EtiquetaV1[]; sugestoes: string[] }>(`/api/versoes/${versaoId}/etiquetas`);
export const criarEtiqueta = (versaoId: string, alvo: EtiquetaV1['alvo'], nome: string) =>
  escrever<{ etiqueta: EtiquetaV1 }>('/api/etiquetas', { versao_id: versaoId, alvo, nome });
export const apagarEtiqueta = (id: string) => pedir<unknown>(`/api/etiquetas/${id}`, { method: 'DELETE' });

// J37: grifos do leitor, função e nota das marcas, revisão de nota pelo Codex.
type MarcaV2 = import('@margem/contratos').MarcaV2;
type AncoraV1 = import('@margem/contratos').AncoraV1;
export const criarGrifo = (ancora: AncoraV1, funcao: string, modo?: { id: string; revisao: number }) =>
  escrever<{ marca: MarcaV2 }>('/api/grifos', { ancora, funcao, ...(modo ? { modo } : {}) });
export const apagarGrifo = (id: string) => pedir<unknown>(`/api/grifos/${id}`, { method: 'DELETE' });
/** `modo` (J138, "Outros olhares"): a função de outro modo; o grifo do leitor passa para aquele modo. */
export const trocarFuncaoDaMarca = (id: string, funcao: string, modo?: { id: string; revisao: number }) =>
  escrever<{ marca: MarcaV2 }>(`/api/marcas/${id}/funcao`, { funcao, ...(modo ? { modo } : {}) }, 'PUT');
/** `texto: null` volta à nota original da IA. */
export const editarNotaDaMarca = (id: string, texto: string | null) => escrever<{ marca: MarcaV2 }>(`/api/marcas/${id}/nota`, { texto }, 'PUT');
export const pedirRevisaoDaNota = (anotacaoId: string, instrucao?: string) =>
  escrever<{ anotacao_id: string; pedido_id: string; job_id: string }>(`/api/anotacoes/${anotacaoId}/revisar`, instrucao ? { instrucao } : {});
export const editarAnotacao = (id: string, mudanca: { texto?: string; tipo?: string; revisao: number }) =>
  escrever<{ anotacao: import('@margem/contratos').AnotacaoV1 }>(`/api/anotacoes/${id}`, mudanca, 'PATCH');
export const apagarAnotacao = (id: string, revisao: number) => escrever<unknown>(`/api/anotacoes/${id}`, { revisao }, 'DELETE');

// J138 (modelo D): a nota do leitor é do grifo; a dificuldade é um sinal à parte.
type NotaDoGrifoV1 = import('@margem/contratos').NotaDoGrifoV1;
type DificuldadeV1 = import('@margem/contratos').DificuldadeV1;
/** Cria ou troca o texto da nota do grifo; `revisao` é a da nota vista (409 se ela mudou em outro lugar). */
export const gravarNotaDoGrifo = (marcaId: string, texto: string, revisao?: number) =>
  escrever<{ nota: NotaDoGrifoV1 }>(`/api/marcas/${marcaId}/nota-do-leitor`, { texto, ...(revisao === undefined ? {} : { revisao }) }, 'PUT');
export const apagarNotaDoGrifo = (marcaId: string, revisao: number) => escrever<unknown>(`/api/marcas/${marcaId}/nota-do-leitor`, { revisao }, 'DELETE');
export const marcarDificuldade = (ancora: AncoraV1, marcaId?: string, tipo?: import('@margem/contratos').TipoDificuldadeTextual) =>
  escrever<{ dificuldade: DificuldadeV1 }>('/api/dificuldades', { ancora, ...(marcaId ? { marca_id: marcaId } : {}), ...(tipo ? { tipo } : {}) });
export const decidirDificuldadeDoCodex = (modeloId: string, dificuldadeId: string, estado: DificuldadeV1['estado']) =>
  escrever<{ dificuldade: DificuldadeV1 }>('/api/dificuldades/codex', { modelo_id: modeloId, dificuldade_id: dificuldadeId, estado });
export const mudarDificuldade = (id: string, mudanca: { estado?: DificuldadeV1['estado']; tipo?: import('@margem/contratos').TipoDificuldadeTextual | null }) =>
  escrever<{ dificuldade: DificuldadeV1 }>(`/api/dificuldades/${id}`, mudanca, 'PATCH');

/** `mostrar`: `com_nota` (só com a nota do leitor) ou `grifos` (só os grifos, sem nota); `funcao` e `modo`: a função de um modo. */
export interface FiltroDeNotas { documento?: string; mostrar?: 'com_nota' | 'grifos'; funcao?: string; modo?: string; texto?: string }

export function consultaDasNotas(filtro: FiltroDeNotas): string {
  const parametros = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtro)) if (typeof valor === 'string' && valor !== '') parametros.set(chave, valor);
  return parametros.size ? `?${parametros}` : '';
}

export function listarNotas(filtro: FiltroDeNotas = {}): Promise<{ itens: ItemDeNota[] }> {
  return pedir(`/api/notas${consultaDasNotas(filtro)}`);
}

/** Central de Notas (J145): o recorte e a página pedidos a `GET /api/notas/central`. */
export interface FiltroDaCentral {
  documento?: string; tipo?: FiltroDeTipoDaCentral; autoria?: 'leitor' | 'codex'; funcao?: string; modo?: string; texto?: string;
  desde?: string; ate?: string; ordem?: 'recentes' | 'antigos' | 'documento'; limite?: number; deslocamento?: number; facetas?: boolean;
}
export function consultaDaCentral(filtro: FiltroDaCentral): string {
  const parametros = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtro)) {
    if (typeof valor === 'string' && valor !== '') parametros.set(chave, valor);
    else if (typeof valor === 'number') parametros.set(chave, String(valor));
    else if (valor === true) parametros.set(chave, '1');
  }
  return parametros.size ? `?${parametros}` : '';
}
export function listarCentral(filtro: FiltroDaCentral = {}): Promise<PaginaDaCentral> {
  return pedir(`/api/notas/central${consultaDaCentral(filtro)}`);
}
