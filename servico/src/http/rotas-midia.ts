/**
 * Rotas de mídia (J71): envio do arquivo por fluxo, publicação da transcrição alinhada a uma
 * versão, listagem para o leitor e o arquivo servido com Range (o `<video>` pede faixas).
 */
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Id, MidiaV1 } from '@margem/contratos';
import type { PalavraTranscrita } from '@margem/core';
import { ehUlid } from '../dados';
import { comTransacao } from '../db/transacao';
import { arquivoNosDados } from '../geometria/arquivos';
import { caminhoDaMidia, limiteDeMidia, MidiaGrandeDemais, receberMidia, sondarMidia } from '../midia/arquivos';
import { ErroDeMidia, publicarMidia, type PedidoDeMidia } from '../midia/publicacao';
import { estadoDosConceitos, midiaDeVideo, MidiaInexistente, pedirConceitos } from '../midia/conceitos';
import { videoDoDocumento } from '../midia/importacao-youtube';
import { ErroDeRevisao, registrarRevisao, type CodigoDaRevisao, type PedidoDeRevisao } from '../midia/revisao';
import { faixaDeBytes } from './documento-original';
import { lerCorpoJson } from './entrada-json';
import { detalheSeguro, ErroDaApi } from './erros';
import { conferirTamanho } from './seguranca';

const STATUS_DO_ERRO = {
  midia_ausente: 409, versao_de_outro_documento: 400, alinhamento_insuficiente: 422, midia_invalida: 422, outra_transcricao: 409,
} as const;

function objeto(valor: unknown, campo: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new ErroDaApi(400, 'pedido_invalido', `${campo} precisa ser um objeto.`);
  return valor as Record<string, unknown>;
}
function textoObrigatorio(valor: unknown, campo: string, maximo = 500): string {
  if (typeof valor !== 'string' || valor.trim() === '' || valor.length > maximo) throw new ErroDaApi(400, 'pedido_invalido', `${campo} precisa ser um texto de 1 a ${String(maximo)} caracteres.`);
  return valor.trim();
}
function segundos(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) throw new ErroDaApi(400, 'pedido_invalido', `${campo} precisa ser um número de segundos.`);
  return valor;
}

