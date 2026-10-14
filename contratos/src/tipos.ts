/** Identificadores atribuídos pelo serviço; a validação em runtime exige ULID. */
export type Id = string;
export type ValorJson = null | boolean | number | string | ValorJson[] | { [chave: string]: ValorJson };
export type Funcao = 'tese' | 'conceito' | 'justificativa' | 'nenhuma';
export interface Comentario {
  tipo: 'AUTOR' | 'LEITURA' | 'INVESTIGAR' | 'OBJECAO' | 'CONEXAO';
  rotulo: string;
  texto: string;
}
export interface Faixa { inicio_utf16: number; fim_utf16: number }
export interface AncoraV1 extends Faixa {
  versao_id: Id;
  bloco_id: Id;
  citacao: string;
  prefixo: string;
  sufixo: string;
}
export type OrigemBloco =
  | { tipo: 'pdf'; pagina: number; impressa?: string; bbox: [number, number, number, number]; inicio?: number; fim?: number }
  | { tipo: 'epub'; arquivo: string; xpath: string }
  | { tipo: 'texto'; linha_inicio: number; linha_fim: number };
export interface Bloco {
  id: Id;
  ordem: number;
  /** `estrofe` é a extensão V1.1: único tipo em que `texto` contém `\n`, um verso por linha. */
  tipo: 'capitulo' | 'secao' | 'paragrafo' | 'lista' | 'citacao' | 'codigo' | 'equacao' | 'figura' | 'tabela' | 'nota_rodape' | 'epigrafe' | 'legenda' | 'estrofe';
  texto: string;
  inline: { inicio: number; fim: number; estilo: 'italico' | 'negrito' | 'codigo' | 'nota_ref'; ref?: Id }[];
  origens: OrigemBloco[];
  asset_id?: Id;
}
export interface Secao {
  id: Id;
  nivel: number;
  titulo: string;
  ordem: number;
  bloco_inicio: Id;
  bloco_fim: Id;
}
export interface CanonicoV1 {
  versao: 1;
  documento: { titulo: string; autor?: string; idioma: string; formato: 'pdf' | 'pdf_foto' | 'epub' | 'md' | 'txt' | 'colado'; sha256_original: string };
  canonizacao: { motor: string; config?: { [chave: string]: ValorJson }; gerado_em: string };
  hash_estrutural: string;
  secoes: Secao[];
  blocos: Bloco[];
  assets: { id: Id; tipo: 'imagem' | 'pagina'; caminho: string; sha256: string; bloco_id?: Id }[];
  limites: string[];
}
export interface ParteV1 {
  id: Id;
  execucao_id: Id;
  ordem: number;
  blocos_responsaveis: Id[];
  blocos_contexto: Id[];
  continuidade_anterior?: string;
  hash_entrada: string;
}
export interface MarcaGeradaV1 {
  bloco_id: Id;
  citacao: string;
  prefixo: string;
  sufixo: string;
  funcao: Funcao;
  sublinhar: string[];
  comentario: Comentario | null;
}
export interface MarcaV1 {
  id: Id;
  ancora: AncoraV1;
  funcao: Funcao;
  subfaixas: Faixa[];
  comentario: Comentario | null;
  origem: 'parte' | 'revisao_consistencia' | 'revisao_cobertura' | 'manual' | 'importacao';
  validade: 'resolvida' | 'ambigua' | 'orfa';
  visivel: boolean;
  avaliacao: 'nao_avaliada' | 'confirmada' | 'rejeitada';
  execucao_id?: Id;
  job_id?: Id;
  criada_em: string;
}
interface OperacaoBase { ordem: number; marca_id: Id; motivo: string }
export type OperacaoRevisao = OperacaoBase & (
  | { op: 'remover'; antes: MarcaV1; depois: Record<string, never> }
  | { op: 'mudar_funcao'; antes: { funcao: Funcao }; depois: { funcao: Funcao } }
  | { op: 'reescrever_comentario'; antes: { comentario: Comentario | null }; depois: { comentario: Comentario } }
  | { op: 'remover_comentario'; antes: { comentario: Comentario | null }; depois: { comentario: null } }
  | { op: 'editar_subfaixas'; antes: { subfaixas: Faixa[] }; depois: { subfaixas: Faixa[] } }
  | { op: 'mudar_visibilidade'; antes: { visivel: boolean }; depois: { visivel: boolean } }
  | { op: 'avaliar'; antes: { avaliacao: MarcaV1['avaliacao'] }; depois: { avaliacao: MarcaV1['avaliacao'] } }
);
export interface LoteRevisaoV1 {
  id: Id;
  execucao_id: Id;
  snapshot_base: string;
  autor: 'codex' | 'claude' | 'pedro';
  motivo_do_lote: string;
  operacoes: OperacaoRevisao[];
}
/** J101: igual à V1, com o autor humano `leitor` no lugar de `pedro`. Versionado pelo nome (sem `versao`). */
export interface LoteRevisaoV2 extends Omit<LoteRevisaoV1, 'autor'> {
  autor: 'codex' | 'claude' | 'leitor';
}
interface JobResultBase {
  job_id: Id;
  attempt: number;
  lease_token: Id;
  diagnosticos: { nivel: 'info' | 'aviso' | 'erro'; codigo: string; mensagem: string }[];
  modelo?: string;
  duracao_ms: number;
}
export type JobResultV1 = JobResultBase & (
  | { estado: 'ok'; artefato: { caminho: string; sha256: string }; not_before?: never }
  | { estado: 'falhou'; artefato?: never; not_before?: never }
  | { estado: 'adiado'; artefato?: never; not_before: string }
);
export interface ProgressoV1 {
  documento_id: Id;
  versao_id: Id;
  ancora: AncoraV1;
  revisao_esperada: number;
  capitulos_concluidos: Id[];
  atualizado_em: string;
}
export interface ExecucaoLeituraV1 {
  id: Id;
  versao_id: Id;
  metodo_versao: string;
  prompt_versao: string;
  schema_versao: 1;
  modelo: string;
  esforco: string;
  tamanho_parte_tokens: number;
  concorrencia: number;
  plano_partes: Id[];
  criada_em: string;
}
/** Espelho do legado, inclusive a permissividade para strings e páginas. */
export interface MarcasLegadoV1 {
  capitulo: string;
  leitura_integral: boolean;
  limites: string[];
  marcas: { id: string; pagina_pdf: number; funcao: Funcao; citacao: string; sublinhar: string[]; comentario: Comentario | null }[];
  recuperacao: { pagina_pdf: number; secao: string; perguntas: string[] }[];
}

