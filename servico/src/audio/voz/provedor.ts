/**
 * Provedor de voz trocável (J106). Qualquer provedor recebe as cenas de um roteiro (uma frase por cena,
 * como no Colab) e devolve o mesmo que o manifesto TTS do Colab descreve: um MP3 e, para cada cena,
 * o texto narrado com início e fim em segundos. Daí o serviço monta o `AudioV2` que o player já toca
 * por trecho, exatamente como o `AudioV1`.
 *
 * O que é comum a todos fica aqui: divisão do texto em pedidos dentro do limite do modelo, conversão
 * do alinhamento por caractere em tempos por cena, estimativa de custo e as mensagens de erro claras.
 */

export interface CenaParaNarrar {
  /** Identificador da cena no roteiro (`c001`, …), o mesmo do manifesto do Colab. */
  cena: string;
  texto: string;
  /** A cena abre um bloco novo (parágrafo, título): o texto do pedido ganha uma quebra antes dela. */
  novoBloco: boolean;
}

export interface CenaNarrada { cena: string; narracao: string; inicio_s: number; fim_s: number }

/** Mesmo formato do `manifest.json` do Colab (`total_s`, `cenas`), mais o que foi cobrado. */
export interface NarracaoGerada {
  mp3: Buffer;
  total_s: number;
  cenas: CenaNarrada[];
  caracteres: number;
  /** Avisos que não impedem a publicação (ex.: alinhamento aproximado num pedaço). */
  avisos: string[];
}

export interface ModeloDeVoz {
  id: string;
  nome: string;
  /** Máximo de caracteres por pedido aceito pelo modelo. */
  limite: number;
  /** Créditos do provedor por caractere. */
  creditosPorCaractere: number;
  /** Preço de referência por 1.000 caracteres, em dólares (pago por uso). */
  usdPorMil: number;
}

export interface VozDoProvedor { id: string; nome: string; categoria?: string; descricao?: string }

export interface Estimativa {
  caracteres: number;
  pedidos: number;
  creditos: number;
  /** Referência em dólares; o valor real depende do plano da pessoa no provedor. */
  custo_usd: number;
}

export interface PedidoDeNarracao {
  cenas: readonly CenaParaNarrar[];
  voz_id: string;
  modelo_id: string;
  sinal: AbortSignal;
  aoProgredir?: (feitos: number, total: number) => void;
}

export interface ProvedorDeVoz {
  readonly nome: string;
  modelos(): readonly ModeloDeVoz[];
  /** Confere a chave; devolve créditos restantes quando a chave pode ler a assinatura. */
  testarChave(sinal?: AbortSignal): Promise<{ creditos_restantes?: number }>;
  listarVozes(sinal?: AbortSignal): Promise<VozDoProvedor[]>;
  narrar(pedido: PedidoDeNarracao): Promise<NarracaoGerada>;
}

export type TipoDeErroDoProvedor =
  | 'sem_chave' | 'chave_invalida' | 'sem_creditos' | 'limite' | 'permissao' | 'voz_inexistente'
  | 'pedido_recusado' | 'indisponivel' | 'resposta_invalida' | 'cancelado';

export const MENSAGENS_DO_PROVEDOR: Readonly<Record<TipoDeErroDoProvedor, string>> = {
  sem_chave: 'Nenhuma chave da ElevenLabs configurada. Coloque a sua em Configurações → Áudio.',
  chave_invalida: 'Chave inválida: a ElevenLabs recusou a chave. Confira em Configurações → Áudio.',
  sem_creditos: 'Sem créditos na conta da ElevenLabs para esta narração.',
  limite: 'Limite da ElevenLabs atingido (pedidos demais ao mesmo tempo). Tente de novo em alguns minutos.',
  permissao: 'A chave não tem permissão para isso. Ela precisa de “Text to Speech” e de leitura de vozes.',
  voz_inexistente: 'A voz escolhida não está mais na conta. Escolha outra em Configurações → Áudio.',
  pedido_recusado: 'A ElevenLabs recusou o pedido.',
  indisponivel: 'A ElevenLabs não respondeu. Tente de novo mais tarde.',
  resposta_invalida: 'A ElevenLabs devolveu uma resposta que o Margem não entendeu.',
  cancelado: 'A narração foi cancelada.',
};

export class ErroDoProvedor extends Error {
  constructor(readonly tipo: TipoDeErroDoProvedor, detalhe?: string) {
    super(detalhe ? `${MENSAGENS_DO_PROVEDOR[tipo]} ${detalhe}` : MENSAGENS_DO_PROVEDOR[tipo]);
    this.name = 'ErroDoProvedor';
  }
}

/** Tira o segredo de qualquer texto que vá para log, banco ou resposta. */
export function redigir(texto: string, segredo: string | null | undefined): string {
  if (!segredo || segredo.length < 4) return texto;
  return texto.split(segredo).join('[chave omitida]');
}

const pontosDeCodigo = (texto: string): number => [...texto].length;

/** Um pedido ao provedor: o texto e onde cada cena começa e termina nele (em pontos de código). */
export interface PedacoDoRoteiro {
  texto: string;
  cenas: { cena: string; narracao: string; inicio: number; fim: number }[];
}

