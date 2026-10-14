#!/usr/bin/env node
/**
 * Feed de atualização local, para testar o electron-updater de verdade (J146) sem publicar nada.
 * Imita o caminho de produção, com os mesmos dois redirects:
 *
 *   /atualizacoes/<arquivo>                  302 → /releases/latest/download/<arquivo>   (site/vercel.json)
 *   /releases/latest/download/<arquivo>      302 → /objetos/<arquivo>                    (o GitHub manda ao CDN)
 *   /objetos/<arquivo>                       o arquivo de --pasta, com Range de um intervalo (diferencial)
 *
 *   node scripts/feed-local.mjs --pasta <saída do electron-builder> [--porta 18470] [--cert c.pem --chave k.pem]
 *
 * Com --cert/--chave serve HTTPS (o app só aceita feed https://; rode o app com --ignore-certificate-errors
 * para o certificado autoassinado). Cada pedido sai numa linha JSON na saída padrão (caminho, status,
 * intervalo, bytes): é por ela que se confere o download diferencial.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as criarHttp } from 'node:http';
import { createServer as criarHttps } from 'node:https';
import { basename, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opcao = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined; };
const pasta = resolve(opcao('--pasta') ?? '.');
const porta = Number(opcao('--porta') ?? 18470);
const cert = opcao('--cert');
const chave = opcao('--chave');

function registrar(dados) { process.stdout.write(`${JSON.stringify({ quando: new Date().toISOString(), ...dados })}\n`); }

function tratar(pedido, resposta) {
  const url = new URL(pedido.url ?? '/', 'http://local');
  const caminho = decodeURIComponent(url.pathname);
  const redirecionar = (destino) => {
    resposta.writeHead(302, { location: destino, 'cache-control': 'no-store' }).end();
    registrar({ caminho, status: 302, para: destino });
  };
  if (caminho.startsWith('/atualizacoes/')) return redirecionar(`/releases/latest/download/${caminho.slice('/atualizacoes/'.length)}`);
  if (caminho.startsWith('/releases/latest/download/')) return redirecionar(`/objetos/${caminho.slice('/releases/latest/download/'.length)}`);
  const nome = caminho.startsWith('/objetos/') ? basename(caminho) : null;
  const arquivo = nome === null ? null : join(pasta, nome);
  if (arquivo === null || !existsSync(arquivo) || !statSync(arquivo).isFile()) {
    resposta.writeHead(404).end('não encontrado');
    registrar({ caminho, status: 404 });
    return;
  }
  const tamanho = statSync(arquivo).size;
  const tipo = nome.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream';
  const intervalo = /^bytes=(\d+)-(\d*)$/u.exec(pedido.headers.range ?? '');
  if (pedido.headers.range !== undefined && intervalo === null) {
    // Vários intervalos num pedido (multipart/byteranges): o CDN do GitHub também não atende.
    resposta.writeHead(416, { 'content-range': `bytes */${tamanho}` }).end();
    registrar({ caminho, status: 416, range: pedido.headers.range });
    return;
  }
  if (intervalo !== null) {
    const inicio = Number(intervalo[1]);
    const fim = intervalo[2] === '' ? tamanho - 1 : Math.min(Number(intervalo[2]), tamanho - 1);
    resposta.writeHead(206, { 'content-type': tipo, 'content-length': fim - inicio + 1, 'content-range': `bytes ${inicio}-${fim}/${tamanho}`, 'accept-ranges': 'bytes' });
    createReadStream(arquivo, { start: inicio, end: fim }).pipe(resposta);
    registrar({ caminho, status: 206, range: `${inicio}-${fim}`, bytes: fim - inicio + 1 });
    return;
  }
  resposta.writeHead(200, { 'content-type': tipo, 'content-length': tamanho, 'accept-ranges': 'bytes' });
  if (pedido.method === 'HEAD') { resposta.end(); return; }
  createReadStream(arquivo).pipe(resposta);
  registrar({ caminho, status: 200, bytes: tamanho });
}

const servidor = cert && chave ? criarHttps({ cert: readFileSync(cert), key: readFileSync(chave) }, tratar) : criarHttp(tratar);
servidor.listen(porta, '127.0.0.1', () => { registrar({ evento: 'no_ar', porta, pasta, https: Boolean(cert && chave) }); });
for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => { servidor.close(); process.exit(0); });