// ---------------------------------------------------------------- F2

export type TipoComentarioV2 = Comentario['tipo'] | 'TENSAO' | 'PREREQUISITO';
export interface ComentarioV2 {
  tipo: TipoComentarioV2;
  rotulo: string;
  texto: string;
}
/** 1 = essencial, 2 = importante, 3 = complementar. */
export type Saliencia = 1 | 2 | 3;
/** Chave de função de um modo (slug) ou `nenhuma`. */
export type ChaveFuncao = string;
export interface ReferenciaModo { id: string; revisao: number }
export interface FuncaoDoModo {
  chave: ChaveFuncao;
  rotulo: string;
  pergunta: string;
  descricao: string;
  cor: { claro: string; escuro: string };
}
export interface ModoDeLeituraV1 {
  versao: 1;
  id: string;
  revisao: number;
  nome: string;
  descricao: string;
  funcoes: FuncaoDoModo[];
  comentarios: TipoComentarioV2[];
  saliencia: { alvo_por_nivel: { '1': number; '2': number; '3': number } };
}
export interface MarcaGeradaV2 {
  bloco_id: Id;
  citacao: string;
  prefixo: string;
  sufixo: string;
  funcao: ChaveFuncao;
  saliencia: Saliencia;
  sublinhar: string[];
  comentario: ComentarioV2 | null;
}
export interface MarcaV2 {
  id: Id;
  ancora: AncoraV1;
  funcao: ChaveFuncao;
  saliencia: Saliencia;
  subfaixas: Faixa[];
  comentario: ComentarioV2 | null;
  /** `projecao` (J29): marca projetada de um elemento do modelo do capítulo; só existe em V2. */
  origem: MarcaV1['origem'] | 'projecao';
  validade: MarcaV1['validade'];
  visivel: boolean;
  avaliacao: MarcaV1['avaliacao'];
  /** ULID da execução de leitura ou do lote de importação; igual a `execucao_id` quando este existe. */
  camada_id: Id;
  modo: ReferenciaModo;
  execucao_id?: Id;
  job_id?: Id;
  criada_em: string;
}
export interface ExecucaoLeituraV2 {
  id: Id;
  versao_id: Id;
  metodo_versao: string;
  prompt_versao: string;
  /** Versão do contrato de saída do modelo: 2 = `MarcaGeradaV2`. */
  schema_versao: 2;
  modo: ReferenciaModo;
  nivel_de_atencao_alvo: Saliencia;
  /** Gravado por quem executou, não por quem enfileirou. */
  executor: { modelo: string; esforco: string; cli_versao?: string };
  tamanho_parte_tokens: number;
  concorrencia: number;
  plano_partes: Id[];
  criada_em: string;
}
export type TipoAnotacao = 'impressao' | 'observacao' | 'hipotese' | 'duvida' | 'fonte' | 'nota';
export interface FonteAnotacao { titulo: string; url?: string; pagina?: string }
interface AnotacaoBase {
  revisao_edicao: number;
  versao: 1;
  id: Id;
  versao_id: Id;
  ancora: AncoraV1;
  texto: string;
  marca_id?: Id;
  /** A última revisão feita pelo Codex: o texto do leitor antes dela e o motivo (J37). */
  revisao?: { autor: 'codex'; texto_anterior: string; motivo: string; em: string };
  criada_em: string;
  atualizada_em: string;
}
export type AnotacaoV1 = AnotacaoBase & (
  | { tipo: 'fonte'; fonte: FonteAnotacao }
  | { tipo: Exclude<TipoAnotacao, 'fonte'>; fonte?: never }
);
export interface MensagemPedroV1 { id: Id; autor: 'pedro'; texto: string; criada_em: string }
export interface MensagemIaV1 {
  id: Id;
  autor: 'ia';
  texto: string;
  citacoes: AncoraV1[];
  contexto?: { snapshot_hash: string; blocos: Id[] };
  execucao?: { modelo: string; esforco: string };
  criada_em: string;
}
export type MensagemV1 = MensagemPedroV1 | MensagemIaV1;
export interface ConversaV1 {
  versao: 1;
  id: Id;
  versao_id: Id;
  ancora: AncoraV1;
  marca_id?: Id;
  anotacao_id?: Id;
  mensagens: MensagemV1[];
  estado: 'aberta' | 'arquivada';
  criada_em: string;
}
/** J101: a mensagem de quem lê. Na V1 o autor era `pedro`. */
export interface MensagemDoLeitorV2 { id: Id; autor: 'leitor'; texto: string; criada_em: string }
export type MensagemV2 = MensagemDoLeitorV2 | MensagemIaV1;
/** J101: igual à V1, com `versao: 2` e o autor humano `leitor`. */
export interface ConversaV2 extends Omit<ConversaV1, 'versao' | 'mensagens'> {
  versao: 2;
  mensagens: MensagemV2[];
}
export type RelacaoConexao = 'semelhanca' | 'contraste' | 'tensao' | 'prerequisito' | 'desenvolve' | 'exemplo';
export interface ApoioGerado { bloco_id: Id; citacao: string }
export interface RespostaGeradaV1 {
  texto: string;
  pontos: { tipo: 'explicacao' | 'estrutura' | 'objecao' | 'conexao' | 'pergunta'; texto: string; apoios: ApoioGerado[] }[];
  sugestoes_de_conexao: { destino_bloco_id: Id; citacao: string; relacao: RelacaoConexao; justificativa: string }[];
}
export type DestinoConexao =
  | { tipo: 'trecho'; ancora: AncoraV1 }
  | { tipo: 'documento'; documento_id: Id }
  | { tipo: 'nota_externa'; caminho: string; titulo: string };
