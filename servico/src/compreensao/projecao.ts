/**
 * Projeção de marcas (J29/J30, `docs/desenho/10-MODELO-DO-CAPITULO.md` §7; refeita no J76): do modelo do
 * capítulo para `MarcaV2` na camada da execução. Determinística e pura; roda na transação que publica a
 * revisão final.
 *
 * "Esta passagem é uma hipótese importante" é compreensão (o modelo); "vale grifar isto no nível 2" é
 * decisão editorial (esta função). As limitações do marca-texto (uma cor por trecho, nada de
 * sobreposição na camada) vivem aqui, nunca no modelo.
 *
 * O que a projeção decide (J76, medido na bancada-50 — `docs/jobs/J76-RESULTADO.md`):
 * - **recorte**: a marca cai na frase em que o papel se realiza (a frase, entre todas as citações do
 *   elemento, que mais repete o enunciado), nunca na primeira citação inteira; teto de uma frase;
 * - **saliência**: `centralidade` é o ponto de partida; o excedente sobre `alvo_por_nivel` do modo é
 *   rebaixado (s1→s2, s2→s3), preservando os elementos mais centrais e com mais dependentes;
 * - **voz**: `tese` é só da voz do autor; objeção, voto vencido, sentença recorrida, ironia, tese
 *   provisória, fala de interlocutor não recebem a cor de tese;
 * - **papel nulo**: núcleo com função equivalente no modo (conceito → conceito/definição, contraexemplo
 *   matemático → passo não trivial…) ganha essa cor em vez de ficar sem cor;
 * - **aliases**: nenhum `B007`/`L10` chega ao comentário da marca.
 *
 * `OpcoesDaProjecao` liga cada decisão em separado; `PROJECAO_ORIGINAL` reproduz `projecao@1` exatamente
 * (a sanidade da bancada) e `PROJECAO_PADRAO` é a regra em vigor.
 */
import type {
  AncoraV1, Bloco, ComentarioV2, ElementoSemanticoV1, Id, MarcaV2, ModeloDoCapituloV1, ModoDeLeituraV1, NotaAnaliticaV1,
  RelacaoSemanticaV1, Saliencia,
} from '@margem/contratos';
import { validarMarcaV2 } from '@margem/contratos';
import { ancoraDeSelecao, resolverSubfaixas } from '@margem/core';
import { retirarAliases } from './aliases-no-texto.js';

export const REGRA_DA_PROJECAO = 'projecao@2';

export type MarcaSemIdentidade = Omit<MarcaV2, 'id' | 'criada_em'>;

export interface MarcaProjetada { marca: MarcaSemIdentidade; elemento_id: Id }

export interface DiagnosticoDaProjecao { codigo: string; mensagem: string; elemento_id: Id }

export interface ProjecaoDeMarcas {
  marcas: MarcaProjetada[];
  diagnosticos: DiagnosticoDaProjecao[];
  /** Fração do texto do capítulo coberta pelas marcas de saliência ≤ n, contra o alvo do modo. */
  cobertura: { nivel: Saliencia; fracao: number; alvo: number }[];
}

export interface ContextoDaProjecao {
  modo: ModoDeLeituraV1;
  /** Camada = execução. */
  camada_id: Id;
  job_id?: Id;
  /** Blocos do capítulo, em ordem (para recorte, sublinhados e cobertura). */
  blocos: readonly Pick<Bloco, 'id' | 'texto'>[];
}