/**
 * Agrupa cenas consecutivas em pedidos de até `limite` caracteres. Cenas do mesmo bloco ficam
 * separadas por espaço; bloco novo, por quebra de parágrafo (a voz faz a pausa). Uma cena maior que
 * o limite sozinha é recusada: o roteiro já quebra frases longas.
 */
export function dividirEmPedacos(cenas: readonly CenaParaNarrar[], limite: number): PedacoDoRoteiro[] {
  const pedacos: PedacoDoRoteiro[] = [];
  let atual: PedacoDoRoteiro | null = null;
  let tamanho = 0;
  for (const cena of cenas) {
    const narracao = cena.texto.replace(/\s+/gu, ' ').trim();
    if (narracao === '') continue;
    const comprimento = pontosDeCodigo(narracao);
    if (comprimento > limite) throw new Error(`A cena ${cena.cena} passa do limite de ${String(limite)} caracteres por pedido.`);
    const separador = atual === null || atual.cenas.length === 0 ? '' : cena.novoBloco ? '\n\n' : ' ';
    if (atual === null || tamanho + pontosDeCodigo(separador) + comprimento > limite) {
      atual = { texto: '', cenas: [] };
      pedacos.push(atual);
      tamanho = 0;
    }
    const sep = atual.cenas.length === 0 ? '' : separador;
    const inicio = tamanho + pontosDeCodigo(sep);
    atual.texto += sep + narracao;
    tamanho = inicio + comprimento;
    atual.cenas.push({ cena: cena.cena, narracao, inicio, fim: tamanho });
  }
  return pedacos;
}

export function caracteresDoRoteiro(cenas: readonly CenaParaNarrar[], limite: number): { caracteres: number; pedidos: number } {
  const pedacos = dividirEmPedacos(cenas, limite);
  return { caracteres: pedacos.reduce((total, p) => total + pontosDeCodigo(p.texto), 0), pedidos: pedacos.length };
}

export function estimar(cenas: readonly CenaParaNarrar[], modelo: ModeloDeVoz): Estimativa {
  const { caracteres, pedidos } = caracteresDoRoteiro(cenas, modelo.limite);
  return {
    caracteres, pedidos,
    creditos: Math.ceil(caracteres * modelo.creditosPorCaractere),
    custo_usd: Math.round(caracteres * modelo.usdPorMil / 10) / 100,
  };
}

/** Alinhamento por caractere devolvido pelo provedor (o formato do `with-timestamps` da ElevenLabs). */
export interface AlinhamentoPorCaractere {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * Tempos de cada cena dentro de um pedaço, a partir do alinhamento por caractere, deslocados por
 * `deslocamento` (a duração dos pedaços anteriores). Se o alinhamento não bate com o texto enviado,
 * reparte a duração do pedaço pelo tamanho das cenas e avisa: a sincronia fica aproximada, nunca falsa
 * em silêncio.
 */
export function temposDasCenas(
  pedaco: PedacoDoRoteiro, alinhamento: AlinhamentoPorCaractere | null, duracao: number, deslocamento: number,
): { cenas: CenaNarrada[]; aproximado: boolean } {
  const caracteres = [...pedaco.texto];
  const confere = alinhamento !== null
    && alinhamento.characters.length === caracteres.length
    && alinhamento.character_start_times_seconds.length === caracteres.length
    && alinhamento.character_end_times_seconds.length === caracteres.length
    && alinhamento.characters.join('') === pedaco.texto;
  const cenas = pedaco.cenas.map((cena) => {
    if (confere) {
      const inicio = alinhamento.character_start_times_seconds[cena.inicio]!;
      const fim = alinhamento.character_end_times_seconds[cena.fim - 1]!;
      return { cena: cena.cena, narracao: cena.narracao, inicio_s: deslocamento + inicio, fim_s: deslocamento + fim };
    }
    const total = caracteres.length || 1;
    return { cena: cena.cena, narracao: cena.narracao,
      inicio_s: deslocamento + duracao * cena.inicio / total, fim_s: deslocamento + duracao * cena.fim / total };
  });
  return { cenas, aproximado: !confere };
}

/**
 * Tempos coerentes para o contrato: crescentes, sem sobreposição, dentro do áudio, com 3 casas.
 * O fim de cada cena encosta no início da seguinte do mesmo pedaço, para o destaque não piscar.
 */
export function ajustarTempos(cenas: readonly CenaNarrada[], total: number): CenaNarrada[] {
  const arredondar = (s: number): number => Math.round(s * 1000) / 1000;
  const saida: CenaNarrada[] = [];
  let anterior = 0;
  for (const cena of cenas) {
    const inicio = arredondar(Math.min(Math.max(cena.inicio_s, anterior), total));
    let fim = arredondar(Math.min(Math.max(cena.fim_s, inicio + 0.001), total));
    if (fim <= inicio) fim = arredondar(Math.min(inicio + 0.001, total));
    if (fim <= inicio) continue;
    saida.push({ ...cena, inicio_s: inicio, fim_s: fim });
    anterior = fim;
  }
  return saida;
}
