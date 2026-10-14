/**
 * Rotas dos visuais ancorados (J70): pedir uma imagem ou um fluxograma para um trecho, um bloco ou
 * o capítulo; listar os do capítulo; gerar de novo (versão nova, a anterior fica); excluir; servir o PNG.
 *
 * Id, datas e estado são do serviço; o corpo só traz o que o leitor decide (tipo, alvo, pedido).
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  conferirAncora, validarAncora, validarVisual, type AlvoDoVisual, type Id, type TipoDoVisual, type VisualV1,
} from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { arquivoNosDados } from '../geometria/arquivos.js';
import { obterVersao } from '../repos/documentos.js';
import * as visuaisRepo from '../repos/visuais.js';
import { caminhoDaImagem } from '../visuais/arquivos.js';
import { blocosDaSecao, enfileirarVisual } from '../visuais/manipuladores.js';
import { ErroDaApi } from './erros.js';
import * as jobsRepo from '../repos/jobs.js';
import { cancelarOperacoes } from '../apagar/cancelar.js';

type ContextoDeCorpo = { req: { raw: Request } };
export interface ApoioDosVisuais {
  banco: pg.Pool;
  corpoJson: (c: ContextoDeCorpo) => Promise<unknown>;
  exigirUlid: (valor: string, papel: string) => Id;
}
type Corpo = Record<string, unknown>;

function objeto(bruto: unknown, permitidas: readonly string[]): Corpo {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  const desconhecidas = Object.keys(bruto).filter((chave) => !permitidas.includes(chave));
  if (desconhecidas.length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${desconhecidas.join(', ')}.`);
  return bruto as Corpo;
}

/** Decisão de produto: ausente, `null` ou só espaços viram "sem pedido". */
function lerPedido(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ErroDaApi(400, 'pedido_invalido', 'O pedido é um texto.');
  const texto = valor.trim();
  if (texto.length > 2000) throw new ErroDaApi(400, 'pedido_longo', 'O pedido passa de 2000 caracteres.');
  return texto === '' ? null : texto;
}

function lerTipo(valor: unknown): TipoDoVisual {
  if (valor !== 'imagem' && valor !== 'diagrama') throw new ErroDaApi(400, 'tipo_invalido', 'O tipo é imagem ou diagrama.');
  return valor;
}

/** Confere o alvo contra o texto real: a seção existe, o trecho está nela e bate com o bloco. */
async function conferirAlvo(cliente: Transacao, versaoId: Id, secaoId: Id, bruto: unknown): Promise<AlvoDoVisual> {
  const versao = await obterVersao(cliente, versaoId).catch(() => null);
  if (!versao) throw new ErroDaApi(404, 'versao_inexistente');
  const secao = versao.canonico.secoes.find((candidata) => candidata.id === secaoId);
  if (!secao) throw new ErroDaApi(404, 'secao_inexistente', 'A seção não existe nesta versão.');
  const alvo = objeto(bruto, ['tipo', 'ancora']);
  if (alvo.tipo === 'capitulo') {
    if (alvo.ancora !== undefined) throw new ErroDaApi(400, 'alvo_invalido', 'O alvo capítulo não leva âncora.');
    return { tipo: 'capitulo' };
  }
  if (alvo.tipo !== 'trecho' && alvo.tipo !== 'bloco') throw new ErroDaApi(400, 'alvo_invalido', 'O alvo é trecho, bloco ou capítulo.');
  const ancora = alvo.ancora;
  if (!validarAncora(ancora) || ancora.versao_id !== versaoId) throw new ErroDaApi(422, 'ancora_invalida', 'A âncora não segue AncoraV1 ou é de outra versão.');
  const bloco = blocosDaSecao(versao.canonico, secao).find((candidato) => candidato.id === ancora.bloco_id);
  if (!bloco) throw new ErroDaApi(422, 'ancora_fora_da_secao', 'O trecho não está nesta seção.');
  if (!conferirAncora(bloco, ancora)) throw new ErroDaApi(422, 'ancora_nao_confere', 'A citação não confere com o texto do bloco.');
  if (alvo.tipo === 'bloco' && (ancora.inicio_utf16 !== 0 || ancora.fim_utf16 !== bloco.texto.length)) {
    throw new ErroDaApi(422, 'bloco_parcial', 'O alvo bloco cobre o bloco inteiro.');
  }
  return { tipo: alvo.tipo, ancora };
}