export interface OpcoesDaProjecao {
  /**
   * `primeira`: a primeira citação inteira (projecao@1). `primeira_frase`: a primeira frase da primeira citação.
   * `frase`: a frase que realiza o papel, entre todas as citações (a que mais repete o enunciado, com `bonus_da_primeira`
   * para a primeira frase da primeira citação).
   */
  recorte: 'primeira' | 'primeira_frase' | 'frase';
  /** Peso somado à pontuação da primeira frase da primeira citação (0 = só o enunciado decide). */
  bonus_da_primeira: number;
  /** `uma` marca por elemento (o recorte); `por_frase`: as outras frases da citação também, um nível abaixo; `por_citacao`: idem com cada citação. */
  marcas: 'uma' | 'por_frase' | 'por_citacao';
  /** Em `por_frase`: fração da pontuação do recorte que uma frase extra precisa ter para virar marca (0 = todas). */
  limiar_da_frase_extra: number;
  /** Aplica `alvo_por_nivel` do modo, rebaixando o excedente. */
  alvo: boolean;
  /** Até que nível o alvo corta: 1 (só s1→s2) ou 2 (também s2→s3). */
  niveis_do_alvo: 1 | 2;
  /** Multiplica o alvo do modo antes de cortar (1 = o alvo do contrato). */
  fator_do_alvo: number;
  /** Tese só na voz do autor. */
  voz: boolean;
  /** Papel nulo ganha a função equivalente ao núcleo, quando o modo a tem. */
  papel_padrao: boolean;
  /** Retrospectivas derivadas pela ordem dos blocos (aplicadas ao modelo antes da projeção; ver `derivarRetrospectivas`). */
  retrospectiva: boolean;
  /** Tira aliases internos que tenham sobrado no comentário. */
  aliases: boolean;
}

export const PROJECAO_ORIGINAL: OpcoesDaProjecao = {
  recorte: 'primeira', bonus_da_primeira: 0, marcas: 'uma', limiar_da_frase_extra: 0, alvo: false, niveis_do_alvo: 2, fator_do_alvo: 1, voz: false, papel_padrao: false, retrospectiva: false, aliases: false,
};

export const PROJECAO_PADRAO: OpcoesDaProjecao = {
  recorte: 'frase', bonus_da_primeira: 0.6, marcas: 'uma', limiar_da_frase_extra: 0, alvo: true, niveis_do_alvo: 1, fator_do_alvo: 2, voz: true, papel_padrao: true, retrospectiva: true, aliases: true,
};

/** Variantes nomeadas para a ablação da bancada (`servico/src/ferramentas/reprojetar.ts`). */
export const VARIANTES_DA_PROJECAO: Record<string, OpcoesDaProjecao> = {
  atual: PROJECAO_ORIGINAL,
  // cada conserto sozinho sobre projecao@1
  recorte: { ...PROJECAO_ORIGINAL, recorte: 'frase', bonus_da_primeira: 0.6 },
  alvo: { ...PROJECAO_ORIGINAL, alvo: true, niveis_do_alvo: 1, fator_do_alvo: 2 },
  voz: { ...PROJECAO_ORIGINAL, voz: true },
  papel: { ...PROJECAO_ORIGINAL, papel_padrao: true },
  retrospectiva: { ...PROJECAO_ORIGINAL, retrospectiva: true },
  aliases: { ...PROJECAO_ORIGINAL, aliases: true },
  // alternativas de recorte medidas
  'recorte-sem-bonus': { ...PROJECAO_ORIGINAL, recorte: 'frase' },
  'recorte-primeira-frase': { ...PROJECAO_ORIGINAL, recorte: 'primeira_frase' },
  'por-frase': { ...PROJECAO_ORIGINAL, recorte: 'frase', bonus_da_primeira: 0.6, marcas: 'por_frase' },
  'por-frase-0.7': { ...PROJECAO_ORIGINAL, recorte: 'frase', bonus_da_primeira: 0.6, marcas: 'por_frase', limiar_da_frase_extra: 0.7 },
  'por-citacao-inteira': { ...PROJECAO_ORIGINAL, marcas: 'por_citacao' },
  // alternativas de alvo medidas (sobre o padrão)
  'padrao-alvo-contrato': { ...PROJECAO_PADRAO, niveis_do_alvo: 2, fator_do_alvo: 1 },
  'padrao-alvo-2-niveis': { ...PROJECAO_PADRAO, niveis_do_alvo: 2 },
  'padrao-alvo-n1-1': { ...PROJECAO_PADRAO, fator_do_alvo: 1 },
  'padrao-alvo-n1-1.5': { ...PROJECAO_PADRAO, fator_do_alvo: 1.5 },
  // o padrão sem cada conserto
  'padrao-sem-recorte': { ...PROJECAO_PADRAO, recorte: 'primeira', bonus_da_primeira: 0 },
  'padrao-sem-alvo': { ...PROJECAO_PADRAO, alvo: false },
  'padrao-sem-voz': { ...PROJECAO_PADRAO, voz: false },
  'padrao-sem-papel': { ...PROJECAO_PADRAO, papel_padrao: false },
  'padrao-sem-retrospectiva': { ...PROJECAO_PADRAO, retrospectiva: false },
  'padrao-sem-aliases': { ...PROJECAO_PADRAO, aliases: false },
  padrao: PROJECAO_PADRAO,
};

