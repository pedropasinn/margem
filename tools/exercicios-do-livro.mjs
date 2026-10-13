#!/usr/bin/env node
/**
 * Exercícios de um livro, pelo operador: acha as seções de exercícios, cria os pedidos de resolução
 * (sem disparar) e, quando pedido, dispara um lote pequeno. Tudo pela API (`X-Margem: 1`), como o app.
 *
 *   node tools/exercicios-do-livro.mjs <documento>               só mostra o que achou, por capítulo e seção
 *   node tools/exercicios-do-livro.mjs <documento> --criar       cria um pedido por exercício (estado `pendente`)
 *   node tools/exercicios-do-livro.mjs <documento> --disparar 5  manda os próximos 5 pendentes ao Codex
 *
 * Num PDF escaneado o primeiro passo é o OCR de todas as páginas (minutos): ele roda aqui, antes da
 * chamada à API, e fica guardado em `<dados>/<documento>/exercicios-ocr/`, de onde a API o relê.
 * `MARGEM_API` (padrão http://127.0.0.1:8730) e `MARGEM_DADOS` (padrão ~/dados/margem) mudam os lugares.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [documento, ...resto] = process.argv.slice(2);
if (!documento || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(documento)) {
  console.error('Uso: node tools/exercicios-do-livro.mjs <documento> [--criar] [--disparar N]');
  process.exit(2);
}
const api = process.env.MARGEM_API ?? 'http://127.0.0.1:8730';
const dados = process.env.MARGEM_DADOS ?? join(homedir(), 'dados/margem');
const criar = resto.includes('--criar');
const indice = resto.indexOf('--disparar');
const disparar = indice === -1 ? null : Number(resto[indice + 1]);
if (disparar !== null && (!Number.isInteger(disparar) || disparar < 1 || disparar > 50)) {
  console.error('--disparar recebe um número de 1 a 50.');
  process.exit(2);
}

async function chamar(caminho, corpo) {
  const resposta = await fetch(api + caminho, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: corpo === undefined ? {} : { 'X-Margem': '1', 'Content-Type': 'application/json' },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(`${caminho}: ${String(resposta.status)} ${json.erro ?? ''} ${json.detalhe ?? ''}`);
  return json;
}

// O OCR primeiro, fora da API: a primeira vez demora mais que uma requisição deve esperar. (E antes de
// qualquer chamada: uma conexão parada enquanto o script roda seria fechada pela API.)
const original = join(dados, documento, 'original.pdf');
if (existsSync(original) && disparar === null) {
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const python = process.env.MARGEM_PYTHON_EXERCICIOS ?? join(raiz, 'motor/.venv/bin/python');
  const saida = spawnSync(python, [join(raiz, 'tools/exercicios-do-pdf.py'), 'descobrir', original, join(dados, documento, 'exercicios-ocr')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  if (saida.status !== 0) process.exit(saida.status ?? 1);
}

const detalhe = await chamar(`/api/documentos/${documento}`);
console.log(`${detalhe.titulo}${detalhe.autor ? ` — ${detalhe.autor}` : ''} (${detalhe.formato})`);
if (disparar === null) {
  const resultado = await chamar(`/api/documentos/${documento}/exercicios/descobrir`, criar ? { criar: true } : {});
  console.log(`${String(resultado.total)} exercícios (fonte: ${resultado.fonte})`);
  for (const capitulo of resultado.capitulos) {
    console.log(`  ${String(capitulo.exercicios).padStart(3)}  ${capitulo.capitulo ?? '(sem capítulo)'}`);
    for (const secao of capitulo.secoes) console.log(`         ${String(secao.exercicios).padStart(3)}  ${secao.secao ?? '(sem seção)'}`);
  }
  if (resultado.lote) console.log(`Pedidos: ${String(resultado.lote.criados)} criados, ${String(resultado.lote.reconhecidos)} recortes antigos reconhecidos, ${String(resultado.lote.ja_existiam)} já existiam.`);
} else {
  const resultado = await chamar(`/api/documentos/${documento}/exercicios/disparar`, { limite: disparar });
  console.log(`${String(resultado.disparados.length)} enviados ao Codex; ${String(resultado.restantes)} pendentes.`);
}
