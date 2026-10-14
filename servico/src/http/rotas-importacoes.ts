/**
 * Importação de páginas web (extensão do navegador).
 *
 * `POST /api/importacoes/web` recebe um `ImportacaoWebV1` — Markdown sem frontmatter e os
 * metadados de origem — e entra pelo mesmo fluxo do upload de Markdown: o serviço escreve o
 * original (`original.md`, com o frontmatter montado aqui a partir dos campos validados), cria o
 * documento e enfileira a canonização. O motor já sabe que frontmatter não vira bloco.
 *
 * `GET /api/importacoes/web` é o teste de conexão da página de opções da extensão.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import { validarImportacaoWeb, validarImportacaoYoutube, type ImportacaoWebV1 } from '@margem/contratos';
import { idDoVideoDoYoutube } from '@margem/core/youtube';
import { registrarImportacaoYoutube } from '../midia/importacao-youtube.js';
import { lerCorpoJson } from './entrada-json.js';
import { ErroDaApi } from './erros.js';
import { registrarOriginal } from './ingestao.js';
import { lerFormularioLimitado } from './seguranca.js';
import { caminhoDaImagem } from '../resolucao/pipeline.js';
import {
  ImagemRecusadaPeloMotor, LIMITE_DA_QUESTAO_BYTES, PIXELS_MAXIMOS, converterImagemEmPdf, lerCabecalhoDaImagem, tituloDaQuestao,
} from '../questao/imagem.js';
import { gravarMarcaDaQuestao } from '../questao/questao.js';

/** Versão do protocolo entre a extensão e a API; sobe só quando o pedido mudar de forma. */
export const VERSAO_DA_IMPORTACAO_WEB = 1;
/** Versão do pedido `ImportacaoYoutubeV1` (J109); a página de importação (J108) confere por aqui. */
export const VERSAO_DA_IMPORTACAO_YOUTUBE = 1;

/**
 * O original que o motor lê: frontmatter `chave: valor` (uma linha cada, como o motor espera)
 * seguido do corpo. Os campos já passaram pelo contrato: nenhum tem quebra de linha.
 */
export function originalDaPaginaWeb(importacao: ImportacaoWebV1, agora: Date): string {
  const campos: [string, string | undefined][] = [
    ['titulo', importacao.titulo.trim()],
    ['autor', importacao.autor?.trim()],
    ['site', importacao.site?.trim()],
    ['url_origem', importacao.url_origem],
    ['publicado_em', importacao.publicado_em],
    ['capturado_em', importacao.capturado_em ?? agora.toISOString()],
    ['trecho', importacao.trecho === true ? 'sim' : undefined],
    ['importado_por', 'extensao'],
  ];
  const linhas = campos.filter((campo): campo is [string, string] => campo[1] !== undefined && campo[1] !== '')
    .map(([chave, valor]) => `${chave}: ${valor}`);
  const corpo = importacao.markdown.replace(/^\s*\n/, '');
  return `---\n${linhas.join('\n')}\n---\n\n${corpo.endsWith('\n') ? corpo : `${corpo}\n`}`;
}

function resumoDosErros(): string {
  const erros = validarImportacaoWeb.errors ?? [];
  return erros.slice(0, 3).map((erro) => `${erro.instancePath || '/'} ${erro.message ?? 'inválido'}`).join('; ');
}

/** Título da questão: o que a pessoa digitou (até 300 caracteres, uma linha) ou "Questão de <data>". */
const TITULO_MAXIMO = 300;