const ROTULO_DA_NOTA: Record<NotaAnaliticaV1['tipo'], string> = {
  LEITURA: '→ LEITURA', INVESTIGAR: '? INVESTIGAR', OBJECAO: '× OBJEÇÃO', TENSAO: 'TENSÃO',
};
const ROTULO_DO_NUCLEO: Record<ElementoSemanticoV1['nucleo'], string> = {
  afirmacao: 'AFIRMAÇÃO', conceito: 'CONCEITO', hipotese: 'HIPÓTESE', evidencia: 'EVIDÊNCIA', exemplo: 'EXEMPLO',
  objecao: 'OBJEÇÃO', passo: 'PASSO', elemento_textual: 'TEXTO',
};

// ---------------------------------------------------------------- recorte

/** Frases de `texto[inicio, fim)`: fim em `.`, `!`, `?` ou `…` seguidos de espaço; em verso, também `;`/`:` no fim da linha. */
export function frasesDoTrecho(texto: string, inicio: number, fim: number): { inicio: number; fim: number }[] {
  const frases: { inicio: number; fim: number }[] = [];
  const fronteira = /(?:[.!?…]+["”’»)]*(?=\s)|[;:](?=[ \t]*\n))/gu;
  let corrente = inicio;
  const trecho = texto.slice(inicio, fim);
  for (const achado of trecho.matchAll(fronteira)) {
    const ate = inicio + (achado.index ?? 0) + achado[0].length;
    if (abreviacao(texto, inicio + (achado.index ?? 0))) continue;
    if (ate > corrente && texto.slice(corrente, ate).trim() !== '') frases.push(aparar(texto, corrente, ate));
    corrente = ate;
  }
  if (fim > corrente && texto.slice(corrente, fim).trim() !== '') frases.push(aparar(texto, corrente, fim));
  return frases;
}

const ABREVIACOES = new Set(['sr', 'sra', 'dr', 'dra', 'prof', 'profa', 'art', 'arts', 'p', 'pp', 'cap', 'fig', 'n', 'nº', 'vol', 'ed', 'al', 'cf', 'ex', 'inc', 'séc']);
function abreviacao(texto: string, ponto: number): boolean {
  if (texto[ponto] !== '.') return false;
  const antes = /([\p{L}º]+)$/u.exec(texto.slice(Math.max(0, ponto - 12), ponto))?.[1] ?? '';
  if (antes === '') return false;
  if (antes.length === 1 && /\p{Lu}/u.test(antes)) return true; // inicial: "J. Silva"
  return ABREVIACOES.has(antes.toLocaleLowerCase('pt-BR'));
}

function aparar(texto: string, inicio: number, fim: number): { inicio: number; fim: number } {
  let i = inicio;
  let f = fim;
  while (i < f && /\s/u.test(texto[i] ?? '')) i += 1;
  while (f > i && /\s/u.test(texto[f - 1] ?? '')) f -= 1;
  return { inicio: i, fim: f };
}

const VAZIAS = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para com sem sob sobre entre '
  + 'e ou mas nem que se como quando onde porque pois já não sim mais menos muito muita muitos muitas pouco também ainda só apenas '
  + 'ele ela eles elas isso isto aquilo esse essa esses essas este esta estes estas aquele aquela seu sua seus suas lhe lhes '
  + 'é são ser foi era há tem têm ter está estão estar pode podem deve devem faz fazem cada todo toda todos todas outro outra '
  + 'mesmo mesma qual quais quem cujo cuja texto autor passagem trecho capítulo afirma diz mostra apresenta sustenta').split(' '));