interface ConexaoBase {
  versao: 1;
  id: Id;
  origem: AncoraV1;
  destino: DestinoConexao;
  relacao: RelacaoConexao;
  justificativa: string;
  conversa_id?: Id;
  criada_em: string;
}
export type ConexaoV1 = ConexaoBase & (
  | { autor: 'ia'; estado: 'sugerida'; decidida_em?: never }
  | { autor: 'ia'; estado: 'aceita' | 'rejeitada'; decidida_em: string }
  | { autor: 'pedro'; estado: 'aceita'; decidida_em: string }
);
/** J101: igual à V1, com `versao: 2` e o autor humano `leitor`. */
export type ConexaoV2 = Omit<ConexaoBase, 'versao'> & { versao: 2 } & (
  | { autor: 'ia'; estado: 'sugerida'; decidida_em?: never }
  | { autor: 'ia'; estado: 'aceita' | 'rejeitada'; decidida_em: string }
  | { autor: 'leitor'; estado: 'aceita'; decidida_em: string }
);
/** De onde veio uma conexão adotada da compreensão: a relação semântica e o modelo do capítulo. */
export interface OrigemDaCompreensao { modelo_id: Id; relacao_id: Id }
/**
 * V3 (v0.1): a V2 com `versao: 3` e o tipo fino da relação, sem perda. `relacao` continua a família
 * (6, visível ao leitor); `relacao_semantica` é um dos 9 tipos da compreensão, sempre da família de
 * `relacao` (`FAMILIA_DA_RELACAO_SEMANTICA`); `origem_compreensao` só com `relacao_semantica`. Uma V2
 * lida como V3 tem os dois campos ausentes.
 */
