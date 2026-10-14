/**
 * Algoritmo v2 de análise de um quadro: quatro chamadas ao Codex, com conferências determinísticas
 * entre elas e retomada por etapa.
 *
 *   1. leitura  — só olhar: descrição densa e inventário de objetos com caixas, lidas numa grade de
 *                 coordenadas sobre a obra e sobre quatro ladrilhos ampliados;
 *   2. modelo   — regiões justas (a partir do inventário), afirmações tipadas com citação literal das
 *                 fontes e 2–3 teses candidatas;
 *      (serviço: confere citações letra por letra, tamanho/sobreposição de regiões, repetição)
 *   3. revisão  — passada crítica com um recorte ampliado de cada região: ajusta caixas, corta o que não
 *                 se sustenta, corrige tipos, escolhe e afia a tese;
 *      (serviço: portão final em cascata — citação, âncora, apoio, ciclos — e montagem do ModeloDaObraV1)
 *   4. roteiro  — gramática curta (gancho, 2–4 evidências que avançam, contexto se preciso, fechamento),
 *                 frases para a voz, enquadramento por batida;
 *      (serviço: câmera calculada pela região, tempo pelo núcleo, conferência de gramática/repetição/
 *       ressalvas; um reparo do roteiro, se houver problema grave).
 *
 * Saída em `<obra>/geracoes/<rotulo>/`: modelo.json, curta.json, registro.json, avaliacao.json/.md,
 * brutos/ (resposta crua e dados de cada etapa) e imagens/ (o que o Codex viu).
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1 } from '@margem/contratos';
import { validarAnaliseCurtaDaObra, validarModeloDaObra } from '../../../../contratos/src/validadores.js';
import { conferirAnaliseCurta, conferirModeloDaObra, limitesDaRegiao } from '../../../../core/src/arte.js';
import { prepararEntrada } from '../../executor/entrada.js';
import type { ExecucaoAdiada, ExecucaoFalhou, Executor } from '../../executor/tipos.js';
import { corpusPorFonte, lerObra, montarDossie } from './acervo.js';
import type { DossieDaObra, ObraDoAcervo } from './acervo.js';
import { dossieEBaseAutomaticos } from './dossie-auto.js';
import { dossieEBaseSoPelaImagem, LIMITE_SO_IMAGEM } from './dossie-imagem.js';
import { avaliarGeracao, relatorioMarkdown } from './avaliacao.js';
import { aplicarRevisao, conferirCandidato, conferirRoteiro, filtrarFinal, graves, normalizarForma, repararRoteiro, transportarPesquisa } from './conferencias.js';
import type { CandidatoRevisado, Corte } from './conferencias.js';
import { dimensoesDaImagem, LADRILHOS, prepararComFfmpeg, recorteEmVolta } from './imagens.js';
import type { Dimensoes, PedidoDeImagem, PrepararImagem } from './imagens.js';
import { criarIds, METODO_V2, montarCurta, montarModelo } from './montagem.js';
import type { Diagnostico, LeituraVisual, ModeloCandidato, RevisaoDoModelo, RoteiroCandidato } from './tipos.js';

export const ETAPAS_V2 = ['leitura', 'modelo', 'revisao', 'roteiro', 'roteiro-reparo'] as const;
export type EtapaV2 = (typeof ETAPAS_V2)[number];

export interface ConfiguracaoV2 {
  executor: Executor;
  rotulo: string;
  raiz?: string;
  /** Esforço de raciocínio pedido ao Codex (o executor passa `-c model_reasoning_effort=…`). */
  esforco?: string;
  prazoMs?: number;
  /** Fazer a chamada de reparo do roteiro quando a conferência acha problema grave (padrão: sim). */
  reparo?: boolean;
  preparar?: PrepararImagem;
  dimensoes?: (caminho: string) => Promise<Dimensoes>;
  agora?: () => number;
  avisar?: (mensagem: string) => void;
  /**
   * De onde vem o dossiê: da referência curada (padrão), de `dossie-auto.json` (ver dossie-auto.ts) ou,
   * numa obra não identificada (V-W5), só da imagem (ver dossie-imagem.ts): só observação e inferência.
   */
  dossie?: 'curado' | 'auto' | 'imagem';
  /** Só com `dossie: 'imagem'`: o palpite do Codex ao não reconhecer a obra, como apoio (não fonte). */
  palpite?: string | null;
  /** Cancela a chamada em curso (o job da fila foi cancelado ou o worker está parando). */
  sinal?: AbortSignal;
  /** Antes de cada chamada ao Codex (o job da fila mostra o progresso por aqui). */
  aoChamar?: (etapa: EtapaV2) => void;
}

