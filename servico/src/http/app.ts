import { identidadeDaSaude } from '../instancia.js';
import { compressao } from './compressao.js';
import { registrarRotasDeArte } from './rotas-arte.js';
import { registrarComparacaoDeVersoes } from './rotas-versoes';
import { registrarAudio } from './rotas-audio';
import { registrarAudioGerado } from './rotas-audio-gerado.js';
import { escolherProvedorDeVoz } from '../audio/narracao.js';
import type { ProvedorDeVoz } from '../audio/voz/provedor.js';
import { registrarMidia } from './rotas-midia';
import { registrarRotasDosVisuais } from './rotas-visuais.js';
import { registrarRotasDoAgente } from './rotas-agente.js';
import { registrarRotasDoEsquema } from './rotas-esquema.js';
import { registrarRotasDosFlashcards } from './rotas-flashcards.js';
import { registrarRotasDaVisita } from './rotas-visita.js';
import { registrarRotasDaLeituraComentada } from './rotas-leitura-comentada.js';
import { registrarBusca } from './rotas-busca.js';
import { registrarRotasDasNotas } from './rotas-notas.js';
import { registrarRotasDoObsidian } from './rotas-obsidian.js';
import { registrarRotasDaMiniatura } from './rotas-miniatura.js';
import { registrarRotasDasExecucoes } from './rotas-execucoes.js';
import { registrarRotasDasSalas } from './rotas-salas.js';
import { registrarRotasDaPrimeiraExecucao } from './rotas-primeira-execucao.js';
import { registrarRotasDoApagar } from './rotas-apagar.js';
import { registrarRotasDosModelos } from './rotas-modelos.js';
import type { CatalogoDeModelos } from '../modelos/catalogo.js';
import type { Verificadores } from '../primeira-execucao/estado.js';
import { lerCorpoJson } from './entrada-json.js';
import { criarLimiteDeTaxa } from './limite-de-taxa.js';
/**
 * API da Margem: Hono em loopback.
 *
 * Um processo só de API. Ele grava documentos, enfileira jobs e serve snapshots;
 * o trabalho demorado (motor Python, `codex exec`) é do worker, em outro processo.
 * Importar e abrir um texto funciona com o Codex desligado — a API nunca espera
 * o worker para responder.
 */
import { readFile, stat } from 'node:fs/promises';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { Id, LoteRevisaoV2, MarcaV1, ProgressoV1 } from '@margem/contratos';
import { hashMarcas } from '@margem/contratos';
import type { MapaDePaginas } from '@margem/core';
import { comTransacao } from '../db/transacao.js';
import * as documentosRepo from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as marcasRepo from '../repos/marcas.js';
import * as progressoRepo from '../repos/progresso.js';
import { importarMarcasLegado, importarSessaoHorarium, type SessaoHorarium } from '../leitura/importar.js';
import { iniciarExecucao, iniciarExecucaoV2, type ConfiguracaoDaLeitura } from '../leitura/manipuladores.js';
import type { PedidoDeLeituraV2 } from '../leitura/leitura-v2.js';
import { modoOuNada } from '../modos.js';
import { profundidadeDoPrefetch } from '../worker/configuracao.js';
import {
  EXTENSAO_POR_FORMATO, dentroDaRaiz, ehUlid,
  pastaDaVersao, tipoDoArquivo,
} from '../dados.js';
import { LIMITE_UPLOAD_BYTES } from './ambiente.js';
import { CamadaInexistente, arvoreDeSecoes, biblioteca, capitulos, detalhe, snapshotDoCapitulo } from './consultas.js';
import { ErroDaApi, corpoDoErro, detalheSeguro } from './erros.js';
import { cabecalhosDeSeguranca, lerFormularioLimitado, pareceUmPdf, seguranca } from './seguranca.js';
import { registrarOriginal, type OriginalNovo } from './ingestao.js';
import { registrarImportacoes } from './rotas-importacoes.js';
import type { OuvinteDeEventos } from './ouvinte.js';
import { registrarRotasF2 } from './rotas-f2.js';
import { registrarRotasDaCompreensao } from './rotas-compreensao.js';
import { registrarRotasDaResolucao } from './rotas-resolucao.js';
import { registrarRotasDosExercicios, type ApoioDosExercicios } from './rotas-exercicios.js';
import type { ConfiguracaoDaCompreensao } from '../compreensao/pipeline.js';
import { formatacaoDaFonte } from './formatacao-da-fonte.js';
import { lerIlustracoes, arquivoDaIlustracao } from './ilustracoes.js';
import { registrarDocumentoOriginal } from './documento-original.js';
import { enfileirarTranscricao, ErroDaTranscricao } from '../escaneado/transcricao.js';
import { CacheDeGeometria } from '../geometria/arquivos.js';