export type ConexaoV3 = Omit<ConexaoBase, 'versao'> & {
  versao: 3; relacao_semantica?: TipoRelacaoSemantica; origem_compreensao?: OrigemDaCompreensao;
} & (
  | { autor: 'ia'; estado: 'sugerida'; decidida_em?: never }
  | { autor: 'ia'; estado: 'aceita' | 'rejeitada'; decidida_em: string }
  | { autor: 'leitor'; estado: 'aceita'; decidida_em: string }
);

export type QuadPdf = [number, number, number, number, number, number, number, number];
export interface PalavraGeometria extends Faixa { bloco_id: Id; pagina: number; quad: QuadPdf }
export interface GeometriaV1 {
  versao: 1;
  versao_id: Id;
  fonte: 'pdf_texto' | 'ocr';
  motor: string;
  paginas: { numero: number; largura: number; altura: number; rotacao: 0 | 90 | 180 | 270 }[];
  palavras: PalavraGeometria[];
}

// ---------------------------------------------------------------- Compreensão (J28, docs/desenho/10)

/**
 * 1 = estrutural (sem isto o capítulo não se sustenta), 2 = importante, 3 = complementar.
 * Mesma escala de `Saliencia`: 1 é o mais importante; promover é ir de 3 para 1.
 */
export type Centralidade = 1 | 2 | 3;
export type NucleoDoElemento =
  | 'afirmacao' | 'conceito' | 'hipotese' | 'evidencia' | 'exemplo' | 'objecao' | 'passo' | 'elemento_textual';
export type TipoRelacaoSemantica =
  | 'suporta' | 'desenvolve' | 'pressupoe' | 'contrasta' | 'exemplifica' | 'retoma' | 'responde' | 'tensiona' | 'ecoa';
export type TipoDificuldadeTextual =
  | 'premissa_implicita' | 'mudanca_de_notacao' | 'sintaxe_complexa' | 'conceito_sem_definicao'
  | 'salto_argumentativo' | 'referencia_externa' | 'ambiguidade';
export type Confianca = 'alta' | 'media' | 'baixa';
export type EstagioDoModelo = 'analise_local' | 'sintese' | 'revisao';
export type TipoNotaAnalitica = 'LEITURA' | 'INVESTIGAR' | 'OBJECAO' | 'TENSAO';