function termos(texto: string): Set<string> {
  const saida = new Set<string>();
  for (const palavra of texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').split(/[^\p{L}\p{N}]+/u)) {
    if (palavra.length < 3 || VAZIAS.has(palavra)) continue;
    saida.add(palavra.slice(0, 6));
  }
  return saida;
}

interface FrasePontuada { indice_da_citacao: number; ordem: number; fonte: AncoraV1; inicio: number; fim: number; pontos: number }

interface Recorte { ancora: AncoraV1; indice_da_citacao: number; cortada: boolean; frases: FrasePontuada[]; melhor: FrasePontuada }

/**
 * Pontua as frases de todas as citações do elemento pelo quanto repetem o enunciado (termos em comum,
 * normalizados pela raiz do tamanho da frase), com meio ponto por qualificador contido e `bonusDaPrimeira`
 * para a primeira frase da primeira citação — a frase de abertura costuma ser a que o modelo quis citar.
 */
function pontuarFrases(
  elemento: ElementoSemanticoV1, blocos: ReadonlyMap<Id, Pick<Bloco, 'id' | 'texto'>>, bonusDaPrimeira: number,
): FrasePontuada[] {
  const alvo = termos(elemento.enunciado);
  const saida: FrasePontuada[] = [];
  elemento.ancoras.forEach((fonte, indice) => {
    const bloco = blocos.get(fonte.bloco_id);
    if (!bloco) return;
    frasesDoTrecho(bloco.texto, fonte.inicio_utf16, fonte.fim_utf16).forEach((frase, ordem) => {
      const texto = bloco.texto.slice(frase.inicio, frase.fim);
      const proprios = termos(texto);
      let comuns = 0;
      for (const termo of proprios) if (alvo.has(termo)) comuns += 1;
      const qualificados = elemento.qualificadores.filter((termo) => texto.includes(termo)).length;
      const pontos = (comuns + 0.5 * qualificados) / Math.sqrt(Math.max(proprios.size, 1)) + (indice === 0 && ordem === 0 ? bonusDaPrimeira : 0);
      saida.push({ indice_da_citacao: indice, ordem, fonte, inicio: frase.inicio, fim: frase.fim, pontos });
    });
  });
  return saida;
}

/** Âncora de uma frase: a própria citação quando a frase é ela inteira; senão uma âncora nova no bloco. */
function ancoraDaFrase(frase: FrasePontuada, blocos: ReadonlyMap<Id, Pick<Bloco, 'id' | 'texto'>>): AncoraV1 | null {
  const { fonte } = frase;
  if (frase.inicio === fonte.inicio_utf16 && frase.fim === fonte.fim_utf16) return fonte;
  const bloco = blocos.get(fonte.bloco_id);
  return bloco ? ancoraDeSelecao({ ...bloco, versao_id: fonte.versao_id }, frase.inicio, frase.fim) : null;
}

/**
 * A frase em que o papel se realiza: a de maior pontuação entre as frases de todas as citações (empate: a
 * citação anterior na lista do modelo, depois a frase anterior). `soAPrimeira`: a primeira frase da primeira citação.
 */
export function recortarNaFrase(
  elemento: ElementoSemanticoV1, blocos: ReadonlyMap<Id, Pick<Bloco, 'id' | 'texto'>>, bonusDaPrimeira = 0, soAPrimeira = false,
): Recorte | null {
  const frases = pontuarFrases(elemento, blocos, bonusDaPrimeira);
  let melhor: FrasePontuada | undefined;
  for (const frase of frases) {
    if (soAPrimeira && (frase.indice_da_citacao > 0 || frase.ordem > 0)) continue;
    if (!melhor || frase.pontos > melhor.pontos + 1e-9) melhor = frase;
  }
  if (!melhor) return null;
  const ancora = ancoraDaFrase(melhor, blocos);
  if (!ancora) return null;
  return { ancora, indice_da_citacao: melhor.indice_da_citacao, cortada: ancora !== melhor.fonte, frases, melhor };
}

