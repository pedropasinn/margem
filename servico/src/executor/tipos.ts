/**
 * Tipos do executor de leituras.
 *
 * Origem das decisões de linha de comando e de saneamento de ambiente: dois adaptadores anteriores
 * do autor para o `codex exec` (ambiente mínimo, prazo com morte do processo, limpeza do temporário,
 * nada de prompt em log; uso de `--output-schema`, `--output-last-message`, `-C`,
 * `--sandbox read-only` e stdin fechado).
 * Reescrito em TypeScript para o Margem; nenhum dos dois arquivos foi copiado.
 */

/** Códigos de falha definitiva de uma tentativa. */
export type CodigoFalha =
  | 'json_invalido'
  | 'schema'
  | 'timeout'
  | 'processo'
  | 'auth'
  | 'cancelado'
  | 'cli_incompativel'
  /** J70: a execução de imagem terminou sem PNG na pasta da sessão. */
  | 'sem_imagem'
  /** J106: falhas do provedor de voz (ElevenLabs), com mensagem clara para a pessoa. */
  | 'sem_chave' | 'chave_invalida' | 'sem_creditos' | 'limite' | 'permissao' | 'voz_inexistente'
  | 'pedido_recusado' | 'indisponivel' | 'resposta_invalida'
  | 'desconhecido';

export interface PedidoExecucao {
  /** Diretório com **só** os arquivos da entrada (método, texto da parte, schema). */
  diretorioEntrada: string;
  /** Instruções; vão por argumento, nunca por stdin, e nunca para log persistente. */
  prompt: string;
  /** Caminho do JSON Schema da resposta final. */
  schema: string;
  modelo?: string;
  esforco?: string;
  prazoMs: number;
  sinal?: AbortSignal;
  /** Onde o artefato sobrevive à limpeza do temporário. Padrão: ~/.cache/margem/artefatos. */
  diretorioArtefatos?: string;
  /**
   * Imagens anexadas ao pedido (J34: o recorte de um exercício), pelo nome do arquivo dentro de
   * `diretorioEntrada`. Vão para a CLI com `--image`; sem a flag na versão local, vão só no texto.
   */
  imagens?: string[];
  /**
   * J70: a tarefa gera imagem com a ferramenta `image_gen` do Codex. O executor lê a sessão pelo
   * `--json` e devolve em `imagens` os PNGs de `$CODEX_HOME/generated_images/<sessão>/`.
   */
  gerarImagem?: boolean;
  /**
   * Pastas montadas **só para leitura** dentro do diretório da execução, em `<diretório>/<nome>`
   * (o agente da biblioteca lê o export em Markdown dos textos). No confinamento é um `--ro-bind`;
   * sem ele (testes), um link simbólico. `nome` é uma palavra simples, sem barra.
   */
  anexos?: { nome: string; origem: string }[];
}

export interface ExecucaoOk {
  estado: 'ok';
  /** Caminho do JSON já validado, fora do diretório temporário. */
  artefato: string;
  sha256: string;
  duracao_ms: number;
  modelo: string;
  /**
   * Esforço efetivo, quando o executor sabe dizer (J14). O Codex o anuncia na linha
   * `reasoning effort:` do stderr; sem anúncio, vale o que foi pedido.
   */
  esforco?: string;
  /** J70: PNGs gerados nesta execução (só quando o pedido tinha `gerarImagem`), do mais antigo ao mais novo. */
  imagens?: string[];
}

export interface ExecucaoFalhou {
  estado: 'falhou';
  codigo: CodigoFalha;
  mensagem: string;
  duracao_ms: number;
}

export interface ExecucaoAdiada {
  estado: 'adiado';
  /** `cota` vem do Codex; `dependencia` vem do J06 (a revisão espera as partes). */
  codigo: 'cota' | 'dependencia';
  not_before: Date;
  mensagem: string;
  duracao_ms: number;
}

export type ResultadoExecutor = ExecucaoOk | ExecucaoFalhou | ExecucaoAdiada;

/** Contrato comum ao executor real e ao falso. */
export type Executor = (pedido: PedidoExecucao) => Promise<ResultadoExecutor>;

export function falhou(codigo: CodigoFalha, mensagem: string, duracao_ms: number): ExecucaoFalhou {
  return { estado: 'falhou', codigo, mensagem, duracao_ms };
}