/** Uma chamada ao Codex não terminou bem (cota, prazo, cancelamento, resposta fora do formato). */
export class EtapaNaoConcluida extends Error {
  constructor(readonly etapa: EtapaV2, readonly resultado: ExecucaoFalhou | ExecucaoAdiada) {
    super(`etapa_${etapa}_${resultado.estado}: ${resultado.mensagem}${resultado.estado === 'adiado' ? ` (volta ${resultado.not_before.toISOString()})` : ''}`);
    this.name = 'EtapaNaoConcluida';
  }
}

export interface RegistroDeEtapa {
  etapa: EtapaV2;
  estado: 'feita' | 'retomada';
  modelo: string | null;
  esforco: string | null;
  duracao_ms: number;
  sha256: string | null;
  imagens: string[];
}

export interface RegistroV2 {
  versao: typeof METODO_V2;
  slug: string;
  rotulo: string;
  dossie: 'curado' | 'auto' | 'imagem';
  criado_em_ms: number;
  etapas: RegistroDeEtapa[];
  /** Chamadas ao Codex desta geração, somando as execuções anteriores retomadas (inclui as que falharam). */
  chamadas: number;
  duracao_chamadas_ms: number;
  /** Chamadas feitas só nesta execução (0 numa retomada completa). */
  chamadas_nesta_execucao: number;
  diagnosticos: {
    candidato: Diagnostico[];
    cortes: Corte[];
    roteiro: Diagnostico[];
    roteiro_reparo: Diagnostico[] | null;
    roteiro_escolhido: 'primeiro' | 'reparo';
    modelo: string[];
    curta: string[];
  };
}

export interface ResultadoV2 { pasta: string; modelo: ModeloDaObraV1; curta: AnaliseCurtaDaObraV1; registro: RegistroV2 }

const PROMPTS = new URL('../../../../prompts/', import.meta.url);
const lerPrompt = (nome: string): Promise<string> => readFile(new URL(nome, PROMPTS), 'utf8');

/** Candidato em forma compacta para os prompts: índices explícitos, caixas arredondadas. */
function candidatoParaPrompt(c: ModeloCandidato | CandidatoRevisado) {
  return {
    regioes: c.regioes.map((r, i) => ({ indice: i, rotulo: r.rotulo, forma: r.forma })),
    afirmacoes: c.afirmacoes.map((a, i) => ({ indice: i, ...a })),
    teses: c.teses.map((t, i) => ({ indice: i, ...t })),
  };
}