export interface OrigemNoModelo { estagio: EstagioDoModelo; job_id: Id }
/** Inferência do assistente sobre o elemento; nunca conclusão do autor nem opinião do leitor. */
export interface NotaAnaliticaV1 { tipo: TipoNotaAnalitica; texto: string }
export interface ElementoSemanticoV1 {
  id: Id;
  nucleo: NucleoDoElemento;
  /** Chave de função do modo da execução, ou `null`. */
  papel: ChaveFuncao | null;
  /** Pelo menos uma; a primeira é a principal. */
  ancoras: AncoraV1[];
  /** Paráfrase fiel, na voz do autor. */
  enunciado: string;
  /** Literais dentro da âncora principal (restrições, quantificadores); viram sublinhados na projeção. */
  qualificadores: string[];
  centralidade: Centralidade;
  notas: NotaAnaliticaV1[];
  origem: OrigemNoModelo;
}
export interface RelacaoSemanticaV1 {
  id: Id;
  tipo: TipoRelacaoSemantica;
  origem_id: Id;
  destino_id: Id;
  explicacao: string;
  confianca: Confianca;
  /** Só visível com o capítulo inteiro à vista (a hipótese do começo que sustenta o fim). */
  retrospectiva: boolean;
  origem: OrigemNoModelo;
}
/** O que o texto faz de difícil; nunca uma previsão sobre o leitor. */
export interface DificuldadeTextualV1 {
  id: Id;
  tipo: TipoDificuldadeTextual;
  ancoras: AncoraV1[];
  descricao: string;
  origem: OrigemNoModelo;
}
export interface UnidadeDeLeituraV1 { id: Id; bloco_inicio: Id; bloco_fim: Id; titulo: string; funcao_no_capitulo: string }
export interface MovimentoDoCapituloV1 { texto: string; etapas: { unidade_ids: Id[]; descricao: string }[] }
/** Uma revisão publicada do modelo do capítulo: imutável. */
export interface ModeloDoCapituloV1 {
  versao: 1;
  /** Id desta revisão. */
  id: Id;
  execucao_id: Id;
  versao_id: Id;
  secao_id: Id;
  modo: ReferenciaModo;
  /** 0 = união das análises locais, 1 = síntese, 2 = revisão global. */
  revisao: number;
  estagio: EstagioDoModelo;
  base_id: Id | null;
  lote_id: Id | null;
  movimento: MovimentoDoCapituloV1 | null;
  unidades: UnidadeDeLeituraV1[];
  elementos: ElementoSemanticoV1[];
  relacoes: RelacaoSemanticaV1[];
  dificuldades: DificuldadeTextualV1[];
  criada_em: string;
}
interface OperacaoBaseDoModelo { ordem: number; motivo: string; evidencia: AncoraV1[] }
export type OperacaoDoModeloV1 = OperacaoBaseDoModelo & (
  | { op: 'promover' | 'rebaixar'; alvo_id: Id; antes: { centralidade: Centralidade }; depois: { centralidade: Centralidade } }
  | { op: 'corrigir_papel'; alvo_id: Id; antes: { nucleo: NucleoDoElemento; papel: ChaveFuncao | null }; depois: { nucleo: NucleoDoElemento; papel: ChaveFuncao | null } }
  | { op: 'reescrever_enunciado'; alvo_id: Id; antes: { enunciado: string }; depois: { enunciado: string } }
  | { op: 'acrescentar_nota'; alvo_id: Id; antes: null; depois: NotaAnaliticaV1 }
  | { op: 'fundir'; alvo_id: Id; antes: { absorvidos: ElementoSemanticoV1[] }; depois: { ancoras: AncoraV1[] } }
  | { op: 'adicionar_elemento'; alvo_id: Id; antes: null; depois: ElementoSemanticoV1 }
  | { op: 'remover_elemento'; alvo_id: Id; antes: ElementoSemanticoV1; depois: null }
  | { op: 'criar_relacao'; alvo_id: Id; antes: null; depois: RelacaoSemanticaV1 }
  | { op: 'remover_relacao'; alvo_id: Id; antes: RelacaoSemanticaV1; depois: null }
  | { op: 'adicionar_dificuldade'; alvo_id: Id; antes: null; depois: DificuldadeTextualV1 }
  | { op: 'remover_dificuldade'; alvo_id: Id; antes: DificuldadeTextualV1; depois: null }
  | { op: 'definir_unidades'; alvo_id?: never; antes: UnidadeDeLeituraV1[]; depois: UnidadeDeLeituraV1[] }
  | { op: 'definir_movimento'; alvo_id?: never; antes: MovimentoDoCapituloV1 | null; depois: MovimentoDoCapituloV1 }
);
export type TipoOperacaoDoModelo = OperacaoDoModeloV1['op'];
export interface LoteDoModeloV1 {
  versao: 1;
  id: Id;
  execucao_id: Id;
  secao_id: Id;
  estagio: 'sintese' | 'revisao';
  job_ids: Id[];
  base_id: Id;
  resultado_id: Id;
  operacoes: OperacaoDoModeloV1[];
  criado_em: string;
}
export interface PassoPedagogicoV1 {
  ordem: number;
  bloco_inicio: Id;
  bloco_fim: Id;
  /** Elementos em destaque neste passo. */
  foco: Id[];
  observar: string;
  explicacao: { curta: string; longa: string };
  /** Relações a recuperar neste passo. */
  relacoes: Id[];
  parada: { tipo: 'pergunta' | 'pausa'; texto: string } | null;
}
export interface ApoioPedagogicoV1 { alvo_id: Id; tipo: 'explicar' | 'omitir' | 'exemplo' | 'recordar'; texto: string }
/** Como acompanhar este leitor neste capítulo; depende do perfil, nunca do dispositivo. */
export interface PlanoPedagogicoV1 {
  versao: 1;
  id: Id;
  execucao_id: Id;
  secao_id: Id;
  /** Revisão do modelo de que o plano saiu. */
  modelo_id: Id;
  perfil_hash: string;
  passos: PassoPedagogicoV1[];
  apoios: ApoioPedagogicoV1[];
  job_id: Id;
  criado_em: string;
}
export type Dispositivo = 'desktop' | 'eink' | 'audio';
export interface TelaDaApresentacaoV1 {
  passo: number;
  tipo: 'texto' | 'explicacao' | 'narracao' | 'comentario';
  blocos: Id[];
  texto: string | null;
}
/** Como o plano cabe num dispositivo: calculada, nunca decide a pedagogia. */
export interface ApresentacaoDoPlanoV1 { versao: 1; plano_id: Id; dispositivo: Dispositivo; telas: TelaDaApresentacaoV1[] }
export type NivelDeArea = 'basico' | 'intermediario' | 'avancado';
export interface PerfilDoLeitorV1 {
  versao: 1;
  revisao: number;
  areas: { nome: string; nivel: NivelDeArea }[];
  preferencias: string[];
  observacoes: string;
  atualizado_em: string;
}
export interface ExecucaoCompreensaoV1 {
  id: Id;
  versao_id: Id;
  schema_versao: 3;
  modo: ReferenciaModo;
  prompts: { analise: string; sintese: string; revisao: string; plano: string };
  executor: { modelo: string; esforco: string };
  tamanho_parte_tokens: number;
  plano_partes: Id[];
  criada_em: string;
}