// ---------------------------------------------------------------- voz

/**
 * Sinais, no enunciado e nas notas que o próprio modelo escreveu, de que o trecho está na voz de outro:
 * interlocutor, parte, sentença recorrida, voto vencido, ironia, abertura que o autor corrige depois.
 */
const VOZ_ALHEIA = new RegExp([
  'ironi[ac]', 'irônic[oa]', 'sarcas', 'tese provisória', 'posição provisória', 'reconsider[oa]', 'depois corrig', 'corrigida adiante',
  'voto vencido', 'sentença recorrida', 'decisão recorrida', 'interlocutor', 'espantalho', 'caricatura d',
  'posição (?:a ser |que (?:o autor |o texto )?)?(?:refutad|rejeit|critic|combat)', 'segundo (?:ele|ela|eles|elas)\\b',
  'na voz d[eoa]', 'encenad[oa]', 'não é (?:a )?(?:tese|posição) do autor', 'atribuíd[oa] a (?:outr|terceir)',
].join('|'), 'iu');

export function vozAlheia(elemento: ElementoSemanticoV1): boolean {
  if (elemento.nucleo === 'objecao') return true;
  return VOZ_ALHEIA.test(elemento.enunciado) || elemento.notas.some((nota) => VOZ_ALHEIA.test(nota.texto));
}

// ---------------------------------------------------------------- papel nulo

/**
 * Função equivalente a cada núcleo, em ordem de preferência; só vale se o modo a tiver. `afirmacao`,
 * `elemento_textual` e `passo` não têm: um passo sem papel é, para o modelo, um passo trivial.
 */
const FUNCAO_DO_NUCLEO: Partial<Record<ElementoSemanticoV1['nucleo'], readonly string[]>> = {
  conceito: ['conceito', 'definicao'],
  hipotese: ['hipotese', 'premissa'],
  evidencia: ['evidencia'],
  exemplo: ['exemplo', 'caso', 'passo_nao_trivial'],
  objecao: ['objecao'],
};

function papelEfetivo(elemento: ElementoSemanticoV1, funcoes: ReadonlySet<string>, opcoes: OpcoesDaProjecao): { papel: string | null; padrao: boolean } {
  if (elemento.papel !== null && funcoes.has(elemento.papel)) return { papel: elemento.papel, padrao: false };
  if (!opcoes.papel_padrao || elemento.papel !== null) return { papel: null, padrao: false };
  const papel = (FUNCAO_DO_NUCLEO[elemento.nucleo] ?? []).find((chave) => funcoes.has(chave));
  return papel === undefined ? { papel: null, padrao: false } : { papel, padrao: true };
}

// ---------------------------------------------------------------- comentário

/**
 * Todo grifo tem nota na margem: a nota analítica do elemento, quando o modo a aceita; senão o que o
 * autor afirma ali (o enunciado). Um trecho grifado sem explicação deixava o leitor sem saber por quê.
 */
function comentarioDo(elemento: ElementoSemanticoV1, modo: ModoDeLeituraV1, papel: string | null): ComentarioV2 | null {
  const nota = elemento.notas.find((item) => modo.comentarios.includes(item.tipo));
  if (nota) return { tipo: nota.tipo, rotulo: ROTULO_DA_NOTA[nota.tipo], texto: nota.texto };
  if (!modo.comentarios.includes('AUTOR')) return null;
  const funcao = modo.funcoes.find((item) => item.chave === papel);
  const oque = funcao ? funcao.rotulo.toLocaleUpperCase('pt-BR') : ROTULO_DO_NUCLEO[elemento.nucleo];
  return { tipo: 'AUTOR', rotulo: `AUTOR · ${oque}`, texto: elemento.enunciado };
}

function sobrepoe(a: AncoraV1, b: AncoraV1): boolean {
  return a.bloco_id === b.bloco_id && a.inicio_utf16 < b.fim_utf16 && b.inicio_utf16 < a.fim_utf16;
}

