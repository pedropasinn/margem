/**
 * Exercícios de um documento: a página própria, a descoberta em lote e a exportação em LaTeX.
 *
 *   GET  /api/documentos/:id/exercicios                todas as sessões, na ordem do livro, com capítulo, seção e estado
 *   POST /api/documentos/:id/exercicios/descobrir      { criar?: boolean } → o que achou por capítulo; com `criar`,
 *                                                      um pedido por exercício novo (estado `pendente`, sem job)
 *   POST /api/documentos/:id/exercicios/disparar       { limite: 1–50, capitulo? } → enfileira os próximos pendentes
 *   POST /api/resolucoes/:id/resolver                  pendente: enfileira; falhou: tenta de novo; pronta: refaz (sessão nova)
 *   GET  /api/documentos/:id/exercicios.tex|.pdf       ?capitulo=…&pendentes=1 → o LaTeX, ou o PDF compilado pelo tectonic
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { Id, ResolucaoV2 } from '@margem/contratos';
import { arquivoNosDados } from '../geometria/arquivos.js';
import { comTransacao, type Transacao } from '../db/transacao.js';
import type { VersaoTexto } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as repo from '../repos/resolucoes.js';
import { chaves, enfileirarResolucao, TIPO_EXPLICAR, TIPO_RESOLVER } from '../resolucao/pipeline.js';
import { compilarExercicios, LatexIndisponivel } from '../exercicios/compilar.js';
import { criarPedidos, descobrirNoCanonico, descobrirNoPdf, dispararPendentes, recortarNoPdf, type Descoberta } from '../exercicios/descoberta.js';
import { montarTex, type ExercicioParaExportar } from '../exercicios/latex.js';
import { ErroDaApi } from './erros.js';
import { estadoDa, type EstadoDaResolucao } from './rotas-resolucao.js';

type ContextoDeCorpo = { req: { raw: Request } };
export interface ApoioDosExercicios {
  banco: pg.Pool;
  corpoJson: (c: ContextoDeCorpo) => Promise<unknown>;
  exigirUlid: (valor: string, papel: string) => Id;
  ultimaVersao: (banco: pg.Pool, documentoId: Id) => Promise<VersaoTexto>;
  agora?: () => Date;
  /** Testes trocam a descoberta do PDF (o script e o OCR). */
  descobrirPdf?: typeof descobrirNoPdf;
  recortarPdf?: typeof recortarNoPdf;
}

export interface ExercicioDaLista {
  resolucao: ResolucaoV2;
  estado: EstadoDaResolucao;
  /** O capítulo do leitor onde o exercício está (para "ir ao exercício"). */
  secao_id: string | null;
  capitulo: string;
  secao: string | null;
  numero: string | null;
}

interface Documento { id: Id; titulo: string; autor: string | null; formato: string; origem_caminho: string }
async function documento(cliente: Transacao, id: Id): Promise<Documento> {
  const linha = (await cliente.query<Documento>('SELECT id, titulo, autor, formato, origem_caminho FROM documento WHERE id=$1', [id])).rows[0];
  if (!linha) throw new ErroDaApi(404, 'documento_inexistente');
  return linha;
}

interface JobDaSessao { id: Id; tipo: string; estado: string; dedup_key: string }
async function jobsDoDocumento(cliente: Transacao, documentoId: Id): Promise<Map<Id, JobDaSessao[]>> {
  const linhas = (await cliente.query<JobDaSessao>(`SELECT id, tipo, estado, dedup_key FROM job WHERE documento_id=$1 AND tipo = ANY($2::text[]) ORDER BY criado_em`,
    [documentoId, [TIPO_RESOLVER, TIPO_EXPLICAR]])).rows;
  const porSessao = new Map<Id, JobDaSessao[]>();
  for (const job of linhas) {
    const sessao = job.dedup_key.split(':')[1];
    if (sessao) porSessao.set(sessao, [...(porSessao.get(sessao) ?? []), job]);
  }
  return porSessao;
}

const SEM_CAPITULO = 'Exercícios avulsos';

/**
 * Onde a sessão cai no texto canônico: o capítulo (nível 1) que contém o bloco do trecho, ou o último
 * capítulo que começa antes da página do recorte. O id abre o leitor ali; o título só vale quando o
 * documento tem mais de um capítulo (um PDF escaneado costuma ter um só, com o título do livro).
 */