// ---------------------------------------------------------------- resolução de exercícios (J34)

/** Um passo da resolução: a explicação em palavras e, se houver, a conta em notação linear legível. */
export interface PassoDaResolucaoV1 { texto: string; calculo: string | null }
export interface ItemDaResolucaoV1 {
  /** "a)", "2.", ou vazio quando o exercício tem um item só. */
  rotulo: string;
  enunciado: string;
  estrategia: string;
  passos: PassoDaResolucaoV1[];
  resposta: string;
  verificacao: string | null;
}
/** O que o modelo devolve ao resolver um exercício recortado (schema de saída do prompt `resolver-exercicio@1`). */
export interface ResolucaoGeradaV1 {
  /** O enunciado transcrito da imagem (ou do texto) do recorte. */
  enunciado: string;
  legibilidade: 'boa' | 'parcial' | 'ruim';
  itens: ItemDaResolucaoV1[];
  conceitos: string[];
  observacao: string | null;
}
export type OrigemDaResolucaoV1 =
  | { tipo: 'recorte'; pagina: number; retangulo: { x: number; y: number; largura: number; altura: number }; imagem_sha256: string }
  | { tipo: 'trecho'; ancora: AncoraV1 };
export interface MensagemDaResolucaoPedroV1 { id: Id; autor: 'pedro'; texto: string; criada_em: string }
export interface MensagemDaResolucaoIaV1 {
  id: Id; autor: 'ia'; texto: string; passos: PassoDaResolucaoV1[]; execucao: { modelo: string; esforco: string }; criada_em: string;
}
/** Capítulo e seção como o livro os escreve ("Capítulo 1 · Conjuntos finitos", "Seção 2: Conjuntos finitos"), o número do exercício e a ordem dele no livro. */
export interface ExercicioDoLivroV1 { capitulo: string | null; secao: string | null; numero: string; ordem: number }
/** Sessão de resolução: o exercício recortado, a resolução passo a passo e as perguntas sobre ela. */
export interface ResolucaoV1 {
  versao: 1;
  id: Id;
  documento_id: Id;
  versao_id: Id;
  origem: OrigemDaResolucaoV1;
  /** O texto que estava no recorte (camada de texto do PDF) ou o trecho selecionado. */
  texto_extraido: string;
  /** Onde o exercício está no livro (descoberta em lote, ou reconhecido por ela); ausente nos recortes avulsos. */
  exercicio?: ExercicioDoLivroV1;
  resolucao: ResolucaoGeradaV1 | null;
  execucao: { modelo: string; esforco: string } | null;
  mensagens: (MensagemDaResolucaoPedroV1 | MensagemDaResolucaoIaV1)[];
  criada_em: string;
}
/** J101: a pergunta de quem lê sobre a resolução. Na V1 o autor era `pedro`. */
export interface MensagemDaResolucaoDoLeitorV2 { id: Id; autor: 'leitor'; texto: string; criada_em: string }
/** J101: igual à V1, com `versao: 2` e o autor humano `leitor`. */
export interface ResolucaoV2 extends Omit<ResolucaoV1, 'versao' | 'mensagens'> {
  versao: 2;
  mensagens: (MensagemDaResolucaoDoLeitorV2 | MensagemDaResolucaoIaV1)[];
}

