/**
 * Quadros, servidos do acervo de arquivos (`../arte/acervo.ts`) e das fixtures do J94. O Margem não
 * distribui acervo (J118): a pessoa adiciona as obras que quer estudar e o worker prepara cada uma.
 *
 *   GET    /api/arte                                    lista: título, artista, ano, miniatura, análises; e `preparando`:
 *                                                       as obras da pessoa ainda na fila, em preparo ou com falha
 *   POST   /api/arte                                    multipart `arquivo` (JPEG, PNG ou WebP) + `titulo`, `artista`, `ano`
 *                                                       opcionais → 202 QuadroDaPessoaV1
 *   PUT    /api/arte/:slug/identificacao                IdentificacaoDaObraV1: corrige título/artista/ano e prepara de novo
 *   POST   /api/arte/:slug/tentar-de-novo               depois de uma falha, retoma o preparo
 *   DELETE /api/arte/:slug                              remove uma obra da pessoa (pasta e linha)
 *   GET    /api/arte/:slug                              a análise publicada (modelo + curta) e a lista de análises; numa obra
 *                                                       não identificada (V-W5), `nao_identificada` e o `palpite` do Codex
 *   GET /api/arte/:slug/analises/:rotulo                uma análise (`esperado` ou uma geração)
 *   GET /api/arte/:slug/imagem                          a reprodução (ETag = SHA-256, Range)
 *   GET /api/arte/:slug/miniatura                       a capa leve, gerada uma vez e guardada em cache
 *   GET /api/arte/:slug/audio/:rotulo/manifesto.json    tempos reais de batida e palavra
 *   GET /api/arte/:slug/audio/:rotulo/narracao.mp3      a narração (Range)
 *
 * Sem banco (o harness `previa-arte.ts`), só as rotas de leitura.
 */
import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { Context, Hono } from 'hono';
import type pg from 'pg';
import { validarIdentificacaoDaObra } from '@margem/contratos';
import { ehRotulo, ehSlug, lerAcervo, lerManifesto, lerObra, raizDoAcervo, type AnaliseNoAcervo, type ObraNoAcervo, type OpcoesDoAcervo } from '../arte/acervo.js';
import { EXTENSAO_DO_FORMATO, formatoPelaAssinatura, LIMITE_DA_IMAGEM_DO_QUADRO, TIPO_DO_FORMATO } from '../arte/imagem-enviada.js';
import { miniaturaDe } from '../arte/miniaturas.js';
import { corrigirIdentificacao, listarQuadrosDaPessoa, palpiteParaInterface, pastaDoQuadro, registrarEnvio, removerQuadro, tentarDeNovo, type Alteracao } from '../arte/quadros-da-pessoa.js';
import { lerIdentificacaoProposta } from '../arte/preparo.js';
import { obraNaoIdentificada } from '../../../core/src/arte.js';
import { comTransacao } from '../db/transacao.js';
import * as quadrosRepo from '../arte/repo.js';
import { faixaDeBytes } from './documento-original.js';
import { lerCorpoJson } from './entrada-json.js';
import { ErroDaApi } from './erros.js';
import { lerFormularioLimitado } from './seguranca.js';

export interface ResumoDaAnalise { rotulo: string; titulo: string; origem: AnaliseNoAcervo['origem']; publicada: boolean; audio: boolean; atualizada_em: string }

const caminhoDaImagem = (slug: string): string => `/api/arte/${slug}/imagem`;
const caminhoDaMiniatura = (slug: string): string => `/api/arte/${slug}/miniatura`;

function resumirAnalises(obra: ObraNoAcervo): ResumoDaAnalise[] {
  return obra.analises.map((a) => ({ rotulo: a.rotulo, titulo: a.titulo, origem: a.origem, publicada: a.rotulo === obra.publicada, audio: a.audio !== null, atualizada_em: a.atualizada_em }));
}

/**
 * A análise como está no acervo (o modelo continua válido pelo contrato: `imagem.url` é `/arte/<slug>.jpg`).
 * O app não usa esse caminho: a imagem vem de `imagem` (a rota do serviço, que lê `imagem.jpg`).
 */
function analiseParaApp(obra: ObraNoAcervo, analise: AnaliseNoAcervo) {
  return {
    rotulo: analise.rotulo, titulo: analise.titulo, origem: analise.origem, audio: analise.audio !== null,
    imagem: caminhoDaImagem(obra.slug), modelo: analise.modelo, curta: analise.curta,
  };
}

const TIPOS: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', jpg: 'image/jpeg' };