/** Lê e confere o pedido de publicação. Campos desconhecidos são recusados, como nos contratos. */
export function lerPedidoDeMidia(bruto: unknown, documentoId: Id, versaoPadrao: Id): PedidoDeMidia {
  const corpo = objeto(bruto, 'O corpo');
  const permitidos = new Set(['versao_id', 'sha256', 'titulo', 'fonte', 'capitulos', 'transcricao']);
  const desconhecido = Object.keys(corpo).find((chave) => !permitidos.has(chave));
  if (desconhecido !== undefined) throw new ErroDaApi(400, 'campo_desconhecido', `Campo não aceito: ${desconhecido}.`);
  const versaoId = corpo.versao_id === undefined ? versaoPadrao : corpo.versao_id;
  if (typeof versaoId !== 'string' || !ehUlid(versaoId)) throw new ErroDaApi(400, 'pedido_invalido', 'versao_id inválido.');
  if (typeof corpo.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(corpo.sha256)) throw new ErroDaApi(400, 'pedido_invalido', 'sha256 inválido.');
  let fonte: MidiaV1['fonte'] = null;
  if (corpo.fonte !== undefined && corpo.fonte !== null) {
    const f = objeto(corpo.fonte, 'fonte');
    const url = textoObrigatorio(f.url, 'fonte.url', 2000);
    if (!/^https:\/\//.test(url)) throw new ErroDaApi(400, 'pedido_invalido', 'fonte.url precisa ser https.');
    fonte = { url,
      ...(f.canal === undefined ? {} : { canal: textoObrigatorio(f.canal, 'fonte.canal', 300) }),
      ...(f.publicado_em === undefined ? {} : { publicado_em: textoObrigatorio(f.publicado_em, 'fonte.publicado_em', 10) }) };
  }
  const capitulos = (corpo.capitulos === undefined ? [] : corpo.capitulos);
  if (!Array.isArray(capitulos)) throw new ErroDaApi(400, 'pedido_invalido', 'capitulos precisa ser uma lista.');
  const transcricao = objeto(corpo.transcricao, 'transcricao');
  if (!Array.isArray(transcricao.palavras) || transcricao.palavras.length === 0) throw new ErroDaApi(400, 'pedido_invalido', 'transcricao.palavras precisa ser uma lista não vazia.');
  const palavras: PalavraTranscrita[] = transcricao.palavras.map((bruta, indice) => {
    const p = objeto(bruta, `transcricao.palavras[${String(indice)}]`);
    return { texto: textoObrigatorio(p.texto, 'palavra.texto', 200), inicio_s: segundos(p.inicio_s, 'palavra.inicio_s'), fim_s: segundos(p.fim_s, 'palavra.fim_s') };
  });
  return {
    documento_id: documentoId, versao_id: versaoId, sha256: corpo.sha256,
    titulo: textoObrigatorio(corpo.titulo, 'titulo'), fonte,
    capitulos: capitulos.map((bruto, indice) => {
      const c = objeto(bruto, `capitulos[${String(indice)}]`);
      return { inicio_s: segundos(c.inicio_s, 'capitulo.inicio_s'), titulo: textoObrigatorio(c.titulo, 'capitulo.titulo', 300) };
    }),
    transcricao: { motor: textoObrigatorio(transcricao.motor, 'transcricao.motor', 300), idioma: textoObrigatorio(transcricao.idioma, 'transcricao.idioma', 35), palavras },
  };
}

const STATUS_DA_REVISAO: Record<CodigoDaRevisao, 404 | 409 | 422 | 400> = {
  documento_inexistente: 404, nao_e_transcricao: 422, versao_base_desatualizada: 409, sem_mudanca: 409,
  versao_com_anotacoes: 409, palavras_fora_do_texto: 400,
};

/** Pedido de revisão da transcrição (J90): parágrafos revisados + palavras com tempo + resumo da ferramenta. */
export function lerPedidoDeRevisao(bruto: unknown, documentoId: Id): PedidoDeRevisao {
  const corpo = objeto(bruto, 'O corpo');
  const permitidos = new Set(['versao_base_id', 'paragrafos', 'transcricao', 'resumo', 'aceitar_anotacoes_na_versao_anterior']);
  const desconhecido = Object.keys(corpo).find((chave) => !permitidos.has(chave));
  if (desconhecido !== undefined) throw new ErroDaApi(400, 'campo_desconhecido', `Campo não aceito: ${desconhecido}.`);
  if (typeof corpo.versao_base_id !== 'string' || !ehUlid(corpo.versao_base_id)) throw new ErroDaApi(400, 'pedido_invalido', 'versao_base_id inválido.');
  if (!Array.isArray(corpo.paragrafos) || corpo.paragrafos.length === 0 || corpo.paragrafos.some((p) => typeof p !== 'string' || p.trim() === '' || p.length > 50_000)) {
    throw new ErroDaApi(400, 'pedido_invalido', 'paragrafos precisa ser uma lista de textos não vazios.');
  }
  const transcricao = objeto(corpo.transcricao, 'transcricao');
  const extra = Object.keys(transcricao).find((chave) => !['motor', 'idioma', 'palavras'].includes(chave));
  if (extra !== undefined) throw new ErroDaApi(400, 'campo_desconhecido', `Campo não aceito: transcricao.${extra}.`);
  if (!Array.isArray(transcricao.palavras) || transcricao.palavras.length === 0) throw new ErroDaApi(400, 'pedido_invalido', 'transcricao.palavras precisa ser uma lista não vazia.');
  const palavras: PalavraTranscrita[] = transcricao.palavras.map((bruta, indice) => {
    const p = objeto(bruta, `transcricao.palavras[${String(indice)}]`);
    return { texto: textoObrigatorio(p.texto, 'palavra.texto', 200), inicio_s: segundos(p.inicio_s, 'palavra.inicio_s'), fim_s: segundos(p.fim_s, 'palavra.fim_s') };
  });
  const resumo = corpo.resumo === undefined ? {} : objeto(corpo.resumo, 'resumo');
  if (JSON.stringify(resumo).length > 20_000) throw new ErroDaApi(400, 'pedido_invalido', 'resumo grande demais.');
  const aceitar = corpo.aceitar_anotacoes_na_versao_anterior ?? false;
  if (typeof aceitar !== 'boolean') throw new ErroDaApi(400, 'pedido_invalido', 'aceitar_anotacoes_na_versao_anterior precisa ser booleano.');
  return {
    documento_id: documentoId, versao_base_id: corpo.versao_base_id, paragrafos: corpo.paragrafos as string[],
    transcricao: { motor: textoObrigatorio(transcricao.motor, 'transcricao.motor', 300), idioma: textoObrigatorio(transcricao.idioma, 'transcricao.idioma', 35), palavras },
    resumo, aceitar_anotacoes_na_versao_anterior: aceitar,
  };
}

export function registrarMidia(api: Hono, banco: pg.Pool): void {
  // J90: transcrição revisada vira versão nova (job `canonizar_revisao`), com a mídia realinhada.
  api.post('/api/documentos/:id/transcricoes-revisadas', async (c) => {
    const documentoId = c.req.param('id');
    if (!ehUlid(documentoId)) throw new ErroDaApi(400, 'id_invalido');
    const pedido = lerPedidoDeRevisao(await lerCorpoJson(c.req.raw), documentoId);
    try {
      const registrada = await comTransacao(banco, (cliente) => registrarRevisao(cliente, pedido));
      return c.json(registrada, registrada.criada ? 202 : 200);
    } catch (erro) {
      if (erro instanceof ErroDeRevisao) {
        const itens = erro.detalhe === undefined ? '' : ` (${Object.entries(erro.detalhe).map(([k, v]) => `${k}: ${String(v)}`).join(', ')})`;
        throw new ErroDaApi(STATUS_DA_REVISAO[erro.codigo], erro.codigo, `${erro.message}${itens}`);
      }
      throw erro;
    }
  });

  // O corpo é o próprio arquivo, sem multipart: vídeos de centenas de MB não passam pela memória.
  api.put('/api/midia/arquivos', async (c) => {
    conferirTamanho(c.req.header('content-length'), limiteDeMidia());
    const corpo = c.req.raw.body;
    if (corpo === null) throw new ErroDaApi(400, 'sem_conteudo', 'Envie o arquivo no corpo.');
    let recebido: { sha256: string; bytes: number };
    try { recebido = await receberMidia(corpo); }
    catch (erro) {
      if (erro instanceof MidiaGrandeDemais) throw new ErroDaApi(413, 'corpo_grande_demais', `O limite é de ${String(limiteDeMidia())} bytes.`);
      throw erro;
    }
    try {
      const sonda = await sondarMidia(caminhoDaMidia(recebido.sha256));
      return c.json({ sha256: recebido.sha256, ...sonda }, 201);
    } catch (erro) {
      throw new ErroDaApi(415, 'midia_nao_reconhecida', detalheSeguro(erro instanceof Error ? erro.message : 'Mídia não reconhecida.'));
    }
  });

  api.post('/api/documentos/:id/midias', async (c) => {
    const documentoId = c.req.param('id');
    if (!ehUlid(documentoId)) throw new ErroDaApi(400, 'id_invalido');
    const ultima = (await banco.query<{ id: Id }>('SELECT id FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1', [documentoId])).rows[0];
    if (!ultima) throw new ErroDaApi(409, 'sem_texto', 'O documento ainda não tem texto canonizado.');
    const pedido = lerPedidoDeMidia(await lerCorpoJson(c.req.raw), documentoId, ultima.id);
    try {
      const resultado = await comTransacao(banco, (cliente) => publicarMidia(cliente, pedido));
      const { palavras, frases, ...resumo } = resultado.midia;
      return c.json({ midia: { ...resumo, palavras: palavras.length, frases: frases.length }, diagnostico: resultado.diagnostico }, resultado.criada ? 201 : 200);
    } catch (erro) {
      if (erro instanceof ErroDeMidia) throw new ErroDaApi(STATUS_DO_ERRO[erro.codigo], erro.codigo, erro.message);
      if (erro instanceof Error && erro.message === 'Versão inexistente.') throw new ErroDaApi(404, 'versao_inexistente');
      throw erro;
    }
  });

  api.get('/api/versoes/:versao/midias', async (c) => {
    const versao = c.req.param('versao');
    if (!ehUlid(versao)) throw new ErroDaApi(400, 'id_invalido');
    const { rows } = await banco.query<{ conteudo: MidiaV1 }>('SELECT conteudo FROM midia WHERE versao_id=$1 ORDER BY criado_em DESC, id DESC', [versao]);
    // J109: o vídeo do YouTube do documento (player embutido), com ou sem transcrição sincronizada.
    const documento = (await banco.query<{ documento_id: Id }>('SELECT documento_id FROM versao_texto WHERE id=$1', [versao])).rows[0];
    const youtube = documento ? await videoDoDocumento(banco, documento.documento_id) : null;
    return c.json({ midias: rows.map((r) => r.conteudo), youtube });
  });

  // Conceitos programados do vídeo (noite2/video-popups): estado + cartões; o POST enfileira (idempotente).
  const conceitos = async (id: Id) => comTransacao(banco, (cliente) => estadoDosConceitos(cliente, id));
  const exigirMidia = async (id: string): Promise<Id> => {
    if (!ehUlid(id)) throw new ErroDaApi(400, 'id_invalido');
    const { rows: [midia] } = await banco.query<{ tipo: string; url: string | null }>("SELECT tipo, conteudo->'fonte'->>'url' AS url FROM midia WHERE id=$1", [id]);
    if (!midia) throw new ErroDaApi(404, 'midia_inexistente');
    // J142: o vídeo do YouTube guarda só o áudio, mas é vídeo (toca pelo player embutido); os popups valem para ele.
    if (!midiaDeVideo(midia)) throw new ErroDaApi(422, 'nao_e_video', 'Momentos sobre a tela só existem para vídeo.');
    return id;
  };
  api.get('/api/midias/:id/conceitos', async (c) => c.json(await conceitos(await exigirMidia(c.req.param('id')))));
  api.post('/api/midias/:id/conceitos', async (c) => {
    const id = await exigirMidia(c.req.param('id'));
    try { await comTransacao(banco, (cliente) => pedirConceitos(cliente, id)); }
    catch (erro) { if (erro instanceof MidiaInexistente) throw new ErroDaApi(404, 'midia_inexistente'); throw erro; }
    return c.json(await conceitos(id), 202);
  });

  api.get('/api/midias/:id/arquivo', async (c) => {
    const id = c.req.param('id');
    if (!ehUlid(id)) throw new ErroDaApi(400, 'id_invalido');
    const { rows: [midia] } = await banco.query<{ sha256: string; mime: string }>("SELECT sha256, conteudo->>'mime' AS mime FROM midia WHERE id=$1", [id]);
    const caminho = midia ? await arquivoNosDados(caminhoDaMidia(midia.sha256)) : null;
    if (!midia || !caminho) throw new ErroDaApi(404, 'midia_indisponivel');
    const arquivo = await open(caminho, 'r');
    try {
      const tamanho = (await arquivo.stat()).size;
      const etag = `"${midia.sha256}"`;
      c.header('Content-Type', midia.mime); c.header('Accept-Ranges', 'bytes'); c.header('ETag', etag);
      c.header('Cache-Control', 'private, max-age=31536000, immutable');
      if (c.req.header('if-none-match') === etag) { await arquivo.close(); return c.body(null, 304); }
      const range = c.req.header('range');
      const condicao = c.req.header('if-range');
      const parcial = range !== undefined && (condicao === undefined || condicao === etag);
      const faixa = parcial ? faixaDeBytes(range, tamanho) : { inicio: 0, fim: tamanho - 1 };
      if (faixa === null || tamanho === 0) { await arquivo.close(); c.header('Content-Range', `bytes */${String(tamanho)}`); return c.body(null, 416); }
      if (parcial) c.header('Content-Range', `bytes ${String(faixa.inicio)}-${String(faixa.fim)}/${String(tamanho)}`);
      c.header('Content-Length', String(faixa.fim - faixa.inicio + 1));
      return c.body(Readable.toWeb(arquivo.createReadStream({ start: faixa.inicio, end: faixa.fim, autoClose: true })) as ReadableStream<Uint8Array>, parcial ? 206 : 200);
    } catch (erro) { await arquivo.close(); throw erro; }
  });
}
