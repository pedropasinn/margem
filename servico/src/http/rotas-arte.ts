/**
 * Quadros (somente leitura), servidos do acervo de arquivos (`../arte/acervo.ts`) e das fixtures do J94:
 *
 *   GET /api/arte                                       lista: título, artista, ano, miniatura, análises; e `acervo`:
 *                                                       se há acervo instalado e, se não, de onde baixar (J110)
 *   GET /api/arte/:slug                                 a análise publicada (modelo + curta) e a lista de análises
 *   GET /api/arte/:slug/analises/:rotulo                uma análise (`esperado` ou uma geração)
 *   GET /api/arte/:slug/imagem                          a reprodução (ETag = SHA-256, Range)
 *   GET /api/arte/:slug/miniatura                       a capa leve, gerada uma vez e guardada em cache
 *   GET /api/arte/:slug/audio/:rotulo/manifesto.json    tempos reais de batida e palavra
 *   GET /api/arte/:slug/audio/:rotulo/narracao.mp3      a narração (Range)
 *
 * Sem escrita: nenhum método além de GET é registrado.
 */
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Context, Hono } from 'hono';
import { ehRotulo, lerAcervo, lerManifesto, lerObra, type AnaliseNoAcervo, type ObraNoAcervo, type OpcoesDoAcervo } from '../arte/acervo.js';
import { miniaturaDe } from '../arte/miniaturas.js';
import { pacoteParaBaixar, type PacoteParaBaixar } from '../arte/pacote-publicado.js';
import { faixaDeBytes } from './documento-original.js';

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

/**
 * O estado do acervo para a web (J110): sem nenhuma obra do acervo (as fixtures do J94 não contam), a
 * área de Quadros explica o que é e oferece o pacote publicado e o comando que o instala.
 */
export interface EstadoDoAcervo {
  instalado: boolean;
  pacote: PacoteParaBaixar;
  /** O comando de terminal que baixa e instala o pacote nesta instalação. */
  comando: string;
}

export function estadoDoAcervo(obras: readonly ObraNoAcervo[], ambiente: NodeJS.ProcessEnv = process.env): EstadoDoAcervo {
  const docker = (ambiente.MARGEM_MODO ?? '').trim().toLowerCase() === 'instalado';
  // Na instalação Docker, o comando da instalação (J100/J111: `<projeto> arte instalar`, que copia um
  // arquivo local para dentro do container); o nome vem do compose (`MARGEM_COMANDO`).
  const projeto = (ambiente.MARGEM_COMANDO ?? '').trim();
  const comandoDocker = `${/^[a-z0-9][a-z0-9_-]{0,62}$/u.test(projeto) ? projeto : 'margem'} arte instalar`;
  return {
    instalado: obras.some((o) => o.origem === 'acervo'),
    pacote: pacoteParaBaixar(ambiente),
    comando: docker ? comandoDocker : 'npm run arte:instalar',
  };
}

export function registrarRotasDeArte(api: Hono, opcoes: OpcoesDoAcervo = {}): void {
  const obra = (slug: string) => lerObra(slug, opcoes);
  const naoHa = (c: Context, erro = 'obra_inexistente') => c.json({ erro }, 404);

  api.get('/api/arte', async (c) => {
    const obras = await lerAcervo(opcoes);
    return c.json({
      obras: obras.map((o) => {
        const publicada = o.analises.find((a) => a.rotulo === o.publicada) ?? o.analises[0]!;
        const { identidade, imagem } = publicada.modelo;
        return {
          slug: o.slug, titulo: identidade.titulo, titulo_original: identidade.titulo_original, artista: identidade.artista,
          data: identidade.data, ano: /\d{4}/.exec(identidade.data)?.[0] ?? null, tecnica: identidade.tecnica,
          largura: imagem.largura, altura: imagem.altura, imagem: caminhoDaImagem(o.slug), miniatura: caminhoDaMiniatura(o.slug),
          adicionado_em: o.adicionado_em, analises: resumirAnalises(o),
        };
      }),
      acervo: estadoDoAcervo(obras),
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
    const o = await obra(c.req.param('slug'));
    if (!o) return naoHa(c);
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
}