function lugarNoCanonico(versao: VersaoTexto | null, sessao: ResolucaoV2): { secao_id: string; titulo: string | null } | null {
  if (!versao) return null;
  const { blocos, secoes } = versao.canonico;
  const capitulos = secoes.filter((s) => s.nivel === 1);
  if (capitulos.length === 0) return null;
  const ordem = new Map(blocos.map((b) => [b.id, b.ordem]));
  const paginaDe = (blocoId: string) => blocos.find((b) => b.id === blocoId)?.origens.find((o) => o.tipo === 'pdf');
  let achado = capitulos[0]!;
  if (sessao.origem.tipo === 'trecho') {
    const blocoOrdem = ordem.get(sessao.origem.ancora.bloco_id) ?? -1;
    achado = capitulos.find((s) => (ordem.get(s.bloco_inicio) ?? Infinity) <= blocoOrdem && blocoOrdem <= (ordem.get(s.bloco_fim) ?? -Infinity)) ?? achado;
  } else {
    const pagina = sessao.origem.pagina;
    for (const capitulo of capitulos) {
      const inicio = paginaDe(capitulo.bloco_inicio);
      if (inicio?.tipo === 'pdf' && inicio.pagina <= pagina) achado = capitulo;
    }
  }
  return { secao_id: achado.id, titulo: capitulos.length > 1 ? achado.titulo : null };
}

/** Posição no livro: a página e a altura do recorte, ou a ordem do bloco. */
function posicao(versao: VersaoTexto | null, sessao: ResolucaoV2): number {
  if (sessao.origem.tipo === 'recorte') return sessao.origem.pagina * 10 + sessao.origem.retangulo.y;
  const blocoId = sessao.origem.ancora.bloco_id;
  return (versao?.canonico.blocos.find((b) => b.id === blocoId)?.ordem ?? 0) * 10;
}

export async function listarExercicios(cliente: Transacao, documentoId: Id, versao: VersaoTexto | null): Promise<ExercicioDaLista[]> {
  // Uma consulta de cada vez: o cliente da transação não aceita duas ao mesmo tempo.
  const sessoes = await repo.todasDoDocumento(cliente, documentoId);
  const jobs = await jobsDoDocumento(cliente, documentoId);
  return sessoes.map((sessao) => {
    const lugar = lugarNoCanonico(versao, sessao);
    return {
    resolucao: sessao,
    estado: estadoDa(sessao, jobs.get(sessao.id) ?? []),
    secao_id: lugar?.secao_id ?? null,
    capitulo: sessao.exercicio?.capitulo ?? lugar?.titulo ?? SEM_CAPITULO,
    secao: sessao.exercicio?.secao ?? null,
    numero: sessao.exercicio?.numero ?? null,
    chave: [posicao(versao, sessao), sessao.exercicio?.ordem ?? 0] as const,
    };
  }).sort((a, b) => a.chave[0] - b.chave[0] || a.chave[1] - b.chave[1] || a.resolucao.criada_em.localeCompare(b.resolucao.criada_em))
    .map((item) => { const { chave, ...resto } = item; void chave; return resto; });
}

