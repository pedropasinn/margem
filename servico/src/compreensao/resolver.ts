/**
 * Resolvedor da compreensão (J29, `docs/desenho/10-MODELO-DO-CAPITULO.md` §4): da saída do modelo, com
 * aliases e citações, para elementos, relações, dificuldades e operações com ids do serviço e âncoras.
 *
 * Regras: alias desconhecido ou fora do escopo descarta **só** o item (ou a operação), com diagnóstico;
 * citação ausente ou ambígua nunca vira a primeira ocorrência; elemento sem nenhuma âncora não existe.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ValidateFunction } from 'ajv';
import { ulid } from 'ulid';
import type {
  AncoraV1, ApoioPedagogicoV1, Bloco, PassoPedagogicoV1, DificuldadeTextualV1, ElementoSemanticoV1, EstagioDoModelo, Id, ModeloDoCapituloV1,
  ModoDeLeituraV1, MovimentoDoCapituloV1, OperacaoDoModeloV1, RelacaoSemanticaV1, UnidadeDeLeituraV1,
} from '@margem/contratos';
import { localizarCitacao } from '@margem/contratos';
import { conferirTextoAncora } from '@margem/contratos/regras';
import { aplicarOperacoes, particionarPorInicios, type AliasesDoPrompt, type TabelaDeAliases } from '@margem/core';
import { traduzirAliasesNoTexto, type FontesDosAliases } from './aliases-no-texto.js';
import { retrospectivaPelaOrdem } from './retrospectivas.js';
import {
  schemaDaEtapa, type CamposDeElementoGerado, type CitacaoGerada, type DificuldadeGerada, type OperacaoGerada,
  type SaidaDaAnalise, type SaidaDaRevisao, type SaidaDaSintese, type SaidaDoPlano,
} from './prompts.js';

type BlocoResolvivel = Pick<Bloco, 'id' | 'texto'>;

export interface DiagnosticoDaCompreensao {
  codigo: string;
  mensagem: string;
  /** `descartada`: o item não entra; `mantida`: entra com ressalva. */
  efeito: 'descartada' | 'mantida';
  /** Onde, na saída do modelo (`/elementos/3`, `/operacoes/7`). */
  caminho: string;
}