export interface OpcoesDaApi {
  banco: pg.Pool;
  /** Configuração da leitura (J06), usada por `POST /api/documentos/:id/leituras`. */
  leitura: () => ConfiguracaoDaLeitura;
  /**
   * Pausa entre varreduras do SSE. Com `ouvinte`, é o intervalo de segurança (padrão 15 s):
   * a varredura acontece a cada aviso do `NOTIFY` e, na falta dele, a cada intervalo.
   * Sem `ouvinte`, é a varredura pura de antes (padrão 1 s).
   */
  intervaloEventosMs?: number;
  /** Conexão dedicada com `LISTEN margem_evento` (J14). Quem a cria também a encerra. */
  ouvinte?: OuvinteDeEventos;
  /**
   * Configuração da compreensão (J30). A API só inicia execuções e enfileira jobs; quem chama o
   * modelo é o worker. Sem ela, vem da configuração da leitura (mesmo executor, modelo e esforço).
   */
  compreensao?: () => ConfiguracaoDaCompreensao;
  /** Os testes trocam o script do PDF (OCR e recortes) da descoberta dos exercícios. */
  exercicios?: Pick<ApoioDosExercicios, 'descobrirPdf' | 'recortarPdf' | 'agora'>;
  /** Recursos pessoais ligados (J102). Sem a opção, `MARGEM_RECURSOS`; os testes passam o conjunto. */
  recursos?: ReadonlySet<Recurso>;
  /** Provedor de voz com a chave da pessoa (J106); os testes passam um falso. Padrão: `MARGEM_VOZ`. */
  provedorDeVoz?: (chave: string) => ProvedorDeVoz;
  /** Os testes trocam as verificações do `codex` e do motor da primeira execução (J103). */
  primeiraExecucao?: Partial<Verificadores>;
  /** Os testes trocam a busca da lista de modelos da conta (Configurações → Modelos, V-T10). */
  buscarModelos?: () => Promise<CatalogoDeModelos | null>;
}

/** Maior página aceita: a coluna é `integer`. */
const PAGINA_MAXIMA = 2_147_483_647;

/**
 * `paginas=a-b`: inteiros positivos, inclusivos, a ≤ b. Devolve `null` quando o campo
 * não veio; recusa com 400 o que não for exatamente essa forma.
 */
export function lerFaixaDePaginas(bruto: string | undefined): { inicio: number; fim: number } | null {
  if (bruto === undefined || bruto.trim() === '') return null;
  const achado = /^([1-9]\d{0,9})-([1-9]\d{0,9})$/.exec(bruto.trim());
  const inicio = Number(achado?.[1]);
  const fim = Number(achado?.[2]);
  if (!achado || inicio > PAGINA_MAXIMA || fim > PAGINA_MAXIMA) {
    throw new ErroDaApi(400, 'paginas_invalidas', 'Use paginas=a-b, com inteiros positivos (por exemplo 3-17).');
  }
  if (inicio > fim) {
    throw new ErroDaApi(400, 'paginas_invalidas', `A página inicial (${String(inicio)}) vem depois da final (${String(fim)}).`);
  }
  return { inicio, fim };
}

/** Formatos em que o motor aceita `--poesia` (J15): o PDF não tem quebra de verso confiável. */
const FORMATOS_COM_POESIA: readonly string[] = ['md', 'txt', 'colado'];

/** `poesia=1` pede estrofes ao motor; `0` ou ausente, prosa. Qualquer outro valor é 400. */
export function lerPoesia(bruto: string | undefined): boolean {
  if (bruto === undefined || bruto.trim() === '' || bruto.trim() === '0') return false;
  if (bruto.trim() === '1') return true;
  throw new ErroDaApi(400, 'poesia_invalida', 'Use poesia=1 (ou 0).');
}

/** Padrão de F2 quando só um dos campos novos vem no corpo. */
const MODO_PADRAO_V2 = { id: 'argumentativa', revisao: 1 } as const;
const NIVEL_PADRAO_V2 = 3;

/**
 * `modo_de_leitura: { id, revisao }` e `nivel_de_atencao: 1|2|3` do corpo da leitura. Sem
 * nenhum dos dois, `undefined`: a leitura é a de F1, sem mudança. Com um deles, o outro
 * vale o padrão (`argumentativa@1`, nível 3). O nível 3 gera as três saliências de uma vez: o nível
 * de atenção do leitor fica só como filtro de exibição, e escolher 3 no leitor nunca mostra vazio.
 */
export function lerPedidoDeLeituraV2(bruto: unknown): PedidoDeLeituraV2 | undefined {
  const corpo = typeof bruto === 'object' && bruto !== null ? bruto as Record<string, unknown> : {};
  const temModo = 'modo_de_leitura' in corpo;
  const temNivel = 'nivel_de_atencao' in corpo;
  if (!temModo && !temNivel) return undefined;
  const referencia = temModo ? corpo.modo_de_leitura : MODO_PADRAO_V2;
  if (typeof referencia !== 'object' || referencia === null || Array.isArray(referencia)) {
    throw new ErroDaApi(400, 'modo_invalido', 'Use modo_de_leitura: { "id": "<modo>", "revisao": <inteiro> }.');
  }
  const { id, revisao, ...resto } = referencia as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || typeof revisao !== 'number' || !Number.isSafeInteger(revisao) || revisao < 1
    || Object.keys(resto).length > 0) {
    throw new ErroDaApi(400, 'modo_invalido', 'Use modo_de_leitura: { "id": "<modo>", "revisao": <inteiro> }.');
  }
  const nivel = temNivel ? corpo.nivel_de_atencao : NIVEL_PADRAO_V2;
  if (nivel !== 1 && nivel !== 2 && nivel !== 3) {
    throw new ErroDaApi(400, 'nivel_invalido', 'nivel_de_atencao é 1, 2 ou 3.');
  }
  const modo = modoOuNada({ id, revisao });
  if (!modo) throw new ErroDaApi(400, 'modo_inexistente', `Não há modo de leitura ${id}@${String(revisao)}.`);
  return { modo, nivel };
}

