/**
 * Rotas da resolução de exercícios (J34).
 *
 *   POST /api/documentos/:id/resolucoes      { origem, texto_extraido } → sessão nova e o job que a resolve
 *        origem = { tipo: 'recorte', pagina, retangulo: {x,y,largura,altura} (frações da página), imagem_png: base64 }
 *               | { tipo: 'trecho', ancora }
 *   GET  /api/documentos/:id/resolucoes      as sessões do documento, com o estado de cada uma
 *   GET  /api/resolucoes/:id                 a sessão, o estado e os jobs
 *   GET  /api/resolucoes/:id/imagem          o PNG do recorte
 *   POST /api/resolucoes/:id/perguntas       { texto } → pergunta sobre a resolução (job de explicação)
 *
 * Ids e datas são do serviço; a imagem é gravada pelo hash dos bytes, e só PNG passa.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import { ulid } from 'ulid';
import { conferirAncora, validarAncora, type Id, type OrigemDaResolucaoV1, type ResolucaoV2 } from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';
import type { VersaoTexto } from '../repos/documentos.js';
import { DadoRecusado } from '../repos/anotacoes.js';
import * as repo from '../repos/resolucoes.js';
import { TIPO_EXPLICAR, TIPO_RESOLVER, caminhoDaImagem, chaves, enfileirarExplicacao, enfileirarResolucao } from '../resolucao/pipeline.js';
import { ErroDaApi } from './erros.js';

type ContextoDeCorpo = { req: { raw: Request } };
export interface ApoioDaResolucao {
  banco: pg.Pool;
  corpoJson: (c: ContextoDeCorpo) => Promise<unknown>;
  exigirUlid: (valor: string, papel: string) => Id;
  ultimaVersao: (banco: pg.Pool, documentoId: Id) => Promise<VersaoTexto>;
  agora?: () => Date;
}

/** Até 8 MB de PNG: um recorte de página em alta resolução cabe com folga. */
export const LIMITE_DA_IMAGEM_BYTES = 8 * 1024 * 1024;
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Corpo = Record<string, unknown>;
function objeto(bruto: unknown, permitidas: readonly string[]): Corpo {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  const desconhecidas = Object.keys(bruto).filter((chave) => !permitidas.includes(chave));
  if (desconhecidas.length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${desconhecidas.join(', ')}.`);
  return bruto as Corpo;
}

/** `pendente`: pedido criado em lote (descoberta dos exercícios de um livro), ainda sem job. */
export type EstadoDaResolucao = 'pendente' | 'resolvendo' | 'pronta' | 'respondendo' | 'falhou';
interface JobDaSessao { id: Id; tipo: string; estado: string; dedup_key: string }

async function jobsDa(cliente: Transacao, sessao: ResolucaoV2): Promise<JobDaSessao[]> {
  return (await cliente.query<JobDaSessao>(`SELECT id, tipo, estado, dedup_key FROM job WHERE dedup_key = $1 OR dedup_key LIKE $2 ORDER BY criado_em`,
    [chaves.resolver(sessao.id), `explicar:${sessao.id}:%`])).rows;
}
/** O estado que o leitor vê: o do último job pendente, ou pronta. */
export function estadoDa(sessao: ResolucaoV2, jobs: readonly JobDaSessao[]): EstadoDaResolucao {
  const resolver = jobs.find((job) => job.tipo === TIPO_RESOLVER);
  if (sessao.resolucao === null) {
    if (!resolver) return 'pendente';
    return resolver.estado === 'falhou' || resolver.estado === 'cancelado' ? 'falhou' : 'resolvendo';
  }
  const ultima = sessao.mensagens.at(-1);
  if (ultima?.autor !== 'leitor') return 'pronta';
  const explicar = jobs.find((job) => job.tipo === TIPO_EXPLICAR && job.dedup_key === chaves.explicar(sessao.id, ultima.id));
  return explicar?.estado === 'falhou' || explicar?.estado === 'cancelado' ? 'falhou' : 'respondendo';
}

function numero(valor: unknown, nome: string, minimo: number, maximo: number, inteiro = false): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < minimo || valor > maximo || (inteiro && !Number.isInteger(valor))) {
    throw new ErroDaApi(400, 'campo_invalido', `${nome} precisa ser um número entre ${String(minimo)} e ${String(maximo)}.`);
  }
  return valor;
}

export function registrarRotasDaResolucao(api: Hono, apoio: ApoioDaResolucao): void {
  const { banco, corpoJson, exigirUlid, ultimaVersao } = apoio;
  const agora = () => (apoio.agora ?? (() => new Date()))().toISOString();

  api.post('/api/documentos/:id/resolucoes', async (c) => {
    const documentoId = exigirUlid(c.req.param('id'), 'documento');
    const corpo = objeto(await corpoJson(c), ['origem', 'texto_extraido']);
    const textoExtraido = corpo.texto_extraido ?? '';
    if (typeof textoExtraido !== 'string' || textoExtraido.length > 20_000) throw new ErroDaApi(400, 'campo_invalido', 'texto_extraido é um texto de até 20 000 caracteres.');
    const versao = await ultimaVersao(banco, documentoId);
    const bruta = objeto(corpo.origem, ['tipo', 'pagina', 'retangulo', 'imagem_png', 'ancora']);
    let origem: OrigemDaResolucaoV1;
    let imagem: { bytes: Buffer; sha: string } | null = null;
    if (bruta.tipo === 'recorte') {
      const pagina = numero(bruta.pagina, 'pagina', 1, 100_000, true);
      const r = objeto(bruta.retangulo, ['x', 'y', 'largura', 'altura']);
      const retangulo = { x: numero(r.x, 'x', 0, 1), y: numero(r.y, 'y', 0, 1), largura: numero(r.largura, 'largura', 0, 1), altura: numero(r.altura, 'altura', 0, 1) };
      if (typeof bruta.imagem_png !== 'string') throw new ErroDaApi(400, 'campo_invalido', 'imagem_png é o PNG do recorte em base64.');
      const bytes = Buffer.from(bruta.imagem_png.replace(/^data:image\/png;base64,/, ''), 'base64');
      if (bytes.byteLength > LIMITE_DA_IMAGEM_BYTES) throw new ErroDaApi(413, 'imagem_grande_demais', `O limite é de ${String(LIMITE_DA_IMAGEM_BYTES)} bytes.`);
      if (!bytes.subarray(0, 8).equals(ASSINATURA_PNG)) throw new ErroDaApi(400, 'imagem_invalida', 'A imagem precisa ser PNG.');
      imagem = { bytes, sha: createHash('sha256').update(bytes).digest('hex') };
      origem = { tipo: 'recorte', pagina, retangulo, imagem_sha256: imagem.sha };
    } else if (bruta.tipo === 'trecho') {
      if (!validarAncora(bruta.ancora) || bruta.ancora.versao_id !== versao.id) throw new ErroDaApi(422, 'ancora_invalida', 'A âncora não é desta versão do documento.');
      const bloco = versao.canonico.blocos.find((item) => item.id === (bruta.ancora as { bloco_id: string }).bloco_id);
      if (!bloco || !conferirAncora(bloco, bruta.ancora)) throw new ErroDaApi(422, 'ancora_invalida', 'A citação não confere no bloco.');
      origem = { tipo: 'trecho', ancora: bruta.ancora };
    } else {
      throw new ErroDaApi(400, 'campo_invalido', "origem.tipo é 'recorte' ou 'trecho'.");
    }
    if (imagem) {
      const caminho = caminhoDaImagem(documentoId, imagem.sha);
      await mkdir(dirname(caminho), { recursive: true, mode: 0o700 });
      await writeFile(caminho, imagem.bytes, { mode: 0o600 });
    }
    const sessao: ResolucaoV2 = {
      versao: 2, id: ulid(), documento_id: documentoId, versao_id: versao.id, origem,
      texto_extraido: origem.tipo === 'trecho' && textoExtraido.trim() === '' ? origem.ancora.citacao : textoExtraido,
      resolucao: null, execucao: null, mensagens: [], criada_em: agora(),
    };
    const job = await comTransacao(banco, async (cliente) => {
      try { await repo.criar(cliente, sessao); } catch (erro) {
        if (erro instanceof DadoRecusado) throw new ErroDaApi(422, 'resolucao_invalida', erro.message);
        throw erro;
      }
      return enfileirarResolucao(cliente, sessao);
    });
    return c.json({ resolucao: sessao, estado: 'resolvendo', job_id: job.id }, 201);
  });

  api.get('/api/documentos/:id/resolucoes', async (c) => {
    const documentoId = exigirUlid(c.req.param('id'), 'documento');
    const resolucoes = await comTransacao(banco, async (cliente) => Promise.all((await repo.doDocumento(cliente, documentoId))
      .map(async (sessao) => ({ resolucao: sessao, estado: estadoDa(sessao, await jobsDa(cliente, sessao)) }))));
    return c.json({ resolucoes });
  });

  api.get('/api/resolucoes/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'resolução');
    const resposta = await comTransacao(banco, async (cliente) => {
      const sessao = await repo.obter(cliente, id);
      if (!sessao) throw new ErroDaApi(404, 'resolucao_inexistente');
      const jobs = await jobsDa(cliente, sessao);
      return { resolucao: sessao, estado: estadoDa(sessao, jobs), jobs: jobs.map(({ id: jobId, tipo, estado }) => ({ id: jobId, tipo, estado })) };
    });
    return c.json(resposta);
  });

  api.delete('/api/resolucoes/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'resolução');
    await comTransacao(banco, async (cliente) => {
      const sessao = await repo.obter(cliente, id, { travar: true });
      if (!sessao) throw new ErroDaApi(404, 'resolucao_inexistente');
      const estado = estadoDa(sessao, await jobsDa(cliente, sessao));
      if (estado === 'resolvendo' || estado === 'respondendo') throw new ErroDaApi(409, 'resolucao_em_andamento', 'Espere o Codex terminar antes de remover.');
      await repo.remover(cliente, id);
    });
    return c.body(null, 204);
  });

  api.get('/api/resolucoes/:id/imagem', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'resolução');
    const sessao = await comTransacao(banco, (cliente) => repo.obter(cliente, id));
    if (!sessao) throw new ErroDaApi(404, 'resolucao_inexistente');
    if (sessao.origem.tipo !== 'recorte') throw new ErroDaApi(404, 'sem_imagem', 'Esta resolução veio de um trecho do texto.');
    const bytes = await readFile(caminhoDaImagem(sessao.documento_id, sessao.origem.imagem_sha256));
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=604800' } });
  });

  api.post('/api/resolucoes/:id/perguntas', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'resolução');
    const corpo = objeto(await corpoJson(c), ['texto']);
    if (typeof corpo.texto !== 'string' || corpo.texto.trim() === '' || corpo.texto.length > 4000) throw new ErroDaApi(400, 'campo_invalido', 'texto é a pergunta, até 4000 caracteres.');
    const pergunta = corpo.texto.trim();
    const resposta = await comTransacao(banco, async (cliente) => {
      const sessao = await repo.obter(cliente, id, { travar: true });
      if (!sessao) throw new ErroDaApi(404, 'resolucao_inexistente');
      if (sessao.resolucao === null) throw new ErroDaApi(409, 'sem_resolucao', 'A resolução ainda não ficou pronta.');
      if (sessao.mensagens.at(-1)?.autor === 'leitor') throw new ErroDaApi(409, 'pergunta_pendente', 'A pergunta anterior ainda está sendo respondida.');
      const anterior = sessao.mensagens.at(-1)?.criada_em ?? sessao.criada_em;
      const instante = agora();
      const mensagem = { id: ulid(), autor: 'leitor' as const, texto: pergunta, criada_em: Date.parse(instante) >= Date.parse(anterior) ? instante : anterior };
      const nova = await repo.gravar(cliente, { ...sessao, mensagens: [...sessao.mensagens, mensagem] });
      const job = await enfileirarExplicacao(cliente, nova, mensagem.id);
      return { resolucao: nova, estado: 'respondendo' as const, job_id: job.id };
    });
    return c.json(resposta, 202);
  });
}