export async function gerarQuadroV2(slug: string, config: ConfiguracaoV2): Promise<ResultadoV2> {
  const obra = await lerObra(slug, config.raiz);
  const pasta = join(obra.pasta, 'geracoes', config.rotulo);
  for (const sub of ['brutos', 'imagens']) await mkdir(join(pasta, sub), { recursive: true });
  const avisar = config.avisar ?? (() => undefined);
  const preparar = config.preparar ?? prepararComFfmpeg;
  const dim = await (config.dimensoes ?? dimensoesDaImagem)(obra.imagem);
  const caminhoRegistro = join(pasta, 'registro.json');
  const anterior = existsSync(caminhoRegistro) ? JSON.parse(await readFile(caminhoRegistro, 'utf8')) as RegistroV2 : null;
  const registro: RegistroV2 = {
    versao: METODO_V2, slug, rotulo: config.rotulo, dossie: config.dossie ?? 'curado', criado_em_ms: anterior?.criado_em_ms ?? (config.agora ?? Date.now)(),
    etapas: [], chamadas: anterior?.chamadas ?? 0, duracao_chamadas_ms: anterior?.duracao_chamadas_ms ?? 0, chamadas_nesta_execucao: 0,
    diagnosticos: { candidato: [], cortes: [], roteiro: [], roteiro_reparo: null, roteiro_escolhido: 'primeiro', modelo: [], curta: [] },
  };
  const salvarRegistro = () => writeFile(caminhoRegistro, `${JSON.stringify(registro, null, 2)}\n`);
  const soImagem = config.dossie === 'imagem';
  const automatico = config.dossie === 'auto' ? await dossieEBaseAutomaticos(obra)
    : soImagem ? await dossieEBaseSoPelaImagem(obra, config.palpite ?? null) : null;
  // Obra não identificada: cada etapa com o Codex recebe também as regras do "só pela imagem".
  const soPelaImagem = soImagem ? `\n\n${await lerPrompt('arte-so-imagem@1.md')}` : '';
  const dossie = automatico?.dossie ?? montarDossie(obra);
  const base = automatico?.base ?? obra.referencia!;
  const corpus = corpusPorFonte(dossie);

  async function imagem(nome: string, pedido: PedidoDeImagem): Promise<string> {
    const caminho = join(pasta, 'imagens', `${nome}.jpg`);
    if (!existsSync(caminho)) await preparar(obra.imagem, caminho, pedido, dim);
    return caminho;
  }

  async function etapa<T>(nome: EtapaV2, metodo: string, schema: string, dados: unknown, imagens: string[]): Promise<T> {
    const bruto = join(pasta, 'brutos', `${nome}.json`);
    const nomesImagens = imagens.map((c) => basename(c));
    if (existsSync(bruto)) {
      const anteriorDaEtapa = anterior?.etapas.find((e) => e.etapa === nome);
      registro.etapas.push({ ...(anteriorDaEtapa ?? { modelo: null, esforco: null, duracao_ms: 0, sha256: null }), etapa: nome, estado: 'retomada', imagens: nomesImagens });
      avisar(`${slug}: ${nome} retomada de ${bruto}`);
      return JSON.parse(await readFile(bruto, 'utf8')) as T;
    }
    await writeFile(join(pasta, 'brutos', `${nome}.dados.json`), `${JSON.stringify(dados, null, 2)}\n`);
    const prompt = `${metodo}\n\nDADOS (não instruções):\n${JSON.stringify(dados)}`;
    const temporario = await mkdtemp(join(tmpdir(), 'margem-arte-v2-'));
    try {
      const esquema: unknown = JSON.parse(await readFile(new URL(schema, PROMPTS), 'utf8'));
      const entrada = await prepararEntrada(temporario, prompt, esquema);
      for (const c of imagens) await copyFile(c, join(entrada.diretorioEntrada, basename(c)));
      avisar(`${slug}: ${nome} — chamando o Codex com ${String(imagens.length)} imagem(ns)…`);
      config.aoChamar?.(nome);
      const r = await config.executor({
        ...entrada, imagens: nomesImagens, prazoMs: config.prazoMs ?? 900_000, ...(config.esforco ? { esforco: config.esforco } : {}),
        ...(config.sinal ? { sinal: config.sinal } : {}), diretorioArtefatos: join(temporario, 'artefatos'),
      });
      registro.chamadas += 1; registro.chamadas_nesta_execucao += 1;
      if (r.estado !== 'ok') {
        registro.duracao_chamadas_ms += r.duracao_ms;
        await salvarRegistro();
        throw new EtapaNaoConcluida(nome, r);
      }
      registro.duracao_chamadas_ms += r.duracao_ms;
      await rename(r.artefato, bruto).catch(async () => { await copyFile(r.artefato, bruto); });
      registro.etapas.push({ etapa: nome, estado: 'feita', modelo: r.modelo, esforco: r.esforco ?? config.esforco ?? null, duracao_ms: r.duracao_ms, sha256: r.sha256, imagens: nomesImagens });
      await salvarRegistro();
      avisar(`${slug}: ${nome} feita em ${(r.duracao_ms / 1000).toFixed(0)} s (${r.modelo})`);
      return JSON.parse(await readFile(bruto, 'utf8')) as T;
    } finally {
      await rm(temporario, { recursive: true, force: true });
    }
  }

  const inteiro = { x: 0, y: 0, largura: 1, altura: 1 };
  const visao = await imagem('visao-grade', { recorte: inteiro, ladoMax: 1600, grade: true, caixas: [] });
  const ladrilhos = [];
  for (const l of LADRILHOS) ladrilhos.push(await imagem(l.nome, { recorte: l.recorte, ladoMax: 1400, grade: true, caixas: [] }));

  // 1. Leitura visual.
  const leitura = await etapa<LeituraVisual>('leitura', await lerPrompt('arte-leitura@2.md'), 'arte-leitura@2.schema.json',
    { proporcao_largura_altura: Math.round((dim.largura / dim.altura) * 1000) / 1000 }, [visao, ...ladrilhos]);

  // 2. Modelo candidato.
  const candidato = await etapa<ModeloCandidato>('modelo', `${await lerPrompt('arte-modelo@2.md')}${soPelaImagem}`, 'arte-modelo@2.schema.json',
    { dossie: dossieParaPrompt(dossie), leitura: { ...leitura, objetos: leitura.objetos.map((o, i) => ({ indice: i, ...o })) } }, [visao, ...ladrilhos]);
  registro.diagnosticos.candidato = conferirCandidato(candidato, dossie, corpus, leitura);

  // 3. Revisão com recortes de cada região candidata.
  const formas = candidato.regioes.map((r) => normalizarForma(r.forma));
  const caixas = candidato.regioes.flatMap((r, i) => { const f = formas[i]; return f ? [{ retangulo: limitesDaRegiao(f), rotulo: `R${String(i)}` }] : []; });
  const visaoCandidatas = await imagem('visao-regioes-candidatas', { recorte: inteiro, ladoMax: 1600, grade: false, caixas });
  const recortes: string[] = [], nomesRecortes: string[] = [];
  for (const [i, r] of candidato.regioes.entries()) {
    const f = formas[i]; if (!f || recortes.length >= 9) continue;
    const l = limitesDaRegiao(f);
    recortes.push(await imagem(`recorte-R${String(i)}`, { recorte: recorteEmVolta(l), ladoMax: 1024, grade: true, caixas: [{ retangulo: l, rotulo: `R${String(i)} ${r.rotulo}` }] }));
    nomesRecortes.push(`R${String(i)}`);
  }
  const revisao = await etapa<RevisaoDoModelo>('revisao', `${await lerPrompt('arte-revisao@2.md')}${soPelaImagem}`, 'arte-revisao@2.schema.json',
    { dossie: dossieParaPrompt(dossie), candidato: candidatoParaPrompt(candidato), alertas: registro.diagnosticos.candidato, recortes: nomesRecortes }, [visaoCandidatas, ...recortes]);
  const revisado = aplicarRevisao(candidato, revisao);
  const final = filtrarFinal(revisado.candidato, dossie, corpus, soImagem ? { soImagem: true } : {});
  registro.diagnosticos.cortes = [...revisado.cortes, ...final.cortes];
  const c = transportarPesquisa(final.candidato, dossie);

  const ids = criarIds(registro.criado_em_ms, `${slug}/${config.rotulo}`);
  const montado = montarModelo(base, c, ids);
  const { idsAfirmacoes, idsRegioes } = montado;
  // Só pela imagem, o limite que vale é o da obra não identificada (não há "dossiê de fontes").
  const modelo = soImagem ? { ...montado.modelo, limites: [LIMITE_SO_IMAGEM, ...c.limites] } : montado.modelo;
  if (!validarModeloDaObra(modelo)) throw new Error(`modelo_fora_do_contrato: ${JSON.stringify(validarModeloDaObra.errors?.slice(0, 3))}`);
  registro.diagnosticos.modelo = conferirModeloDaObra(modelo);

  // 4. Roteiro, com as regiões finais desenhadas.
  const visaoFinais = await imagem('visao-regioes-finais', { recorte: inteiro, ladoMax: 1600, grade: false, caixas: c.regioes.map((r, i) => ({ retangulo: limitesDaRegiao(r.forma), rotulo: `R${String(i)}` })) });
  const dadosRoteiro = {
    identidade: dossie.identidade,
    regioes: c.regioes.map((r, i) => ({ indice: i, rotulo: r.rotulo })),
    afirmacoes: c.afirmacoes.map((a, i) => ({ indice: i, texto: a.texto, tipo: a.tipo, confianca: a.confianca, regioes: a.regioes, apoios: a.apoios, fontes: a.fontes.map((f) => dossie.fontes.find((x) => x.id === f)?.titulo ?? f) })),
    tese: c.tese,
    outras_teses: c.teses.filter((t) => t.texto !== c.tese.texto).map((t) => t.texto),
  };
  const metodoRoteiro = `${await lerPrompt('arte-roteiro@2.md')}${soPelaImagem}`;
  let roteiro = repararRoteiro(await etapa<RoteiroCandidato>('roteiro', metodoRoteiro, 'arte-roteiro@2.schema.json', dadosRoteiro, [visaoFinais]), c);
  registro.diagnosticos.roteiro = conferirRoteiro(roteiro, c);
  const reparoJaFeito = existsSync(join(pasta, 'brutos', 'roteiro-reparo.json'));
  if (graves(registro.diagnosticos.roteiro).length && (config.reparo !== false || reparoJaFeito)) {
    const reparado = repararRoteiro(await etapa<RoteiroCandidato>('roteiro-reparo', `${metodoRoteiro}\n\n${await lerPrompt('arte-roteiro-reparo@2.md')}`, 'arte-roteiro@2.schema.json',
      { ...dadosRoteiro, anterior: roteiro, problemas: registro.diagnosticos.roteiro }, [visaoFinais]), c);
    registro.diagnosticos.roteiro_reparo = conferirRoteiro(reparado, c);
    if (graves(registro.diagnosticos.roteiro_reparo).length <= graves(registro.diagnosticos.roteiro).length) { roteiro = reparado; registro.diagnosticos.roteiro_escolhido = 'reparo'; }
  }
  const curta = montarCurta(modelo, roteiro, idsAfirmacoes, idsRegioes);
  if (!validarAnaliseCurtaDaObra(curta)) throw new Error(`curta_fora_do_contrato: ${JSON.stringify(validarAnaliseCurtaDaObra.errors?.slice(0, 3))}`);
  registro.diagnosticos.curta = conferirAnaliseCurta(curta, modelo);

  await writeFile(join(pasta, 'modelo.json'), `${JSON.stringify(modelo, null, 2)}\n`);
  await writeFile(join(pasta, 'curta.json'), `${JSON.stringify(curta, null, 2)}\n`);
  await salvarRegistro();
  await escreverAvaliacao(obra, pasta, modelo, curta, registro);
  return { pasta, modelo, curta, registro };
}

/** O dossiê como vai ao modelo: sem os nomes de arquivo, que não interessam. */
function dossieParaPrompt(d: DossieDaObra) {
  return { ...d, fontes: d.fontes.map((f) => ({ id: f.id, titulo: f.titulo, url: f.url, categoria: f.categoria, texto: f.texto })) };
}

export async function escreverAvaliacao(obra: ObraDoAcervo, pasta: string, modelo: ModeloDaObraV1, curta: AnaliseCurtaDaObraV1, registro: RegistroV2 | null): Promise<void> {
  const caminhoEsperada = join(obra.pasta, 'esperado.curta.json');
  const esperada = existsSync(caminhoEsperada) ? JSON.parse(await readFile(caminhoEsperada, 'utf8')) as AnaliseCurtaDaObraV1 : null;
  const avaliacao = avaliarGeracao({ esperado: obra.referencia ? { modelo: obra.referencia, curta: esperada } : null, gerado: { modelo, curta }, registro });
  await writeFile(join(pasta, 'avaliacao.json'), `${JSON.stringify(avaliacao, null, 2)}\n`);
  await writeFile(join(pasta, 'avaliacao.md'), relatorioMarkdown(obra.slug, basename(pasta), avaliacao, { modelo, curta }, esperada, registro));
}