/**
 * Modelo D (J138): a nota do leitor pertence ao grifo, uma por grifo, em texto simples e sem tipo.
 * Guardada como anotação ligada à marca (mesmo id), é a nota do grifo para tudo o que é novo.
 */
export interface NotaDoGrifoV1 {
  versao: 1;
  id: Id;
  marca_id: Id;
  versao_id: Id;
  texto: string;
  revisao?: { autor: 'codex'; texto_anterior: string; motivo: string; em: string };
  criada_em: string;
  atualizada_em: string;
  revisao_edicao: number;
}
export type OrigemDaDificuldade = 'codex' | 'leitor';
export type EstadoDaDificuldade = 'sugerida' | 'confirmada' | 'descartada';
/**
 * Modelo D (J138): o sinal de dificuldade num trecho, à parte do grifo (não é cor, função nem etiqueta).
 * Do Codex (`ModeloDoCapituloV1.dificuldades`, decidida pelo leitor) ou marcado pelo leitor (já confirmado).
 */
export interface DificuldadeV1 {
  versao: 1;
  id: Id;
  versao_id: Id;
  ancora: AncoraV1;
  origem: OrigemDaDificuldade;
  estado: EstadoDaDificuldade;
  tipo?: TipoDificuldadeTextual;
  descricao?: string;
  marca_id?: Id;
  codex?: { modelo_id: Id; dificuldade_id: Id };
  criada_em: string;
  atualizada_em: string;
}

/** Etiqueta do leitor (tag) sobre uma marca ou uma anotação da versão. O nome é livre; a unicidade ignora maiúsculas. */
export interface EtiquetaV1 {
  versao: 1;
  id: Id;
  versao_id: Id;
  alvo: { tipo: 'marca' | 'anotacao'; id: Id };
  /** Texto sem espaços nas extremidades, de 1–40 caracteres; comparação em minúsculas. Inclui os sete tipos de dificuldade. */
  nome: string;
  criada_em: string;
}