async function criarEEnfileirar(cliente: Transacao, novo: visuaisRepo.NovoVisual): Promise<VisualV1> {
  // O contrato confere o pedido antes de qualquer escrita (estado inicial `pendente`).
  const agora = new Date().toISOString();
  const candidato: VisualV1 = {
    versao: 1, id: '00000000000000000000000000', versao_id: novo.versao_id, secao_id: novo.secao_id, tipo: novo.tipo, alvo: novo.alvo,
    ...(novo.pedido === null ? {} : { pedido: novo.pedido }), estado: 'pendente', diagnosticos: [],
    ...(novo.substitui === null ? {} : { substitui: novo.substitui }), criado_em: agora, atualizado_em: agora,
  };
  if (!validarVisual(candidato)) throw new ErroDaApi(422, 'visual_invalido', 'O pedido não segue o contrato VisualV1.');
  const id = await visuaisRepo.criar(cliente, novo);
  await enfileirarVisual(cliente, { id, versao_id: novo.versao_id, tipo: novo.tipo });
  const criado = await visuaisRepo.obter(cliente, id);
  if (!criado) throw new Error('Visual recém-criado ausente.');
  return criado;
}

export function registrarRotasDosVisuais(api: Hono, apoio: ApoioDosVisuais): void {
  const { banco, corpoJson, exigirUlid } = apoio;

  api.get('/api/versoes/:versao/capitulos/:secao/visuais', async (c) => {
    const versao = exigirUlid(c.req.param('versao'), 'versão');
    const secao = exigirUlid(c.req.param('secao'), 'seção');
    const visuais = await comTransacao(banco, (cliente) => visuaisRepo.doCapitulo(cliente, versao, secao));
    return c.json({ visuais });
  });

  api.post('/api/visuais', async (c) => {
    const corpo = objeto(await corpoJson(c), ['tipo', 'versao_id', 'secao_id', 'alvo', 'pedido']);
    const tipo = lerTipo(corpo.tipo);
    const versaoId = exigirUlid(typeof corpo.versao_id === 'string' ? corpo.versao_id : '', 'versão');
    const secaoId = exigirUlid(typeof corpo.secao_id === 'string' ? corpo.secao_id : '', 'seção');
    const pedido = lerPedido(corpo.pedido);
    const visual = await comTransacao(banco, async (cliente) => {
      const alvo = await conferirAlvo(cliente, versaoId, secaoId, corpo.alvo);
      return criarEEnfileirar(cliente, { versao_id: versaoId, secao_id: secaoId, tipo, alvo, pedido, substitui: null });
    });
    return c.json({ visual }, 201);
  });

  api.post('/api/visuais/:id/regenerar', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'visual');
    const corpo = objeto(await corpoJson(c), ['pedido']);
    const visual = await comTransacao(banco, async (cliente) => {
      const anterior = await visuaisRepo.obter(cliente, id, { travar: true });
      if (!anterior) throw new ErroDaApi(404, 'visual_inexistente');
      if (anterior.estado === 'pendente' || anterior.estado === 'executando') throw new ErroDaApi(409, 'visual_em_curso', 'Este visual ainda está sendo gerado.');
      const pedido = 'pedido' in corpo ? lerPedido(corpo.pedido) : anterior.pedido ?? null;
      return criarEEnfileirar(cliente, {
        versao_id: anterior.versao_id, secao_id: anterior.secao_id, tipo: anterior.tipo, alvo: anterior.alvo, pedido, substitui: anterior.id,
      });
    });
    return c.json({ visual }, 201);
  });

  api.delete('/api/visuais/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'visual');
    const apagado = await comTransacao(banco, async (cliente) => {
      // Ainda sendo desenhado: o Codex para (V-T8) e nada do que ele faria fica.
      const job = (await cliente.query<{ id: Id; estado: jobsRepo.EstadoJob }>('SELECT j.id, j.estado FROM visual v JOIN job j ON j.id = v.job_id WHERE v.id=$1', [id])).rows[0];
      if (job && jobsRepo.CANCELAVEIS.includes(job.estado)) await cancelarOperacoes(cliente, { job_id: job.id });
      return visuaisRepo.apagar(cliente, id);
    });
    if (!apagado) throw new ErroDaApi(404, 'visual_inexistente');
    return c.json({ visual_id: id, apagado: true });
  });

  api.get('/api/visuais/:id/imagem', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'visual');
    const hash = await comTransacao(banco, (cliente) => visuaisRepo.imagem(cliente, id));
    const caminho = hash === null ? null : await arquivoNosDados(caminhoDaImagem(hash));
    if (hash === null || caminho === null) throw new ErroDaApi(404, 'imagem_indisponivel');
    const etag = `"${hash}"`;
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    const arquivo = await open(caminho, 'r');
    try {
      const tamanho = (await arquivo.stat()).size;
      c.header('Content-Type', 'image/png');
      c.header('Content-Length', String(tamanho));
      c.header('X-Content-Type-Options', 'nosniff');
      return c.body(Readable.toWeb(arquivo.createReadStream({ autoClose: true })) as ReadableStream<Uint8Array>, 200);
    } catch (erro) { await arquivo.close(); throw erro; }
  });
}