// ---------------------------------------------------------------- saliência

/** Quantas relações chegam ao elemento (quem o suporta, o pressupõe, o exemplifica, lhe responde…). */
export function dependentes(relacoes: readonly RelacaoSemanticaV1[]): Map<Id, number> {
  const contagem = new Map<Id, number>();
  for (const relacao of relacoes) contagem.set(relacao.destino_id, (contagem.get(relacao.destino_id) ?? 0) + 1);
  return contagem;
}

/**
 * Rebaixa o excedente sobre `alvo_por_nivel`: no nível 1 (e depois no 2), as marcas coloridas entram em
 * ordem de dependentes (mais primeiro) e, no empate, de posição no texto, enquanto a cobertura cabe no
 * alvo; as que não cabem descem um nível. A primeira de cada nível sempre fica, para o nível não sumir.
 */
function aplicarAlvo(
  aceitas: MarcaProjetada[], modo: ModoDeLeituraV1, total: number, deps: ReadonlyMap<Id, number>, ordem: (item: MarcaProjetada) => number,
  fator: number, niveis: 1 | 2, diagnosticos: DiagnosticoDaProjecao[],
): void {
  if (total === 0) return;
  for (const nivel of niveis === 1 ? [1] as const : [1, 2] as const) {
    const alvo = modo.saliencia.alvo_por_nivel[String(nivel) as '1' | '2'] * fator;
    const acima = aceitas.filter((item) => item.marca.funcao !== 'nenhuma' && item.marca.saliencia < nivel)
      .reduce((soma, item) => soma + tamanho(item.marca.ancora), 0);
    const doNivel = aceitas.filter((item) => item.marca.funcao !== 'nenhuma' && item.marca.saliencia === nivel)
      .sort((a, b) => (deps.get(b.elemento_id) ?? 0) - (deps.get(a.elemento_id) ?? 0) || ordem(a) - ordem(b));
    let coberto = acima;
    doNivel.forEach((item, indice) => {
      const depois = coberto + tamanho(item.marca.ancora);
      if (indice === 0 || depois / total <= alvo) { coberto = depois; return; }
      item.marca = { ...item.marca, saliencia: (nivel + 1) as Saliencia };
      diagnosticos.push({ codigo: 'saliencia_rebaixada_pelo_alvo', elemento_id: item.elemento_id,
        mensagem: `Nível ${String(nivel)} já cobre o alvo do modo (${(alvo * 100).toFixed(0)}%); a marca desce para ${String(nivel + 1)}.` });
    });
  }
}

function tamanho(ancora: AncoraV1): number { return ancora.fim_utf16 - ancora.inicio_utf16; }

export { derivarRetrospectivas } from './retrospectivas.js';



/**
 * Os trechos que viram marca de um elemento: só o recorte (`uma`); o recorte e as outras frases das citações
 * que pontuam pelo menos `limiar` × a pontuação do recorte (`por_frase`); ou cada citação inteira (`por_citacao`).
 * O principal fica com a centralidade do elemento; os demais, um nível abaixo.
 */
function pedacosDoElemento(
  elemento: ElementoSemanticoV1, recorte: Recorte | null, blocos: ReadonlyMap<Id, Pick<Bloco, 'id' | 'texto'>>,
  modo: OpcoesDaProjecao['marcas'], limiar: number,
): { ancora: AncoraV1; principal: boolean }[] {
  const principal = recorte?.ancora ?? elemento.ancoras[0];
  if (!principal) return [];
  const pedacos: { ancora: AncoraV1; principal: boolean }[] = [{ ancora: principal, principal: true }];
  if (modo === 'uma') return pedacos;
  const outros: AncoraV1[] = modo === 'por_citacao'
    ? elemento.ancoras
    : (recorte?.frases ?? []).filter((frase) => frase !== recorte?.melhor && frase.pontos >= limiar * (recorte?.melhor.pontos ?? 0))
      .map((frase) => ancoraDaFrase(frase, blocos)).filter((ancora): ancora is AncoraV1 => ancora !== null);
  for (const ancora of outros) {
    if (ancora.bloco_id === principal.bloco_id && ancora.inicio_utf16 < principal.fim_utf16 && principal.inicio_utf16 < ancora.fim_utf16) continue;
    pedacos.push({ ancora, principal: false });
  }
  return pedacos;
}