/** Um arquivo com ETag e uma faixa de bytes (como o original do PDF). */
async function servirArquivo(c: Context, caminho: string, tipo: string, etag: string, cache = 'private, max-age=3600'): Promise<Response> {
  const arquivo = await open(caminho, 'r');
  try {
    const tamanho = (await arquivo.stat()).size;
    c.header('Content-Type', tipo);
    c.header('Accept-Ranges', 'bytes');
    c.header('ETag', etag);
    c.header('Cache-Control', cache);
    if (c.req.header('if-none-match')?.split(',').some((item) => item.trim().replace(/^W\//, '') === etag)) { await arquivo.close(); return c.body(null, 304); }
    const range = c.req.header('range');
    const condicao = c.req.header('if-range');
    const pedirFaixa = range !== undefined && (condicao === undefined || condicao === etag);
    const faixa = pedirFaixa ? faixaDeBytes(range, tamanho) : { inicio: 0, fim: tamanho - 1 };
    if (faixa === null) { await arquivo.close(); c.header('Content-Range', `bytes */${String(tamanho)}`); return c.body(null, 416); }
    if (pedirFaixa) c.header('Content-Range', `bytes ${String(faixa.inicio)}-${String(faixa.fim)}/${String(tamanho)}`);
    c.header('Content-Length', String(Math.max(0, faixa.fim - faixa.inicio + 1)));
    if (tamanho === 0) { await arquivo.close(); return c.body(null, 200); }
    const fluxo = arquivo.createReadStream({ start: faixa.inicio, end: faixa.fim, autoClose: true });
    return c.body(Readable.toWeb(fluxo) as ReadableStream<Uint8Array>, pedirFaixa ? 206 : 200);
  } catch (erro) { await arquivo.close(); throw erro; }
}

/** Um campo de texto do formulário, aparado; vazio vira `null`. Uma linha só, até `maximo` caracteres. */
function campo(formulario: FormData, nome: string, maximo: number): string | null {
  const valor = formulario.get(nome);
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  if (limpo === '') return null;
  if (limpo.length > maximo || /[\r\n\u2028\u2029]/u.test(limpo)) throw new ErroDaApi(400, 'campo_invalido', `${nome} é uma linha de até ${String(maximo)} caracteres.`);
  return limpo;
}

/**
 * Obra não identificada (V-W5): a análise publicada é só pela imagem. A interface mostra "Obra não
 * identificada", o palpite do Codex (quando há) como palpite e o caminho para informar título e artista.
 */
async function semIdentificacao(obra: ObraNoAcervo, analise: AnaliseNoAcervo) {
  if (!obraNaoIdentificada(analise.modelo)) return {};
  const proposta = obra.pasta ? await lerIdentificacaoProposta(obra.pasta) : null;
  return { nao_identificada: true as const, ...(proposta ? { palpite: palpiteParaInterface(proposta) } : {}) };
}

/** A obra está na pasta da pessoa (não no acervo antigo nem entre as de exemplo): pode ser removida. */
const daPessoa = (obra: ObraNoAcervo): boolean => obra.pasta !== null && resolve(dirname(obra.pasta)) === resolve(raizDoAcervo());

const MENSAGENS_DA_ALTERACAO: Record<string, [404 | 409, string]> = {
  quadro_inexistente: [404, 'Esta obra não está entre as que você adicionou.'],
  preparo_em_curso: [409, 'A obra ainda está sendo preparada.'],
  quadro_pronto: [409, 'A obra já está pronta.'],
};
function respostaDaAlteracao(c: Context, alteracao: Alteracao): Response {
  if ('erro' in alteracao) {
    const [status, detalhe] = MENSAGENS_DA_ALTERACAO[alteracao.erro]!;
    return c.json({ erro: alteracao.erro, detalhe }, status);
  }
  return c.json(alteracao.quadro, 202);
}

export interface OpcoesDasRotasDeArte extends OpcoesDoAcervo {
  /** Sem banco (o harness `previa-arte.ts`), só as rotas de leitura e nenhuma obra da pessoa. */
  banco?: pg.Pool;
}

export function registrarRotasDeArte(api: Hono, opcoes: OpcoesDasRotasDeArte = {}): void {
  const { banco } = opcoes;
  const obra = (slug: string) => lerObra(slug, opcoes);
  const naoHa = (c: Context, erro = 'obra_inexistente') => c.json({ erro }, 404);

  api.get('/api/arte', async (c) => {
    const [lidas, daPessoaNoBanco] = await Promise.all([lerAcervo(opcoes), banco ? listarQuadrosDaPessoa(banco) : Promise.resolve([])]);
    // Uma obra pronta que está sendo preparada de novo (identificação corrigida) aparece só em `preparando`.
    const emPreparo = new Set(daPessoaNoBanco.filter(({ quadro }) => quadro.estado !== 'pronto').map(({ quadro }) => quadro.slug));
    const obras = lidas.filter((o) => !(o.origem === 'acervo' && daPessoa(o) && emPreparo.has(o.slug)));
    return c.json({
      preparando: daPessoaNoBanco.map(({ quadro }) => quadro).filter((q) => q.estado !== 'pronto'),
      obras: await Promise.all(obras.map(async (o) => {
        const publicada = o.analises.find((a) => a.rotulo === o.publicada) ?? o.analises[0]!;
        const { identidade, imagem } = publicada.modelo;
        return {
          slug: o.slug, titulo: identidade.titulo, titulo_original: identidade.titulo_original, artista: identidade.artista,
          data: identidade.data, ano: /\d{4}/.exec(identidade.data)?.[0] ?? null, tecnica: identidade.tecnica,
          largura: imagem.largura, altura: imagem.altura, imagem: caminhoDaImagem(o.slug), miniatura: caminhoDaMiniatura(o.slug),
          adicionado_em: o.adicionado_em, analises: resumirAnalises(o),
          exemplo: o.origem === 'fixture', removivel: o.origem === 'acervo' && daPessoa(o),
          ...await semIdentificacao(o, publicada),
        };
      })),
    });
  });

  api.get('/api/arte/:slug', async (c) => {
    const o = await obra(c.req.param('slug'));
    if (!o) return naoHa(c);
    const publicada = o.analises.find((a) => a.rotulo === o.publicada) ?? o.analises[0]!;
    return c.json({
      slug: o.slug, origem: o.origem, adicionado_em: o.adicionado_em,
      imagem: { url: caminhoDaImagem(o.slug), miniatura: caminhoDaMiniatura(o.slug), info: o.info },
      analises: resumirAnalises(o),
      analise: analiseParaApp(o, publicada),
      removivel: o.origem === 'acervo' && daPessoa(o),
      ...await semIdentificacao(o, publicada),
    });
  });

  api.get('/api/arte/:slug/analises/:rotulo', async (c) => {
    const o = await obra(c.req.param('slug'));
    const analise = o?.analises.find((a) => a.rotulo === c.req.param('rotulo'));
    if (!o || !analise) return naoHa(c, 'analise_inexistente');
    return c.json(analiseParaApp(o, analise));
  });

  api.get('/api/arte/:slug/imagem', async (c) => {
    const o = await obra(c.req.param('slug'));
    if (!o) return naoHa(c);
    return servirArquivo(c, o.imagem, 'image/jpeg', `"${o.analises[0]!.modelo.imagem.sha256}"`, 'private, max-age=86400');
  });

  api.get('/api/arte/:slug/miniatura', async (c) => {
    const slug = c.req.param('slug');
    const o = await obra(slug);
    if (!o) return miniaturaEmPreparo(c, slug);
    try {
      const caminho = await miniaturaDe(o);
      return await servirArquivo(c, caminho, 'image/jpeg', `"m-${o.analises[0]!.modelo.imagem.sha256.slice(0, 32)}"`, 'private, max-age=86400');
    } catch (erro) {
      console.warn(`[arte] ${o.slug}: miniatura indisponível (${erro instanceof Error ? erro.message : String(erro)}); servindo a imagem inteira`);
      return servirArquivo(c, o.imagem, 'image/jpeg', `"${o.analises[0]!.modelo.imagem.sha256}"`);
    }
  });

  api.get('/api/arte/:slug/audio/:rotulo/:arquivo', async (c) => {
    const rotulo = c.req.param('rotulo');
    const nome = c.req.param('arquivo');
    if (!ehRotulo(rotulo)) return naoHa(c, 'audio_inexistente');
    const o = await obra(c.req.param('slug'));
    const analise = o?.analises.find((a) => a.rotulo === rotulo);
    if (!o || !analise?.audio) return naoHa(c, 'audio_inexistente');
    const manifesto = await lerManifesto(o, analise);
    if (!manifesto) return naoHa(c, 'audio_inexistente');
    if (nome === 'manifesto.json') return c.json(manifesto);
    if (nome !== manifesto.arquivo && nome !== 'narracao.mp3') return naoHa(c, 'audio_inexistente');
    const extensao = manifesto.arquivo.split('.').pop()?.toLowerCase() ?? 'mp3';
    return servirArquivo(c, join(analise.audio, manifesto.arquivo), TIPOS[extensao] ?? 'application/octet-stream', `"a-${manifesto.curta_sha256.slice(0, 24)}-${String(manifesto.duracao_s)}"`);
  });

  /** A capa de uma obra da pessoa que ainda não ficou pronta: a miniatura do `imagem.jpg` ou o próprio original. */
  async function miniaturaEmPreparo(c: Context, slug: string): Promise<Response> {
    if (!banco || !ehSlug(slug)) return naoHa(c);
    const linha = await comTransacao(banco, (cliente) => quadrosRepo.obterPorSlug(cliente, slug));
    if (!linha) return naoHa(c);
    const pasta = pastaDoQuadro(linha.slug);
    const imagem = join(pasta, 'imagem.jpg');
    try {
      if (existsSync(imagem)) return await servirArquivo(c, await miniaturaDe({ slug: linha.slug, pasta, imagem }), 'image/jpeg', `"p-${linha.sha256_original.slice(0, 32)}"`, 'private, no-cache');
    } catch { /* sem ferramenta de miniatura: o original serve */ }
    const original = join(pasta, `original.${EXTENSAO_DO_FORMATO[linha.formato]}`);
    if (!existsSync(original)) return naoHa(c);
    return servirArquivo(c, original, TIPO_DO_FORMATO[linha.formato], `"o-${linha.sha256_original.slice(0, 32)}"`, 'private, no-cache');
  }

  if (!banco) return;

  api.post('/api/arte', async (c) => {
    // O formulário inteiro tem um teto um pouco acima do da imagem (os campos de texto são pequenos).
    const formulario = await lerFormularioLimitado(c.req.raw, LIMITE_DA_IMAGEM_DO_QUADRO + 64 * 1024);
    const arquivo = formulario.get('arquivo');
    if (!(arquivo instanceof File) || arquivo.size === 0) throw new ErroDaApi(400, 'sem_imagem', 'Envie a imagem da obra no campo arquivo.');
    if (arquivo.size > LIMITE_DA_IMAGEM_DO_QUADRO) throw new ErroDaApi(413, 'imagem_grande_demais', `O limite é de ${String(LIMITE_DA_IMAGEM_DO_QUADRO / 1024 / 1024)} MB por imagem.`);
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    // O que vale é o conteúdo, não o nome nem o tipo que o navegador declarou.
    const formato = formatoPelaAssinatura(bytes);
    if (formato === 'heif') throw new ErroDaApi(415, 'heic_nao_suportado', 'Fotos HEIC/HEIF ainda não são aceitas. Exporte a foto como JPEG (no iPhone: Ajustes → Câmera → Formatos → Mais compatível) e envie de novo.');
    if (formato === null) throw new ErroDaApi(415, 'imagem_invalida', 'O arquivo não é uma imagem JPEG, PNG ou WebP.');
    const nome = arquivo.name.replace(/[\\/\r\n\u2028\u2029]+/gu, ' ').trim().slice(0, 255) || null;
    const informado = { titulo: campo(formulario, 'titulo', 300), artista: campo(formulario, 'artista', 300), ano: campo(formulario, 'ano', 40) };
    const registrado = await registrarEnvio(banco, { bytes, formato, nome, informado });
    if ('erro' in registrado) return c.json({ erro: registrado.erro, detalhe: 'Esta imagem já está nos seus quadros.', slug: registrado.slug }, 409);
    return c.json(registrado.quadro, 202);
  });

  api.put('/api/arte/:slug/identificacao', async (c) => {
    const corpo = await lerCorpoJson(c.req.raw);
    if (!validarIdentificacaoDaObra(corpo)) {
      const erros = (validarIdentificacaoDaObra.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message ?? 'inválido'}`).join('; ');
      throw new ErroDaApi(400, 'identificacao_invalida', `Informe título e artista (uma linha cada): ${erros}`);
    }
    return respostaDaAlteracao(c, await corrigirIdentificacao(banco, c.req.param('slug'), corpo));
  });

  api.post('/api/arte/:slug/tentar-de-novo', async (c) => respostaDaAlteracao(c, await tentarDeNovo(banco, c.req.param('slug'))));

  api.delete('/api/arte/:slug', async (c) => {
    const resultado = await removerQuadro(banco, c.req.param('slug'));
    if ('erro' in resultado) {
      return resultado.erro === 'obra_do_acervo'
        ? c.json({ erro: resultado.erro, detalhe: 'Só as obras que você adicionou podem ser removidas por aqui.' }, 409)
        : c.json({ erro: resultado.erro, detalhe: 'Esta obra não está entre as que você adicionou.' }, 404);
    }
    return c.body(null, 204);
  });
}