const TIPOS_ACEITOS: Readonly<Record<string, readonly string[]>> = {
  pdf: ['application/pdf'],
  epub: ['application/epub+zip', 'application/octet-stream'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream'],
  txt: ['text/plain', 'application/octet-stream'],
  colado: ['text/plain', 'application/octet-stream'],
};

function exigirUlid(valor: string, papel: string): Id {
  if (!ehUlid(valor)) throw new ErroDaApi(400, 'identificador_invalido', `Identificador de ${papel} inválido.`);
  return valor;
}

function texto(formulario: FormData, campo: string): string | undefined {
  const valor = formulario.get(campo);
  return typeof valor === 'string' ? valor : undefined;
}

function corpoJson(c: { req: { raw: Request } }): Promise<unknown> {
  return lerCorpoJson(c.req.raw);
}

/** Última versão publicada de um documento, ou 409 quando o texto ainda não existe. */
async function ultimaVersao(banco: pg.Pool, documentoId: Id): Promise<documentosRepo.VersaoTexto> {
  const versao = await comTransacao(banco, async (cliente) => (await cliente.query<{ id: Id }>(
    'SELECT id FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1', [documentoId])).rows[0]);
  if (!versao) throw new ErroDaApi(409, 'sem_texto', 'O documento ainda não tem texto canonizado.');
  return comTransacao(banco, (cliente) => documentosRepo.obterVersao(cliente, versao.id));
}

import { registrarNoticias } from './rotas-noticias.js';
import { listaDeRecursos, recursosDoAmbiente, RECURSOS, type Recurso } from '../recursos.js';

/** Prefixos de rota de cada recurso pessoal (J102): desligado, tudo abaixo deles responde 404. */
const ROTAS_DOS_RECURSOS: Readonly<Record<Recurso, readonly string[]>> = {
  noticias: ['/api/noticias'],
  // Só geração pelo Colab, que não tem rota na API: tocar áudio publicado vale sempre (J106 publica no mesmo lugar).
  'audio-colab': [],
  arte: ['/api/arte'],
  sala: ['/api/salas'],
  horarium: ['/api/importar/horarium'],
  eink: ['/api/planos/:id/eink.epub'],
};

/**
 * Recursos efetivamente ligados: `MARGEM_ARTE=0` ainda desliga a arte. Sem nenhuma obra em disco a arte
 * fica ligada: a área de Quadros explica o que é e convida a adicionar a primeira obra (J118).
 */
export function recursosEfetivos(pedidos: ReadonlySet<Recurso>, ambiente: NodeJS.ProcessEnv = process.env): ReadonlySet<Recurso> {
  const efetivos = new Set(pedidos);
  if (ambiente.MARGEM_ARTE === '0') efetivos.delete('arte');
  return efetivos;
}

function desligarRecurso(api: Hono, recurso: Recurso): void {
  for (const prefixo of ROTAS_DOS_RECURSOS[recurso]) {
    for (const rota of [prefixo, `${prefixo}/*`]) {
      api.all(rota, () => { throw new ErroDaApi(404, 'recurso_desligado', `O recurso ${recurso} está desligado nesta instalação.`); });
    }
  }
}

export function criarApi(opcoes: OpcoesDaApi): Hono {
  const { banco } = opcoes;
  const api = new Hono();
  // Os cabeçalhos de segurança por fora da compressão: valem também quando ela não reescreve a resposta.
  api.use('*', cabecalhosDeSeguranca());
  api.use('*', compressao());
  // Total de páginas do PDF para o intervalo do capítulo (escaneados não têm texto por página).
  const geometriasDoCapitulo = new CacheDeGeometria(16 * 1024 * 1024);
  const { ouvinte } = opcoes;
  const intervaloEventosMs = opcoes.intervaloEventosMs ?? (ouvinte ? 15_000 : 1_000);

  api.onError((erro, c) => {
    const { status, corpo } = corpoDoErro(erro);
    if (erro instanceof ErroDaApi) for (const [nome, valor] of Object.entries(erro.cabecalhos ?? {})) c.header(nome, valor);
    return c.json(corpo, status);
  });
  api.use('/api/*', seguranca());
  // Recursos pessoais (J102): os desligados respondem 404 antes de qualquer outra rota deles.
  const recursos = recursosEfetivos(opcoes.recursos ?? recursosDoAmbiente());
  for (const recurso of RECURSOS) if (!recursos.has(recurso)) desligarRecurso(api, recurso);
  api.get('/api/recursos', (c) => c.json({ recursos: listaDeRecursos(recursos) }));
  if (recursos.has('noticias')) registrarNoticias(api, banco);
  const taxa = criarLimiteDeTaxa();
  api.use('/api/*', taxa.middleware);
  registrarDocumentoOriginal(api, banco);
  registrarComparacaoDeVersoes(api, banco);
  registrarAudio(api, banco);
  registrarAudioGerado(api, { banco, exigirUlid, criarProvedor: opcoes.provedorDeVoz ?? escolherProvedorDeVoz() });
  registrarMidia(api, banco);
  registrarBusca(api, banco);
  registrarImportacoes(api, banco);

  // ------------------------------------------------------------------ documentos

  api.post('/api/documentos', async (c) => {
    const formulario = await lerFormularioLimitado(c.req.raw, LIMITE_UPLOAD_BYTES);
    const titulo = (texto(formulario, 'titulo') ?? '').trim();
    const autor = (texto(formulario, 'autor') ?? '').trim();
    const formato = (texto(formulario, 'formato') ?? '').trim();
    // PDF e EPUB podem vir sem título: o motor usa o dos metadados e, na falta, o nome do arquivo (titulo_reserva).
    if (titulo === '' && formato !== 'pdf' && formato !== 'epub') throw new ErroDaApi(400, 'titulo_obrigatorio');
    if (!(formato in EXTENSAO_POR_FORMATO)) {
      throw new ErroDaApi(400, 'formato_nao_suportado', `Formatos aceitos: ${Object.keys(EXTENSAO_POR_FORMATO).join(', ')}.`);
    }
    const paginas = lerFaixaDePaginas(texto(formulario, 'paginas'));
    if (paginas !== null && formato !== 'pdf') {
      throw new ErroDaApi(400, 'paginas_so_pdf', 'A faixa de páginas só vale para PDF.');
    }
    const poesia = lerPoesia(texto(formulario, 'poesia'));
    if (poesia && !FORMATOS_COM_POESIA.includes(formato)) {
      throw new ErroDaApi(400, 'poesia_so_texto', `A poesia só vale para ${FORMATOS_COM_POESIA.join(', ')}.`);
    }
    const arquivo = formulario.get('arquivo');
    const colado = texto(formulario, 'texto');
    let bytes: Uint8Array;
    if (arquivo instanceof File) {
      if (arquivo.size > LIMITE_UPLOAD_BYTES) throw new ErroDaApi(413, 'corpo_grande_demais', `O limite é de ${String(LIMITE_UPLOAD_BYTES)} bytes.`);
      const aceitos = TIPOS_ACEITOS[formato] ?? [];
      if (arquivo.type !== '' && !aceitos.includes(arquivo.type)) {
        throw new ErroDaApi(415, 'tipo_nao_aceito', `O formato ${formato} não aceita ${arquivo.type}.`);
      }
      bytes = new Uint8Array(await arquivo.arrayBuffer());
    } else if (colado !== undefined && colado !== '') {
      bytes = new TextEncoder().encode(colado);
    } else {
      throw new ErroDaApi(400, 'sem_conteudo', 'Envie um arquivo ou o texto colado.');
    }
    if (bytes.byteLength > LIMITE_UPLOAD_BYTES) throw new ErroDaApi(413, 'corpo_grande_demais', `O limite é de ${String(LIMITE_UPLOAD_BYTES)} bytes.`);
    if (formato === 'pdf' && !pareceUmPdf(bytes)) {
      throw new ErroDaApi(415, 'pdf_invalido', 'O arquivo não começa como um PDF (%PDF-).');
    }

    const resposta = await registrarOriginal(banco, {
      titulo, formato: formato as OriginalNovo['formato'],
      ...(autor === '' ? {} : { autor }), bytes, paginas, poesia,
      ...(arquivo instanceof File ? { nomeDoArquivo: arquivo.name } : {}),
    });
    if ('erro' in resposta) return c.json({ ...resposta, detalhe: 'Este texto já está na biblioteca.' }, 409);
    return c.json(resposta, 202);
  });

  api.get('/api/documentos', async (c) => {
    // Padrão: sem os arquivados. `?arquivados=1`: só os arquivados.
    const arquivados = c.req.query('arquivados') === '1';
    const documentos = await comTransacao(banco, (cliente) => biblioteca(cliente, { arquivados }));
    return c.json({ documentos });
  });

  for (const [rota, acao] of [['arquivar', documentosRepo.arquivar], ['desarquivar', documentosRepo.desarquivar]] as const) {
    // Idempotentes: arquivar o arquivado (ou desarquivar o ativo) não muda nada e responde 200.
    api.post(`/api/documentos/:id/${rota}`, async (c) => {
      const id = exigirUlid(c.req.param('id'), 'documento');
      const documento = await comTransacao(banco, (cliente) => acao(cliente, id));
      if (!documento) throw new ErroDaApi(404, 'documento_inexistente');
      return c.json({
        documento_id: documento.id,
        arquivado: documento.arquivado_em !== null,
        arquivado_em: documento.arquivado_em?.toISOString() ?? null,
      });
    });
  }

  // PDF escaneado: transcreve por visão as páginas sem texto da última versão (job do worker).
  api.post('/api/documentos/:id/transcrever', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const STATUS = { documento_inexistente: 404, nao_e_pdf: 422, sem_versao: 409, nada_a_transcrever: 409 } as const;
    try {
      const { job, paginas } = await comTransacao(banco, (cliente) => enfileirarTranscricao(cliente, id));
      // Pedir de novo depois de uma falha (ou cancelamento) tenta de novo, com as páginas já prontas guardadas.
      const atual = jobsRepo.REENFILEIRAVEIS.includes(job.estado) ? await jobsRepo.reenfileirar(banco, job.id) ?? job : job;
      return c.json({ job_id: atual.id, estado: atual.estado, paginas }, 202);
    } catch (erro) {
      if (erro instanceof ErroDaTranscricao) throw new ErroDaApi(STATUS[erro.codigo], erro.codigo, erro.message);
      throw erro;
    }
  });

  api.get('/api/documentos/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = await comTransacao(banco, (cliente) => detalhe(cliente, id));
    if (!corpo) throw new ErroDaApi(404, 'documento_inexistente');
    return c.json(corpo);
  });

  // ------------------------------------------------------------------ leituras

  api.post('/api/documentos/:id/leituras', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    // Sem corpo, a leitura de F1 com a configuração padrão. Um corpo JSON sem
    // `content-length` (transferência em pedaços) também é lido.
    const tamanho = c.req.header('content-length');
    const ehJson = (c.req.header('content-type') ?? '').toLowerCase().includes('json');
    const bruto = tamanho === '0' || (tamanho === undefined && !ehJson) ? {} : await corpoJson(c);
    const config = (bruto as { config?: Record<string, unknown> }).config ?? {};
    // F2 (J19): `modo_de_leitura` e `nivel_de_atencao` ficam ao lado de `config`. Atenção:
    // `config.modo` é o particionamento (`sequencial|capitulos`), não o modo de leitura.
    const pedidoV2 = lerPedidoDeLeituraV2(bruto);
    const versao = await ultimaVersao(banco, id);
    const base = opcoes.leitura();
    const tamanhoDaParte = typeof config.tamanho_parte_tokens === 'number' ? config.tamanho_parte_tokens : undefined;
    const concorrencia = typeof config.concorrencia === 'number' ? config.concorrencia : undefined;
    const modo = config.modo === 'sequencial' || config.modo === 'capitulos' ? config.modo : undefined;
    const configDaLeitura: ConfiguracaoDaLeitura = {
      ...base,
      ...(typeof config.modelo === 'string' ? { modelo: config.modelo } : {}),
      ...(typeof config.esforco === 'string' ? { esforco: config.esforco } : {}),
      ...(tamanhoDaParte === undefined ? {} : { tamanho_parte_tokens: tamanhoDaParte }),
      ...(concorrencia === undefined ? {} : { concorrencia }),
      ...(modo === undefined ? {} : { modo }),
    };
    if (pedidoV2 === undefined) {
      const iniciada = await iniciarExecucao(configDaLeitura, versao.id);
      return c.json({
        execucao_id: iniciada.execucao.id, versao_id: versao.id,
        partes: iniciada.partes.length, jobs: iniciada.jobs,
      }, 202);
    }
    const iniciada = await iniciarExecucaoV2(configDaLeitura, versao.id, pedidoV2)
      .catch((erro: unknown) => {
        if (erro instanceof Error && erro.message.includes('nenhum bloco elegível')) {
          throw new ErroDaApi(422, 'sem_blocos_elegiveis', 'O texto não tem nenhum bloco que a leitura possa marcar.');
        }
        throw erro;
      });
    return c.json({
      execucao_id: iniciada.execucao.id, versao_id: versao.id,
      partes: iniciada.partes.length, jobs: iniciada.jobs,
      schema_versao: 2, modo_de_leitura: iniciada.execucao.modo, nivel_de_atencao: iniciada.execucao.nivel_de_atencao_alvo,
      diagnosticos: iniciada.diagnosticos,
    }, 202);
  });

  api.post('/api/documentos/:id/importar-legado', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = await corpoJson(c) as { marcas?: unknown; mapa_paginas?: Record<string, number> };
    const versao = await ultimaVersao(banco, id);
    const mapa: MapaDePaginas | undefined = corpo.mapa_paginas === undefined ? undefined
      : new Map(Object.entries(corpo.mapa_paginas).map(([chave, valor]) => [Number(chave), valor]));
    try {
      const relatorio = await importarMarcasLegado(
        banco, versao.id, corpo.marcas ?? corpo, mapa, { reconciliarTipografia: true });
      return c.json(relatorio);
    } catch (erro) {
      throw new ErroDaApi(422, 'importacao_recusada', detalheSeguro(erro instanceof Error ? erro.message : 'falha na importação'));
    }
  });

  if (recursos.has('horarium')) api.post('/api/importar/horarium', async (c) => {
    const sessao = await corpoJson(c) as SessaoHorarium;
    try {
      const relatorio = await importarSessaoHorarium(banco, sessao);
      return c.json(relatorio, 201);
    } catch (erro) {
      throw new ErroDaApi(422, 'importacao_recusada', detalheSeguro(erro instanceof Error ? erro.message : 'falha na importação'));
    }
  });

  // ------------------------------------------------------------------ texto

  api.get('/api/versoes/:id/secoes', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'versão');
    const versao = await comTransacao(banco, (cliente) => documentosRepo.obterVersao(cliente, id))
      .catch(() => { throw new ErroDaApi(404, 'versao_inexistente'); });
    return c.json({
      versao_id: versao.id, documento_id: versao.documento_id,
      titulo: versao.canonico.documento.titulo,
      secoes: arvoreDeSecoes(versao.canonico.secoes),
      capitulos: capitulos(versao.canonico).map((secao) => ({ id: secao.id, titulo: secao.titulo })),
      limites: versao.canonico.limites,
    });
  });

  api.get('/api/versoes/:id/capitulos/:secaoId', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'versão');
    const secaoId = exigirUlid(c.req.param('secaoId'), 'seção');
    // `?camada=<id>|todas`; sem o parâmetro, a camada preferida do documento, senão a mais recente.
    const bruta = c.req.query('camada');
    const camada = bruta === undefined || bruta === '' ? undefined : bruta === 'todas' ? 'todas' : exigirUlid(bruta, 'camada');
    const snapshot = await comTransacao(banco, (cliente) => snapshotDoCapitulo(
      cliente, id, secaoId, (versaoId, assetId) => `/api/assets/${versaoId}/${assetId}`, camada,
      async (documentoId, versaoId) => (await geometriasDoCapitulo.ler(documentoId, versaoId))?.paginas.length ?? null, c.req.query('etiqueta')?.trim() || undefined))
      .catch((erro: unknown) => {
        if (erro instanceof CamadaInexistente) throw new ErroDaApi(404, 'camada_inexistente', 'A camada não é desta versão.');
        throw new ErroDaApi(404, 'versao_inexistente');
      });
    if (!snapshot) throw new ErroDaApi(404, 'capitulo_inexistente');
    const ilustracoes = (await lerIlustracoes(snapshot.documento_id, id))
      .filter((figura) => snapshot.blocos.some((bloco) => bloco.id === figura.bloco_id))
      .map(({ arquivo, ...figura }) => ({ ...figura, url: `/api/versoes/${id}/ilustracoes/${arquivo}` }));
    const formatacao = await formatacaoDaFonte(snapshot.documento_id, id, snapshot.blocos);
    return c.json({ ...snapshot, ilustracoes, formatacao });
  });

  api.get('/api/versoes/:id/ilustracoes/:nome', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'versão');
    const versao = await comTransacao(banco, (cliente) => documentosRepo.obterVersao(cliente, id))
      .catch(() => { throw new ErroDaApi(404, 'versao_inexistente'); });
    const caminho = await arquivoDaIlustracao(versao.documento_id, id, c.req.param('nome'));
    if (!caminho) throw new ErroDaApi(404, 'asset_inexistente');
    c.header('Content-Type', tipoDoArquivo(caminho));
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(new Uint8Array(await readFile(caminho)));
  });

  api.get('/api/assets/:versaoId/:assetId', async (c) => {
    const versaoId = c.req.param('versaoId');
    const assetId = c.req.param('assetId');
    // Identificador malformado é asset inexistente, não pedido malformado: responder
    // 400 aqui diria ao curioso que a diferença entre `..%2F..` e um ULID importa.
    if (!ehUlid(versaoId) || !ehUlid(assetId)) throw new ErroDaApi(404, 'asset_inexistente');
    const versao = await comTransacao(banco, (cliente) => documentosRepo.obterVersao(cliente, versaoId))
      .catch(() => { throw new ErroDaApi(404, 'asset_inexistente'); });
    const asset = versao.canonico.assets.find((candidato) => candidato.id === assetId);
    if (!asset) throw new ErroDaApi(404, 'asset_inexistente');
    // O caminho é o relativo que o motor gravou; a raiz é derivada dos identificadores.
    const caminho = dentroDaRaiz(pastaDaVersao(versao.documento_id, versao.id), asset.caminho);
    if (caminho === null) throw new ErroDaApi(404, 'asset_inexistente');
    let bytes: Buffer;
    try {
      const informacao = await stat(caminho);
      if (!informacao.isFile()) throw new Error('não é arquivo');
      bytes = await readFile(caminho);
    } catch {
      throw new ErroDaApi(404, 'asset_inexistente');
    }
    c.header('Content-Type', tipoDoArquivo(caminho));
    // Um SVG extraído de documento não roda script na origem do app, nem aberto direto na aba.
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'private, max-age=3600');
    return c.body(new Uint8Array(bytes));
  });

  // ------------------------------------------------------------------ progresso

  api.get('/api/documentos/:id/progresso', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const progresso = await comTransacao(banco, (cliente) => progressoRepo.ler(cliente, id));
    return c.json({ progresso });
  });

  api.put('/api/documentos/:id/progresso', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = await corpoJson(c) as ProgressoV1;
    if (corpo.documento_id !== id) throw new ErroDaApi(400, 'documento_divergente', 'O progresso é de outro documento.');
    try {
      const gravado = await comTransacao(banco, (cliente) => progressoRepo.gravar(cliente, corpo));
      return c.json({ progresso: gravado });
    } catch (erro) {
      if (erro instanceof progressoRepo.ProgressoObsoleto) {
        const atual = await comTransacao(banco, (cliente) => progressoRepo.ler(cliente, id));
        return c.json({ erro: 'progresso_obsoleto', revisao_atual: erro.revisao_atual, progresso: atual }, 409);
      }
      throw new ErroDaApi(422, 'progresso_recusado', detalheSeguro(erro instanceof Error ? erro.message : 'progresso inválido'));
    }
  });

  // ------------------------------------------------------------------ marcas

  api.patch('/api/marcas/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'marca');
    const corpo = await corpoJson(c) as { visivel?: unknown; avaliacao?: unknown; motivo?: unknown };
    const mudaVisibilidade = typeof corpo.visivel === 'boolean';
    const avaliacoes = ['nao_avaliada', 'confirmada', 'rejeitada'];
    const mudaAvaliacao = typeof corpo.avaliacao === 'string' && avaliacoes.includes(corpo.avaliacao);
    if (mudaVisibilidade === mudaAvaliacao) {
      throw new ErroDaApi(400, 'campo_unico', 'Envie exatamente um de `visivel` ou `avaliacao`.');
    }
    const motivo = typeof corpo.motivo === 'string' && corpo.motivo.trim() !== '' ? corpo.motivo.trim() : 'Decisão do leitor.';
    const resultado = await comTransacao(banco, async (cliente) => {
      const linha = (await cliente.query<{ versao_id: Id; execucao_id: Id | null }>(
        'SELECT versao_id, execucao_id FROM marca WHERE id=$1', [id])).rows[0];
      if (!linha) throw new ErroDaApi(404, 'marca_inexistente');
      if (linha.execucao_id === null) {
        throw new ErroDaApi(409, 'marca_sem_execucao', 'Só marcas ligadas a uma execução podem ser revisadas.');
      }
      const todas = await marcasRepo.listarPorVersao(cliente, linha.versao_id);
      const marca = todas.find((candidata) => candidata.id === id);
      // A revisão por lote ainda é V1 (`LoteRevisaoV2`). A marca de outro modo ou saliência (as projetadas da
      // compreensão, J30) recebe a decisão de produto direto na linha: a projeção publica cada capítulo uma vez só.
      if (!marca) {
        await cliente.query(mudaVisibilidade ? 'UPDATE marca SET visivel=$2 WHERE id=$1' : 'UPDATE marca SET avaliacao=$2 WHERE id=$1',
          [id, mudaVisibilidade ? corpo.visivel === true : corpo.avaliacao]);
        const marcasV2 = await marcasRepo.listarV2PorVersao(cliente, linha.versao_id);
        return { estado: 'aplicado' as const, marca: marcasV2.find((candidata) => candidata.id === id) ?? null,
          revisao_marcas: hashMarcas(await marcasRepo.listarPorVersao(cliente, linha.versao_id)) };
      }
      const lote: LoteRevisaoV2 = {
        id: ulid(), execucao_id: linha.execucao_id, snapshot_base: hashMarcas(todas),
        autor: 'leitor', motivo_do_lote: motivo,
        operacoes: [mudaVisibilidade
          ? {
            ordem: 0, marca_id: id, motivo, op: 'mudar_visibilidade',
            antes: { visivel: marca.visivel }, depois: { visivel: corpo.visivel === true },
          }
          : {
            ordem: 0, marca_id: id, motivo, op: 'avaliar',
            antes: { avaliacao: marca.avaliacao }, depois: { avaliacao: corpo.avaliacao as MarcaV1['avaliacao'] },
          }],
      };
      const aplicado = await marcasRepo.aplicarLote(cliente, lote);
      const atualizadas = await marcasRepo.listarPorVersao(cliente, linha.versao_id);
      return {
        estado: aplicado.estado,
        ...(aplicado.estado === 'recusado' ? { motivo: aplicado.motivo } : {}),
        marca: atualizadas.find((candidata) => candidata.id === id) ?? null,
        revisao_marcas: hashMarcas(atualizadas),
      };
    });
    return c.json(resultado);
  });

  // ------------------------------------------------------------------ F2 (J16)

  // Quadros (ligados por padrão; MARGEM_ARTE=0 desliga): as obras que a pessoa adiciona, preparadas pelo worker (J118).
  // `MARGEM_ARTE_FIXTURES=0`: sem as duas obras de demonstração do J94 (como na imagem Docker, que não leva web/public).
  if (recursos.has('arte')) registrarRotasDeArte(api, { banco, ...(process.env.MARGEM_ARTE_FIXTURES === '0' ? { fixtures: false } : {}) });
  registrarRotasF2(api, { banco, corpoJson, exigirUlid, ultimaVersao });
  registrarRotasDaCompreensao(api, {
    banco, corpoJson, exigirUlid, ultimaVersao,
    configuracao: opcoes.compreensao ?? (() => {
      const leitura = opcoes.leitura();
      return { banco, executor: leitura.executor, modelo: leitura.modelo, esforco: leitura.esforco, profundidadeDoPrefetch: profundidadeDoPrefetch() };
    }),
  });

  registrarRotasDaResolucao(api, { banco, corpoJson, exigirUlid, ultimaVersao });
  registrarRotasDosExercicios(api, { banco, corpoJson, exigirUlid, ultimaVersao, ...(opcoes.exercicios ?? {}) });
  // Visuais ancorados (J70).
  registrarRotasDosVisuais(api, { banco, corpoJson, exigirUlid });
  // Página "Perguntar": o agente com acesso à biblioteca inteira.
  registrarRotasDoAgente(api, { banco, corpoJson, exigirUlid });
  // Esquema do capítulo (mapa esquemático).
  registrarRotasDoEsquema(api, { banco, exigirUlid });
  // Flashcards: gerar do capítulo, estudar com repetição espaçada, exportar para o Anki.
  registrarRotasDosFlashcards(api, { banco, corpoJson, exigirUlid });
  // Visita guiada do livro (J91).
  registrarRotasDaVisita(api, { banco, exigirUlid });
  // Leitura comentada integral (J92).
  registrarRotasDaLeituraComentada(api, { banco, exigirUlid });
  // Notas do livro e da biblioteca, com exportação CSV/JSON.
  registrarRotasDasNotas(api, { banco, exigirUlid });
  // Exportação para o Obsidian: nota por documento, índice e ZIP (só leitura).
  registrarRotasDoObsidian(api, { banco, exigirUlid });
  registrarRotasDaMiniatura(api, { banco, exigirUlid });
  // Execuções do Codex para os avisos da interface.
  registrarRotasDasExecucoes(api, { banco, ouvinte, intervaloMs: intervaloEventosMs });
  // Primeira execução de uma instalação local: estado do Codex e do motor, exemplo e conclusão (J103).
  registrarRotasDaPrimeiraExecucao(api, { banco, ...(opcoes.primeiraExecucao ? { verificadores: opcoes.primeiraExecucao } : {}) });
  // Configurações → Modelos: modelo e esforço por categoria de execução (V-T10).
  registrarRotasDosModelos(api, { banco, corpoJson, recursos, ...(opcoes.buscarModelos ? { buscar: opcoes.buscarModelos } : {}) });
  // Salas de teste do beta, lado do dono (o testador fala só com o portão).
  if (recursos.has('sala')) registrarRotasDasSalas(api, { banco, corpoJson, exigirUlid });

  // ------------------------------------------------------------------ jobs

  // Cancelar (um job, uma análise, tudo do documento) e apagar o que foi feito (V-T8).
  registrarRotasDoApagar(api, { banco, exigirUlid });

  api.post('/api/jobs/:id/reenfileirar', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'job');
    const antes = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, id));
    if (!antes) throw new ErroDaApi(404, 'job_inexistente');
    const depois = jobsRepo.REENFILEIRAVEIS.includes(antes.estado) ? await jobsRepo.reenfileirar(banco, id) : null;
    if (!depois) {
      const atual = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, id));
      throw new ErroDaApi(409, 'job_nao_reenfileiravel',
        `Só se reenfileira job que falhou ou foi cancelado; este está em ${atual?.estado ?? antes.estado}.`);
    }
    return c.json({ job_id: id, estado: depois.estado, attempt: depois.attempt, estado_anterior: antes.estado });
  });

  // ------------------------------------------------------------------ eventos

  // Saúde leve para monitor externo: só confirma que a API responde e o banco também. Diz também quem
  // responde (V-W9): a extensão do navegador procura o Margem pelas portas 8730–8739 e confere a identificação.
  const identidade = identidadeDaSaude();
  api.get('/api/saude', async (c) => {
    try {
      await banco.query('SELECT 1');
      return c.json({ ok: true, ...identidade });
    } catch {
      return c.json({ ok: false, ...identidade }, 503);
    }
  });

  api.get('/api/estado', async (c) => {
    const estado = await comTransacao(banco, async (cliente) => ({
      ultimo_evento: (await cliente.query<{ id: string }>(
        'SELECT coalesce(max(id),0)::text AS id FROM evento_job')).rows[0]?.id ?? '0',
      documentos: await biblioteca(cliente),
      jobs_abertos: (await cliente.query<{ tipo: string; estado: string; total: number }>(
        `SELECT tipo, estado, count(*)::int AS total FROM job
         WHERE estado IN ('fila','reservado','adiado') GROUP BY tipo, estado ORDER BY tipo, estado`)).rows,
    }));
    return c.json(estado);
  });

  api.get('/api/eventos', (c) => {
    const cabecalho = c.req.header('last-event-id');
    const bruto = cabecalho ?? c.req.query('desde') ?? '0';
    const inicial = /^\d{1,19}$/.test(bruto) ? BigInt(bruto) : 0n;
    // O Hono responde HEAD com o handler do GET e descarta o corpo sem cancelá-lo: o fluxo nunca
    // aborta e a vaga do teto de conexões nunca volta. HEAD não abre fluxo.
    if (c.req.method === 'HEAD') return c.body(null, 200, { 'Content-Type': 'text/event-stream' });
    const liberar = taxa.abrirEventos(c);
    if (ouvinte) void ouvinte.iniciar();
    return streamSSE(c, async (fluxo) => {
      let desde = inicial;
      const parar = new AbortController();
      fluxo.onAbort(() => { parar.abort(); liberar(); });
      try {
        while (!fluxo.closed && !fluxo.aborted) {
          // A espera começa antes da leitura: um NOTIFY que chegue durante a consulta
          // não se perde, só provoca mais uma volta.
          const proximo = ouvinte?.esperar(intervaloEventosMs, parar.signal);
          const eventos = await comTransacao(banco, async (cliente) => (await cliente.query<{
            id: string; job_id: Id; tipo: string; quando: string; detalhe: unknown; job_tipo: string;
            documento_id: Id | null; versao_id: Id | null;
          }>(`SELECT e.id::text AS id, e.job_id, e.tipo, e.detalhe, j.tipo AS job_tipo,
                j.documento_id, j.versao_id,
                to_char(e.quando AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS quando
              FROM evento_job e JOIN job j ON j.id=e.job_id
              WHERE e.id > $1 ORDER BY e.id LIMIT 200`, [desde.toString()])).rows);
          for (const evento of eventos) {
            desde = BigInt(evento.id);
            await fluxo.writeSSE({ id: evento.id, event: evento.tipo, data: JSON.stringify(evento) });
          }
          if (proximo) await proximo;
          else await fluxo.sleep(intervaloEventosMs);
        }
      } finally {
        liberar();
      }
    });
  });

  return api;
}