// ---------------------------------------------------------------- projeção

const ID_PROVISORIO = '00000000000000000000000000';
const DATA_PROVISORIA = '1970-01-01T00:00:00Z';

export function projetarMarcas(
  modelo: ModeloDoCapituloV1, contexto: ContextoDaProjecao, opcoes: OpcoesDaProjecao = PROJECAO_PADRAO,
): ProjecaoDeMarcas {
  const { modo } = contexto;
  const funcoes = new Set(modo.funcoes.map((funcao) => funcao.chave));
  const blocos = new Map(contexto.blocos.map((bloco) => [bloco.id, bloco]));
  const ordemDoBloco = new Map(contexto.blocos.map((bloco, indice) => [bloco.id, indice]));
  const textoDoCapitulo = opcoes.aliases ? contexto.blocos.map((bloco) => bloco.texto).join('\n') : '';
  const deps = dependentes(modelo.relacoes);
  const diagnosticos: DiagnosticoDaProjecao[] = [];
  const candidatos = [...modelo.elementos].sort((a, b) => {
    const pa = a.ancoras[0];
    const pb = b.ancoras[0];
    return a.centralidade - b.centralidade
      || (opcoes.alvo ? (deps.get(b.id) ?? 0) - (deps.get(a.id) ?? 0) : 0)
      || (ordemDoBloco.get(pa?.bloco_id ?? '') ?? 0) - (ordemDoBloco.get(pb?.bloco_id ?? '') ?? 0)
      || (pa?.inicio_utf16 ?? 0) - (pb?.inicio_utf16 ?? 0);
  });
  const aceitas: MarcaProjetada[] = [];
  for (const elemento of candidatos) {
    const principal = elemento.ancoras[0];
    if (!principal || !blocos.get(principal.bloco_id)) {
      diagnosticos.push({ codigo: 'fora_do_capitulo', mensagem: 'A âncora principal não está nos blocos do capítulo.', elemento_id: elemento.id });
      continue;
    }
    const recorte = opcoes.recorte === 'primeira' ? null : recortarNaFrase(elemento, blocos, opcoes.bonus_da_primeira, opcoes.recorte === 'primeira_frase');
    const efetivo = papelEfetivo(elemento, funcoes, opcoes);
    const { padrao } = efetivo;
    let { papel } = efetivo;
    if (padrao && papel !== null) {
      diagnosticos.push({ codigo: 'papel_padrao_do_nucleo', elemento_id: elemento.id,
        mensagem: `Sem papel no modelo; o núcleo ${elemento.nucleo} projeta como ${papel}.` });
    }
    if (opcoes.voz && papel === 'tese' && vozAlheia(elemento)) {
      const substituto = funcoes.has('objecao') && elemento.nucleo === 'objecao' ? 'objecao' : null;
      diagnosticos.push({ codigo: 'tese_em_voz_alheia', elemento_id: elemento.id,
        mensagem: `O elemento fala por outra voz (objeção, parte, ironia ou tese provisória); projeta como ${substituto ?? 'marca sem cor'}, não como tese.` });
      papel = substituto;
    }
    const comCor = papel !== null;
    let comentario = comentarioDo(elemento, modo, papel);
    if (!comCor && comentario === null) continue;
    if (comentario && opcoes.aliases) {
      const limpo = retirarAliases(comentario.texto, textoDoCapitulo);
      if (limpo !== comentario.texto) {
        diagnosticos.push({ codigo: 'alias_no_comentario', elemento_id: elemento.id, mensagem: 'O comentário citava aliases internos do prompt; foram retirados.' });
        comentario = limpo === '' ? null : { ...comentario, texto: limpo };
      }
      if (!comCor && comentario === null) continue;
    }
    const funcao = papel ?? 'nenhuma';
    const pedacos = pedacosDoElemento(elemento, recorte, blocos, comCor ? opcoes.marcas : 'uma', opcoes.limiar_da_frase_extra);
    pedacos.forEach((pedaco, ordem) => {
      const { ancora } = pedaco;
      const bloco = blocos.get(ancora.bloco_id);
      if (!bloco) return;
      if (funcao !== 'nenhuma') {
        const conflito = aceitas.find((outra) => outra.marca.funcao !== 'nenhuma' && sobrepoe(outra.marca.ancora, ancora));
        if (conflito) {
          diagnosticos.push({ codigo: 'sobreposicao_na_projecao', elemento_id: elemento.id,
            mensagem: `Sobrepõe a marca do elemento ${conflito.elemento_id}, mais central ou anterior, que fica.` });
          return;
        }
      }
      const qualificadores = ancora === principal ? elemento.qualificadores : elemento.qualificadores.filter((termo) => ancora.citacao.includes(termo));
      if (ordem === 0 && qualificadores.length < elemento.qualificadores.length && pedacos.length === 1) {
        diagnosticos.push({ codigo: 'qualificador_fora_do_recorte', elemento_id: elemento.id,
          mensagem: `Qualificadores fora da frase recortada: ${elemento.qualificadores.filter((termo) => !qualificadores.includes(termo)).join(', ')}.` });
      }
      const { subfaixas, nao_resolvidas } = resolverSubfaixas({ ...bloco, versao_id: ancora.versao_id }, ancora, qualificadores);
      if (nao_resolvidas.length > 0) {
        diagnosticos.push({ codigo: 'sublinhar_nao_resolvido', elemento_id: elemento.id,
          mensagem: `Qualificadores sem ocorrência única na citação: ${nao_resolvidas.map((item) => item.texto).join(', ')}.` });
      }
      const saliencia = Math.min(3, elemento.centralidade + (pedaco.principal ? 0 : 1)) as Saliencia;
      const marca: MarcaSemIdentidade = {
        ancora, funcao, saliencia, subfaixas, comentario,
        origem: 'projecao', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada',
        camada_id: contexto.camada_id, modo: { id: modo.id, revisao: modo.revisao }, execucao_id: contexto.camada_id,
        ...(contexto.job_id === undefined ? {} : { job_id: contexto.job_id }),
      };
      if (!validarMarcaV2({ ...marca, id: ID_PROVISORIO, criada_em: DATA_PROVISORIA })) {
        diagnosticos.push({ codigo: 'marca_invalida', mensagem: 'A marca projetada não satisfaz MarcaV2.', elemento_id: elemento.id });
        return;
      }
      aceitas.push({ marca, elemento_id: elemento.id });
    });
  }
  const total = contexto.blocos.reduce((soma, bloco) => soma + bloco.texto.length, 0);
  const posicaoNoTexto = (item: MarcaProjetada): number => (ordemDoBloco.get(item.marca.ancora.bloco_id) ?? 0) * 1e7 + item.marca.ancora.inicio_utf16;
  if (opcoes.alvo) aplicarAlvo(aceitas, modo, total, deps, posicaoNoTexto, opcoes.fator_do_alvo, opcoes.niveis_do_alvo, diagnosticos);
  const cobertura = ([1, 2, 3] as const).map((nivel) => {
    const coberto = aceitas.filter((item) => item.marca.saliencia <= nivel && item.marca.funcao !== 'nenhuma')
      .reduce((soma, item) => soma + tamanho(item.marca.ancora), 0);
    return { nivel, fracao: total === 0 ? 0 : coberto / total, alvo: modo.saliencia.alvo_por_nivel[String(nivel) as '1' | '2' | '3'] };
  });
  // A ordem de publicação segue o texto, para a auditoria e para a web.
  aceitas.sort((a, b) => posicaoNoTexto(a) - posicaoNoTexto(b));
  return { marcas: aceitas, diagnosticos, cobertura };
}
