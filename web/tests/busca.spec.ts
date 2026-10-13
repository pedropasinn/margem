/**
 * Busca no texto: o painel do Ctrl F no leitor (com a caixa no trecho achado) e os trechos na
 * biblioteca. APIs simuladas, sem produção nem rede externa. Capturas em docs/ui-revisao/busca.
 * Uso (depois de `npm run build -w web`): node tests/busca.spec.ts
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const documentoId = '00000000000000000000000DB1';
const versaoId = '00000000000000000000000VB1';
const id = (prefixo: string, n: number) => `${'0'.repeat(26 - prefixo.length - String(n).length)}${prefixo}${String(n)}`;
const textos = [
  'O homem é apenas um caniço, o mais fraco da natureza; mas é um caniço pensante. Não é preciso que o universo inteiro se arme para esmagá-lo.',
  'Toda a nossa dignidade consiste, pois, no pensamento. É daí que nos devemos elevar, e não do espaço e da duração, que não saberíamos preencher. Trabalhemos, pois, em bem pensar: eis o princípio da moral.',
  'O coração tem suas razões, que a razão desconhece; sabe-se disso em mil coisas. Digo que o coração ama naturalmente o ser universal, e naturalmente a si mesmo.',
  'A última démarche da razão é reconhecer que há uma infinidade de coisas que a ultrapassam; ela é fraca, se não chega até aí.',
];
const blocos = [
  { id: id('B', 0), ordem: 0, tipo: 'capitulo', texto: 'Miséria e grandeza', inline: [], origens: [] },
  ...textos.map((texto, i) => ({ id: id('B', i + 1), ordem: i + 1, tipo: 'paragrafo', texto, inline: [], origens: [] })),
];
const capitulos = [{ id: id('S', 1), titulo: 'Miséria e grandeza' }, { id: id('S', 2), titulo: 'Razão e coração' }, { id: id('S', 3), titulo: 'Submissão e uso da razão' }];
const snapshot = {
  documento_id: documentoId, versao_id: versaoId, formato: 'md',
  secao: { id: capitulos[0]!.id, nivel: 1, titulo: capitulos[0]!.titulo, ordem: 0, bloco_inicio: blocos[0]!.id, bloco_fim: blocos.at(-1)!.id },
  blocos, assets: {}, marcas: [], revisao_marcas: 'a'.repeat(64), recuperacao: [], anterior: null, proxima: capitulos[1]!.id,
};
const achar = (texto: string, termo: RegExp) => [...texto.matchAll(termo)].map((m) => ({ inicio_utf16: m.index, fim_utf16: m.index + m[0].length }));
const trecho = (texto: string, faixas: { inicio_utf16: number; fim_utf16: number }[]) => {
  const partes: { texto: string; marcado: boolean }[] = []; let cursor = 0;
  for (const f of faixas) { partes.push({ texto: texto.slice(cursor, f.inicio_utf16), marcado: false }, { texto: texto.slice(f.inicio_utf16, f.fim_utf16), marcado: true }); cursor = f.fim_utf16; }
  partes.push({ texto: texto.slice(cursor), marcado: false });
  return partes.filter((p) => p.texto !== '');
};
const resultado = (bloco: { id: string; texto: string }, capitulo: { id: string; titulo: string }, extra: Record<string, unknown> = {}) => {
  const ocorrencias = achar(bloco.texto, /razão/g);
  return { documento_id: documentoId, titulo: 'Pensamentos', autor: 'Blaise Pascal', formato: 'md', versao_id: versaoId, capitulo, bloco_id: bloco.id, pagina: null, ocorrencias, trecho: trecho(bloco.texto, ocorrencias), ...extra };
};
const outros = [
  { id: id('B', 30), texto: 'Dois excessos: excluir a razão, só admitir a razão.' },
  { id: id('B', 31), texto: 'A fé diz bem o que os sentidos não dizem, mas não o contrário do que veem; ela está acima, e não contra a razão.' },
];
const respostaDoDocumento = { consulta: 'razão', total: 4, proximo: null, resultados: [
  resultado(blocos[3]!, capitulos[0]!), resultado(blocos[4]!, capitulos[0]!),
  resultado(outros[0]!, capitulos[2]!), resultado(outros[1]!, capitulos[2]!),
] };
const respostaDaBiblioteca = { consulta: 'razão', total: 5, proximo: null, resultados: [
  ...respostaDoDocumento.resultados.slice(0, 3),
  { documento_id: '00000000000000000000000DB2', titulo: 'Discurso do método', autor: 'René Descartes', formato: 'pdf', versao_id: id('V', 2), capitulo: { id: id('S', 9), titulo: 'Primeira parte' }, bloco_id: id('B', 90), pagina: 4,
    ...(() => { const texto = 'O bom senso é a coisa do mundo mais bem partilhada; o poder de bem julgar e distinguir o verdadeiro do falso, que é propriamente o que se denomina o bom senso ou a razão, é naturalmente igual em todos os homens.'; const o = achar(texto, /razão/g); return { ocorrencias: o, trecho: trecho(texto, o) }; })() },
] };
const item = (doc: string, titulo: string, autor: string, formato: string, versao: string) => ({ id: doc, titulo, autor, formato, criado_em: '2026-09-20T12:00:00.000Z', versao_id: versao, texto_disponivel: true, estado: 'pronto', detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 }, progresso: null, jobs_em_curso: 0, arquivado_em: null, midia: null });

const pasta = resolve('../docs/ui-revisao/busca'); mkdirSync(pasta, { recursive: true });
const servidor = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: 5196, strictPort: true } });
const base = servidor.resolvedUrls!.local[0]!.replace(/\/$/, '');
const navegador = await chromium.launch();
const erros: string[] = [];
try {
  for (const colorScheme of ['light', 'dark'] as const) for (const [width, height] of [[1440, 900], [412, 915]]) {
    const pagina = await navegador.newPage({ viewport: { width: width!, height: height! }, colorScheme, reducedMotion: 'reduce' });
    pagina.on('pageerror', (e) => { erros.push(e.message); });
    await pagina.route('**/*', async (rota) => {
      const url = new URL(rota.request().url());
      if (url.origin !== base) return rota.abort();
      if (!url.pathname.startsWith('/api/')) return rota.continue();
      const responder = (json: unknown) => rota.fulfill({ contentType: 'application/json', body: JSON.stringify(json) });
      const caminho = url.pathname;
      if (caminho === '/api/busca') return responder(respostaDaBiblioteca);
      if (caminho.endsWith('/busca')) return responder(respostaDoDocumento);
      if (caminho.includes('/capitulos/')) return responder(snapshot);
      if (caminho.endsWith('/secoes')) return responder({ documento_id: documentoId, versao_id: versaoId, titulo: 'Pensamentos', capitulos, secoes: [], limites: [] });
      if (caminho.endsWith('/progresso')) return rota.request().method() === 'GET' ? responder({ progresso: null }) : rota.fulfill({ status: 503, body: '{}' });
      if (caminho === '/api/documentos') return responder({ documentos: [item(documentoId, 'Pensamentos', 'Blaise Pascal', 'md', versaoId), item('00000000000000000000000DB2', 'Discurso do método', 'René Descartes', 'pdf', id('V', 2))] });
      if (caminho === `/api/documentos/${documentoId}`) return responder({ ...item(documentoId, 'Pensamentos', 'Blaise Pascal', 'md', versaoId), versoes: [], execucoes: [], jobs: [], exportacoes: [] });
      return responder({});
    });
    const sufixo = `${String(width)}-${colorScheme === 'dark' ? 'escuro' : 'claro'}`;

    // Leitor: Ctrl F, a lista por capítulo, Enter vai ao primeiro achado e a caixa acende no termo.
    await pagina.goto(`${base}/ler/${documentoId}/${capitulos[0]!.id}`);
    await pagina.locator(`[data-bloco="${blocos[3]!.id}"]`).waitFor();
    await pagina.keyboard.press('Control+f');
    const campo = pagina.getByRole('searchbox', { name: 'Buscar no documento' });
    await campo.fill('razão');
    await pagina.getByText('5 ocorrências').waitFor();
    await campo.press('Enter');
    await pagina.getByText('1 de 5').waitFor();
    await pagina.waitForTimeout(400);
    assert.ok(await pagina.locator('.busca-no-documento mark').count() >= 4);
    await pagina.screenshot({ path: join(pasta, `leitor-${sufixo}.jpg`), quality: 85 });
    // O achado de outro capítulo leva à URL com ?bloco=.
    await campo.press('Enter'); await campo.press('Enter');
    await pagina.waitForURL((u) => u.pathname.endsWith(capitulos[2]!.id) && u.searchParams.get('bloco') === outros[0]!.id);

    // Biblioteca: o campo de busca também acha no texto.
    await pagina.goto(`${base}/biblioteca`);
    await pagina.getByRole('searchbox').fill('razão');
    await pagina.getByRole('region', { name: 'Encontrado no texto' }).waitFor();
    await pagina.screenshot({ path: join(pasta, `biblioteca-${sufixo}.jpg`), quality: 85, fullPage: true });
    await pagina.close();
  }
  assert.deepEqual(erros, []);
  console.log('Busca: painel do leitor, salto entre capítulos e trechos da biblioteca capturados.');
} finally { await navegador.close(); await servidor.close(); }