export function registrarImportacoes(api: Hono, banco: pg.Pool, relogio: () => Date = () => new Date()): void {
  /**
   * J119 · Questão por imagem: `POST /api/importacoes/questao` (multipart: `arquivo` PNG ou JPEG e
   * `titulo` opcional). A imagem vira um PDF de uma página (motor), entra na biblioteca e, quando a
   * versão é publicada, a resolução da página inteira entra na fila (`questao/questao.ts`).
   */
  api.post('/api/importacoes/questao', async (c) => {
    const formulario = await lerFormularioLimitado(c.req.raw, LIMITE_DA_QUESTAO_BYTES + 64 * 1024);
    const desconhecidos = [...new Set(formulario.keys())].filter((chave) => chave !== 'arquivo' && chave !== 'titulo');
    if (desconhecidos.length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${desconhecidos.join(', ')}.`);
    const arquivo = formulario.get('arquivo');
    if (!(arquivo instanceof File)) throw new ErroDaApi(400, 'sem_imagem', 'Envie a imagem da questão no campo arquivo.');
    if (arquivo.size > LIMITE_DA_QUESTAO_BYTES) throw new ErroDaApi(413, 'imagem_grande_demais', `O limite é de ${String(LIMITE_DA_QUESTAO_BYTES)} bytes.`);
    if (arquivo.size === 0) throw new ErroDaApi(400, 'sem_imagem', 'A imagem está vazia.');
    const tituloBruto = formulario.get('titulo');
    const titulo = typeof tituloBruto === 'string' && tituloBruto.trim() !== '' ? tituloBruto.trim() : tituloDaQuestao(relogio());
    if (titulo.length > TITULO_MAXIMO || /[\r\n]/.test(titulo)) throw new ErroDaApi(400, 'titulo_invalido', `O título é uma linha de até ${String(TITULO_MAXIMO)} caracteres.`);
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const cabecalho = lerCabecalhoDaImagem(bytes);
    if ('recusa' in cabecalho) {
      if (cabecalho.recusa === 'outro_formato') {
        throw new ErroDaApi(415, 'formato_de_imagem', `${cabecalho.nome} não entra direto: o Margem lê PNG e JPEG. Cole ou solte a imagem pela biblioteca (o navegador a converte) ou salve-a como PNG.`);
      }
      if (cabecalho.recusa === 'ilegivel') throw new ErroDaApi(422, 'imagem_ilegivel', 'A imagem está corrompida ou incompleta.');
      throw new ErroDaApi(415, 'imagem_invalida', 'A imagem precisa ser PNG ou JPEG.');
    }
    if (cabecalho.largura === 0 || cabecalho.altura === 0) throw new ErroDaApi(422, 'imagem_ilegivel', 'A imagem não tem tamanho.');
    if (cabecalho.largura * cabecalho.altura > PIXELS_MAXIMOS) {
      throw new ErroDaApi(413, 'imagem_grande_demais', `A imagem tem ${String(cabecalho.largura)} × ${String(cabecalho.altura)} pixels; o limite é de ${String(PIXELS_MAXIMOS / 1_000_000)} megapixels.`);
    }
    let convertida;
    try { convertida = await converterImagemEmPdf(bytes); } catch (erro) {
      if (erro instanceof ImagemRecusadaPeloMotor) throw new ErroDaApi(422, 'imagem_ilegivel', erro.message);
      throw erro;
    }
    const png = Buffer.from(convertida.png);
    const sha = createHash('sha256').update(png).digest('hex');
    const registrado = await registrarOriginal(banco, {
      titulo, formato: 'pdf', bytes: convertida.pdf, paginas: null, poesia: false,
      antesDeConfirmar: async (documentoId) => {
        const caminho = caminhoDaImagem(documentoId, sha);
        await mkdir(dirname(caminho), { recursive: true, mode: 0o700 });
        await writeFile(caminho, png, { mode: 0o600 });
        await gravarMarcaDaQuestao(documentoId, { versao: 1, imagem_sha256: sha, largura: convertida.largura, altura: convertida.altura });
      },
    });
    if ('erro' in registrado) {
      return c.json({ ...registrado, detalhe: 'Esta questão já está na biblioteca.', caminho: `/documentos/${registrado.documento_id}` }, 409);
    }
    return c.json({ documento_id: registrado.documento_id, job_id: registrado.job_id, caminho: `/documentos/${registrado.documento_id}` }, 202);
  });

  api.get('/api/importacoes/web', (c) => c.json({
    servico: 'margem', importacao_web: VERSAO_DA_IMPORTACAO_WEB, formatos: ['md', 'pdf'],
  }));

  api.post('/api/importacoes/web', async (c) => {
    const bruto = await lerCorpoJson(c.req.raw);
    if (!validarImportacaoWeb(bruto)) {
      throw new ErroDaApi(422, 'importacao_invalida', `O pedido não segue o contrato ImportacaoWebV1: ${resumoDosErros()}`);
    }
    const bytes = new TextEncoder().encode(originalDaPaginaWeb(bruto, relogio()));
    const registrado = await registrarOriginal(banco, {
      titulo: bruto.titulo.trim(), formato: 'md', bytes, paginas: null, poesia: false,
      ...(bruto.autor === undefined ? {} : { autor: bruto.autor.trim() }),
    });
    if ('erro' in registrado) return c.json({ ...registrado, detalhe: 'Este texto já está na biblioteca.' }, 409);
    return c.json({
      documento_id: registrado.documento_id, job_id: registrado.job_id,
      caminho: `/documentos/${registrado.documento_id}`,
    }, 202);
  });

  // J109 · Vídeo do YouTube por link: o vídeo toca pelo player oficial embutido; só legendas/áudio são buscados.
  api.get('/api/importacoes/youtube', (c) => c.json({ servico: 'margem', importacao_youtube: VERSAO_DA_IMPORTACAO_YOUTUBE }));

  api.post('/api/importacoes/youtube', async (c) => {
    const bruto = await lerCorpoJson(c.req.raw);
    if (!validarImportacaoYoutube(bruto)) {
      const erros = (validarImportacaoYoutube.errors ?? []).slice(0, 3).map((erro) => `${erro.instancePath || '/'} ${erro.message ?? 'inválido'}`).join('; ');
      throw new ErroDaApi(400, 'importacao_invalida', `O pedido não segue o contrato ImportacaoYoutubeV1: ${erros}`);
    }
    const videoId = idDoVideoDoYoutube(bruto.url);
    if (videoId === null) throw new ErroDaApi(400, 'url_nao_e_do_youtube', 'O endereço não é de um vídeo do YouTube.');
    const registrado = await registrarImportacaoYoutube(banco, {
      video_id: videoId, ...(bruto.titulo === undefined ? {} : { titulo: bruto.titulo }), ...(bruto.autor === undefined ? {} : { autor: bruto.autor }),
    });
    if ('erro' in registrado) {
      return c.json({
        erro: registrado.erro, detalhe: 'Este vídeo já está na biblioteca.', documento_id: registrado.documento_id,
        existente: { documento_id: registrado.documento_id, caminho: `/documentos/${registrado.documento_id}` },
      }, 409);
    }
    return c.json({ documento_id: registrado.documento_id, job_id: registrado.job_id, caminho: `/documentos/${registrado.documento_id}` }, 202);
  });
}