export class SaidaInvalida extends Error {
  constructor(etapa: string, public readonly problemas: string[]) {
    super(`Saída da ${etapa} fora do schema: ${problemas.join('; ')}`);
    this.name = 'SaidaInvalida';
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validadores = new Map<string, ValidateFunction>();
/** Confere a saída contra o schema versionado (sem a especialização por modo, que o resolvedor refaz). */
export function lerSaida<T>(etapa: 'analise' | 'sintese' | 'revisao' | 'plano', bruto: unknown): T {
  let validar = validadores.get(etapa);
  if (!validar) {
    validar = ajv.compile(schemaDaEtapa(etapa) as AnySchema);
    validadores.set(etapa, validar);
  }
  if (!validar(bruto)) {
    throw new SaidaInvalida(etapa, (validar.errors ?? []).slice(0, 5).map((erro) => `${erro.instancePath || '/'} ${erro.message ?? 'inválido'}`));
  }
  return bruto as T;
}

/** Palavras que denunciam uma dificuldade descrita pelo leitor, não pelo texto (09, princípio 4). */
const FALA_DO_LEITOR = /(?<!\p{L})(leitor|leitora|leitores|pedro|voc[eê]s?)(?!\p{L})/iu;
export function falaDoLeitor(texto: string): boolean { return FALA_DO_LEITOR.test(texto); }

interface ContextoBase {
  versao_id: Id;
  job_id: Id;
  modo: ModoDeLeituraV1;
  aliases: AliasesDoPrompt;
  novoId?: () => Id;
  /**
   * Blocos do capítulo inteiro, em ordem (J76): dão a ordem para derivar retrospectivas, o texto em que um
   * token como "L10" é do autor e não alias, e o trecho que traduz um `B…` fora da janela. Ausente: os blocos da etapa.
   */
  blocosDoCapitulo?: readonly BlocoResolvivel[];
}

/** Aplica a tradução de aliases a um texto livre (J76); devolve o mesmo texto quando não há alias. */
type Tradutor = (texto: string) => string;
function tradutor(fontes: FontesDosAliases): Tradutor { return (texto) => traduzirAliasesNoTexto(texto, fontes); }

function traduzirElemento(elemento: ElementoSemanticoV1, traduzir: Tradutor): ElementoSemanticoV1 {
  return { ...elemento, enunciado: traduzir(elemento.enunciado), notas: elemento.notas.map((nota) => ({ ...nota, texto: traduzir(nota.texto) })) };
}

function papelDoModo(papel: string | null, modo: ModoDeLeituraV1): { papel: string | null; valido: boolean } {
  if (papel === null) return { papel: null, valido: true };
  return modo.funcoes.some((funcao) => funcao.chave === papel) ? { papel, valido: true } : { papel: null, valido: false };
}

/** Uma citação gerada vira âncora, se o bloco é permitido e a citação é única e literal. */
function resolverCitacao(
  citacao: CitacaoGerada, blocos: ReadonlyMap<Id, BlocoResolvivel>, contexto: ContextoBase, caminho: string,
  diagnosticos: DiagnosticoDaCompreensao[],
): AncoraV1 | null {
  const id = contexto.aliases.blocos.id(citacao.bloco);
  const bloco = id === undefined ? undefined : blocos.get(id);
  if (!bloco) {
    diagnosticos.push({ codigo: 'bloco_fora_do_escopo', efeito: 'descartada', caminho,
      mensagem: `O bloco ${citacao.bloco} não é um dos que esta etapa podia citar.` });
    return null;
  }
  const local = localizarCitacao(bloco, citacao.citacao, citacao.prefixo, citacao.sufixo);
  if (local.tipo !== 'unica') {
    diagnosticos.push({
      codigo: local.tipo === 'ausente' ? 'citacao_ausente' : 'citacao_ambigua', efeito: 'descartada', caminho,
      mensagem: local.tipo === 'ausente'
        ? `A citação “${citacao.citacao.slice(0, 80)}” não aparece literalmente em ${citacao.bloco}.`
        : `${String(local.ocorrencias)} ocorrências de “${citacao.citacao.slice(0, 80)}” em ${citacao.bloco}; falta prefixo ou sufixo.`,
    });
    return null;
  }
  const ancora: AncoraV1 = {
    versao_id: contexto.versao_id, bloco_id: bloco.id, citacao: citacao.citacao, prefixo: citacao.prefixo, sufixo: citacao.sufixo,
    inicio_utf16: local.inicio_utf16, fim_utf16: local.fim_utf16,
  };
  if (!conferirTextoAncora(bloco, ancora)) {
    diagnosticos.push({ codigo: 'citacao_ausente', efeito: 'descartada', caminho, mensagem: 'A citação corta um caractere ao meio.' });
    return null;
  }
  return ancora;
}

function resolverCitacoes(
  citacoes: readonly CitacaoGerada[], blocos: ReadonlyMap<Id, BlocoResolvivel>, contexto: ContextoBase, caminho: string,
  diagnosticos: DiagnosticoDaCompreensao[],
): AncoraV1[] {
  const ancoras: AncoraV1[] = [];
  citacoes.forEach((citacao, indice) => {
    const ancora = resolverCitacao(citacao, blocos, contexto, `${caminho}/citacoes/${String(indice)}`, diagnosticos);
    if (ancora && !ancoras.some((outra) => outra.bloco_id === ancora.bloco_id && outra.inicio_utf16 === ancora.inicio_utf16
      && outra.fim_utf16 === ancora.fim_utf16)) ancoras.push(ancora);
  });
  return ancoras;
}

/** Os campos de um elemento gerado viram `ElementoSemanticoV1`, ou `null` sem âncora. */
function resolverElemento(
  gerado: CamposDeElementoGerado, id: Id, estagio: EstagioDoModelo, blocos: ReadonlyMap<Id, BlocoResolvivel>,
  contexto: ContextoBase, caminho: string, diagnosticos: DiagnosticoDaCompreensao[],
): ElementoSemanticoV1 | null {
  const ancoras = resolverCitacoes(gerado.citacoes, blocos, contexto, caminho, diagnosticos);
  const principal = ancoras[0];
  if (!principal) {
    diagnosticos.push({ codigo: 'elemento_sem_ancora', efeito: 'descartada', caminho, mensagem: 'Nenhuma citação do elemento se resolveu.' });
    return null;
  }
  const papel = papelDoModo(gerado.papel, contexto.modo);
  if (!papel.valido) {
    diagnosticos.push({ codigo: 'papel_fora_do_modo', efeito: 'mantida', caminho,
      mensagem: `O papel "${String(gerado.papel)}" não é do modo ${contexto.modo.id}; o elemento fica sem papel.` });
  }
  const qualificadores = [...new Set(gerado.qualificadores)].filter((termo) => principal.citacao.includes(termo));
  if (qualificadores.length < new Set(gerado.qualificadores).size) {
    diagnosticos.push({ codigo: 'qualificador_fora_da_citacao', efeito: 'mantida', caminho,
      mensagem: 'Qualificadores que não estão na citação principal foram retirados.' });
  }
  return {
    id, nucleo: gerado.nucleo, papel: papel.papel, ancoras, enunciado: gerado.enunciado, qualificadores,
    centralidade: gerado.centralidade, notas: gerado.notas.map((nota) => ({ ...nota })),
    origem: { estagio, job_id: contexto.job_id },
  };
}

function resolverDificuldade(
  gerada: DificuldadeGerada, id: Id, estagio: EstagioDoModelo, blocos: ReadonlyMap<Id, BlocoResolvivel>,
  contexto: ContextoBase, caminho: string, diagnosticos: DiagnosticoDaCompreensao[],
): DificuldadeTextualV1 | null {
  if (falaDoLeitor(gerada.descricao)) {
    diagnosticos.push({ codigo: 'dificuldade_fala_do_leitor', efeito: 'descartada', caminho,
      mensagem: 'A descrição fala do leitor, não do texto; dificuldades do leitor pertencem ao plano pedagógico.' });
    return null;
  }
  const ancoras = resolverCitacoes(gerada.citacoes, blocos, contexto, caminho, diagnosticos);
  if (ancoras.length === 0) {
    diagnosticos.push({ codigo: 'dificuldade_sem_ancora', efeito: 'descartada', caminho, mensagem: 'Nenhuma citação da dificuldade se resolveu.' });
    return null;
  }
  return { id, tipo: gerada.tipo, ancoras, descricao: gerada.descricao, origem: { estagio, job_id: contexto.job_id } };
}

// ---------------------------------------------------------------- análise local

export interface AnaliseResolvida {
  elementos: ElementoSemanticoV1[];
  relacoes: RelacaoSemanticaV1[];
  dificuldades: DificuldadeTextualV1[];
  resumo_da_parte: string;
  limites: string[];
  leitura_integral: boolean;
  diagnosticos: DiagnosticoDaCompreensao[];
}

export interface ContextoDaAnalise extends ContextoBase {
  /** Só os responsáveis: blocos de contexto não se citam. */
  responsaveis: readonly BlocoResolvivel[];
}

export function resolverAnalise(bruto: unknown, contexto: ContextoDaAnalise): AnaliseResolvida {
  const saida = lerSaida<SaidaDaAnalise>('analise', bruto);
  const novoId = contexto.novoId ?? ulid;
  const blocos = new Map(contexto.responsaveis.map((bloco) => [bloco.id, bloco]));
  const diagnosticos: DiagnosticoDaCompreensao[] = [];
  const porRef = new Map<string, Id>();
  const elementos: ElementoSemanticoV1[] = [];
  saida.elementos.forEach((gerado, indice) => {
    const caminho = `/elementos/${String(indice)}`;
    if (porRef.has(gerado.ref)) {
      diagnosticos.push({ codigo: 'ref_repetida', efeito: 'descartada', caminho, mensagem: `A ref ${gerado.ref} já foi usada.` });
      return;
    }
    const elemento = resolverElemento(gerado, novoId(), 'analise_local', blocos, contexto, caminho, diagnosticos);
    if (!elemento) return;
    porRef.set(gerado.ref, elemento.id);
    elementos.push(elemento);
  });
  const capitulo = contexto.blocosDoCapitulo ?? contexto.responsaveis;
  const posicao = new Map(capitulo.map((bloco, indice) => [bloco.id, indice]));
  const blocoDe = (id: Id): number | undefined => posicao.get(elementos.find((item) => item.id === id)?.ancoras[0]?.bloco_id ?? '');
  const relacoes: RelacaoSemanticaV1[] = [];
  saida.relacoes.forEach((gerada, indice) => {
    const caminho = `/relacoes/${String(indice)}`;
    const origem = porRef.get(gerada.origem);
    const destino = porRef.get(gerada.destino);
    if (origem === undefined || destino === undefined || origem === destino) {
      diagnosticos.push({ codigo: 'relacao_sem_elemento', efeito: 'descartada', caminho,
        mensagem: `A relação ${gerada.origem} → ${gerada.destino} aponta para elemento inexistente, descartado ou para si mesma.` });
      return;
    }
    relacoes.push({
      id: novoId(), tipo: gerada.tipo, origem_id: origem, destino_id: destino, explicacao: gerada.explicacao,
      confianca: gerada.confianca, retrospectiva: retrospectivaPelaOrdem(gerada.tipo, blocoDe(origem), blocoDe(destino)),
      origem: { estagio: 'analise_local', job_id: contexto.job_id },
    });
  });
  const dificuldades: DificuldadeTextualV1[] = [];
  saida.dificuldades.forEach((gerada, indice) => {
    const dificuldade = resolverDificuldade(gerada, novoId(), 'analise_local', blocos, contexto, `/dificuldades/${String(indice)}`, diagnosticos);
    if (dificuldade) dificuldades.push(dificuldade);
  });
  const traduzir = tradutor({
    aliases: contexto.aliases, blocos: new Map(capitulo.map((bloco) => [bloco.id, bloco])), novos: porRef,
    elemento: (id) => elementos.find((item) => item.id === id), textoDoCapitulo: capitulo.map((bloco) => bloco.texto).join('\n'),
  });
  return {
    elementos: elementos.map((elemento) => traduzirElemento(elemento, traduzir)),
    relacoes: relacoes.map((relacao) => ({ ...relacao, explicacao: traduzir(relacao.explicacao) })),
    dificuldades: dificuldades.map((dificuldade) => ({ ...dificuldade, descricao: traduzir(dificuldade.descricao) })),
    resumo_da_parte: traduzir(saida.resumo_da_parte), limites: saida.limites,
    leitura_integral: saida.leitura_integral, diagnosticos,
  };
}

// ---------------------------------------------------------------- operações (síntese e revisão)

export interface ContextoDasOperacoes extends ContextoBase {
  estagio: 'sintese' | 'revisao';
  /** A revisão de que as operações partem. */
  base: ModeloDoCapituloV1;
  /** Blocos que as operações podem citar (o capítulo, ou a janela da revisão). */
  blocos: readonly BlocoResolvivel[];
  /** Na revisão por janela: os elementos em que se pode operar. Ausente = todos. */
  elementosPermitidos?: ReadonlySet<Id>;
}

export interface OperacoesResolvidas {
  operacoes: OperacaoDoModeloV1[];
  diagnosticos: DiagnosticoDaCompreensao[];
  /** O modelo depois das operações, com a base como ponto de partida (id e revisão ainda os da base). */
  resultado: ModeloDoCapituloV1;
}

const REVISAO_DE_TRABALHO = { id: '00000000000000000000000000', estagio: 'sintese' as const, lote_id: '00000000000000000000000000', criada_em: '1970-01-01T00:00:00Z' };

/**
 * Operações geradas → `OperacaoDoModeloV1`, na ordem, cada uma conferida contra o estado que as
 * anteriores deixaram. O `antes` vem sempre do serviço; o modelo nunca o informa.
 */
export function resolverOperacoes(geradas: readonly OperacaoGerada[], contexto: ContextoDasOperacoes): OperacoesResolvidas {
  const novoId = contexto.novoId ?? ulid;
  const blocos = new Map(contexto.blocos.map((bloco) => [bloco.id, bloco]));
  const diagnosticos: DiagnosticoDaCompreensao[] = [];
  const operacoes: OperacaoDoModeloV1[] = [];
  const criadosAqui = new Map<string, Id>();
  const permitidosNovos = new Set<Id>();
  let atual: ModeloDoCapituloV1 = structuredClone(contexto.base);

  const elementoDe = (alias: string): ElementoSemanticoV1 | undefined => {
    const id = alias.startsWith('n') ? criadosAqui.get(alias) : contexto.aliases.elementos.id(alias);
    return id === undefined ? undefined : atual.elementos.find((item) => item.id === id);
  };
  const permitido = (id: Id): boolean => contexto.elementosPermitidos === undefined
    || contexto.elementosPermitidos.has(id) || permitidosNovos.has(id);
  const evidencia = (aliases: readonly string[], caminho: string): AncoraV1[] => {
    const ancoras: AncoraV1[] = [];
    for (const alias of aliases) {
      const elemento = elementoDe(alias);
      if (!elemento) {
        diagnosticos.push({ codigo: 'evidencia_desconhecida', efeito: 'mantida', caminho, mensagem: `A evidência ${alias} não existe; ignorada.` });
        continue;
      }
      const principal = elemento.ancoras[0];
      if (principal) ancoras.push(principal);
    }
    return ancoras;
  };
  const capitulo = contexto.blocosDoCapitulo ?? contexto.blocos;
  const posicao = new Map(capitulo.map((bloco, indice) => [bloco.id, indice]));
  const traduzir = tradutor({
    aliases: contexto.aliases, blocos: new Map(capitulo.map((bloco) => [bloco.id, bloco])), novos: criadosAqui,
    elemento: (id) => atual.elementos.find((item) => item.id === id),
    relacao: (id) => atual.relacoes.find((item) => item.id === id),
    dificuldade: (id) => atual.dificuldades.find((item) => item.id === id),
    unidade: (id) => atual.unidades.find((item) => item.id === id),
    textoDoCapitulo: capitulo.map((bloco) => bloco.texto).join('\n'),
  });
  const aceitar = (operacao: OperacaoDoModeloV1): void => {
    atual = aplicarOperacoes(atual, [operacao], { ...REVISAO_DE_TRABALHO, estagio: contexto.estagio });
    operacoes.push(operacao);
  };

  geradas.forEach((gerada, indice) => {
    const caminho = `/operacoes/${String(indice)}`;
    const descartar = (codigo: string, mensagem: string): void => {
      diagnosticos.push({ codigo, mensagem, efeito: 'descartada', caminho });
    };
    const base = { ordem: operacoes.length, motivo: gerada.motivo, evidencia: evidencia(gerada.evidencia, caminho) };
    const alvoElemento = (alias: string): ElementoSemanticoV1 | undefined => {
      const elemento = elementoDe(alias);
      if (!elemento) { descartar('alias_desconhecido', `O elemento ${alias} não existe.`); return undefined; }
      if (!permitido(elemento.id)) { descartar('fora_da_janela', `O elemento ${alias} não está ancorado nesta janela.`); return undefined; }
      return elemento;
    };
    switch (gerada.op) {
      case 'promover':
      case 'rebaixar': {
        const alvo = alvoElemento(gerada.alvo);
        if (!alvo) return;
        if (gerada.para === alvo.centralidade) { descartar('sem_efeito', `${gerada.alvo} já tem centralidade ${String(gerada.para)}.`); return; }
        const op = gerada.para < alvo.centralidade ? 'promover' : 'rebaixar';
        if (op !== gerada.op) {
          diagnosticos.push({ codigo: 'direcao_corrigida', efeito: 'mantida', caminho,
            mensagem: `Pedido ${gerada.op} de ${String(alvo.centralidade)} para ${String(gerada.para)}: registrado como ${op} (1 é o mais central).` });
        }
        aceitar({ ...base, op, alvo_id: alvo.id, antes: { centralidade: alvo.centralidade }, depois: { centralidade: gerada.para } });
        return;
      }
      case 'corrigir_papel': {
        const alvo = alvoElemento(gerada.alvo);
        if (!alvo) return;
        const papel = papelDoModo(gerada.papel, contexto.modo);
        if (!papel.valido) { descartar('papel_fora_do_modo', `O papel "${String(gerada.papel)}" não é do modo.`); return; }
        if (alvo.nucleo === gerada.nucleo && alvo.papel === papel.papel) { descartar('sem_efeito', 'Núcleo e papel já são esses.'); return; }
        aceitar({ ...base, op: 'corrigir_papel', alvo_id: alvo.id, antes: { nucleo: alvo.nucleo, papel: alvo.papel },
          depois: { nucleo: gerada.nucleo, papel: papel.papel } });
        return;
      }
      case 'reescrever_enunciado': {
        const alvo = alvoElemento(gerada.alvo);
        if (!alvo) return;
        if (alvo.enunciado === gerada.enunciado) { descartar('sem_efeito', 'O enunciado já é esse.'); return; }
        aceitar({ ...base, op: 'reescrever_enunciado', alvo_id: alvo.id, antes: { enunciado: alvo.enunciado }, depois: { enunciado: traduzir(gerada.enunciado) } });
        return;
      }
      case 'acrescentar_nota': {
        const alvo = alvoElemento(gerada.alvo);
        if (!alvo) return;
        aceitar({ ...base, op: 'acrescentar_nota', alvo_id: alvo.id, antes: null, depois: { tipo: gerada.tipo, texto: traduzir(gerada.texto) } });
        return;
      }
      case 'fundir': {
        const alvo = alvoElemento(gerada.alvo);
        if (!alvo) return;
        const absorvidos: ElementoSemanticoV1[] = [];
        for (const alias of gerada.absorvidos) {
          const elemento = alvoElemento(alias);
          if (!elemento) return;
          if (elemento.id === alvo.id) { descartar('fundir_em_si', `${alias} não pode absorver a si mesmo.`); return; }
          absorvidos.push(elemento);
        }
        const ancoras = [...alvo.ancoras];
        for (const ancora of absorvidos.flatMap((elemento) => elemento.ancoras)) {
          if (!ancoras.some((outra) => outra.bloco_id === ancora.bloco_id && outra.inicio_utf16 === ancora.inicio_utf16 && outra.fim_utf16 === ancora.fim_utf16)) {
            ancoras.push(ancora);
          }
        }
        aceitar({ ...base, op: 'fundir', alvo_id: alvo.id, antes: { absorvidos: structuredClone(absorvidos) }, depois: { ancoras } });
        return;
      }
      case 'remover_elemento': {
        const alvo = alvoElemento(gerada.alvo);
        if (!alvo) return;
        aceitar({ ...base, op: 'remover_elemento', alvo_id: alvo.id, antes: structuredClone(alvo), depois: null });
        return;
      }
      case 'adicionar_elemento': {
        if (criadosAqui.has(gerada.ref)) { descartar('ref_repetida', `A ref ${gerada.ref} já foi usada nesta resposta.`); return; }
        const resolvido = resolverElemento(gerada, novoId(), contexto.estagio, blocos, contexto, caminho, diagnosticos);
        if (!resolvido) return;
        const elemento = traduzirElemento(resolvido, traduzir);
        criadosAqui.set(gerada.ref, elemento.id);
        permitidosNovos.add(elemento.id);
        aceitar({ ...base, op: 'adicionar_elemento', alvo_id: elemento.id, antes: null, depois: elemento });
        return;
      }
      case 'criar_relacao': {
        if (criadosAqui.has(gerada.ref)) { descartar('ref_repetida', `A ref ${gerada.ref} já foi usada nesta resposta.`); return; }
        const origem = elementoDe(gerada.origem);
        const destino = elementoDe(gerada.destino);
        if (!origem || !destino) { descartar('alias_desconhecido', `Relação ${gerada.origem} → ${gerada.destino} com ponta inexistente.`); return; }
        if (origem.id === destino.id) { descartar('relacao_em_si', 'A relação liga um elemento a ele mesmo.'); return; }
        if (!permitido(origem.id) && !permitido(destino.id)) { descartar('fora_da_janela', 'Nenhuma ponta da relação está nesta janela.'); return; }
        if (atual.relacoes.some((item) => item.tipo === gerada.tipo && item.origem_id === origem.id && item.destino_id === destino.id)) {
          descartar('sem_efeito', 'A relação já existe.'); return;
        }
        const relacao: RelacaoSemanticaV1 = {
          id: novoId(), tipo: gerada.tipo, origem_id: origem.id, destino_id: destino.id, explicacao: traduzir(gerada.explicacao),
          confianca: gerada.confianca,
          retrospectiva: gerada.retrospectiva
            || retrospectivaPelaOrdem(gerada.tipo, posicao.get(origem.ancoras[0]?.bloco_id ?? ''), posicao.get(destino.ancoras[0]?.bloco_id ?? '')),
          origem: { estagio: contexto.estagio, job_id: contexto.job_id },
        };
        criadosAqui.set(gerada.ref, relacao.id);
        aceitar({ ...base, op: 'criar_relacao', alvo_id: relacao.id, antes: null, depois: relacao });
        return;
      }
      case 'remover_relacao': {
        const id = contexto.aliases.relacoes.id(gerada.alvo);
        const relacao = id === undefined ? undefined : atual.relacoes.find((item) => item.id === id);
        if (!relacao) { descartar('alias_desconhecido', `A relação ${gerada.alvo} não existe.`); return; }
        if (!permitido(relacao.origem_id) && !permitido(relacao.destino_id)) { descartar('fora_da_janela', 'A relação não toca esta janela.'); return; }
        aceitar({ ...base, op: 'remover_relacao', alvo_id: relacao.id, antes: structuredClone(relacao), depois: null });
        return;
      }
      case 'adicionar_dificuldade': {
        const resolvida = resolverDificuldade(gerada, novoId(), contexto.estagio, blocos, contexto, caminho, diagnosticos);
        if (!resolvida) return;
        const dificuldade = { ...resolvida, descricao: traduzir(resolvida.descricao) };
        aceitar({ ...base, op: 'adicionar_dificuldade', alvo_id: dificuldade.id, antes: null, depois: dificuldade });
        return;
      }
      case 'remover_dificuldade': {
        const id = contexto.aliases.dificuldades.id(gerada.alvo);
        const dificuldade = id === undefined ? undefined : atual.dificuldades.find((item) => item.id === id);
        if (!dificuldade) { descartar('alias_desconhecido', `A dificuldade ${gerada.alvo} não existe.`); return; }
        aceitar({ ...base, op: 'remover_dificuldade', alvo_id: dificuldade.id, antes: structuredClone(dificuldade), depois: null });
        return;
      }
    }
  });
  return { operacoes, diagnosticos, resultado: atual };
}

// ---------------------------------------------------------------- unidades e movimento

export interface EstruturaResolvida {
  unidades: UnidadeDeLeituraV1[];
  movimento: MovimentoDoCapituloV1;
  diagnosticos: DiagnosticoDaCompreensao[];
}

/** Unidades a partir dos inícios (particionam o capítulo) e o movimento com os ids das unidades. */
export function resolverEstrutura(
  saida: Pick<SaidaDaSintese, 'unidades' | 'movimento'>, ordemDoCapitulo: readonly Id[], aliases: AliasesDoPrompt, novoId: () => Id = ulid,
  traduzir: (texto: string) => string = (texto) => texto,
): EstruturaResolvida {
  const diagnosticos: DiagnosticoDaCompreensao[] = [];
  const itens = saida.unidades.map((unidade, indice) => ({ ...unidade, indice, inicio_alias: unidade.inicio, inicio: aliases.blocos.id(unidade.inicio) ?? `?${unidade.inicio}` }));
  const { faixas, ignorados, primeiro_ajustado } = particionarPorInicios(ordemDoCapitulo, itens);
  for (const item of ignorados) {
    diagnosticos.push({ codigo: 'unidade_descartada', efeito: 'descartada', caminho: `/unidades/${String(item.indice)}`,
      mensagem: `A unidade ${item.ref} começa em ${item.inicio_alias}, fora do capítulo ou no início de outra.` });
  }
  if (primeiro_ajustado) {
    diagnosticos.push({ codigo: 'unidade_ajustada', efeito: 'mantida', caminho: '/unidades',
      mensagem: 'A primeira unidade passou a começar no primeiro bloco do capítulo.' });
  }
  const porRef = new Map<string, Id>();
  const unidades: UnidadeDeLeituraV1[] = faixas.map((faixa) => {
    const id = novoId();
    porRef.set(faixa.ref, id);
    return { id, bloco_inicio: faixa.bloco_inicio, bloco_fim: faixa.bloco_fim, titulo: traduzir(faixa.titulo), funcao_no_capitulo: traduzir(faixa.funcao_no_capitulo) };
  });
  const etapas = saida.movimento.etapas.map((etapa) => ({
    unidade_ids: [...new Set(etapa.unidades.map((ref) => porRef.get(ref)).filter((id): id is Id => id !== undefined))],
    descricao: traduzir(etapa.descricao),
  })).filter((etapa) => etapa.unidade_ids.length > 0);
  if (etapas.length < saida.movimento.etapas.length) {
    diagnosticos.push({ codigo: 'etapa_sem_unidade', efeito: 'descartada', caminho: '/movimento/etapas',
      mensagem: 'Etapas do movimento sem nenhuma unidade válida foram retiradas.' });
  }
  return { unidades, movimento: { texto: traduzir(saida.movimento.texto), etapas }, diagnosticos };
}

// ---------------------------------------------------------------- plano pedagógico

export interface PlanoResolvido {
  passos: PassoPedagogicoV1[];
  apoios: ApoioPedagogicoV1[];
  diagnosticos: DiagnosticoDaCompreensao[];
}

/** Passos a partir dos inícios (particionam o capítulo); foco, relações e apoios só com aliases conhecidos. */
export function resolverPlano(
  saida: SaidaDoPlano, ordemDoCapitulo: readonly Id[], modelo: ModeloDoCapituloV1, aliases: AliasesDoPrompt,
  blocosDoCapitulo: readonly BlocoResolvivel[] = [],
): PlanoResolvido {
  const traduzirTexto = tradutoresDoModelo(modelo, aliases, blocosDoCapitulo);
  const diagnosticos: DiagnosticoDaCompreensao[] = [];
  const elementos = new Set(modelo.elementos.map((item) => item.id));
  const relacoes = new Set(modelo.relacoes.map((item) => item.id));
  const dificuldades = new Set(modelo.dificuldades.map((item) => item.id));
  const traduzir = (lista: readonly string[], tabela: TabelaDeAliases, validos: ReadonlySet<Id>, caminho: string): Id[] => {
    const ids: Id[] = [];
    for (const alias of lista) {
      const id = tabela.id(alias);
      if (id === undefined || !validos.has(id)) {
        diagnosticos.push({ codigo: 'alias_desconhecido', efeito: 'descartada', caminho, mensagem: `O alias ${alias} não existe no modelo.` });
        continue;
      }
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  };
  const itens = saida.passos.map((passo, indice) => ({ ...passo, indice, inicio_alias: passo.inicio, inicio: aliases.blocos.id(passo.inicio) ?? `?${passo.inicio}` }));
  const { faixas, ignorados, primeiro_ajustado } = particionarPorInicios(ordemDoCapitulo, itens);
  for (const item of ignorados) {
    diagnosticos.push({ codigo: 'passo_descartado', efeito: 'descartada', caminho: `/passos/${String(item.indice)}`,
      mensagem: `O passo começa em ${item.inicio_alias}, fora do capítulo ou no início de outro passo.` });
  }
  if (primeiro_ajustado) {
    diagnosticos.push({ codigo: 'passo_ajustado', efeito: 'mantida', caminho: '/passos', mensagem: 'O primeiro passo passou a começar no primeiro bloco.' });
  }
  const passos: PassoPedagogicoV1[] = faixas.map((faixa, ordem) => ({
    ordem, bloco_inicio: faixa.bloco_inicio, bloco_fim: faixa.bloco_fim,
    foco: traduzir(faixa.foco, aliases.elementos, elementos, `/passos/${String(faixa.indice)}/foco`),
    observar: traduzirTexto(faixa.observar), explicacao: { curta: traduzirTexto(faixa.explicacao.curta), longa: traduzirTexto(faixa.explicacao.longa) },
    relacoes: traduzir(faixa.relacoes, aliases.relacoes, relacoes, `/passos/${String(faixa.indice)}/relacoes`),
    parada: faixa.parada === null ? null : { ...faixa.parada, texto: traduzirTexto(faixa.parada.texto) },
  }));
  const apoios: ApoioPedagogicoV1[] = [];
  saida.apoios.forEach((apoio, indice) => {
    const id = apoio.alvo.startsWith('D') ? aliases.dificuldades.id(apoio.alvo) : aliases.elementos.id(apoio.alvo);
    if (id === undefined || !(elementos.has(id) || dificuldades.has(id))) {
      diagnosticos.push({ codigo: 'alias_desconhecido', efeito: 'descartada', caminho: `/apoios/${String(indice)}`, mensagem: `O alvo ${apoio.alvo} não existe.` });
      return;
    }
    apoios.push({ alvo_id: id, tipo: apoio.tipo, texto: traduzirTexto(apoio.texto) });
  });
  return { passos, apoios, diagnosticos };
}

/** Tradutor de aliases para textos gerados sobre um modelo já publicado (síntese, plano). */
export function tradutoresDoModelo(
  modelo: ModeloDoCapituloV1, aliases: AliasesDoPrompt, blocosDoCapitulo: readonly BlocoResolvivel[],
): (texto: string) => string {
  return tradutor({
    aliases, blocos: new Map(blocosDoCapitulo.map((bloco) => [bloco.id, bloco])),
    elemento: (id) => modelo.elementos.find((item) => item.id === id),
    relacao: (id) => modelo.relacoes.find((item) => item.id === id),
    dificuldade: (id) => modelo.dificuldades.find((item) => item.id === id),
    unidade: (id) => modelo.unidades.find((item) => item.id === id),
    textoDoCapitulo: blocosDoCapitulo.map((bloco) => bloco.texto).join('\n'),
  });
}

export type { SaidaDaRevisao, SaidaDaSintese };