function objeto(bruto: unknown, permitidas: readonly string[]): Record<string, unknown> {
  if (bruto === undefined || bruto === null) return {};
  if (typeof bruto !== 'object' || Array.isArray(bruto)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  const desconhecidas = Object.keys(bruto).filter((chave) => !permitidas.includes(chave));
  if (desconhecidas.length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${desconhecidas.join(', ')}.`);
  return bruto as Record<string, unknown>;
}

function resumo(descoberta: Descoberta): { capitulo: string | null; secoes: { secao: string | null; exercicios: number }[]; exercicios: number }[] {
  const capitulos: { capitulo: string | null; secoes: { secao: string | null; exercicios: number }[]; exercicios: number }[] = [];
  for (const ex of descoberta.exercicios) {
    let capitulo = capitulos.at(-1);
    if (capitulo?.capitulo !== ex.capitulo) { capitulo = { capitulo: ex.capitulo, secoes: [], exercicios: 0 }; capitulos.push(capitulo); }
    let secao = capitulo.secoes.at(-1);
    if (!secao || secao.secao !== ex.secao) { secao = { secao: ex.secao, exercicios: 0 }; capitulo.secoes.push(secao); }
    secao.exercicios += 1;
    capitulo.exercicios += 1;
  }
  return capitulos;
}

function nomeDoArquivo(titulo: string, extensao: string): string {
  const nome = `${titulo.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'documento'} (exercícios).${extensao}`;
  return `attachment; filename="exercicios.${extensao}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

export function registrarRotasDosExercicios(api: Hono, apoio: ApoioDosExercicios): void {
  const { banco, corpoJson, exigirUlid, ultimaVersao } = apoio;
  const agora = () => (apoio.agora ?? (() => new Date()))();
  const descobrirPdf = apoio.descobrirPdf ?? descobrirNoPdf;
  const recortarPdf = apoio.recortarPdf ?? recortarNoPdf;
  const versaoOuNada = (id: Id) => ultimaVersao(banco, id).catch((erro: unknown) => {
    if (erro instanceof ErroDaApi && erro.erro === 'sem_texto') return null;
    throw erro;
  });

  api.get('/api/documentos/:id/exercicios', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const doc = await comTransacao(banco, (cliente) => documento(cliente, id));
    const versao = await versaoOuNada(id);
    const exercicios = await comTransacao(banco, (cliente) => listarExercicios(cliente, id, versao));
    return c.json({ documento: { id: doc.id, titulo: doc.titulo, autor: doc.autor, formato: doc.formato }, exercicios });
  });

  api.post('/api/documentos/:id/exercicios/descobrir', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = objeto(await corpoJson(c).catch(() => ({})), ['criar']);
    if (corpo.criar !== undefined && typeof corpo.criar !== 'boolean') throw new ErroDaApi(400, 'campo_invalido', 'criar é true ou false.');
    const doc = await comTransacao(banco, (cliente) => documento(cliente, id));
    const versao = await ultimaVersao(banco, id);
    let descoberta: Descoberta;
    let original: string | null = null;
    if (doc.formato === 'pdf') {
      original = await arquivoNosDados(doc.origem_caminho);
      if (!original) throw new ErroDaApi(404, 'original_indisponivel');
      try { descoberta = await descobrirPdf(id, original); } catch (erro) {
        throw new ErroDaApi(500, 'descoberta_falhou', erro instanceof Error ? erro.message.slice(0, 400) : 'A descoberta falhou.');
      }
    } else {
      descoberta = { fonte: 'canonico', exercicios: descobrirNoCanonico(versao.id, versao.canonico) };
    }
    let lote = null;
    if (corpo.criar === true && descoberta.exercicios.length > 0) {
      const imagens = original ? await recortarPdf(original, descoberta.exercicios) : new Map<number, Buffer>();
      lote = await comTransacao(banco, (cliente) => criarPedidos(cliente, id, versao.id, descoberta.exercicios, imagens, () => agora().toISOString()));
    }
    return c.json({ fonte: descoberta.fonte, total: descoberta.exercicios.length, capitulos: resumo(descoberta), ...(lote ? { lote } : {}) }, lote ? 201 : 200);
  });

  api.post('/api/documentos/:id/exercicios/disparar', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = objeto(await corpoJson(c), ['limite', 'capitulo']);
    const limite = corpo.limite;
    if (typeof limite !== 'number' || !Number.isInteger(limite) || limite < 1 || limite > 50) throw new ErroDaApi(400, 'campo_invalido', 'limite é um inteiro de 1 a 50.');
    if (corpo.capitulo !== undefined && typeof corpo.capitulo !== 'string') throw new ErroDaApi(400, 'campo_invalido', 'capitulo é o nome do capítulo.');
    const disparados = await comTransacao(banco, async (cliente) => {
      await documento(cliente, id);
      return dispararPendentes(cliente, id, limite, corpo.capitulo === undefined ? {} : { capitulo: corpo.capitulo as string });
    });
    const restantes = await comTransacao(banco, async (cliente) => (await listarExercicios(cliente, id, null)).filter((ex) => ex.estado === 'pendente').length);
    return c.json({ disparados, restantes }, 202);
  });

  api.post('/api/resolucoes/:id/resolver', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'resolução');
    const resposta = await comTransacao(banco, async (cliente) => {
      const sessao = await repo.obter(cliente, id, { travar: true });
      if (!sessao) throw new ErroDaApi(404, 'resolucao_inexistente');
      const jobs = (await jobsDoDocumento(cliente, sessao.documento_id)).get(sessao.id) ?? [];
      const estado = estadoDa(sessao, jobs);
      if (estado === 'resolvendo' || estado === 'respondendo') throw new ErroDaApi(409, 'resolucao_em_andamento', 'O Codex já está trabalhando neste exercício.');
      if (estado === 'pendente') {
        const job = await enfileirarResolucao(cliente, sessao);
        return { resolucao: sessao, estado: 'resolvendo' as const, job_id: job.id };
      }
      if (estado === 'falhou') {
        // A resolução (ou a resposta a uma pergunta) que falhou volta para a fila como estava.
        const falho = sessao.resolucao === null ? jobs.find((job) => job.dedup_key === chaves.resolver(sessao.id)) : jobs.at(-1);
        if (falho && jobsRepo.REENFILEIRAVEIS.includes(falho.estado as jobsRepo.EstadoJob)) {
          return { resolucao: sessao, estado: sessao.resolucao === null ? 'resolvendo' as const : 'respondendo' as const, job_id: falho.id, reenfileirar: true };
        }
      }
      // Refazer: uma sessão nova com o mesmo exercício (a chave do job é a sessão), e a antiga sai.
      const nova: ResolucaoV2 = {
        versao: 2, id: ulid(), documento_id: sessao.documento_id, versao_id: sessao.versao_id, origem: sessao.origem, texto_extraido: sessao.texto_extraido,
        ...(sessao.exercicio ? { exercicio: sessao.exercicio } : {}), resolucao: null, execucao: null, mensagens: [], criada_em: agora().toISOString(),
      };
      await repo.criar(cliente, nova);
      const job = await enfileirarResolucao(cliente, nova);
      await repo.remover(cliente, sessao.id);
      return { resolucao: nova, estado: 'resolvendo' as const, job_id: job.id };
    });
    if ('reenfileirar' in resposta) {
      const job = await jobsRepo.reenfileirar(banco, resposta.job_id);
      return c.json({ resolucao: resposta.resolucao, estado: resposta.estado, job_id: job?.id ?? resposta.job_id }, 202);
    }
    return c.json(resposta, 202);
  });

  const paraExportar = async (c: { req: { param: (nome: string) => string; query: (nome: string) => string | undefined } }) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const doc = await comTransacao(banco, (cliente) => documento(cliente, id));
    const versao = await versaoOuNada(id);
    const capitulo = c.req.query('capitulo');
    const pendentes = c.req.query('pendentes') === '1';
    const lista = await comTransacao(banco, (cliente) => listarExercicios(cliente, id, versao));
    const exercicios: ExercicioParaExportar[] = lista
      .filter((ex) => (pendentes || ex.resolucao.resolucao !== null) && (capitulo === undefined || capitulo === '' || ex.capitulo === capitulo))
      .map((ex) => ({ sessao: ex.resolucao, capitulo: ex.capitulo, secao: ex.secao, numero: ex.numero }));
    return { doc, exercicios, documentoDoTex: { titulo: doc.titulo, autor: doc.autor, geradoEm: agora() } };
  };

  api.get('/api/documentos/:id/exercicios.tex', async (c) => {
    const { doc, exercicios, documentoDoTex } = await paraExportar(c);
    c.header('Content-Type', 'application/x-tex; charset=utf-8');
    c.header('Content-Disposition', nomeDoArquivo(doc.titulo, 'tex'));
    c.header('Cache-Control', 'no-store');
    return c.body(montarTex(documentoDoTex, exercicios).tex);
  });

  api.get('/api/documentos/:id/exercicios.pdf', async (c) => {
    const { doc, exercicios, documentoDoTex } = await paraExportar(c);
    let resultado;
    try { resultado = await compilarExercicios(documentoDoTex, exercicios); } catch (erro) {
      if (erro instanceof LatexIndisponivel) throw new ErroDaApi(503, 'latex_indisponivel', erro.message);
      throw new ErroDaApi(500, 'latex_falhou', erro instanceof Error ? erro.message.slice(0, 600) : 'O LaTeX não compilou.');
    }
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', nomeDoArquivo(doc.titulo, 'pdf'));
    c.header('Cache-Control', 'no-store');
    c.header('X-Margem-Exercicios', String(exercicios.length));
    c.header('X-Margem-Modo-Seguro', String(resultado.seguros.length));
    c.header('X-Margem-Omitidos', String(resultado.omitidos.length));
    return c.body(new Uint8Array(resultado.pdf), 200);
  });
}
